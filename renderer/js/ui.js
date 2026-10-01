// Small DOM toolkit: element builder, icons, dialogs, menus, toasts.

const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'selected', 'tabIndex', 'readOnly', 'multiple']);

/** h('div.row.active', { onclick, title }, child, [children], 'text') */
export function h(sel, props, ...kids) {
  const [tag, ...cls] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (PROP_KEYS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  appendKids(el, kids);
  return el;
}

function appendKids(el, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) appendKids(el, kid);
    else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

// ---------- icons (24px grid, stroke-based) ----------

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  prev: '<path d="M15 18l-6-6 6-6"/>',
  next: '<path d="M9 18l6-6-6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  play: '<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z" fill="currentColor" stroke="none"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  moon: '<path d="M20 14.6A8.2 8.2 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  pen: '<path d="M4 20l1.2-4.4L16.4 4.4a2.1 2.1 0 0 1 3 0l.2.2a2.1 2.1 0 0 1 0 3L8.4 18.8z"/><path d="M14.5 6.3l3.2 3.2"/>',
  eraser: '<path d="M9 20h11"/><path d="M4.6 15.4l9.8-9.8a2 2 0 0 1 2.8 0l2.6 2.6a2 2 0 0 1 0 2.8L12.2 18.6a2 2 0 0 1-1.4.6H8.6a2 2 0 0 1-1.4-.6l-2.6-2.6a1.4 1.4 0 0 1 0-1.6z"/><path d="M9.5 10.5l5.5 5.5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.2A1.9 1.9 0 0 0 8.9 21h6.2a1.9 1.9 0 0 0 1.9-1.8L18 7M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7"/>',
  edit: '<path d="M12 20h8"/><path d="M15.8 4.4a2 2 0 0 1 2.9 0l.9.9a2 2 0 0 1 0 2.9L8 19.8 4 20.9l1.1-4z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  hash: '<path d="M5 9h14M5 15h14M10.5 4L8.5 20M15.5 4l-2 16"/>',
  sort: '<path d="M4 6h8M4 12h6M4 18h4"/><path d="M17 4v16M13.5 16.5L17 20l3.5-3.5"/>',
  import: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
  az: '<path d="M3.5 18l3.5-10 3.5 10M4.7 14.6h4.6"/><path d="M14 8h6l-6 10h6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  single: '<rect x="6.5" y="3" width="11" height="18" rx="1.5"/><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3"/>',
  two: '<rect x="2.5" y="4" width="8.5" height="16" rx="1.3"/><rect x="13" y="4" width="8.5" height="16" rx="1.3"/>',
  auto: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v4M3 8h4M16 21v-4M21 16h-4M8 21v-4M3 16h4M16 3v4M21 8h-4"/>',
  width: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2"/>',
  fullscreen: '<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/>',
  fullscreenExit: '<path d="M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M9 20v-4a1 1 0 0 0-1-1H4M15 20v-4a1 1 0 0 1 1-1h4"/>',
  hideBar: '<path d="M6 14l6-6 6 6"/><path d="M5 19h14"/>',
  invert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>',
  music: '<path d="M9 18V5.6a1 1 0 0 1 .8-1l9-1.8a1 1 0 0 1 1.2 1V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  pages: '<rect x="7" y="3" width="12" height="15" rx="1.5"/><path d="M5 7v12a2 2 0 0 0 2 2h9"/>',
  split: '<path d="M4 12h16"/><path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  backspace: '<path d="M21 6v12a1 1 0 0 1-1 1H9l-6-7 6-7h11a1 1 0 0 1 1 1z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/>',
  layers: '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.2l8.5 4.5 8.5-4.5"/><path d="M3.5 16.2l8.5 4.5 8.5-4.5"/>',
  rotateLeft: '<path d="M4.5 4v5h5"/><path d="M5.1 13.5a7.5 7.5 0 1 0 1.8-6.9L4.5 9"/>',
  rotateRight: '<path d="M19.5 4v5h-5"/><path d="M18.9 13.5a7.5 7.5 0 1 1-1.8-6.9L19.5 9"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-8 6 6 0 0 0-11.6 1.3A3.4 3.4 0 0 0 7 18.5z"/>',
  cloudOff: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-8 6 6 0 0 0-11.6 1.3A3.4 3.4 0 0 0 7 18.5z"/><path d="M4 4l16 16"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.4L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.6 4.4L20 15.5"/><path d="M20 20v-4.5h-4.5"/>',
  crop: '<path d="M6 2.5V17a1 1 0 0 0 1 1h14.5"/><path d="M2.5 6H17a1 1 0 0 1 1 1v14.5"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `ic ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

/** Icon button with tooltip/aria label. */
export function iconBtn(name, label, onclick, extra = {}) {
  const { class: cls, ...rest } = extra;
  return h(`button.icon-btn${cls ? `.${cls.split(' ').join('.')}` : ''}`, { type: 'button', title: label, 'aria-label': label, onclick, ...rest }, icon(name));
}

/** Labeled button with optional icon. */
export function btn(label, onclick, { icon: ic, kind = '', ...rest } = {}) {
  const classes = ['btn', kind].filter(Boolean).join('.');
  return h(`button.${classes}`, { type: 'button', onclick, ...rest }, ic ? icon(ic) : null, h('span', null, label));
}

// ---------- modal dialogs ----------

const modalStack = [];

export function modal({ title, body, actions = [], className = '', dismissible = true, onClose } = {}) {
  const root = document.getElementById('modal-root');
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    const i = modalStack.indexOf(api);
    if (i >= 0) modalStack.splice(i, 1);
    onClose?.(result);
  };
  const footer = actions.length
    ? h('footer.modal-actions', null, actions.map((a) => {
      const b = btn(a.label, () => a.onClick ? a.onClick(close) : close(a.value), { kind: a.kind || '', icon: a.icon, disabled: a.disabled });
      if (a.ref) a.ref(b);
      return b;
    }))
    : null;
  const box = h(`div.modal${className ? `.${className.split(' ').join('.')}` : ''}`, { role: 'dialog', 'aria-modal': 'true' },
    title ? h('header.modal-head', null,
      h('h2', null, title),
      dismissible ? iconBtn('x', 'Schließen', () => close(undefined), { class: 'modal-close' }) : null) : null,
    h('div.modal-body', null, body),
    footer);
  const backdrop = h('div.modal-backdrop', {
    onpointerdown: (e) => {
      if (e.target === backdrop && dismissible) backdrop.dataset.downOnBackdrop = '1';
    },
    onclick: (e) => {
      if (e.target === backdrop && backdrop.dataset.downOnBackdrop === '1') close(undefined);
      delete backdrop.dataset.downOnBackdrop;
    },
  }, box);
  root.append(backdrop);
  const api = { close, el: box, dismissible };
  modalStack.push(api);
  requestAnimationFrame(() => {
    const focusEl = box.querySelector('[autofocus]') || box.querySelector('input:not([type=checkbox]), textarea');
    if (focusEl) {
      focusEl.focus();
      if (focusEl.select && focusEl.dataset.selectAll !== 'false') focusEl.select();
    }
  });
  return api;
}

