// Feature test: genres (#hashtags) – create, assign, filter, search, rename, delete.
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
  const $$ = (s) => [...document.querySelectorAll(s)];
  const byText = (sel, text) => $$(sel).find((el) => el.textContent.trim().includes(text));
  const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  const key = (k, o = {}) => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const type = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const rows = () => $$('.lib-list .piece-row .piece-title').map((e) => e.textContent);
  const shot = async (name) => {
    await sleep(300);
    await T.capture(name);
  };

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { display: none !important; }' }));
    const { store } = window.__np;
    const { db } = store;
    const dir = __SAMPLES_DIR__;
    const files = ['Florentiner Marsch.pdf', 'Böhmischer Traum.pdf', 'Alte Kameraden.pdf', 'Abel Tasman.pdf', 'Ein Leben lang.pdf', 'Zillertaler_Hochzeitsmarsch.pdf'];
    await window.__np.processRecords(await window.notenpult.importFiles(files.map((f) => `${dir}\\${f}`)));
    const piece = (t) => db.pieces.find((p) => p.title === t);
    db.ui.mode = 'library';
    store.commit('ui');
    await sleep(100);

    // --- Genre manager: create own genres (with and without #) and from suggestions
    byText('.toolbar .btn', 'Genres').click();
    await sleep(150);
    const addInput = $('.genre-manager-modal .genre-add input');
    for (const g of ['Marsch', 'Polka', '#Konzert', 'marsch']) {
      addInput.value = g;
      $('.genre-manager-modal .genre-add').dispatchEvent(new Event('submit', { cancelable: true }));
      await sleep(30);
    }
    check('create genres (# stripped, no duplicates)', store.genreNames().join(',') === 'Konzert,Marsch,Polka', store.genreNames().join(','));
    byText('.genre-manager-modal .genre-suggest .genre-chip', 'Walzer').click();
    await sleep(50);
    check('create genre from suggestion', !!store.findGenre('Walzer'));

    // --- "Stücke zuordnen": tick all marches at once
    const marschRow = $$('.genre-manager-modal .genre-row').find((r) => r.querySelector('.genre-chip').textContent === '#Marsch');
    marschRow.querySelector('.btn').click(); // "Stücke zuordnen …"
    await sleep(150);
    for (const t of ['Florentiner Marsch', 'Alte Kameraden', 'Zillertaler Hochzeitsmarsch']) {
      byText('.add-modal .pick-item', t).click();
      await sleep(30);
    }
    check('assign genre to several pieces', store.genreCount('Marsch') === 3, `${store.genreCount('Marsch')} Märsche`);
    key('Escape');
    await sleep(80);
    key('Escape');
    await sleep(150);

    // --- Piece menu → "Genres …": toggle a chip and create a new genre inline
    const btRow = $$('.piece-row').find((r) => r.textContent.includes('Böhmischer Traum'));
    btRow.querySelector('.row-more').click();
    await sleep(80);
    byText('.menu-item', 'Genres').click();
    await sleep(150);
    byText('.genre-modal .genre-chip', 'Polka').click();
    const inline = $('.genre-modal .genre-input');
    inline.value = '#Böhmisch';
    inline.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(80);
    const bt = piece('Böhmischer Traum');
    check('genre picker: toggle + create inline', store.hasGenre(bt, 'Polka') && store.hasGenre(bt, 'Böhmisch'), bt.genres.join(','));
    key('Escape');
    await sleep(150);
    check('hashtags shown in library rows', $$('.piece-row .genre-tags').length === 4);

    // --- Filter chips (OR)
    byText('.genre-bar .genre-chip', 'Marsch').click();
    await sleep(100);
    check('filter #Marsch', rows().length === 3, rows().join(' | '));
    byText('.genre-bar .genre-chip', 'Polka').click();
    await sleep(100);
    check('filter #Marsch or #Polka', rows().length === 4, rows().join(' | '));
    await shot('50-genres-filter');
    byText('.genre-bar .genre-chip', 'Alle').click();
    await sleep(100);
    check('filter "Alle"', rows().length === 6);

    // --- Search: "#pol" = genre only, "marsch" = title or genre
    const libSearch = $('.toolbar .search-input');
    type(libSearch, '#pol');
    await sleep(100);
    check('search "#pol" finds genre', rows().join() === 'Böhmischer Traum', rows().join(' | '));
    type(libSearch, 'marsch');
    await sleep(100);
    check('search "marsch" includes genre matches', rows().length === 3 && rows().includes('Alte Kameraden'), rows().join(' | '));
    type(libSearch, '');
    await sleep(100);

    // --- Global search: genre section opens the filtered library
    key('f', { ctrlKey: true });
    await sleep(200);
    type($('.search-modal input'), 'polka');
    await sleep(100);
    await shot('51-genres-search');
    byText('.search-modal .search-item', '#Polka').click();
    await sleep(200);
    check('global search → genre → filtered library', rows().join() === 'Böhmischer Traum' && $('.genre-bar .genre-chip.active')?.textContent.includes('Polka'), rows().join(' | '));
    byText('.genre-bar .genre-chip', 'Alle').click();
    await sleep(100);

    // --- Rename, merge, delete
    store.renameGenre('Polka', 'Polkas');
    store.commit();
    check('rename updates pieces', store.hasGenre(bt, 'Polkas') && !store.findGenre('Polka'));
    store.renameGenre('Böhmisch', 'polkas');
    store.commit();
    check('rename onto existing merges', !store.findGenre('Böhmisch') && bt.genres.join() === 'Polkas', bt.genres.join(','));
    store.deleteGenre('Walzer');
    store.commit();
    check('delete genre', !store.findGenre('Walzer'));

    // --- Editor: genres section
    const abel = piece('Abel Tasman');
    const abelRow = $$('.piece-row').find((r) => r.textContent.includes('Abel Tasman'));
    abelRow.querySelector('.row-more').click();
    await sleep(80);
    byText('.menu-item', 'Bearbeiten').click();
    await sleep(400);
    byText('.editor-modal .genre-chip', 'Konzert').click();
    await shot('52-genres-editor');
    byText('.editor-modal .modal-actions .btn', 'Speichern').click();
    await sleep(150);
    check('editor assigns genre on save', store.hasGenre(abel, 'Konzert'), abel.genres.join(','));

    // --- Setlist: add all marches via genre filter
    const s = store.createSetlist('Marschprogramm');
    db.ui.mode = 'setlists';
    db.ui.setlistId = s.id;
    store.commit();
    await sleep(150);
    byText('.sl-actions .btn', 'Stücke hinzufügen').click();
    await sleep(200);
    byText('.add-modal .genre-chip', 'Marsch').click();
    await sleep(80);
    byText('.add-modal .btn', 'Alle angezeigten').click();
    await sleep(80);
    byText('.add-modal .modal-actions .btn', 'hinzufügen').click();
    await sleep(150);
    check('setlist: genre filter + select all', s.entries.length === 3, `${s.entries.length} Einträge`);

    // --- Saved to disk
    await sleep(400);
    const saved = JSON.parse(await window.notenpult.loadDb());
    check('genres saved', saved.genres.map((g) => g.name).sort().join() === 'Konzert,Marsch,Polkas'
      && saved.pieces.find((p) => p.title === 'Böhmischer Traum').genres.join() === 'Polkas', saved.genres.map((g) => g.name).join(','));
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(300);
  await T.done();
})();
