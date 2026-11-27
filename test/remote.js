// Foot pedals and remotes (renderer/js/remote.js, hwkeys.js): default keys, held keys, selfie
// shutters that send two keys, volume/media keys from the main process, mouse wheel and scroll-ring
// swipes, the dialog that learns keys, the switches – and the style switch of Notenpult 2.
(async () => {
  const T = window.notenpult.test;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 8000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(30);
    }
    throw new Error(`timeout waiting for ${what}`);
  };
  const $ = (s) => document.querySelector(s);
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => el.textContent.includes(text));
  const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  const key = (k, o = {}) => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...o,
  }));
  const sub = () => ($('.v-sub') || {}).textContent || '';
  const title = () => ($('.v-title') || {}).textContent || '';
  const pagesReady = async () => {
    await sleep(60);
    return waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'page render');
  };
  const page = async (n, of = 3) => {
    await waitFor(() => sub().includes(`Seite ${n} von ${of}`), 4000, `page ${n}`).catch(() => {});
    await pagesReady();
    await sleep(200); // a human's next press (and past the selfie-shutter double-key window)
    return sub().includes(`Seite ${n} von ${of}`);
  };
  const touchSwipe = async (dy, id) => {
    const r = $('.stage').getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y0 = r.top + r.height / 2;
    const fire = (type, y, buttons) => $('.stage').dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, isPrimary: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0, buttons,
    }));
    fire('pointerdown', y0, 1);
    for (let i = 1; i <= 5; i++) fire('pointermove', y0 + (dy * i) / 5, 1);
    await sleep(40);
    fire('pointerup', y0 + dy, 0);
  };
  const wheel = (deltaY) => $('.stage').dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { visibility: hidden; }' }));
    const { store } = window.__np;
    const { db } = store;
    const remote = await import('./js/remote.js');

    // ---------- building blocks ----------
    check('Notenpult 2 is the default style', document.documentElement.dataset.style === 'v2' && db.settings.uiStyle === 'v2');
    db.settings.uiStyle = 'classic';
    store.commit('settings');
    await sleep(50);
    check('"Klassisch" switches the style back', document.documentElement.dataset.style === 'classic');
    db.settings.uiStyle = 'v2';
    store.commit('settings');
    check('pedal settings belong to the device', ['remoteKeys', 'volumeKeys', 'wheelTurns', 'swipeTurns'].every((k) => store.DEVICE_SETTINGS.includes(k)));
    check('MIDI: note on, controller pressed, program change; releases ignored',
      remote.midiKeyId([0x90, 60, 100]) === 'midi:n60' && remote.midiKeyId([0x90, 60, 0]) === null && remote.midiKeyId([0x80, 60, 0]) === null
      && remote.midiKeyId([0xb1, 64, 127]) === 'midi:cc64' && remote.midiKeyId([0xb0, 64, 0]) === null && remote.midiKeyId([0xc0, 5]) === 'midi:pc5');
    check('key names', remote.keyId({ key: 'PageDown' }) === 'PageDown' && remote.keyId({ key: 'S', shiftKey: true }) === 's'
      && remote.keyId({ key: 's', ctrlKey: true }) === 'Strg+s' && remote.keyId({ key: 'Unidentified', code: '', keyCode: 183 }) === '#183'
      && remote.keyLabel('midi:cc64') === 'MIDI CC 64' && remote.keyLabel('AudioVolumeUp') === 'Lauter' && remote.keyLabel(' ') === 'Leertaste',
    [remote.keyId({ key: 'Unidentified', code: '', keyCode: 183 }), remote.keyLabel('midi:cc64')].join(' '));

    // ---------- library: one page per screen, so every action is one page ----------
    await T.resize(1280, 800);
    db.settings.landscapeLayout = 'single';
    store.commit('settings');
    const dir = __SAMPLES_DIR__;
    const files = ['Alte Kameraden.pdf', 'Florentiner Marsch.pdf', 'Florentiner Marsch - 2. Stimme.pdf', 'Böhmischer Traum.pdf'];
    await window.__np.processRecords(await window.notenpult.importFiles(files.map((f) => `${dir}\\${f}`)));
    const p = (t) => db.pieces.find((x) => x.title === t);
    const queue = ['Alte Kameraden', 'Florentiner Marsch', 'Böhmischer Traum'].map((t) => ({ pieceId: p(t).id, number: '' }));
    const open = async () => {
      window.__np.openViewer({ queue, start: 0, context: { kind: 'library' } });
      await pagesReady();
    };

    check('no capture of volume keys outside the viewer', (await T.hwCapture()) === false);
    await open();
    check('viewer takes volume and media keys from the system', (await T.hwCapture()) === true);
    key('PageDown');
    check('pedal "Bild ↓" turns the page', await page(2));
    key('ArrowLeft');
    check('pedal "←" turns back', await page(1));
    key('PageDown', { repeat: true });
    await sleep(300);
    check('a pedal held down does not keep turning', sub().includes('Seite 1 von 3'), sub());

    // Selfie shutter: Enter and "Volume up" for one press.
    key('Enter');
    T.hwKey('AudioVolumeUp');
    await sleep(400);
    check('selfie shutter (Enter + Lauter at once): one page', sub().includes('Seite 2 von 3'), sub());
    await T.hwKey('AudioVolumeUp');
    check('"Lauter" from the system turns the page', await page(3));
    await T.hwKey('MediaTrackPrevious');
    check('"Voriger Titel" turns back', await page(2));

    // Scroll ring / mouse wheel: one page per turn of the wheel.
    wheel(120);
    check('mouse wheel down: next page', await page(3));
    await sleep(400);
    wheel(-120);
    wheel(-120);
    wheel(-120);
    await sleep(400);
    check('one turn of the wheel = one page (not three)', sub().includes('Seite 2 von 3'), sub());
    await touchSwipe(-220, 11);
    check('swipe up (scroll ring): next page', await page(3));
    await touchSwipe(220, 12);
    check('swipe down: previous page', await page(2));
    window.__np.closeViewer();
    check('volume keys go back to the system after the viewer', (await T.hwCapture()) === false);

    // ---------- dialog: learn keys ----------
    $('.topbar .icon-btn:last-child').click();
    await waitFor(() => byText('.settings-modal .setting', 'Tasten testen & zuweisen'), 5000, 'settings');
    byText('.settings-modal .setting', 'Tasten testen & zuweisen').querySelector('.btn').click();
    await waitFor(() => $('.remote-modal'), 3000, 'dialog');
    check('dialog listens to volume keys too', (await T.hwCapture()) === true);
    key('PageDown');
    check('dialog shows what arrives', $('.remote-status').textContent.includes('Erkannt: „Bild ↓“ – Weiter'), $('.remote-status').textContent);
    key('F7');
    check('unknown key is named', $('.remote-status').textContent.includes('„F7“ – noch nicht zugewiesen'), $('.remote-status').textContent);
    const row = (label) => [...document.querySelectorAll('.remote-row')].find((r) => r.querySelector('.remote-action').textContent === label);
    row('Nächstes Stück').querySelector('.btn').click();
    await sleep(50);
    key('F8');
    await sleep(50);
    check('learned: F8 = next piece', row('Nächstes Stück').textContent.includes('F8') && remote.bindings().nextPiece.includes('F8'),
      row('Nächstes Stück').textContent);
    row('Nächste Stimme').querySelector('.btn').click();
    await T.hwKey('Camera');
    await sleep(50);
    check('learned from the system: Kamera = next part (and no longer "Weiter")',
      remote.bindings().nextPart.includes('Camera') && !remote.bindings().next.includes('Camera'), JSON.stringify(remote.bindings().nextPart));
    const chip = [...row('Zurück').querySelectorAll('.key-chip')].find((c) => c.textContent.includes('Rücktaste'));
    chip.querySelector('.key-remove').click();
    await sleep(50);
    check('a key can be removed', !remote.bindings().prev.includes('Backspace'));
    check('saved for this device', Array.isArray(db.settings.remoteKeys?.nextPiece) && db.settings.remoteKeys.nextPiece.includes('F8'));
    await T.capture('92-pedal-dialog');
    byText('.remote-modal .btn', 'Fertig').click();
    await sleep(100);
    window.__npBack();
    await sleep(100);
    check('dialog closed: volume keys back to the system', (await T.hwCapture()) === false);

    // ---------- learned keys in the viewer ----------
    await open();
    key('F8');
    await waitFor(() => title().includes('Florentiner Marsch'), 4000, 'next piece').catch(() => {});
    check('F8: next piece', title().includes('Florentiner Marsch'), title());
    await pagesReady();
    await sleep(200);
    await T.hwKey('Camera');
    await waitFor(() => ($('.v-part') || {}).textContent?.includes('2. Stimme'), 4000, 'part').catch(() => {});
    check('Kamera: next part', $('.v-part').textContent.includes('2. Stimme'), $('.v-part').textContent);
    window.__np.closeViewer();

    // ---------- switches ----------
    db.settings.volumeKeys = false;
    db.settings.wheelTurns = false;
    db.settings.swipeTurns = false;
    store.commit('settings');
    await open();
    check('switch off: volume keys stay with the system', (await T.hwCapture()) === false);
    await T.hwKey('AudioVolumeUp');
    wheel(120);
    await touchSwipe(-220, 13);
    await sleep(400);
    check('switches off: volume key, wheel and swipe do nothing', sub().includes('Seite 1 von 3'), sub());
    key('PageDown');
    check('pedal keys still work', await page(2));
    window.__np.closeViewer();
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
