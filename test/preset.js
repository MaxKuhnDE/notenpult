// "Alles exportieren" → change things → "Alles importieren" → after the reload everything
// must be exactly as exported. Runs twice: main.js injects it again after the reload.
// scripts/run-tests.js passes NOTENPULT_TEST_PRESET (ZIP path instead of the file dialogs).
(async () => {
  const T = window.notenpult.test;
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
  // What must survive the round trip.
  const fingerprint = (db) => JSON.stringify({
    pieces: db.pieces.map((p) => [p.id, p.title, p.genres, p.parts.map((x) => [x.name, x.pages.map((pg) => pg.file)])]),
    setlists: db.setlists.map((s) => [s.name, s.entries.map((e) => [e.pieceId, e.number])]),
    genres: db.genres.map((g) => g.name),
    theme: db.settings.theme,
    layout: db.settings.landscapeLayout,
  });

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { visibility: hidden; }' }));
    const { store } = window.__np;
    const { db } = store;
    const ink = await import('./js/ink.js');

    if (localStorage.getItem('np-test-phase') !== '2') {
      // ---------- phase 1: build a library, export, change it, import ----------
      const dir = __SAMPLES_DIR__;
      const files = ['Florentiner Marsch.pdf', 'Florentiner Marsch - 2. Stimme.pdf', 'Böhmischer Traum.pdf', 'Polka Nr 5.png'];
      await window.__np.processRecords(await window.notenpult.importFiles(files.map((f) => `${dir}\\${f}`)));
      const flo = db.pieces.find((p) => p.title === 'Florentiner Marsch');
      const bt = db.pieces.find((p) => p.title === 'Böhmischer Traum');
      store.setPieceGenre(flo, 'Marsch', true);
      store.setPieceGenre(bt, 'Polka', true);
      const s = store.createSetlist('Frühjahrskonzert');
      store.addToSetlist(s.id, [flo.id], 47);
      store.addToSetlist(s.id, [bt.id], 12);
      db.settings.theme = 'dark';
      db.settings.landscapeLayout = 'two';
      store.commit('settings');
      const ann = await ink.load(flo.id);
      ink.strokesOf(ann, flo.parts[1].pages[0].id).push({ c: 'red', w: 0.003, p: [0.1, 0.1, 0.5, 0.6, 0.4, 0.5] });
      ink.save(flo.id);
      await sleep(400);
      localStorage.setItem('np-test-expected', fingerprint(db));
      localStorage.setItem('np-test-flo', flo.id);

      document.querySelector('.topbar .icon-btn:last-child').click();
      await waitFor(() => byText('.settings-modal .btn', 'Exportieren'), 5000, 'settings');
      byText('.settings-modal .btn', 'Exportieren').click();
      await waitFor(() => /Export gespeichert|Export fehlgeschlagen/.test(toastText()), 30000, 'export');
      check('export creates the ZIP', toastText().includes('Export gespeichert'), toastText());

      // Change things that the import must undo.
      await store.deletePiece(bt.id);
      db.settings.theme = 'light';
      store.commit('settings');
      await sleep(300);
      check('library changed before import', db.pieces.length === 2 && fingerprint(db) !== localStorage.getItem('np-test-expected'));

      localStorage.setItem('np-test-phase', '2');
      byText('.settings-modal .btn', 'Importieren').click();
      await waitFor(() => byText('.modal .btn', 'Export-Datei wählen'), 5000, 'confirm');
      byText('.modal .btn', 'Export-Datei wählen').click();
      // The page reloads after a successful import; phase 2 continues there.
      await sleep(30000);
      check('import reloaded the app', false, toastText());
      await T.done();
      return;
    }

    // ---------- phase 2: after import + reload ----------
    localStorage.removeItem('np-test-phase');
    await sleep(300);
    check('import message shown', toastText().includes('Import abgeschlossen'), toastText());
    check('library is identical to the export (pieces, parts, genres, setlists, settings)',
      fingerprint(db) === localStorage.getItem('np-test-expected'));
    check('deleted piece is back', !!db.pieces.find((p) => p.title === 'Böhmischer Traum'));
    const flo = db.pieces.find((p) => p.id === localStorage.getItem('np-test-flo'));
    const ann = JSON.parse((await window.notenpult.loadAnnotations(flo.id)) || '{"pages":{}}');
    check('annotations came along', ann.pages[flo.parts[1].pages[0].id]?.length === 1);
    window.__np.openViewer({ queue: [{ pieceId: flo.id, number: '' }], start: 0, context: { kind: 'library' } });
    await waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'page render')
      .catch((err) => {
        console.log('viewer state:', $('.viewer') ? $('.viewer').className : 'no viewer', $('.stage')?.innerHTML.slice(0, 300));
        throw err;
      });
    check('imported PDFs open', !!$('.viewer .page canvas.sheet'));
    localStorage.removeItem('np-test-expected');
    localStorage.removeItem('np-test-flo');
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
