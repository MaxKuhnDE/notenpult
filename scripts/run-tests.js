// Runs the tests in test/ against fresh data folders.
//   *.js       UI tests inside the real Electron app (injected via NOTENPULT_TEST)
//   *.node.js  plain Node tests
//   android.js the Android bundle in Chromium 93 (Electron 14, older than the tablet's WebView 95)
// Each test prints "PASS …" / "FAIL …" lines; any FAIL, crash or timeout fails the run.
//
//   npm test                 -> all suites
//   npm test -- smoke2.js    -> one suite
'use strict';

const { spawn, execFileSync, execSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const suites = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['smoke.js', 'smoke2.js', 'smoke3.js', 'migrate.js', 'update.js', 'apply-update.node.js', 'preset.js', 'android.js'];
const TIMEOUT_MS = 240000;

/** Data folder as written by version 1.0 (pages directly on the piece, layout 'two'). */
function setupV1(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'Noten'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'Anmerkungen'), { recursive: true });
  fs.copyFileSync(path.join(root, 'test', 'samples', 'Florentiner Marsch.pdf'), path.join(dataDir, 'Noten', 'v1flo.pdf'));
  const db = {
    version: 1,
    pieces: [{ id: 'p1', title: 'Florentiner Marsch', addedAt: 1, pages: [{ id: 'pg1', file: 'v1flo.pdf', page: 1 }, { id: 'pg2', file: 'v1flo.pdf', page: 2 }] }],
    setlists: [{ id: 's1', name: 'Alt', entries: [{ id: 'e1', pieceId: 'p1', number: '47' }] }],
    settings: { theme: 'light', landscapeLayout: 'two' },
    ui: { mode: 'setlists', setlistId: 's1' },
  };
  fs.writeFileSync(path.join(dataDir, 'notenpult.json'), JSON.stringify(db));
  fs.writeFileSync(path.join(dataDir, 'Anmerkungen', 'p1.json'), JSON.stringify({ pages: { pg1: [{ c: 'red', w: 0.003, p: [0.2, 0.2, 0.5, 0.4, 0.2, 0.5] }] } }));
}

