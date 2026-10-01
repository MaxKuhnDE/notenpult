// Full-screen sheet viewer.
//
// Input model:
//   - Finger tap, mouse/trackpad click, →, PageDown, Space: next page
//   - Swipe right, right click, ←, PageUp:                   previous page
//   - Pen: always writes (setting); pen eraser end or barrel button erases
//   - Touches shortly after pen activity are ignored (palm rejection)
//
// Layout "auto" fills the screen: two pages side by side (A4 portrait on a
// landscape screen) or stacked (A5 landscape on a portrait screen) whenever
// that doesn't make the pages noticeably smaller than showing one alone.

import {
  db, commit, subscribe, pieceById, backend, pagesOf, activePart,
} from './store.js';
import {
  pageView, renderView, viewTransform, toPagePixels, harmonizeViews, FULL,
} from './render.js';
import * as ink from './ink.js';
import {
  h, icon, iconBtn, popMenu, closeMenu, modal, toast, confirmDialog, hasOpenModal,
} from './ui.js';
import { isDark, toggleDark, onThemeChange } from './theme.js';
import { openSettings } from './settings.js';
import { openSearch } from './search.js';

const PAD = 10;
const GAP = 14;
const PAIR_THRESHOLD = 0.85; // two pages per screen if each keeps ≥ 85 % of its single-page size
const TAP_SLOP = { touch: 24, mouse: 8, pen: 12 };
const PALM_GUARD_MS = 900;
const ERASER_RADIUS = 14;
const NEXT_KEYS = new Set(['ArrowRight', 'PageDown', ' ', 'ArrowDown', 'Enter']);
const PREV_KEYS = new Set(['ArrowLeft', 'PageUp', 'ArrowUp', 'Backspace']);
const FALLBACK_VIEW = { rot: 0, crop: FULL, w0: 595, h0: 842, dw: 595, dh: 842 };

let V = null;
let fullscreen = false;
backend.isFullscreen().then((on) => { fullscreen = on; }).catch(() => {});
backend.onFullscreenChange((on) => {
  fullscreen = on;
  if (V) updateFsButton();
});

export const isViewerOpen = () => !!V;

/**
 * queue: [{ pieceId, number }], start: index into queue,
 * context: { kind: 'setlist' | 'library', name, onClose }
 */
export function openViewer({ queue, start = 0, context = {} }) {
  const startItem = queue[start];
  const items = queue.filter((q) => {
    const p = pieceById(q.pieceId);
    return p && pagesOf(p).length;
  });
  if (!items.length) {
    toast('Keine Noten zum Anzeigen.');
    return;
  }
  if (V) closeViewer();
  V = {
    queue: items,
    qi: Math.max(0, items.indexOf(startItem)),
    pi: 0,
    screen: null,
    screens: new Map(),
    nav: Promise.resolve(),
    context,
    color: 'red',
    eraser: false,
    drawMode: false,
    undo: [],
    slots: [],
    showToken: 0,
    active: null,
    gesture: null,
    touches: new Set(),
    lastPen: 0,
    lastSize: null,
    cleanup: [],
  };
  build();
  document.body.classList.add('viewer-open');
  backend.keepAwake(true);
  show();
}

export function closeViewer() {
  if (!V) return;
  const v = V;
  V = null;
  closeMenu();
  for (const fn of v.cleanup) fn();
  v.el.remove();
  document.body.classList.remove('viewer-open');
  backend.keepAwake(false);
  ink.flushAll();
  v.context.onClose?.();
}

// ---------- DOM ----------

