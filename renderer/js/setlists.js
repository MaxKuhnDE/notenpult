// "Setlists" mode: any number of setlists; each entry can carry a folder
// number (Nr.), e.g. 1–120 for 60 pieces, shown in blocks of ten.

import {
  db, commit, pieceById, sortedPieces, setlistById, createSetlist, duplicateSetlist,
  addToSetlist, sortSetlistByNumber, setlistQueue, numberValue, pagesOf,
} from './store.js';
import {
  h, icon, iconBtn, btn, modal, popMenu, promptDialog, confirmDialog, plural, preserveFocus, toast,
} from './ui.js';
import { importFromPicker } from './importer.js';
import { openViewer } from './viewer.js';

let showDetail = false; // narrow screens: list pane vs. detail pane

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function currentSetlist() {
  return setlistById(db.ui.setlistId) || db.setlists[0] || null;
}

function select(id) {
  db.ui.setlistId = id;
  showDetail = true;
  commit('ui');
}

export function renderSetlists(container) {
  const prevScroll = container.querySelector('.sl-detail')?.scrollTop ?? 0;
  preserveFocus(container, () => container.replaceChildren(build()));
  const detail = container.querySelector('.sl-detail');
  if (detail) detail.scrollTop = prevScroll;
}

async function newSetlist() {
  const name = await promptDialog({ title: 'Neue Setlist', label: 'Name', value: '', placeholder: 'z. B. Frühjahrskonzert 2026', okLabel: 'Anlegen' });
  if (name === null) return;
  const s = createSetlist(name || 'Neue Setlist');
  db.ui.setlistId = s.id;
  showDetail = true;
  commit();
}

function play(s, entryId) {
  const queue = setlistQueue(s);
  const start = Math.max(0, queue.findIndex((q) => q.entryId === entryId));
  openViewer({ queue, start, context: { kind: 'setlist', name: s.name } });
}

function build() {
  const current = currentSetlist();
  const side = h('aside.sl-side', null,
    h('div.sl-side-head', null,
      h('h2', null, 'Setlists'),
      btn('Neu', newSetlist, { icon: 'plus', kind: 'ghost', title: 'Neue Setlist anlegen' })),
    h('div.sl-items', null,
      db.setlists.length
        ? db.setlists.map((s) => h(`button.sl-item${current && s.id === current.id ? '.active' : ''}`, {
          type: 'button',
          onclick: () => select(s.id),
        },
        h('span.sl-item-name', null, s.name),
        h('span.sl-item-meta', null, plural(setlistQueue(s).length, 'Stück', 'Stücke'))))
        : h('p.muted.small.pad', null, 'Noch keine Setlist.')));

  const detail = h('section.sl-detail', null, current ? detailView(current) : noSetlists());
  return h(`div.sl${showDetail && current ? '.show-detail' : ''}`, null, side, detail);
}

function noSetlists() {
  return h('div.empty-state', null,
    h('div.empty-icon', null, icon('list')),
    h('h2', null, 'Lege deine erste Setlist an'),
    h('p', null, 'Eine Setlist legt fest, welches Stück nach welchem kommt – z. B. für ein Konzert oder für euren Notenordner mit Nummern 1–120.'),
    h('div.empty-actions', null, btn('Neue Setlist', newSetlist, { icon: 'plus', kind: 'primary' })),
    !db.pieces.length ? h('p.muted.small', null, 'Tipp: Importiere zuerst deine Noten unter „A–Z“.') : null);
}

