// Pen annotations. Strokes are stored per piece and page in page-relative
// coordinates, so they stay in place at any zoom level or orientation.
//
// Stroke: { c: colour (COLORS), w: width relative to page width, p: [x, y, pressure, ...], m?: 1 (highlighter) }
// Text:   { t: 'text', text, x, y, s: size relative to page width, c, p: [], w: 0 }
// Stamp:  { t: 'stamp', k: kind (STAMPS), x, y, s, c, p: [], w: 0 }
// Text and stamps carry an empty p so that versions before 2.1 skip them instead of failing.

import { backend, isSavingSuspended } from './store.js';

export const COLORS = {
  red: '#d3221b', black: '#141414', blue: '#1d5fc7', green: '#1e8a3c', yellow: '#ffd21f',
};
export const WIDTHS = { fine: 0.0021, medium: 0.0033, bold: 0.0056 };
export const MARKER_WIDTH = 0.016;

/** Stamps: [kind, label in the palette, size relative to page width]. */
export const STAMPS = [
  ['pp', 'pp', 0.03], ['p', 'p', 0.03], ['mp', 'mp', 0.03], ['mf', 'mf', 0.03], ['f', 'f', 0.03], ['ff', 'ff', 0.03],
  ['fp', 'fp', 0.03], ['sfz', 'sfz', 0.03],
  ['cresc', 'Crescendo', 0.05], ['dim', 'Decrescendo', 0.05], ['accent', 'Akzent', 0.022], ['breath', 'Atemzeichen', 0.03],
  ['fermata', 'Fermate', 0.032], ['glasses', 'Brille (Achtung)', 0.05], ['coda', 'Coda', 0.034], ['circle', 'Kreis', 0.034],
];
const STAMP_SIZE = Object.fromEntries(STAMPS.map(([k, , size]) => [k, size]));
export const stampSize = (kind) => STAMP_SIZE[kind] || 0.03;
const DYNAMICS = new Set(['pp', 'p', 'mp', 'mf', 'f', 'ff', 'fp', 'sfz']);

const cache = new Map(); // pieceId -> Promise<{ pages: { [pageId]: Stroke[] } }>
const saveTimers = new Map();

export function load(pieceId) {
  let p = cache.get(pieceId);
  if (!p) {
    p = backend.loadAnn(pieceId)
      .then((data) => (data && data.pages ? data : { pages: {} }))
      .catch(() => ({ pages: {} }));
    cache.set(pieceId, p);
  }
  return p;
}

export function strokesOf(ann, pageId) {
  if (!ann.pages[pageId]) ann.pages[pageId] = [];
  return ann.pages[pageId];
}

export function save(pieceId) {
  clearTimeout(saveTimers.get(pieceId));
  saveTimers.set(pieceId, setTimeout(() => flush(pieceId), 250));
}

export async function flush(pieceId) {
  clearTimeout(saveTimers.get(pieceId));
  saveTimers.delete(pieceId);
  const ann = await cache.get(pieceId);
  if (!ann || isSavingSuspended()) return;
  // Serialize a copy without empty pages; the live arrays stay untouched
  // because the viewer holds references to them.
  const out = { pages: {} };
  for (const [k, v] of Object.entries(ann.pages)) if (v.length) out.pages[k] = v;
  await backend.saveAnn(pieceId, out).catch((err) => console.error('Anmerkungen nicht gespeichert', err));
}

export async function flushAll() {
  await Promise.all([...saveTimers.keys()].map(flush));
}

export async function remove(pieceId) {
  cache.delete(pieceId);
  clearTimeout(saveTimers.get(pieceId));
  saveTimers.delete(pieceId);
  await backend.deleteAnn(pieceId).catch(() => {});
}

/** Moves annotations of the given pages to another piece (used when splitting). */
export async function movePages(fromId, toId, pageIds) {
  const from = await load(fromId);
  const to = await load(toId);
  let moved = false;
  for (const id of pageIds) {
    if (from.pages[id]?.length) {
      to.pages[id] = from.pages[id];
      delete from.pages[id];
      moved = true;
    }
  }
  if (moved) {
    await flush(fromId);
    await flush(toId);
  }
}