function build() {
  const titleEl = h('div.v-title');
  const subEl = h('div.v-sub');
  const partBtn = h('button.v-part', { type: 'button', title: 'Stimme wechseln (S)', onclick: () => cyclePart(1), hidden: true });
  const tools = {
    draw: iconBtn('pen', 'Zeichenmodus – Finger/Maus schreiben statt blättern', toggleDrawMode, { class: 'tool' }),
    red: h('button.icon-btn.tool.swatch', { type: 'button', title: 'Rot', 'aria-label': 'Stiftfarbe Rot', onclick: () => setColor('red') }, h('span.dot.red')),
    black: h('button.icon-btn.tool.swatch', { type: 'button', title: 'Schwarz', 'aria-label': 'Stiftfarbe Schwarz', onclick: () => setColor('black') }, h('span.dot.black')),
    eraser: iconBtn('eraser', 'Radierer', toggleEraser, { class: 'tool' }),
    undo: iconBtn('undo', 'Rückgängig (Strg+Z)', undo, { class: 'tool' }),
  };
  const fsBtn = iconBtn('fullscreen', 'Vollbild (F11)', toggleFullscreen, { class: 'v-fs' });
  const isSetlist = V.context.kind === 'setlist';

  const bar = h('header.v-bar', null,
    iconBtn('back', 'Zurück zur Übersicht (Esc)', closeViewer, { class: 'v-close' }),
    h('button.v-info', { type: 'button', title: 'Stück auswählen', onclick: () => openJump() }, titleEl, subEl),
    partBtn,
    h('div.v-tools', null,
      h('div.v-group.nav', null,
        iconBtn('prev', 'Zurückblättern (←)', prev),
        iconBtn('next', 'Weiterblättern (→)', next)),
      iconBtn('search', 'Suchen – auch im Noten-Pool (Strg+F)', openViewerSearch),
      isSetlist ? iconBtn('hash', 'Nummer eingeben', () => openJump('')) : null,
      h('div.v-group.ink-tools', null, tools.draw, tools.red, tools.black, tools.eraser, tools.undo),
      h('div.v-group.rotate-tools', null,
        iconBtn('rotateLeft', 'Seite 90° nach links drehen', () => rotateVisible(-90)),
        iconBtn('rotateRight', 'Seite 90° nach rechts drehen', () => rotateVisible(90))),
      fsBtn,
      iconBtn('more', 'Ansicht & mehr', (e) => openMore(e.currentTarget))));
  // Toolbar buttons must not keep focus, otherwise Space/Enter would re-trigger them.
  bar.addEventListener('click', () => setTimeout(() => document.activeElement?.blur?.(), 0));

  const stage = h('div.stage', { tabindex: '-1' });
  const flash = h('div.v-flash');
  const reveal = iconBtn('down', 'Leiste einblenden', () => setBarHidden(false), { class: 'bar-reveal' });
  const eraserCursor = h('div.eraser-cursor', { style: { width: `${ERASER_RADIUS * 2}px`, height: `${ERASER_RADIUS * 2}px` } });
  const spinner = h('div.v-spinner');
  const el = h('div.viewer', null, bar, stage, flash, reveal, eraserCursor, spinner);
  document.getElementById('viewer-root').append(el);
  Object.assign(V, { el, bar, stage, flash, titleEl, subEl, partBtn, tools, fsBtn, eraserCursor });

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerCancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // Pen hovering anywhere over the viewer counts as pen activity (palm rejection).
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'pen') V.lastPen = performance.now();
  }, { passive: true });

  window.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => {
    if (!V) return;
    clearTimeout(V.resizeTimer);
    V.resizeTimer = setTimeout(() => {
      if (!V) return;
      const { w, hgt } = stageBox();
      if (V.lastSize && V.lastSize.w === w && V.lastSize.hgt === hgt) return;
      relayout();
    }, 120);
  });
  ro.observe(stage);
  const unsub = subscribe((what) => {
    if (what === 'settings' && V) {
      applyViewerTheme();
      relayout();
    }
  });
  const unTheme = onThemeChange(applyViewerTheme);
  V.cleanup.push(
    () => window.removeEventListener('keydown', onKey),
    () => ro.disconnect(),
    unsub,
    unTheme,
    () => clearTimeout(V?.resizeTimer),
  );
  applyViewerTheme();
  updateTools();
  updateFsButton();
  stage.focus({ preventScroll: true });
}

function applyViewerTheme() {
  if (!V) return;
  V.el.classList.toggle('invert', isDark() && db.settings.invertSheets);
}

// ---------- layout ----------

const isLandscape = () => window.innerWidth >= window.innerHeight;
/** 'auto' | 'two' (always two pages) | 'pair2' (two pages only for 2-page pieces) | 'single' | 'width' */
function layoutMode() {
  return isLandscape() ? db.settings.landscapeLayout : db.settings.portraitLayout;
}
const pieceAt = (qi) => pieceById(V.queue[qi].pieceId);

function stageBox() {
  return { w: V.stage.clientWidth, hgt: V.stage.clientHeight };
}
function avail() {
  const { w, hgt } = stageBox();
  return { aw: Math.max(60, w - 2 * PAD), ah: Math.max(60, hgt - 2 * PAD) };
}
const fitScale = (v, w, hgt) => Math.min(w / v.dw, hgt / v.dh);

function viewsFor(refs) {
  return Promise.all(refs.map((r) => pageView(r, db.settings.autoCrop).catch((err) => {
    console.error('Seite nicht lesbar', err);
    return FALLBACK_VIEW;
  })));
}

/**
 * 'row' (side by side) | 'column' (stacked) – whichever keeps the pages larger.
 * Returns null if even that shrinks a page below `minRatio` of its single-page size.
 */
function pairDirection(a, b, minRatio = PAIR_THRESHOLD) {
  const { aw, ah } = avail();
  const sa = fitScale(a, aw, ah);
  const sb = fitScale(b, aw, ah);
  const halfW = (aw - GAP) / 2;
  const halfH = (ah - GAP) / 2;
  const row = Math.min(fitScale(a, halfW, ah) / sa, fitScale(b, halfW, ah) / sb);
  const column = Math.min(fitScale(a, aw, halfH) / sa, fitScale(b, aw, halfH) / sb);
  if (Math.max(row, column) < minRatio) return null;
  return row >= column ? 'row' : 'column';
}

