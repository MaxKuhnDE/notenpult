'use strict';

const {
  app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeTheme, powerSaveBlocker, Menu,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;
const crypto = require('node:crypto');
const { registerUpdater } = require('./updater');

const HOST = 'notenpult';
const RENDERER_DIR = path.join(__dirname, 'renderer');
const SUPPORTED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);
const TEST_SCRIPT = process.env.NOTENPULT_TEST ? path.resolve(process.env.NOTENPULT_TEST) : null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// Must happen before the app is ready.
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

let win = null;
let paths = null;
let keepAwakeId = null;

function resolvePaths() {
  const dataDir = process.env.NOTENPULT_DATA_DIR
    ? path.resolve(process.env.NOTENPULT_DATA_DIR)
    : path.join(app.getPath('documents'), 'Notenpult');
  return {
    dataDir,
    filesDir: path.join(dataDir, 'Noten'),
    annDir: path.join(dataDir, 'Anmerkungen'),
    dbFile: path.join(dataDir, 'notenpult.json'),
    backupFile: path.join(dataDir, 'notenpult.backup.json'),
    poolCacheFile: path.join(dataDir, 'pool-index.json'),
  };
}

/** Recursively lists sheet files of the linked pool folder (e.g. in Google Drive). */
async function scanPool(root, rel, depth, out) {
  if (depth > 8 || out.length > 20000) return;
  let entries;
  try {
    entries = await fsp.readdir(rel ? path.join(root, rel) : root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name.startsWith('~$')) continue;
    const r = rel ? path.join(rel, ent.name) : ent.name;
    if (ent.isDirectory()) {
      await scanPool(root, r, depth + 1, out);
    } else if (SUPPORTED_EXT.has(path.extname(ent.name).toLowerCase())) {
      try {
        const st = await fsp.stat(path.join(root, r));
        out.push({ rel: r, abs: path.join(root, r), size: st.size, mtime: Math.round(st.mtimeMs) });
      } catch { /* vanished while scanning */ }
    }
  }
}

/** Google Drive for Desktop mounts a drive letter with "Meine Ablage" / "My Drive". */
async function detectGoogleDrive() {
  for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
    for (const name of ['Meine Ablage', 'My Drive']) {
      const p = `${letter}:\\${name}`;
      try {
        if ((await fsp.stat(p)).isDirectory()) return p;
      } catch { /* not there */ }
    }
  }
  return null;
}

// ---------- file helpers ----------

const writeQueues = new Map();

/** Writes via temp file + rename; writes to the same file are serialized. */
function writeAtomic(file, text) {
  const prev = writeQueues.get(file) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, text, 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.rename(tmp, file);
        return;
      } catch (err) {
        // Virus scanners / cloud sync can briefly lock the target on Windows.
        if (attempt >= 4) {
          await fsp.writeFile(file, text, 'utf8');
          await fsp.rm(tmp, { force: true });
          return;
        }
        await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
      }
    }
  });
  writeQueues.set(file, next);
  return next.then(() => true);
}

async function readText(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function annFile(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) throw new Error('Ungültige ID');
  return path.join(paths.annDir, `${id}.json`);
}

async function collectFiles(target, depth = 0, out = []) {
  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    return out;
  }
  if (stat.isDirectory()) {
    if (depth > 6) return out;
    const entries = await fsp.readdir(target);
    entries.sort((a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' }));
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      await collectFiles(path.join(target, name), depth + 1, out);
    }
  } else if (stat.isFile() && SUPPORTED_EXT.has(path.extname(target).toLowerCase())) {
    out.push(target);
  }
  return out;
}

// ---------- protocol ----------

function resolveRequest(url) {
  const u = new URL(url);
  if (u.host !== HOST) return null;
  const rel = decodeURIComponent(u.pathname);
  if (rel.startsWith('/library/')) {
    const name = path.basename(rel);
    return path.join(paths.filesDir, name);
  }
  const file = path.normalize(path.join(RENDERER_DIR, rel === '/' ? 'index.html' : rel));
  if (!file.startsWith(RENDERER_DIR + path.sep)) return null;
  return file;
}