export function hasAny(ann) {
  return Object.values(ann.pages).some((s) => s.length);
}

// ---------- drawing ----------

const pressureFactor = (p) => 0.45 + 1.1 * Math.min(1, Math.max(0, p));

function setStyle(ctx, s) {
  ctx.strokeStyle = COLORS[s.c] || COLORS.black;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** Highlighter: one translucent path, so overlapping segments don't get darker. */
export function drawMarker(ctx, s, W, H) {
  const p = s.p;
  const n = p.length / 3;
  if (!n) return;
  ctx.save();
  setStyle(ctx, s);
  ctx.globalAlpha = 0.38;
  ctx.lineWidth = s.w * W;
  ctx.beginPath();
  ctx.moveTo(p[0] * W, p[1] * H);
  for (let i = 1; i < n; i++) ctx.lineTo(p[i * 3] * W, p[i * 3 + 1] * H);
  if (n === 1) ctx.lineTo(p[0] * W + 0.1, p[1] * H);
  ctx.stroke();
  ctx.restore();
}

function drawText(ctx, s, W, H) {
  ctx.save();
  setStyle(ctx, s);
  ctx.font = `600 ${s.s * W}px "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(String(s.text || ''), s.x * W, s.y * H);
  ctx.restore();
}

function drawStamp(ctx, s, W, H) {
  const size = s.s * W;
  const x = s.x * W;
  const y = s.y * H;
  ctx.save();
  setStyle(ctx, s);
  ctx.lineWidth = Math.max(1, size * 0.09);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.beginPath();
  const k = s.k;
  if (DYNAMICS.has(k)) {
    ctx.font = `italic bold ${size * 1.25}px "Times New Roman", Georgia, "Noto Serif", serif`;
    ctx.fillText(k, x, y);
  } else if (k === 'breath') {
    ctx.font = `bold ${size * 1.6}px "Times New Roman", Georgia, serif`;
    ctx.fillText('\u2019', x, y + size * 0.2);
  } else if (k === 'cresc' || k === 'dim') {
    const w = size * 0.8;
    const hgt = size * 0.28;
    const [open, tip] = k === 'cresc' ? [x + w, x - w] : [x - w, x + w];
    ctx.moveTo(open, y - hgt);
    ctx.lineTo(tip, y);
    ctx.lineTo(open, y + hgt);
    ctx.stroke();
  } else if (k === 'accent') {
    ctx.moveTo(x - size * 0.5, y - size * 0.3);
    ctx.lineTo(x + size * 0.5, y);
    ctx.lineTo(x - size * 0.5, y + size * 0.3);
    ctx.stroke();
  } else if (k === 'fermata') {
    ctx.arc(x, y + size * 0.15, size * 0.5, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + size * 0.05, size * 0.09, 0, Math.PI * 2);
    ctx.fill();
  } else if (k === 'glasses') {
    const r = size * 0.24;
    ctx.arc(x - size * 0.32, y, r, 0, Math.PI * 2);
    ctx.moveTo(x + size * 0.32 + r, y);
    ctx.arc(x + size * 0.32, y, r, 0, Math.PI * 2);
    ctx.moveTo(x - size * 0.08, y - r * 0.2);
    ctx.quadraticCurveTo(x, y - r * 0.7, x + size * 0.08, y - r * 0.2);
    ctx.moveTo(x - size * 0.56, y - r * 0.3);
    ctx.lineTo(x - size * 0.68, y - r);
    ctx.moveTo(x + size * 0.56, y - r * 0.3);
    ctx.lineTo(x + size * 0.68, y - r);
    ctx.stroke();
  } else if (k === 'coda') {
    ctx.ellipse(x, y, size * 0.32, size * 0.42, 0, 0, Math.PI * 2);
    ctx.moveTo(x - size * 0.55, y);
    ctx.lineTo(x + size * 0.55, y);
    ctx.moveTo(x, y - size * 0.65);
    ctx.lineTo(x, y + size * 0.65);
    ctx.stroke();
  } else {
    ctx.arc(x, y, size * 0.75, 0, Math.PI * 2); // circle around a note
    ctx.stroke();
  }
  ctx.restore();
}

/** Any annotation item: stroke, highlighter, text or stamp. */
export function drawItem(ctx, s, W, H) {
  if (s.t === 'text') drawText(ctx, s, W, H);
  else if (s.t === 'stamp') drawStamp(ctx, s, W, H);
  else if (s.m) drawMarker(ctx, s, W, H);
  else drawStroke(ctx, s, W, H);
}

/**
 * Draws stroke segments [from, n) with midpoint smoothing. With `tail`, also
 * draws the final half segment to the last point (done when the stroke ends).
 */
export function drawStroke(ctx, s, W, H, from = 1, tail = true) {
  const p = s.p;
  const n = p.length / 3;
  if (!n) return;
  setStyle(ctx, s);
  const base = s.w * W;
  if (n === 1) {
    if (!tail) return;
    ctx.beginPath();
    ctx.arc(p[0] * W, p[1] * H, (base * pressureFactor(p[2])) / 2 + 0.3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = Math.max(1, from); i < n; i++) {
    const x0 = p[(i - 1) * 3] * W;
    const y0 = p[(i - 1) * 3 + 1] * H;
    const x1 = p[i * 3] * W;
    const y1 = p[i * 3 + 1] * H;
    ctx.lineWidth = base * pressureFactor((p[(i - 1) * 3 + 2] + p[i * 3 + 2]) / 2);
    ctx.beginPath();
    if (i === 1) {
      ctx.moveTo(x0, y0);
      ctx.lineTo((x0 + x1) / 2, (y0 + y1) / 2);
    } else {
      const xp = p[(i - 2) * 3] * W;
      const yp = p[(i - 2) * 3 + 1] * H;
      ctx.moveTo((xp + x0) / 2, (yp + y0) / 2);
      ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    ctx.stroke();
  }
  if (tail) {
    const xa = p[(n - 2) * 3] * W;
    const ya = p[(n - 2) * 3 + 1] * H;
    const xb = p[(n - 1) * 3] * W;
    const yb = p[(n - 1) * 3 + 1] * H;
    ctx.lineWidth = base * pressureFactor(p[(n - 1) * 3 + 2]);
    ctx.beginPath();
    ctx.moveTo((xa + xb) / 2, (ya + yb) / 2);
    ctx.lineTo(xb, yb);
    ctx.stroke();
  }
}

/**
 * Clears the ink canvas and draws all strokes. `geom` = { m, Wo, Ho }: the
 * full unrotated page size in CSS px and the transform onto the displayed
 * (cropped/rotated) box. Leaves that transform set for live drawing.
 */
export function redraw(canvas, strokes, geom, dpr) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const [a, b, c, d, e, f] = geom.m;
  ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
  // Highlighter below everything else, like on paper.
  for (const s of strokes) if (s.m) drawMarker(ctx, s, geom.Wo, geom.Ho);
  for (const s of strokes) if (!s.m) drawItem(ctx, s, geom.Wo, geom.Ho);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

/** Indices of strokes touched by an eraser at (x, y) CSS px with radius r. */
export function hitStrokes(strokes, x, y, W, H, r) {
  const hits = [];
  strokes.forEach((s, idx) => {
    if (s.t === 'text') {
      // Text starts at (x, y) and runs to the right (about 0.55 × size per character).
      const half = (s.s * W) / 2;
      const width = String(s.text || '').length * s.s * W * 0.55;
      if (x >= s.x * W - r && x <= s.x * W + width + r && Math.abs(y - s.y * H) <= half + r) hits.push(idx);
      return;
    }
    if (s.t) {
      if (Math.hypot(s.x * W - x, s.y * H - y) <= r + s.s * W * 0.8) hits.push(idx);
      return;
    }
    const p = s.p;
    const n = p.length / 3;
    const reach = r + (s.w * W) / 2;
    if (n === 1) {
      if (Math.hypot(p[0] * W - x, p[1] * H - y) <= reach) hits.push(idx);
      return;
    }
    for (let i = 1; i < n; i++) {
      if (distToSegment(x, y, p[(i - 1) * 3] * W, p[(i - 1) * 3 + 1] * H, p[i * 3] * W, p[i * 3 + 1] * H) <= reach) {
        hits.push(idx);
        return;
      }
    }
  });
  return hits;
}
