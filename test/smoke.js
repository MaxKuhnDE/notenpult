// Runs inside the renderer (injected by main.js when NOTENPULT_TEST is set).
(async () => {
  const T = window.notenpult.test;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 10000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(40);
    }
    throw new Error(`timeout waiting for ${what}`);
  };
  const $ = (s) => document.querySelector(s);
  const fire = (el, type, o) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, ...o }));
  const pagesReady = () => waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'page render');
  const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  const shot = async (name) => {
    await sleep(250);
    await T.capture(name);
    console.log('captured', name);
  };

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    // Toasts would cover the screenshots used in the documentation.
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { display: none !important; }' }));
    const { store } = window.__np;
    const dir = __SAMPLES_DIR__;
    const files = ['Florentiner Marsch.pdf', 'Böhmischer Traum.pdf', 'Alte Kameraden.pdf', 'Zillertaler_Hochzeitsmarsch.pdf', 'Abel Tasman.pdf', 'Ein Leben lang.pdf', 'Polka Nr 5.png'];
    const records = await window.notenpult.importFiles(files.map((f) => `${dir}\\${f}`));
    const ids = await window.__np.processRecords(records);
    check('import 6 PDFs + 1 image', ids.length === 7, JSON.stringify(store.db.pieces.map((p) => [p.title, store.pagesOf(p).length])));

    store.db.ui.mode = 'library';
    store.commit('ui');
    await shot('01-library');

    const byTitle = (t) => store.db.pieces.find((p) => p.title === t).id;
    const s = store.createSetlist('Frühjahrskonzert 2026');
    store.addToSetlist(s.id, [byTitle('Florentiner Marsch')], 47);
    store.addToSetlist(s.id, [byTitle('Böhmischer Traum')], 12);
    store.addToSetlist(s.id, [byTitle('Alte Kameraden')], 48);
    store.addToSetlist(s.id, [byTitle('Polka Nr 5')], 3);
    store.addToSetlist(s.id, [byTitle('Abel Tasman')], 101);
    store.addToSetlist(s.id, [byTitle('Ein Leben lang')]);
    store.createSetlist('Marschbuch');
    store.db.ui.mode = 'setlists';
    store.db.ui.setlistId = s.id;
    store.commit();
    await shot('02-setlist');

    store.sortSetlistByNumber(s.id);
    store.commit();
    await shot('02b-setlist-sorted');

    // Open viewer (landscape, two pages side by side by default)
    $('.sl-actions .btn.primary').click();
    await pagesReady();
    await shot('03-viewer-landscape');

    const stage = $('.stage');
    const tap = async (x, y, type = 'mouse') => {
      fire(stage, 'pointerdown', { pointerId: 1, pointerType: type, clientX: x, clientY: y, button: 0, buttons: 1 });
      await sleep(30);
      fire(stage, 'pointerup', { pointerId: 1, pointerType: type, clientX: x, clientY: y, button: 0, buttons: 0 });
      await sleep(60);
      await pagesReady();
    };
    const r = stage.getBoundingClientRect();
    // Nr. 3 Polka (1 page) -> Nr. 12 Böhmischer Traum
    await tap(r.left + r.width * 0.7, r.top + r.height * 0.5);
    check('mouse click turns to next piece', $('.v-title').textContent === '12Böhmischer Traum', $('.v-title').textContent);
    await tap(r.left + r.width * 0.3, r.top + r.height * 0.5, 'touch');
    check('touch tap turns to next piece', $('.v-title').textContent === '47Florentiner Marsch', $('.v-title').textContent);
    await shot('04-after-taps');

    // Pen stroke on the first visible page (should NOT turn the page)
    const before = $('.v-sub').textContent;
    const pg = $('.page .ink').getBoundingClientRect();
    const pts = [];
    for (let i = 0; i <= 30; i++) pts.push([pg.left + pg.width * (0.2 + i * 0.015), pg.top + pg.height * (0.3 + Math.sin(i / 4) * 0.02)]);
    fire(stage, 'pointerdown', { pointerId: 5, pointerType: 'pen', clientX: pts[0][0], clientY: pts[0][1], button: 0, buttons: 1, pressure: 0.5 });
    for (const [x, y] of pts.slice(1)) fire(stage, 'pointermove', { pointerId: 5, pointerType: 'pen', clientX: x, clientY: y, buttons: 1, pressure: 0.7 });
    fire(stage, 'pointerup', { pointerId: 5, pointerType: 'pen', clientX: pts[30][0], clientY: pts[30][1], button: 0, buttons: 0 });
    // A circle in black
    $('.swatch:nth-of-type(2)') && document.querySelectorAll('.swatch')[1].click();
    const cx = pg.left + pg.width * 0.6;
    const cy = pg.top + pg.height * 0.55;
    fire(stage, 'pointerdown', { pointerId: 6, pointerType: 'pen', clientX: cx + 30, clientY: cy, button: 0, buttons: 1, pressure: 0.5 });
    for (let a = 0; a <= 40; a++) {
      fire(stage, 'pointermove', { pointerId: 6, pointerType: 'pen', clientX: cx + 30 * Math.cos(a / 40 * 6.4), clientY: cy + 22 * Math.sin(a / 40 * 6.4), buttons: 1, pressure: 0.4 + a / 80 });
    }
    fire(stage, 'pointerup', { pointerId: 6, pointerType: 'pen', clientX: cx + 30, clientY: cy, button: 0, buttons: 0 });
    check('pen writes without turning the page', before === $('.v-sub').textContent);
    await shot('05-ink');

    // Pen eraser end (buttons 32) across the red stroke
    fire(stage, 'pointerdown', { pointerId: 7, pointerType: 'pen', clientX: pts[10][0], clientY: pts[10][1] - 30, button: 5, buttons: 32 });
    for (let i = 0; i <= 10; i++) fire(stage, 'pointermove', { pointerId: 7, pointerType: 'pen', clientX: pts[10][0], clientY: pts[10][1] - 30 + i * 6, buttons: 32 });
    fire(stage, 'pointerup', { pointerId: 7, pointerType: 'pen', clientX: pts[10][0], clientY: pts[10][1] + 30, button: 5, buttons: 0 });
    await shot('06-erased');
    document.querySelector('.ink-tools .icon-btn:last-child').click(); // undo
    await shot('06b-undo');

    // Palm: touch right after pen must not turn the page
    const sub1 = $('.v-sub').textContent;
    await tap(r.left + 50, r.top + 50, 'touch');
    check('palm touch after pen is ignored', sub1 === $('.v-sub').textContent);

    // Dark mode + inverted sheets
    store.db.settings.theme = 'dark';
    store.db.settings.invertSheets = true;
    store.commit('settings');
    await sleep(300);
    await pagesReady();
    await shot('07-dark-inverted');

    // Portrait window
    await T.resize(820, 1180);
    await sleep(500);
    await pagesReady();
    check('portrait shows one A4 page', document.querySelectorAll('.viewer .page').length === 1, $('.v-sub').textContent);
    await shot('08-portrait');

    // Keypad jump to Nr. 48
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
    await sleep(150);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '8', bubbles: true }));
    await shot('09-keypad');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(100);
    await pagesReady();
    check('keypad jumps to Nr. 48', $('.v-title').textContent === '48Alte Kameraden', $('.v-title').textContent);

    // Fit-width in portrait
    store.db.settings.invertSheets = false;
    store.db.settings.portraitLayout = 'width';
    store.commit('settings');
    await sleep(300);
    await pagesReady();
    await shot('10-portrait-width');
    const st = $('.stage');
    const top0 = st.scrollTop;
    window.__np.next();
    check('fit-width mode stays in piece', $('.v-title').textContent === '48Alte Kameraden', `scroll ${top0} -> ${st.scrollTop}`);

    window.__np.closeViewer();
    await T.resize(1280, 800);
    await sleep(300);
    await shot('11-setlist-dark');

    document.querySelector('.topbar .icon-btn:last-child').click();
    await sleep(300);
    await shot('12-settings');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    store.db.settings.theme = 'light';
    store.commit('settings');

    store.db.ui.mode = 'library';
    store.commit('ui');
    document.querySelector('.row-more').click();
    await sleep(100);
    document.querySelector('.menu-item').click();
    await sleep(800);
    await shot('13-editor');

    const flo = byTitle('Florentiner Marsch');
    await sleep(400);
    const annText = await window.notenpult.loadAnnotations(flo);
    const ann = annText ? JSON.parse(annText) : null;
    const strokes = ann ? Object.values(ann.pages).reduce((n, a) => n + a.length, 0) : 0;
    check('annotations saved (erase + undo)', strokes === 2, `${strokes} strokes`);
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(300);
  await T.done();
})();
