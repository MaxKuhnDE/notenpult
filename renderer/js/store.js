// Data model + persistence. Works inside Electron (window.notenpult) and,
// as a fallback, in a plain browser using IndexedDB.

const native = window.notenpult || null;

export const DEFAULT_SETTINGS = {
  theme: 'system', // 'system' | 'light' | 'dark'
  invertSheets: false, // Noten im Dunkelmodus hell-auf-dunkel darstellen
  portraitLayout: 'auto', // 'auto' | 'two' | 'pair2' | 'single' | 'width'
  landscapeLayout: 'auto', // 'auto' | 'two' (immer zwei Seiten) | 'pair2' (nur 2-seitige Stücke) | 'single' | 'width'
  autoCrop: true, // weiße Ränder automatisch abschneiden
  leftZoneBack: false, // Tippen auf linkes Viertel blättert zurück
  penAlwaysDraws: true, // Stift schreibt immer, Finger/Maus blättern
  penWidth: 'medium', // 'fine' | 'medium' | 'bold'
  showNextHint: true,
  tensBlocks: true,
  autoUpdateCheck: true, // beim Start nach einer neuen Version suchen
};

export const DEFAULT_SYNC = {
  folder: null, // linked pool folder, e.g. X:\Meine Ablage\Noten
  mode: 'auto', // 'auto' = alles übernehmen | 'manual' = nur über die Suche
  structure: 'files', // 'files' = Datei = Stück | 'folders' = Unterordner = Stück, Dateien = Stimmen
  filter: '', // optional: nur Dateien, deren Pfad einen dieser Begriffe enthält (Komma-getrennt)
  lastSync: null,
  files: {}, // rel path -> { size, mtime, file, pieceId, partId, ignored? }
  folders: {}, // rel dir -> pieceId (structure 'folders')
};

/*
 * piece: { id, title, part (active part index), addedAt, genres: ['Marsch', …],
 *          parts: [{ id, name, pages: [{ id, file, page, rot?, crop? }] }] }
 * genres: [{ name }] – the user's own genre list (shown as #hashtags)
 */
export const db = {
  pieces: [],
  setlists: [],
  genres: [],
  settings: { ...DEFAULT_SETTINGS },
  sync: structuredClone(DEFAULT_SYNC),
  ui: { mode: 'setlists', setlistId: null },
};

// ---------- backends ----------

const electronBackend = {
  kind: 'electron',
  async loadDb() {
    const text = await native.loadDb();
    return text ? JSON.parse(text) : null;
  },
  saveDb: (obj) => native.saveDb(JSON.stringify(obj)),
  async loadAnn(id) {
    const text = await native.loadAnnotations(id);
    return text ? JSON.parse(text) : null;
  },
  saveAnn: (id, obj) => native.saveAnnotations(id, JSON.stringify(obj)),
  deleteAnn: (id) => native.deleteAnnotations(id),
  async pick({ folder = false } = {}) {
    const paths = await native.pickFiles({ folder });
    return paths.length ? native.importFiles(paths) : [];
  },
  async importDropped(files) {
    const paths = [...files].map((f) => native.pathForFile(f)).filter(Boolean);
    return paths.length ? native.importFiles(paths) : [];
  },
  fileUrl: (name) => `app://notenpult/library/${encodeURIComponent(name)}`,
  async readFile(name) {
    const res = await fetch(electronBackend.fileUrl(name));
    if (!res.ok) throw new Error(`Datei fehlt: ${name}`);
    return res.arrayBuffer();
  },
  deleteFiles: (names) => native.deleteFiles(names),
  importPaths: (paths) => native.importFiles(paths),
  pickFolder: (opts) => native.pickFolder(opts),
  poolScan: (folder) => native.poolScan(folder),
  detectGoogleDrive: () => native.detectGoogleDrive(),
  updateCheck: () => native.updateCheck(),
  updateInstall: () => native.updateInstall(),
  onUpdateProgress: (cb) => native.onUpdateProgress(cb),
  openDataDir: () => native.openDataDir(),
  info: () => native.info(),
  setFullscreen: (on) => native.setFullscreen(on),
  isFullscreen: () => native.isFullscreen(),
  onFullscreenChange: (cb) => native.onFullscreenChange(cb),
  keepAwake: (on) => native.keepAwake(on),
  setTheme: (mode) => native.setTheme(mode),
};

