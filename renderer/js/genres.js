// Genres as #hashtags: the user's own list (Marsch, Polka, …), assigned to
// pieces, used as filter chips and in the search ("#polka").

import {
  commit, genreNames, genresOf, hasGenre, setPieceGenre, addGenre, renameGenre, deleteGenre, genreCount,
  cleanGenre, findGenre, sortedPieces, norm, pagesOf,
} from './store.js';
import {
  h, icon, btn, iconBtn, modal, toast, promptDialog, confirmDialog, plural,
} from './ui.js';

const SUGGESTIONS = ['Marsch', 'Polka', 'Walzer', 'Konzert', 'Choral', 'Kirche', 'Böhmisch', 'Solo', 'Weihnachten', 'Pop'];

/** "#Polka" chip; with onClick it's a toggle button. */
export function genreChip(name, { active = false, count = null, onClick = null, small = false } = {}) {
  const cls = `genre-chip${active ? '.active' : ''}${small ? '.small' : ''}`;
  const kids = [h('span.genre-hash', null, '#'), h('span', null, name), count !== null ? h('span.genre-count', null, String(count)) : null];
  if (!onClick) return h(`span.${cls}`, null, kids);
  return h(`button.${cls}`, { type: 'button', 'aria-pressed': String(active), onclick: onClick }, kids);
}

/** Tags of a piece for list rows. */
export function genreTags(piece) {
  const g = genresOf(piece);
  return g.length ? h('span.genre-tags', null, g.map((name) => genreChip(name, { small: true }))) : null;
}

/**
 * Toggle chips for all genres plus a field to create new ones.
 * `selected` is a Set of genre names; onChange(selected) after every change.
 */
export function genreSelector(selected, onChange) {
  const wrap = h('div.genre-selector');
  const input = h('input.text-input.genre-input', {
    type: 'text',
    placeholder: 'Neues Genre, z. B. #Walzer – Enter',
    maxlength: '40',
    'data-select-all': 'false',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const g = addGenre(input.value);
      if (!g) return;
      selected.add(g.name);
      input.value = '';
      commit('genres');
      onChange(selected);
      render();
    },
  });
  const render = () => {
    const names = genreNames();
    wrap.replaceChildren(
      h('div.genre-chips', null,
        names.length
          ? names.map((name) => genreChip(name, {
            active: [...selected].some((s) => norm(s) === norm(name)),
            onClick: () => {
              const has = [...selected].find((s) => norm(s) === norm(name));
              if (has) selected.delete(has);
              else selected.add(name);
              onChange(selected);
              render();
            },
          }))
          : h('span.muted.small', null, 'Noch keine Genres – lege unten das erste an.')),
      input,
    );
  };
  render();
  return wrap;
}

/** Quick dialog: genres of one piece (applied immediately). */
export function openGenrePicker(piece) {
  const selected = new Set(genresOf(piece));
  modal({
    title: `Genres · ${piece.title}`,
    className: 'small genre-modal',
    body: genreSelector(selected, (set) => {
      for (const name of genreNames()) setPieceGenre(piece, name, [...set].some((s) => norm(s) === norm(name)));
      commit();
    }),
    actions: [{ label: 'Fertig', kind: 'primary', value: true }],
  });
}

/** Tick all pieces that belong to one genre (e.g. all polkas at once). */
export function openGenreAssign(name) {
  let q = '';
  const list = h('div.pick-list');
  const countEl = h('span.muted.small');
  const render = () => {
    const pieces = sortedPieces().filter((p) => !q || norm(p.title).includes(norm(q)));
    list.replaceChildren(...pieces.map((p) => {
      const on = hasGenre(p, name);
      return h(`button.pick-item${on ? '.selected' : ''}`, {
        type: 'button',
        onclick: () => {
          setPieceGenre(p, name, !on);
          commit();
          render();
        },
      },
      h('span.pick-check', null, on ? icon('check') : null),
      h('span.pick-title', null, p.title),
      h('span.pick-meta', null, `${pagesOf(p).length} S.`));
    }));
    if (!pieces.length) list.append(h('div.no-results', null, 'Keine Stücke gefunden.'));
    countEl.textContent = `${plural(genreCount(name), 'Stück', 'Stücke')} mit #${name}`;
  };
  const search = h('input.search-input', {
    type: 'search', placeholder: 'Stück suchen …', autofocus: true, oninput: () => { q = search.value; render(); },
  });
  modal({
    title: `#${name} – Stücke zuordnen`,
    className: 'add-modal',
    body: h('div.add-pieces', null, h('label.search', null, icon('search'), search), countEl, list),
    actions: [{ label: 'Fertig', kind: 'primary', value: true }],
  });
  render();
}