/** Local stand-in for the GitHub releases API with a (fake) version 99.0.0. */
async function setupUpdateServer() {
  const asar = crypto.randomBytes(300 * 1024);
  const digest = `sha256:${crypto.createHash('sha256').update(asar).digest('hex')}`;
  const electronVersion = require('electron/package.json').version;
  let base = '';
  const server = http.createServer((req, res) => {
    const send = (type, body) => {
      res.writeHead(200, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
      res.end(body);
    };
    if (req.url === '/releases/latest') {
      return send('application/json', JSON.stringify({
        tag_name: 'v99.0.0',
        html_url: `${base}/release`,
        published_at: '2026-10-01T12:00:00Z',
        body: '### Hinzugefügt\n- Testfunktion für den Update-Knopf',
        assets: [
          { name: 'update.json', browser_download_url: `${base}/update.json`, size: 60 },
          { name: 'app.asar', browser_download_url: `${base}/app.asar`, size: asar.length, digest },
          { name: 'Notenpult-win32-x64.zip', browser_download_url: `${base}/full.zip`, size: 150 * 1024 * 1024 },
        ],
      }));
    }
    if (req.url === '/update.json') return send('application/json', JSON.stringify({ version: '99.0.0', electron: electronVersion }));
    if (req.url === '/app.asar') return send('application/octet-stream', asar);
    res.writeHead(404);
    return res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { env: { NOTENPULT_UPDATE_API: `${base}/releases/latest` }, cleanup: () => server.close() };
}

/** Export/import test: fixed ZIP path instead of dialogs; afterwards check the ZIP and the backup. */
function setupPreset() {
  const zip = path.join(os.tmpdir(), `notenpult-preset-test-${process.pid}.zip`);
  fs.rmSync(zip, { force: true });
  return {
    env: { NOTENPULT_TEST_PRESET: zip },
    after(dataDir) {
      let entries = [];
      try {
        const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
        entries = execFileSync(tar, ['-t', '-f', zip], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
      } catch { /* checked below */ }
      const has = (re) => entries.some((e) => re.test(e));
      return [
        `${has(/^notenpult-preset\.json$/) && has(/^notenpult\.json$/) && has(/^Noten\/.+\.pdf$/) && has(/^Noten\/.+\.png$/) && has(/^Anmerkungen\/.+\.json$/) ? 'PASS' : 'FAIL'} ZIP contains manifest, library, PDFs, images and annotations (${entries.length} entries)`,
        `${fs.existsSync(path.join(dataDir, '_vor-import', 'notenpult.json')) ? 'PASS' : 'FAIL'} previous state kept in _vor-import`,
      ];
    },
    cleanup: () => fs.rmSync(zip, { force: true }),
  };
}

/** Electron whose Chromium is older than the WebView on Android 5; installed on first use. */
const OLD_ELECTRON = '14.2.9'; // Chromium 93
function oldElectron() {
  const dir = path.join(root, 'node_modules', '.cache', `electron-${OLD_ELECTRON}`);
  const pkg = path.join(dir, 'node_modules', 'electron');
  if (!fs.existsSync(path.join(pkg, 'path.txt'))) {
    console.log(`  lädt Electron ${OLD_ELECTRON} (Chromium 93) für die Android-Prüfung …`);
    fs.mkdirSync(dir, { recursive: true });
    execSync(`npm install electron@${OLD_ELECTRON} --prefix "${dir}" --no-save --no-package-lock --no-audit --no-fund`, { stdio: 'ignore' });
  }
  return path.join(pkg, 'dist', fs.readFileSync(path.join(pkg, 'path.txt'), 'utf8').trim());
}

/** Android bundle in the old Chromium; dialogs and the ZIP file are replaced (test/android/bridge.js). */
function setupAndroid() {
  const www = fs.mkdtempSync(path.join(os.tmpdir(), 'notenpult-android-www-'));
  const zip = path.join(os.tmpdir(), `notenpult-android-test-${process.pid}.zip`);
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-android-web.js'), www], { stdio: 'ignore' });
  return {
    command: oldElectron(),
    args: [path.join(root, 'test', 'android', 'harness.js')],
    env: { NP_WWW: www, NP_PRESET_ZIP: zip },
    cleanup() {
      fs.rmSync(www, { recursive: true, force: true });
      fs.rmSync(zip, { force: true });
    },
  };
}

const SETUP = {
  'migrate.js': setupV1, 'update.js': setupUpdateServer, 'preset.js': setupPreset, 'android.js': setupAndroid,
};
const AFTER = {
  'migrate.js': (dataDir) => {
    const backup = path.join(dataDir, 'notenpult.vor-update.json');
    const ok = fs.existsSync(backup) && JSON.parse(fs.readFileSync(backup, 'utf8')).version === 1;
    return [`${ok ? 'PASS' : 'FAIL'} backup of the 1.0 library before migration`];
  },
};

async function runSuite(name) {
  // Fresh sample files and pool folder for every suite (smoke2 modifies the pool).
  execFileSync(process.execPath, [path.join(root, 'test', 'make-samples.js')], { stdio: 'ignore' });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notenpult-test-'));
  // Browser profile of its own: never the installed app's localStorage or single-instance lock.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'notenpult-profile-'));
  const setup = (await SETUP[name]?.(dataDir)) || {};
  const env = {
    ...process.env, ...(setup.env || {}), NOTENPULT_DATA_DIR: dataDir, NOTENPULT_TEST: path.join(root, 'test', name), NOTENPULT_TEST_PROFILE: profile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const isNode = name.endsWith('.node.js');

  return new Promise((resolve) => {
    const child = isNode
      ? spawn(process.execPath, [path.join(root, 'test', name)], { env, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(setup.command || electron, setup.args || [root], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let pass = 0;
    let fail = 0;
    let crashed = false;
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).replace(/^\[renderer:\w+\]\s*/, '').trimEnd();
        buffer = buffer.slice(i + 1);
        if (/^PASS /.test(line)) pass++;
        else if (/^FAIL /.test(line)) fail++;
        else if (/SMOKE FAIL|Test script failed/.test(line)) crashed = true;
        if (process.env.VERBOSE || /^(PASS|FAIL) |FAIL|error/i.test(line)) console.log(`  ${line}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => process.stderr.write(d));
    const timer = setTimeout(() => {
      crashed = true;
      console.log(`  TIMEOUT after ${TIMEOUT_MS / 1000}s`);
      child.kill();
    }, TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (isNode && code !== 0) crashed = true;
      for (const line of [...(AFTER[name]?.(dataDir) || []), ...(setup.after?.(dataDir) || [])]) {
        console.log(`  ${line}`);
        if (line.startsWith('PASS')) pass++;
        else fail++;
      }
      setup.cleanup?.();
      fs.rmSync(dataDir, { recursive: true, force: true });
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch { /* a helper process may still hold a file – it is in %TEMP% anyway */ }
      const ok = !fail && !crashed && pass > 0;
      console.log(`${ok ? '✔' : '✘'} ${name}: ${pass} bestanden, ${fail} fehlgeschlagen${crashed ? ', abgebrochen' : ''}\n`);
      resolve(ok);
    });
  });
}

(async () => {
  let allOk = true;
  for (const suite of suites) {
    console.log(`▶ ${suite}`);
    allOk = (await runSuite(suite)) && allOk;
  }
  process.exit(allOk ? 0 : 1);
})();
