import { db, commit, backend } from './store.js';
import {
  h, icon, btn, modal, toast, confirmDialog, plural,
} from './ui.js';
import * as sync from './sync.js';

/** Segmented control bound to get/set. options: [[value, label, icon?]] */
function choice(options, get, set) {
  const wrap = h('div.segmented.small', { role: 'radiogroup' });
  const render = () => wrap.replaceChildren(...options.map(([value, label, ic]) => h(`button.seg${get() === value ? '.active' : ''}`, {
    type: 'button',
    role: 'radio',
    'aria-checked': String(get() === value),
    onclick: () => {
      set(value);
      render();
    },
  }, ic ? icon(ic) : null, h('span', null, label))));
  render();
  return wrap;
}

function segmented(key, options) {
  return choice(options, () => db.settings[key], (v) => {
    db.settings[key] = v;
    commit('settings');
  });
}

function toggle(key, label, hint) {
  const input = h('input', {
    type: 'checkbox',
    checked: !!db.settings[key],
    onchange: () => {
      db.settings[key] = input.checked;
      commit('settings');
    },
  });
  return h('label.setting.toggle-row', null,
    h('div.setting-text', null, h('div.setting-label', null, label), hint ? h('div.setting-hint', null, hint) : null),
    h('span.switch', null, input, h('span.switch-track')));
}

const LAYOUTS = [
  ['auto', 'Automatisch', 'auto'],
  ['two', 'Zwei Seiten', 'two'],
  ['pair2', 'Nur 2-seitige', 'two'],
  ['single', 'Eine Seite', 'single'],
  ['width', 'Breite', 'width'],
];

/** Page layout per orientation; full width so all five choices fit. */
function layoutRow(label, key) {
  const control = segmented(key, LAYOUTS);
  control.classList.add('wrap');
  return h('div.setting.stacked', null, h('div.setting-label', null, label), control);
}

function row(label, control, hint) {
  return h('div.setting', null,
    h('div.setting-text', null, h('div.setting-label', null, label), hint ? h('div.setting-hint', null, hint) : null),
    control);
}

const timeFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

function poolStatusText() {
  if (!sync.isLinked()) return 'Nicht verbunden';
  const s = sync.syncStatus();
  const last = db.sync.lastSync ? `zuletzt ${timeFmt.format(db.sync.lastSync)}` : 'noch nicht synchronisiert';
  const tracked = Object.values(db.sync.files).filter((t) => !t.ignored).length;
  const state = { syncing: 'synchronisiert gerade …', offline: 'offline – gespeicherte Kopien werden genutzt', ok: 'verbunden', idle: 'verbunden' }[s] || '';
  return `${state} · ${last} · ${plural(tracked, 'Datei', 'Dateien')} offline gespeichert`;
}

function poolSection() {
  const wrap = h('div.pool-settings');
  const render = () => {
    if (!sync.isLinked()) {
      wrap.replaceChildren(
        h('div.setting-hint.block', null, 'Verbinde einen Ordner aus Google Drive (über „Google Drive für Desktop“). Notenpult übernimmt die Noten von dort, speichert sie für offline und holt Änderungen, sobald du online bist.'),
        h('div.setting', null, h('div.setting-text', null, h('div.setting-label', null, 'Noten-Pool')), btn('Google Drive verbinden …', () => openPoolSetup(), { icon: 'cloud', kind: 'primary' })),
      );
      return;
    }
    wrap.replaceChildren(
      h('div.setting', null,
        h('div.setting-text', null,
          h('div.setting-label', null, 'Verbunden mit'),
          h('div.setting-hint.mono', null, db.sync.folder),
          h('div.setting-hint', null, poolStatusText())),
        btn('Jetzt synchronisieren', () => sync.syncNow({ manual: true }), { icon: 'refresh', disabled: sync.syncStatus() === 'syncing' })),
      h('div.setting', null,
        h('div.setting-text', null,
          h('div.setting-label', null, db.sync.mode === 'auto' ? 'Alle passenden Dateien automatisch' : 'Nur bei Bedarf über die Suche'),
          h('div.setting-hint', null, [
            db.sync.structure === 'folders' ? 'Unterordner = Stück, Dateien = Stimmen' : 'Jede Datei = ein Stück',
            db.sync.filter ? `Filter: ${db.sync.filter}` : 'kein Filter',
          ].join(' · '))),
        h('div.btn-row', null,
          btn('Ändern …', () => openPoolSetup(db.sync.folder), { icon: 'edit' }),
          btn('Trennen', async () => {
            const ok = await confirmDialog('Verbindung zum Noten-Pool trennen? Bereits geladene Stücke bleiben in der Bibliothek und offline verfügbar.', { title: 'Noten-Pool trennen', okLabel: 'Trennen' });
            if (ok) sync.unlink();
          }, { kind: 'ghost' }))),
    );
  };
  render();
  const off = sync.onSyncChange(render);
  return { el: wrap, off };
}

