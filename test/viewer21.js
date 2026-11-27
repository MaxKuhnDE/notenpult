// Notenmodus 2.1: half-page turns, jump links (repeats, D.S., Coda) and the new annotation tools
// (more colours, highlighter, text, stamps).
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
  const $$ = (s) => [...document.querySelectorAll(s)];
  const byText = (sel, text) => $$(sel).find((el) => el.textContent.includes(text));
  const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  const sub = () => ($('.v-sub') || {}).textContent || '';
  const pagesReady = async () => {
    await sleep(80);
    return waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'page render');
  };
  const turn = async (fn, expect) => {
    fn();
    await waitFor(() => sub().includes(expect), 5000, expect).catch(() => {});
    await pagesReady();
    return sub().includes(expect);
  };
  const fire = (el, type, o) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, ...o }));
  /** A tap (or a stroke through `to`) at fractions of the visible page area. */
  const touch = async (fx, fy, { type = 'touch', to = null, id = 1 } = {}) => {
    const stage = $('.stage');
    const r = $('.viewer .page').getBoundingClientRect();
    const at = (x, y) => ({ clientX: r.left + r.width * x, clientY: r.top + r.height * y });
    fire(stage, 'pointerdown', { pointerId: id, pointerType: type, button: 0, buttons: 1, pressure: 0.5, ...at(fx, fy) });
    if (to) for (let i = 1; i <= 8; i++) fire(stage, 'pointermove', { pointerId: id, pointerType: type, buttons: 1, pressure: 0.5, ...at(fx + ((to[0] - fx) * i) / 8, fy + ((to[1] - fy) * i) / 8) });
    await sleep(30);
    const end = to || [fx, fy];
    fire(stage, 'pointerup', { pointerId: id, pointerType: type, button: 0, buttons: 0, ...at(end[0], end[1]) });
    await sleep(60);
  };
  const openMenu = async () => {
    $('.viewer .icon-btn[title="Ansicht & mehr"]').click();
    await waitFor(() => $('.menu-item'), 3000, 'menu');
  };

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { display: none !important; }' }));
    const { store } = window.__np;
    const { db } = store;
    const ink = await import('./js/ink.js');
    const { closeMenu } = await import('./js/ui.js');
    await T.resize(1280, 800);
    db.settings.landscapeLayout = 'single';
    store.commit('settings');
    const dir = __SAMPLES_DIR__;
    await window.__np.processRecords(await window.notenpult.importFiles(['Alte Kameraden.pdf', 'Florentiner Marsch.pdf'].map((f) => `${dir}\\${f}`)));
    const alte = db.pieces.find((p) => p.title === 'Alte Kameraden');
    const flo = db.pieces.find((p) => p.title === 'Florentiner Marsch');
    const pages = alte.parts[0].pages;
    const open = async (start = 0) => {
      window.__np.openViewer({ queue: [alte, flo].map((p) => ({ pieceId: p.id, number: '' })), start, context: { kind: 'library' } });
      await pagesReady();
    };

    // ---------- half-page turns ----------
    db.settings.halfTurn = true;
    store.commit('settings');
    await open();
    check('half turn: starts with page 1', sub().includes('Seite 1 von 3'), sub());
    check('next: top half of page 2 above the bottom of page 1', await turn(window.__np.next, 'Seite 1 unten, 2 oben') && !!$('.spread.half')
      && $$('.spread.half .page').length === 2 && getComputedStyle($$('.spread.half .page')[0]).clipPath.includes('50%'), sub());
    await T.capture('95-halbe-seite');
    // Writing on the half screen lands on the right page.
    $('.viewer [title^="Zeichenmodus"]').click();
    const stage = $('.stage');
    const r = stage.getBoundingClientRect();
    const penLine = async (y, id) => {
      fire(stage, 'pointerdown', { pointerId: id, pointerType: 'pen', button: 0, buttons: 1, pressure: 0.6, clientX: r.left + r.width * 0.45, clientY: y });
      for (let i = 1; i <= 6; i++) fire(stage, 'pointermove', { pointerId: id, pointerType: 'pen', buttons: 1, pressure: 0.6, clientX: r.left + r.width * (0.45 + i * 0.01), clientY: y });
      fire(stage, 'pointerup', { pointerId: id, pointerType: 'pen', button: 0, buttons: 0, clientX: r.left + r.width * 0.51, clientY: y });
      await sleep(50);
    };
    await penLine(r.top + r.height * 0.25, 21);
    await penLine(r.top + r.height * 0.75, 22);
    const ann = await ink.load(alte.id);
    check('a stroke above the line goes to page 2, below it to page 1',
      ink.strokesOf(ann, pages[1].id).length === 1 && ink.strokesOf(ann, pages[0].id).length === 1);
    $('.viewer [title^="Zeichenmodus"]').click();
    check('then the whole page 2', await turn(window.__np.next, 'Seite 2 von 3') && !$('.spread.half'), sub());
    check('… half turn to 3, then page 3', await turn(window.__np.next, 'Seite 2 unten, 3 oben') && await turn(window.__np.next, 'Seite 3 von 3'));
    check('last page → next piece', await turn(window.__np.next, 'Seite 1 von 2'));
    check('back: page 3, then the half turn', await turn(window.__np.prev, 'Seite 3 von 3') && await turn(window.__np.prev, 'Seite 2 unten, 3 oben'));
    window.__np.closeViewer();
    db.settings.halfTurn = false;
    store.commit('settings');

    // ---------- jump links ----------
    await open();
    await turn(window.__np.next, 'Seite 2 von 3');
    await turn(window.__np.next, 'Seite 3 von 3');
    await openMenu();
    byText('.menu-item', 'Sprung-Link setzen').click();
    await sleep(100);
    check('setting a link: step 1 explained', !$('.link-banner').hidden && $('.link-banner').textContent.includes('Sprungzeichen'));
    await touch(0.5, 0.9, { type: 'mouse' });
    check('… step 2 after tapping the D.S.', $('.link-banner').textContent.includes('Zielstelle') && sub().includes('Seite 3 von 3'), sub());
    await turn(window.__np.prev, 'Seite 2 von 3');
    await turn(window.__np.prev, 'Seite 1 von 3');
    await touch(0.5, 0.2, { type: 'mouse' });
    await sleep(200);
    await pagesReady();
    const link = (alte.parts[0].links || [])[0];
    check('link saved for this part: page 3 → page 1', alte.parts[0].links?.length === 1 && link.from.pageId === pages[2].id && link.to.pageId === pages[0].id
      && Math.abs(link.from.y - 0.9) < 0.05 && Math.abs(link.to.y - 0.2) < 0.05 && $('.link-banner').hidden, JSON.stringify(link));
    await turn(window.__np.next, 'Seite 2 von 3');
    await turn(window.__np.next, 'Seite 3 von 3');
    const mark = $('.link-mark');
    check('the D.S. shows a jump button', !!mark && mark.textContent.includes('S. 1'));
    await T.capture('96-sprung-link');
    mark.click();
    await waitFor(() => sub().includes('Seite 1 von 3'), 5000, 'jump').catch(() => {});
    await pagesReady();
    check('tapping it jumps to page 1 and marks the place', sub().includes('Seite 1 von 3') && !!$('.link-pulse'), sub());
    check('… with a button back to page 3', !$('.link-return').hidden && $('.link-return').textContent.includes('Zurück zu Seite 3'));
    $('.link-return').click();
    check('back to page 3', await turn(() => {}, 'Seite 3 von 3') && $('.link-return').hidden, sub());
    db.settings.remoteKeys = { link: ['F9'] };
    store.commit('settings');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', bubbles: true }));
    check('pedal "Sprung-Link folgen" jumps too', await turn(() => {}, 'Seite 1 von 3'), sub());
    check('turning the page removes the back button', await turn(window.__np.next, 'Seite 2 von 3') && $('.link-return').hidden);
    await openMenu();
    byText('.menu-item', 'Sprung-Links (1)').click();
    await waitFor(() => $('.link-row'), 3000, 'link list');
    check('links listed', $('.link-row').textContent.includes('Seite 3 → Seite 1'));
    $('.link-row .icon-btn').click();
    await sleep(100);
    check('… and deleted', !alte.parts[0].links && $('.link-row') === null);
    window.__npBack();
    window.__np.closeViewer();
    db.settings.remoteKeys = null;
    store.commit('settings');

    // ---------- annotation tools ----------
    await open();
    $('.viewer .more-tool').click();
    await waitFor(() => $('.tool-panel'), 3000, 'tool panel');
    check('tool panel: 4 colours, highlighter, text, 16 stamps', $$('.tool-panel .tool-swatch').length === 4 && $$('.tool-panel .stamp-btn').length === 16
      && !!byText('.tool-panel .tool-wide', 'Textmarker') && !!byText('.tool-panel .tool-wide', 'Text'));
    await sleep(350); // panel fades in
    await T.capture('97-stempel');
    $('.tool-panel .stamp-btn[title="mf"]').click();
    await sleep(50);
    check('choosing a stamp switches drawing on', $('.viewer').classList.contains('draw-mode') && $('.viewer .more-tool').classList.contains('active'));
    await touch(0.3, 0.3);
    await touch(0.6, 0.3);
    const items = () => ink.strokesOf(ann, pages[0].id);
    check('two "mf" stamps placed with a finger', items().filter((s) => s.t === 'stamp' && s.k === 'mf').length === 2, JSON.stringify(items().map((s) => s.k || s.t || 'stroke')));
    $('.viewer .more-tool').click();
    await waitFor(() => $('.tool-panel'), 3000, 'tool panel');
    $$('.tool-panel .tool-wide').find((x) => x.textContent === 'Text').click();
    await touch(0.2, 0.5);
    await waitFor(() => $('.modal .text-input'), 3000, 'text prompt');
    $('.modal .text-input').value = '2. Mal tacet';
    byText('.modal .btn', 'Einfügen').click();
    await sleep(100);
    check('text placed', items().some((s) => s.t === 'text' && s.text === '2. Mal tacet'));
    $('.viewer .more-tool').click();
    await waitFor(() => $('.tool-panel'), 3000, 'tool panel');
    byText('.tool-panel .tool-wide', 'Textmarker').click();
    await touch(0.2, 0.62, { to: [0.6, 0.62], id: 5 });
    check('highlighter stroke', items().some((s) => s.m === 1 && s.c === 'yellow' && s.p.length > 6));
    $('.viewer .more-tool').click();
    await waitFor(() => $('.tool-panel'), 3000, 'tool panel');
    $('.tool-panel .tool-swatch[title="Blau"]').click();
    await touch(0.2, 0.7, { to: [0.5, 0.75], id: 6 });
    check('blue pen', items().some((s) => !s.t && !s.m && s.c === 'blue'));
    await T.capture('98-anmerkungen');
    $('.viewer [title="Radierer"]').click();
    const before = items().length;
    await touch(0.3, 0.3, { id: 7 });
    check('the eraser removes a stamp', items().length === before - 1 && items().filter((s) => s.k === 'mf').length === 1);
    $('.viewer [title^="Rückgängig"]').click();
    await sleep(150);
    check('undo brings it back', items().filter((s) => s.k === 'mf').length === 2);
    await sleep(400);
    await ink.flushAll();
    const saved = JSON.parse(await window.notenpult.loadAnnotations(alte.id));
    check('saved with the annotations (old versions see an empty stroke)', saved.pages[pages[0].id].some((s) => s.t === 'stamp' && Array.isArray(s.p) && s.p.length === 0));
    closeMenu();
    window.__np.closeViewer();
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