function detailView(s) {
  const queue = setlistQueue(s);
  const pageCount = queue.reduce((n, q) => n + pagesOf(pieceById(q.pieceId)).length, 0);

  const head = h('div.sl-head', null,
    iconBtn('back', 'Alle Setlists', () => {
      showDetail = false;
      commit('ui');
    }, { class: 'sl-back' }),
    h('div.sl-title', null,
      h('h2', null, s.name),
      h('div.sl-sub', null, `${plural(queue.length, 'Stück', 'Stücke')} · ${plural(pageCount, 'Seite', 'Seiten')}`)),
    h('div.sl-actions', null,
      btn('Stücke hinzufügen', () => openAddPieces(s.id), { icon: 'plus' }),
      btn('Spielen', () => play(s, queue[0]?.entryId), { icon: 'play', kind: 'primary', disabled: !queue.length }),
      iconBtn('more', 'Weitere Aktionen', (e) => setlistMenu(e.currentTarget, s))));

  if (!queue.length) {
    return [head, h('div.empty-state.inline', null,
      h('p', null, 'Diese Setlist ist noch leer.'),
      h('div.empty-actions', null, btn('Stücke hinzufügen', () => openAddPieces(s.id), { icon: 'plus', kind: 'primary' })))];
  }

  const counts = new Map();
  for (const e of s.entries) if (e.number) counts.set(e.number, (counts.get(e.number) || 0) + 1);

  const list = h('div.entries');
  let prevBlock;
  for (const e of s.entries) {
    const piece = pieceById(e.pieceId);
    if (!piece) continue;
    if (db.settings.tensBlocks) {
      const nv = numberValue(e.number);
      const block = nv === null ? 'none' : Math.max(0, Math.floor((nv - 1) / 10));
      if (block !== prevBlock && (block !== 'none' || prevBlock !== undefined)) {
        list.append(h('div.block-divider', null, block === 'none' ? 'Ohne Nummer' : `${block * 10 + 1}–${block * 10 + 10}`));
      }
      prevBlock = block;
    }
    list.append(entryRow(s, e, piece, counts.get(e.number) > 1, list));
  }
  return [head, list, h('p.muted.small.list-foot', null, 'Nummer eintippen und mit Enter zum nächsten Feld springen. Mit ⠿ verschieben.')];
}

function entryRow(s, e, piece, dup, list) {
  const input = h(`input.nr-input${dup ? '.dup' : ''}`, {
    type: 'text',
    inputmode: 'numeric',
    value: e.number || '',
    placeholder: 'Nr.',
    maxlength: '6',
    'aria-label': 'Nummer im Notenordner',
    title: dup ? 'Diese Nummer kommt mehrfach vor' : 'Nummer im Notenordner',
    'data-fkey': `nr-${e.id}`,
    onchange: () => {
      e.number = input.value.trim();
      commit();
    },
    onkeydown: (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const idx = s.entries.indexOf(e);
      const nextEntry = s.entries.slice(idx + 1).find((x) => pieceById(x.pieceId));
      if (input.value.trim() !== (e.number || '')) {
        e.number = input.value.trim();
        commit();
      }
      const target = nextEntry && document.querySelector(`[data-fkey="nr-${nextEntry.id}"]`);
      if (target) {
        target.focus();
        target.select();
      } else {
        document.activeElement?.blur?.();
      }
    },
  });

  return h('div.entry', { dataset: { id: e.id } },
    h('button.grip', {
      type: 'button',
      title: 'Ziehen zum Verschieben',
      'aria-label': 'Verschieben',
      onpointerdown: (ev) => startDrag(ev, s, list),
    }, icon('grip')),
    input,
    h('button.entry-main', { type: 'button', onclick: () => play(s, e.id), title: 'Ab hier spielen' },
      h('span.entry-title', null, piece.title),
      h('span.entry-meta', null, [plural(pagesOf(piece).length, 'Seite', 'Seiten'), piece.parts.length > 1 ? plural(piece.parts.length, 'Stimme', 'Stimmen') : ''].filter(Boolean).join(' · '))),
    iconBtn('x', 'Aus Setlist entfernen', () => {
      s.entries = s.entries.filter((x) => x.id !== e.id);
      commit();
    }, { class: 'entry-remove' }));
}

