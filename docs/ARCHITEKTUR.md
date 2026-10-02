# Architektur

Notenpult ist eine Electron-App. Die Oberfläche ist reines JavaScript (ES-Module) ohne Framework und
ohne Build-Schritt; pdf.js rendert die Noten. Dieselbe Oberfläche läuft in der Android-App (siehe unten).

```
main.js            Hauptprozess: Fenster, Datenordner, Datei-Import, Noten-Pool-Scan, app://-Protokoll
preload.js         sichere Brücke (contextBridge) → window.notenpult
updater/           In-App-Updates aus GitHub-Releases (siehe unten)
preset.js          „Alles exportieren/importieren“: komplette Bibliothek als ZIP (tar.exe)
renderer/
  index.html, styles.css
  js/app.js        Start, Kopfzeile, Moduswechsel, Drag & Drop, Tastenkürzel
  js/store.js      Datenmodell, Speichern, Migration, Backend (Electron bzw. IndexedDB im Browser)
  js/render.js     pdf.js/Bilder → Canvas, Seitengeometrie, Drehung, Rand-Erkennung, Caches
  js/viewer.js     Notenmodus: Layout, Blättern, Stift/Radierer, Stimmen, Suche, Nummernblock
  js/ink.js        Anmerkungen: Speichern je Stück, Zeichnen, Radier-Treffer
  js/library.js    A–Z-Bibliothek
  js/setlists.js   Setlists, Nummern, Zehnerblöcke, Umordnen
  js/editor.js     Stück bearbeiten: Stimmen, Seiten, Drehen, Aufteilen
  js/importer.js   Import, automatisches Verknüpfen von Stimmen
  js/sync.js       Noten-Pool (Google-Drive-Ordner): Abgleich, Offline-Kopien
  js/search.js     Suche über Bibliothek, Nummern, Genres (#tag), Setlists, Pool
  js/genres.js     Genres: Chips, Auswahl, Verwaltung, Filterleiste
  js/settings.js   Einstellungen, Pool-Einrichtung
  js/ui.js         DOM-Helfer, Icons, Dialoge, Menüs, Toasts
scripts/           copy-vendor (pdf.js), make-icon, run-tests, build-android-web (+ android/boot.js, pdfjs-shim.js)
test/              UI-Tests (laufen in der echten App) + Generator für Beispielnoten; android/ = Prüfumgebung
android/           Android-App (Gradle): MainActivity.java (WebView + Brücke), Preset.java (ZIP)
```

## Datenmodell (`Dokumente\Notenpult\notenpult.json`, Version 2)

```js
{
  version: 2,
  pieces: [{
    id, title, addedAt,
    genres: ['Marsch', 'Konzert'],            // Namen aus der Genre-Liste
    part: 0,                                  // aktive Stimme
    parts: [{ id, name: '1. Stimme',
              pages: [{ id, file: 'a1b2….pdf', page: 1, rot: 90?, crop: { f, v, r: [x, y, w, h] }? }] }],
  }],
  setlists: [{ id, name, entries: [{ id, pieceId, number: '47' }] }],
  genres: [{ name: 'Marsch' }],               // eigene Genres (#Hashtags)
  settings: { theme, invertSheets, portraitLayout, landscapeLayout, autoCrop, … },
  sync: { folder, mode, structure, filter, lastSync,
          files: { 'Polkas\\X\\Flügelhorn 1.pdf': { size, mtime, file, pieceId, partId, ignored? } },
          folders: { 'Polkas\\X': pieceId } },
  ui: { mode, setlistId },
}
```