/** Splits a piece's pages into screens: [{ idx: [i] | [i, i+1], dir }]. Cached per layout. */
function screensOf(qi) {
  const piece = pieceAt(qi);
  const key = `${piece.id}|${activePart(piece).id}`;
  let p = V.screens.get(key);
  if (!p) {
    p = (async () => {
      const pages = pagesOf(piece);
      const mode = layoutMode();
      const singles = () => pages.map((_, i) => ({ idx: [i], dir: 'single' }));
      if (pages.length < 2 || mode === 'single' || mode === 'width') return singles();
      if (mode === 'pair2' && pages.length !== 2) return singles();
      const views = await viewsFor(pages);
      // 'two' and 'pair2' always pair; 'auto' only when the pages stay large enough.
      const minRatio = mode === 'auto' ? PAIR_THRESHOLD : 0;
      const out = [];
      for (let i = 0; i < pages.length;) {
        const dir = i + 1 < pages.length ? pairDirection(views[i], views[i + 1], minRatio) : null;
        if (dir) {
          out.push({ idx: [i, i + 1], dir });
          i += 2;
        } else {
          out.push({ idx: [i], dir: 'single' });
          i += 1;
        }
      }
      return out;
    })();
    V.screens.set(key, p);
  }
  return p;
}

const screenIndex = (screens, pi) => Math.max(0, screens.findIndex((s) => s.idx.includes(pi)));

function relayout() {
  if (!V) return;
  V.screens.clear();
  show({ keepScroll: true });
}

function layoutBoxes(views, dir, mode) {
  const { aw, ah } = avail();
  const box = (v, s) => ({ w: Math.max(1, Math.floor(v.dw * s)), h: Math.max(1, Math.floor(v.dh * s)) });
  if (mode === 'width') return views.map((v) => box(v, aw / v.dw));
  if (views.length === 2) {
    const cw = dir === 'row' ? (aw - GAP) / 2 : aw;
    const ch = dir === 'row' ? ah : (ah - GAP) / 2;
    return views.map((v) => box(v, fitScale(v, cw, ch)));
  }
  return [box(views[0], fitScale(views[0], aw, ah))];
}

/** Next/previous screen position, or null at the ends of the queue. */
async function step(pos, dir) {
  const screens = await screensOf(pos.qi);
  const si = screenIndex(screens, pos.pi);
  if (dir > 0) {
    if (si + 1 < screens.length) return { qi: pos.qi, pi: screens[si + 1].idx[0] };
    if (pos.qi + 1 < V.queue.length) return { qi: pos.qi + 1, pi: 0 };
    return null;
  }
  if (si > 0) return { qi: pos.qi, pi: screens[si - 1].idx[0] };
  if (pos.qi > 0) {
    const before = await screensOf(pos.qi - 1);
    return { qi: pos.qi - 1, pi: before[before.length - 1].idx[0] };
  }
  return null;
}

// ---------- showing pages ----------

async function show({ keepScroll = false } = {}) {
  const v = V;
  const token = ++v.showToken;
  const alive = () => V === v && token === v.showToken;
  const mode = layoutMode();
  const piece = pieceAt(v.qi);
  const scrollRatio = keepScroll && v.stage.scrollHeight > 0 ? v.stage.scrollTop / v.stage.scrollHeight : 0;
  const spinnerTimer = setTimeout(() => alive() && v.el.classList.add('loading'), 200);
  try {
    const screens = await screensOf(v.qi);
    if (!alive()) return;
    const screen = screens[screenIndex(screens, Math.min(v.pi, pagesOf(piece).length - 1))];
    v.pi = screen.idx[0];
    v.screen = screen;
    updateInfo(screens);
    const refs = screen.idx.map((i) => pagesOf(piece)[i]);
    const views = harmonizeViews(await viewsFor(refs));
    if (!alive()) return;
    const boxes = layoutBoxes(views, screen.dir, mode);
    const dpr = window.devicePixelRatio || 1;
    const [canvases, ann] = await Promise.all([
      Promise.all(refs.map((r, i) => renderView(r, views[i], boxes[i].w, dpr).catch((err) => {
        console.error('Seite konnte nicht gerendert werden', err);
        return null;
      }))),
      ink.load(piece.id),
    ]);
    if (!alive()) return;
    mount(piece, refs, views, boxes, canvases, ann, screen.dir, mode, dpr);
    v.stage.scrollTop = scrollRatio * v.stage.scrollHeight;
  } finally {
    clearTimeout(spinnerTimer);
    if (alive()) v.el.classList.remove('loading');
  }
  if (alive()) prefetch(v, token, mode);
}

