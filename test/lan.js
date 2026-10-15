// "Im WLAN teilen" in the app, everything on 127.0.0.1 (scripts/run-tests.js runs a test host
// "Testgerät" with codes 4711, 4712 and, for the last part, a receiver).
// 1 receive "Alles übernehmen" (wrong code first) → reload → 2 check, add a piece, receive
// "Hinzufügen" → reload → 3 check, then share: the test runner pulls the library.
(async () => {
  const T = window.notenpult.test;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 15000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(50);
    }
    throw new Error(`timeout waiting for ${what}`);
  };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const byText = (sel, text) => $$(sel).find((el) => el.textContent.includes(text));
  const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  const toastText = () => $$('#toast-root .toast').map((t) => t.textContent).join(' | ');
  const type = (el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const modalText = () => ($('.lan-modal') || {}).textContent || '';
  const phase = localStorage.getItem('np-test-phase') || '1';

  async function receive(code, mode) {
    await waitFor(() => byText('.lan-modal .choice', 'Testgerät'), 8000, 'host in list');
    byText('.lan-modal .choice', 'Testgerät').click();
    await waitFor(() => $('.lan-code-input'), 5000, 'code input');
    const asking = modalText();
    if (code.wrong) {
      type($('.lan-code-input'), code.wrong);
      await waitFor(() => $('.lan-error'), 8000, 'wrong code message');
      check('wrong code: clear message, can try again', $('.lan-error').textContent.includes('Code stimmt nicht') && !!$('.lan-code-input'));
    }
    type($('.lan-code-input'), code.right);
    await waitFor(() => byText('.lan-modal .choice', 'Alles übernehmen'), 10000, 'preview');
    if (mode === 'add') byText('.lan-modal .choice', 'Zu meinen Noten hinzufügen').click();
    check('no stray "null" in the dialog', !/null/.test(asking + modalText()), (asking + modalText()).slice(0, 200));
    return modalText();
  }

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { visibility: hidden; }' }));
    const { store } = window.__np;
    const { db } = store;

    if (phase === '1') {
      db.ui.mode = 'library';
      store.commit('ui');
      await waitFor(() => byText('.empty-actions .btn', 'Aus dem WLAN holen'), 5000, 'empty library');
      byText('.empty-actions .btn', 'Aus dem WLAN holen').click();
      const text = await receive({ wrong: '0000', right: '4711' }, 'mirror');
      check('preview: what comes and what has to be loaded', text.includes('„Testgerät“: 3 Stücke, 1 Setlist') && text.includes('Zu laden: 3 Dateien'), text.slice(0, 200));
      await T.capture('80-wlan-holen');
      localStorage.setItem('np-test-phase', '2');
      byText('.lan-modal .btn', 'Holen').click();
      await sleep(20000);
      check('receiving reloaded the app', false, modalText().slice(0, 200));
    } else if (phase === '2') {
      check('toast after receiving', toastText().includes('Fertig: Noten von „Testgerät“ übernommen – jetzt 3 Stücke'), toastText());
      check('library mirrored: pieces, setlist with numbers, settings', db.pieces.length === 3 && db.setlists[0]?.entries.find((e) => e.number === '47') && db.settings.theme === 'dark');
      const flo = db.pieces.find((p) => p.title === 'Florentiner Marsch');
      const ann = JSON.parse((await window.notenpult.loadAnnotations(flo.id)) || '{"pages":{}}');
      check('annotations came along', Object.values(ann.pages).some((l) => l.length === 1));
      window.__np.openViewer({ queue: [{ pieceId: flo.id, number: '' }], start: 0, context: { kind: 'library' } });
      await waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'page render');
      check('received PDFs open', !!$('.viewer .page canvas.sheet'));
      window.__np.closeViewer();

      // A piece of my own, then "Hinzufügen".
      await window.__np.processRecords(await window.notenpult.importFiles([`${__SAMPLES_DIR__}\\Abel Tasman.pdf`]));
      await sleep(300);
      $('.topbar .icon-btn:last-child').click();
      await waitFor(() => byText('.settings-modal .btn', 'Holen'), 5000, 'settings');
      byText('.settings-modal .btn', 'Holen').click();
      const text = await receive({ right: '4712' }, 'add');
      check('nothing to download when everything is there', text.includes('Alle Notendateien sind schon auf diesem Gerät'), text.slice(0, 200));
      localStorage.setItem('np-test-phase', '3');
      byText('.lan-modal .btn', 'Holen').click();
      await sleep(20000);
      check('second receive reloaded the app', false);
    } else {
      localStorage.removeItem('np-test-phase');
      check('add: own piece kept, the others still there', db.pieces.length === 4 && db.pieces.some((p) => p.title === 'Abel Tasman')
        && toastText().includes('hinzugefügt'), `${db.pieces.length} Stücke · ${toastText()}`);

      // Share: the test runner connects as receiver.
      $('.topbar .icon-btn:last-child').click();
      await waitFor(() => byText('.settings-modal .btn', 'Teilen'), 5000, 'settings');
      byText('.settings-modal .btn', 'Teilen').click();
      const code = await waitFor(() => /^\d{4}$/.test(($('.lan-code') || {}).textContent) && $('.lan-code').textContent, 8000, 'code');
      const where = $('.lan-modal .muted.small').textContent;
      const port = (where.match(/Port (\d+)/) || [])[1] || '47322';
      check('sharing shows a code and the address', /Adresse: 127\.0\.0\.1/.test(where), where);
      await T.capture('81-wlan-teilen');
      console.log(`LANCODE ${code} ${port}`);
      await waitFor(() => /Fertig: „.+“ hat die Noten geholt/.test(($('.lan-status') || {}).textContent), 30000, 'receiver done');
      check('host shows the finished transfer and a new code', $('.lan-code').textContent !== code, $('.lan-status').textContent);
      byText('.lan-modal .btn', 'Beenden').click();
    }
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
