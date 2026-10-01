import { db, commit, backend } from './store.js';

const mq = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

export function isDark() {
  const t = db.settings.theme;
  return t === 'dark' || (t === 'system' && mq.matches);
}

export function applyTheme() {
  const theme = isDark() ? 'dark' : 'light';
  if (document.documentElement.dataset.theme !== theme) {
    document.documentElement.dataset.theme = theme;
    for (const fn of listeners) fn(theme);
  }
  backend.setTheme(db.settings.theme);
}

export function toggleDark() {
  db.settings.theme = isDark() ? 'light' : 'dark';
  commit('settings');
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

mq.addEventListener('change', applyTheme);