function startDrag(ev, s, list) {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  ev.preventDefault();
  const grip = ev.currentTarget;
  const row = grip.closest('.entry');
  const scroller = list.closest('.sl-detail');
  grip.setPointerCapture(ev.pointerId);
  list.classList.add('reordering');
  row.classList.add('dragging');
  let y = ev.clientY;

  const reposition = () => {
    const rows = [...list.querySelectorAll('.entry')].filter((r) => r !== row);
    const target = rows.find((r) => {
      const b = r.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });
    if (target) {
      if (row.nextElementSibling !== target) list.insertBefore(row, target);
    } else if (list.lastElementChild !== row) {
      list.append(row);
    }
  };
  const autoscroll = setInterval(() => {
    const b = scroller.getBoundingClientRect();
    if (y < b.top + 60) scroller.scrollTop -= 14;
    else if (y > b.bottom - 60) scroller.scrollTop += 14;
    else return;
    reposition();
  }, 30);
  const onMove = (e) => {
    y = e.clientY;
    reposition();
  };
  const onUp = () => {
    clearInterval(autoscroll);
    grip.removeEventListener('pointermove', onMove);
    grip.removeEventListener('pointerup', onUp);
    grip.removeEventListener('pointercancel', onUp);
    const order = [...list.querySelectorAll('.entry')].map((r) => r.dataset.id);
    const pos = new Map(order.map((id, i) => [id, i]));
    s.entries.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
    commit();
  };
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', onUp);
  grip.addEventListener('pointercancel', onUp);
}

function setlistMenu(anchor, s) {
  popMenu(anchor, [
    {
      label: 'Umbenennen …',
      icon: 'edit',
      onClick: async () => {
        const name = await promptDialog({ title: 'Setlist umbenennen', label: 'Name', value: s.name, okLabel: 'Speichern' });
        if (name) {
          s.name = name;
          commit();
        }
      },
    },
    {
      label: 'Duplizieren',
      icon: 'copy',
      onClick: () => {
        const copy = duplicateSetlist(s.id);
        db.ui.setlistId = copy.id;
        commit();
      },
    },
    {
      label: 'Nach Nummer sortieren',
      icon: 'sort',
      disabled: !s.entries.some((e) => e.number),
      onClick: () => {
        sortSetlistByNumber(s.id);
        commit();
        toast('Nach Nummer sortiert');
      },
    },
    {
      label: 'Nummern fortlaufend vergeben …',
      icon: 'hash',
      disabled: !s.entries.length,
      onClick: async () => {
        const start = await promptDialog({ title: 'Nummern vergeben', label: 'Erste Nummer (danach +1 in Listenreihenfolge)', value: '1', okLabel: 'Vergeben', inputmode: 'numeric' });
        const n0 = numberValue(start);
        if (n0 === null) return;
        s.entries.forEach((e, i) => { e.number = String(n0 + i); });
        commit();
      },
    },
    'sep',
    {
      label: 'Setlist löschen',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        const ok = await confirmDialog(`„${s.name}“ löschen? Die Stücke selbst bleiben in der Bibliothek.`, { title: 'Setlist löschen?', okLabel: 'Löschen', danger: true });
        if (!ok) return;
        db.setlists = db.setlists.filter((x) => x.id !== s.id);
        db.ui.setlistId = db.setlists[0]?.id || null;
        showDetail = false;
        commit();
      },
    },
  ]);
}

