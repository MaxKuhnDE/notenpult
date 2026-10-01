// Piece editor: title, parts (Stimmen: link further PDFs or existing pieces),
// and per part: reorder/remove/rotate pages, append pages, split pages off
// into a new piece (useful for one big scanned PDF of the whole folder).

import {
  commit, pieceById, addPiece, uid, cleanTitle, deleteUnusedFiles, partNameFrom, mergePieces,
  ignoreSynced, sortedPieces, norm, pagesOf, allPages,
} from './store.js';
import { thumbnail } from './render.js';
import * as ink from './ink.js';
import { pickPages } from './importer.js';
import {
  h, icon, btn, iconBtn, modal, toast, promptDialog, confirmDialog, popMenu, plural,
} from './ui.js';

const copyParts = (piece) => piece.parts.map((p) => ({ id: p.id, name: p.name, pages: p.pages.map((pg) => ({ ...pg })) }));

export function openPieceEditor(pieceId) {
  const piece = pieceById(pieceId);
  if (!piece) return;
  let parts = copyParts(piece);
  let cur = Math.min(piece.part || 0, parts.length - 1);
  const selected = new Set();
  const appendedFiles = [];
  const thumbCache = new Map(); // "pageId|rot" -> Promise<canvas>

  const titleInput = h('input.text-input', { type: 'text', value: piece.title, 'aria-label': 'Titel' });
  const tabs = h('div.part-tabs', { role: 'tablist' });
  const partName = h('input.text-input.part-name', {
    type: 'text',
    'aria-label': 'Name der Stimme',
    'data-select-all': 'false',
    oninput: () => {
      parts[cur].name = partName.value;
      renderTabs();
    },
  });
  const removePartBtn = btn('Stimme entfernen', removePart, { icon: 'trash', kind: 'ghost' });
  const grid = h('div.thumb-grid');
  const countEl = h('span.thumb-count');
  const selActions = {
    left: btn('Nach vorne', () => move(-1), { icon: 'arrowLeft', kind: 'ghost' }),
    right: btn('Nach hinten', () => move(1), { icon: 'arrowRight', kind: 'ghost' }),
    remove: btn('Entfernen', removeSelected, { icon: 'trash', kind: 'ghost' }),
    split: btn('Als neues Stück …', splitSelected, { icon: 'split', kind: 'ghost' }),
  };
  const rotateBtns = [
    iconBtn('rotateLeft', 'Nach links drehen (Auswahl, sonst alle Seiten)', () => rotate(-90)),
    iconBtn('rotateRight', 'Nach rechts drehen (Auswahl, sonst alle Seiten)', () => rotate(90)),
  ];

  const pages = () => parts[cur].pages;

  function renderTabs() {
    tabs.replaceChildren(...parts.map((p, i) => h(`button.part-tab${i === cur ? '.active' : ''}`, {
      type: 'button',
      role: 'tab',
      onclick: () => {
        cur = i;
        selected.clear();
        renderAll();
      },
    }, h('span.part-tab-name', null, p.name || `${i + 1}. Stimme`), h('span.part-tab-count', null, String(p.pages.length)))),
    h('button.part-tab.add', { type: 'button', onclick: (e) => addPartMenu(e.currentTarget) }, icon('plus'), h('span', null, 'Stimme verknüpfen')));
  }

  function renderGrid() {
    countEl.textContent = selected.size
      ? `${selected.size} von ${plural(pages().length, 'Seite', 'Seiten')} ausgewählt`
      : `${plural(pages().length, 'Seite', 'Seiten')} – antippen zum Auswählen`;
    for (const b of Object.values(selActions)) b.disabled = !selected.size;
    grid.replaceChildren(...pages().map((pg, i) => {
      const holder = h('div.thumb-img');
      const key = `${pg.id}|${pg.rot || 0}`;
      let p = thumbCache.get(key);
      if (!p) {
        p = thumbnail(pg, 116);
        thumbCache.set(key, p);
      }
      p.then((c) => holder.replaceChildren(c)).catch(() => holder.replaceChildren(h('span.thumb-err', null, '?')));
      return h(`button.thumb${selected.has(pg.id) ? '.selected' : ''}`, {
        type: 'button',
        onclick: () => {
          if (selected.has(pg.id)) selected.delete(pg.id);
          else selected.add(pg.id);
          renderGrid();
        },
      }, holder, h('span.thumb-no', null, String(i + 1)), h('span.thumb-check', null, icon('check')));
    }));
  }

  function renderAll() {
    renderTabs();
    partName.value = parts[cur].name;
    removePartBtn.disabled = parts.length < 2;
    renderGrid();
  }

  function move(dir) {
    const list = pages();
    const idx = list.map((p, i) => (selected.has(p.id) ? i : -1)).filter((i) => i >= 0);
    if (dir < 0) {
      for (const i of idx) {
        if (i > 0 && !selected.has(list[i - 1].id)) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      }
    } else {
      for (const i of idx.reverse()) {
        if (i < list.length - 1 && !selected.has(list[i + 1].id)) [list[i + 1], list[i]] = [list[i], list[i + 1]];
      }
    }
    renderGrid();
  }

  function rotate(delta) {
    const targets = selected.size ? pages().filter((p) => selected.has(p.id)) : pages();
    for (const pg of targets) {
      pg.rot = (((pg.rot || 0) + delta) % 360 + 360) % 360;
      if (!pg.rot) delete pg.rot;
    }
    renderGrid();
  }

  function removeSelected() {
    if (selected.size >= pages().length) {
      toast('Mindestens eine Seite muss bleiben – sonst „Stimme entfernen“.', { ms: 3500 });
      return;
    }
    parts[cur].pages = pages().filter((p) => !selected.has(p.id));
    selected.clear();
    renderGrid();
  }

  async function removePart() {
    if (parts.length < 2) return;
    const ok = await confirmDialog(`„${parts[cur].name}“ aus diesem Stück entfernen? Die Anmerkungen dieser Stimme gehen verloren.`, {
      title: 'Stimme entfernen', okLabel: 'Entfernen', danger: true,
    });
    if (!ok) return;
    parts.splice(cur, 1);
    cur = Math.max(0, cur - 1);
    selected.clear();
    renderAll();
  }

  /** Writes the draft into the piece (used before immediate actions and on save). */
  function applyDraft() {
    const keptPartIds = new Set(parts.map((p) => p.id));
    ignoreSynced((t) => t.pieceId === piece.id && !keptPartIds.has(t.partId));
    const before = allPages(piece).map((p) => p.file);
    piece.title = cleanTitle(titleInput.value) || piece.title;
    piece.parts = parts.map((p, i) => ({ id: p.id, name: p.name.trim() || `${i + 1}. Stimme`, pages: p.pages.map((pg) => ({ ...pg })) }));
    piece.part = Math.min(piece.part || 0, piece.parts.length - 1);
    return before;
  }

  async function splitSelected() {
    if (selected.size >= pages().length) {
      toast('Wähle nur die Seiten aus, die ein eigenes Stück werden sollen.', { ms: 3500 });
      return;
    }
    const title = await promptDialog({ title: 'Neues Stück aus Auswahl', label: 'Titel des neuen Stücks', okLabel: 'Erstellen' });
    if (!title) return;
    const moving = pages().filter((p) => selected.has(p.id));
    const newPiece = addPiece({ title, pages: [] });
    newPiece.parts[0].pages = moving.map((p) => ({ ...p })); // keep page ids so annotations move along
    parts[cur].pages = pages().filter((p) => !selected.has(p.id));
    selected.clear();
    applyDraft();
    commit();
    await ink.movePages(piece.id, newPiece.id, moving.map((p) => p.id));
    toast(`„${newPiece.title}“ erstellt`, { kind: 'success' });
    renderGrid();
  }

  async function appendPages() {
    const { pages: added, files } = await pickPages();
    if (!added.length) return;
    appendedFiles.push(...files);
    pages().push(...added.map((p) => ({ id: uid(), ...p })));
    renderAll();
    grid.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }

  async function addPartFromFiles() {
    const { pages: added, files, names } = await pickPages();
    if (!added.length) return;
    appendedFiles.push(...files);
    const name = partNameFrom(names[0] || '', cleanTitle(titleInput.value), parts.length + 1);
    parts.push({ id: uid(), name, pages: added.map((p) => ({ id: uid(), ...p })) });
    cur = parts.length - 1;
    selected.clear();
    renderAll();
    toast(`Stimme „${name}“ verknüpft – Name oben anpassbar.`, { ms: 3000 });
  }

  function addPartFromLibrary() {
    let q = '';
    const list = h('div.pick-list');
    const render = () => {
      const others = sortedPieces().filter((p) => p.id !== piece.id && (!q || norm(p.title).includes(norm(q))));
      list.replaceChildren(...others.map((p) => h('button.pick-item', {
        type: 'button',
        onclick: async () => {
          const ok = await confirmDialog(
            `„${p.title}“ wird als Stimme in „${cleanTitle(titleInput.value)}“ übernommen und verschwindet als eigenes Stück. Setlist-Einträge und Anmerkungen werden mitgenommen.`,
            { title: 'Stück als Stimme verknüpfen', okLabel: 'Verknüpfen' },
          );
          if (!ok) return;
          pick.close();
          applyDraft();
          const movedPageIds = mergePieces(piece.id, p.id);
          commit();
          await ink.movePages(p.id, piece.id, movedPageIds);
          await ink.remove(p.id);
          parts = copyParts(piece);
          cur = parts.length - 1;
          selected.clear();
          renderAll();
          toast(`„${p.title}“ ist jetzt eine Stimme`, { kind: 'success' });
        },
      }, h('span.pick-title', null, p.title), h('span.pick-meta', null, `${plural(pagesOf(p).length, 'Seite', 'Seiten')}${p.parts.length > 1 ? ` · ${p.parts.length} Stimmen` : ''}`))));
      if (!list.children.length) list.append(h('div.no-results', null, 'Keine anderen Stücke gefunden.'));
    };
    const search = h('input.search-input', {
      type: 'search', placeholder: 'Stück suchen …', autofocus: true, oninput: () => { q = search.value; render(); },
    });
    const pick = modal({
      title: 'Vorhandenes Stück als Stimme',
      className: 'add-modal',
      body: h('div.add-pieces', null,
        h('p.muted.small', null, 'z. B. wenn „Florentiner Marsch 2. Stimme“ als eigenes Stück importiert wurde.'),
        h('label.search', null, icon('search'), search),
        list),
    });
    render();
  }

  function addPartMenu(anchor) {
    popMenu(anchor, [
      { label: 'PDF oder Bilder wählen …', icon: 'import', onClick: addPartFromFiles },
      { label: 'Vorhandenes Stück aus der Bibliothek …', icon: 'music', onClick: addPartFromLibrary },
    ], { align: 'start' });
  }

  let saved = false;
  const body = h('div.editor', null,
    h('label.field-label', null, 'Titel'),
    titleInput,
    h('div.thumb-head', null, h('h3', null, 'Stimmen'), h('span.thumb-count', null, 'Jede Stimme ist ein eigenes PDF – im Notenmodus oben umschaltbar.')),
    tabs,
    h('div.part-row', null, h('label.field-label', null, 'Name der Stimme'), h('div.part-row-inner', null, partName, removePartBtn)),
    h('div.thumb-head', null, h('h3', null, 'Seiten'), countEl, h('div.spacer'), btn('Seiten anhängen …', appendPages, { icon: 'plus' })),
    h('div.thumb-actions', null, Object.values(selActions), h('span.thumb-sep'), rotateBtns),
    grid);

  modal({
    title: 'Stück bearbeiten',
    className: 'editor-modal',
    body,
    actions: [
      { label: 'Abbrechen', value: false },
      {
        label: 'Speichern',
        kind: 'primary',
        onClick: async (close) => {
          const before = applyDraft();
          saved = true;
          commit();
          close(true);
          await deleteUnusedFiles([...before, ...appendedFiles]);
        },
      },
    ],
    onClose: () => {
      if (!saved && appendedFiles.length) deleteUnusedFiles(appendedFiles);
    },
  });
  renderAll();
}

export async function confirmDeletePiece(piece, setlistCount) {
  return confirmDialog(
    `„${piece.title}“ wird aus der Bibliothek gelöscht${setlistCount ? ` und aus ${plural(setlistCount, 'Setlist', 'Setlists')} entfernt` : ''}. Anmerkungen gehen dabei verloren.`,
    { title: 'Stück löschen?', okLabel: 'Löschen', danger: true },
  );
}
