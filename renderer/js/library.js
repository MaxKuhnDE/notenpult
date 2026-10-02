// "A–Z" mode: all pieces alphabetically, grouped by first letter.
// Tapping the icon in front of a piece selects it; with a selection, many pieces can be
// deleted or added to a setlist at once.

import {
  db, backend, sortedPieces, letterOf, setlistsContaining, deletePiece, deletePieces, pagesOf, pieceById,
} from './store.js';
import {
  h, icon, iconBtn, btn, popMenu, plural, preserveFocus, toast, confirmDialog,
} from './ui.js';
import * as ink from './ink.js';
import { importFromPicker } from './importer.js';
import { openPieceEditor, confirmDeletePiece } from './editor.js';
import { openAddToSetlist } from './setlists.js';
import { openViewer } from './viewer.js';
import { searchPieces, searchPool, poolRow } from './search.js';
import { openPoolSetup } from './settings.js';
import { presetsAvailable, importAll } from './presets.js';
import * as sync from './sync.js';
import {
  genreFilterBar, genreTags, matchesGenres, openGenreManager, openGenrePicker,
} from './genres.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
let search = '';
const genreFilter = new Set(); // OR filter by genre names

// Selection survives re-renders (every change re-renders the list) until it is ended.
let selecting = false;
const selected = new Set(); // piece ids
let anchor = null; // last picked piece – Shift+click selects the range up to here

/** Leaves selection mode (Esc, Android back button, other tab); true if it was active. */
export function endSelection() {
  if (!selecting) return false;
  selecting = false;
  selected.clear();
  anchor = null;
  return true;
}

/** Shows the A–Z list filtered to one genre (used by the global search). */
export function showGenre(name) {
  genreFilter.clear();
  genreFilter.add(name);
  search = '';
}

export function renderLibrary(container) {
  const prevList = container.querySelector('.lib-list');
  const scrollTop = prevList ? prevList.scrollTop : 0;
  preserveFocus(container, () => container.replaceChildren(build()));
  const list = container.querySelector('.lib-list');
  if (list) list.scrollTop = scrollTop;
}

function emptyState() {
  const onAndroid = backend.kind === 'android';
  return h('div.empty-state', null,
    h('div.empty-icon', null, icon('music')),
    h('h2', null, 'Noch keine Noten'),
    h('p', null, onAndroid
      ? 'Übernimm alles vom PC: dort unter Einstellungen → „Alles exportieren“ eine ZIP-Datei erstellen, per USB auf das Tablet (Ordner „Download“) kopieren und hier importieren.'
      : 'Importiere deine Noten als PDF oder Bild (JPG, PNG). Jede Datei wird ein Stück – mehrseitige PDFs bleiben zusammen.'),
    h('div.empty-actions', null,
      onAndroid ? btn('Export vom PC importieren', importAll, { icon: 'tablet', kind: 'primary' }) : null,
      btn('Noten importieren', () => importFromPicker(), { icon: 'import', kind: onAndroid ? '' : 'primary' }),
      onAndroid ? null : btn('Ganzen Ordner importieren', () => importFromPicker({ folder: true }), { icon: 'folder' }),
      sync.available() && !sync.isLinked()
        ? btn('Google Drive verbinden', () => openPoolSetup(), { icon: 'cloud' })
        : null,
      !onAndroid && presetsAvailable() ? btn('Export-Datei importieren', importAll, { icon: 'tablet' }) : null),
    h('p.muted.small', null, sync.isLinked()
      ? 'Der Noten-Pool ist verbunden – über die Suche oben findest und lädst du einzelne Stücke.'
      : onAndroid ? 'Einzelne PDFs oder Bilder gehen auch über „Noten importieren“.' : 'Tipp: Du kannst Dateien auch einfach in dieses Fenster ziehen.'));
}