export function hasOpenModal() {
  return modalStack.length > 0;
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const top = modalStack[modalStack.length - 1];
  if (top && top.dismissible) {
    e.preventDefault();
    e.stopImmediatePropagation();
    top.close(undefined);
  }
}, true);

export function confirmDialog(message, { title = 'Bist du sicher?', okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    modal({
      title,
      className: 'small',
      body: h('p.dialog-text', null, message),
      actions: [
        { label: 'Abbrechen', value: false },
        { label: okLabel, kind: danger ? 'danger' : 'primary', value: true },
      ],
      onClose: (r) => resolve(!!r),
    });
  });
}

export function promptDialog({ title, label, value = '', okLabel = 'OK', placeholder = '', inputmode } = {}) {
  return new Promise((resolve) => {
    const input = h('input.text-input', { type: 'text', value, placeholder, inputmode, autofocus: true });
    const form = h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        m.close(input.value.trim());
      },
    }, label ? h('label.field-label', null, label) : null, input);
    const m = modal({
      title,
      className: 'small',
      body: form,
      actions: [
        { label: 'Abbrechen', value: null },
        { label: okLabel, kind: 'primary', onClick: (close) => close(input.value.trim()) },
      ],
      onClose: (r) => resolve(typeof r === 'string' ? r : null),
    });
  });
}

export function choiceDialog({ title, message, choices }) {
  return new Promise((resolve) => {
    modal({
      title,
      className: 'small',
      body: h('p.dialog-text', null, message),
      actions: choices.map((c) => ({ label: c.label, kind: c.kind, value: c.value })),
      onClose: (r) => resolve(r === undefined ? null : r),
    });
  });
}

// ---------- popover menu ----------

let openMenu = null;

export function closeMenu() {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
  document.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('resize', closeMenu);
  document.removeEventListener('keydown', onMenuKey, true);
}

function onOutside(e) {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
}
function onMenuKey(e) {
  if (e.key === 'Escape') {
    e.stopImmediatePropagation();
    closeMenu();
  }
}

/** items: [{ label, icon, onClick, danger, checked, disabled, hint }] or 'sep' or { heading } */
export function popMenu(anchor, items, { align = 'end' } = {}) {
  closeMenu();
  const menu = h('div.menu', { role: 'menu' }, items.filter(Boolean).map((it) => {
    if (it === 'sep') return h('div.menu-sep');
    if (it.heading) return h('div.menu-heading', null, it.heading);
    return h(`button.menu-item${it.danger ? '.danger' : ''}${it.checked ? '.checked' : ''}`, {
      type: 'button',
      role: 'menuitem',
      disabled: it.disabled,
      onclick: (e) => {
        e.stopPropagation();
        closeMenu();
        it.onClick?.();
      },
    },
    it.icon ? icon(it.icon) : h('span.ic'),
    h('span.menu-label', null, it.label),
    it.checked !== undefined ? h('span.menu-check', null, it.checked ? icon('check') : null) : null);
  }));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = align === 'end' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  openMenu = menu;
  setTimeout(() => {
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', closeMenu);
    document.addEventListener('keydown', onMenuKey, true);
  });
  return menu;
}

// ---------- toast ----------

export function toast(message, { kind = '', ms = 2600 } = {}) {
  const root = document.getElementById('toast-root');
  const el = h(`div.toast${kind ? `.${kind}` : ''}`, null, message);
  root.append(el);
  void el.offsetWidth; // start the fade-in transition
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

// ---------- misc ----------

/** Keeps focus on the element with the same data-fkey across a re-render. */
export function preserveFocus(container, renderFn) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.dataset.fkey : null;
  const sel = key && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  renderFn();
  if (!key) return;
  const again = container.querySelector(`[data-fkey="${CSS.escape(key)}"]`);
  if (again) {
    again.focus();
    if (sel && typeof again.setSelectionRange === 'function') {
      try { again.setSelectionRange(sel[0], sel[1]); } catch { /* not a text input */ }
    }
  }
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
