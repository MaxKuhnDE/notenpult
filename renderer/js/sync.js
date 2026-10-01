// Noten-Pool: a linked folder – typically in Google Drive for Desktop
// (X:\Meine Ablage\…). Its sheets are copied into the library, so they work
// offline; when the folder is reachable again, changed files are refreshed.

import {
  db, commit, backend, addPiece, addPart, pieceById, partNameFrom, deleteUnusedFiles, norm, uid, DEFAULT_SYNC,
  placeImported, importOrder,
} from './store.js';
import { countPages, isPdf } from './render.js';
import { toast, plural } from './ui.js';

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
const AUTO_SYNC_MS = 10 * 60 * 1000;

let pool = { ok: false, files: [], scannedAt: null, error: null };
let status = 'off'; // 'off' | 'idle' | 'syncing' | 'ok' | 'offline'
let running = null;
const listeners = new Set();

export const available = () => backend.kind === 'electron';
export const isLinked = () => !!db.sync.folder;
export const poolFiles = () => pool.files;
export const syncStatus = () => (isLinked() ? status : 'off');
export const lastScan = () => pool;

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setStatus(s) {
  status = s;
  for (const fn of listeners) fn(s);
}

export const dirOf = (rel) => {
  const i = rel.lastIndexOf('\\');
  return i < 0 ? '' : rel.slice(0, i);
};
export const baseOf = (rel) => {
  const name = rel.slice(rel.lastIndexOf('\\') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

export function matchesFilter(rel, filter = db.sync.filter) {
  const terms = String(filter || '').split(',').map((t) => norm(t.trim())).filter(Boolean);
  if (!terms.length) return true;
  const r = norm(rel);
  return terms.some((t) => r.includes(t));
}

/** The library piece a pool file was imported into, if any. */
export function pieceForPoolFile(rel) {
  const t = db.sync.files[rel];
  if (!t || t.ignored) return null;
  return pieceById(t.pieceId);
}

/** Copies one pool file into the library and returns its page refs. */
async function copyIn(file) {
  const [rec] = await backend.importPaths([file.abs]);
  if (!rec || rec.error) throw new Error(rec?.error || 'Datei nicht lesbar');
  let n;
  try {
    n = await countPages(rec.file);
  } catch (err) {
    await backend.deleteFiles([rec.file]);
    throw err;
  }
  const pages = isPdf(rec.file)
    ? Array.from({ length: n }, (_, i) => ({ file: rec.file, page: i + 1 }))
    : [{ file: rec.file, page: 0 }];
  return { rec, pages };
}

function track(file, rec, pieceId, partId) {
  db.sync.files[file.rel] = { size: file.size, mtime: file.mtime, file: rec.file, pieceId, partId };
}

/** Imports pool files as pieces – or, with the folder structure, as parts (Stimmen) of a folder piece. */
async function importPoolFiles(files) {
  const touched = new Set();
  const failed = [];
  const byFolder = db.sync.structure === 'folders';
  const ordered = [...files].sort((a, b) => collator.compare(dirOf(a.rel), dirOf(b.rel)) || importOrder(baseOf(a.rel), baseOf(b.rel)));
  for (const f of ordered) {
    try {
      const { rec, pages } = await copyIn(f);
      const dir = dirOf(f.rel);
      if (byFolder && dir) {
        const dirName = dir.slice(dir.lastIndexOf('\\') + 1);
        let piece = pieceById(db.sync.folders[dir]);
        if (!piece) {
          piece = addPiece({ title: dirName, pages, partName: partNameFrom(baseOf(f.rel), dirName, 1) });
          db.sync.folders[dir] = piece.id;
          track(f, rec, piece.id, piece.parts[0].id);
        } else {
          const part = addPart(piece, { name: partNameFrom(baseOf(f.rel), piece.title, piece.parts.length + 1), pages });
          track(f, rec, piece.id, part.id);
        }
        touched.add(piece.id);
      } else {
        // "Alte Kameraden - Flügelhorn 2.pdf" joins "Alte Kameraden" as another part.
        const { piece, part } = placeImported(baseOf(f.rel), pages);
        track(f, rec, piece.id, part.id);
        touched.add(piece.id);
      }
    } catch (err) {
      console.warn('Pool-Datei nicht übernommen', f.rel, err);
      failed.push(f);
    }
  }
  return { touched: [...touched], failed };
}

/** A pool file changed: replace the part's pages, keeping page ids (annotations) and rotation. */
async function refreshFile(f, t) {
  const piece = pieceById(t.pieceId);
  const part = piece?.parts.find((p) => p.id === t.partId);
  if (!part) {
    t.ignored = true;
    return false;
  }
  const { rec, pages } = await copyIn(f);
  const old = part.pages;
  part.pages = pages.map((pg, i) => ({
    id: old[i]?.id || uid(), file: pg.file, page: pg.page, ...(old[i]?.rot ? { rot: old[i].rot } : {}),
  }));
  track(f, rec, piece.id, part.id);
  await deleteUnusedFiles(old.map((p) => p.file));
  return true;
}

export function syncNow({ manual = false } = {}) {
  if (!available() || !isLinked()) return Promise.resolve(null);
  if (!running) running = run(manual).finally(() => { running = null; });
  return running;
}

async function run(manual) {
  setStatus('syncing');
  const folder = db.sync.folder;
  let res;
  try {
    res = await backend.poolScan(folder);
  } catch (err) {
    res = { ok: false, error: String(err.message || err), files: [] };
  }
  if (db.sync.folder !== folder) return null;
  res.files.sort((a, b) => collator.compare(a.rel, b.rel));
  pool = res;
  if (!res.ok) {
    setStatus('offline');
    if (manual) toast('Noten-Pool gerade nicht erreichbar – Notenpult nutzt die gespeicherten Kopien.', { kind: 'error', ms: 4500 });
    return null;
  }

  let updated = 0;
  let failed = 0;
  const byRel = new Map(res.files.map((f) => [f.rel, f]));
  for (const [rel, t] of Object.entries(db.sync.files)) {
    const f = byRel.get(rel);
    if (t.ignored || !f || (f.size === t.size && Math.abs(f.mtime - t.mtime) < 2000)) continue;
    try {
      if (await refreshFile(f, t)) updated++;
    } catch (err) {
      console.warn('Pool-Datei nicht aktualisiert', rel, err);
      failed++;
    }
  }

  let added = [];
  if (db.sync.mode === 'auto') {
    const fresh = res.files.filter((f) => !db.sync.files[f.rel] && matchesFilter(f.rel));
    const r = await importPoolFiles(fresh);
    added = r.touched;
    failed += r.failed.length;
  }

  db.sync.lastSync = Date.now();
  commit('sync');
  setStatus(failed ? 'offline' : 'ok');
  if (added.length || updated || manual) {
    const parts = [];
    if (added.length) parts.push(`${plural(added.length, 'neues Stück', 'neue Stücke')}`);
    if (updated) parts.push(`${updated} aktualisiert`);
    if (failed) parts.push(`${failed} nicht geladen (offline?)`);
    toast(`Noten-Pool: ${parts.length ? parts.join(', ') : 'alles aktuell'}`, { kind: failed ? 'error' : 'success', ms: 3500 });
  }
  return { added: added.length, updated, failed };
}

/** Loads one pool file (with structure 'folders': all matching files of its folder). Returns the piece id. */
export async function importFromPool(rel) {
  const existing = pieceForPoolFile(rel);
  if (existing) return existing.id;
  const f = pool.files.find((x) => x.rel === rel);
  if (!f) throw new Error('Datei nicht mehr im Noten-Pool');
  let files = [f];
  const dir = dirOf(rel);
  if (db.sync.structure === 'folders' && dir) {
    files = pool.files.filter((x) => dirOf(x.rel) === dir && !pieceForPoolFile(x.rel) && (x === f || matchesFilter(x.rel)));
  }
  for (const x of files) if (db.sync.files[x.rel]?.ignored) delete db.sync.files[x.rel];
  setStatus('syncing');
  const r = await importPoolFiles(files);
  commit('sync');
  setStatus(r.failed.length ? 'offline' : 'ok');
  const piece = pieceForPoolFile(rel);
  if (!piece) throw new Error('Datei konnte nicht geladen werden – ist Google Drive online?');
  return piece.id;
}

/** Scans a folder without linking it (for the setup dialog). */
export async function previewFolder(folder) {
  const res = await backend.poolScan(folder);
  res.files.sort((a, b) => collator.compare(a.rel, b.rel));
  return res;
}

export function link(folder, { mode, structure, filter }) {
  if (folder !== db.sync.folder) {
    // Tracking refers to paths in the old folder; pieces stay in the library.
    db.sync.files = {};
    db.sync.folders = {};
    db.sync.lastSync = null;
  }
  Object.assign(db.sync, { folder, mode, structure, filter });
  commit('settings');
  return syncNow({ manual: true });
}

export function unlink() {
  const { mode, structure, filter } = db.sync;
  db.sync = { ...structuredClone(DEFAULT_SYNC), mode, structure, filter };
  pool = { ok: false, files: [], scannedAt: null, error: null };
  commit('settings');
  setStatus('off');
}

export function startAutoSync() {
  if (!available()) return;
  status = isLinked() ? 'idle' : 'off';
  setTimeout(() => syncNow(), 2500);
  setInterval(() => syncNow(), AUTO_SYNC_MS);
  window.addEventListener('online', () => syncNow());
}