function mount(piece, refs, views, boxes, canvases, ann, dir, mode, dpr) {
  const spread = h(`div.spread.${dir === 'column' ? 'column' : 'row'}`);
  V.slots = refs.map((ref, i) => {
    const box = boxes[i];
    const view = views[i];
    const wrap = h('div.page', { style: { width: `${box.w}px`, height: `${box.h}px` } });
    const sheet = canvases[i];
    if (sheet) {
      sheet.className = 'sheet';
      wrap.append(sheet);
    } else {
      wrap.append(h('div.page-error', null, icon('info'), h('span', null, 'Seite konnte nicht geladen werden')));
    }
    const inkCanvas = h('canvas.ink');
    inkCanvas.width = Math.round(box.w * dpr);
    inkCanvas.height = Math.round(box.h * dpr);
    wrap.append(inkCanvas);
    const ctx = inkCanvas.getContext('2d', { desynchronized: true });
    // Full unrotated page size in CSS px, and the transform onto this box.
    const k = box.w / view.dw;
    const Wo = view.w0 * k;
    const Ho = view.h0 * k;
    const slot = {
      ref, view, pieceId: piece.id, pageId: ref.id, wrap, inkCanvas, ctx, w: box.w, h: box.h, dpr,
      geom: { m: viewTransform(view, Wo, Ho).m, Wo, Ho },
      strokes: ink.strokesOf(ann, ref.id),
    };
    redrawSlot(slot);
    spread.append(wrap);
    return slot;
  });
  V.stage.classList.toggle('scroll', mode === 'width');
  V.stage.replaceChildren(spread);
  const { w, hgt } = stageBox();
  V.lastSize = { w, hgt };
}

function redrawSlot(slot) {
  ink.redraw(slot.inkCanvas, slot.strokes, slot.geom, slot.dpr);
}

/** Renders the next two screens and the previous one in the background. */
async function prefetch(v, token, mode) {
  const here = { qi: v.qi, pi: v.pi };
  const stillCurrent = () => V === v && token === v.showToken;
  try {
    const n1 = await step(here, 1);
    const n2 = n1 && stillCurrent() ? await step(n1, 1) : null;
    const p1 = stillCurrent() ? await step(here, -1) : null;
    for (const pos of [n1, n2, p1]) {
      if (!pos || !stillCurrent()) return;
      const piece = pieceAt(pos.qi);
      const screens = await screensOf(pos.qi);
      const screen = screens[screenIndex(screens, pos.pi)];
      const refs = screen.idx.map((i) => pagesOf(piece)[i]);
      const views = harmonizeViews(await viewsFor(refs));
      if (!stillCurrent()) return;
      const boxes = layoutBoxes(views, screen.dir, mode);
      await Promise.all(refs.map((r, i) => renderView(r, views[i], boxes[i].w).catch(() => {})));
      ink.load(piece.id);
    }
  } catch { /* shown as error when navigated to */ }
}

function itemLabel(q, piece) {
  return q.number ? `Nr. ${q.number} · ${piece.title}` : piece.title;
}

function updateInfo(screens) {
  const q = V.queue[V.qi];
  const piece = pieceById(q.pieceId);
  V.titleEl.replaceChildren(h('span.v-name', null, piece.title));
  if (q.number) V.titleEl.prepend(h('span.v-nr', null, q.number));

  const n = pagesOf(piece).length;
  const idx = V.screen.idx;
  const from = idx[0] + 1;
  const to = idx[idx.length - 1] + 1;
  const pages = n === 1 ? '1 Seite' : to > from ? `Seiten ${from}–${to} von ${n}` : `Seite ${from} von ${n}`;
  const where = q.inserted ? 'eingeschoben' : `Stück ${V.qi + 1} von ${V.queue.length}`;
  const main = `${pages} · ${where}${V.context.name ? ` · ${V.context.name}` : ''}`;
  const onLast = screens[screens.length - 1] === V.screen;
  let nextText = '';
  if (db.settings.showNextHint && onLast) {
    const nx = V.queue[V.qi + 1];
    if (nx) nextText = itemLabel(nx, pieceById(nx.pieceId));
    else if (V.context.kind === 'setlist') nextText = 'Ende der Setlist';
  }
  V.subEl.classList.toggle('has-next', !!nextText);
  V.subEl.replaceChildren(h('span.v-sub-main', null, main));
  if (nextText) V.subEl.append(h('span.v-sub-next', null, `${n > 1 ? 'Letzte Seite' : '1 Seite'} · Als Nächstes: ${nextText}`));

  const parts = piece.parts;
  V.partBtn.hidden = parts.length < 2;
  if (parts.length > 1) {
    V.partBtn.replaceChildren(icon('layers'), h('span.v-part-name', null, activePart(piece).name), h('span.v-part-count', null, `${(piece.part || 0) + 1}/${parts.length}`));
  }
}

function flashMessage(text) {
  V.flash.textContent = text;
  V.flash.classList.remove('show');
  void V.flash.offsetWidth;
  V.flash.classList.add('show');
}

// ---------- navigation ----------

/** Navigation steps are async (page sizes) – run them one after another so quick taps all count. */
function enqueue(fn) {
  const v = V;
  v.nav = v.nav.then(() => (V === v ? fn() : null)).catch((err) => console.error(err));
}