- Importierte Dateien werden nach `Noten\` kopiert und über einen zufälligen Namen referenziert.
- `page.id` ist stabil: Anmerkungen (`Anmerkungen\<pieceId>.json`) hängen an der Seiten-ID und überleben
  Umordnen, Aufteilen, Verknüpfen und Aktualisierungen aus dem Noten-Pool.
- Anmerkungen liegen in Koordinaten der **ungedrehten, ungeschnittenen** Seite; `viewTransform()` bildet
  sie auf die angezeigte (gedrehte/geschnittene) Box ab.
- Version-1-Daten (Seiten direkt am Stück) werden in `store.init()` migriert.

## Notenmodus

- Layout „auto“ teilt die Seiten eines Stücks in Bildschirme: zwei Seiten nebeneinander oder
  untereinander, wenn jede Seite dabei mindestens 85 % ihrer Einzelgröße behält (`pairDirection`).
- Navigation läuft über eine Warteschlange (`enqueue`), damit schnelle Taps nicht verloren gehen;
  die nächsten zwei und der vorige Bildschirm werden im Hintergrund gerendert.
- Eingabe über Pointer Events: `pen` schreibt, `touch`/`mouse` blättert, Radierer = `buttons & 32`
  bzw. Stifttaste; Touches kurz nach Stiftaktivität werden ignoriert.

## Noten-Pool

`main.js` liest den Ordner rekursiv (`pool:scan`, Ergebnis wird als `pool-index.json` zwischengespeichert),
`sync.js` entscheidet, was neu, geändert oder ignoriert ist, und kopiert Dateien über den normalen Import.
Ist der Ordner nicht erreichbar, bleibt alles lokal nutzbar; die Suche nutzt den letzten Index.

## Export / Import („Preset“)

ZIP-Format (gleich auf Windows und Android):

```
notenpult-preset.json   { format: 'notenpult-preset', formatVersion: 1, appVersion, platform, exportedAt, counts }
notenpult.json          Bibliothek (Stücke, Stimmen, Setlists, Genres, Einstellungen)
Noten/…                 PDFs und Bilder
Anmerkungen/…           Stiftstriche je Stück
```

- Export: `renderer/js/presets.js` schreibt erst alles Ausstehende (`flushSaves`, `ink.flushAll`), dann packt
  `preset.js` mit `tar.exe -a` (ZIP).
- Import: Speichern wird angehalten (`suspendSaving` – sonst könnte ein verzögertes Speichern alte Daten über die
  neuen schreiben), `preset.js` entpackt in einen Ordner neben den Daten, prüft Kennung und `notenpult.json`,
  verschiebt den bisherigen Stand nach `_vor-import` und den neuen an seine Stelle (bei einem Fehler zurück).
  Danach lädt die Oberfläche neu.

## Android

```
android/app/src/main/java/…/MainActivity.java   WebView, https://notenpult.local, Brücke window.NotenpultAndroid
android/app/src/main/java/…/Preset.java         ZIP-Export/-Import (reines Java, JUnit-getestet)
scripts/build-android-web.js                     renderer/ → assets/www (esbuild, Ziel chrome92) + pdf.js 3.11 legacy
scripts/android/boot.js                          ES5: WebView-Version prüfen, Startfehler anzeigen, pdf.js + App laden
```

- **Zielgerät** Galaxy Tab S2 mit Android 5.0.2: die System-WebView lässt sich dort höchstens auf Chrome 95
  aktualisieren. Deshalb: Bündel für `chrome92`, kein `structuredClone`/`color-mix` ohne Ersatz, pdf.js 3.11
  (Legacy-Build) statt 6.x. `boot.js` lehnt WebViews unter 92 mit einer Anleitung ab.
- **Laden**: Die Seite läuft unter `https://notenpult.local/`. `shouldInterceptRequest` liefert die Dateien aus
  `assets/www` und unter `/library/<datei>` die Noten aus `files/Notenpult/Noten` – kein Server, kein Netz.
  Der pdf.js-Worker startet aus einem Blob, Schriften/CMaps lädt die Seite selbst (`useWorkerFetch: false`).
- **Brücke**: `store.js` wählt `androidBackend`, wenn `window.NotenpultAndroid` existiert. Einfache Aufrufe
  (Bibliothek, Anmerkungen laden/speichern) sind synchron; Dateiauswahl, Export und Import öffnen den
  Android-Dateidialog und antworten über `window.__npResolve(id, json)`.
- **Daten** wie unter Windows: `files/Notenpult/notenpult.json`, `Noten/`, `Anmerkungen/`. Der Import entpackt
  nach `files/.import-neu`, prüft, und tauscht dann zwei Ordner per Umbenennen; `Preset.recover()` beim Start
  vollendet oder verwirft einen unterbrochenen Tausch.
