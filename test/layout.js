// Page layout per piece and part (Stimme): chosen in the viewer, remembered for the part,
// "Erste Seite einzeln, dann je zwei", kept by "Bearbeiten", and the setting
// "Ansicht je Stück und Stimme merken" (off: the layout from the settings for every piece).
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
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => el.textContent.includes(text));
  const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  const toastText = () => [...document.querySelectorAll('#toast-root .toast')].map((t) => t.textContent).join(' | ');
  const key = (k) => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const boxes = () => document.querySelectorAll('.viewer .page').length;
  const sub = () => ($('.v-sub') || {}).textContent || '';
  const title = () => ($('.v-title') || {}).textContent || '';
  const pagesReady = async () => {
    await sleep(80);
    return waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'page render');
  };

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    const { store } = window.__np;
    const { db } = store;
    const { closeMenu } = await import('./js/ui.js');
    await T.resize(1280, 800);
    await sleep(500);
    const dir = __SAMPLES_DIR__;
    const files = ['Florentiner Marsch.pdf', 'Florentiner Marsch - 2. Stimme.pdf', 'Alte Kameraden.pdf'];
    await window.__np.processRecords(await window.notenpult.importFiles(files.map((f) => `${dir}\\${f}`)));
    const flo = db.pieces.find((p) => p.title === 'Florentiner Marsch');
    const alte = db.pieces.find((p) => p.title === 'Alte Kameraden');
    check('samples: Florentiner with 2 parts, Alte Kameraden with 3 pages', flo.parts.length === 2 && alte.parts[0].pages.length === 3);

    const open = async (pieces) => {
      window.__np.openViewer({ queue: pieces.map((p) => ({ pieceId: p.id, number: '' })), start: 0, context: { kind: 'library' } });
      await pagesReady();
    };
    const openMenu = async () => {
      $('.viewer .icon-btn[title="Ansicht & mehr"]').click();
      await waitFor(() => $('.menu-item'), 3000, 'menu');
    };
    const choose = async (label) => {
      await openMenu();
      byText('.menu-item', label).click();
      await sleep(150);
      await pagesReady();
    };
    const next = async () => {
      const before = sub() + title();
      window.__np.next();
      await waitFor(() => sub() + title() !== before, 5000, 'page turn');
      await pagesReady();
    };
    const part = async (k) => {
      const before = $('.v-part').textContent;
      key(k);
      await waitFor(() => $('.v-part').textContent !== before, 3000, 'part switch');
      await pagesReady();
    };

    // ---------- own layout for one piece ----------
    await open([alte, flo]);
    check('without an own layout: "Automatisch" pairs pages 1–2', boxes() === 2 && sub().includes('Seiten 1–2 von 3'), sub());
    await openMenu();
    check('menu: layout for this piece, standard from the settings',
      !!byText('.menu-heading', 'Ansicht für dieses Stück') && !!byText('.menu-item.checked', 'Wie in den Einstellungen (Automatisch)')
      && !!byText('.menu-item', 'Erste Seite einzeln, dann je zwei'));
    await sleep(400); // menu fades in
    await T.capture('90-ansicht-je-stueck');
    byText('.menu-item', 'Erste Seite einzeln, dann je zwei').click();
    await sleep(150);
    await pagesReady();
    check('"Erste Seite einzeln": page 1 alone', boxes() === 1 && sub().includes('Seite 1 von 3'), sub());
    check('saved message names the piece', toastText().includes('Ansicht gespeichert für „Alte Kameraden“'), toastText());
    await next();
    check('… then pages 2 and 3 together', boxes() === 2 && sub().includes('Seiten 2–3 von 3'), sub());
    check('remembered for this part only, the setting stays', alte.parts[0].layout === 'firstSingle' && db.settings.landscapeLayout === 'auto',
      JSON.stringify(alte.parts[0].layout));
    await store.flushSaves();
    const saved = await window.notenpult.loadDb();
    const savedDb = typeof saved === 'string' ? JSON.parse(saved) : saved;
    check('saved in the library file', savedDb.pieces.find((p) => p.id === alte.id).parts[0].layout === 'firstSingle');
    await next();
    check('the next piece keeps the standard', title().includes('Florentiner Marsch') && boxes() === 2, `${title()} ${boxes()}`);

    // ---------- per part (Stimme) ----------
    await choose('Immer eine Seite');
    check('Florentiner, 1. Stimme: one page', boxes() === 1 && flo.parts[0].layout === 'single');
    await openMenu();
    check('menu names the part', !!byText('.menu-heading', 'Ansicht für 1. Stimme'));
    const menu = $('.menu').getBoundingClientRect();
    check('the longer menu stays on screen (scrolls if needed)', menu.top >= 0 && menu.bottom <= window.innerHeight,
      `${Math.round(menu.top)}–${Math.round(menu.bottom)} of ${window.innerHeight}, content ${$('.menu').scrollHeight}`);
    closeMenu();
    await part('s');
    check('2. Stimme of the same piece keeps the standard', boxes() === 2 && !flo.parts[1].layout && $('.v-part').textContent.includes('2. Stimme'),
      $('.v-part').textContent);
    await part('s');
    check('back to the 1. Stimme: one page again', boxes() === 1 && $('.v-part').textContent.includes('1. Stimme'));
    window.__np.closeViewer();

    // ---------- opened again, other orientation ----------
    await open([alte]);
    check('opened again: the own layout comes back', boxes() === 1 && sub().includes('Seite 1 von 3'), sub());
    await T.resize(800, 1280);
    await sleep(700);
    await pagesReady();
    check('portrait: the same layout, page 1 alone', boxes() === 1 && sub().includes('Seite 1 von 3'), sub());
    await next();
    check('portrait: then pages 2 and 3 together', boxes() === 2 && sub().includes('Seiten 2–3 von 3'), sub());
    await T.resize(1280, 800);
    await sleep(700);
    await pagesReady();
    await choose('Wie in den Einstellungen (Automatisch)');
    check('"Wie in den Einstellungen" forgets the own layout', !alte.parts[0].layout && boxes() === 2, `${boxes()} ${JSON.stringify(alte.parts[0].layout)}`);
    await choose('Erste Seite einzeln, dann je zwei');
    window.__np.closeViewer();

    // ---------- "Bearbeiten" keeps it ----------
    const { openPieceEditor } = await import('./js/editor.js');
    openPieceEditor(alte.id);
    await waitFor(() => byText('.editor-modal .btn', 'Speichern'), 3000, 'editor');
    byText('.editor-modal .btn', 'Speichern').click();
    await sleep(400);
    check('saving in "Bearbeiten" keeps the layout', alte.parts[0].layout === 'firstSingle', JSON.stringify(alte.parts[0].layout));

    // ---------- setting off: the same view for every piece ----------
    $('.topbar .icon-btn:last-child').click();
    const row = await waitFor(() => byText('.settings-modal .toggle-row', 'Ansicht je Stück und Stimme merken'), 5000, 'settings');
    check('setting "Ansicht je Stück und Stimme merken" is on by default', row.querySelector('input').checked);
    check('settings offer "Erste einzeln" for all pieces', !!byText('.settings-modal .seg', 'Erste einzeln'));
    byText('.settings-modal .setting-label', 'Querformat').scrollIntoView();
    await sleep(300);
    await T.capture('91-einstellungen-ansicht');
    row.querySelector('input').click();
    await sleep(200);
    check('switched off (saved for this device)', db.settings.piecePresets === false);
    window.__npBack();
    await sleep(200);
    await open([alte]);
    check('off: the piece shows the standard view', boxes() === 2 && sub().includes('Seiten 1–2 von 3'), sub());
    check('off: its own layout is kept for later', alte.parts[0].layout === 'firstSingle');
    await openMenu();
    check('off: the menu changes the view of all pieces', !!byText('.menu-heading', 'alle Stücke') && !byText('.menu-item', 'Wie in den Einstellungen'));
    closeMenu();
    await choose('Immer eine Seite');
    check('off: a choice changes the setting, not the piece', db.settings.landscapeLayout === 'single' && alte.parts[0].layout === 'firstSingle'
      && boxes() === 1);
    window.__np.closeViewer();

    // ---------- "Erste einzeln" as the setting for all pieces ----------
    db.settings.landscapeLayout = 'firstSingle';
    store.commit('settings');
    await open([flo]);
    check('setting "Erste einzeln": 2-page piece starts with page 1 alone', boxes() === 1 && sub().includes('Seite 1 von 2'), sub());
    window.__np.closeViewer();

    // ---------- 1.6.0 kept one layout per orientation: one per part now ----------
    await store.flushSaves();
    const old = await store.backend.loadDb();
    old.pieces.find((p) => p.id === alte.id).parts[0].layout = { portrait: 'single' };
    old.pieces.find((p) => p.id === flo.id).parts[0].layout = { landscape: 'two', portrait: 'single' };
    old.pieces.find((p) => p.id === flo.id).parts[1].layout = { landscape: 'kaputt' };
    await store.backend.saveDb(old);
    await store.init();
    const [a, f] = [alte.id, flo.id].map((id) => db.pieces.find((p) => p.id === id));
    check('layouts saved by 1.6.0 are taken over (landscape first, unknown ones dropped)',
      a.parts[0].layout === 'single' && f.parts[0].layout === 'two' && !('layout' in f.parts[1]),
      JSON.stringify([a.parts[0].layout, f.parts[0].layout, f.parts[1].layout]));
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