let idbPromise = null;
function idb() {
  idbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('notenpult', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idbPromise;
}
async function idbOp(store, mode, fn) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const SUPPORTED = /\.(pdf|jpe?g|png|webp)$/i;

async function storeBrowserFiles(files) {
  const records = [];
  for (const f of [...files].filter((x) => SUPPORTED.test(x.name))) {
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    const file = `${uid()}${ext}`;
    await idbOp('files', 'readwrite', (s) => s.put(f, file));
    records.push({ file, name: f.name.slice(0, f.name.lastIndexOf('.')), ext });
  }
  records.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  return records;
}

let wakeLock = null;
const webBackend = {
  kind: 'web',
  loadDb: () => idbOp('kv', 'readonly', (s) => s.get('db')).then((v) => v || null),
  saveDb: (obj) => idbOp('kv', 'readwrite', (s) => s.put(structuredClone(obj), 'db')),
  loadAnn: (id) => idbOp('kv', 'readonly', (s) => s.get(`ann:${id}`)).then((v) => v || null),
  saveAnn: (id, obj) => idbOp('kv', 'readwrite', (s) => s.put(structuredClone(obj), `ann:${id}`)),
  deleteAnn: (id) => idbOp('kv', 'readwrite', (s) => s.delete(`ann:${id}`)),
  pick({ folder = false } = {}) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      if (folder) input.webkitdirectory = true;
      else input.accept = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*';
      input.onchange = () => resolve(storeBrowserFiles(input.files || []));
      input.oncancel = () => resolve([]);
      input.click();
    });
  },
  importDropped: (files) => storeBrowserFiles(files),
  fileUrl: () => null,
  async readFile(name) {
    const blob = await idbOp('files', 'readonly', (s) => s.get(name));
    if (!blob) throw new Error(`Datei fehlt: ${name}`);
    return blob.arrayBuffer();
  },
  deleteFiles: (names) => Promise.all(names.map((n) => idbOp('files', 'readwrite', (s) => s.delete(n)))),
  importPaths: async () => [],
  pickFolder: async () => null,
  poolScan: async (folder) => ({ ok: false, error: 'Im Browser nicht verfügbar', folder, files: [] }),
  detectGoogleDrive: async () => null,
  updateCheck: async () => ({ ok: false, error: 'Updates gibt es nur in der Windows-App.' }),
  updateInstall: async () => { throw new Error('Updates gibt es nur in der Windows-App.'); },
  onUpdateProgress: () => () => {},
  openDataDir: async () => {},
  info: async () => ({ dataDir: 'Browser-Speicher (IndexedDB)', version: 'web', packaged: false }),
  async setFullscreen(on) {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    if (!on && document.fullscreenElement) await document.exitFullscreen?.();
    return !!document.fullscreenElement;
  },
  isFullscreen: async () => !!document.fullscreenElement,
  onFullscreenChange: (cb) => document.addEventListener('fullscreenchange', () => cb(!!document.fullscreenElement)),
  async keepAwake(on) {
    try {
      if (on && !wakeLock) wakeLock = await navigator.wakeLock?.request('screen');
      if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch { /* not supported */ }
  },
  setTheme: async () => {},
};

export const backend = native ? electronBackend : webBackend;

// ---------- change notification + saving ----------

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let saveQueued = false;
let saveChain = Promise.resolve();
function queueSave() {
  if (saveQueued) return;
  saveQueued = true;
  queueMicrotask(() => {
    saveQueued = false;
    const snapshot = {
      version: 2,
      pieces: db.pieces,
      setlists: db.setlists,
      genres: db.genres,
      settings: db.settings,
      sync: db.sync,
      ui: db.ui,
    };
    saveChain = saveChain
      .then(() => backend.saveDb(snapshot))
      .catch((err) => console.error('Speichern fehlgeschlagen', err));
  });
}

/** Call after every mutation: persists and re-renders subscribers. */
export function commit(what = 'data') {
  queueSave();
  for (const fn of listeners) fn(what);
}

/** Saves without re-rendering (for cached values like detected page margins). */
let persistTimer = null;
export function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(queueSave, 1500);
}

