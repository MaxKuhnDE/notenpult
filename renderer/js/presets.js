// "Alles exportieren" / "Alles importieren": the whole library as one ZIP, e.g. to move
// it from the PC to the Android tablet. Packing/unpacking happens natively (preset.js
// on Windows, MainActivity.java on Android); importing replaces everything.

import {
  backend, flushSaves, suspendSaving, resumeSaving,
} from './store.js';
import * as ink from './ink.js';
import {
  busy, confirmDialog, toast, plural,
} from './ui.js';

const mb = (n) => `${(n / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;

export const presetsAvailable = () => backend.kind === 'electron' || backend.kind === 'android';

export async function exportAll() {
  const wait = busy('Export wird erstellt …');
  try {
    await ink.flushAll();
    await flushSaves();
    const r = await backend.exportPreset();
    if (!r || r.canceled) return;
    if (!r.ok) throw new Error(r.error || 'unbekannter Fehler');
    toast(`Export gespeichert: ${r.name}${r.size ? ` (${mb(r.size)})` : ''}`, { kind: 'success', ms: 7000 });
  } catch (err) {
    toast(`Export fehlgeschlagen: ${err.message}`, { kind: 'error', ms: 8000 });
  } finally {
    wait.close();
  }
}

export async function importAll() {
  const onAndroid = backend.kind === 'android';
  const ok = await confirmDialog(
    'Der Import ersetzt alle Stücke, PDFs, Stimmen, Setlists, Genres, Anmerkungen und Einstellungen auf diesem Gerät '
    + 'durch den Inhalt der Export-Datei – danach ist alles wie auf dem Gerät, das exportiert hat. '
    + (onAndroid
      ? 'Die ZIP-Datei vorher z. B. per USB-Kabel in den Ordner „Download“ des Tablets kopieren.'
      : 'Der bisherige Stand bleibt im Datenordner unter „_vor-import“ erhalten.'),
    { title: 'Alles importieren?', okLabel: 'Export-Datei wählen …', danger: true },
  );
  if (!ok) return;
  await ink.flushAll();
  await flushSaves();
  suspendSaving(); // nothing old may be written over the imported data
  const wait = busy('Import läuft – bitte warten …');
  let r;
  try {
    r = await backend.importPreset();
  } catch (err) {
    r = { ok: false, error: err.message };
  }
  if (r && r.ok) {
    try {
      localStorage.setItem('np-imported', JSON.stringify(r.counts || {}));
    } catch { /* toast is optional */ }
    window.location.reload();
    return;
  }
  resumeSaving();
  wait.close();
  if (r && !r.canceled) toast(`Import fehlgeschlagen: ${r.error}`, { kind: 'error', ms: 9000 });
}

/** After the reload that follows an import. */
export function announceImport() {
  let counts = null;
  try {
    counts = JSON.parse(localStorage.getItem('np-imported') || 'null');
    localStorage.removeItem('np-imported');
  } catch { /* no storage */ }
  if (!counts) return;
  const parts = [];
  if (counts.pieces != null) parts.push(plural(counts.pieces, 'Stück', 'Stücke'));
  if (counts.setlists != null) parts.push(plural(counts.setlists, 'Setlist', 'Setlists'));
  toast(`Import abgeschlossen${parts.length ? `: ${parts.join(', ')}` : ''}`, { kind: 'success', ms: 6000 });
}
