// Speed with a large library: 600 pieces, 25 setlists × 40 entries, 2000 files in the Drive pool.
// Prints "PERF <what> <ms>" (median of several runs; `VERBOSE=1` shows them) and checks generous limits,
// so a change that makes things much slower fails – also on slower CI machines. The Galaxy Tab S2 is
// several times slower than a PC, so every millisecond here counts there.
(async () => {
  const T = window.notenpult.test;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 10000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(20);
    }
    throw new Error(`timeout waiting for ${what}`);
  };
  const $ = (s) => document.querySelector(s);
  const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const measure = async (name, fn, runs = 7) => {
    const times = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      await fn(i);
      times.push(performance.now() - t0);
      await sleep(30);
    }
    const ms = median(times);
    console.log(`PERF ${name} ${ms.toFixed(1)}`);
    return ms;
  };

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    const ready = performance.getEntriesByName('notenpult-ready')[0];
    console.log(`PERF startup-ready ${ready ? Math.round(ready.startTime) : -1}`);
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { display: none !important; }' }));
    const { store } = window.__np;
    const { db } = store;
    await T.resize(1280, 800);

    // ---------- a large library from three real files ----------
    const dir = __SAMPLES_DIR__;
    await window.__np.processRecords(await window.notenpult.importFiles(['Florentiner Marsch.pdf', 'Alte Kameraden.pdf', 'Polka Nr 5.png']
      .map((f) => `${dir}\\${f}`)));
    const models = [...db.pieces];
    const words = ['Marsch', 'Polka', 'Walzer', 'Choral', 'Ouvertüre', 'Serenade', 'Intrada', 'Fanfare', 'Hymne', 'Suite'];
    const letters = 'ABCDEFGHIJKLMNOPRSTUVWZ';
    for (const g of ['Marsch', 'Polka', 'Walzer', 'Kirche', 'Konzert']) store.addGenre(g);
    db.pieces = [];
    for (let i = 0; i < 600; i++) {
      const m = models[i % models.length];
      db.pieces.push({
        id: `perf${i}`,
        title: `${letters[i % letters.length]}${words[i % words.length].toLowerCase()} Nr. ${i}`,
        part: 0,
        addedAt: i,
        genres: [['Marsch', 'Polka', 'Walzer', 'Kirche', 'Konzert'][i % 5]],
        parts: [0, 1, 2].slice(0, 1 + (i % 3)).map((k) => ({
          id: `perf${i}p${k}`,
          name: `${k + 1}. Stimme`,
          pages: m.parts[0].pages.map((pg, j) => ({ ...pg, id: `perf${i}p${k}g${j}` })),
        })),
      });
    }
    db.setlists = [];
    for (let s = 0; s < 25; s++) {
      db.setlists.push({
        id: `set${s}`,
        name: `Konzert ${s + 1}`,
        entries: Array.from({ length: 40 }, (_, k) => ({ id: `set${s}e${k}`, pieceId: `perf${(s * 37 + k * 11) % 600}`, number: String(k + 1) })),
      });
    }
    db.sync.files = {};
    for (let f = 0; f < 2000; f++) {
      db.sync.files[`Noten\\Ordner ${f % 40}\\Datei ${f}.pdf`] = {
        size: 1000, mtime: 1, file: 'x.pdf', pieceId: `perf${f % 900}`, partId: 'x', ignored: f % 7 === 0,
      };
    }
    db.ui.mode = 'library';
    store.commit();
    await sleep(500);
    check('large library built', db.pieces.length === 600 && document.querySelectorAll('.piece-row').length === 600,
      `${document.querySelectorAll('.piece-row').length} rows`);
    console.log(`PERF dom-nodes-library ${document.querySelectorAll('#app *').length}`);

    // ---------- A–Z ----------
    const libRender = await measure('library-render', () => store.commit());
    const complete = () => document.querySelectorAll('.piece-row').length === 600 && $('.lib .list-foot');
    const libComplete = await measure('library-render-complete', async () => {
      store.commit();
      await waitFor(complete, 5000, 'all rows');
    });
    $('.lib-list').scrollTop = 4000;
    const libScrolled = await measure('library-render-scrolled', () => store.commit());
    check('a scrolled list keeps its position', $('.lib-list').scrollTop === 4000, String($('.lib-list').scrollTop));
    $('.lib-list').scrollTop = 0;
    await sleep(100);
    const input = $('.lib .search-input');
    const typing = await measure('search-keystroke', (i) => {
      input.value = ['m', 'ma', 'mar', 'mars', 'marsc', 'marsch', ''][i];
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // ---------- setlists ----------
    db.ui.mode = 'setlists';
    db.ui.setlistId = 'set0';
    store.commit('ui');
    await sleep(200);
    const setRender = await measure('setlist-render', () => store.commit());
    db.ui.mode = 'library';
    store.commit('ui');
    await sleep(200);

    // ---------- while playing: changes must not rebuild the hidden library ----------
    db.settings.landscapeLayout = 'single';
    store.commit('settings');
    const playQueue = Array.from({ length: 12 }, (_, k) => ({ pieceId: `perf${k}`, number: '' }));
    window.__np.openViewer({ queue: playQueue, start: 0, context: { kind: 'library' } });
    await waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'viewer');
    const inViewer = await measure('commit-while-playing', () => store.commit('part'));
    const turn = await measure('page-turn', async () => {
      const before = $('.v-sub').textContent;
      window.__np.next();
      await waitFor(() => $('.v-sub').textContent !== before && !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 5000, 'turn');
    }, 7);
    window.__np.closeViewer();
    await sleep(300);
    check('library shown again after the viewer', document.querySelectorAll('.piece-row').length === 600);

    // ---------- saving: slow storage (tablet) must not pile up one full save per change ----------
    db.ui.mode = 'setlists';
    store.commit('ui');
    await store.flushSaves();
    let saves = 0;
    const realSave = store.backend.saveDb;
    store.backend.saveDb = async (obj) => {
      saves += 1;
      await sleep(100);
      return realSave(obj);
    };
    for (let i = 0; i < 20; i++) {
      db.setlists[0].entries[0].number = String(100 + i);
      store.commit('data');
      await sleep(15);
    }
    await store.flushSaves();
    await sleep(300);
    store.backend.saveDb = realSave;
    console.log(`PERF saves-for-20-quick-changes ${saves}`);
    const size = JSON.stringify(db).length;
    console.log(`PERF library-json-kb ${(size / 1024).toFixed(0)}`);

    check('A–Z with 600 pieces appears at once', libRender < 120, `${libRender.toFixed(0)} ms`);
    check('… and is complete soon after', libComplete < 600 && libScrolled < 400, `${libComplete.toFixed(0)} / ${libScrolled.toFixed(0)} ms`);
    check('typing in the search stays fluid', typing < 120, `${typing.toFixed(0)} ms`);
    check('a setlist renders quickly', setRender < 120, `${setRender.toFixed(0)} ms`);
    check('changes while playing cost (almost) nothing', inViewer < 20, `${inViewer.toFixed(1)} ms`);
    check('page turn', turn < 1500, `${turn.toFixed(0)} ms`);
    const saved = await store.backend.loadDb();
    check('quick changes are saved together, not one by one', saves <= 5, `${saves} saves`);
    check('… and the last change is in the file', (typeof saved === 'string' ? JSON.parse(saved) : saved).setlists[0].entries[0].number === '119');
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
