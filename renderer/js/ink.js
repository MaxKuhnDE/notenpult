// Pen annotations. Strokes are stored per piece and page in page-relative
// coordinates, so they stay in place at any zoom level or orientation.
//
// Stroke: { c: 'red' | 'black', w: width relative to page width, p: [x, y, pressure, ...] }

import { backend } from './store.js';

export const COLORS = { red: '#d3221b', black: '#141414' };
export const WIDTHS = { fine: 0.0021, medium: 0.0033, bold: 0.0056 };

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
  if (!ann) return;
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
  for (const s of strokes) drawStroke(ctx, s, geom.Wo, geom.Ho);
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
