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
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { display: none !important; }' }));
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
    await waitFor(() => Math.abs(Number($('.tuner-note').dataset.cents) - 23.3) < 2, 5000, 'too high').catch(() => {});
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

    // ---------- the tuner on the sheet ----------
    check('labels: +12¢, −8¢ with a real minus, ±0¢', tuner.centsLabel(12.4) === '+12¢' && tuner.centsLabel(-7.6) === '−8¢'
      && tuner.centsLabel(-0.3) === '±0¢');
    check('its size belongs to the device', store.DEVICE_SETTINGS.includes('sheetTunerSize'));
    // the "microphone" is an oscillator; every start gets its own copy, so we can see it being stopped
    const ac2 = new AudioContext();
    const osc2 = ac2.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = 445;
    const dest2 = ac2.createMediaStreamDestination();
    osc2.connect(dest2);
    osc2.start();
    const mics = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const s = dest2.stream.clone();
      mics.push(s);
      return s;
    };
    const micOn = () => mics.some((s) => s.getTracks().some((t) => t.readyState === 'live'));
    db.settings.tunerA4 = 440;
    store.commit('settings');
    await T.resize(1280, 800);
    await window.__np.processRecords(await window.notenpult.importFiles([`${__SAMPLES_DIR__}\\Alte Kameraden.pdf`]));
    const alte = db.pieces.find((p) => p.title === 'Alte Kameraden');
    window.__np.openViewer({ queue: [{ pieceId: alte.id, number: '' }], start: 0, context: { kind: 'library' } });
    await waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'viewer');
    const sub = () => ($('.v-sub') || {}).textContent || '';
    const sub0 = sub();
    const toolBtn = $('.v-bar .ink-tools .tuner-tool');
    check('button in the pen bar, off at first', !!toolBtn && !toolBtn.classList.contains('active') && !$('.sheet-tuner'));
    toolBtn.click();
    const st = await waitFor(() => $('.sheet-tuner'), 3000, 'sheet tuner');
    const barH = $('.v-bar').offsetHeight;
    check('one click: pops up top left, below the bar', toolBtn.classList.contains('active') && st.offsetLeft === 12 && st.offsetTop === barH + 10,
      `${st.offsetLeft},${st.offsetTop} bar ${barH}`);
    await waitFor(() => /^\+(19|20)¢$/.test(st.textContent), 5000, '445 Hz').catch(() => {});
    const cs = getComputedStyle(st);
    check('445 Hz at 440: "+20¢" and nothing else', /^\+(19|20)¢$/.test(st.textContent), st.textContent);
    check('more than 10 cent off: red, no frame, no background', cs.color === 'rgb(224, 32, 26)' && cs.borderTopStyle === 'none'
      && cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.boxShadow === 'none', `${cs.color} ${cs.borderTopStyle} ${cs.backgroundColor}`);
    await T.capture('102-stimmgeraet-blatt-rot');
    osc2.frequency.value = 432;
    await waitFor(() => Number(st.dataset.cents) <= -31, 4000, '432 Hz').catch(() => {});
    check('432 Hz: "−32¢"', /^−3[12]¢$/.test(st.textContent), st.textContent);
    db.settings.tunerA4 = 432;
    store.commit('settings');
    await waitFor(() => Math.abs(Number(st.dataset.cents)) <= 1, 4000, 'Kammerton 432').catch(() => {});
    check('Kammerton comes from the tuner: 432 Hz at 432 = ±0¢', Math.abs(Number(st.dataset.cents)) <= 1, st.textContent);
    check('… in tune: green', getComputedStyle(st).color === 'rgb(23, 160, 58)', getComputedStyle(st).color);
    await T.capture('101-stimmgeraet-blatt');
    // the edges of the tolerance: 10 cent is still green, 11 is red (432 Hz · 2^(c/1200))
    osc2.frequency.value = 432 * 2 ** (10 / 1200);
    await waitFor(() => Number(st.dataset.cents) === 10, 4000, '+10').catch(() => {});
    check('+10¢: still green', Number(st.dataset.cents) === 10 && getComputedStyle(st).color === 'rgb(23, 160, 58)', st.textContent);
    osc2.frequency.value = 432 * 2 ** (-11.5 / 1200);
    await waitFor(() => Number(st.dataset.cents) <= -11, 4000, '-11').catch(() => {});
    check('−11¢ or more: red', Number(st.dataset.cents) <= -11 && getComputedStyle(st).color === 'rgb(224, 32, 26)', st.textContent);
    osc2.frequency.value = 0;
    await waitFor(() => st.classList.contains('idle'), 4000, 'silence').catch(() => {});
    check('no tone: grey "—¢"', st.textContent === '—¢' && getComputedStyle(st).color === 'rgb(139, 141, 145)', getComputedStyle(st).color);
    osc2.frequency.value = 432;

    // move, resize (corner, mouse wheel, two fingers) – none of it turns the page
    const st2 = $('.sheet-tuner');
    const ptr = (type, target, x, y, id = 1) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, pointerType: 'touch', isPrimary: id === 1,
    }));
    const r0 = st2.getBoundingClientRect();
    ptr('pointerdown', st2, r0.left + 10, r0.top + 10);
    ptr('pointermove', st2, r0.left + 310, r0.top + 210);
    ptr('pointerup', st2, r0.left + 310, r0.top + 210);
    await sleep(80);
    check('drag moves it', Math.abs(st2.offsetLeft - 312) <= 1 && Math.abs(st2.offsetTop - (barH + 210)) <= 1 && sub() === sub0,
      `${st2.offsetLeft},${st2.offsetTop} · ${sub()}`);
    const size0 = parseFloat(st2.style.fontSize);
    const grip = st2.querySelector('.sheet-tuner-grip');
    const g = grip.getBoundingClientRect();
    ptr('pointerdown', grip, g.left + 5, g.top + 5);
    ptr('pointermove', st2, g.left + 45, g.top + 45);
    ptr('pointerup', st2, g.left + 45, g.top + 45);
    const size1 = parseFloat(st2.style.fontSize);
    check('the corner makes it bigger', size1 > size0 * 1.5 && db.settings.sheetTunerSize === size1, `${size0} → ${size1}`);
    st2.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 }));
    check('mouse wheel: smaller', parseFloat(st2.style.fontSize) < size1);
    const r1 = st2.getBoundingClientRect();
    const size2 = parseFloat(st2.style.fontSize);
    ptr('pointerdown', st2, r1.left + 10, r1.top + 10, 1);
    ptr('pointerdown', st2, r1.left + 40, r1.top + 10, 2);
    ptr('pointermove', st2, r1.left + 70, r1.top + 10, 2);
    ptr('pointerup', st2, r1.left + 70, r1.top + 10, 2);
    ptr('pointerup', st2, r1.left + 10, r1.top + 10, 1);
    check('two fingers apart: twice the size', Math.abs(parseFloat(st2.style.fontSize) - Math.min(200, size2 * 2)) <= 1,
      `${size2} → ${st2.style.fontSize}`);
    st2.click();
    await sleep(150);
    check('tapping it does not turn the page', sub() === sub0, sub());
    const kept = db.settings.sheetTunerSize;
    toolBtn.click();
    await sleep(100);
    check('one click: off, microphone off', !$('.sheet-tuner') && !toolBtn.classList.contains('active') && !micOn());
    toolBtn.click();
    const st3 = await waitFor(() => $('.sheet-tuner'), 3000, 'again');
    check('on again: top left again, size remembered', st3.offsetLeft === 12 && st3.offsetTop === barH + 10 && parseFloat(st3.style.fontSize) === kept);
    window.__np.closeViewer();
    await sleep(150);
    check('closing the notes: gone, microphone off', !$('.sheet-tuner') && !micOn());
    window.__np.openViewer({ queue: [{ pieceId: alte.id, number: '' }], start: 0, context: { kind: 'library' } });
    await waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'viewer again');
    check('still switched on for the next piece', !!(await waitFor(() => $('.sheet-tuner'), 3000, 'next piece').catch(() => null))
      && $('.tuner-tool').classList.contains('active'));
    window.__np.closeViewer();
    osc2.stop();
    ac2.close();
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