export function next() {
  if (!V) return;
  enqueue(async () => {
    if (layoutMode() === 'width') {
      const st = V.stage;
      const max = st.scrollHeight - st.clientHeight;
      if (st.scrollTop < max - 4) {
        st.scrollTop = Math.min(max, st.scrollTop + st.clientHeight * 0.85);
        return;
      }
    }
    const pos = await step({ qi: V.qi, pi: V.pi }, 1);
    if (!V) return;
    if (!pos) {
      flashMessage(V.context.kind === 'setlist' ? 'Ende der Setlist' : 'Letztes Stück');
      return;
    }
    V.qi = pos.qi;
    V.pi = pos.pi;
    show();
  });
}

export function prev() {
  if (!V) return;
  enqueue(async () => {
    if (layoutMode() === 'width' && V.stage.scrollTop > 4) {
      V.stage.scrollTop = Math.max(0, V.stage.scrollTop - V.stage.clientHeight * 0.85);
      return;
    }
    const pos = await step({ qi: V.qi, pi: V.pi }, -1);
    if (!V) return;
    if (!pos) {
      flashMessage('Anfang');
      return;
    }
    V.qi = pos.qi;
    V.pi = pos.pi;
    show();
  });
}

function goTo(qi, pi = 0) {
  V.qi = qi;
  V.pi = pi;
  show();
}

/** Jumps to a piece; if it isn't in the current queue it is inserted after the current one. */
function playPiece(pieceId, number = '') {
  const piece = pieceById(pieceId);
  if (!V || !piece || !pagesOf(piece).length) return;
  let idx = V.queue.findIndex((q) => q.pieceId === pieceId);
  if (idx < 0) {
    idx = V.qi + 1;
    V.queue.splice(idx, 0, { pieceId, number, inserted: true });
    toast(`„${piece.title}“ eingeschoben`);
  }
  goTo(idx);
}

function openViewerSearch() {
  openSearch({
    title: 'Stück suchen',
    onPiece: (id) => playPiece(id),
    onEntry: (s, e) => playPiece(e.pieceId, e.number),
  });
}

function onKey(e) {
  if (!V || hasOpenModal()) return;
  if (e.target.closest?.('input, textarea, select')) return;
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'f') {
    e.preventDefault();
    openViewerSearch();
  } else if (e.ctrlKey || e.altKey || e.metaKey) {
    // leave other shortcuts alone
  } else if (NEXT_KEYS.has(k)) {
    e.preventDefault();
    next();
  } else if (PREV_KEYS.has(k)) {
    e.preventDefault();
    prev();
  } else if (k === 'Home') {
    e.preventDefault();
    goTo(V.qi, 0);
  } else if (k === 'Escape') {
    e.preventDefault();
    if (fullscreen) toggleFullscreen();
    else closeViewer();
  } else if (k === 'F11') {
    e.preventDefault();
    toggleFullscreen();
  } else if (k.toLowerCase() === 's') {
    e.preventDefault();
    cyclePart(1);
  } else if (/^[0-9]$/.test(k) && V.context.kind === 'setlist') {
    e.preventDefault();
    openJump(k);
  }
}

// ---------- parts (Stimmen) + rotation ----------

function setPart(index) {
  const piece = pieceAt(V.qi);
  if (piece.parts.length < 2) return;
  piece.part = (index + piece.parts.length) % piece.parts.length;
  commit('part');
  V.screens.clear();
  V.pi = Math.min(V.pi, pagesOf(piece).length - 1);
  show();
}

function cyclePart(dir) {
  const piece = pieceAt(V.qi);
  if (piece.parts.length < 2) {
    toast('Dieses Stück hat nur eine Stimme. Weitere verknüpfst du unter „Bearbeiten“.', { ms: 3200 });
    return;
  }
  setPart((piece.part || 0) + dir);
  toast(activePart(piece).name, { ms: 1200 });
}

function rotateVisible(delta) {
  if (!V?.slots.length) return;
  for (const slot of V.slots) {
    slot.ref.rot = (((slot.ref.rot || 0) + delta) % 360 + 360) % 360;
    if (!slot.ref.rot) delete slot.ref.rot;
  }
  commit('rotate');
  relayout();
}

// ---------- pointer input ----------

function slotAt(x, y, tolerance = 0) {
  for (const slot of V.slots) {
    const r = slot.inkCanvas.getBoundingClientRect();
    if (x >= r.left - tolerance && x <= r.right + tolerance && y >= r.top - tolerance && y <= r.bottom + tolerance) {
      return slot;
    }
  }
  return null;
}