/** Multi-select picker; tap order = order in the setlist. */
function openAddPieces(setlistId) {
  const s = setlistById(setlistId);
  if (!s) return;
  const picked = [];
  let query = '';
  const list = h('div.pick-list');
  const startNr = h('input.text-input.nr-start', { type: 'text', inputmode: 'numeric', placeholder: 'leer lassen', maxlength: '6', 'data-select-all': 'false' });
  let addBtn;

  const renderList = () => {
    const q = norm(query.trim());
    const pieces = sortedPieces().filter((p) => !q || norm(p.title).includes(q));
    list.replaceChildren(...pieces.map((p) => {
      const idx = picked.indexOf(p.id);
      const inSet = s.entries.some((e) => e.pieceId === p.id);
      return h(`button.pick-item${idx >= 0 ? '.selected' : ''}`, {
        type: 'button',
        onclick: () => {
          if (idx >= 0) picked.splice(idx, 1);
          else picked.push(p.id);
          renderList();
        },
      },
      h('span.pick-check', null, idx >= 0 ? String(idx + 1) : ''),
      h('span.pick-title', null, p.title),
      inSet ? h('span.pick-badge', null, 'schon drin') : null,
      h('span.pick-meta', null, `${pagesOf(p).length} S.`));
    }));
    if (!db.pieces.length) list.append(h('div.no-results', null, 'Die Bibliothek ist leer – importiere zuerst Noten.'));
    else if (!pieces.length) list.append(h('div.no-results', null, 'Keine Treffer.'));
    if (addBtn) {
      addBtn.disabled = !picked.length;
      addBtn.querySelector('span').textContent = picked.length ? `${picked.length} hinzufügen` : 'Hinzufügen';
    }
  };

  const searchInput = h('input.search-input', {
    type: 'search',
    placeholder: 'Stück suchen …',
    autofocus: true,
    oninput: () => {
      query = searchInput.value;
      renderList();
    },
  });

  const body = h('div.add-pieces', null,
    h('div.add-top', null,
      h('label.search', null, icon('search'), searchInput),
      btn('Importieren …', async () => {
        const ids = await importFromPicker();
        picked.push(...ids.filter((id) => !picked.includes(id)));
        renderList();
      }, { icon: 'import', kind: 'ghost' })),
    h('p.muted.small', null, 'Antippen in der gewünschten Reihenfolge – die Zahl zeigt die Position.'),
    list,
    h('label.nr-start-row', null, h('span', null, 'Nummern fortlaufend ab'), startNr));

  modal({
    title: `Zu „${s.name}“ hinzufügen`,
    className: 'add-modal',
    body,
    actions: [
      { label: 'Abbrechen', value: false },
      {
        label: 'Hinzufügen',
        kind: 'primary',
        disabled: true,
        ref: (b) => { addBtn = b; },
        onClick: (close) => {
          if (!picked.length) return;
          addToSetlist(s.id, picked, startNr.value.trim() || null);
          commit();
          close(true);
        },
      },
    ],
  });
  renderList();
}

/** From the library: add pieces to a chosen (or new) setlist with an optional number. */
export function openAddToSetlist(pieceIds) {
  let chosen = db.ui.setlistId && setlistById(db.ui.setlistId) ? db.ui.setlistId : db.setlists[0]?.id || '__new';
  const nr = h('input.text-input.nr-start', { type: 'text', inputmode: 'numeric', placeholder: 'optional', maxlength: '6', 'data-select-all': 'false' });
  const newName = h('input.text-input', { type: 'text', placeholder: 'Name der neuen Setlist', 'data-select-all': 'false' });
  const options = h('div.choice-list');
  const render = () => {
    options.replaceChildren(
      ...db.setlists.map((s) => h(`button.choice${chosen === s.id ? '.active' : ''}`, {
        type: 'button',
        onclick: () => { chosen = s.id; render(); },
      }, h('span.choice-dot'), h('span', null, s.name), h('span.muted.small', null, plural(setlistQueue(s).length, 'Stück', 'Stücke')))),
      h(`button.choice${chosen === '__new' ? '.active' : ''}`, { type: 'button', onclick: () => { chosen = '__new'; render(); newName.focus(); } },
        h('span.choice-dot'), h('span', null, 'Neue Setlist …')));
    newName.hidden = chosen !== '__new';
  };
  render();
  const single = pieceIds.length === 1 ? pieceById(pieceIds[0]) : null;
  modal({
    title: single ? `„${single.title}“ hinzufügen` : 'Zu Setlist hinzufügen',
    className: 'small',
    body: h('div.add-to', null,
      options,
      newName,
      h('label.nr-start-row', null, h('span', null, pieceIds.length > 1 ? 'Nummern ab' : 'Nummer (Nr.)'), nr)),
    actions: [
      { label: 'Abbrechen', value: false },
      {
        label: 'Hinzufügen',
        kind: 'primary',
        onClick: (close) => {
          let id = chosen;
          if (id === '__new') id = createSetlist(newName.value.trim() || 'Neue Setlist').id;
          addToSetlist(id, pieceIds, nr.value.trim() || null);
          commit();
          close(true);
          toast(`Hinzugefügt zu „${setlistById(id).name}“`, { kind: 'success' });
        },
      },
    ],
  });
}
