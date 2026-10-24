// "Im WLAN teilen" / "Aus dem WLAN holen": the library from one device to another in the
// same network (or a phone hotspot), one way, for one session with a 4-digit code.
// The connection itself (SPAKE2 + AES-GCM) is native: lan/ (Windows), Lan*.java (Android).

import {
  db, backend, flushSaves, suspendSaving, resumeSaving, DEVICE_SETTINGS,
} from './store.js';
import * as ink from './ink.js';
import {
  h, fill, icon, btn, modal, toast, plural,
} from './ui.js';
import { planReceive } from './lan-plan.js';

const DEFAULT_PORT = 47322;
const mb = (n) => (n > 0 && n < 104858 ? 'unter 0,1 MB'
  : `${(n / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`);

export const lanAvailable = () => typeof backend.lanHostStart === 'function';

const ERRORS = {
  code: 'Der Code stimmt nicht – bitte den Code eingeben, der gerade auf dem anderen Gerät steht.',
  busy: 'Das andere Gerät gibt gerade an jemand anderen weiter – kurz warten und noch einmal versuchen.',
  version: 'Die Notenpult-Versionen passen nicht zusammen – bitte beide Geräte aktualisieren.',
  unreachable: 'Gerät nicht erreichbar. Ist dort „Im WLAN teilen“ offen, und seid ihr im selben WLAN?',
  closed: 'Die Verbindung wurde getrennt.',
  empty: 'Auf dem anderen Gerät gibt es noch keine Noten.',
};
const errorText = (r) => ERRORS[r && r.error] || (r && (r.message || r.error)) || 'unbekannter Fehler';
const busyLine = (text) => h('div.busy', null, h('span.busy-spinner'), h('span', null, text));

// ---------- host ----------

export async function openShare() {
  await ink.flushAll();
  await flushSaves();
  const codeEl = h('div.lan-code', { 'aria-live': 'polite' }, '····');
  const status = h('p.lan-status', null, 'Starte …');
  const where = h('p.muted.small');
  let off = () => {};
  modal({
    title: 'Im WLAN teilen',
    className: 'small lan-modal',
    body: h('div', null,
      h('p.dialog-text', null, 'Auf dem anderen Gerät „Aus dem WLAN holen“ wählen und diesen Code eingeben. '
        + 'Beide Geräte müssen im selben WLAN sein – ein Handy-Hotspot geht auch.'),
      codeEl, status, where),
    actions: [{ label: 'Beenden', kind: 'primary', value: true }],
    onClose: () => {
      off();
      backend.lanHostStop();
      backend.keepAwake(false);
    },
  });
  const r = await backend.lanHostStart();
  if (!r || !r.ok) {
    status.textContent = `Teilen nicht möglich: ${errorText(r)}`;
    return;
  }
  backend.keepAwake(true);
  codeEl.textContent = r.code;
  where.textContent = `Dieses Gerät: ${r.name} · Adresse: ${(r.addresses || []).join(', ') || '–'}`
    + `${r.port !== DEFAULT_PORT ? ` · Port ${r.port}` : ''}`;
  status.textContent = 'Warte auf ein Gerät …';
  off = backend.onLanEvent((e) => {
    if (e.type === 'connected') status.textContent = `Verbunden mit „${e.name}“ …`;
    else if (e.type === 'progress') status.textContent = `„${e.name}“ holt die Noten … ${e.files ? `${plural(e.files, 'Datei', 'Dateien')} (${mb(e.bytes)})` : ''}`;
    else if (e.type === 'done') {
      status.textContent = e.ok
        ? `Fertig: „${e.name}“ hat die Noten geholt (${plural(e.files, 'Datei', 'Dateien')}, ${mb(e.bytes)}). Für ein weiteres Gerät gilt der neue Code.`
        : `„${e.name}“ hat abgebrochen. Für den nächsten Versuch gilt der neue Code.`;
    } else if (e.type === 'wrongCode') {
      status.textContent = e.attemptsLeft
        ? `Falscher Code eingegeben – noch ${e.attemptsLeft} ${e.attemptsLeft === 1 ? 'Versuch' : 'Versuche'}.`
        : 'Dreimal falscher Code – hier steht jetzt ein neuer.';
    } else if (e.type === 'newCode') codeEl.textContent = e.code;
    else if (e.type === 'error') status.textContent = `Fehler: ${e.message}`;
  });
}

