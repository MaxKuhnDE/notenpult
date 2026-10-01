// Feature test: parts (Stimmen), A4/A5 auto layout, crop, rotation, pool sync, search.
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
  const pagesReady = async () => {
    await sleep(80);
    return waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'page render');
  };
  const shot = async (name) => {
    await sleep(300);
    await T.capture(name);
    console.log('captured', name);
  };
  const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  // Like a real key press: from the focused element, bubbling through document to window.
  const key = (k, o = {}) => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const boxes = () => [...document.querySelectorAll('.viewer .page')].map((p) => [p.offsetWidth, p.offsetHeight]);
  const pen = (stage, pts, id) => {
    fire(stage, 'pointerdown', { pointerId: id, pointerType: 'pen', clientX: pts[0][0], clientY: pts[0][1], button: 0, buttons: 1, pressure: 0.6 });
    for (const [x, y] of pts.slice(1)) fire(stage, 'pointermove', { pointerId: id, pointerType: 'pen', clientX: x, clientY: y, buttons: 1, pressure: 0.6 });
    const [lx, ly] = pts[pts.length - 1];
    fire(stage, 'pointerup', { pointerId: id, pointerType: 'pen', clientX: lx, clientY: ly, button: 0, buttons: 0 });
  };

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    // Toasts would cover the screenshots used in the documentation.
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { display: none !important; }' }));
    const { store, sync } = window.__np;
    const { db } = store;
    const dir = __SAMPLES_DIR__;
    const files = ['Florentiner Marsch.pdf', 'Florentiner Marsch - 2. Stimme.pdf', 'Bergsee-Marsch (A5).pdf', 'Kleiner Marsch (A5 auf A4).pdf', 'Alte Kameraden.pdf'];
    const records = await window.notenpult.importFiles(files.map((f) => `${dir}\\${f}`));
    await window.__np.processRecords(records);
    const byTitle = (t) => db.pieces.find((p) => p.title === t);

    // --- Parts: "Florentiner Marsch - 2. Stimme.pdf" is linked automatically on import
    const flo = byTitle('Florentiner Marsch');
    check('auto-link "- 2. Stimme" on import', flo.parts.length === 2 && flo.parts[1].name === '2. Stimme', flo.parts.map((p) => p.name).join(' | '));
    check('no separate piece for 2. Stimme', !db.pieces.some((p) => /2\. Stimme/.test(p.title)));
    // Linking an existing piece as a part (editor: "Vorhandenes Stück aus der Bibliothek")
    const extra = store.addPiece({ title: 'Florentiner Marsch Tenorhorn', pages: flo.parts[0].pages });
    const moved = store.mergePieces(flo.id, extra.id);
    store.commit();
    check('merge existing piece as part', flo.parts.length === 3 && !byTitle('Florentiner Marsch Tenorhorn') && moved.length === 2, flo.parts.map((p) => p.name).join(' | '));
    flo.parts.pop();
    store.commit();
    db.ui.mode = 'library';
    store.commit('ui');
    await shot('20-library-parts');

    // --- Viewer, landscape 1280x800: A4 → two pages side by side
    window.__np.openViewer({ queue: db.pieces.map((p) => ({ pieceId: p.id, number: '' })), start: db.pieces.indexOf(flo), context: { kind: 'library', name: 'Test' } });
    await pagesReady();
    check('A4 landscape: 2 pages in a row', boxes().length === 2 && !!$('.spread.row'), JSON.stringify(boxes()));
    check('part button visible', !$('.v-part').hidden, $('.v-part').textContent);
    await shot('21-viewer-part1');
    key('s');
    await pagesReady();
    check('switched to part 2', flo.part === 1 && $('.v-part').textContent.includes('2. Stimme'), $('.v-part').textContent);
    const stage = $('.stage');
    const pg = $('.page .ink').getBoundingClientRect();
    pen(stage, Array.from({ length: 20 }, (_, i) => [pg.left + pg.width * (0.2 + i * 0.02), pg.top + pg.height * 0.4]), 11);
    await shot('22-viewer-part2-ink');
    key('s');
    await pagesReady();
    const ann = await window.notenpult.loadAnnotations(flo.id).then((t) => (t ? JSON.parse(t) : { pages: {} }));
    const part2Ids = new Set(flo.parts[1].pages.map((p) => p.id));
    check('ink stored on part 2 page', Object.keys(ann.pages).some((id) => part2Ids.has(id)));
    check('part 1 page has no ink', !flo.parts[0].pages.some((p) => ann.pages[p.id]?.length));
    window.__np.closeViewer();

    // --- A5 landscape: single in landscape, stacked in portrait
    const berg = byTitle('Bergsee-Marsch (A5)');
    window.__np.openViewer({ queue: [{ pieceId: berg.id, number: '' }], start: 0, context: { kind: 'library' } });
    await pagesReady();
    check('A5 landscape screen: 1 page', boxes().length === 1, JSON.stringify(boxes()));
    await shot('23-a5-landscape');
    await T.resize(820, 1180);
    await sleep(600);
    await pagesReady();
    check('A5 portrait screen: 2 pages stacked', boxes().length === 2 && !!$('.spread.column'), JSON.stringify(boxes()));
    await shot('24-a5-portrait-stacked');
    window.__np.closeViewer();

    // --- A5 scanned on A4: crop makes it landscape-shaped
    const klein = byTitle('Kleiner Marsch (A5 auf A4)');
    window.__np.openViewer({ queue: [{ pieceId: klein.id, number: '' }], start: 0, context: { kind: 'library' } });
    await pagesReady();
    let [bw, bh] = boxes()[0];
    check('crop: A5-on-A4 shown landscape-shaped', bw > bh, `${bw}x${bh}`);
    await shot('25-a5-on-a4-cropped');
    db.settings.autoCrop = false;
    store.commit('settings');
    await pagesReady();
    [bw, bh] = boxes()[0];
    check('crop off: full A4 page', bh > bw, `${bw}x${bh}`);
    db.settings.autoCrop = true;
    store.commit('settings');
    window.__np.closeViewer();

    // --- Rotation with ink following the music
    const alte = byTitle('Alte Kameraden');
    window.__np.openViewer({ queue: [{ pieceId: alte.id, number: '' }], start: 0, context: { kind: 'library' } });
    await pagesReady();
    const a = $('.page .ink').getBoundingClientRect();
    pen($('.stage'), Array.from({ length: 15 }, (_, i) => [a.left + a.width * (0.15 + i * 0.03), a.top + a.height * 0.12]), 12);
    await shot('26-rotate-before');
    const before = boxes()[0];
    $('.rotate-tools .icon-btn:last-child').click();
    await pagesReady();
    const after = boxes()[0];
    check('rotate right swaps orientation', (before[0] < before[1]) !== (after[0] < after[1]) && alte.parts[0].pages[0].rot === 90, `${before} -> ${after}`);
    await shot('27-rotated-right');
    $('.rotate-tools .icon-btn:first-child').click();
    await pagesReady();
    check('rotate back', !alte.parts[0].pages[0].rot);
    window.__np.closeViewer();
    await T.resize(1280, 800);
    await sleep(400);

    // --- Pool (simulated Google Drive): folders = pieces, filter "Flügelhorn"
    const poolDir = dir.replace(/samples$/, 'pool');
    await sync.link(poolDir, { mode: 'auto', structure: 'folders', filter: 'Flügelhorn' });
    const rosen = byTitle('Rosen aus dem Süden');
    check('pool: folder piece with 2 parts (filter)', rosen && rosen.parts.length === 2, rosen?.parts.map((p) => p.name).join(' | '));
    check('pool: A5 folder piece', byTitle('Gruß aus Tirol')?.parts.length === 1);
    const choral = byTitle('Choral Abendlied');
    check('pool: root file "X - Flügelhorn 1" → piece X, part Flügelhorn 1', choral?.parts[0].name === 'Flügelhorn 1', choral?.parts.map((p) => p.name).join());
    check('pool: tenorhorn not imported', !db.pieces.some((p) => p.parts.some((x) => /tenor/i.test(x.name))));
    const { searchPool } = await import('./js/search.js');
    const tenor = searchPool('tenorhorn');
    check('pool search finds not-loaded files', tenor.length === 2, tenor.map((f) => f.rel).join(' | '));
    await sync.importFromPool(tenor.find((f) => f.rel.includes('Rosen')).rel);
    check('load from pool adds part', rosen.parts.length === 3 && rosen.parts[2].name === 'Tenorhorn', rosen.parts.map((p) => p.name).join(' | '));

    // Search UI in the main screen
    key('f', { ctrlKey: true });
    await sleep(200);
    const input = $('.search-modal input');
    input.value = 'gruss';
    input.dispatchEvent(new Event('input'));
    await shot('28-search-gruss');
    input.value = 'tenor';
    input.dispatchEvent(new Event('input'));
    await shot('29-search-pool');
    key('Escape');

    // Viewer search inserts a piece into the running queue
    const s = store.createSetlist('Konzert');
    store.addToSetlist(s.id, [flo.id, alte.id], 1);
    store.commit();
    window.__np.openViewer({ queue: store.setlistQueue(s), start: 0, context: { kind: 'setlist', name: 'Konzert' } });
    await pagesReady();
    key('f', { ctrlKey: true });
    await sleep(200);
    const vin = $('.search-modal input');
    vin.value = 'choral';
    vin.dispatchEvent(new Event('input'));
    await sleep(100);
    $('.search-modal .search-item').click();
    await pagesReady();
    check('viewer search inserts piece', $('.v-title').textContent.includes('Choral') && $('.v-sub').textContent.includes('eingeschoben'), $('.v-sub').textContent);
    await shot('30-viewer-inserted');
    window.__np.closeViewer();

    // Changed file in the pool (e.g. new version uploaded to Drive) is refreshed, page ids kept
    const firstId = choral.parts[0].pages[0].id;
    await T.copyFile(`${dir}\\Florentiner Marsch.pdf`, `${poolDir}\\Choral Abendlied - Flügelhorn 1.pdf`);
    await sync.syncNow();
    check('pool update refreshes pages', choral.parts[0].pages.length === 2 && choral.parts[0].pages[0].id === firstId, `${choral.parts[0].pages.length} pages`);

    // Offline: unreachable folder keeps library intact
    const count = db.pieces.length;
    const realFolder = db.sync.folder;
    db.sync.folder = `${poolDir}-fehlt`;
    await sync.syncNow();
    check('offline status', sync.syncStatus() === 'offline' && db.pieces.length === count);
    db.sync.folder = realFolder;
    store.commit('settings');
    await sync.syncNow();
    check('back online', sync.syncStatus() === 'ok');

    db.ui.mode = 'library';
    store.commit('ui');
    document.querySelector('.topbar .icon-btn:last-child').click();
    await sleep(300);
    const settingsBody = $('.settings-modal .modal-body');
    settingsBody.scrollTop = settingsBody.scrollHeight;
    await shot('31-settings-pool');
    key('Escape');
    document.querySelector('.cloud-btn').click();
    await sleep(100);
    document.querySelector('.menu-item:last-child').click();
    await sleep(800);
    await shot('32-pool-setup');
    key('Escape');

    // Editor with part tabs
    const rows = [...document.querySelectorAll('.piece-row')];
    const rosenRow = rows.find((r) => r.textContent.includes('Rosen aus dem Süden'));
    rosenRow.querySelector('.row-more').click();
    await sleep(100);
    document.querySelector('.menu-item').click();
    await sleep(900);
    await shot('33-editor-parts');
    key('Escape');
    console.log('pieces:', JSON.stringify(db.pieces.map((p) => [p.title, p.parts.map((x) => `${x.name}:${x.pages.length}`)])));
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(500);
  await T.done();
})();
