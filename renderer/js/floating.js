// Small things floating over the sheet (tuner, metronome): drag to move; the corner, two fingers or the
// mouse wheel change the size (a font size in px, remembered per device with persist() – no re-render).
// Pointer events end here, so nothing underneath turns the page. On buttons and fields a press only
// becomes a drag once it moves a few pixels; then the click it would have made is swallowed.

import { db, persist } from './store.js';

const DRAG_SLOP = 6; // px before a press on a control counts as a drag
const isControl = (t) => !!(t && t.closest && t.closest('button, input'));

/**
 * Makes `el` float in `parent` at (left, top). `grip` is the resize corner, `sizeKey` the setting with the size.
 * Returns { place(x, y), keepBelow(minTop), clamp(), onGesture(fn) } – onGesture runs when a drag or pinch starts
 * (e.g. to cancel a held button).
 */
export function makeFloating({
  el, parent, grip, left = 12, top = 12, sizeKey, min = 14, max = 200, fallback = 40,
}) {
  const clampSize = (v) => Math.max(min, Math.min(max, Math.round(Number(v) || fallback)));
  let size = clampSize(db.settings[sizeKey]);
  const gestureFns = [];

  const place = (x, y) => {
    const maxX = Math.max(0, parent.clientWidth - el.offsetWidth);
    const maxY = Math.max(0, parent.clientHeight - el.offsetHeight);
    el.style.left = `${Math.round(Math.max(0, Math.min(maxX, x)))}px`;
    el.style.top = `${Math.round(Math.max(0, Math.min(maxY, y)))}px`;
  };
  const resize = (s) => {
    size = clampSize(s);
    el.style.fontSize = `${size}px`;
    place(el.offsetLeft, el.offsetTop);
  };
  const save = () => {
    if (db.settings[sizeKey] === size) return;
    db.settings[sizeKey] = size;
    persist(); // no re-render of the pages
  };
  el.style.fontSize = `${size}px`;
  parent.append(el);
  place(left, top);

  // one pointer: move (or resize on the corner); two pointers: pinch
  const pts = new Map();
  let mode = null; // 'move' | 'size' | 'pinch' | 'press' (on a control, not moved yet)
  let from = null;
  let swallowClick = false;
  const spread = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  const capture = (id) => {
    try {
      el.setPointerCapture(id);
    } catch { /* synthetic pointers in tests */ }
  };
  const gesture = () => {
    swallowClick = true;
    gestureFns.forEach((fn) => fn());
  };
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const onControl = isControl(e.target);
    if (!onControl) e.preventDefault(); // a control still needs its press (focus, click)
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      mode = 'pinch';
      from = { size, d: spread() };
      for (const id of pts.keys()) capture(id);
      gesture();
    } else if (pts.size === 1) {
      swallowClick = false;
      mode = e.target === grip ? 'size' : onControl ? 'press' : 'move';
      from = {
        x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop, size, h: el.offsetHeight || size,
      };
      if (mode !== 'press') capture(e.pointerId);
    }
    if (mode !== 'press') el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    e.stopPropagation();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'press' && Math.hypot(e.clientX - from.x, e.clientY - from.y) > DRAG_SLOP) {
      mode = 'move';
      capture(e.pointerId);
      el.classList.add('dragging');
      gesture();
    }
    if (mode === 'pinch') {
      if (pts.size >= 2) resize(from.size * (spread() / from.d));
    } else if (mode === 'move') {
      place(from.left + e.clientX - from.x, from.top + e.clientY - from.y);
    } else if (mode === 'size') {
      resize(from.size * (1 + (e.clientX - from.x + e.clientY - from.y) / 2 / from.h));
    }
  });
  const up = (e) => {
    if (!pts.delete(e.pointerId)) return;
    e.stopPropagation();
    if (pts.size) return; // two fingers → one: wait for the last one
    if (mode === 'size' || mode === 'pinch') save();
    if (mode === 'move' && swallowClick && document.activeElement && el.contains(document.activeElement)) {
      document.activeElement.blur(); // dragged by the number field: no keyboard
    }
    mode = null;
    el.classList.remove('dragging');
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    resize(size * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    save();
  }, { passive: false });
  // after a drag, the button under the finger does nothing
  el.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // a tap on it never turns the page
  for (const type of ['click', 'dblclick', 'contextmenu']) {
    el.addEventListener(type, (e) => {
      if (type !== 'click' || !isControl(e.target)) e.preventDefault();
      e.stopPropagation();
    });
  }

  return {
    place,
    /** The toolbar came back: stay below it. */
    keepBelow(minTop) {
      if (el.offsetTop < minTop) place(el.offsetLeft, minTop);
    },
    clamp() {
      place(el.offsetLeft, el.offsetTop);
    },
    onGesture(fn) {
      gestureFns.push(fn);
    },
  };
}
