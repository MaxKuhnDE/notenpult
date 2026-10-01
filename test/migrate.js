// Loads a library saved by version 1.0 (prepared by scripts/run-tests.js: pages directly on the piece).
(async () => {
  const T = window.notenpult.test;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  try {
    while (!window.__np || !document.body.classList.contains('ready')) await sleep(50);
    const { store } = window.__np;
    const { db } = store;
    const flo = db.pieces.find((p) => p.title === 'Florentiner Marsch');
    check('1.0 pieces migrated to parts', db.pieces.length === 1 && flo && !flo.pages && flo.parts.length === 1 && flo.parts[0].pages.length === 2);
    check("layout 'two' becomes 'auto'", db.settings.landscapeLayout === 'auto');
    const queue = store.setlistQueue(db.setlists[0]);
    check('setlist entry with number kept', queue.length === 1 && queue[0].number === '47');
    window.__np.openViewer({ queue, start: 0, context: { kind: 'setlist', name: db.setlists[0].name } });
    while (!document.querySelector('.viewer .page canvas.sheet') || document.querySelector('.viewer.loading')) await sleep(50);
    await sleep(300);
    const ann = JSON.parse(await window.notenpult.loadAnnotations(flo.id));
    check('old annotations still attached', flo.parts[0].pages[0].id === 'pg1' && ann.pages.pg1?.length === 1);
    await T.capture('40-migrated');
  } catch (err) {
    console.error('SMOKE FAIL', err.stack || err);
  }
  await T.done();
})();
