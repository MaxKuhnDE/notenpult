// Stand-in for MainActivity's Java bridge (window.NotenpultAndroid) in test/android/harness.js:
// same methods, same answers, same data layout. The dialogs are replaced by test settings:
//   window.__npTestPick   files that "Noten importieren" picks
//   NP_PRESET_ZIP         where "Alles exportieren" writes and "Alles importieren" reads
//   a fake release 99.0.0 for the update check (GitHub itself: Net.java, JUnit NetTest)
//   "Im WLAN teilen" with the Windows implementation (lan/*.js) on 127.0.0.1 – LanTest checks
//   that LanHost/LanClient.java speak exactly the same protocol
// The ZIP code itself is Java (Preset.java) and tested with JUnit (android/app/src/test).
'use strict';

const { ipcRenderer } = require('electron');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.NOTENPULT_DATA_DIR;
const DATA = path.join(ROOT, 'Notenpult');
const NOTEN = path.join(DATA, 'Noten');
const ANN = path.join(DATA, 'Anmerkungen');
const DB = path.join(DATA, 'notenpult.json');
const ZIP = process.env.NP_PRESET_ZIP;
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const { version } = require('../../package.json');
const { startHost } = require('../../lan/host');
const { discover, connect } = require('../../lan/client');
const { applyReceive } = require('../../lan/apply');
const { SAFE_FILE } = require('../../lan/protocol');

const LAN_PATHS = {
  dataDir: DATA, dbFile: DB, filesDir: NOTEN, annDir: ANN,
};
const LAN_DISCOVERY = 47000 + Math.floor(Math.random() * 900); // the test's own, never the real 47321
const lan = { host: null, session: null, other: null };

const APK_URL = 'https://github.com/MaxKuhnDE/notenpult/releases/download/v99.0.0/Notenpult-android.apk';
const RELEASE = {
  tag_name: 'v99.0.0',
  html_url: 'https://github.com/MaxKuhnDE/notenpult/releases/tag/v99.0.0',
  published_at: '2026-10-01T12:00:00Z',
  body: '### Hinzugefügt\n- Testversion',
  assets: [{
    name: 'Notenpult-android.apk', browser_download_url: APK_URL, size: 4 * 1048576, digest: 'sha256:00ff',
  }],
};

fs.mkdirSync(NOTEN, { recursive: true });
fs.mkdirSync(ANN, { recursive: true });

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const later = (id, result) => setTimeout(() => window.__npResolve(id, JSON.stringify(result)), 20);
const counts = (text) => {
  const db = JSON.parse(text);
  return { pieces: db.pieces.length, setlists: db.setlists.length };
};
const lanEvent = (e) => window.__npLanEvent && window.__npLanEvent(e);
const lanFail = (err) => ({ ok: false, error: err.code || 'error', message: err.message });