/** Create, rename and delete genres; jump to "Stücke zuordnen". */
export function openGenreManager() {
  const body = h('div.genre-manager');
  const input = h('input.text-input', {
    type: 'text', placeholder: 'Neues Genre, z. B. Marsch', maxlength: '40', autofocus: true, 'data-select-all': 'false',
  });
  const create = (name) => {
    const clean = cleanGenre(name);
    if (!clean) return;
    if (findGenre(clean)) toast(`#${findGenre(clean).name} gibt es schon`);
    addGenre(clean);
    commit('genres');
    render();
  };
  const form = h('form.genre-add', {
    onsubmit: (e) => {
      e.preventDefault();
      create(input.value);
      input.value = '';
      input.focus();
    },
  }, input, btn('Anlegen', null, { icon: 'plus', type: 'submit' }));

  function render() {
    const names = genreNames();
    const missing = SUGGESTIONS.filter((s) => !findGenre(s));
    body.replaceChildren(
      form,
      missing.length ? h('div.genre-suggest', null, h('span.muted.small', null, 'Vorschläge:'), missing.map((s) => h('button.genre-chip.ghost', { type: 'button', onclick: () => create(s) }, h('span.genre-hash', null, '+'), h('span', null, s)))) : null,
      names.length
        ? h('div.genre-list', null, names.map((name) => h('div.genre-row', null,
          genreChip(name),
          h('span.genre-row-count', null, plural(genreCount(name), 'Stück', 'Stücke')),
          h('div.spacer'),
          btn('Stücke zuordnen …', () => openGenreAssign(name), { icon: 'list', kind: 'ghost' }),
          iconBtn('edit', 'Umbenennen', async () => {
            const neu = await promptDialog({ title: 'Genre umbenennen', label: 'Name', value: name, okLabel: 'Speichern' });
            if (!neu || cleanGenre(neu) === name) return;
            renameGenre(name, neu);
            commit();
            render();
          }),
          iconBtn('trash', 'Löschen', async () => {
            const n = genreCount(name);
            const ok = await confirmDialog(`#${name} löschen?${n ? ` Es wird bei ${plural(n, 'Stück', 'Stücken')} entfernt – die Stücke selbst bleiben.` : ''}`, { title: 'Genre löschen', okLabel: 'Löschen', danger: true });
            if (!ok) return;
            deleteGenre(name);
            commit();
            render();
          }, { class: 'danger-icon' }))))
        : h('p.muted.small', null, 'Noch keine Genres. Lege eigene an oder tippe auf einen Vorschlag.'),
    );
  }
  render();
  modal({ title: 'Genres', className: 'genre-manager-modal', body, actions: [{ label: 'Fertig', kind: 'primary', value: true }] });
}

/**
 * Horizontal row of filter chips. `selected` is a Set of genre names (OR filter).
 * onChange() after every toggle.
 */
export function genreFilterBar(selected, onChange, { manage = true } = {}) {
  const names = genreNames();
  if (!names.length) return null;
  for (const s of [...selected]) if (!findGenre(s)) selected.delete(s);
  return h('div.genre-bar', { role: 'group', 'aria-label': 'Nach Genre filtern' },
    h(`button.genre-chip.all${selected.size ? '' : '.active'}`, {
      type: 'button',
      onclick: () => {
        selected.clear();
        onChange();
      },
    }, 'Alle'),
    names.map((name) => genreChip(name, {
      active: selected.has(name),
      count: genreCount(name),
      onClick: () => {
        if (selected.has(name)) selected.delete(name);
        else selected.add(name);
        onChange();
      },
    })),
    manage ? h('button.genre-chip.ghost', { type: 'button', onclick: openGenreManager, title: 'Genres verwalten' }, icon('settings'), h('span', null, 'Verwalten')) : null);
}

export const matchesGenres = (piece, selected) => !selected.size || [...selected].some((g) => hasGenre(piece, g));

