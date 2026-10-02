'use strict';

// Export/import of the complete library as one ZIP – e.g. from the PC to the Android tablet.
//   notenpult-preset.json   { format, formatVersion, appVersion, platform, exportedAt, counts }
//   notenpult.json          pieces, parts, setlists, genres, settings
//   Noten/…                 PDFs and images
//   Anmerkungen/…           pen strokes per piece
// Import replaces everything ("spiegelgleich"); the previous state stays in _vor-import.
// The Android app (android/…/MainActivity.java) reads and writes the same format.

const { app, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const fsp = fs.promises;
const FORMAT = 'notenpult-preset';
const FORMAT_VERSION = 1;
const ENTRIES = ['notenpult.json', 'Noten', 'Anmerkungen'];
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve();
    });
  });
}

function countsOf(dbText) {
  try {
    const db = JSON.parse(dbText);
    return { pieces: (db.pieces || []).length, setlists: (db.setlists || []).length };
  } catch {
    return {};
  }
}

/** fs.rename with a few retries – virus scanners or cloud sync may hold a file for a moment. */
async function move(from, to) {
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      if (i >= 5) throw err;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
}

async function exportPreset(win, paths, fixedFile = null) {
  let file = fixedFile;
  if (!file) {
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await dialog.showSaveDialog(win, {
      title: 'Notenpult exportieren',
      defaultPath: path.join(app.getPath('downloads'), `Notenpult-Export-${stamp}.zip`),
      filters: [{ name: 'Notenpult-Export (ZIP)', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    file = res.filePath;
  }
  const dbText = await fsp.readFile(paths.dbFile, 'utf8').catch(() => null);
  if (!dbText) return { ok: false, error: 'Es gibt noch nichts zu exportieren.' };
  await fsp.mkdir(paths.filesDir, { recursive: true });
  await fsp.mkdir(paths.annDir, { recursive: true });
  const files = (await fsp.readdir(paths.filesDir)).length;
  const staging = await fsp.mkdtemp(path.join(app.getPath('temp'), 'notenpult-export-'));
  try {
    const manifest = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      appVersion: app.getVersion(),
      platform: 'windows',
      exportedAt: new Date().toISOString(),
      counts: { ...countsOf(dbText), files },
    };
    await fsp.writeFile(path.join(staging, 'notenpult-preset.json'), JSON.stringify(manifest, null, 2));
    await fsp.rm(file, { force: true });
    // "-a" + ".zip" makes Windows' tar (bsdtar) write a normal ZIP file.
    await run(TAR, ['-a', '-c', '-f', file, '-C', staging, 'notenpult-preset.json', '-C', paths.dataDir, ...ENTRIES]);
    const { size } = await fsp.stat(file);
    return { ok: true, file, name: path.basename(file), size, counts: manifest.counts };
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

async function importPreset(win, paths, fixedFile = null) {
  let file = fixedFile;
  if (!file) {
    const res = await dialog.showOpenDialog(win, {
      title: 'Notenpult-Export importieren',
      properties: ['openFile'],
      filters: [{ name: 'Notenpult-Export (ZIP)', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    file = res.filePaths[0];
  }
  // Unpack next to the data (same drive), so the final swap is a quick rename.
  await fsp.mkdir(paths.dataDir, { recursive: true });
  const staging = await fsp.mkdtemp(path.join(paths.dataDir, '.import-'));
  try {
    try {
      await run(TAR, ['-x', '-f', file, '-C', staging]);
    } catch {
      return { ok: false, error: 'Die Datei lässt sich nicht entpacken – ist es wirklich ein Notenpult-Export (ZIP)?' };
    }
    let manifest = null;
    try {
      manifest = JSON.parse(await fsp.readFile(path.join(staging, 'notenpult-preset.json'), 'utf8'));
    } catch { /* checked below */ }
    if (!manifest || manifest.format !== FORMAT) return { ok: false, error: 'Das ist keine Notenpult-Export-Datei.' };
    if (manifest.formatVersion > FORMAT_VERSION) {
      return { ok: false, error: 'Die Datei stammt aus einer neueren Notenpult-Version – bitte zuerst Notenpult aktualisieren.' };
    }
    let dbText;
    try {
      dbText = await fsp.readFile(path.join(staging, 'notenpult.json'), 'utf8');
      JSON.parse(dbText);
    } catch {
      return { ok: false, error: 'Die Export-Datei ist beschädigt (notenpult.json fehlt oder ist ungültig).' };
    }
    await fsp.mkdir(path.join(staging, 'Noten'), { recursive: true });
    await fsp.mkdir(path.join(staging, 'Anmerkungen'), { recursive: true });

    // Keep the current state as _vor-import (one level), then swap in the imported one.
    const backup = path.join(paths.dataDir, '_vor-import');
    await fsp.rm(backup, { recursive: true, force: true });
    await fsp.mkdir(backup);
    try {
      for (const name of ENTRIES) {
        const current = path.join(paths.dataDir, name);
        if (fs.existsSync(current)) await move(current, path.join(backup, name));
      }
      for (const name of ENTRIES) await move(path.join(staging, name), path.join(paths.dataDir, name));
    } catch (err) {
      // Put the previous state back so the library is never left half-replaced.
      for (const name of ENTRIES) {
        const saved = path.join(backup, name);
        const current = path.join(paths.dataDir, name);
        if (fs.existsSync(saved)) {
          await fsp.rm(current, { recursive: true, force: true }).catch(() => {});
          await move(saved, current).catch(() => {});
        }
      }
      return { ok: false, error: `Import nicht möglich: ${err.message}` };
    }
    return { ok: true, counts: manifest.counts || countsOf(dbText), from: manifest.platform || '' };
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

module.exports = { exportPreset, importPreset };