export function openSettings() {
  const dataInfo = h('div.setting-hint.mono', null, '…');
  backend.info().then((i) => { dataInfo.textContent = i.dataDir; });
  const pool = sync.available() ? poolSection() : null;

  const body = h('div.settings',
    null,
    h('h3.settings-section', null, 'Darstellung'),
    row('Design', segmented('theme', [['system', 'System'], ['light', 'Hell', 'sun'], ['dark', 'Dunkel', 'moon']])),
    toggle('invertSheets', 'Noten im Dunkelmodus invertieren', 'Weiße Noten auf dunklem Grund – angenehm auf dunklen Bühnen.'),

    h('h3.settings-section', null, 'Notenansicht'),
    layoutRow('Querformat', 'landscapeLayout'),
    layoutRow('Hochformat', 'portraitLayout'),
    h('div.setting-hint.block', null,
      '„Automatisch“ füllt den Bildschirm (A4 im Querformat nebeneinander, A5 im Hochformat untereinander). ',
      '„Zwei Seiten“ zeigt immer zwei Seiten zusammen. ',
      '„Nur 2-seitige“ zeigt Stücke mit genau zwei Seiten komplett auf einem Bildschirm – ohne Umblättern –, alle anderen einseitig. ',
      '„Breite“: Tippen scrollt erst nach unten.'),
    toggle('autoCrop', 'Weiße Ränder automatisch abschneiden', 'Die Noten werden so groß wie möglich gezeigt – z. B. ein A5-Blatt, das auf A4 eingescannt wurde.'),
    toggle('showNextHint', 'Nächstes Stück anzeigen', 'Auf der letzten Seite eines Stücks steht oben in der Leiste, was danach kommt.'),

    h('h3.settings-section', null, 'Blättern'),
    toggle('leftZoneBack', 'Linker Rand blättert zurück', 'Tippen ins linke Viertel geht eine Seite zurück. Sonst blättert jedes Tippen vorwärts.'),
    h('div.setting-hint.block', null, 'Zurück geht immer: nach rechts wischen, Rechtsklick (Trackpad: zwei Finger), Pfeil links oder ◀ in der Leiste. Fußpedale (Bild ↑/↓, Pfeiltasten) funktionieren auch.'),

    h('h3.settings-section', null, 'Stift'),
    toggle('penAlwaysDraws', 'Stift schreibt immer', 'Mit dem Stift sofort schreiben; Finger und Trackpad blättern weiter. Radieren mit dem Radierer-Ende oder der Stifttaste.'),
    row('Strichstärke', segmented('penWidth', [['fine', 'Fein'], ['medium', 'Mittel'], ['bold', 'Dick']])),

    h('h3.settings-section', null, 'Setlists'),
    toggle('tensBlocks', 'Zehnerblöcke anzeigen', 'Trennt nummerierte Stücke in Blöcke 1–10, 11–20, … wie im Notenordner.'),

    pool ? h('h3.settings-section', null, 'Google Drive · Noten-Pool') : null,
    pool ? pool.el : null,

    h('h3.settings-section', null, 'Daten'),
    h('div.setting', null,
      h('div.setting-text', null, h('div.setting-label', null, 'Speicherort'), dataInfo),
      backend.kind === 'electron' ? btn('Ordner öffnen', () => backend.openDataDir(), { icon: 'folder' }) : null),
    h('div.setting-hint.block', null, 'Zum Sichern einfach diesen Ordner kopieren (z. B. auf einen USB-Stick).'));

  modal({ title: 'Einstellungen', body, className: 'settings-modal', onClose: () => pool?.off() });
}

/**
 * Link (or re-configure) the Noten-Pool: pick a folder – Google Drive for
 * Desktop is suggested – preview what's in it, choose filter/structure/mode.
 */