function registerProtocol() {
  protocol.handle('app', async (request) => {
    const file = resolveRequest(request.url);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const data = await fsp.readFile(file);
      return new Response(data, {
        headers: {
          'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-cache',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('db:load', () => readText(paths.dbFile));
  ipcMain.handle('db:save', (_e, text) => writeAtomic(paths.dbFile, String(text)));

  ipcMain.handle('ann:load', (_e, id) => readText(annFile(id)));
  ipcMain.handle('ann:save', (_e, id, text) => writeAtomic(annFile(id), String(text)));
  ipcMain.handle('ann:delete', async (_e, id) => {
    await fsp.rm(annFile(id), { force: true });
    return true;
  });

  ipcMain.handle('files:pick', async (_e, opts = {}) => {
    const res = opts.folder
      ? await dialog.showOpenDialog(win, {
        title: 'Ordner mit Noten wählen',
        properties: ['openDirectory'],
      })
      : await dialog.showOpenDialog(win, {
        title: 'Noten importieren',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Noten (PDF, Bilder)', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'] },
        ],
      });
    if (res.canceled) return [];
    return res.filePaths;
  });

  ipcMain.handle('files:import', async (_e, inputPaths) => {
    const sources = [];
    for (const p of inputPaths || []) await collectFiles(p, 0, sources);
    await fsp.mkdir(paths.filesDir, { recursive: true });
    const records = [];
    for (const src of sources) {
      const ext = path.extname(src).toLowerCase();
      const file = `${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}${ext}`;
      try {
        await fsp.copyFile(src, path.join(paths.filesDir, file));
        records.push({ file, name: path.basename(src, path.extname(src)), ext });
      } catch (err) {
        records.push({ error: String(err.message || err), name: path.basename(src) });
      }
    }
    return records;
  });

  ipcMain.handle('files:delete', async (_e, names) => {
    for (const name of names || []) {
      await fsp.rm(path.join(paths.filesDir, path.basename(String(name))), { force: true });
    }
    return true;
  });

  ipcMain.handle('dialog:pickFolder', async (_e, opts = {}) => {
    const res = await dialog.showOpenDialog(win, {
      title: opts.title || 'Ordner wählen',
      defaultPath: opts.defaultPath || undefined,
      properties: ['openDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('pool:detectDrive', () => detectGoogleDrive());

  ipcMain.handle('pool:scan', async (_e, folder) => {
    try {
      const st = await fsp.stat(folder);
      if (!st.isDirectory()) throw new Error('Kein Ordner');
      const files = [];
      await scanPool(folder, '', 0, files);
      const index = { folder, scannedAt: Date.now(), files };
      writeAtomic(paths.poolCacheFile, JSON.stringify(index)).catch(() => {});
      return { ok: true, ...index };
    } catch (err) {
      let cached = null;
      try {
        cached = JSON.parse((await readText(paths.poolCacheFile)) || 'null');
      } catch { /* broken cache */ }
      const usable = cached && cached.folder === folder ? cached : { folder, scannedAt: null, files: [] };
      return { ok: false, error: String(err.message || err), ...usable };
    }
  });

  ipcMain.handle('app:openDataDir', async () => {
    await fsp.mkdir(paths.dataDir, { recursive: true });
    return shell.openPath(paths.dataDir);
  });
  ipcMain.handle('app:info', () => ({ dataDir: paths.dataDir, version: app.getVersion(), packaged: app.isPackaged }));

  ipcMain.handle('win:setFullscreen', (_e, on) => {
    if (win) win.setFullScreen(!!on);
    return win ? win.isFullScreen() : false;
  });
  ipcMain.handle('win:isFullscreen', () => (win ? win.isFullScreen() : false));

  ipcMain.handle('power:keepAwake', (_e, on) => {
    if (on && keepAwakeId === null) keepAwakeId = powerSaveBlocker.start('prevent-display-sleep');
    if (!on && keepAwakeId !== null) {
      powerSaveBlocker.stop(keepAwakeId);
      keepAwakeId = null;
    }
    return true;
  });

  ipcMain.handle('theme:set', (_e, mode) => {
    nativeTheme.themeSource = ['light', 'dark'].includes(mode) ? mode : 'system';
    return true;
  });
}

// ---------- test hooks (only active with NOTENPULT_TEST) ----------

function registerTestHooks() {
  const outDir = path.join(path.dirname(TEST_SCRIPT), 'out');
  win.webContents.on('console-message', (...args) => {
    const e = args[0];
    const level = e.level ?? args[1];
    const message = e.message ?? args[2];
    console.log(`[renderer:${level}] ${message}`);
  });
  ipcMain.handle('test:capture', async (_e, name) => {
    const img = await win.webContents.capturePage(undefined, { stayHidden: true });
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.writeFile(path.join(outDir, `${name}.png`), img.toPNG());
    return true;
  });
  ipcMain.handle('test:resize', (_e, w, h) => {
    win.setContentSize(w, h);
    return true;
  });
  ipcMain.handle('test:copyFile', async (_e, src, dst) => {
    await fsp.copyFile(src, dst);
    const later = new Date(Date.now() + 5000);
    await fsp.utimes(dst, later, later);
    return true;
  });
  ipcMain.handle('test:done', () => {
    setTimeout(() => app.quit(), 50);
    return true;
  });
  win.webContents.once('did-finish-load', async () => {
    const samplesDir = path.join(path.dirname(TEST_SCRIPT), 'samples');
    const code = (await fsp.readFile(TEST_SCRIPT, 'utf8')).replace(/__SAMPLES_DIR__/g, JSON.stringify(samplesDir));
    try {
      await win.webContents.executeJavaScript(code);
    } catch (err) {
      console.error('Test script failed:', err);
      app.quit();
    }
  });
}

// ---------- window ----------

function createWindow() {
  win = new BrowserWindow({
    width: TEST_SCRIPT ? 1280 : 1366,
    height: TEST_SCRIPT ? 800 : 860,
    useContentSize: true,
    minWidth: 420,
    minHeight: 420,
    title: 'Notenpult',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161618' : '#f3f1ec',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: !TEST_SCRIPT,
    },
  });

  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`app://${HOST}/`)) e.preventDefault();
  });
  win.on('enter-full-screen', () => win.webContents.send('win:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('win:fullscreen', false));
  win.on('closed', () => {
    win = null;
  });

  if (TEST_SCRIPT) {
    registerTestHooks();
    // Fully transparent but "shown", so Chromium paints every frame normally.
    win.setOpacity(0);
    win.setSkipTaskbar(true);
    win.showInactive();
  } else {
    win.once('ready-to-show', () => {
      win.maximize();
      win.show();
    });
  }

  win.loadURL(`app://${HOST}/index.html`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    paths = resolvePaths();
    await fsp.mkdir(paths.filesDir, { recursive: true });
    await fsp.mkdir(paths.annDir, { recursive: true });
    // One rolling backup of the library index per start.
    try {
      await fsp.copyFile(paths.dbFile, paths.backupFile);
    } catch { /* no db yet */ }
    // Keep a copy of a library from an older app version before it gets migrated.
    try {
      const text = await readText(paths.dbFile);
      if (text && (JSON.parse(text).version || 1) < 2) {
        await fsp.copyFile(paths.dbFile, path.join(paths.dataDir, 'notenpult.vor-update.json'), fs.constants.COPYFILE_EXCL);
      }
    } catch { /* unreadable db or copy already exists */ }

    Menu.setApplicationMenu(null);
    registerProtocol();
    registerIpc();
    registerUpdater();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
