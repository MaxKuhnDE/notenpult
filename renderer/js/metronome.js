// Metronome on the sheet (viewer toolbar): − / tempo / + and one button for start and stop. The tempo field
// takes the keyboard (tap it, type, Enter). Clicks are scheduled ahead on the Web Audio clock, so they stay
// exact even when the page is busy drawing; the number pulses on every beat. Tempo and size are per device.

import { db, persist } from './store.js';
import { h, icon } from './ui.js';
import { makeFloating } from './floating.js';

export const BPM_MIN = 20;
export const BPM_MAX = 300;
export const METRONOME_SIZE_MIN = 14;
export const METRONOME_SIZE_MAX = 120;
const LOOKAHEAD_S = 0.12; // clicks are put on the audio clock this far ahead
const TICK_MS = 25; // how often the scheduler looks
const HOLD_MS = 450; // holding − / + : repeat after this …
const REPEAT_MS = 70; // … this often

/** A whole number of beats per minute within BPM_MIN … BPM_MAX; NaN/empty → null. */
export function clampBpm(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || String(v).trim() === '') return null;
  return Math.max(BPM_MIN, Math.min(BPM_MAX, n));
}

/** One short click at `time` on the audio clock, into `out`. */
function click(ac, out, time) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 1600;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.9, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  osc.connect(gain).connect(out);
  osc.start(time);
  osc.stop(time + 0.06);
}

/**
 * Shows the metronome at (left, top) in `parent`, stopped. Returns
 * { el, start(), pause(), toggle(), running, bpm, setBpm(n), beats (audio times of the clicks so far), stop(), place, keepBelow, clamp }.
 */
