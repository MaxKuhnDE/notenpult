// Stand-in for MainActivity's Java bridge (window.NotenpultAndroid) in test/android/harness.js:
// same methods, same answers, same data layout. The dialogs are replaced by test settings:
//   window.__npTestPick   files that "Noten importieren" picks
//   NP_PRESET_ZIP         where "Alles exportieren" writes and "Alles importieren" reads
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

fs.mkdirSync(NOTEN, { recursive: true });
fs.mkdirSync(ANN, { recursive: true });

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const later = (id, result) => setTimeout(() => window.__npResolve(id, JSON.stringify(result)), 20);
const counts = (text) => {
  const db = JSON.parse(text);
  return { pieces: db.pieces.length, setlists: db.setlists.length };
};

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
};

window.__npTest = {
  capture: (name) => ipcRenderer.invoke('test:capture', name),
  done: () => ipcRenderer.invoke('test:done'),
};