/** Version 1 stored pages directly on the piece; now every piece has parts (Stimmen). */
function migratePiece(p) {
  if (!Array.isArray(p.parts)) {
    p.parts = [{ id: uid(), name: '1. Stimme', pages: Array.isArray(p.pages) ? p.pages : [] }];
    delete p.pages;
  }
  if (!p.parts.length) p.parts.push({ id: uid(), name: '1. Stimme', pages: [] });
  p.part = Math.min(Math.max(0, p.part || 0), p.parts.length - 1);
  if (!Array.isArray(p.genres)) p.genres = [];
  return p;
}

export async function init() {
  const saved = await backend.loadDb();
  if (saved) {
    db.pieces = (Array.isArray(saved.pieces) ? saved.pieces : []).map(migratePiece);
    db.setlists = Array.isArray(saved.setlists) ? saved.setlists : [];
    db.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
    // In 1.0, 'two' was the default landscape view; from 1.1 on 'auto' does that job better.
    // ('two' is again a valid choice since 1.2: always two pages.)
    if ((saved.version || 1) < 2) {
      for (const k of ['portraitLayout', 'landscapeLayout']) {
        if (db.settings[k] === 'two') db.settings[k] = 'auto';
      }
    }
    db.sync = { ...structuredClone(DEFAULT_SYNC), ...(saved.sync || {}) };
    db.ui = { ...db.ui, ...(saved.ui || {}) };
    db.genres = Array.isArray(saved.genres) ? saved.genres.filter((g) => g && cleanGenre(g.name)) : [];
    // Every genre used on a piece must exist in the list.
    for (const p of db.pieces) for (const g of p.genres) addGenre(g);
  }
}

// ---------- genres (#hashtags) ----------

export function cleanGenre(name) {
  return String(name || '').replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function findGenre(name) {
  const n = norm(cleanGenre(name));
  return n ? db.genres.find((g) => norm(g.name) === n) || null : null;
}

/** Sorted list of genre names. */
export function genreNames() {
  return db.genres.map((g) => g.name).sort((a, b) => collator.compare(a, b));
}

/** Creates a genre (or returns the existing one with the same name). */
export function addGenre(name) {
  const clean = cleanGenre(name);
  if (!clean) return null;
  const existing = findGenre(clean);
  if (existing) return existing;
  const g = { name: clean };
  db.genres.push(g);
  return g;
}

export const genresOf = (piece) => piece.genres || [];
export const hasGenre = (piece, name) => genresOf(piece).some((g) => norm(g) === norm(name));
export const genreCount = (name) => db.pieces.filter((p) => hasGenre(p, name)).length;

export function setPieceGenre(piece, name, on) {
  const g = addGenre(name);
  if (!g) return;
  const rest = genresOf(piece).filter((x) => norm(x) !== norm(g.name));
  piece.genres = on ? [...rest, g.name].sort((a, b) => collator.compare(a, b)) : rest;
}

/** Renames a genre everywhere; renaming onto an existing genre merges both. */
export function renameGenre(oldName, newName) {
  const from = findGenre(oldName);
  const clean = cleanGenre(newName);
  if (!from || !clean) return;
  const target = findGenre(clean);
  if (target && target !== from) db.genres = db.genres.filter((g) => g !== from);
  else from.name = clean;
  const finalName = (target || from).name;
  for (const p of db.pieces) {
    if (hasGenre(p, oldName)) {
      p.genres = genresOf(p).filter((x) => norm(x) !== norm(oldName) && norm(x) !== norm(finalName));
      p.genres.push(finalName);
      p.genres.sort((a, b) => collator.compare(a, b));
    }
  }
}

export function deleteGenre(name) {
  db.genres = db.genres.filter((g) => norm(g.name) !== norm(name));
  for (const p of db.pieces) p.genres = genresOf(p).filter((x) => norm(x) !== norm(name));
}

// ---------- helpers ----------

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
export const compareTitles = (a, b) => collator.compare(a.title, b.title);

/** Lower-case, without accents – for searching. */
export function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase();
}

