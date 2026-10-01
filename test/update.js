// Update button: check, release notes, small (app.asar) download with SHA-256 check.
// scripts/run-tests.js serves a fake release v99.0.0 on localhost (NOTENPULT_UPDATE_API).
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

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { display: none !important; }' }));
    const info = await window.notenpult.info();

    document.querySelector('.topbar .icon-btn:last-child').click();
    await waitFor(() => $('.update-settings'), 5000, 'settings');
    await sleep(200);
    check('settings show installed version', $('.update-settings .setting-label').textContent.includes(info.version), $('.update-settings .setting-label').textContent);

    byText('.update-settings .btn', 'Nach Updates suchen').click();
    await waitFor(() => $('.update-card'), 10000, 'update card');
    const card = $('.update-card').textContent;
    check('new version found', card.includes('Version 99.0.0 ist verfügbar'));
    check('only the app part is downloaded', card.includes('nur der App-Teil') && card.includes('0,3 MB'), card.match(/Download[^–]+/)?.[0]);
    check('release notes shown', $('.update-notes')?.textContent.includes('Testfunktion für den Update-Knopf'));
    check('settings button shows a badge', document.querySelector('.topbar .icon-btn:last-child').classList.contains('has-badge'));
    await sleep(200);
    await T.capture('60-update-available');

    byText('.update-card .btn', 'Jetzt aktualisieren').click();
    await waitFor(() => $('.update-card')?.textContent.includes('Testmodus') || $('.update-msg.error'), 20000, 'download');
    check('download verified (SHA-256) and staged', $('.update-card')?.textContent.includes('Update geladen und geprüft'), $('.update-msg.error')?.textContent);
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
