// Turning pages by face (renderer/js/face.js): the gesture logic with recorded-like numbers,
// MediaPipe loading offline, the settings with the test dialog, and the viewer turning pages.
// Chromium's generated camera stands in for a real one (scripts/run-tests.js never opens a webcam).
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
  const sub = () => ($('.v-sub') || {}).textContent || '';

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { display: none !important; }' }));
    const { store } = window.__np;
    const { db } = store;
    const face = await import('./js/face.js');

    // ---------- gesture logic ----------
    const run = (opts, frames, dt = 80) => {
      const d = face.createGestureDetector(opts);
      return frames.map((f, i) => d.update(f, 1000 + i * dt)).filter(Boolean);
    };
    const yaw = (y) => ({
      yaw: y, jaw: 0, blinkL: 0, blinkR: 0,
    });
    check('head: a turn held for two pictures turns once', JSON.stringify(run({ gesture: 'head' }, [yaw(0), yaw(30), yaw(30), yaw(30), yaw(30)])) === '["next"]');
    check('… back to straight, then the other way: back',
      JSON.stringify(run({ gesture: 'head' }, [yaw(30), yaw(30), yaw(0), yaw(0), yaw(0), yaw(0), yaw(0), yaw(0), yaw(0), yaw(0), yaw(-30), yaw(-30)])) === '["next","prev"]');
    check('a quick glance (one picture) does nothing', run({ gesture: 'head' }, [yaw(0), yaw(30), yaw(0), yaw(30), yaw(0)]).length === 0);
    check('"Richtung tauschen"', JSON.stringify(run({ gesture: 'head', swap: true }, [yaw(30), yaw(30)])) === '["prev"]');
    check('sensitivity: 15° is enough when sensitive, not when rough',
      run({ gesture: 'head', sensitivity: 1 }, [yaw(15), yaw(15)]).length === 1 && run({ gesture: 'head', sensitivity: 0 }, [yaw(20), yaw(20)]).length === 0);
    check('no new turn within 0.7 s', run({ gesture: 'head' }, [yaw(30), yaw(30), yaw(0), yaw(30), yaw(30)], 60).length === 1);
    const jaw = (j) => ({
      yaw: 0, jaw: j, blinkL: 0, blinkR: 0,
    });
    check('mouth: open = next, again only after closing',
      JSON.stringify(run({ gesture: 'mouth' }, [jaw(0.6), jaw(0.6), jaw(0.6), jaw(0.6), jaw(0.05), jaw(0.05), jaw(0.05), jaw(0.05), jaw(0.05), jaw(0.05), jaw(0.6), jaw(0.6)])) === '["next","next"]');
    const eyes = (l, r) => ({
      yaw: 0, jaw: 0, blinkL: l, blinkR: r,
    });
    check('wink: right eye = next, left = back; a normal blink (both eyes) = nothing',
      JSON.stringify(run({ gesture: 'wink' }, [eyes(0.9, 0.9), eyes(0.9, 0.9), eyes(0.1, 0.1), eyes(0.05, 0.85), eyes(0.05, 0.85)])) === '["next"]'
      && JSON.stringify(run({ gesture: 'wink' }, [eyes(0.85, 0.05), eyes(0.85, 0.05)])) === '["prev"]');
    check('no face: nothing', run({ gesture: 'head' }, [null, null, null]).length === 0);
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const cats = (o) => Object.entries(o).map(([categoryName, score]) => ({ categoryName, score }));
    const f = face.featuresOf({
      faceBlendshapes: [{ categories: cats({ jawOpen: 0.4, eyeBlinkLeft: 0.1, eyeBlinkRight: 0.7 }) }],
      facialTransformationMatrixes: [{ data: [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, -50, 1] }],
    });
    check('numbers from a MediaPipe result: head 30°, mouth, eyes', Math.abs(f.yaw - 30) < 0.2 && f.jaw === 0.4 && f.blinkR === 0.7, JSON.stringify(f));
    check('… and no face', face.featuresOf({ faceBlendshapes: [], facialTransformationMatrixes: [] }) === null);

    // ---------- MediaPipe offline ----------
    const t0 = performance.now();
    const lm = await face.loadLandmarker();
    const loadMs = performance.now() - t0;
    const cv = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });
    cv.getContext('2d').fillRect(0, 0, 320, 240);
    const t1 = performance.now();
    const res = lm.detectForVideo(cv, performance.now());
    console.log(`PERF face-load ${Math.round(loadMs)}`);
    console.log(`PERF face-detect ${Math.round(performance.now() - t1)}`);
    check('face landmarker loads from the app (no internet) and finds no face in a black picture', face.featuresOf(res) === null);

    // ---------- settings and the test dialog ----------
    $('.topbar .icon-btn:last-child').click();
    await waitFor(() => byText('.settings-modal .settings-section', 'Blättern per Gesicht'), 5000, 'settings');
    const row = byText('.settings-modal .toggle-row', 'Blättern per Gesicht');
    check('settings: switch (off by default), gestures, sensitivity, direction, test', !!row && !row.querySelector('input').checked
      && !!byText('.settings-modal .seg', 'Zwinkern') && !!$('.settings-modal input.range') && !!byText('.settings-modal .toggle-row', 'Richtung tauschen'));
    check('it belongs to the device', ['faceTurns', 'faceGesture', 'faceSensitivity', 'faceSwap'].every((k) => store.DEVICE_SETTINGS.includes(k)));
    byText('.settings-modal .btn', 'Testen').click();
    await waitFor(() => $('.face-modal .face-status')?.textContent === 'Aktiv', 15000, 'camera').catch(() => {});
    check('test dialog: camera picture and live numbers', $('.face-modal video').srcObject && $('.face-modal .face-status').textContent === 'Aktiv',
      $('.face-modal .face-status').textContent);
    await waitFor(() => /^Erkennung: (GPU|CPU) · \d+ ms pro Bild$/.test($('.face-modal .face-info').textContent), 5000, 'info').catch(() => {});
    check('… says what detects (GPU/CPU) and how long a picture takes', /^Erkennung: (GPU|CPU) · \d+ ms pro Bild$/.test($('.face-modal .face-info').textContent),
      $('.face-modal .face-info').textContent);
    face.feedFrame(yaw(30), 5000);
    face.feedFrame(yaw(30), 5080);
    check('… shows what a gesture does', $('.face-action').classList.contains('show') && $('.face-action').textContent.includes('Weiter'));
    await T.capture('100-gesicht-test');
    window.__npBack();
    await sleep(100);
    row.querySelector('input').click();
    await sleep(100);
    check('switched on', db.settings.faceTurns === true);
    window.__npBack();

    // ---------- in the viewer ----------
    await T.resize(1280, 800);
    db.settings.landscapeLayout = 'single';
    store.commit('settings');
    await window.__np.processRecords(await window.notenpult.importFiles([`${__SAMPLES_DIR__}\\Alte Kameraden.pdf`]));
    const alte = db.pieces.find((p) => p.title === 'Alte Kameraden');
    window.__np.openViewer({ queue: [{ pieceId: alte.id, number: '' }], start: 0, context: { kind: 'library' } });
    await waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'viewer');
    await waitFor(() => $('.face-pill') && !$('.face-pill').classList.contains('loading'), 15000, 'face ready').catch(() => {});
    check('viewer: face control on (small sign bottom right)', !!$('.face-pill') && !$('.face-pill').classList.contains('error'), $('.face-pill')?.title);
    let now = 10000;
    const frames = async (list) => {
      now += 1000; // a second between two gestures (there is a 0.7 s pause after each)
      for (const fr of list) {
        now += 80;
        face.feedFrame(fr, now);
      }
      await sleep(400);
    };
    await frames([yaw(0), yaw(30), yaw(30), yaw(0), yaw(0)]);
    check('head turned: next page', sub().includes('Seite 2 von 3'), sub());
    await frames([yaw(-30), yaw(-30), yaw(0), yaw(0)]);
    check('the other way: back', sub().includes('Seite 1 von 3'), sub());
    $('.face-pill').click();
    await frames([yaw(30), yaw(30), yaw(0)]);
    check('paused: nothing happens', sub().includes('Seite 1 von 3') && $('.face-pill').classList.contains('paused'));
    window.__np.closeViewer();
    await sleep(100);
    check('camera off after the viewer', !$('.face-pill') && !face.cameraInUse());
    // ---------- crash guard (2.3.1: the app ended while detecting on an older tablet) ----------
    check('stopped normally: nothing marked as a crash', localStorage.getItem('np-face-guard') === null && face.recoverFromCrash() === null);
    localStorage.setItem('np-face-guard', 'GPU');
    const m1 = face.recoverFromCrash() || '';
    check('ended on the GPU: next time the CPU, and a message', localStorage.getItem('np-face-cpu-only') === '1'
      && localStorage.getItem('np-face-guard') === null && m1.includes('CPU') && db.settings.faceTurns === true, m1);
    localStorage.setItem('np-face-guard', 'CPU');
    const m2 = face.recoverFromCrash() || '';
    check('ended on the CPU: "Blättern per Gesicht" off, slower from now on, a message', db.settings.faceTurns === false
      && localStorage.getItem('np-face-slow') === '1' && m2.includes('ist aus'), m2);
    ['np-face-cpu-only', 'np-face-slow'].forEach((k) => localStorage.removeItem(k));
    db.settings.faceTurns = false;
    store.commit('settings');
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