export function letterOf(title) {
  const ch = (title || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
}

export function cleanTitle(name) {
  return String(name || '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Ohne Titel';
}

/** Natural compare for setlist numbers; empty numbers sort last. */
export function compareNumbers(a, b) {
  const ea = !a && a !== 0;
  const eb = !b && b !== 0;
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  return collator.compare(String(a), String(b));
}

export function numberValue(nr) {
  const m = /^\s*(\d+)/.exec(String(nr ?? ''));
  return m ? parseInt(m[1], 10) : null;
}

// ---------- pieces ----------

export const pieceById = (id) => db.pieces.find((p) => p.id === id) || null;

export function sortedPieces() {
  return [...db.pieces].sort(compareTitles);
}

const newPages = (pages) => pages.map((p) => ({ id: p.id || uid(), file: p.file, page: p.page, ...(p.rot ? { rot: p.rot } : {}) }));

export function addPiece({ title, pages, partName = '1. Stimme' }) {
  const piece = {
    id: uid(),
    title: cleanTitle(title),
    parts: [{ id: uid(), name: partName, pages: newPages(pages) }],
    part: 0,
    genres: [],
    addedAt: Date.now(),
  };
  db.pieces.push(piece);
  return piece;
}

export function addPart(piece, { name, pages }) {
  const part = { id: uid(), name: name || `${piece.parts.length + 1}. Stimme`, pages: newPages(pages) };
  piece.parts.push(part);
  return part;
}

export function activePart(piece) {
  return piece.parts[Math.min(piece.part || 0, piece.parts.length - 1)];
}

/** Pages of the part (Stimme) currently selected for this piece. */
export function pagesOf(piece) {
  return activePart(piece).pages;
}

export function allPages(piece) {
  return piece.parts.flatMap((p) => p.pages);
}

/**
 * Name for a linked part: "Florentiner Marsch - Flügelhorn 2" in piece
 * "Florentiner Marsch" becomes "Flügelhorn 2"; otherwise "N. Stimme".
 */
export function partNameFrom(fileName, pieceTitle, index) {
  const name = cleanTitle(fileName);
  const t = norm(pieceTitle);
  let rest = name;
  if (t && norm(name).startsWith(t)) rest = name.slice(pieceTitle.length);
  rest = rest.replace(/^[\s\-_.,:()]+/, '').trim();
  if (!rest || norm(rest) === t) return `${index}. Stimme`;
  return rest;
}

// Words that mark the end of a file name as a part, e.g. "… - 2. Stimme", "… - Flügelhorn 1".
const PART_WORDS = /stimme|\bst\.|flgh|fl[uü]gelhorn|\btrp|trompete|klar(inette)?\b|\bpos(aune)?\b|tuba|bass|bariton|euphonium|tenor|horn|fl[oö]te|piccolo|oboe|fagott|\bsax|schlagzeug|drums|percussion|direktion|partitur|\bin (b|es|f|c)\b/i;

/** "Alte Kameraden - Flügelhorn 1" -> { title: 'Alte Kameraden', part: 'Flügelhorn 1' }; otherwise part = null. */
export function splitTitlePart(name) {
  const clean = cleanTitle(name);
  const m = /^(.*\S)\s+[-–—]\s+(\S.*)$/.exec(clean);
  if (m && PART_WORDS.test(m[2])) return { title: m[1], part: m[2] };
  return { title: clean, part: null };
}

export function findPieceByTitle(title) {
  const t = norm(cleanTitle(title));
  return db.pieces.find((p) => norm(p.title) === t) || null;
}

/**
 * Adds an imported file as a new piece – or, if its name ends in a part
 * ("… - 2. Stimme") and that piece exists, as another part of it.
 */
export function placeImported(name, pages) {
  const { title, part } = splitTitlePart(name);
  const existing = part ? findPieceByTitle(title) : null;
  if (existing) return { piece: existing, part: addPart(existing, { name: part, pages }), linked: true };
  const piece = addPiece({ title, pages, partName: part || '1. Stimme' });
  return { piece, part: piece.parts[0], linked: false };
}

/** Sort import names so "X.pdf" comes before "X - 2. Stimme.pdf" (the plain one becomes the piece). */
export function importOrder(a, b) {
  const sa = splitTitlePart(a);
  const sb = splitTitlePart(b);
  return collator.compare(sa.title, sb.title) || (sa.part ? 1 : 0) - (sb.part ? 1 : 0) || collator.compare(a, b);
}

export function setlistsContaining(pieceId) {
  return db.setlists.filter((s) => s.entries.some((e) => e.pieceId === pieceId));
}

/** Stops Drive sync from re-importing parts the user removed locally. */
export function ignoreSynced(predicate) {
  for (const t of Object.values(db.sync.files)) if (!t.ignored && predicate(t)) t.ignored = true;
}

/** Removes a piece, its setlist entries, annotations and unreferenced files. */
export async function deletePiece(pieceId) {
  const piece = pieceById(pieceId);
  if (!piece) return;
  db.pieces = db.pieces.filter((p) => p.id !== pieceId);
  for (const s of db.setlists) s.entries = s.entries.filter((e) => e.pieceId !== pieceId);
  ignoreSynced((t) => t.pieceId === pieceId);
  commit();
  await backend.deleteAnn(pieceId).catch(() => {});
  await deleteUnusedFiles(allPages(piece).map((p) => p.file));
}

export async function deleteUnusedFiles(candidates) {
  const used = new Set(db.pieces.flatMap((p) => allPages(p).map((pg) => pg.file)));
  const unused = [...new Set(candidates)].filter((f) => !used.has(f));
  if (unused.length) await backend.deleteFiles(unused).catch(() => {});
}

// ---------- setlists ----------

export const setlistById = (id) => db.setlists.find((s) => s.id === id) || null;

export function createSetlist(name) {
  const s = { id: uid(), name: name || 'Neue Setlist', entries: [], createdAt: Date.now() };
  db.setlists.push(s);
  return s;
}

export function duplicateSetlist(id) {
  const src = setlistById(id);
  if (!src) return null;
  const copy = {
    id: uid(),
    name: `${src.name} (Kopie)`,
    entries: src.entries.map((e) => ({ ...e, id: uid() })),
    createdAt: Date.now(),
  };
  db.setlists.splice(db.setlists.indexOf(src) + 1, 0, copy);
  return copy;
}

export function addToSetlist(setlistId, pieceIds, startNumber = null) {
  const s = setlistById(setlistId);
  if (!s) return;
  let n = numberValue(startNumber);
  for (const pieceId of pieceIds) {
    s.entries.push({ id: uid(), pieceId, number: n === null ? '' : String(n) });
    if (n !== null) n += 1;
  }
}

export function sortSetlistByNumber(setlistId) {
  const s = setlistById(setlistId);
  if (!s) return;
  const idx = new Map(s.entries.map((e, i) => [e.id, i]));
  s.entries.sort((a, b) => compareNumbers(a.number, b.number) || idx.get(a.id) - idx.get(b.id));
}

/** Moves all parts of `fromId` into piece `toId` (linking e.g. "2. Stimme" files). */
export function mergePieces(toId, fromId) {
  const to = pieceById(toId);
  const from = pieceById(fromId);
  if (!to || !from || to === from) return [];
  const single = from.parts.length === 1;
  const moved = from.parts.map((p, i) => ({
    ...p,
    name: single ? partNameFrom(from.title, to.title, to.parts.length + 1 + i) : p.name,
  }));
  to.parts.push(...moved);
  for (const g of genresOf(from)) setPieceGenre(to, g, true);
  for (const s of db.setlists) {
    const hasTarget = s.entries.some((e) => e.pieceId === toId);
    if (hasTarget) s.entries = s.entries.filter((e) => e.pieceId !== fromId);
    else for (const e of s.entries) if (e.pieceId === fromId) e.pieceId = toId;
  }
  for (const t of Object.values(db.sync.files)) if (t.pieceId === fromId) t.pieceId = toId;
  for (const [dir, id] of Object.entries(db.sync.folders)) if (id === fromId) db.sync.folders[dir] = toId;
  db.pieces = db.pieces.filter((p) => p.id !== fromId);
  return moved.flatMap((p) => p.pages.map((pg) => pg.id));
}

/** Setlist entries whose piece still exists, in order. */
export function setlistQueue(s) {
  return s.entries
    .map((e) => ({ entryId: e.id, pieceId: e.pieceId, number: e.number || '' }))
    .filter((q) => pieceById(q.pieceId));
}
