// Metronome on the sheet (renderer/js/metronome.js): button in the pen bar, − / + (tap and hold), the tempo
// field with the keyboard, start/stop in one button, exact beat spacing on the audio clock, moving and
// resizing without turning the page, and getting along with the tuner on the sheet.
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
  const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  const ptr = (type, target, x, y, id = 1, pointerType = 'touch') => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, pointerType, isPrimary: id === 1, button: 0,
  }));
  const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const type = (field, text) => {
    field.value = text;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { display: none !important; }' }));
    const { store } = window.__np;
    const { db } = store;
    const metro = await import('./js/metronome.js');

    // ---------- the parts ----------
    check('tempo: whole beats from 20 to 300, nonsense ignored', metro.clampBpm('88') === 88 && metro.clampBpm(999) === 300
      && metro.clampBpm(5) === 20 && metro.clampBpm(120.4) === 120 && metro.clampBpm('') === null && metro.clampBpm('abc') === null);
    check('tempo and size belong to the device', store.DEVICE_SETTINGS.includes('metronomeBpm') && store.DEVICE_SETTINGS.includes('sheetMetronomeSize'));

    // beat spacing on the audio clock, a new tempo from the next beat on
    const box = document.body.appendChild(Object.assign(document.createElement('div'), { style: 'position:fixed;inset:0;pointer-events:none' }));
    db.settings.metronomeBpm = 120;
    const m0 = metro.startSheetMetronome({ parent: box });
    m0.start();
    await waitFor(() => m0.beats.length >= 4, 6000, 'beats at 120').catch(() => {});
    const gaps = (b) => b.slice(1).map((t, i) => t - b[i]);
    const g120 = gaps(m0.beats.slice(0, 4));
    check('120 BPM: a click every 0.5 s exactly', g120.length === 3 && g120.every((g) => Math.abs(g - 0.5) < 1e-6), g120.map((g) => g.toFixed(4)).join(' '));
    m0.setBpm(60);
    const n0 = m0.beats.length;
    await waitFor(() => m0.beats.length >= n0 + 3, 8000, 'beats at 60').catch(() => {});
    const g60 = gaps(m0.beats.slice(n0, n0 + 3));
    check('60 BPM while running: then every 1.0 s', g60.length === 2 && g60.every((g) => Math.abs(g - 1) < 1e-6), g60.map((g) => g.toFixed(4)).join(' '));
    m0.pause();
    const n1 = m0.beats.length;
    await sleep(1300);
    check('stopped: no more clicks', !m0.running && m0.beats.length === n1);
    m0.stop();
    box.remove();
    db.settings.metronomeBpm = 120;
    store.commit('settings');

    // ---------- in the notes ----------
    await T.resize(1280, 800);
    await window.__np.processRecords(await window.notenpult.importFiles([`${__SAMPLES_DIR__}\\Alte Kameraden.pdf`]));
    const alte = db.pieces.find((p) => p.title === 'Alte Kameraden');
    const open = async () => {
      window.__np.openViewer({ queue: [{ pieceId: alte.id, number: '' }], start: 0, context: { kind: 'library' } });
      await waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'viewer');
    };
    await open();
    const sub = () => ($('.v-sub') || {}).textContent || '';
    const sub0 = sub();
    const toolBtn = $('.v-bar .ink-tools .metronome-tool');
    check('button in the pen bar, next to the tuner, off at first', !!toolBtn && toolBtn.previousElementSibling === $('.v-bar .ink-tools .tuner-tool')
      && !toolBtn.classList.contains('active') && !$('.sheet-metronome'));
    toolBtn.click();
    const el = await waitFor(() => $('.sheet-metronome'), 3000, 'metronome');
    const barH = $('.v-bar').offsetHeight;
    const field = el.querySelector('.metro-bpm');
    const plus = el.querySelector('.metro-plus');
    const minus = el.querySelector('.metro-minus');
    const play = el.querySelector('.metro-play');
    check('one click: pops up top left below the bar, stopped, with the saved tempo', toolBtn.classList.contains('active')
      && el.offsetLeft === 12 && el.offsetTop === barH + 10 && !el.classList.contains('running') && field.value === '120',
    `${el.offsetLeft},${el.offsetTop} bar ${barH} · ${field.value}`);
    check('− · tempo · + · start', !!minus && !!plus && !!play && minus.nextElementSibling.contains(field) && play.getAttribute('aria-label') === 'Metronom starten');

    // − / +
    plus.click();
    plus.click();
    minus.click();
    check('+ + −: 121, saved', field.value === '121' && db.settings.metronomeBpm === 121, `${field.value} · ${db.settings.metronomeBpm}`);
    const pb = plus.getBoundingClientRect();
    ptr('pointerdown', plus, pb.left + 5, pb.top + 5);
    await sleep(1100);
    ptr('pointerup', plus, pb.left + 5, pb.top + 5);
    plus.click(); // the click after holding is not one more step
    const held = Number(field.value);
    await sleep(700);
    check('holding + counts up quickly, then stops; saved once at the end', held >= 124 && held <= 140 && Number(field.value) === held
      && db.settings.metronomeBpm === held, `${field.value} · ${db.settings.metronomeBpm}`);

    // the field takes the keyboard (the test window is hidden and never has the focus: the events come by hand)
    const focusField = () => {
      field.focus();
      if (!el.classList.contains('editing')) field.dispatchEvent(new FocusEvent('focus'));
    };
    const blurField = () => {
      field.blur();
      field.dispatchEvent(new FocusEvent('blur'));
    };
    focusField();
    check('tapping the number: ready to type, all selected', document.activeElement === field && field.selectionStart === 0
      && field.selectionEnd === field.value.length && el.classList.contains('editing'));
    type(field, '8a8');
    check('only digits', field.value === '88', field.value);
    key(field, 'Enter');
    check('Enter: 88 BPM, keyboard gone, saved', field.value === '88' && document.activeElement !== field && db.settings.metronomeBpm === 88);
    focusField();
    type(field, '999');
    blurField();
    check('999 → 300 (the most)', field.value === '300', field.value);
    focusField();
    type(field, '5');
    key(field, 'Enter');
    check('5 → 20 (the least)', field.value === '20', field.value);
    focusField();
    type(field, '1');
    key(field, 'Escape');
    check('Esc keeps the old tempo', field.value === '20' && db.settings.metronomeBpm === 20);
    focusField();
    type(field, '');
    blurField();
    check('empty keeps the old tempo', field.value === '20');
    focusField();
    type(field, '96');
    key(field, 'ArrowUp');
    key(field, 'ArrowUp');
    key(field, 'ArrowDown');
    blurField();
    check('arrow keys: ±1', field.value === '97', field.value);
    focusField();
    key(field, 'ArrowRight'); // would turn the page in the notes
    key(field, ' ');
    blurField();
    await sleep(150);
    check('typing in the field does not turn the page', sub() === sub0, sub());

    // start / stop in one button
    play.click();
    check('start: running, the button becomes stop', el.classList.contains('running') && play.getAttribute('aria-pressed') === 'true'
      && play.getAttribute('aria-label') === 'Metronom anhalten');
    await waitFor(() => Number(el.dataset.beats) >= 2, 6000, 'beats on screen').catch(() => {});
    check('the number pulses with the beat', Number(el.dataset.beats) >= 2, el.dataset.beats);
    await sleep(60);
    check('the button lets go of the focus (space turns the page, not the metronome)', document.activeElement !== play);
    await T.capture('103-metronom-blatt');
    play.click();
    const b0 = Number(el.dataset.beats);
    await sleep(1000);
    check('stop: quiet, the button becomes start again', !el.classList.contains('running') && Number(el.dataset.beats) === b0
      && play.getAttribute('aria-label') === 'Metronom starten');

    // move and resize – none of it turns the page or changes the tempo
    const unit = el.querySelector('.metro-unit').getBoundingClientRect();
    ptr('pointerdown', el.querySelector('.metro-unit'), unit.left + 2, unit.top + 2);
    ptr('pointermove', el, unit.left + 302, unit.top + 202);
    ptr('pointerup', el, unit.left + 302, unit.top + 202);
    await sleep(80);
    check('drag moves it', Math.abs(el.offsetLeft - (12 + 300)) <= 1 && Math.abs(el.offsetTop - (barH + 10 + 200)) <= 1 && sub() === sub0,
      `${el.offsetLeft},${el.offsetTop} · ${sub()}`);
    const tempo = field.value;
    const left0 = el.offsetLeft;
    const pb2 = plus.getBoundingClientRect();
    ptr('pointerdown', plus, pb2.left + 4, pb2.top + 4);
    ptr('pointermove', plus, pb2.left - 46, pb2.top + 4);
    ptr('pointerup', el, pb2.left - 46, pb2.top + 4);
    plus.click(); // the click the browser sends after the drag
    await sleep(60);
    check('a drag that starts on + moves it and changes nothing', Math.abs(el.offsetLeft - (left0 - 50)) <= 1 && field.value === tempo,
      `${el.offsetLeft} · ${field.value}`);
    const size0 = parseFloat(el.style.fontSize);
    const grip = el.querySelector('.metro-grip');
    const g = grip.getBoundingClientRect();
    ptr('pointerdown', grip, g.left + 4, g.top + 4);
    ptr('pointermove', el, g.left + 34, g.top + 34);
    ptr('pointerup', el, g.left + 34, g.top + 34);
    const size1 = parseFloat(el.style.fontSize);
    check('the corner makes it bigger, remembered', size1 > size0 * 1.3 && db.settings.sheetMetronomeSize === size1, `${size0} → ${size1}`);
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 }));
    check('mouse wheel: smaller', parseFloat(el.style.fontSize) < size1);
    el.click();
    el.querySelector('.metro-unit').click();
    await sleep(150);
    check('tapping it does not turn the page', sub() === sub0, sub());

    // together with the tuner: the tuner gets the corner, the metronome goes below it
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const d = ac.createMediaStreamDestination();
      return d.stream;
    };
    toolBtn.click();
    await sleep(80);
    check('one click: off', !$('.sheet-metronome') && !toolBtn.classList.contains('active'));
    $('.tuner-tool').click();
    const st = await waitFor(() => $('.sheet-tuner'), 3000, 'tuner');
    toolBtn.click();
    const el2 = await waitFor(() => $('.sheet-metronome'), 3000, 'metronome again');
    // On CI (hidden window, no screen) the position read right after the click can trail by a frame – the
    // metronome is below the tuner a moment later (seen in the log: 71 at once, 124 after 400 ms). So wait for it.
    const below = () => el2.offsetLeft === 12 && el2.offsetTop >= st.offsetTop + st.offsetHeight && el2.offsetTop <= st.offsetTop + st.offsetHeight + 12;
    await waitFor(below, 3000, 'below the tuner').catch(() => {});
    check('with the tuner on: top left, just below the tuner', below() && parseFloat(el2.style.fontSize) === db.settings.sheetMetronomeSize,
      `${el2.offsetLeft},${el2.offsetTop} · tuner ${st.offsetLeft},${st.offsetTop} ${st.offsetWidth}x${st.offsetHeight} · tuners ${document.querySelectorAll('.sheet-tuner').length}`);
    $('.tuner-tool').click();
    await sleep(80);
    el2.querySelector('.metro-play').click();
    check('running …', el2.classList.contains('running'));
    window.__np.closeViewer();
    await sleep(150);
    check('closing the notes: gone', !$('.sheet-metronome'));
    await open();
    const el3 = await waitFor(() => $('.sheet-metronome'), 3000, 'next piece').catch(() => null);
    check('next piece: still shown, but stopped', !!el3 && !el3.classList.contains('running') && $('.metronome-tool').classList.contains('active')
      && el3.querySelector('.metro-bpm').value === String(db.settings.metronomeBpm));
    $('.metronome-tool').click();
    window.__np.closeViewer();
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