// ---------- receiver ----------

/** The library as it is saved – what "add" merges into. */
const localLibrary = () => ({
  version: 2, pieces: db.pieces, setlists: db.setlists, genres: db.genres, settings: db.settings, sync: db.sync, ui: db.ui,
});

export function openReceive() {
  const wrap = h('div.lan-receive');
  let connected = false;
  let off = () => {};
  const dialog = modal({
    title: 'Aus dem WLAN holen',
    className: 'small lan-modal',
    body: wrap,
    onClose: () => {
      off();
      if (connected) backend.lanCancel();
    },
  });

  async function search() {
    fill(wrap, busyLine('Suche Notenpult im WLAN …'));
    const hosts = await backend.lanDiscover();
    const manual = h('input.text-input', {
      type: 'text', inputmode: 'decimal', placeholder: 'z. B. 192.168.43.12', 'data-select-all': 'false',
    });
    const fromManual = () => {
      const [address, port] = manual.value.trim().split(':');
      if (address) askCode({ name: address, address, port: Number(port) || DEFAULT_PORT });
    };
    fill(wrap,
      h('p.dialog-text', null, hosts.length
        ? 'Von welchem Gerät holen?'
        : 'Kein Gerät gefunden. Ist dort „Im WLAN teilen“ offen, und seid ihr im selben WLAN oder Hotspot?'),
      hosts.length ? h('div.choice-list', null, hosts.map((x) => h('button.choice.lan-host', { type: 'button', onclick: () => askCode(x) },
        icon('tablet'), h('span', null, x.name),
        h('span.muted.small', null, [x.pieces != null ? plural(x.pieces, 'Stück', 'Stücke') : '', x.busy ? 'gerade belegt' : ''].filter(Boolean).join(' · '))))) : null,
      h('label.field-label', null, 'Nicht dabei? Adresse eingeben (steht beim anderen Gerät):'),
      h('div.lan-manual', null, manual, btn('Weiter', fromManual)),
      h('div.btn-row.lan-actions', null, btn('Erneut suchen', search, { icon: 'refresh', kind: 'ghost' })),
    );
  }

  function askCode(host, message = '') {
    const input = h('input.text-input.lan-code-input', {
      type: 'text', inputmode: 'numeric', maxlength: '4', autocomplete: 'off', placeholder: '0000', 'data-select-all': 'false',
    });
    async function go() {
      if (input.value.length !== 4) return;
      fill(wrap, busyLine(`Verbinde mit „${host.name}“ …`));
      const r = await backend.lanConnect({ address: host.address, port: host.port || DEFAULT_PORT, code: input.value });
      if (!r || !r.ok) {
        askCode(host, errorText(r));
        return;
      }
      connected = true;
      preview(host, r.manifest, await backend.lanLocalFiles());
    }
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      if (input.value.length === 4) go();
    });
    fill(wrap,
      h('p.dialog-text', null, `Code von „${host.name}“ eingeben:`),
      input,
      message ? h('p.lan-error', null, message) : null,
      h('div.btn-row.lan-actions', null, btn('Zurück', search, { kind: 'ghost' }), btn('Verbinden', go, { kind: 'primary' })),
    );
    setTimeout(() => input.focus(), 50);
  }

  function preview(host, manifest, localFiles) {
    const local = localLibrary();
    const from = manifest.name || host.name;
    let mode = 'mirror';
    const render = () => {
      const plan = planReceive({
        local, host: manifest, mode, localFiles, keepSettings: DEVICE_SETTINGS,
      });
      const choice = (value, label, hint) => h(`button.choice${mode === value ? '.active' : ''}`, {
        type: 'button',
        'aria-pressed': String(mode === value),
        onclick: () => {
          mode = value;
          render();
        },
      }, h('span.choice-dot'), h('span.lan-choice', null, h('strong', null, label), h('span.muted.small', null, hint)));
      fill(wrap,
        h('p.dialog-text', null, `„${from}“: ${plural(plan.pieces, 'Stück', 'Stücke')}, ${plural(plan.setlists, 'Setlist', 'Setlists')}.`),
        h('p.dialog-text.lan-transfer', null, plan.download.length
          ? `Zu laden: ${plural(plan.download.length, 'Datei', 'Dateien')} (${mb(plan.bytes)}) – alles andere ist schon da.`
          : 'Alle Notendateien sind schon auf diesem Gerät.'),
        h('div.choice-list', null,
          choice('mirror', 'Alles übernehmen (spiegelgleich)',
            `Danach ist dieses Gerät wie „${from}“ – Stücke, Setlists, Genres, Anmerkungen und Einstellungen `
            + '(nur die Seitenansicht dieses Geräts bleibt).'
            + `${local.pieces.length ? ` Deine ${plural(local.pieces.length, 'Stück', 'Stücke')} hier werden ersetzt (Sicherung in „_vor-abgleich“).` : ''}`),
          choice('add', 'Zu meinen Noten hinzufügen',
            'Deine Stücke, Setlists und Einstellungen bleiben; die Stücke von dort kommen dazu, gleiche werden aktualisiert.')),
        plan.missing.length ? h('p.muted.small', null, `${plural(plan.missing.length, 'Notendatei fehlt', 'Notendateien fehlen')} auch auf „${from}“ – diese Seiten bleiben leer.`) : null,
        h('div.btn-row.lan-actions', null,
          btn('Abbrechen', () => dialog.close(), { kind: 'ghost' }),
          btn('Holen', () => run(from, plan), { kind: 'primary', icon: 'import' })),
      );
    };
    render();
  }

  async function run(from, plan) {
    const bar = h('span', { style: { width: '0%' } });
    const line = h('span.muted.small', null, plan.download.length ? '' : 'Übernehme …');
    fill(wrap, h('p.dialog-text', null, `Hole die Noten von „${from}“ …`), h('div.progress-bar', null, bar), line);
    off = backend.onLanEvent((e) => {
      if (e.type !== 'download') return;
      bar.style.width = `${plan.bytes ? Math.min(100, Math.round((e.bytes * 100) / plan.bytes)) : 100}%`;
      line.textContent = `${e.file} von ${e.files} Dateien · ${mb(e.bytes)} von ${mb(plan.bytes)}`;
    });
    const fail = (r) => {
      connected = false;
      fill(wrap,
        h('p.lan-error', null, `Abgebrochen: ${errorText(r)} Auf diesem Gerät hat sich nichts geändert.`),
        h('div.btn-row.lan-actions', null, btn('Schließen', () => dialog.close(), { kind: 'primary' })),
      );
    };
    const d = await backend.lanDownload(plan.download);
    if (!d || !d.ok) {
      fail(d);
      return;
    }
    await ink.flushAll();
    await flushSaves();
    suspendSaving(); // nothing old may be written over what arrives
    const f = await backend.lanFinish({
      db: JSON.stringify(plan.db), ann: plan.ann, keep: plan.keep, mode: plan.mode,
    });
    if (!f || !f.ok) {
      resumeSaving();
      fail(f);
      return;
    }
    connected = false;
    try {
      localStorage.setItem('np-lan-received', JSON.stringify({ from, pieces: plan.db.pieces.length, mode: plan.mode }));
    } catch { /* message is optional */ }
    window.location.reload();
  }

  search();
}

/** After the reload that follows "Aus dem WLAN holen". */
export function announceReceived() {
  let r = null;
  try {
    r = JSON.parse(localStorage.getItem('np-lan-received') || 'null');
    localStorage.removeItem('np-lan-received');
  } catch { /* no storage */ }
  if (!r) return;
  toast(`Fertig: Noten von „${r.from}“ ${r.mode === 'add' ? 'hinzugefügt' : 'übernommen'} – jetzt ${plural(r.pieces, 'Stück', 'Stücke')}.`, { kind: 'success', ms: 6000 });
}
