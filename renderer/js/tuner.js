// Tuner: the microphone signal, the pitch (YIN), the nearest note and how far off it is in cents.
// Kammerton (settings.tunerA4) and the instrument's key (settings.tunerTranspose) are remembered.
// detectPitch/noteFor are plain functions (test/tuner.js feeds them generated tones).
// Two faces: the dialog (openTuner) and just the cents on the sheet (startSheetTuner, viewer toolbar).

import { db, commit, persist } from './store.js';
import {
  h, fill, btn, modal,
} from './ui.js';

export const NOTE_NAMES = ['C', 'Cis', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'As', 'A', 'B', 'H'];
/** Written note = sounding note + semitones (B-Trompete: klingend B → notiert C). */
export const TRANSPOSE = { C: 0, B: 2, Es: 9, F: 7 };
export const A4_MIN = 415;
export const A4_MAX = 466;

/**
 * Pitch in Hz of a mono buffer, or null (too quiet or no clear pitch). YIN: the coarse search runs
 * at half the sample rate (cheap enough for the tablet), the result is refined at the full rate.
 */
export function detectPitch(buf, sampleRate, { minFreq = 27, maxFreq = 2200, threshold = 0.15, minRms = 0.004 } = {}) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < minRms) return null;

  const dec = sampleRate > 30000 ? 2 : 1;
  const n = Math.floor(buf.length / dec);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < dec; k++) sum += buf[i * dec + k];
    x[i] = sum / dec;
  }
  const sr = sampleRate / dec;
  const tauMin = Math.max(2, Math.floor(sr / maxFreq));
  const tauMax = Math.min(Math.ceil(sr / minFreq), Math.floor(n / 2));
  const W = n - tauMax;
  const d = new Float32Array(tauMax + 1);
  for (let t = 1; t <= tauMax; t++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const diff = x[j] - x[j + t];
      sum += diff * diff;
    }
    d[t] = sum;
  }
  // Cumulative mean normalised difference; the first dip below the threshold is the period.
  const cm = new Float32Array(tauMax + 1);
  let running = 0;
  for (let t = 1; t <= tauMax; t++) {
    running += d[t];
    cm[t] = running > 0 ? (d[t] * t) / running : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cm[t] < threshold) {
      while (t + 1 <= tauMax && cm[t + 1] < cm[t]) t += 1;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // Refine at the full rate around tau·dec: difference function, then a parabola through the minimum.
  const T0 = tau * dec;
  const span = dec + 1;
  const Wf = buf.length - (T0 + span + 1);
  if (Wf < T0) return sr / tau;
  const df = (t) => {
    let sum = 0;
    for (let j = 0; j < Wf; j++) {
      const diff = buf[j] - buf[j + t];
      sum += diff * diff;
    }
    return sum;
  };
  let best = T0;
  let bestVal = Infinity;
  const vals = new Map();
  for (let t = Math.max(2, T0 - span); t <= T0 + span; t++) {
    const v = df(t);
    vals.set(t, v);
    if (v < bestVal) {
      bestVal = v;
      best = t;
    }
  }
  const a = vals.get(best - 1) ?? df(best - 1);
  const b = bestVal;
  const c = vals.get(best + 1) ?? df(best + 1);
  const denom = a - 2 * b + c;
  const shift = denom > 0 ? (0.5 * (a - c)) / denom : 0;
  return sampleRate / (best + Math.max(-1, Math.min(1, shift)));
}

/** Nearest note for a frequency: German name and octave (written for the instrument), cents off. */
export function noteFor(freq, a4 = 440, transpose = 'C') {
  const midi = 69 + 12 * Math.log2(freq / a4);
  const nearest = Math.round(midi);
  const cents = Math.round((midi - nearest) * 1000) / 10;
  const written = nearest + (TRANSPOSE[transpose] || 0);
  return {
    name: NOTE_NAMES[((written % 12) + 12) % 12],
    octave: Math.floor(written / 12) - 1,
    cents,
    freq,
    target: a4 * 2 ** ((nearest - 69) / 12),
  };
}

const clampA4 = (v) => Math.max(A4_MIN, Math.min(A4_MAX, Math.round(Number(v) || 440)));

/** Why the microphone could not start, in words. */
export function micMessage(err) {
  return err && err.name === 'NotAllowedError'
    ? 'Kein Zugriff aufs Mikrofon – bitte in den Einstellungen des Geräts für Notenpult erlauben.'
    : 'Kein Mikrofon gefunden.';
}

/**
 * Listens to the microphone (or `stream`): onPitch(Hz) about 15 times a second with the median of the
 * last five measurements, onSilence() once after `holdMs` without a tone. Returns { stop }.
 */
