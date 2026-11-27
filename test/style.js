// Notenpult 2 style and the own accent colour (theme.js, settings → Darstellung → Akzentfarbe).
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
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  const toRgbArr = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  try {
    await waitFor(() => window.__np && document.body.classList.contains('ready'), 10000, 'app');
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast-root { display: none !important; }' }));
    const { store } = window.__np;
    const { db } = store;
    const theme = await import('./js/theme.js');
    const setTheme = async (t) => {
      db.settings.theme = t;
      store.commit('settings');
      await sleep(50);
    };

    // ---------- defaults ----------
    await setTheme('light');
    check('Notenpult 2: brass accent on light', document.documentElement.dataset.style === 'v2' && token('--accent') === '#c9a046', token('--accent'));
    await setTheme('dark');
    check('… polished brass on dark', token('--accent') === '#d9b45c' && db.settings.accentColor === null, token('--accent'));
    check('"Standard" means the style\'s own colour', theme.defaultAccent() === '#d9b45c');
    check('brass is polished metal (a gradient with highlight and bend), the same in CSS and theme.js',
      token('--accent-metal') === theme.BRASS_METAL && /^linear-gradient/.test(theme.BRASS_METAL), token('--accent-metal'));
    const brand = getComputedStyle($('.brand-mark'));
    check('… on the brand mark and the primary buttons', brand.backgroundImage.includes('rgb(204, 157, 64)') && brand.boxShadow.includes('inset'),
      brand.backgroundImage.slice(0, 60));

    // ---------- building blocks ----------
    check('hex values: with or without #, short form, case; nonsense rejected',
      theme.validHex('#2F6FD0') === '#2f6fd0' && theme.validHex('2f6fd0') === '#2f6fd0' && theme.validHex('#abc') === '#aabbcc'
      && theme.validHex('blau') === null && theme.validHex('#12345') === null && theme.validHex('') === null);
    const white = [255, 255, 255];
    const darkSurface = [27, 28, 31];
    const ok = ['#2f6fd0', '#f5d90a', '#1b1c1f', '#ffffff', '#c0392b', '#7fdbca'].every((c) => {
      const light = theme.accentTokens(c, false);
      const dark = theme.accentTokens(c, true);
      return theme.contrast(toRgbArr(light['--accent-text']), white) >= 4.5 && theme.contrast(toRgbArr(dark['--accent-text']), darkSurface) >= 4.5
        && theme.contrast(toRgbArr(c), toRgbArr(light['--accent-fg'])) >= 3;
    });
    check('any colour stays readable: text shade ≥ 4.5:1, label on buttons ≥ 3:1', ok);
    const sheen = theme.metalSheen('#b8bec7');
    check('any colour becomes metal: Silber gets light edge, itself and a darker bend',
      sheen.includes('#b8bec7 45%') && /^linear-gradient\(165deg, #[0-9a-f]{6} 0%/.test(sheen) && theme.accentTokens('#b8bec7', true)['--accent-metal'] === sheen, sheen);
    check('label colour: white on dark blue, dark on yellow',
      theme.accentTokens('#2f6fd0', false)['--accent-fg'] === '#ffffff' && theme.accentTokens('#f5d90a', false)['--accent-fg'] === '#131416');

    // ---------- in the settings ----------
    db.ui.mode = 'library';
    store.commit('ui');
    $('.topbar .icon-btn:last-child').click();
    const row = await waitFor(() => byText('.settings-modal .setting', 'Akzentfarbe'), 5000, 'settings');
    const picker = row.querySelector('input[type=color]');
    const hex = row.querySelector('.hex-input');
    const reset = byText('.settings-modal .setting .btn', 'Standard');
    check('colour field and hex field, "Standard" is the default',
      !!picker && !!hex && picker.value === '#d9b45c' && hex.value === '' && hex.placeholder === '#d9b45c' && reset.disabled,
      `${picker?.value} ${hex?.placeholder}`);
    hex.value = '#2F6FD0';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    hex.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(80);
    check('typed hex value is used and saved', db.settings.accentColor === '#2f6fd0' && token('--accent') === '#2f6fd0' && picker.value === '#2f6fd0' && !reset.disabled);
    await sleep(250); // buttons fade to a new colour
    const primary = $('.btn.primary');
    check('primary buttons take the colour (as metal)', getComputedStyle(primary).backgroundImage.includes(`${rgb('#2f6fd0')} 45%`),
      getComputedStyle(primary).backgroundImage);
    byText('.settings-modal .settings-section', 'Darstellung').scrollIntoView();
    await sleep(200);
    await T.capture('93-akzentfarbe-einstellungen');
    check('the colour row has no empty gap', row.offsetHeight < 170, `${row.offsetHeight}px`);
    hex.value = 'blau';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    hex.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(50);
    check('nonsense is marked and changes nothing', hex.classList.contains('invalid') && db.settings.accentColor === '#2f6fd0');
    picker.value = '#c0392b';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    check('colour field previews while choosing', token('--accent') === '#c0392b' && hex.value === '#c0392b');
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(50);
    check('… and saves on confirm', db.settings.accentColor === '#c0392b');
    await store.flushSaves();
    const saved = await window.notenpult.loadDb();
    check('stored in the library file', (typeof saved === 'string' ? JSON.parse(saved) : saved).settings.accentColor === '#c0392b');

    // ---------- theme switch, classic style ----------
    const darkText = token('--accent-text');
    await setTheme('light');
    check('light/dark get their own shades of the same colour', token('--accent') === '#c0392b' && token('--accent-text') !== darkText, `${darkText} → ${token('--accent-text')}`);
    db.settings.uiStyle = 'classic';
    store.commit('settings');
    await sleep(50);
    check('own colour also in the classic style', token('--accent') === '#c0392b');
    db.settings.uiStyle = 'v2';
    store.commit('settings');
    await setTheme('dark');

    // ---------- back to the default ----------
    db.settings.accentColor = '#2f6fd0';
    store.commit('settings');
    window.__npBack();
    await sleep(100);
    await T.capture('94-akzentfarbe-blau');
    $('.topbar .icon-btn:last-child').click();
    await waitFor(() => byText('.settings-modal .setting', 'Akzentfarbe'), 5000, 'settings');
    byText('.settings-modal .setting .btn', 'Standard').click();
    await sleep(80);
    check('"Standard" goes back to brass', db.settings.accentColor === null && token('--accent') === '#d9b45c'
      && !document.documentElement.style.getPropertyValue('--accent'));
    const silver = [...document.querySelectorAll('.accent-preset')].find((x) => x.title === 'Silber');
    silver.click();
    await sleep(50);
    check('quick colours look like metal', [...document.querySelectorAll('.accent-preset')].every((x) => getComputedStyle(x).backgroundImage.startsWith('linear-gradient')));
    check('quick colours: Silber, and "Messing" is the default again', db.settings.accentColor === '#b8bec7'
      && ([...document.querySelectorAll('.accent-preset')].find((x) => x.title.startsWith('Messing')).click(), db.settings.accentColor === null));
    window.__npBack();
  } catch (err) {
    console.error('SMOKE FAIL', err && err.stack ? err.stack : err);
  }
  await sleep(200);
  await T.done();
})();