export function startSheetMetronome({ parent, left = 12, top = 12 }) {
  let bpm = clampBpm(db.settings.metronomeBpm) || 120;
  let running = false;
  let ac = null;
  let out = null; // one gain per run: stopping drops the clicks already on the clock
  let timer = null;
  let nextAt = 0;
  const beats = [];
  const flashTimers = new Set();

  const field = h('input.metro-bpm', {
    type: 'text',
    inputmode: 'numeric',
    enterkeyhint: 'done',
    autocomplete: 'off',
    maxlength: '3',
    title: 'Tempo (Schläge pro Minute) – antippen und eintippen',
    'aria-label': 'Tempo in Schlägen pro Minute',
  });
  field.value = String(bpm);
  const minus = h('button.metro-step.metro-minus', { type: 'button', title: 'Langsamer (gedrückt halten: schneller ändern)', 'aria-label': 'Langsamer' }, icon('minus'));
  const plus = h('button.metro-step.metro-plus', { type: 'button', title: 'Schneller (gedrückt halten: schneller ändern)', 'aria-label': 'Schneller' }, icon('plus'));
  const play = h('button.metro-play', { type: 'button', 'aria-pressed': 'false' });
  const grip = h('span.sheet-tuner-grip.metro-grip', { 'aria-hidden': 'true' });
  const el = h('div.sheet-metronome', {
    role: 'group',
    'aria-label': 'Metronom auf dem Blatt',
    title: 'Metronom – ziehen zum Verschieben; Ecke, zwei Finger oder Mausrad für die Größe',
  }, minus, h('span.metro-tempo', null, field, h('span.metro-unit', null, 'BPM')), plus, play, grip);
  const float = makeFloating({
    el, parent, grip, left, top, sizeKey: 'sheetMetronomeSize', min: METRONOME_SIZE_MIN, max: METRONOME_SIZE_MAX, fallback: 32,
  });

  // ----- tempo -----
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (db.settings.metronomeBpm === bpm) return;
    db.settings.metronomeBpm = bpm;
    persist(); // no re-render of the pages
  };
  const setBpm = (n, { later = false } = {}) => {
    const v = clampBpm(n);
    if (v === null) return bpm;
    bpm = v;
    if (document.activeElement !== field) field.value = String(bpm);
    el.dataset.bpm = String(bpm);
    clearTimeout(saveTimer);
    if (later) saveTimer = setTimeout(save, 600); // − / + held down: one write at the end
    else save();
    return bpm;
  };
  el.dataset.bpm = String(bpm);

  // − / +: a tap is one step, holding repeats
  let hold = null;
  const endHold = () => {
    if (!hold) return;
    clearTimeout(hold.timer);
    clearInterval(hold.timer);
    hold = null;
  };
  float.onGesture(endHold); // a drag that started on the button
  for (const [b, step] of [[minus, -1], [plus, 1]]) {
    b.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      endHold();
      delete b.dataset.held;
      const hd = { repeated: false, timer: 0 };
      hd.timer = setTimeout(() => {
        hd.timer = setInterval(() => {
          hd.repeated = true;
          setBpm(bpm + step, { later: true });
        }, REPEAT_MS);
        hd.repeated = true;
        setBpm(bpm + step, { later: true });
      }, HOLD_MS);
      hold = hd;
    });
    const release = () => {
      const was = hold;
      endHold();
      if (was && was.repeated) {
        b.dataset.held = '1'; // the click that follows is not one more step
        save();
      }
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('pointerleave', release);
    b.addEventListener('click', () => {
      if (b.dataset.held) {
        delete b.dataset.held;
        return;
      }
      setBpm(bpm + step);
    });
  }

  // the field: tap → keyboard; Enter or leaving it takes the number, Esc keeps the old one
  field.addEventListener('focus', () => {
    field.select();
    el.classList.add('editing');
  });
  field.addEventListener('input', () => {
    const digits = field.value.replace(/\D/g, '').slice(0, 3);
    if (digits !== field.value) field.value = digits;
  });
  field.addEventListener('keydown', (e) => {
    e.stopPropagation(); // no page turns, no shortcuts while typing
    if (e.key === 'Enter') {
      e.preventDefault();
      finish();
      field.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      field.value = String(bpm);
      finish();
      field.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const typed = clampBpm(field.value) || bpm;
      setBpm(typed + (e.key === 'ArrowUp' ? 1 : -1));
      field.value = String(bpm);
      field.select();
    }
  });
  const finish = () => {
    setBpm(field.value);
    field.value = String(bpm);
    el.classList.remove('editing');
  };
  field.addEventListener('blur', finish);

  // ----- sound -----
  const flash = (time) => {
    const t = setTimeout(() => {
      flashTimers.delete(t);
      el.classList.add('beat');
      el.dataset.beats = String(Number(el.dataset.beats || 0) + 1);
      const t2 = setTimeout(() => {
        flashTimers.delete(t2);
        el.classList.remove('beat');
      }, 90);
      flashTimers.add(t2);
    }, Math.max(0, (time - ac.currentTime) * 1000));
    flashTimers.add(t);
  };
  const schedule = () => {
    if (!running || !ac) return;
    // after a long stall (tab in the background) start again from now instead of rattling off the missed beats
    if (nextAt < ac.currentTime - 0.2) nextAt = ac.currentTime + 0.03;
    while (nextAt < ac.currentTime + LOOKAHEAD_S) {
      click(ac, out, nextAt);
      beats.push(nextAt);
      if (beats.length > 400) beats.splice(0, 200);
      flash(nextAt);
      nextAt += 60 / bpm; // a new tempo counts from the next beat
    }
  };
  const syncButton = () => {
    play.replaceChildren(icon(running ? 'stop' : 'play'));
    play.title = running ? 'Metronom anhalten' : 'Metronom starten';
    play.setAttribute('aria-label', play.title);
    play.setAttribute('aria-pressed', String(running));
    el.classList.toggle('running', running);
  };
  const start = () => {
    if (running) return;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ac = new AC({ latencyHint: 'interactive' });
    }
    ac.resume?.().catch(() => {});
    out = ac.createGain();
    out.connect(ac.destination);
    running = true;
    beats.length = 0;
    el.dataset.beats = '0';
    nextAt = ac.currentTime + 0.05;
    schedule();
    timer = setInterval(schedule, TICK_MS);
    syncButton();
  };
  const pause = () => {
    if (!running) return;
    running = false;
    clearInterval(timer);
    timer = null;
    for (const t of flashTimers) clearTimeout(t);
    flashTimers.clear();
    el.classList.remove('beat');
    out?.disconnect(); // the clicks already on the clock stay silent
    out = null;
    ac?.suspend?.().catch(() => {});
    syncButton();
  };
  play.addEventListener('click', () => (running ? pause() : start()));
  syncButton();
  // a button must not keep the focus, otherwise the space bar (turns the page) would press it again
  el.addEventListener('click', () => setTimeout(() => {
    const a = document.activeElement;
    if (a && a !== field && el.contains(a)) a.blur();
  }, 0));

  return {
    el,
    start,
    pause,
    toggle: () => (running ? pause() : start()),
    get running() { return running; },
    get bpm() { return bpm; },
    setBpm,
    beats,
    stop() {
      pause();
      endHold();
      if (saveTimer) save();
      if (ac) ac.close().catch(() => {});
      ac = null;
      el.remove();
    },
    place: float.place,
    keepBelow: float.keepBelow,
    clamp: float.clamp,
  };
}
