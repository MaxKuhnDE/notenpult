// Setting "Mehrseitige Stücke scrollen" (Einstellungen → Notenansicht): pieces with several pages stand one
// below the other in full width and scroll; a tap scrolls on, at the end into the next piece; one-page pieces
// keep their layout; a view remembered for a piece wins; the switch is also in the ⋯ menu.
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
  const fire = (el, type, o) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, ...o }));
  const boxes = () => [...document.querySelectorAll('.viewer .page')];
  const title = () => ($('.v-title') || {}).textContent || '';
  const scrolls = () => !!$('.viewer .stage.scroll');
  const pagesReady = async () => {
    await sleep(80);
    return waitFor(() => !$('.viewer.loading') && $('.viewer .page canvas.sheet'), 10000, 'page render');
  };

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { display: none !important; }' }));
    const { store } = window.__np;
    const { db } = store;
    await T.resize(1280, 800);
    await sleep(300);
    const dir = __SAMPLES_DIR__;
    await window.__np.processRecords(await window.notenpult.importFiles(['Alte Kameraden.pdf', 'Polka Nr 5.png'].map((f) => `${dir}\\${f}`)));
    const alte = db.pieces.find((p) => p.title === 'Alte Kameraden');
    const polka = db.pieces.find((p) => p.title === 'Polka Nr 5');
    const open = async (pieces) => {
      window.__np.openViewer({ queue: pieces.map((p) => ({ pieceId: p.id, number: '' })), start: 0, context: { kind: 'library' } });
      await pagesReady();
    };
    const openMenu = async () => {
      $('.viewer .icon-btn[title="Ansicht & mehr"]').click();
      await waitFor(() => $('.menu-item'), 3000, 'menu');
    };

    // ---------- the setting ----------
    check('off by default, belongs to the device', db.settings.scrollPages === false && store.DEVICE_SETTINGS.includes('scrollPages'));
    await open([alte]);
    check('off: 3 pages shown as usual (two side by side), no scrolling', boxes().length === 2 && !scrolls(), `${boxes().length}`);
    window.__np.closeViewer();

    $('.topbar .icon-btn:last-child').click();
    const row = await waitFor(() => byText('.settings-modal .toggle-row', 'Mehrseitige Stücke scrollen'), 5000, 'settings');
    const sections = [...document.querySelectorAll('.settings-modal .settings-section')];
    const section = sections.filter((s) => s.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
    check('switch in the settings under "Notenansicht", after the layouts', !!section && section.textContent === 'Notenansicht'
      && !!(byText('.settings-modal .setting-label', 'Hochformat').compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)
      && !row.querySelector('input').checked, section && section.textContent);
    const body = row.closest('.modal-body');
    if (body) body.scrollTop += row.getBoundingClientRect().top - body.getBoundingClientRect().top - 260;
    await sleep(300);
    row.querySelector('input').click();
    await sleep(200);
    check('switched on, saved', db.settings.scrollPages === true);
    window.__npBack();
    await sleep(200);

    // ---------- several pages: one below the other, scrolling ----------
    await open([alte, polka]);
    const st = $('.viewer .stage');
    const r0 = () => st.getBoundingClientRect();
    const b = boxes();
    const stacked = b.length === 3 && b.every((x, i) => i === 0 || x.offsetTop >= b[i - 1].offsetTop + b[i - 1].offsetHeight);
    const wide = b.every((x) => x.offsetWidth >= st.clientWidth - 40);
    check('on: all 3 pages one below the other in full width', stacked && wide && scrolls(),
      `${b.length} pages · ${b.map((x) => `${x.offsetTop}/${x.offsetWidth}`).join(' ')} · stage ${st.clientWidth}`);
    check('… taller than the screen: it scrolls', st.scrollHeight > st.clientHeight * 2 && getComputedStyle(st).overflowY !== 'hidden',
      `${st.scrollHeight} / ${st.clientHeight} ${getComputedStyle(st).overflowY}`);
    await waitFor(() => b.every((x) => x.querySelector('canvas.sheet')), 8000, 'all pages drawn').catch(() => {});
    check('every page is drawn', b.every((x) => x.querySelector('canvas.sheet')));
    const sub = () => ($('.v-sub') || {}).textContent || '';
    check('at the top: "Seite 1 von 3", no "Letzte Seite" yet', /Seite 1 von 3/.test(sub()) && !sub().includes('Letzte Seite'), sub());
    st.scrollTop = st.scrollHeight;
    // the bar follows on the next frame (on CI a moment later)
    await waitFor(() => sub().includes('Letzte Seite'), 3000, 'bar follows').catch(() => {});
    check('scrolled to the end: the bar follows, "Letzte Seite · Als Nächstes"', /Seite 3 von 3|Seiten 2–3 von 3/.test(sub())
      && sub().includes('Letzte Seite · Als Nächstes: Polka Nr 5'), sub());
    // the pen on page 2, further down
    const p2 = b[1].getBoundingClientRect();
    st.scrollTop = b[1].offsetTop - 100;
    await sleep(150);
    const q2 = b[1].getBoundingClientRect();
    const y0 = Math.max(q2.top, r0().top) + 120;
    const x0 = q2.left + q2.width * 0.3;
    fire(st, 'pointerdown', { pointerId: 9, pointerType: 'pen', clientX: x0, clientY: y0, button: 0, buttons: 1, pressure: 0.6 });
    for (let k = 1; k <= 6; k++) fire(st, 'pointermove', { pointerId: 9, pointerType: 'pen', clientX: x0 + k * 25, clientY: y0 + k * 6, buttons: 1, pressure: 0.6 });
    fire(st, 'pointerup', { pointerId: 9, pointerType: 'pen', clientX: x0 + 150, clientY: y0 + 36, button: 0, buttons: 0 });
    await sleep(200);
    const inkMod = await import('./js/ink.js');
    const ann = await inkMod.load(alte.id);
    const onPage = (i) => inkMod.strokesOf(ann, alte.parts[0].pages[i].id).length;
    check('the pen writes on the page under it (page 2, scrolled down)', onPage(1) === 1 && onPage(0) === 0 && onPage(2) === 0 && p2.top !== q2.top,
      `${onPage(0)} ${onPage(1)} ${onPage(2)}`);
    await sleep(1000); // after the pen, a finger is ignored for a moment (palm on the screen)
    st.scrollTop = 600;
    await sleep(100);
    check('scrolling by hand (finger, mouse wheel, scroll ring) moves the notes', st.scrollTop === 600 && title().includes('Alte Kameraden'),
      `${st.scrollTop} · ${title()}`);
    await T.capture('104-mehrseitig-scrollen');
    st.scrollTop = 0;
    const r = st.getBoundingClientRect();
    const tap = async () => {
      fire(st, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: r.left + r.width * 0.6, clientY: r.top + r.height * 0.5, button: 0, buttons: 1 });
      await sleep(30);
      fire(st, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: r.left + r.width * 0.6, clientY: r.top + r.height * 0.5, button: 0, buttons: 0 });
      await sleep(250);
    };
    await tap();
    await waitFor(() => st.scrollTop > 0, 2000, 'tap scrolls').catch(() => {});
    check('a tap scrolls on by most of a screen', st.scrollTop > st.clientHeight * 0.6 && st.scrollTop < st.clientHeight && title().includes('Alte Kameraden'),
      `${st.scrollTop} of ${st.clientHeight}`);
    for (let i = 0; i < 12 && title().includes('Alte Kameraden'); i++) await tap();
    await pagesReady();
    check('at the end, a tap goes into the next piece', title().includes('Polka Nr 5'), title());

    // ---------- one page: as set above ----------
    check('a one-page piece keeps its layout (no scrolling)', boxes().length === 1 && !scrolls(), `${boxes().length} ${scrolls()}`);
    window.__np.closeViewer();

    // ---------- a view remembered for a piece wins; the ⋯ menu ----------
    store.setPartLayout(alte.parts[0], 'two');
    await open([alte]);
    check('a view remembered for the piece wins ("Zwei Seiten")', boxes().length === 2 && !scrolls(), `${boxes().length}`);
    store.setPartLayout(alte.parts[0], null);
    window.__np.closeViewer();
    await open([alte]);
    await openMenu();
    check('⋯ menu: "Wie in den Einstellungen (Scrollen)" is chosen', !!byText('.menu-item.checked', 'Wie in den Einstellungen (Scrollen)'));
    const item = byText('.menu-item', 'Mehrseitige Stücke scrollen');
    check('⋯ menu: the switch is there too, on', !!item && item.classList.contains('checked'));
    item.click();
    await sleep(200);
    await pagesReady();
    check('switched off in the menu: two pages again, setting saved', db.settings.scrollPages === false && boxes().length === 2 && !scrolls(),
      `${db.settings.scrollPages} ${boxes().length}`);

    // with "Ansicht je Stück merken" off, a view picked in the menu wins over scrolling
    db.settings.piecePresets = false;
    db.settings.scrollPages = true;
    store.commit('settings');
    await sleep(200);
    await pagesReady();
    check('presets off: scrolls', scrolls());
    await openMenu();
    byText('.menu-item', 'Immer zwei Seiten').click();
    await sleep(200);
    await pagesReady();
    check('presets off: picking "Zwei Seiten" in the menu shows two pages (scrolling off)', !scrolls() && boxes().length === 2
      && db.settings.landscapeLayout === 'two' && db.settings.scrollPages === false, `${boxes().length} ${db.settings.scrollPages}`);
    window.__np.closeViewer();
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
