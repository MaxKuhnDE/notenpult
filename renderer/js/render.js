// Page geometry + rendering of PDF pages and images into canvases, with caches
// so page turns are instant (the viewer prefetches upcoming pages).

import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
import { backend } from './store.js';

const VENDOR = new URL('../vendor/pdfjs/', import.meta.url);
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', VENDOR).href;

const DOC_OPTIONS = {
  cMapUrl: new URL('cmaps/', VENDOR).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('standard_fonts/', VENDOR).href,
  wasmUrl: new URL('wasm/', VENDOR).href,
  iccUrl: new URL('iccs/', VENDOR).href,
  isEvalSupported: false,
  enableXfa: false,
};

const MAX_PIXELS = 24e6;

export const isPdf = (file) => /\.pdf$/i.test(file);

class LRU {
  constructor(max, onEvict) {
    this.max = max;
    this.onEvict = onEvict;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const [k, v] = this.map.entries().next().value;
      this.map.delete(k);
      this.onEvict?.(v, k);
    }
  }
  delete(key) {
    this.map.delete(key);
  }
}

const docs = new LRU(8, (p) => p.then((d) => d.destroy()).catch(() => {}));
const bitmaps = new LRU(8, (p) => p.then((b) => b.close()).catch(() => {}));
const sizes = new Map();
const renders = new LRU(16);
const thumbs = new LRU(150);

function loadDoc(file) {
  let p = docs.get(file);
  if (!p) {
    p = backend.readFile(file).then((data) => pdfjsLib.getDocument({ ...DOC_OPTIONS, data: new Uint8Array(data) }).promise);
    docs.set(file, p);
    p.catch(() => docs.delete(file));
  }
  return p;
}

function loadBitmap(file) {
  let p = bitmaps.get(file);
  if (!p) {
    p = backend.readFile(file).then((data) => createImageBitmap(new Blob([data]), { imageOrientation: 'from-image' }));
    bitmaps.set(file, p);
    p.catch(() => bitmaps.delete(file));
  }
  return p;
}

/** Number of pages in an imported file (images count as one page). */
export async function countPages(file) {
  if (!isPdf(file)) {
    await loadBitmap(file);
    return 1;
  }
  const doc = await loadDoc(file);
  return doc.numPages;
}

/** Natural page size (PDF points or image pixels) as { w, h }. */
export function pageSize(ref) {
  const key = `${ref.file}#${ref.page}`;
  let p = sizes.get(key);
  if (!p) {
    p = (async () => {
      if (isPdf(ref.file)) {
        const doc = await loadDoc(ref.file);
        const page = await doc.getPage(ref.page);
        const vp = page.getViewport({ scale: 1 });
        return { w: vp.width, h: vp.height };
      }
      const bmp = await loadBitmap(ref.file);
      return { w: bmp.width, h: bmp.height };
    })();
    sizes.set(key, p);
    p.catch(() => sizes.delete(key));
  }
  return p;
}

// ---------- page views: rotation (0/90/180/270, clockwise) + crop ----------
//
// A view shows the crop rectangle [x, y, w, h] (fractions of the unrotated
// page) rotated by `rot`. Annotations are stored in unrotated full-page
// coordinates; viewTransform() maps those onto the displayed box.

export const FULL = [0, 0, 1, 1];
const CROP_VERSION = 1;

/**
 * Canvas transform from unrotated page pixels (page drawn at Wo × Ho) to the
 * displayed box; returns the matrix and the box size.
 */
export function viewTransform(view, Wo, Ho) {
  const [cx, cy, cw, ch] = view.crop;
  const ox = cx * Wo;
  const oy = cy * Ho;
  const W = cw * Wo;
  const H = ch * Ho;
  switch (view.rot) {
    case 90: return { m: [0, 1, -1, 0, oy + H, -ox], W: H, H: W };
    case 180: return { m: [-1, 0, 0, -1, ox + W, oy + H], W, H };
    case 270: return { m: [0, -1, 1, 0, -oy, ox + W], W: H, H: W };
    default: return { m: [1, 0, 0, 1, -ox, -oy], W, H };
  }
}

