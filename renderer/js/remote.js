// Foot pedals and remotes. Bluetooth page turners (AirTurn, PageFlip, M-Vave/Cuvave, Donner …)
// pair as keyboards and send Page Down/Up, arrows or Enter/Backspace; selfie shutters send
// "Volume up" (some also Enter); scroll rings swipe like a finger (viewer.js) or send volume keys;
// MIDI pedals send notes or controllers. Every key can be assigned to an action here.
// Volume and media keys belong to the system: the main process (hwkeys.js) or MainActivity take
// them while the viewer is open ("capture") and hand them over via backend.onHardwareKey.

import { db, commit, backend } from './store.js';
import {
  h, fill, icon, btn, modal,
} from './ui.js';

export const ACTIONS = [
  ['next', 'Weiter'],
  ['prev', 'Zurück'],
  ['nextPiece', 'Nächstes Stück'],
  ['prevPiece', 'Voriges Stück'],
  ['nextPart', 'Nächste Stimme'],
  ['link', 'Sprung-Link folgen'],
];

export const DEFAULT_KEYS = {
  next: ['PageDown', 'ArrowRight', 'ArrowDown', ' ', 'Enter', 'AudioVolumeUp', 'MediaTrackNext', 'MediaPlayPause', 'Camera'],
  prev: ['PageUp', 'ArrowLeft', 'ArrowUp', 'Backspace', 'AudioVolumeDown', 'MediaTrackPrevious'],
  nextPiece: [],
  prevPiece: [],
  nextPart: [],
  link: [],
};

/** Keys the system sends (only with the setting "volumeKeys"; otherwise they change the volume). */
export const SYSTEM_KEYS = new Set(['AudioVolumeUp', 'AudioVolumeDown', 'MediaTrackNext', 'MediaTrackPrevious', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'Camera']);

const LABELS = {
  PageDown: 'Bild ↓',
  PageUp: 'Bild ↑',
  ArrowRight: '→',
  ArrowLeft: '←',
  ArrowDown: '↓',
  ArrowUp: '↑',
  ' ': 'Leertaste',
  Enter: 'Enter',
  Backspace: 'Rücktaste',
  Tab: 'Tab',
  AudioVolumeUp: 'Lauter',
  AudioVolumeDown: 'Leiser',
  MediaTrackNext: 'Nächster Titel',
  MediaTrackPrevious: 'Voriger Titel',
  MediaPlayPause: 'Play/Pause',
  MediaPlay: 'Play',
  MediaPause: 'Pause',
  Camera: 'Kamera',
};

/** Stable name of a pressed key, e.g. "PageDown", "f8", "Strg+s", "code:KeyB". */
export function keyId(e) {
  let k = e.key;
  if (!k || k === 'Unidentified' || k === 'Dead' || k === 'Process') k = e.code ? `code:${e.code}` : `#${e.keyCode || 0}`;
  else if (k.length === 1) k = k.toLowerCase();
  const mods = [e.ctrlKey && 'Strg', e.altKey && 'Alt', e.metaKey && 'Win'].filter(Boolean);
  return mods.length && !['Control', 'Alt', 'Meta', 'Shift'].includes(k) ? `${mods.join('+')}+${k}` : k;
}

/** Key name for a MIDI message that means "pressed" (note on, controller ≥ 64, program change), else null. */
export function midiKeyId(data) {
  const [status = 0, a = 0, b = 0] = data;
  const type = status & 0xf0;
  if (type === 0x90 && b > 0) return `midi:n${a}`;
  if (type === 0xb0 && b >= 64) return `midi:cc${a}`;
  if (type === 0xc0) return `midi:pc${a}`;
  return null;
}

export function keyLabel(id) {
  const mods = id.length > 1 ? id.match(/^((?:Strg|Alt|Win)\+)+/) : null;
  const base = mods ? id.slice(mods[0].length) : id;
  let label;
  if (LABELS[base]) label = LABELS[base];
  else if (base.startsWith('midi:')) {
    const [, kind, n] = base.match(/^midi:(n|cc|pc)(\d+)$/) || [];
    label = kind ? `MIDI ${{ n: 'Note', cc: 'CC', pc: 'Programm' }[kind]} ${n}` : base;
  } else if (base.startsWith('code:')) label = base.slice(5);
  else if (base.startsWith('#')) label = `Taste ${base.slice(1)}`;
  else label = base.length === 1 ? base.toUpperCase() : base;
  return (mods ? mods[0] : '') + label;
}

export const actionLabel = (action) => (ACTIONS.find(([a]) => a === action) || [])[1] || action;

/** The assignment in use: { action: [key, …] } (a copy). */
export function bindings() {
  const own = db.settings.remoteKeys;
  const out = {};
  for (const [a] of ACTIONS) out[a] = [...((own && Array.isArray(own[a]) ? own[a] : DEFAULT_KEYS[a]) || [])];
  return out;
}

export function actionFor(id) {
  if (SYSTEM_KEYS.has(id) && !db.settings.volumeKeys) return null;
  const all = bindings();
  return ACTIONS.map(([a]) => a).find((a) => all[a].includes(id)) || null;
}

function save(keys) {
  db.settings.remoteKeys = keys;
  commit('settings');
}

/** Assigns a key to an action (and takes it away from any other one). */
export function assign(id, action) {
  const keys = bindings();
  for (const a of Object.keys(keys)) keys[a] = keys[a].filter((k) => k !== id);
  keys[action].push(id);
  save(keys);
}

