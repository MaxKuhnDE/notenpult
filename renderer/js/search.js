// Search across the library (titles + part names), setlist numbers, setlists
// and the Noten-Pool (linked Google Drive folder, also files not yet loaded).

import { db, pieceById, norm, compareTitles, pagesOf } from './store.js';
import { h, icon, modal, toast, plural } from './ui.js';
import * as sync from './sync.js';

export const tokens = (q) => norm(q).split(/\s+/).filter(Boolean);

/** 0 = no match; higher = better (word starts count more than inner matches). */
function score(hay, toks) {
  let s = 0;
  for (const t of toks) {
    const i = hay.indexOf(t);
    if (i < 0) return 0;
    s += i === 0 ? 3 : /[\s\-_/\\.(,]/.test(hay[i - 1]) ? 2 : 1;
  }
  return s;
}

export function searchPieces(q) {
  const toks = tokens(q);
  if (!toks.length) return [];
  return db.pieces
    .map((p) => {
      const title = norm(p.title);
      const hay = `${title} ${norm(p.parts.map((x) => x.name).join(' '))}`;
      const s = score(hay, toks);
      return { p, s: s ? s + (score(title, toks) ? 3 : 0) : 0 };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || compareTitles(a.p, b.p))
    .map((x) => x.p);
}

/** Pool files not yet in the library. */
export function searchPool(q, limit = 60) {
  const toks = tokens(q);
  if (!toks.length) return [];
  return sync.poolFiles()
    .filter((f) => !sync.pieceForPoolFile(f.rel))
    .map((f) => {
      const s = score(norm(f.rel), toks);
      // Files matching the instrument filter (e.g. "Flügelhorn 1") rank first.
      return { f, s: s && s + (sync.matchesFilter(f.rel) ? 2 : 0) };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.f);
}

function numberHits(q) {
  const n = q.trim();
  if (!/^\d+[a-z]?$/i.test(n)) return [];
  return db.setlists.flatMap((s) => s.entries
    .filter((e) => String(e.number).toLowerCase() === n.toLowerCase() && pieceById(e.pieceId))
    .map((e) => ({ s, e })));
}

/** Row for a pool file with a "Laden" button. */
export function poolRow(f, onLoaded) {
  const dir = sync.dirOf(f.rel);
  const button = h('button.btn.small-btn', {
    type: 'button',
    onclick: async (ev) => {
      ev.stopPropagation();
      button.disabled = true;
      button.querySelector('span').textContent = 'Lädt …';
      try {
        const id = await sync.importFromPool(f.rel);
        onLoaded(id);
      } catch (err) {
        toast(err.message, { kind: 'error', ms: 4500 });
        button.disabled = false;
        button.querySelector('span').textContent = 'Laden';
      }
    },
  }, icon('import'), h('span', null, 'Laden'));
  return h('div.pool-row', null,
    h('span.pool-icon', null, icon('cloud')),
    h('span.pool-text', null,
      h('span.pool-name', null, sync.baseOf(f.rel)),
      dir ? h('span.pool-dir', null, dir.split('\\').join(' › ')) : null),
    button);
}

/**
 * opts: { onPiece(id), onEntry(setlist, entry), onSetlist?(setlist), title }
 */
export function openSearch(opts) {
  const input = h('input.search-input.big', {
    type: 'search',
    placeholder: 'Titel, Stimme, Nr. oder Datei im Noten-Pool …',
    autofocus: true,
    'data-select-all': 'false',
  });
  const results = h('div.search-results');
  let first = null;

  const section = (label, rows) => (rows.length ? [h('div.search-head', null, label), ...rows] : []);

  const render = () => {
    const q = input.value;
    first = null;
    if (!q.trim()) {
      const hint = [h('p.muted.search-hint', null, 'Tippe einen Teil des Titels, einer Stimme oder eine Nummer aus einer Setlist.')];
      if (sync.isLinked()) hint.push(h('p.muted.search-hint', null, `Auch ${plural(sync.poolFiles().length, 'Datei', 'Dateien')} im Noten-Pool werden durchsucht.`));
      results.replaceChildren(...hint);
      return;
    }
    const pick = (fn) => () => {
      m.close();
      fn();
    };
    const nums = numberHits(q).map(({ s, e }) => {
      const piece = pieceById(e.pieceId);
      const go = pick(() => opts.onEntry(s, e));
      first ??= go;
      return h('button.search-item', { type: 'button', onclick: go },
        h('span.search-nr', null, e.number),
        h('span.search-text', null, h('span.search-title', null, piece.title), h('span.search-meta', null, s.name)));
    });
    const pieces = searchPieces(q).slice(0, 40).map((p) => {
      const go = pick(() => opts.onPiece(p.id));
      first ??= go;
      const entries = db.setlists.flatMap((s) => s.entries.filter((e) => e.pieceId === p.id && e.number).map((e) => `Nr. ${e.number} (${s.name})`));
      const meta = [plural(pagesOf(p).length, 'Seite', 'Seiten')];
      if (p.parts.length > 1) meta.push(p.parts.map((x) => x.name).join(', '));
      if (entries.length) meta.push(entries.slice(0, 2).join(', '));
      return h('button.search-item', { type: 'button', onclick: go },
        h('span.search-icon', null, icon(p.parts.length > 1 ? 'layers' : 'music')),
        h('span.search-text', null, h('span.search-title', null, p.title), h('span.search-meta', null, meta.join(' · '))));
    });
    const lists = opts.onSetlist
      ? db.setlists.filter((s) => score(norm(s.name), tokens(q))).map((s) => h('button.search-item', { type: 'button', onclick: pick(() => opts.onSetlist(s)) },
        h('span.search-icon', null, icon('list')),
        h('span.search-text', null, h('span.search-title', null, s.name), h('span.search-meta', null, plural(s.entries.length, 'Stück', 'Stücke')))))
      : [];
    const poolHits = sync.isLinked()
      ? searchPool(q).map((f) => poolRow(f, (id) => {
        m.close();
        toast(`„${pieceById(id)?.title}“ geladen und offline gespeichert`, { kind: 'success' });
        opts.onPiece(id);
      }))
      : [];
    const all = [
      ...section('Nummern in Setlists', nums),
      ...section('Bibliothek', pieces),
      ...section('Setlists', lists),
      ...section(`Im Noten-Pool${sync.syncStatus() === 'offline' ? ' (offline – nur bereits geladene Dateien verfügbar)' : ''}`, poolHits),
    ];
    results.replaceChildren(...(all.length ? all : [h('p.muted.search-hint', null, `Nichts gefunden für „${q.trim()}“.`)]));
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && first) {
      e.preventDefault();
      first();
    }
  });
  const m = modal({
    title: opts.title || 'Suchen',
    className: 'search-modal',
    body: h('div.search-panel', null, h('label.search.wide', null, icon('search'), input), results),
  });
  render();
}
