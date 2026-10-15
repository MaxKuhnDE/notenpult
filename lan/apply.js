'use strict';

// Receiver: writes what came over the network (also android/…/LanApply.java).
// The new library and annotations were put together in the page (renderer/js/lan-plan.js);
// the sheet files are already downloaded. Before anything is replaced, the previous library
// and annotations go to _vor-abgleich; in "mirror" mode sheet files no longer used are moved
// there as well instead of being deleted.

const fs = require('fs');
const path = require('path');
const { SAFE_FILE, SAFE_ID } = require('./protocol');

const fsp = fs.promises;

async function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, file);
}

/**
 * paths: { dataDir, dbFile, filesDir, annDir }
 * db: library JSON text; ann: { pieceId: annotations JSON text }; keep: sheet files the new
 * library uses; mode: 'mirror' (replace everything) | 'add' (keep other pieces).
 */
async function applyReceive(paths, {
  db, ann = {}, keep = [], mode,
}) {
  JSON.parse(db); // never write a broken library
  // Everything the new library needs must be here before anything changes.
  for (const f of keep) {
    if (!SAFE_FILE.test(f) || !fs.existsSync(path.join(paths.filesDir, f))) throw new Error(`Notendatei fehlt: ${f}`);
  }
  const backup = path.join(paths.dataDir, '_vor-abgleich');
  await fsp.rm(backup, { recursive: true, force: true });
  await fsp.mkdir(path.join(backup, 'Anmerkungen'), { recursive: true });
  await fsp.mkdir(path.join(backup, 'Noten'), { recursive: true });
  await fsp.mkdir(paths.annDir, { recursive: true });
  await fsp.mkdir(paths.filesDir, { recursive: true });
  await fsp.copyFile(paths.dbFile, path.join(backup, 'notenpult.json')).catch(() => {});
  for (const f of await fsp.readdir(paths.annDir)) {
    await fsp.copyFile(path.join(paths.annDir, f), path.join(backup, 'Anmerkungen', f)).catch(() => {});
  }

  if (mode === 'mirror') {
    const keepSet = new Set(keep);
    for (const f of await fsp.readdir(paths.filesDir)) {
      if (!keepSet.has(f)) await fsp.rename(path.join(paths.filesDir, f), path.join(backup, 'Noten', f)).catch(() => {});
    }
    for (const f of await fsp.readdir(paths.annDir)) {
      if (!Object.prototype.hasOwnProperty.call(ann, f.replace(/\.json$/, ''))) await fsp.rm(path.join(paths.annDir, f), { force: true });
    }
  }
  for (const [id, text] of Object.entries(ann)) {
    if (SAFE_ID.test(id)) await writeAtomic(path.join(paths.annDir, `${id}.json`), String(text));
  }
  await writeAtomic(paths.dbFile, db);
}

/** Sheet files present here, { name: size }. */
async function localFiles(filesDir) {
  const out = {};
  for (const f of await fsp.readdir(filesDir).catch(() => [])) {
    if (!SAFE_FILE.test(f)) continue;
    const st = await fsp.stat(path.join(filesDir, f)).catch(() => null);
    if (st && st.isFile()) out[f] = st.size;
  }
  return out;
}

module.exports = { applyReceive, localFiles };