export function unassign(id) {
  const keys = bindings();
  for (const a of Object.keys(keys)) keys[a] = keys[a].filter((k) => k !== id);
  save(keys);
}

// ---------- keys from the system (volume, media) and MIDI ----------

const reasons = new Set();

/** Volume and media keys go to Notenpult while the viewer (with the setting) or the key dialog is open. */
export function capture(reason, on) {
  if (on) reasons.add(reason);
  else reasons.delete(reason);
  syncCapture();
}

export function syncCapture() {
  const on = reasons.has('learn') || (reasons.has('viewer') && !!db.settings.volumeKeys);
  backend.setHardwareCapture(on);
}

export const onSystemKey = (fn) => backend.onHardwareKey(fn);

/** Listens to all MIDI inputs (Windows; Android where the WebView has Web MIDI); returns a stop function. */
export async function listenMidi(onKey) {
  if (!navigator.requestMIDIAccess) return () => {};
  let access;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    return () => {};
  }
  const handler = (e) => {
    const id = midiKeyId(e.data || []);
    if (id) onKey(id);
  };
  const attach = () => access.inputs.forEach((input) => { input.onmidimessage = handler; });
  attach();
  access.onstatechange = attach;
  return () => {
    access.onstatechange = null;
    access.inputs.forEach((input) => { input.onmidimessage = null; });
  };
}

/** MIDI only when a MIDI key is assigned (asking for MIDI costs time and may show a prompt). */
export const usesMidi = () => Object.values(bindings()).some((list) => list.some((k) => k.startsWith('midi:')));

// ---------- dialog "Tasten testen & zuweisen" ----------

export function openRemoteDialog() {
  let learning = null; // action waiting for its key
  let stopMidi = () => {};
  const status = h('div.remote-status', { 'aria-live': 'polite' }, 'Drück eine Taste am Pedal oder an der Fernbedienung.');
  const list = h('div.remote-list');

  const render = () => {
    const keys = bindings();
    fill(list, ...ACTIONS.map(([action, label]) => h('div.remote-row', null,
      h('div.remote-action', null, label),
      h('div.remote-keys', null,
        keys[action].length ? null : h('span.muted.small', null, 'nicht belegt'),
        keys[action].map((id) => h('span.key-chip', { title: id },
          h('span', null, keyLabel(id)),
          h('button.key-remove', {
            type: 'button',
            'aria-label': `${keyLabel(id)} entfernen`,
            onclick: () => {
              unassign(id);
              render();
            },
          }, icon('x'))))),
      btn(learning === action ? 'Jetzt drücken …' : 'Taste zuweisen', () => {
        learning = learning === action ? null : action;
        status.textContent = learning ? `Taste für „${label}“ am Gerät drücken (Esc bricht ab).` : 'Abgebrochen.';
        render();
      }, { kind: learning === action ? 'primary' : '', icon: 'plus' }))));
  };

  const onKey = (id) => {
    if (learning) {
      assign(id, learning);
      status.textContent = `„${keyLabel(id)}“ ist jetzt: ${actionLabel(learning)}`;
      learning = null;
      render();
      return;
    }
    const action = SYSTEM_KEYS.has(id) && !db.settings.volumeKeys ? null : actionFor(id);
    if (action) status.textContent = `Erkannt: „${keyLabel(id)}“ – ${actionLabel(action)}`;
    else if (SYSTEM_KEYS.has(id) && !db.settings.volumeKeys) status.textContent = `Erkannt: „${keyLabel(id)}“ – „Lautstärke- und Medientasten blättern“ ist aus.`;
    else status.textContent = `Erkannt: „${keyLabel(id)}“ – noch nicht zugewiesen.`;
  };

  // While the dialog is open every key is "the device" – Space or Enter must not press its buttons.
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && learning) {
      e.preventDefault();
      e.stopImmediatePropagation();
      learning = null;
      status.textContent = 'Abgebrochen.';
      render();
      return;
    }
    if (e.key === 'Escape' || (e.key === 'Tab' && !learning) || e.repeat) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    onKey(keyId(e));
  };
  window.addEventListener('keydown', onKeyDown, true);
  const offSystem = onSystemKey(onKey);
  capture('learn', true);
  listenMidi(onKey).then((stop) => { stopMidi = stop; });

  render();
  modal({
    title: 'Pedal & Fernbedienung',
    className: 'remote-modal',
    body: h('div', null,
      h('p.dialog-text', null, 'Gerät zuerst in den Bluetooth-Einstellungen von Windows bzw. Android koppeln. '
        + 'Dann hier eine Taste drücken: Notenpult zeigt, was ankommt. Mit „Taste zuweisen“ legst du fest, was sie tut.'),
      status,
      list),
    actions: [
      {
        label: 'Standard wiederherstellen',
        kind: 'ghost',
        onClick: () => {
          db.settings.remoteKeys = null;
          commit('settings');
          learning = null;
          status.textContent = 'Standardbelegung wiederhergestellt.';
          render();
        },
      },
      { label: 'Fertig', kind: 'primary', value: true },
    ],
    onClose: () => {
      window.removeEventListener('keydown', onKeyDown, true);
      offSystem();
      stopMidi();
      capture('learn', false);
    },
  });
}