/** Inverse of viewTransform: displayed box point -> unrotated page pixels. */
export function toPagePixels(view, Wo, Ho, x, y) {
  const [cx, cy, cw, ch] = view.crop;
  const ox = cx * Wo;
  const oy = cy * Ho;
  const W = cw * Wo;
  const H = ch * Ho;
  switch (view.rot) {
    case 90: return { X: y + ox, Y: oy + H - x };
    case 180: return { X: ox + W - x, Y: oy + H - y };
    case 270: return { X: ox + W - y, Y: x + oy };
    default: return { X: x + ox, Y: y + oy };
  }
}

const normRot = (r) => ((Math.round((r || 0) / 90) * 90) % 360 + 360) % 360;

/** Finds the content area of a rendered page (non-white pixels) plus a small margin. */
function analyzeCrop(canvas) {
  const { width: w, height: hgt } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, w, hgt).data;
  const rows = new Uint32Array(hgt);
  const cols = new Uint32Array(w);
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < 170) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  const minRow = Math.max(2, w * 0.004);
  const minCol = Math.max(2, hgt * 0.004);
  let top = rows.findIndex((n) => n >= minRow);
  if (top < 0) return FULL;
  let bottom = hgt - 1;
  while (bottom > top && rows[bottom] < minRow) bottom--;
  let left = cols.findIndex((n) => n >= minCol);
  let right = w - 1;
  while (right > left && cols[right] < minCol) right--;
  const margin = Math.round(Math.max(w, hgt) * 0.02);
  top = Math.max(0, top - margin);
  left = Math.max(0, left - margin);
  bottom = Math.min(hgt - 1, bottom + margin);
  right = Math.min(w - 1, right + margin);
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const crop = [r4(left / w), r4(top / hgt), r4((right - left + 1) / w), r4((bottom - top + 1) / hgt)];
  // Not worth it for tiny margins (keeps normal sheets at their natural shape).
  return crop[2] * crop[3] > 0.9 ? FULL : crop;
}

const crops = new Map();
let onCropDetected = () => {};
export function setCropListener(fn) {
  onCropDetected = fn;
}

/** Content area of a page; cached in memory and on the page record (ref.crop). */
export function detectCrop(ref) {
  if (ref.crop && ref.crop.f === ref.file && ref.crop.v === CROP_VERSION) return Promise.resolve(ref.crop.r);
  const key = `${ref.file}#${ref.page}`;
  let p = crops.get(key);
  if (!p) {
    p = drawInto(ref, { rot: 0, crop: FULL }, 360).then(analyzeCrop);
    crops.set(key, p);
    p.catch(() => crops.delete(key));
  }
  return p.then((r) => {
    ref.crop = { f: ref.file, v: CROP_VERSION, r };
    onCropDetected();
    return r;
  });
}

/**
 * Everything needed to lay out a page: rotation, crop, natural page size
 * (w0, h0) and the displayed natural size (dw, dh).
 */
export async function pageView(ref, autoCrop = true) {
  const { w: w0, h: h0 } = await pageSize(ref);
  const rot = normRot(ref.rot);
  const crop = autoCrop ? await detectCrop(ref) : FULL;
  const cw = crop[2] * w0;
  const ch = crop[3] * h0;
  const turned = rot === 90 || rot === 270;
  return { rot, crop, w0, h0, dw: turned ? ch : cw, dh: turned ? cw : ch };
}

/**
 * Two pages shown together get the same (combined) crop when they have the
 * same format, so they appear equally large and aligned.
 */
