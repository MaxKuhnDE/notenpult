// Updates: "Nach Updates suchen" / "Jetzt aktualisieren" in the settings and an
// automatic check at start. Download + file swap happen in the main process (updater/).

import { db, backend } from './store.js';
import { h, icon, btn, toast } from './ui.js';

let result = null; // last check result from the main process
let phase = 'idle'; // idle | checking | download | extract | restart | staged | opened (Android) | error
let progress = null;
let error = '';
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const updateAvailable = () => !!(result && result.ok && result.newer);
export function onUpdateState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const BUSY = ['download', 'extract', 'restart'];
backend.onUpdateProgress((p) => {
  if (!BUSY.includes(phase)) return; // late message after the result
  phase = p.phase;
  if (p.phase === 'download') progress = p;
  emit();
});

export async function checkForUpdate() {
  phase = 'checking';
  error = '';
  emit();
  try {
    result = await backend.updateCheck();
    phase = result.ok ? 'idle' : 'error';
    if (!result.ok) error = result.error;
  } catch (err) {
    phase = 'error';
    error = err.message;
  }
  emit();
  return result;
}

export async function installUpdate() {
  phase = 'download';
  progress = { received: 0, total: result?.size || 0 };
  error = '';
  emit();
  try {
    const r = await backend.updateInstall();
    phase = r && r.staged ? 'staged' : r && r.opened ? 'opened' : 'restart';
  } catch (err) {
    phase = 'error';
    error = err.message;
  }
  emit();
}

/** At start (installed app only): look for a new version and say so. */
export async function autoCheck() {
  if (!db.settings.autoUpdateCheck) return;
  const info = await backend.info();
  if (!info.packaged) return;
  const r = await checkForUpdate();
  if (r && r.ok && r.newer) toast(`Neue Version ${r.latest} verfügbar – Einstellungen → Updates`, { ms: 7000 });
}

const mb = (n) => `${(n / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
const dateFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

/** Settings block; returns { el, off } (off = unsubscribe when the dialog closes). */
export function updateSection() {
  const wrap = h('div.update-settings');
  let version = '…';
  backend.info().then((i) => {
    version = i.version;
    render();
  });

  function statusBlock() {
    if (phase === 'checking') return h('div.update-msg', null, 'Suche nach Updates …');
    if (phase === 'error') return h('div.update-msg.error', null, error);
    if (!result || !result.ok) return null;
    if (!result.newer) {
      return h('div.update-msg.ok', null, icon('check'),
        h('span', null, result.latest ? `Du hast die neueste Version (${result.current}).` : 'Es ist noch keine Version veröffentlicht.'));
    }
    const notes = String(result.notes || '').replace(/^#+\s*/gm, '').trim();
    let action;
    if (phase === 'download') {
      const total = progress?.total || result.size || 0;
      const pct = total ? Math.min(100, Math.round((progress.received / total) * 100)) : 0;
      action = h('div.update-progress', null,
        h('div.progress-bar', null, h('span', { style: { width: `${pct}%` } })),
        h('span.muted.small', null, total ? `${mb(progress.received)} von ${mb(total)}` : 'Lädt …'));
    } else if (phase === 'extract') {
      action = h('div.update-msg', null, 'Wird entpackt …');
    } else if (phase === 'restart') {
      action = h('div.update-msg', null, 'Update wird eingespielt – Notenpult startet gleich neu …');
    } else if (phase === 'opened') {
      action = h('div.update-msg.ok', null, icon('check'), h('span', null,
        'Der Download läuft im Browser. Danach die Datei „Notenpult-android.apk“ antippen und „Installieren“ wählen – '
        + 'deine Noten bleiben erhalten.'));
    } else if (phase === 'staged') {
      action = h('div.update-msg.ok', null, icon('check'), h('span', null, 'Update geladen und geprüft (Testmodus – nichts ersetzt).'));
    } else {
      action = h('div.update-actions', null,
        btn('Jetzt aktualisieren', installUpdate, { icon: 'import', kind: 'primary', disabled: !result.installable }),
        result.installable ? null : h('span.muted.small', null, result.reason));
    }
    return h('div.update-card', null,
      h('div.update-title', null,
        h('strong', null, `Version ${result.latest} ist verfügbar`),
        result.published ? h('span.muted.small', null, ` · ${dateFmt.format(new Date(result.published))}`) : null),
      notes ? h('pre.update-notes', null, notes.length > 1500 ? `${notes.slice(0, 1500)} …` : notes) : null,
      h('div.setting-hint', null, {
        asar: `Download ${mb(result.size || 0)} – nur der App-Teil, die Laufzeit bleibt.`,
        apk: `Download ${mb(result.size || 0)} – neue Android-App (APK), wird über die vorhandene installiert.`,
      }[result.mode] || `Download ${mb(result.size || 0)} – komplettes Paket (neue Laufzeit).`),
      action);
  }

  function render() {
    const checking = phase === 'checking' || ['download', 'extract', 'restart'].includes(phase);
    wrap.replaceChildren(
      h('div.setting', null,
        h('div.setting-text', null,
          h('div.setting-label', null, `Installierte Version ${version}`),
          h('div.setting-hint', null, 'Deine Noten, Setlists und Anmerkungen bleiben bei Updates erhalten.')),
        btn('Nach Updates suchen', checkForUpdate, { icon: 'refresh', disabled: checking })),
      ...[statusBlock()].filter(Boolean),
    );
  }

  render();
  const off = onUpdateState(render);
  return { el: wrap, off };
}