export async function openPoolSetup(folder = null) {
  if (!sync.available()) {
    toast('Google Drive geht nur in der Windows-App.');
    return;
  }
  let target = folder;
  if (!target) {
    const drive = await backend.detectGoogleDrive();
    target = await backend.pickFolder({ title: 'Ordner mit euren Noten in Google Drive wählen', defaultPath: drive || undefined });
    if (!target) return;
  }
  toast('Ordner wird gelesen …', { ms: 1500 });
  const scan = await sync.previewFolder(target);
  if (!scan.ok && !scan.files.length) {
    toast(`Ordner nicht lesbar: ${scan.error}`, { kind: 'error', ms: 5000 });
    return;
  }

  const cfg = {
    mode: db.sync.mode,
    structure: db.sync.structure,
    filter: db.sync.folder === target ? db.sync.filter : '',
  };
  const dirs = new Set(scan.files.map((f) => sync.dirOf(f.rel)).filter(Boolean));
  const countEl = h('div.setting-hint');
  const preview = h('div.pool-preview');
  const filterInput = h('input.text-input', {
    type: 'text',
    value: cfg.filter,
    placeholder: 'z. B. Flügelhorn 1, Flgh 1',
    'data-select-all': 'false',
    oninput: () => {
      cfg.filter = filterInput.value;
      update();
    },
  });

  function update() {
    const matching = scan.files.filter((f) => sync.matchesFilter(f.rel, cfg.filter));
    countEl.textContent = cfg.filter.trim()
      ? `${plural(matching.length, 'Datei passt', 'Dateien passen')} zum Filter.`
      : 'Ohne Filter werden alle Dateien berücksichtigt.';
    const sample = matching.slice(0, 8).map((f) => h('div.pool-preview-item', null, icon('music'), h('span', null, f.rel.split('\\').join(' › '))));
    if (matching.length > 8) sample.push(h('div.muted.small', null, `… und ${matching.length - 8} weitere`));
    if (!matching.length) sample.push(h('div.muted.small', null, 'Keine passenden Dateien.'));
    preview.replaceChildren(...sample);
  }
  update();

  const body = h('div.pool-setup', null,
    h('div.setting', null,
      h('div.setting-text', null,
        h('div.setting-label', null, 'Ordner'),
        h('div.setting-hint.mono', null, target),
        h('div.setting-hint', null, `${plural(scan.files.length, 'Notendatei', 'Notendateien')}${dirs.size ? ` in ${plural(dirs.size, 'Unterordner', 'Unterordnern')}` : ''}${scan.ok ? '' : ' (zuletzt gespeicherter Stand – Ordner gerade nicht erreichbar)'}`)),
      btn('Anderer Ordner …', async () => {
        m.close();
        const drive = await backend.detectGoogleDrive();
        const other = await backend.pickFolder({ title: 'Ordner mit euren Noten wählen', defaultPath: target || drive || undefined });
        if (other) openPoolSetup(other);
      }, { icon: 'folder', kind: 'ghost' })),
    h('label.field-label', null, 'Nur meine Stimme (optional)'),
    filterInput,
    countEl,
    row('Aufbau des Ordners', choice([['files', 'Jede Datei = ein Stück'], ['folders', 'Unterordner = Stück']], () => cfg.structure, (v) => { cfg.structure = v; }),
      '„Unterordner = Stück“: z. B. Florentiner Marsch/1. Stimme.pdf und …/2. Stimme.pdf werden ein Stück mit zwei Stimmen.'),
    row('Übernehmen', choice([['auto', 'Alles automatisch'], ['manual', 'Nur bei Bedarf']], () => cfg.mode, (v) => { cfg.mode = v; }),
      '„Alles automatisch“ kopiert alle passenden Noten und hält sie aktuell. „Nur bei Bedarf“: Du suchst im Noten-Pool und lädst einzelne Stücke.'),
    h('div.field-label', null, 'Vorschau'),
    preview);

  const m = modal({
    title: 'Google Drive · Noten-Pool',
    className: 'settings-modal',
    body,
    actions: [
      { label: 'Abbrechen', value: false },
      {
        label: db.sync.folder === target ? 'Übernehmen' : 'Verbinden',
        kind: 'primary',
        icon: 'cloud',
        onClick: (close) => {
          close(true);
          sync.link(target, { mode: cfg.mode, structure: cfg.structure, filter: cfg.filter.trim() });
        },
      },
    ],
  });
}
