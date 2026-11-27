// Screenshots of the interface for review and the README (not part of `npm test`):
//   node scripts/run-tests.js look.js   → test/out/look-*.png
// Notenpult 2 in dark and light, and the classic style for comparison.
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
  const shot = async (name) => {
    await sleep(450);
    await T.capture(`look-${name}`);
  };

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { display: none !important; }' }));
    const { store } = window.__np;
    const { db } = store;
    const { openPieceEditor } = await import('./js/editor.js');
    const { openRemoteDialog } = await import('./js/remote.js');
    const { closeMenu } = await import('./js/ui.js');
    await T.resize(1280, 800);
    await sleep(300);

    const dir = __SAMPLES_DIR__;
    const files = ['Florentiner Marsch.pdf', 'Florentiner Marsch - 2. Stimme.pdf', 'Böhmischer Traum.pdf', 'Alte Kameraden.pdf',
      'Abel Tasman.pdf', 'Ein Leben lang.pdf', 'Zillertaler_Hochzeitsmarsch.pdf', 'Polka Nr 5.png'];
    await window.__np.processRecords(await window.notenpult.importFiles(files.map((f) => `${dir}\\${f}`)));
    const p = (t) => db.pieces.find((x) => x.title === t);
    for (const [t, g] of [['Florentiner Marsch', 'Marsch'], ['Alte Kameraden', 'Marsch'], ['Zillertaler Hochzeitsmarsch', 'Marsch'],
      ['Böhmischer Traum', 'Polka'], ['Böhmischer Traum', 'Böhmisch'], ['Polka Nr 5', 'Polka'], ['Abel Tasman', 'Konzert'], ['Ein Leben lang', 'Konzert']]) {
      store.setPieceGenre(p(t), g, true);
    }
    const s = store.createSetlist('Frühjahrskonzert 2026');
    store.addToSetlist(s.id, [p('Polka Nr 5').id], 3);
    store.addToSetlist(s.id, [p('Böhmischer Traum').id], 12);
    store.addToSetlist(s.id, [p('Florentiner Marsch').id], 47);
    store.addToSetlist(s.id, [p('Alte Kameraden').id], 48);
    store.addToSetlist(s.id, [p('Abel Tasman').id], 101);
    store.createSetlist('Marschbuch');
    check('sample library', db.pieces.length === 7, db.pieces.map((x) => x.title).join(', '));

    const setTheme = async (theme, style) => {
      db.settings.theme = theme;
      db.settings.uiStyle = style;
      store.commit('settings');
      await sleep(250);
    };
    const show = async (mode) => {
      db.ui.mode = mode;
      if (mode === 'setlists') db.ui.setlistId = s.id;
      store.commit('ui');
      await sleep(250);
    };

    for (const [theme, style] of [['dark', 'v2'], ['light', 'v2'], ['dark', 'classic']]) {
      const tag = `${style}-${theme}`;
      await setTheme(theme, style);
      check(`${tag}: style applied`, document.documentElement.dataset.style === style && document.documentElement.dataset.theme === theme);
      await show('library');
      await shot(`${tag}-1-a-z`);
      byText('.genre-bar .genre-chip', 'Marsch')?.click();
      await sleep(200);
      await shot(`${tag}-2-genre-filter`);
      byText('.genre-bar .genre-chip', 'Alle')?.click();
      await show('setlists');
      await shot(`${tag}-3-setlist`);
      if (style === 'classic') continue;

      window.__np.openViewer({ queue: [{ pieceId: p('Florentiner Marsch').id, number: '47' }], start: 0, context: { kind: 'setlist', name: s.name } });
      await waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'viewer');
      await shot(`${tag}-4-notenansicht`);
      $('.viewer .icon-btn[title="Ansicht & mehr"]').click();
      await sleep(200);
      await shot(`${tag}-5-menue`);
      closeMenu();
      window.__np.closeViewer();

      $('.topbar .icon-btn:last-child').click();
      await waitFor(() => $('.settings-modal'), 5000, 'settings');
      await shot(`${tag}-6-einstellungen`);
      byText('.settings-modal .settings-section', 'Blättern').scrollIntoView();
      await shot(`${tag}-7-einstellungen-pedal`);
      window.__npBack();
      await sleep(150);

      openRemoteDialog();
      await waitFor(() => $('.remote-modal'), 3000, 'remote dialog');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
      await shot(`${tag}-8-pedal-dialog`);
      window.__npBack();
      await sleep(150);

      openPieceEditor(p('Florentiner Marsch').id);
      await waitFor(() => $('.editor-modal'), 3000, 'editor');
      await shot(`${tag}-9-bearbeiten`);
      window.__npBack();
      await sleep(150);
    }
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