window.NotenpultAndroid = {
  loadDb: () => read(DB),
  saveDb(text) {
    fs.writeFileSync(`${DB}.tmp`, text);
    fs.renameSync(`${DB}.tmp`, DB);
    return true;
  },
  loadAnnotations: (id) => (SAFE_ID.test(id) ? read(path.join(ANN, `${id}.json`)) : null),
  saveAnnotations(id, text) {
    if (!SAFE_ID.test(id)) return false;
    fs.writeFileSync(path.join(ANN, `${id}.json`), text);
    return true;
  },
  deleteAnnotations(id) {
    if (SAFE_ID.test(id)) rm(path.join(ANN, `${id}.json`));
  },
  deleteFiles(json) {
    for (const n of JSON.parse(json)) rm(path.join(NOTEN, path.basename(n)));
  },
  info: () => JSON.stringify({
    version, platform: 'android', packaged: true, dataDir: 'Test (Chromium-Prüfung)', android: '5.0.2', device: 'Test',
  }),
  keepAwake(on) {
    window.__npAwake = on;
  },
  setFullscreen(on) {
    window.__npFullscreen = on;
  },
  openUrl(url) {
    window.__npOpened = url;
  },
  checkUpdate(id) {
    later(id, { ok: true, status: 200, body: JSON.stringify(RELEASE) });
  },
  installUpdate(id, url, digest) {
    window.__npInstalled = { url, digest };
    window.__npUpdateProgress({ phase: 'download', received: 2 * 1048576, total: 4 * 1048576 });
    setTimeout(() => later(id, { ok: true, opened: true }), 100);
  },
  pickFiles(id) {
    const records = (window.__npTestPick || []).map((src) => {
      const ext = path.extname(src).toLowerCase();
      const file = `${crypto.randomBytes(8).toString('hex')}${ext}`;
      fs.copyFileSync(src, path.join(NOTEN, file));
      return { file, name: path.basename(src, path.extname(src)), ext };
    });
    later(id, { records });
  },
  exportPreset(id) {
    const text = read(DB);
    const staging = fs.mkdtempSync(path.join(ROOT, 'export-'));
    const manifest = {
      format: 'notenpult-preset',
      formatVersion: 1,
      appVersion: version,
      platform: 'android',
      exportedAt: new Date().toISOString(),
      counts: counts(text),
    };
    fs.writeFileSync(path.join(staging, 'notenpult-preset.json'), JSON.stringify(manifest));
    rm(ZIP);
    execFileSync(TAR, ['-a', '-c', '-f', ZIP, '-C', staging, 'notenpult-preset.json', '-C', DATA, 'notenpult.json', 'Noten', 'Anmerkungen']);
    rm(staging);
    later(id, { ok: true, name: path.basename(ZIP), size: fs.statSync(ZIP).size, counts: manifest.counts });
  },
  importPreset(id) {
    const staging = path.join(ROOT, '.import-neu');
    rm(staging);
    fs.mkdirSync(staging);
    execFileSync(TAR, ['-x', '-f', ZIP, '-C', staging]);
    const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'notenpult-preset.json'), 'utf8'));
    fs.rmSync(path.join(staging, 'notenpult-preset.json'));
    rm(DATA);
    fs.renameSync(staging, DATA);
    later(id, { ok: true, counts: manifest.counts, from: manifest.platform });
  },
  lanHostStart(id) {
    if (lan.host) lan.host.stop();
    startHost({
      paths: LAN_PATHS, name: 'Test-Tablet', app: version, bind: '127.0.0.1', port: 0, discoveryPort: 0, onEvent: lanEvent,
    }).then((host) => {
      lan.host = host;
      later(id, {
        ok: true, code: host.code, port: host.port, addresses: ['127.0.0.1'], name: host.name,
      });
    }).catch((err) => later(id, lanFail(err)));
  },
  lanHostStop() {
    if (lan.host) lan.host.stop();
    lan.host = null;
  },
  lanDiscover(id) {
    discover({ targets: ['127.0.0.1'], port: LAN_DISCOVERY, timeoutMs: 800 }).then((hosts) => later(id, { hosts }));
  },
  lanConnect(id, address, port, code) {
    if (lan.session) lan.session.abort();
    lan.session = null;
    connect({
      address, port: Number(port), code, name: 'Test-Tablet',
    }).then(async (s) => {
      try {
        const manifest = await s.manifest();
        lan.session = s;
        later(id, { ok: true, manifest });
      } catch (err) {
        s.abort();
        later(id, lanFail(err));
      }
    }, (err) => later(id, lanFail(err)));
  },
  lanLocalFiles() {
    const out = {};
    for (const f of fs.readdirSync(NOTEN)) if (SAFE_FILE.test(f)) out[f] = fs.statSync(path.join(NOTEN, f)).size;
    return JSON.stringify(out);
  },
  lanDownload(id, namesJson) {
    const s = lan.session;
    if (!s) {
      later(id, { ok: false, error: 'closed' });
      return;
    }
    s.download(JSON.parse(namesJson), NOTEN, (p) => lanEvent({ type: 'download', ...p }))
      .then(() => later(id, { ok: true }), (err) => {
        s.abort();
        lan.session = null;
        later(id, lanFail(err));
      });
  },
  lanFinish(id, payloadJson) {
    applyReceive(LAN_PATHS, JSON.parse(payloadJson)).then(async () => {
      if (lan.session) await lan.session.close(true);
      lan.session = null;
      later(id, { ok: true });
    }, (err) => later(id, lanFail(err)));
  },
  lanCancel() {
    if (lan.session) lan.session.close(false);
    lan.session = null;
  },
};

/** The other device as receiver: pulls everything from the tablet that is sharing. */
async function lanPull(port, code) {
  const out = fs.mkdtempSync(path.join(ROOT, 'lan-pull-'));
  try {
    const s = await connect({
      address: '127.0.0.1', port, code, name: 'Laptop eines Freundes',
    });
    const m = await s.manifest();
    await s.download(m.files.map(([n]) => n), out);
    await s.close(true);
    const same = m.files.every(([n]) => fs.readFileSync(path.join(out, n)).equals(fs.readFileSync(path.join(NOTEN, n))));
    return {
      pieces: JSON.parse(m.db).pieces.length, files: m.files.length, same, hostName: s.hostName,
    };
  } finally {
    rm(out);
  }
}

/**
 * The other device as host ("WLAN-Testgerät", code 2580): the tablet's library plus "Abendlied"
 * with a sheet file the tablet does not have yet.
 */
async function lanServe() {
  const dir = path.join(ROOT, 'lan-host');
  rm(dir);
  fs.mkdirSync(path.join(dir, 'Anmerkungen'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Noten'));
  for (const f of fs.readdirSync(NOTEN)) fs.copyFileSync(path.join(NOTEN, f), path.join(dir, 'Noten', f));
  fs.copyFileSync(path.join(__dirname, '..', 'samples', 'Polka Nr 5.png'), path.join(dir, 'Noten', 'abend0001.png'));
  const db = JSON.parse(read(DB));
  db.pieces.push({
    id: 'abend1', title: 'Abendlied', genres: [], part: 0, addedAt: Date.now(), parts: [{ id: 'abend1a', name: '1. Stimme', pages: [{ id: 'abend1g', file: 'abend0001.png', page: 1 }] }],
  });
  fs.writeFileSync(path.join(dir, 'notenpult.json'), JSON.stringify(db));
  if (lan.other) lan.other.stop();
  lan.other = await startHost({
    paths: {
      dataDir: dir, dbFile: path.join(dir, 'notenpult.json'), filesDir: path.join(dir, 'Noten'), annDir: path.join(dir, 'Anmerkungen'),
    },
    name: 'WLAN-Testgerät', app: version, bind: '127.0.0.1', port: 0, discoveryPort: LAN_DISCOVERY, codes: ['2580'],
  });
  return { pieces: db.pieces.length };
}

window.__npTestApkUrl = APK_URL;
window.__npTest = {
  capture: (name) => ipcRenderer.invoke('test:capture', name),
  done: () => ipcRenderer.invoke('test:done'),
  lanPull,
  lanServe,
};
