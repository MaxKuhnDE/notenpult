import { db, commit, backend } from './store.js';

const mq = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

export function isDark() {
  const t = db.settings.theme;
  return t === 'dark' || (t === 'system' && mq.matches);
}

// ---------- accent colour (settings.accentColor, null = the style's own) ----------

const ACCENT_VARS = ['--accent', '--accent-hover', '--accent-fg', '--accent-soft', '--accent-text', '--accent-metal'];

/** Polished, lacquered brass: highlight, body, the dark bend and a second reflection (as in styles.css). */
export const BRASS_METAL = 'linear-gradient(165deg, #f8e8ab 0%, #e6c672 18%, #cc9d40 45%, #a9792b 68%, #dcb65e 86%, #b98832 100%)';

/** "#abc", "aabbcc", "#AABBCC" → "#aabbcc"; anything else → null. */
export function validHex(value) {
  let v = String(value || '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(v)) v = v.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/.test(v) ? `#${v}` : null;
}

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two colours (1 … 21). */
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * The accent as polished metal: a light edge, the colour itself, a darker bend and a second
 * reflection – Messing, Silber and Kupfer look like the instruments, other colours like anodised metal.
 * Dark colours (white label) get a softer highlight so the label stays readable.
 */
export function metalSheen(hex) {
  const c = toRgb(validHex(hex) || '#c9a046');
  const white = [255, 255, 255];
  const black = [0, 0, 0];
  const hi = contrast(c, white) >= contrast(c, black) ? 0.3 : 0.55;
  const L = (t) => toHex(mix(c, white, t));
  const D = (t) => toHex(mix(c, black, t));
  return `linear-gradient(165deg, ${L(hi)} 0%, ${L(hi * 0.45)} 18%, ${toHex(c)} 45%, ${D(0.18)} 68%, ${L(hi * 0.3)} 86%, ${D(0.08)} 100%)`;
}

/** All accent tokens from one colour: readable label on it, hover shade, tint, and a text shade with 4.5:1. */
export function accentTokens(hex, dark) {
  const c = toRgb(hex);
  const white = [255, 255, 255];
  const black = [0, 0, 0];
  const surface = dark ? [27, 28, 31] : white;
  let text = c;
  for (let i = 0; i < 24 && contrast(text, surface) < 4.5; i++) text = mix(text, dark ? white : black, 0.1);
  return {
    '--accent': hex,
    '--accent-hover': toHex(mix(c, dark ? white : black, 0.14)),
    '--accent-fg': contrast(c, white) >= contrast(c, black) ? '#ffffff' : '#131416',
    '--accent-soft': `rgba(${c.join(', ')}, ${dark ? 0.16 : 0.12})`,
    '--accent-text': toHex(text),
    '--accent-metal': metalSheen(hex),
  };
}

function applyAccent(dark) {
  const { style } = document.documentElement;
  const hex = validHex(db.settings.accentColor);
  if (!hex) for (const v of ACCENT_VARS) style.removeProperty(v);
  else for (const [k, v] of Object.entries(accentTokens(hex, dark))) style.setProperty(k, v);
}

/** The style's own accent for the current theme (what "Standard" means). */
export function defaultAccent() {
  const { style } = document.documentElement;
  const saved = ACCENT_VARS.map((v) => [v, style.getPropertyValue(v)]);
  for (const v of ACCENT_VARS) style.removeProperty(v);
  const value = validHex(getComputedStyle(document.documentElement).getPropertyValue('--accent')) || '#808080';
  for (const [k, v] of saved) if (v) style.setProperty(k, v);
  return value;
}

export function applyTheme() {
  document.documentElement.dataset.style = db.settings.uiStyle === 'classic' ? 'classic' : 'v2';
  const theme = isDark() ? 'dark' : 'light';
  applyAccent(theme === 'dark');
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
