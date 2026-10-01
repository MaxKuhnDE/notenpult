import * as store from './store.js';
import {
  db, init, subscribe, commit, backend, persist, setlistQueue,
} from './store.js';
import {
  h, icon, iconBtn, hasOpenModal, popMenu,
} from './ui.js';
import { applyTheme, isDark, toggleDark, onThemeChange } from './theme.js';
import { renderLibrary } from './library.js';
import { renderSetlists } from './setlists.js';
import { openSettings, openPoolSetup } from './settings.js';
import { importDropped, processRecords } from './importer.js';
import { setCropListener } from './render.js';
import { openSearch } from './search.js';
import * as sync from './sync.js';
import * as ink from './ink.js';
import {
  openViewer, closeViewer, isViewerOpen, next, prev,
} from './viewer.js';

const appEl = document.getElementById('app');
let viewEl;
let modeButtons;
let themeBtn;
let cloudBtn;
let dropOverlay;

function setMode(mode) {
  if (db.ui.mode === mode) return;
  db.ui.mode = mode;
  commit('ui');
}

function openGlobalSearch() {
  openSearch({
    title: 'Suchen',
    onPiece: (id) => openViewer({ queue: [{ pieceId: id, number: '' }], start: 0, context: { kind: 'library', name: 'Suche' } }),
    onEntry: (s, e) => {
      const queue = setlistQueue(s);
      openViewer({ queue, start: Math.max(0, queue.findIndex((q) => q.entryId === e.id)), context: { kind: 'setlist', name: s.name } });
    },
    onSetlist: (s) => {
      db.ui.mode = 'setlists';
      db.ui.setlistId = s.id;
      commit('ui');
    },
  });
}

const CLOUD = {
  off: { icon: 'cloud', title: 'Google Drive verbinden', cls: '' },
  idle: { icon: 'cloud', title: 'Noten-Pool verbunden', cls: 'ok' },
  ok: { icon: 'cloud', title: 'Noten-Pool synchronisiert', cls: 'ok' },
  syncing: { icon: 'refresh', title: 'Noten-Pool wird synchronisiert …', cls: 'syncing' },
  offline: { icon: 'cloudOff', title: 'Noten-Pool offline – gespeicherte Kopien werden genutzt', cls: 'offline' },
};

function updateCloud() {
  if (!cloudBtn) return;
  const s = CLOUD[sync.syncStatus()] || CLOUD.off;
  cloudBtn.replaceChildren(icon(s.icon));
  cloudBtn.title = s.title;
  cloudBtn.className = `icon-btn cloud-btn ${s.cls}`;
}

function cloudMenu(anchor) {
  if (!sync.isLinked()) {
    openPoolSetup();
    return;
  }
  popMenu(anchor, [
    { heading: CLOUD[sync.syncStatus()]?.title || 'Noten-Pool' },
    { label: 'Jetzt synchronisieren', icon: 'refresh', onClick: () => sync.syncNow({ manual: true }) },
    { label: 'Im Noten-Pool suchen …', icon: 'search', onClick: openGlobalSearch },
    { label: 'Noten-Pool einrichten …', icon: 'settings', onClick: () => openPoolSetup(db.sync.folder) },
  ]);
}

function buildShell() {
  modeButtons = [
    h('button.seg', { type: 'button', role: 'tab', dataset: { mode: 'setlists' }, onclick: () => setMode('setlists') }, icon('list'), h('span', null, 'Setlists')),
    h('button.seg', { type: 'button', role: 'tab', dataset: { mode: 'library' }, onclick: () => setMode('library') }, icon('az'), h('span', null, 'A–Z')),
  ];
  themeBtn = iconBtn('moon', 'Hell / Dunkel', toggleDark);
  cloudBtn = sync.available() ? iconBtn('cloud', 'Google Drive', (e) => cloudMenu(e.currentTarget), { class: 'cloud-btn' }) : null;
  const top = h('header.topbar', null,
    h('div.brand', null, h('span.brand-mark', null, icon('music')), h('span.brand-name', null, 'Notenpult')),
    h('div.segmented.mode-switch', { role: 'tablist' }, modeButtons),
    h('div.spacer'),
    h('button.btn.ghost.search-btn', { type: 'button', title: 'Suchen (Strg+F)', onclick: openGlobalSearch }, icon('search'), h('span', null, 'Suchen')),
    cloudBtn,
    themeBtn,
    iconBtn('settings', 'Einstellungen', () => openSettings()));
  viewEl = h('main.view');
  dropOverlay = h('div.drop-overlay', null, h('div.drop-box', null, icon('import'), h('span', null, 'Noten hier ablegen')));
  appEl.replaceChildren(top, viewEl, dropOverlay);
  updateCloud();
}

function render() {
  for (const b of modeButtons) {
    const active = b.dataset.mode === db.ui.mode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  }
  themeBtn.replaceChildren(icon(isDark() ? 'sun' : 'moon'));
  themeBtn.title = isDark() ? 'Helles Design' : 'Dunkles Design';
  updateCloud();
  if (db.ui.mode === 'library') renderLibrary(viewEl);
  else renderSetlists(viewEl);
}

function setupDragAndDrop() {
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || isViewerOpen()) return;
    e.preventDefault();
    depth += 1;
    dropOverlay.classList.add('show');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isViewerOpen() ? 'none' : 'copy';
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) dropOverlay.classList.remove('show');
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    dropOverlay.classList.remove('show');
    if (isViewerOpen() || !e.dataTransfer?.files?.length) return;
    const ids = await importDropped(e.dataTransfer.files);
    if (ids.length && db.ui.mode !== 'library') {
      db.ui.mode = 'library';
      commit('ui');
    }
  });
}

function setupShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (isViewerOpen() || hasOpenModal()) return;
    if (e.key === 'F11') {
      e.preventDefault();
      backend.isFullscreen().then((on) => backend.setFullscreen(!on));
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      openGlobalSearch();
    }
  });
}

async function start() {
  await init();
  applyTheme();
  setCropListener(persist);
  buildShell();
  render();
  subscribe((what) => {
    if (what === 'settings') applyTheme();
    render();
  });
  onThemeChange(() => render());
  sync.onSyncChange(updateCloud);
  setupDragAndDrop();
  setupShortcuts();
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('input, textarea')) e.preventDefault();
  });
  // Pending annotation saves are debounced; write them out when the window closes.
  window.addEventListener('beforeunload', () => { ink.flushAll(); });
  sync.startAutoSync();
  // Handle for automated smoke tests.
  window.__np = {
    store, sync, processRecords, openViewer, closeViewer, next, prev,
  };
  document.body.classList.add('ready');
}

start().catch((err) => {
  console.error(err);
  appEl.textContent = `Notenpult konnte nicht starten: ${err.message}`;
});
