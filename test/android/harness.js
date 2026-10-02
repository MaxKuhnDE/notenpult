// Runs the Android bundle (scripts/build-android-web.js) in an old Electron whose Chromium
// is older than the WebView of Android 5 (Chrome 95) – what works here works on the tablet.
// Mirrors MainActivity: https://notenpult.local/… from the bundle and the data folder,
// window.NotenpultAndroid from bridge.js. Started by scripts/run-tests.js (suite android.js).
//   NP_WWW               built bundle
//   NOTENPULT_DATA_DIR   stands for the app's files/ folder (data in files/Notenpult)
//   NOTENPULT_TEST       test script, injected after every page load
'use strict';

const { app, BrowserWindow, protocol, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const WWW = process.env.NP_WWW;
const DATA = path.join(process.env.NOTENPULT_DATA_DIR, 'Notenpult');
const TEST_SCRIPT = path.resolve(process.env.NOTENPULT_TEST);
const OUT = path.join(path.dirname(TEST_SCRIPT), 'out');
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};
const APK_URL = 'https://github.com/MaxKuhnDE/notenpult/releases/download/v99.0.0/Notenpult-android.apk';
const RELEASE = {
  tag_name: 'v99.0.0',
  html_url: 'https://github.com/MaxKuhnDE/notenpult/releases/tag/v99.0.0',
  published_at: '2026-10-01T12:00:00Z',
  body: '### Hinzugefügt\n- Testversion',
  assets: [{ name: 'Notenpult-android.apk', browser_download_url: APK_URL, size: 4 * 1048576 }],
};

// Tablet: 1024 × 768 CSS pixels at device pixel ratio 2 (Galaxy Tab S2 9.7").
app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(() => {
  console.log(`Chromium ${process.versions.chrome}`);
  protocol.interceptBufferProtocol('https', (req, respond) => {
    const url = new URL(req.url);
    const send = (statusCode, mimeType, data, headers = {}) => respond({
      statusCode, mimeType, data, headers: { 'Cache-Control': 'no-store', ...headers },
    });
    if (url.hostname === 'notenpult.local') {
      let p = decodeURIComponent(url.pathname);
      if (p === '/') p = '/index.html';
      const file = p.startsWith('/library/') ? path.join(DATA, 'Noten', p.slice(9)) : path.join(WWW, p);
      if (p.includes('..') || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'text/plain', Buffer.alloc(0));
      return send(200, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', fs.readFileSync(file));
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/repos/MaxKuhnDE/notenpult/releases/latest') {
      return send(200, 'application/json', Buffer.from(JSON.stringify(RELEASE)), { 'Access-Control-Allow-Origin': '*' });
    }
    return send(404, 'text/plain', Buffer.alloc(0));
  });

  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    useContentSize: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'bridge.js'),
      contextIsolation: false, // like addJavascriptInterface: the bridge is a plain global
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    // Errors in the page are test failures (on the tablet nobody would see them).
    if (level >= 3) console.log(`FAIL page error: ${message} (${String(source).split('/').pop()}:${line})`);
    else console.log(`[renderer:${level}] ${message}`);
  });
  ipcMain.handle('test:capture', async (_e, name) => {
    const img = await win.webContents.capturePage();
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
    return true;
  });
  ipcMain.handle('test:done', () => {
    setTimeout(() => app.quit(), 50);
    return true;
  });
  let navigations = 0;
  win.webContents.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) navigations += 1;
  });
  win.webContents.on('did-finish-load', async () => {
    const atStart = navigations;
    const samplesDir = path.join(path.dirname(TEST_SCRIPT), 'samples');
    const code = fs.readFileSync(TEST_SCRIPT, 'utf8')
      .replace(/__SAMPLES_DIR__/g, JSON.stringify(samplesDir))
      .replace(/__APK_URL__/g, JSON.stringify(APK_URL));
    try {
      await win.webContents.executeJavaScript(code);
    } catch (err) {
      if (navigations !== atStart) return; // reloaded on purpose (import) – runs again there
      console.log(`FAIL test script: ${err && err.message}`);
      app.quit();
    }
  });
  // Fully transparent but shown, so Chromium paints every frame (as in main.js).
  win.setOpacity(0);
  win.setSkipTaskbar(true);
  win.showInactive();
  win.loadURL('https://notenpult.local/index.html');
});
