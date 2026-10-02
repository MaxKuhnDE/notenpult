// A–Z selection: tap the icon in front of pieces, Shift ranges, whole letters, "all shown",
// then delete many pieces at once (setlists, annotations and files go along).
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
  const byText = (sel, text) => $$(sel).find((el) => el.textContent.includes(text));
  const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  const row = (title) => $$('.lib-list .piece-row').find((r) => r.querySelector('.piece-title').textContent === title);
  const count = () => ($('.select-count') || {}).textContent || '';
  const shift = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
  const fileThere = async (file) => (await fetch(`app://notenpult/library/${encodeURIComponent(file)}`)).ok;

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { visibility: hidden; }' }));
    const { store } = window.__np;
    const { db } = store;
    const dir = __SAMPLES_DIR__;
    const files = ['Florentiner Marsch.pdf', 'Böhmischer Traum.pdf', 'Alte Kameraden.pdf', 'Zillertaler_Hochzeitsmarsch.pdf', 'Abel Tasman.pdf', 'Ein Leben lang.pdf', 'Polka Nr 5.png'];
    await window.__np.processRecords(await window.notenpult.importFiles(files.map((f) => `${dir}\\${f}`)));
    const byTitle = (t) => db.pieces.find((p) => p.title === t);
    const s = store.createSetlist('Frühjahrskonzert');
    store.addToSetlist(s.id, [byTitle('Florentiner Marsch').id, byTitle('Polka Nr 5').id, byTitle('Abel Tasman').id], 1);
    const ink = await import('./js/ink.js');
    const flo = byTitle('Florentiner Marsch');
    ink.strokesOf(await ink.load(flo.id), flo.parts[0].pages[0].id).push({ c: 'red', w: 0.003, p: [0.1, 0.1, 0.5, 0.5] });
    ink.save(flo.id);
    db.ui.mode = 'library';
    store.commit('ui');
    await sleep(600);

    // ---------- select by tapping the icon ----------
    row('Abel Tasman').querySelector('.piece-select').click();
    check('tapping the icon starts selecting', $('.lib.selecting') && row('Abel Tasman').classList.contains('selected') && count() === '1 Stück ausgewählt', count());
    check('no row menus while selecting', !$('.lib-list .row-more'));
    row('Alte Kameraden').querySelector('.piece-main').click();
    await sleep(100);
    check('tapping a row while selecting selects it (does not open it)', !$('.viewer') && count() === '2 Stücke ausgewählt', count());
    row('Alte Kameraden').querySelector('.piece-select').click();
    check('tapping again deselects', count() === '1 Stück ausgewählt' && !row('Alte Kameraden').classList.contains('selected'), count());

    // ---------- Shift range, whole letter ----------
    shift(row('Ein Leben lang').querySelector('.piece-select'));
    check('Shift+click selects the range', ['Abel Tasman', 'Alte Kameraden', 'Böhmischer Traum', 'Ein Leben lang'].every((t) => row(t).classList.contains('selected')) && count() === '4 Stücke ausgewählt', count());
    byText('.letter-pick', 'A abwählen').click();
    check('letter button deselects a whole letter', count() === '2 Stücke ausgewählt' && !row('Abel Tasman').classList.contains('selected'), count());
    byText('.letter-pick', 'Alle mit A').click();
    check('… and selects it again', count() === '4 Stücke ausgewählt', count());

    // ---------- leave: Esc, back button, other tab ----------
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);
    check('Esc ends the selection', !$('.lib.selecting') && !$('.select-bar') && !$('.piece-row.selected') && !!$('.lib-list .row-more'));
    row('Abel Tasman').querySelector('.piece-select').click();
    check('back button ends the selection', window.__npBack() === true && !$('.select-bar'));
    row('Abel Tasman').querySelector('.piece-select').click();
    db.ui.mode = 'setlists';
    store.commit('ui');
    db.ui.mode = 'library';
    store.commit('ui');
    await sleep(100);
    check('switching tabs ends the selection', !$('.select-bar') && !$('.piece-row.selected'));

    // ---------- "Auswählen", search + all shown, cancel ----------
    byText('.toolbar .btn', 'Auswählen').click();
    check('"Auswählen" opens an empty selection', count() === 'Stücke vorne antippen');
    const input = $('.lib .search-input');
    input.value = 'marsch';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    const hits = $$('.lib-list .piece-row').length;
    byText('.select-bar .btn', `Alle angezeigten (${hits})`).click();
    check('"Alle angezeigten" takes the search hits', hits >= 2 && count() === `${hits} Stücke ausgewählt`, `${count()}: ${$$('.piece-row.selected .piece-title').map((e) => e.textContent).join(', ')}`);
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    row('Polka Nr 5').querySelector('.piece-select').click();
    await sleep(150);
    await T.capture('70-auswahl');
    const chosen = $$('.piece-row.selected .piece-title').map((e) => e.textContent);
    const n = chosen.length;
    const rest = 7 - n;
    byText('.select-bar .btn', 'Löschen').click();
    await waitFor(() => byText('.modal', 'löschen?'), 3000, 'confirm');
    check('confirm names count and setlists', byText('.modal', `${n} Stücke löschen?`) && byText('.modal', 'aus 1 Setlist entfernt'), $('.modal').textContent.slice(0, 160));
    byText('.modal .btn', 'Abbrechen').click();
    await sleep(150);
    check('cancel deletes nothing and keeps the selection', db.pieces.length === 7 && count() === `${n} Stücke ausgewählt`, count());

    // ---------- delete ----------
    const goneFiles = chosen.map((t) => byTitle(t).parts[0].pages[0].file);
    byText('.select-bar .btn', 'Löschen').click();
    await waitFor(() => byText('.modal .btn', 'Stücke löschen'), 3000, 'confirm');
    byText('.modal .btn', 'Stücke löschen').click();
    await waitFor(() => db.pieces.length === rest, 5000, 'delete');
    await sleep(400);
    check('selected pieces deleted, the rest stays', db.pieces.map((p) => p.title).sort().join(', ') === ['Abel Tasman', 'Alte Kameraden', 'Ein Leben lang', 'Florentiner Marsch', 'Böhmischer Traum', 'Polka Nr 5', 'Zillertaler Hochzeitsmarsch'].filter((t) => !chosen.includes(t)).sort().join(', '),
      `gelöscht: ${chosen.join(', ')}`);
    check('setlist entries removed', s.entries.length === 3 - chosen.filter((t) => ['Florentiner Marsch', 'Polka Nr 5', 'Abel Tasman'].includes(t)).length, `${s.entries.length} left`);
    check('annotations removed', chosen.includes('Florentiner Marsch') && !(await window.notenpult.loadAnnotations(flo.id)));
    const left = await Promise.all(goneFiles.map(fileThere));
    check('sheet files removed', left.every((x) => !x), left.join(','));
    check('selection ended, list updated', !$('.select-bar') && $$('.lib-list .piece-row').length === rest);
    check('saved', JSON.parse(await window.notenpult.loadDb()).pieces.length === rest);

    // ---------- 120 at once ----------
    const shared = db.pieces[0].parts[0].pages;
    for (let i = 1; i <= 120; i++) store.addPiece({ title: `Übungsstück ${String(i).padStart(3, '0')}`, pages: shared });
    store.commit();
    await sleep(300);
    byText('.toolbar .btn', 'Auswählen').click();
    $('.lib .search-input').value = 'übungsstück';
    $('.lib .search-input').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    byText('.select-bar .btn', 'Alle angezeigten (120)').click();
    check('120 pieces selected with one tap', count() === '120 Stücke ausgewählt', count());
    const t0 = performance.now();
    byText('.select-bar .btn', 'Löschen').click();
    await waitFor(() => byText('.modal .btn', '120 Stücke löschen'), 3000, 'confirm');
    byText('.modal .btn', '120 Stücke löschen').click();
    await waitFor(() => db.pieces.length === rest, 10000, 'bulk delete');
    const ms = Math.round(performance.now() - t0);
    check('120 deleted at once, shared files kept for the remaining pieces', db.pieces.length === rest && await fileThere(shared[0].file), `${ms} ms`);
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
