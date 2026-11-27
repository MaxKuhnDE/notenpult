// Tuner (renderer/js/tuner.js): pitch detection on generated brass-like tones from tuba to
// flugelhorn, note names in German and for B/Es/F instruments, and the dialog with a real tone
// (Web Audio oscillator instead of the microphone); the Kammerton is saved.
(async () => {
  const T = window.notenpult.test;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 8000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(30);
    }
    throw new Error(`timeout waiting for ${what}`);
  };
  const $ = (s) => document.querySelector(s);
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => el.textContent.trim() === text);
  const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  const cents = (a, b) => 1200 * Math.log2(a / b);
  /** A brass-like tone: fundamental plus overtones, a little noise. */
  const tone = (f, sr, n = 4096, noise = 0.01) => {
    const buf = new Float32Array(n);
    const amps = [1, 0.7, 0.5, 0.35, 0.2, 0.12];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647 - 0.5;
    };
    for (let i = 0; i < n; i++) {
      let v = 0;
      amps.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * f * (k + 1) * (i / sr) + k); });
      buf[i] = 0.25 * v + noise * rnd();
    }
    return buf;
  };

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    const { store } = window.__np;
    const { db } = store;
    const tuner = await import('./js/tuner.js');

    // ---------- pitch detection ----------
    const notes = [29.14, 58.27, 87.31, 116.54, 233.08, 311.13, 440, 466.16, 698.46, 932.33, 1046.5, 1396.91];
    let worst = 0;
    let missing = [];
    for (const sr of [48000, 44100]) {
      for (const f of notes) {
        const got = tuner.detectPitch(tone(f, sr), sr);
        if (!got) missing.push(`${f}@${sr}`);
        else worst = Math.max(worst, Math.abs(cents(got, f)));
      }
    }
    check('pitch from Kontrabass-Tuba (B♭ 29 Hz) to Flügelhorn (F 1397 Hz) within 1 cent', !missing.length && worst < 1,
      `worst ${worst.toFixed(2)} cent${missing.length ? `, missing ${missing.join(' ')}` : ''}`);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) tuner.detectPitch(tone(58.27, 48000), 48000);
    const ms = (performance.now() - t0) / 20;
    console.log(`PERF tuner-detect ${ms.toFixed(2)}`);
    check('fast enough for 15 measurements a second on a tablet', ms < 8, `${ms.toFixed(2)} ms`);
    check('silence: no note', tuner.detectPitch(new Float32Array(4096), 48000) === null);
    let falseNotes = 0;
    for (let k = 0; k < 20; k++) {
      const noise = new Float32Array(4096);
      for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() - 0.5) * 0.4;
      if (tuner.detectPitch(noise, 48000) !== null) falseNotes += 1;
    }
    check('room noise: no note', falseNotes === 0, `${falseNotes} of 20`);

    // ---------- note names ----------
    const n = (f, a4, tr) => {
      const r = tuner.noteFor(f, a4, tr);
      return `${r.name}${r.octave}`;
    };
    check('German names: a¹ = A4, B♭ = B, B = H', n(440, 440) === 'A4' && n(466.16, 440) === 'B4' && n(493.88, 440) === 'H4' && n(311.13, 440) === 'Es4');
    check('cents against the Kammerton', Math.abs(tuner.noteFor(442, 442).cents) < 0.1 && Math.abs(tuner.noteFor(440, 442).cents + 7.9) < 0.2
      && Math.abs(tuner.noteFor(445, 440).cents - 19.6) < 0.2);
    check('B-, Es- and F-instruments: written C for their sounding B, Es, F',
      n(466.16, 440, 'B') === 'C5' && n(311.13, 440, 'Es') === 'C5' && n(349.23, 440, 'F') === 'C5');

    // ---------- the dialog with a real tone ----------
    db.settings.tunerA4 = 442;
    store.commit('settings');
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 442;
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    tuner.openTuner({ stream: dest.stream });
    await waitFor(() => $('.tuner-note')?.dataset.note === 'A', 6000, 'note A').catch(() => {});
    await sleep(600);
    check('a¹ = 442 Hz with Kammerton 442: "A", in tune', $('.tuner-note').dataset.note === 'A' && Math.abs(Number($('.tuner-note').dataset.cents)) <= 2
      && $('.tuner-status').textContent === 'Stimmt.', `${$('.tuner-note').textContent} ${$('.tuner-hz').textContent} ${$('.tuner-status').textContent}`);
    await T.capture('99-stimmgeraet');
    osc.frequency.value = 448;
    await waitFor(() => Number($('.tuner-note').dataset.cents) > 20, 4000, 'too high').catch(() => {});
    check('448 Hz: 23 cent too high', $('.tuner-status').textContent === 'Zu hoch.' && Math.abs(Number($('.tuner-note').dataset.cents) - 23.3) < 2,
      $('.tuner-hz').textContent);
    byText('.tuner-quick .btn', '440').click();
    byText('.tuner-a4 .btn', '+').click();
    check('Kammerton buttons', db.settings.tunerA4 === 441 && $('.tuner-a4-value').textContent === '441 Hz');
    byText('.tuner .seg', 'B').click();
    osc.frequency.value = 441;
    await waitFor(() => $('.tuner-note')?.dataset.note === 'H', 4000, 'written H').catch(() => {});
    check('display for a B-instrument: sounding A is written H', $('.tuner-note').dataset.note === 'H' && db.settings.tunerTranspose === 'B');
    window.__npBack();
    osc.stop();
    ac.close();
    await store.flushSaves();
    const saved = await window.notenpult.loadDb();
    const settings = (typeof saved === 'string' ? JSON.parse(saved) : saved).settings;
    check('Kammerton and instrument are saved', settings.tunerA4 === 441 && settings.tunerTranspose === 'B');
    check('button in the top bar', !!$('.topbar .tuner-btn'));
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