function build() {
  if (!db.pieces.length) return h('div.lib', null, emptyState());

  const list = h('div.lib-list');
  const rail = h('nav.alpha-rail', { 'aria-label': 'Buchstaben' });
  const searchInput = h('input.search-input', {
    type: 'search',
    placeholder: sync.isLinked() ? 'Stück suchen – auch im Noten-Pool …' : 'Stück oder Stimme suchen …',
    value: search,
    'data-fkey': 'lib-search',
    'data-select-all': 'false',
    oninput: () => {
      search = searchInput.value;
      update();
      list.scrollTop = 0;
    },
  });

  const toolbar = h('div.toolbar', null,
    h('label.search', null, icon('search'), searchInput),
    h('div.spacer'),
    btn('Auswählen', () => {
      selecting = true;
      update();
    }, { icon: 'check', kind: 'ghost', title: 'Mehrere Stücke auswählen – oder einfach vorne auf das Symbol tippen' }),
    btn('Genres', openGenreManager, { icon: 'hash', kind: 'ghost', title: 'Genres anlegen, umbenennen, zuordnen' }),
    btn('Ordner', () => importFromPicker({ folder: true }), { icon: 'folder', title: 'Ganzen Ordner importieren' }),
    btn('Noten importieren', () => importFromPicker(), { icon: 'import', kind: 'primary' }));

  let shown = []; // pieces in the list, in display order

  const pick = (piece, range) => {
    selecting = true;
    const a = range && anchor ? shown.findIndex((p) => p.id === anchor) : -1;
    const b = shown.indexOf(piece);
    if (a >= 0 && b >= 0) {
      for (const p of shown.slice(Math.min(a, b), Math.max(a, b) + 1)) selected.add(p.id);
    } else if (selected.has(piece.id)) {
      selected.delete(piece.id);
    } else {
      selected.add(piece.id);
    }
    anchor = piece.id;
    update();
  };
  const pickAll = (pieces) => {
    selecting = true;
    const all = pieces.every((p) => selected.has(p.id));
    for (const p of pieces) {
      if (all) selected.delete(p.id);
      else selected.add(p.id);
    }
    update();
  };

  function fill() {
    const q = search.trim();
    const hits = q ? new Set(searchPieces(q)) : null;
    const pieces = sortedPieces().filter((p) => (!hits || hits.has(p)) && matchesGenres(p, genreFilter));
    shown = pieces;
    for (const id of selected) if (!pieceById(id)) selected.delete(id);
    const groups = new Map();
    for (const p of pieces) {
      const L = letterOf(p.title);
      if (!groups.has(L)) groups.set(L, []);
      groups.get(L).push(p);
    }
    const queue = pieces.map((p) => ({ pieceId: p.id, number: '' }));
    const play = (piece) => openViewer({
      queue,
      start: pieces.indexOf(piece),
      context: { kind: 'library', name: 'A–Z' },
    });

    const sections = [];
    for (const L of LETTERS) {
      const items = groups.get(L);
      if (!items) continue;
      const allIn = items.every((p) => selected.has(p.id));
      sections.push(h('section.letter-group', { dataset: { letter: L } },
        h('h3.letter-head', null, L, selecting
          ? h('button.letter-pick', { type: 'button', onclick: () => pickAll(items) },
            allIn ? `${L} abwählen` : `Alle mit ${L} (${items.length})`)
          : null),
        items.map((p) => pieceRow(p, play, pick))));
    }
    const poolHits = q && sync.isLinked() ? searchPool(q, 40) : [];
    if (!sections.length && !poolHits.length) {
      const what = [q && `„${q}“`, genreFilter.size && [...genreFilter].map((g) => `#${g}`).join(' oder ')].filter(Boolean).join(' mit ');
      sections.push(h('div.no-results', null, `Keine Treffer für ${what}.`));
    }
    if (poolHits.length) {
      sections.push(h('section.letter-group.pool-group', null,
        h('h3.letter-head', null, `Im Noten-Pool – noch nicht geladen (${poolHits.length})`),
        poolHits.map((f) => poolRow(f, (id) => {
          toast(`„${pieceById(id)?.title}“ geladen und offline gespeichert`, { kind: 'success' });
        }))));
    }
    const foot = pieces.length < db.pieces.length
      ? `${pieces.length} von ${db.pieces.length} Stücken angezeigt`
      : `${plural(db.pieces.length, 'Stück', 'Stücke')} in der Bibliothek`;
    list.replaceChildren(...sections, h('div.list-foot', null, foot));

    rail.replaceChildren(...LETTERS.map((L) => h(`button.rail-letter${groups.has(L) ? '' : '.off'}`, {
      type: 'button', tabindex: '-1', dataset: { letter: L },
    }, L)));
  }

  // Tap or drag along the rail to jump to a letter.
  const jump = (x, y) => {
    const el = document.elementFromPoint(x, y)?.closest?.('.rail-letter');
    if (!el) return;
    let idx = LETTERS.indexOf(el.dataset.letter);
    // Jump to the nearest letter that exists (forward first).
    let target = null;
    for (let i = idx; i < LETTERS.length && !target; i++) target = list.querySelector(`[data-letter="${LETTERS[i]}"]`);
    for (idx -= 1; idx >= 0 && !target; idx--) target = list.querySelector(`[data-letter="${LETTERS[idx]}"]`);
    if (target) list.scrollTop = target.offsetTop; // .lib-list is position: relative
  };
  rail.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    rail.setPointerCapture(e.pointerId);
    jump(e.clientX, e.clientY);
    const move = (ev) => jump(rail.getBoundingClientRect().left + rail.clientWidth / 2, ev.clientY);
    const up = () => {
      rail.removeEventListener('pointermove', move);
      rail.removeEventListener('pointerup', up);
      rail.removeEventListener('pointercancel', up);
    };
    rail.addEventListener('pointermove', move);
    rail.addEventListener('pointerup', up);
    rail.addEventListener('pointercancel', up);
  });

  const barHolder = h('div.genre-bar-holder');
  const renderBar = () => {
    const bar = genreFilterBar(genreFilter, () => {
      renderBar();
      update();
      list.scrollTop = 0;
    });
    barHolder.replaceChildren(...(bar ? [bar] : []));
  };
  // Bottom bar while selecting: count, all shown, add to setlist, delete.
  const selectHolder = h('div.select-holder');
  function renderSelectBar() {
    if (!selecting) {
      selectHolder.replaceChildren();
      return;
    }
    const n = selected.size;
    const allShown = shown.length > 0 && shown.every((p) => selected.has(p.id));
    const ids = () => sortedPieces().filter((p) => selected.has(p.id)).map((p) => p.id);
    selectHolder.replaceChildren(h('div.select-bar', { role: 'toolbar', 'aria-label': 'Auswahl' },
      iconBtn('x', 'Auswahl beenden (Esc)', () => {
        endSelection();
        update();
      }, { class: 'select-close' }),
      h('span.select-count', null, n ? `${plural(n, 'Stück', 'Stücke')} ausgewählt` : 'Stücke vorne antippen'),
      h('div.spacer'),
      btn(allShown ? 'Keins' : `Alle angezeigten (${shown.length})`, () => pickAll(shown), { icon: 'check', kind: 'ghost', disabled: !shown.length }),
      btn('Zu Setlist …', () => openAddToSetlist(ids()), { icon: 'list', disabled: !n }),
      btn('Löschen', () => deleteSelected(ids()), { icon: 'trash', kind: 'danger', disabled: !n })));
  }

  const root = h('div.lib', null, toolbar, barHolder, h('div.lib-body', null, list, rail), selectHolder);
  function update() {
    root.classList.toggle('selecting', selecting);
    fill();
    renderSelectBar();
  }
  renderBar();
  update();
  return root;
}