function onPointerDown(e) {
  const now = performance.now();
  if (e.pointerType === 'pen') V.lastPen = now;
  if (e.pointerType === 'touch') V.touches.add(e.pointerId);
  closeMenu();

  const penWrites = e.pointerType === 'pen' && (db.settings.penAlwaysDraws || V.drawMode);
  const otherWrites = V.drawMode && e.pointerType !== 'pen' && e.button === 0;
  if (penWrites || otherWrites) {
    if (e.pointerType === 'touch' && V.touches.size > 1) return;
    if (V.active) return;
    const slot = slotAt(e.clientX, e.clientY, 24);
    if (!slot) return;
    e.preventDefault();
    try { V.stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) || (e.buttons & 2));
    V.active = {
      id: e.pointerId,
      slot,
      rect: slot.inkCanvas.getBoundingClientRect(),
      erase: V.eraser || !!penEraser,
      removed: [],
      stroke: null,
      last: null,
    };
    if (V.active.erase) {
      moveEraserCursor(e);
      eraseAt(e);
    } else {
      V.active.stroke = { c: V.color, w: ink.WIDTHS[db.settings.penWidth] || ink.WIDTHS.medium, p: [] };
      addPoint(e);
    }
    return;
  }

  if (e.pointerType === 'touch') {
    if (now - V.lastPen < PALM_GUARD_MS || V.touches.size > 1) {
      V.gesture = null;
      return;
    }
  }
  if (e.pointerType === 'mouse' && e.button === 2) {
    prev();
    return;
  }
  if (e.button !== 0) return;
  V.gesture = {
    id: e.pointerId,
    type: e.pointerType,
    x0: e.clientX,
    y0: e.clientY,
    t0: now,
    scroll0: V.stage.scrollTop,
    panning: false,
  };
}

function onPointerMove(e) {
  const a = V.active;
  if (a && e.pointerId === a.id) {
    const events = e.getCoalescedEvents?.() || [];
    const list = events.length ? events : [e];
    if (a.erase) {
      moveEraserCursor(e);
      for (const ev of list) eraseAt(ev);
    } else {
      for (const ev of list) addPoint(ev);
    }
    return;
  }
  const g = V.gesture;
  if (g && e.pointerId === g.id) {
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.panning && g.type === 'touch' && layoutMode() === 'width' && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
      g.panning = true;
    }
    if (g.panning) V.stage.scrollTop = g.scroll0 - dy;
  }
}

function onPointerUp(e) {
  if (e.pointerType === 'touch') V.touches.delete(e.pointerId);
  const a = V.active;
  if (a && e.pointerId === a.id) {
    finishActive();
    return;
  }
  const g = V.gesture;
  if (!g || e.pointerId !== g.id) return;
  V.gesture = null;
  if (g.panning) return;
  const now = performance.now();
  if (g.type === 'touch' && now - V.lastPen < PALM_GUARD_MS) return;
  const dx = e.clientX - g.x0;
  const dy = e.clientY - g.y0;
  const dt = now - g.t0;
  if (g.type === 'touch' && Math.abs(dx) > 60 && Math.abs(dx) > 1.4 * Math.abs(dy) && dt < 900) {
    if (dx < 0) next();
    else prev();
    return;
  }
  if (Math.hypot(dx, dy) <= (TAP_SLOP[g.type] ?? 10) && dt < 800) {
    const r = V.stage.getBoundingClientRect();
    if (db.settings.leftZoneBack && e.clientX < r.left + r.width * 0.25) prev();
    else next();
  }
}

function onPointerCancel(e) {
  if (e.pointerType === 'touch') V.touches.delete(e.pointerId);
  if (V.active && e.pointerId === V.active.id) finishActive();
  if (V.gesture && e.pointerId === V.gesture.id) V.gesture = null;
}

/** Pointer position in the slot: box px (for distances) and unrotated page px / fractions. */
function pagePoint(ev) {
  const { rect, slot } = V.active;
  const x = ((ev.clientX - rect.left) * slot.w) / rect.width;
  const y = ((ev.clientY - rect.top) * slot.h) / rect.height;
  const { X, Y } = toPagePixels(slot.view, slot.geom.Wo, slot.geom.Ho, x, y);
  return { x, y, X, Y, u: X / slot.geom.Wo, v: Y / slot.geom.Ho };
}

function addPoint(ev) {
  const a = V.active;
  const { x, y, u, v } = pagePoint(ev);
  if (a.last && Math.hypot(x - a.last[0], y - a.last[1]) < 0.7) return;
  a.last = [x, y];
  const pressure = ev.pointerType === 'pen' ? (ev.pressure > 0 ? ev.pressure : 0.5) : 0.5;
  const s = a.stroke;
  s.p.push(Math.round(u * 1e5) / 1e5, Math.round(v * 1e5) / 1e5, Math.round(pressure * 100) / 100);
  const n = s.p.length / 3;
  if (n >= 2) ink.drawStroke(a.slot.ctx, s, a.slot.geom.Wo, a.slot.geom.Ho, n - 1, false);
}

function eraseAt(ev) {
  const a = V.active;
  const { X, Y } = pagePoint(ev);
  const hits = ink.hitStrokes(a.slot.strokes, X, Y, a.slot.geom.Wo, a.slot.geom.Ho, ERASER_RADIUS);
  if (!hits.length) return;
  for (let i = hits.length - 1; i >= 0; i--) {
    const idx = hits[i];
    a.removed.push({ stroke: a.slot.strokes[idx], index: idx });
    a.slot.strokes.splice(idx, 1);
  }
  redrawSlot(a.slot);
}