export function harmonizeViews(views) {
  if (views.length !== 2) return views;
  const [a, b] = views;
  if (a.rot !== b.rot || Math.abs(a.w0 - b.w0) > 1 || Math.abs(a.h0 - b.h0) > 1) return views;
  const x = Math.min(a.crop[0], b.crop[0]);
  const y = Math.min(a.crop[1], b.crop[1]);
  const r = Math.max(a.crop[0] + a.crop[2], b.crop[0] + b.crop[2]);
  const btm = Math.max(a.crop[1] + a.crop[3], b.crop[1] + b.crop[3]);
  const crop = [x, y, r - x, btm - y];
  return views.map((v) => {
    const cw = crop[2] * v.w0;
    const ch = crop[3] * v.h0;
    const turned = v.rot === 90 || v.rot === 270;
    return { ...v, crop, dw: turned ? ch : cw, dh: turned ? cw : ch };
  });
}

async function drawInto(ref, view, pxWidth) {
  const { w: w0, h: h0 } = await pageSize(ref);
  const turned = view.rot === 90 || view.rot === 270;
  const dispW = (turned ? view.crop[3] * h0 : view.crop[2] * w0);
  const dispH = (turned ? view.crop[2] * w0 : view.crop[3] * h0);
  let k = pxWidth / dispW; // pixels per natural unit
  if (dispW * dispH * k * k > MAX_PIXELS) k = Math.sqrt(MAX_PIXELS / (dispW * dispH));
  const t = viewTransform(view, w0 * k, h0 * k);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(t.W));
  canvas.height = Math.max(1, Math.round(t.H));
  // Our own context with alpha: pdf.js would create an opaque one, on which
  // Chromium uses subpixel (colored) text antialiasing – that shows up as
  // colored fringes when sheets are inverted or the screen is rotated.
  const ctx = canvas.getContext('2d', { alpha: true });
  if (isPdf(ref.file)) {
    const doc = await loadDoc(ref.file);
    const page = await doc.getPage(ref.page);
    // pdf.js rotates itself (its `transform` must stay a pure translation,
    // it reads the diagonal as output scale); we only shift to the crop.
    const viewport = page.getViewport({ scale: k, rotation: (page.rotate + view.rot) % 360 });
    const Wo = w0 * k;
    const Ho = h0 * k;
    const ox = view.crop[0] * Wo;
    const oy = view.crop[1] * Ho;
    const cw = view.crop[2] * Wo;
    const ch = view.crop[3] * Ho;
    const shift = {
      0: [ox, oy], 90: [Ho - oy - ch, ox], 180: [Wo - ox - cw, Ho - oy - ch], 270: [oy, Wo - ox - cw],
    }[view.rot];
    await page.render({
      canvas: null, canvasContext: ctx, viewport, transform: [1, 0, 0, 1, -shift[0], -shift[1]], background: '#ffffff',
    }).promise;
    return canvas;
  }
  const bmp = await loadBitmap(ref.file);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(...t.m);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w0 * k, h0 * k);
  return canvas;
}

/**
 * Renders a page view for display at `cssWidth` CSS pixels. Returns a cached
 * canvas; the viewer inserts it directly (each page is shown at most once).
 */
export function renderView(ref, view, cssWidth, dpr = window.devicePixelRatio || 1) {
  const pxWidth = Math.max(1, Math.round(cssWidth * dpr));
  const key = `${ref.file}#${ref.page}|${view.rot}|${view.crop.join(',')}@${pxWidth}`;
  let p = renders.get(key);
  if (!p) {
    p = drawInto(ref, view, pxWidth);
    renders.set(key, p);
    p.catch(() => renders.delete(key));
  }
  return p;
}

/** Small (rotated, uncropped) preview; returns a fresh canvas each call. */
export async function thumbnail(ref, cssWidth = 120) {
  const pxWidth = Math.round(cssWidth * (window.devicePixelRatio || 1));
  const rot = normRot(ref.rot);
  const key = `${ref.file}#${ref.page}|${rot}@${pxWidth}`;
  let p = thumbs.get(key);
  if (!p) {
    p = drawInto(ref, { rot, crop: FULL }, pxWidth);
    thumbs.set(key, p);
    p.catch(() => thumbs.delete(key));
  }
  const src = await p;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  out.getContext('2d').drawImage(src, 0, 0);
  return out;
}
