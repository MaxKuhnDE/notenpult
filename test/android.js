// The Android build in Chromium 93 (older than the tablet's WebView 95), see test/android/harness.js.
// Phase 1: import, view PDFs and images, draw with the finger, back button, update, export, import.
// Phase 2 (after the reload that follows the import): everything is as exported.
(async () => {
  const T = window.__npTest;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 15000, what = 'condition') => {
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
  const fire = (el, type, o) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, ...o }));
  const pagesReady = () => waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 20000, 'page render');
  const shot = async (name) => {
    await sleep(300);
    await T.capture(name);
  };
  /** Share of dark pixels on the rendered sheet – 0 means pdf.js or the image decoder drew nothing. */
  const ink = (canvas) => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i] < 128) dark++;
    return dark / (data.length / 16);
  };
  const fingerprint = (db) => JSON.stringify({
    pieces: db.pieces.map((p) => [p.id, p.title, p.genres, p.parts.map((x) => [x.name, x.pages.map((pg) => pg.file)])]),
    setlists: db.setlists.map((s) => [s.name, s.entries.map((e) => [e.pieceId, e.number])]),
    theme: db.settings.theme,
  });

  try {
    await waitFor(() => (window.__np && document.body.classList.contains('ready')) || $('#boot-panel'), 15000, 'app');
    check('app starts without error panel', !$('#boot-panel'), $('#boot-panel') ? $('#boot-panel').textContent : '');
    const { store } = window.__np;
    const { db } = store;
    check('Android backend in use', store.backend.kind === 'android');

    if (localStorage.getItem('np-test-phase') !== '2') {
      // ---------- import single sheets (stands in for the Android file picker) ----------
      const dir = __SAMPLES_DIR__;
      window.__npTestPick = ['Florentiner Marsch.pdf', 'Florentiner Marsch - 2. Stimme.pdf', 'Böhmischer Traum.pdf', 'Polka Nr 5.png']
        .map((f) => `${dir}\\${f}`);
      await window.__np.processRecords(await store.backend.pick());
      const flo = db.pieces.find((p) => p.title === 'Florentiner Marsch');
      const bt = db.pieces.find((p) => p.title === 'Böhmischer Traum');
      const polka = db.pieces.find((p) => p.title === 'Polka Nr 5');
      check('import via bridge: 3 pieces, 2. Stimme linked', db.pieces.length === 3 && flo && flo.parts.length === 2,
        db.pieces.map((p) => `${p.title}/${p.parts.length}`).join(', '));
      const s = store.createSetlist('Frühjahrskonzert');
      store.addToSetlist(s.id, [flo.id], 47);
      store.addToSetlist(s.id, [bt.id], 12);
      store.db.ui.mode = 'library';
      store.commit('ui');
      await sleep(400);
      check('library saved through the bridge', JSON.parse(window.NotenpultAndroid.loadDb()).pieces.length === 3);
      await shot('android-01-library');

      // ---------- selection in A–Z: tap the icon, back button ends it ----------
      $('.lib-list .piece-row .piece-select').click();
      check('tapping the icon selects (A–Z)', !!$('.select-bar') && $('.select-count').textContent === '1 Stück ausgewählt');
      check('back button ends the selection first', window.__npBack() === true && !$('.select-bar'));

      // ---------- viewer: pdf.js 3.11, page turn, keep awake, fullscreen ----------
      window.__np.openViewer({ queue: [{ pieceId: flo.id, number: '47' }, { pieceId: bt.id, number: '12' }], start: 0, context: { kind: 'library' } });
      await pagesReady();
      const sheet = $('.viewer .page canvas.sheet');
      check('PDF page rendered by pdf.js 3.11', ink(sheet) > 0.01, `dark ${(ink(sheet) * 100).toFixed(1)} %, ${sheet.width}×${sheet.height}`);
      check('screen stays on in the viewer', window.__npAwake === true);
      await shot('android-02-viewer');
      const stage = $('.stage');
      const r = stage.getBoundingClientRect();
      fire(stage, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: r.left + r.width * 0.7, clientY: r.top + r.height / 2, button: 0, buttons: 1 });
      await sleep(30);
      fire(stage, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: r.left + r.width * 0.7, clientY: r.top + r.height / 2, button: 0, buttons: 0 });
      await waitFor(() => $('.v-title').textContent.includes('Böhmischer Traum'), 8000, 'next piece').catch(() => {});
      await pagesReady();
      check('tap turns to the next piece', $('.v-title').textContent.includes('Böhmischer Traum'), $('.v-title').textContent);
      $('.v-fs').click();
      await sleep(100);
      check('fullscreen button switches to immersive mode', window.__npFullscreen === true);
      $('.v-fs').click();
      await sleep(100);

      // ---------- drawing with the finger (the Tab S2 has no S Pen) ----------
      $('.viewer [title^="Zeichenmodus"]').click();
      const pg = $('.page .ink').getBoundingClientRect();
      const pts = [];
      for (let i = 0; i <= 20; i++) pts.push([pg.left + pg.width * (0.2 + i * 0.02), pg.top + pg.height * (0.3 + Math.sin(i / 3) * 0.03)]);
      fire(stage, 'pointerdown', { pointerId: 9, pointerType: 'touch', clientX: pts[0][0], clientY: pts[0][1], button: 0, buttons: 1 });
      for (const [x, y] of pts.slice(1)) fire(stage, 'pointermove', { pointerId: 9, pointerType: 'touch', clientX: x, clientY: y, buttons: 1 });
      fire(stage, 'pointerup', { pointerId: 9, pointerType: 'touch', clientX: pts[20][0], clientY: pts[20][1], button: 0, buttons: 0 });
      check('finger stroke in draw mode does not turn the page', $('.v-title').textContent.includes('Böhmischer Traum'));
      $('.viewer [title^="Zeichenmodus"]').click();
      await shot('android-03-drawn');

      // ---------- back button ----------
      check('back button closes the viewer', window.__npBack() === true && !$('.viewer'));
      await sleep(1500); // debounced annotation save happens on close as well
      const saved = JSON.parse(window.NotenpultAndroid.loadAnnotations(bt.id) || '{"pages":{}}');
      check('annotation saved through the bridge', Object.values(saved.pages).some((list) => list.length === 1));
      check('screen may turn off again', window.__npAwake === false);
      check('back button on the overview leaves the app', window.__npBack() === false);

      // ---------- image sheet (createImageBitmap without "from-image" before Chrome 105) ----------
      window.__np.openViewer({ queue: [{ pieceId: polka.id, number: '' }], start: 0, context: { kind: 'library' } });
      await pagesReady();
      check('PNG sheet rendered', ink($('.viewer .page canvas.sheet')) > 0.01);
      window.__npBack();

      // ---------- update: APK from the GitHub release ----------
      $('.topbar .icon-btn:last-child').click();
      await waitFor(() => byText('.settings-modal .btn', 'Nach Updates suchen'), 5000, 'settings');
      byText('.settings-modal .btn', 'Nach Updates suchen').click();
      await waitFor(() => byText('.settings-modal .update-title', '99.0.0'), 8000, 'update found').catch(() => {});
      check('update check through the bridge', !!byText('.settings-modal .update-title', 'Version 99.0.0 ist verfügbar'),
        ($('.settings-modal .update-settings') || {}).textContent);
      await shot('android-04-settings');
      const install = byText('.settings-modal .btn', 'Jetzt aktualisieren');
      if (install) install.click();
      await waitFor(() => byText('.settings-modal .update-msg', 'Installieren'), 5000, 'apk').catch(() => {});
      const inst = window.__npInstalled || {};
      check('"Jetzt aktualisieren" downloads the APK with its checksum and opens the installer',
        inst.url === window.__npTestApkUrl && inst.digest === 'sha256:00ff' && !!byText('.settings-modal .update-msg', 'Android zeigt jetzt die Installation'),
        JSON.stringify(inst));

      // ---------- export, change, import ----------
      db.settings.theme = 'dark';
      store.commit('settings');
      await sleep(300);
      localStorage.setItem('np-test-expected', fingerprint(db));
      byText('.settings-modal .btn', 'Exportieren').click();
      await waitFor(() => /Export gespeichert|Export fehlgeschlagen/.test(toastText()), 20000, 'export');
      check('export through the bridge', toastText().includes('Export gespeichert'), toastText());
      await store.deletePiece(polka.id);
      db.settings.theme = 'light';
      store.commit('settings');
      await sleep(300);
      localStorage.setItem('np-test-phase', '2');
      localStorage.setItem('np-last-version', '1.0.0'); // as if the app ran in 1.0.0 before
      byText('.settings-modal .btn', 'Importieren').click();
      await waitFor(() => byText('.modal .btn', 'Export-Datei wählen'), 5000, 'confirm');
      check('import dialog explains the Download folder', !!byText('.modal', 'Download'));
      byText('.modal .btn', 'Export-Datei wählen').click();
      await sleep(20000);
      check('import reloaded the app', false, toastText());
      await T.done();
      return;
    }

    // ---------- phase 2 ----------
    localStorage.removeItem('np-test-phase');
    await sleep(300);
    check('import message shown', toastText().includes('Import abgeschlossen: 3 Stücke, 1 Setlist'), toastText());
    check('a newer version than last time is announced', toastText().includes('jetzt auf Version'), toastText());
    check('library identical to the export', fingerprint(db) === localStorage.getItem('np-test-expected'));
    const polka = db.pieces.find((p) => p.title === 'Polka Nr 5');
    window.__np.openViewer({ queue: [{ pieceId: polka.id, number: '' }], start: 0, context: { kind: 'library' } });
    await pagesReady();
    check('imported sheets open', ink($('.viewer .page canvas.sheet')) > 0.01);
    localStorage.removeItem('np-test-expected');
  } catch (err) {
    console.log(`FAIL ${err && err.stack ? err.stack : err}`);
  }
  await sleep(200);
  await T.done();
})();
