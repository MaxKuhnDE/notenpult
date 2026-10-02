'use strict';

// In-app updates from GitHub Releases (MaxKuhnDE/notenpult). A release carries:
//   app.asar                  the app itself (a few MB) – used when the Electron runtime is unchanged
//   Notenpult-win32-x64.zip   the complete app incl. Electron runtime (~140 MB)
//   update.json               { version, electron }
// The download is checked against GitHub's SHA-256 digest; after Notenpult has quit, apply-update.js
// (run by Notenpult.exe itself in Node mode) swaps the files in and starts it again – or, for a
// protected folder like C:\Program Files, apply-update.ps1 with administrator rights.
// User data (Dokumente\Notenpult) is never touched.

const { app, net, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
// Electron's fs treats every "*.asar" path as an archive – the download folder holds
// a real app.asar file (and the extracted full build), so it uses the plain fs.
const ofs = require('original-fs');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { lastUpdateResult, compareVersions } = require('./result');

const fsp = ofs.promises;
const REPO = 'MaxKuhnDE/notenpult';
const API = process.env.NOTENPULT_UPDATE_API || `https://api.github.com/repos/${REPO}/releases/latest`;
// UI tests stop after the verified download; NOTENPULT_UPDATE_REAL lets an end-to-end test swap files.
const TEST = !!process.env.NOTENPULT_TEST && !process.env.NOTENPULT_UPDATE_REAL;
const ZIP_NAME = 'Notenpult-win32-x64.zip';
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

let lastCheck = null; // { latest, asset, mode } – install only uses what the check found
let installing = false;

const request = (url) => net.fetch(url, {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Notenpult/${app.getVersion()}` },
  cache: 'no-store',
});

const installDir = () => path.dirname(process.execPath);

/**
 * fs.access() ignores Windows permissions (ACLs) and calls C:\Program Files writable – so try
 * a real file. No permission (EPERM/EACCES) → apply-update.ps1 asks for administrator rights.
 * Any other refusal – typically "file not found" when Windows' ransomware protection blocks
 * the folder – cannot be fixed by an update; say so instead of quitting for nothing.
 */
function canInstall() {
  if (!app.isPackaged && !TEST) return { ok: false, elevate: false, reason: 'Entwicklungsversion – Updates gehen nur in der installierten App.' };
  const probe = path.join(installDir(), 'resources', `.notenpult-write-test-${process.pid}`);
  try {
    ofs.writeFileSync(probe, '');
    ofs.rmSync(probe, { force: true });
    return { ok: true, elevate: false, reason: '' };
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') return { ok: true, elevate: true, reason: '' };
    return {
      ok: false,
      elevate: false,
      reason: `Windows lässt Notenpult in seinem Programmordner nichts ändern (${err.code || err.message}) – z. B. der Ransomware-Schutz „Überwachter Ordnerzugriff“. `
        + 'Abhilfe: den Notenpult-Ordner nach %LOCALAPPDATA%\\Programs\\Notenpult verschieben (außerhalb von Dokumente/OneDrive).',
    };
  }
}

async function check() {
  const current = app.getVersion();
  let res;
  try {
    res = await request(API);
  } catch {
    return { ok: false, current, error: 'Keine Verbindung zu GitHub – später noch einmal versuchen.' };
  }
  if (res.status === 404) return { ok: true, current, latest: null, newer: false };
  if (!res.ok) return { ok: false, current, error: `GitHub antwortet mit Fehler ${res.status}.` };
  const rel = await res.json();
  const latest = String(rel.tag_name || '').replace(/^v/, '');
  const find = (name) => (rel.assets || []).find((a) => a.name === name);

  let meta = null;
  const metaAsset = find('update.json');
  if (metaAsset) {
    try {
      const r = await request(metaAsset.browser_download_url);
      if (r.ok) meta = await r.json();
    } catch { /* fall back to the full package */ }
  }
  const asar = find('app.asar');
  const zip = find(ZIP_NAME);
  const small = asar && meta && meta.electron === process.versions.electron;
  const asset = small ? asar : zip || null;
  const mode = small ? 'asar' : 'full';
  lastCheck = { latest, asset, mode };
  const can = canInstall();
  return {
    ok: true,
    current,
    latest,
    newer: !!latest && compareVersions(latest, current) > 0,
    notes: rel.body || '',
    url: rel.html_url,
    published: rel.published_at,
    mode,
    size: asset ? asset.size : null,
    installable: !!asset && can.ok,
    elevate: can.elevate,
    reason: asset ? can.reason : 'Im Release fehlen die Update-Dateien.',
  };
}

async function download(asset, dest, onProgress) {
  const res = await request(asset.browser_download_url);
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || asset.size || 0;
  const hash = crypto.createHash('sha256');
  const out = ofs.createWriteStream(dest);
  const failed = new Promise((_, reject) => out.on('error', reject));
  failed.catch(() => {}); // observed via Promise.race below
  let received = 0;
  let lastReport = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    received += value.length;
    if (!out.write(value)) await Promise.race([new Promise((r) => out.once('drain', r)), failed]);
    if (Date.now() - lastReport > 150) {
      lastReport = Date.now();
      onProgress({ phase: 'download', received, total });
    }
  }
  await Promise.race([new Promise((r) => out.end(r)), failed]);
  onProgress({ phase: 'download', received, total });
  const digest = hash.digest('hex');
  if (asset.size && received !== asset.size) throw new Error('Download unvollständig – bitte noch einmal versuchen.');
  if (typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') && asset.digest.slice(7) !== digest) {
    throw new Error('Prüfsumme stimmt nicht – der Download ist beschädigt.');
  }
  return digest;
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}

async function install(send) {
  if (installing) throw new Error('Das Update läuft bereits.');
  if (!lastCheck || !lastCheck.asset) throw new Error('Bitte zuerst nach Updates suchen.');
  const can = canInstall();
  if (!can.ok) throw new Error(can.reason);
  installing = true;
  try {
    const { latest, asset, mode } = lastCheck;
    const staging = path.join(app.getPath('temp'), `notenpult-update-${latest}`);
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.mkdir(staging, { recursive: true });
    const file = path.join(staging, asset.name);
    const sha256 = await download(asset, file, send);

    let source = file;
    if (mode === 'full') {
      send({ phase: 'extract' });
      source = path.join(staging, 'app');
      await fsp.mkdir(source);
      await run(path.join(SYSTEM32, 'tar.exe'), ['-xf', file, '-C', source]);
      if (!ofs.existsSync(path.join(source, 'Notenpult.exe'))) throw new Error('Das Update-Paket ist unvollständig.');
    }
    // Tests stop here: the files are downloaded and verified, nothing is replaced.
    if (TEST) return { staged: source, sha256, mode };

    send({ phase: 'restart' });
    if (can.elevate) startElevatedSwap(staging, mode, source);
    else await startSwap(staging, mode, source);
    setTimeout(() => app.quit(), 400);
    return { restarting: true };
  } finally {
    installing = false;
  }
}

/**
 * Normal case: a Notenpult.exe in Node mode does the swap – the installed one for app.asar,
 * the new build's one for a full update (the installed runtime files must not be in use).
 */
async function startSwap(staging, mode, source) {
  const script = path.join(staging, 'apply-update.js');
  // Read from inside app.asar (normal fs), written out with plain fs.
  await fsp.writeFile(script, await fs.promises.readFile(path.join(__dirname, 'apply-update.js')));
  const helper = mode === 'full' ? path.join(source, 'Notenpult.exe') : process.execPath;
  spawn(helper, [script, '--pid', String(process.pid), '--mode', mode, '--source', source,
    '--target', installDir(), '--exe', process.execPath], {
    detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).unref();
}

/** Protected folder (C:\Program Files): apply-update.ps1 asks Windows for administrator rights. */
function startElevatedSwap(staging, mode, source) {
  const script = path.join(staging, 'apply-update.ps1');
  ofs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'apply-update.ps1')));
  // Windows PowerShell does nothing when started detached (no console), so cmd.exe – which runs
  // fine detached and outlives Notenpult – starts it in its own hidden console via "start".
  const q = (s) => `"${s}"`;
  const line = ['start', '""', '/min', q(path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')),
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', q(script),
    '-AppPid', String(process.pid), '-Mode', mode, '-Source', q(source), '-Target', q(installDir()),
    '-Exe', q(process.execPath)].join(' ');
  spawn(path.join(SYSTEM32, 'cmd.exe'), ['/d', '/s', '/c', `"${line}"`], {
    detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
  }).unref();
}

function registerUpdater() {
  ipcMain.handle('update:check', () => check());
  // Once per start: report the outcome of the update that ran before this start.
  ipcMain.handle('update:lastResult', () => (TEST ? null : lastUpdateResult(app.getPath('temp'), app.getVersion())));
  ipcMain.handle('update:install', (e) => install((p) => {
    if (!e.sender.isDestroyed()) e.sender.send('update:progress', p);
  }));
}

module.exports = { registerUpdater, compareVersions };