- **Gerät**: `window.__npBack()` (Zurück-Taste), `window.__npFlush()` (beim Wechsel in den Hintergrund),
  Vollbild = Immersive Mode, „Bildschirm bleibt an“ = `FLAG_KEEP_SCREEN_ON`; Drehen lädt die Seite nicht neu.
- **Speicher**: Auf Android rendert `render.js` höchstens 8 MP pro Seite und hält weniger Seiten im Cache.
- **GitHub & Zertifikate**: Android 5 kennt die heutigen Stammzertifikate von GitHub nicht (ISRG Root X1 für
  Downloads erst ab Android 7.1.1, Sectigo E46/USERTrust für github.com). Die WebView und der Browser lehnen
  GitHub deshalb ab. `Net.java` baut HTTPS selbst auf und vertraut zusätzlich `assets/cacerts.pem` – Mozillas
  Liste aus Node (`tls.rootCertificates`), die `build-android-web.js` bei jedem Build schreibt. `NetTest` prüft
  aufgezeichnete Ketten von api.github.com und vom Download-Server gegen diese Liste.
- **Updates**: `checkUpdate` (Java) liest das GitHub-Release, `installUpdate` lädt `Notenpult-android.apk`
  mit Fortschritt (`window.__npUpdateProgress`) und SHA-256-Prüfung, prüft den Paketnamen und öffnet die
  Android-Installation (bis Android 6 per Datei, ab 7 über `ApkProvider`). Gleicher Signaturschlüssel → die Daten
  bleiben.
- **Tests**: `test/android.js` lädt das Bündel in Electron 14 (Chromium 93) mit `test/android/bridge.js` als
  Ersatz für die Java-Brücke; `PresetTest.java` prüft den ZIP-Import, u. a. mit einer echten Windows-Export-Datei.

## Updates

```
updater/index.js         Hauptprozess: GitHub-Release abfragen, Download mit SHA-256-Prüfung, ZIP entpacken (tar.exe)
updater/apply-update.ps1 läuft nach dem Beenden: tauscht resources\app.asar bzw. spiegelt die ganze App, startet neu
updater/result.js        nach dem Neustart: Ergebnis aus apply-update.log lesen („aktualisiert“ / Grund des Fehlers)
renderer/js/updates.js   Einstellungen → Updates, automatische Suche beim Start, Punkt am Einstellungen-Knopf
```

1. `update:check` liest `releases/latest` und `update.json`. Ist die Electron-Version gleich, reicht `app.asar`
   (enthält main.js, preload.js, renderer, pdf.js), sonst kommt das ZIP.
2. `update:install` lädt in `%TEMP%\notenpult-update-<version>` (über `original-fs`, weil Electrons `fs` jede
   `*.asar`-Datei als Archiv behandelt), prüft Größe und Digest, startet `apply-update.ps1` losgelöst und beendet
   die App.
3. Das Skript wartet auf das Ende aller Notenpult-Prozesse, ersetzt die Dateien (nur in einem Ordner mit
   `Notenpult.exe`), prüft die Kopie per Hash, schreibt `apply-update.log` und startet Notenpult neu. Die Daten in
   `Dokumente\Notenpult` werden nie angefasst.
4. Schreibrechte prüft die App mit einer echten Testdatei – `fs.access` ignoriert unter Windows die Rechte (ACLs)
   und hält z. B. `C:\Program Files` für beschreibbar. Fehlen sie, startet sich das Skript per UAC mit
   Administratorrechten neu und startet Notenpult danach über `explorer.exe` wieder als normaler Benutzer.
5. Beim nächsten Start liest `update:lastResult` (`updater/result.js`) das Protokoll: Erfolg → Hinweis
   „aktualisiert“, Fehlschlag (Ordner einer neueren Version mit Protokoll) → Dialog mit dem Grund.

## Tests

`npm test` → `scripts/run-tests.js` startet die App mit `NOTENPULT_TEST=<skript>` und einem leeren
Datenordner. `main.js` spritzt das Skript nach dem Laden ein; es steuert die Oberfläche über echte DOM-
und Pointer-Events und meldet `PASS …`/`FAIL …`. Das Fenster ist dabei unsichtbar.