function finishActive() {
  const a = V.active;
  V.active = null;
  V.eraserCursor.classList.remove('show');
  try { V.stage.releasePointerCapture(a.id); } catch { /* already released */ }
  const { slot } = a;
  if (a.erase) {
    if (a.removed.length) {
      pushUndo({ type: 'erase', pieceId: slot.pieceId, pageId: slot.pageId, items: a.removed });
      ink.save(slot.pieceId);
    }
  } else if (a.stroke.p.length) {
    slot.strokes.push(a.stroke);
    pushUndo({ type: 'add', pieceId: slot.pieceId, pageId: slot.pageId, stroke: a.stroke });
    ink.save(slot.pieceId);
  }
  redrawSlot(slot);
}

function moveEraserCursor(e) {
  const c = V.eraserCursor;
  c.style.transform = `translate(${e.clientX - ERASER_RADIUS}px, ${e.clientY - ERASER_RADIUS}px)`;
  c.classList.add('show');
}

// ---------- tools ----------

function setColor(color) {
  V.color = color;
  V.eraser = false;
  updateTools();
}

function toggleEraser() {
  V.eraser = !V.eraser;
  updateTools();
}

function toggleDrawMode() {
  V.drawMode = !V.drawMode;
  updateTools();
  if (V.drawMode) toast('Zeichenmodus: Finger und Maus schreiben jetzt. Blättern über ◀ ▶ oder Tastatur.', { ms: 3200 });
}

function updateTools() {
  const t = V.tools;
  t.red.classList.toggle('active', !V.eraser && V.color === 'red');
  t.black.classList.toggle('active', !V.eraser && V.color === 'black');
  t.eraser.classList.toggle('active', V.eraser);
  t.draw.classList.toggle('active', V.drawMode);
  t.draw.setAttribute('aria-pressed', String(V.drawMode));
  t.undo.disabled = !V.undo.length;
  V.el.classList.toggle('draw-mode', V.drawMode);
}

function pushUndo(action) {
  V.undo.push(action);
  if (V.undo.length > 300) V.undo.shift();
  updateTools();
}

async function undo() {
  if (!V) return;
  const act = V.undo.pop();
  updateTools();
  if (!act) return;
  const ann = await ink.load(act.pieceId);
  if (!V) return;
  const strokes = ink.strokesOf(ann, act.pageId);
  if (act.type === 'add') {
    const i = strokes.lastIndexOf(act.stroke);
    if (i >= 0) strokes.splice(i, 1);
  } else if (act.type === 'erase') {
    for (let k = act.items.length - 1; k >= 0; k--) {
      const it = act.items[k];
      strokes.splice(Math.min(it.index, strokes.length), 0, it.stroke);
    }
  } else if (act.type === 'clear') {
    strokes.push(...act.strokes);
  }
  ink.save(act.pieceId);
  for (const slot of V.slots) if (slot.pageId === act.pageId) redrawSlot(slot);
}

async function clearVisible() {
  const slots = V.slots.filter((s) => s.strokes.length);
  if (!slots.length) return;
  const ok = await confirmDialog(
    slots.length > 1 ? 'Alle Anmerkungen auf den angezeigten Seiten löschen?' : 'Alle Anmerkungen auf dieser Seite löschen?',
    { title: 'Anmerkungen löschen', okLabel: 'Löschen', danger: true },
  );
  if (!ok || !V) return;
  for (const slot of slots) {
    pushUndo({ type: 'clear', pieceId: slot.pieceId, pageId: slot.pageId, strokes: slot.strokes.slice() });
    slot.strokes.length = 0;
    ink.save(slot.pieceId);
    redrawSlot(slot);
  }
}

// ---------- chrome ----------

async function toggleFullscreen() {
  fullscreen = await backend.setFullscreen(!fullscreen);
  updateFsButton();
}

function updateFsButton() {
  const b = V.fsBtn;
  b.replaceChildren(icon(fullscreen ? 'fullscreenExit' : 'fullscreen'));
  b.title = fullscreen ? 'Vollbild beenden (F11)' : 'Vollbild (F11)';
}

function setBarHidden(hidden) {
  V.el.classList.toggle('bar-hidden', hidden);
  if (hidden) toast('Leiste ausgeblendet – oben rechts wieder einblenden.', { ms: 2400 });
}