export function listenPitch({
  stream = null, onPitch, onSilence = () => {}, onReady = () => {}, onError = () => {}, holdMs = 1500,
}) {
  let ctx = null;
  let raf = 0;
  let media = null;
  let stopped = false;
  let recent = [];
  let lastSeen = 0;
  let silent = true;
  const release = () => {
    cancelAnimationFrame(raf);
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
    if (media && !stream) media.getTracks().forEach((t) => t.stop());
  };
  (async () => {
    try {
      media = stream || await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (stopped) {
        release();
        return;
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      if (stopped) {
        release();
        return;
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      ctx.createMediaStreamSource(media).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const rate = ctx.sampleRate;
      onReady();
      let last = 0;
      const tick = (now) => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        if (now - last < 66) return; // ~15 measurements a second are plenty
        last = now;
        analyser.getFloatTimeDomainData(buf);
        const f = detectPitch(buf, rate);
        if (f) {
          recent.push(f);
          if (recent.length > 5) recent.shift();
          lastSeen = now;
          silent = false;
          onPitch([...recent].sort((p, q) => p - q)[Math.floor(recent.length / 2)]);
        } else if (!silent && now - lastSeen > holdMs) {
          silent = true;
          recent = [];
          onSilence();
        }
      };
      raf = requestAnimationFrame(tick);
    } catch (err) {
      console.warn('Stimmgerät', err);
      if (!stopped) onError(err);
    }
  })();
  return {
    stop() {
      stopped = true;
      release();
    },
  };
}

/**
 * The tuner dialog. `stream` replaces the microphone (tests feed a generated tone).
 * Returns { close } so the viewer can close it again.
 */
export function openTuner({ stream = null } = {}) {
  let shownCents = 0;

  const noteName = h('span.tuner-name', null, '–');
  const octave = h('span.tuner-octave');
  const name = h('div.tuner-note', null, noteName, octave);
  const hz = h('div.tuner-hz', null, ' ');
  const needle = h('div.tuner-needle');
  const meter = h('div.tuner-meter', null,
    h('div.tuner-zone'),
    ...[-50, -25, 0, 25, 50].map((c) => h('span.tuner-tick', { style: { left: `${50 + c}%` } }, c > 0 ? `+${c}` : String(c))),
    needle);
  const status = h('div.tuner-status', null, 'Mikrofon wird gestartet …');
  const a4Label = h('span.tuner-a4-value');
  const setA4 = (v) => {
    db.settings.tunerA4 = clampA4(v);
    commit('settings');
    a4Label.textContent = `${db.settings.tunerA4} Hz`;
  };
  setA4(db.settings.tunerA4 || 440);
  const transposeSeg = h('div.segmented.small', { role: 'radiogroup' });
  const renderTranspose = () => fill(transposeSeg, ...[['C', 'C (klingend)'], ['B', 'B'], ['Es', 'Es'], ['F', 'F']].map(([v, label]) => h(
    `button.seg${(db.settings.tunerTranspose || 'C') === v ? '.active' : ''}`,
    {
      type: 'button',
      onclick: () => {
        db.settings.tunerTranspose = v;
        commit('settings');
        renderTranspose();
      },
    },
    label,
  )));
  renderTranspose();

  const show = (freq) => {
    const note = noteFor(freq, db.settings.tunerA4, db.settings.tunerTranspose);
    noteName.textContent = note.name;
    name.dataset.note = note.name;
    octave.textContent = String(note.octave);
    shownCents += (note.cents - shownCents) * 0.35; // calm needle
    needle.style.left = `${50 + Math.max(-50, Math.min(50, shownCents))}%`;
    const inTune = Math.abs(note.cents) <= 5;
    name.classList.toggle('in-tune', inTune);
    needle.classList.toggle('in-tune', inTune);
    hz.textContent = `${freq.toFixed(1)} Hz · ${note.cents > 0 ? '+' : ''}${note.cents.toFixed(0)} Cent`;
    name.dataset.cents = String(note.cents);
    status.textContent = inTune ? 'Stimmt.' : note.cents < 0 ? 'Zu tief.' : 'Zu hoch.';
  };

  const listener = listenPitch({
    stream,
    onReady: () => { status.textContent = 'Spiel einen Ton.'; },
    onPitch: show,
    onSilence: () => { status.textContent = 'Spiel einen Ton.'; },
    onError: (err) => {
      status.textContent = micMessage(err);
      status.classList.add('error');
    },
  });

  const step = (d) => () => setA4(db.settings.tunerA4 + d);
  const m = modal({
    title: 'Stimmgerät',
    className: 'tuner-modal',
    body: h('div.tuner', null,
      name,
      hz,
      meter,
      status,
      h('div.tuner-row', null,
        h('span.tuner-label', null, 'Kammerton a¹'),
        h('div.tuner-a4', null,
          btn('−', step(-1), { title: 'Tiefer', 'aria-label': 'Kammerton tiefer' }),
          a4Label,
          btn('+', step(1), { title: 'Höher', 'aria-label': 'Kammerton höher' })),
        h('div.tuner-quick', null, [440, 441, 442, 443].map((v) => btn(String(v), () => setA4(v), { kind: 'ghost' })))),
      h('div.tuner-row', null, h('span.tuner-label', null, 'Anzeige für'), transposeSeg)),
    actions: [{ label: 'Fertig', kind: 'primary', value: true }],
    onClose: () => listener.stop(),
  });
  return m;
}

// ---------- the tuner on the sheet (viewer toolbar) ----------

/** On the sheet: within ± this many cents counts as in tune (green), beyond it red. */
export const SHEET_TOLERANCE = 10;
export const SHEET_SIZE_MIN = 14;
export const SHEET_SIZE_MAX = 200;
const clampSize = (v) => Math.max(SHEET_SIZE_MIN, Math.min(SHEET_SIZE_MAX, Math.round(Number(v) || 40)));

/** "+12¢", "−8¢" (a real minus), "±0¢". */
export function centsLabel(cents) {
  const c = Math.round(cents);
  return c === 0 ? '±0¢' : `${c > 0 ? '+' : '−'}${Math.abs(c)}¢`;
}

/**
 * Just the cents on the sheet – green within ±SHEET_TOLERANCE, red beyond, grey without a tone; no frame, no dialog. Drag to move; the corner, two fingers or
 * the mouse wheel change the size (remembered per device). Kammerton from the tuner (settings.tunerA4).
 * Appears at (left, top) in `parent`. Returns { el, stop, keepBelow(top), clamp() }.
 */
export function startSheetTuner({
  parent, left = 12, top = 12, stream = null, onError = () => {},
}) {
  const value = h('span.sheet-tuner-value', null, '—¢');
  const grip = h('span.sheet-tuner-grip', { 'aria-hidden': 'true' });
  const el = h('div.sheet-tuner.idle', {
    role: 'status',
    'aria-label': 'Stimmgerät auf dem Blatt',
    title: 'Stimmgerät – ziehen zum Verschieben; Ecke, zwei Finger oder Mausrad für die Größe',
  }, value, grip);
  let size = clampSize(db.settings.sheetTunerSize);
  let shown = null; // { midi, cents }: a calm number, starts fresh when the note changes

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
    if (db.settings.sheetTunerSize === size) return;
    db.settings.sheetTunerSize = size;
    persist(); // no re-render of the pages
  };
  el.style.fontSize = `${size}px`;
  parent.append(el);
  place(left, top);

  // one pointer: move (or resize on the corner); two pointers: pinch
  const pts = new Map();
  let mode = null;
  let from = null;
  const spread = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch { /* synthetic pointers in tests */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      mode = 'pinch';
      from = { size, d: spread() };
    } else if (pts.size === 1) {
      mode = e.target === grip ? 'size' : 'move';
      from = {
        x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop, size, h: el.offsetHeight || size,
      };
    }
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    e.stopPropagation();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
  // a tap on it never turns the page
  for (const type of ['click', 'dblclick', 'contextmenu']) {
    el.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  const listener = listenPitch({
    stream,
    holdMs: 1000,
    onPitch: (freq) => {
      const midi = 69 + 12 * Math.log2(freq / (db.settings.tunerA4 || 440));
      const nearest = Math.round(midi);
      const cents = (midi - nearest) * 100;
      shown = shown && shown.midi === nearest
        ? { midi: nearest, cents: shown.cents + (cents - shown.cents) * 0.5 }
        : { midi: nearest, cents };
      const c = Math.round(shown.cents);
      value.textContent = centsLabel(c);
      el.dataset.cents = String(c);
      const ok = Math.abs(c) <= SHEET_TOLERANCE; // the colour always matches the number shown
      el.classList.toggle('in-tune', ok);
      el.classList.toggle('off', !ok);
      el.classList.remove('idle');
    },
    onSilence: () => {
      shown = null;
      value.textContent = '—¢';
      delete el.dataset.cents;
      el.classList.remove('in-tune', 'off');
      el.classList.add('idle');
    },
    onError,
  });

  return {
    el,
    stop() {
      listener.stop();
      el.remove();
    },
    /** The toolbar came back: stay below it. */
    keepBelow(minTop) {
      if (el.offsetTop < minTop) place(el.offsetLeft, minTop);
    },
    clamp() {
      place(el.offsetLeft, el.offsetTop);
    },
  };
}