async function deleteSelected(ids) {
  const pieces = ids.map(pieceById).filter(Boolean);
  if (!pieces.length) return;
  const sets = db.setlists.filter((s) => s.entries.some((e) => ids.includes(e.pieceId))).length;
  const names = pieces.slice(0, 4).map((p) => `„${p.title}“`).join(', ')
    + (pieces.length > 4 ? ` und ${pieces.length - 4} weitere` : '');
  const what = plural(pieces.length, 'Stück', 'Stücke');
  const ok = await confirmDialog(
    `${names} ${pieces.length === 1 ? 'wird' : 'werden'} aus der Bibliothek gelöscht`
    + `${sets ? ` und aus ${plural(sets, 'Setlist', 'Setlists')} entfernt` : ''}. Anmerkungen gehen dabei verloren.`,
    { title: `${what} löschen?`, okLabel: `${what} löschen`, danger: true },
  );
  if (!ok) return;
  endSelection();
  for (const p of pieces) await ink.remove(p.id); // no pending pen stroke may bring a file back
  const count = await deletePieces(pieces.map((p) => p.id));
  toast(`${plural(count, 'Stück', 'Stücke')} gelöscht`, { kind: 'success' });
}

function pieceRow(piece, play, pick) {
  const inSets = setlistsContaining(piece.id).length;
  const meta = [plural(pagesOf(piece).length, 'Seite', 'Seiten')];
  if (piece.parts.length > 1) meta.push(plural(piece.parts.length, 'Stimme', 'Stimmen'));
  if (inSets) meta.push(`in ${plural(inSets, 'Setlist', 'Setlists')}`);
  if (Object.values(db.sync.files).some((t) => t.pieceId === piece.id && !t.ignored)) meta.push('Noten-Pool');
  const isSel = selected.has(piece.id);
  const kind = piece.parts.length > 1 ? 'layers' : pagesOf(piece).length > 1 ? 'pages' : 'single';
  return h(`div.piece-row${isSel ? '.selected' : ''}`, { dataset: { id: piece.id } },
    h('button.piece-icon.piece-select', {
      type: 'button',
      title: isSel ? 'Auswahl aufheben' : 'Auswählen (Umschalt: Bereich)',
      'aria-pressed': String(isSel),
      onclick: (e) => pick(piece, e.shiftKey),
    }, icon(isSel ? 'check' : kind)),
    h('button.piece-main', {
      type: 'button',
      title: selecting ? 'Auswählen' : 'Öffnen',
      onclick: (e) => (selecting ? pick(piece, e.shiftKey) : play(piece)),
    },
    h('span.piece-text', null,
      h('span.piece-title', null, piece.title),
      h('span.piece-meta', null, meta.join(' · '), genreTags(piece)))),
    selecting ? null : iconBtn('more', 'Optionen', (e) => pieceMenu(e.currentTarget, piece), { class: 'row-more' }));
}

function pieceMenu(anchor, piece) {
  popMenu(anchor, [
    { label: 'Bearbeiten …', icon: 'edit', onClick: () => openPieceEditor(piece.id) },
    { label: 'Weitere Stimme verknüpfen …', icon: 'layers', onClick: () => openPieceEditor(piece.id) },
    { label: 'Genres …', icon: 'hash', onClick: () => openGenrePicker(piece) },
    { label: 'Zu Setlist hinzufügen …', icon: 'list', onClick: () => openAddToSetlist([piece.id]) },
    'sep',
    {
      label: 'Löschen',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        if (await confirmDeletePiece(piece, setlistsContaining(piece.id).length)) await deletePiece(piece.id);
      },
    },
  ]);
}