function openMore(anchor) {
  const land = isLandscape();
  const key = land ? 'landscapeLayout' : 'portraitLayout';
  const cur = layoutMode();
  const setLayout = (value) => {
    db.settings[key] = value;
    commit('settings');
  };
  const piece = pieceAt(V.qi);
  const partItems = piece.parts.length > 1
    ? [{ heading: 'Stimme' }, ...piece.parts.map((p, i) => ({
      label: p.name, icon: 'layers', checked: i === (piece.part || 0), onClick: () => setPart(i),
    })), 'sep']
    : [];
  popMenu(anchor, [
    ...partItems,
    { heading: land ? 'Ansicht im Querformat' : 'Ansicht im Hochformat' },
    { label: 'Automatisch (Bildschirm füllen)', icon: 'auto', checked: cur === 'auto', onClick: () => setLayout('auto') },
    { label: 'Immer zwei Seiten', icon: 'two', checked: cur === 'two', onClick: () => setLayout('two') },
    { label: 'Zwei Seiten nur bei 2-seitigen Stücken', icon: 'two', checked: cur === 'pair2', onClick: () => setLayout('pair2') },
    { label: 'Immer eine Seite', icon: 'single', checked: cur === 'single', onClick: () => setLayout('single') },
    { label: 'Seitenbreite (scrollen)', icon: 'width', checked: cur === 'width', onClick: () => setLayout('width') },
    {
      label: 'Weiße Ränder abschneiden',
      icon: 'crop',
      checked: db.settings.autoCrop,
      onClick: () => {
        db.settings.autoCrop = !db.settings.autoCrop;
        commit('settings');
      },
    },
    { label: 'Seite nach links drehen', icon: 'rotateLeft', onClick: () => rotateVisible(-90) },
    { label: 'Seite nach rechts drehen', icon: 'rotateRight', onClick: () => rotateVisible(90) },
    'sep',
    { label: 'Dunkelmodus', icon: 'moon', checked: isDark(), onClick: toggleDark },
    {
      label: 'Noten im Dunkelmodus invertieren',
      icon: 'invert',
      checked: db.settings.invertSheets,
      onClick: () => {
        db.settings.invertSheets = !db.settings.invertSheets;
        commit('settings');
      },
    },
    { label: fullscreen ? 'Vollbild beenden' : 'Vollbild', icon: fullscreen ? 'fullscreenExit' : 'fullscreen', onClick: toggleFullscreen },
    'sep',
    {
      label: 'Anmerkungen hier löschen',
      icon: 'trash',
      danger: true,
      disabled: !V.slots.some((s) => s.strokes.length),
      onClick: clearVisible,
    },
    { label: 'Leiste ausblenden', icon: 'hideBar', onClick: () => setBarHidden(true) },
    { label: 'Einstellungen …', icon: 'settings', onClick: () => openSettings() },
  ]);
}

/** Piece picker; in setlists with a number keypad (initial = first typed digit). */
function openJump(initial = null) {
  const withPad = V.context.kind === 'setlist';
  let typed = withPad && initial ? initial : '';
  const display = h('div.kp-display');
  const list = h('div.jump-list');

  const matches = () => V.queue
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => !typed || String(q.number).startsWith(typed));

  const render = () => {
    display.textContent = typed || 'Nr.';
    display.classList.toggle('empty', !typed);
    const found = matches();
    list.replaceChildren(...found.map(({ q, i }) => {
      const piece = pieceById(q.pieceId);
      return h(`button.jump-item${i === V.qi ? '.current' : ''}`, {
        type: 'button',
        onclick: () => {
          m.close();
          goTo(i);
        },
      },
      h('span.jump-nr', null, q.number || '–'),
      h('span.jump-title', null, piece.title),
      h('span.jump-pages', null, `${pagesOf(piece).length} S.`));
    }));
    if (!found.length) list.append(h('div.jump-empty', null, `Keine Nr. ${typed} in dieser Setlist.`));
  };
  const press = (d) => {
    if (typed.length < 5) typed += d;
    render();
  };
  const backspace = () => {
    typed = typed.slice(0, -1);
    render();
  };
  const go = () => {
    if (!typed) return;
    const exact = V.queue.findIndex((q) => String(q.number) === typed);
    const first = matches()[0];
    const idx = exact >= 0 ? exact : first ? first.i : -1;
    if (idx < 0) {
      toast(`Nr. ${typed} ist nicht in dieser Setlist.`);
      return;
    }
    m.close();
    goTo(idx);
  };
  const onKeyPad = (e) => {
    if (!withPad) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') backspace();
    else if (e.key === 'Enter') go();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const keypad = withPad
    ? h('div.keypad', null,
      display,
      h('div.kp-grid', null,
        ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => h('button.kp-key', { type: 'button', onclick: () => press(d) }, d)),
        h('button.kp-key.kp-fn', { type: 'button', 'aria-label': 'Löschen', onclick: backspace }, icon('backspace')),
        h('button.kp-key', { type: 'button', onclick: () => press('0') }, '0'),
        h('button.kp-key.kp-go', { type: 'button', onclick: go }, 'OK')))
    : null;

  window.addEventListener('keydown', onKeyPad, true);
  const m = modal({
    title: withPad ? 'Nummer / Stück wählen' : 'Stück wählen',
    className: `jump-modal${withPad ? ' with-pad' : ''}`,
    body: h('div.jump', null, keypad, list),
    onClose: () => window.removeEventListener('keydown', onKeyPad, true),
  });
  render();
  list.querySelector('.current')?.scrollIntoView({ block: 'center' });
}
