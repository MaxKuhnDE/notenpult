# Architektur

Notenpult ist eine Electron-App. Die Oberfläche ist reines JavaScript (ES-Module) ohne Framework und
ohne Build-Schritt; pdf.js rendert die Noten. Dieselbe Oberfläche läuft in der Android-App (siehe unten).

```
main.js            Hauptprozess: Fenster, Datenordner, Datei-Import, Noten-Pool-Scan, app://-Protokoll
preload.js         sichere Brücke (contextBridge) → window.notenpult
updater/           In-App-Updates aus GitHub-Releases (siehe unten)
preset.js          „Alles exportieren/importieren“: komplette Bibliothek als ZIP (tar.exe)
lan/               „Im WLAN teilen“: protocol.js (SPAKE2, AES-GCM, Rahmen), host.js, client.js, apply.js, ipc.js
renderer/
  index.html, styles.css
  js/app.js        Start, Kopfzeile, Moduswechsel, Drag & Drop, Tastenkürzel
  js/store.js      Datenmodell, Speichern, Migration, Backend (Electron bzw. IndexedDB im Browser)
  js/render.js     pdf.js/Bilder → Canvas, Seitengeometrie, Drehung, Rand-Erkennung, Caches
  js/viewer.js     Notenmodus: Layout, Blättern, Stift/Radierer, Stimmen, Suche, Nummernblock
  js/ink.js        Anmerkungen: Speichern je Stück, Zeichnen, Radier-Treffer
  js/library.js    A–Z-Bibliothek, Mehrfachauswahl (Löschen/Setlist für viele Stücke)
  js/setlists.js   Setlists, Nummern, Zehnerblöcke, Umordnen
  js/editor.js     Stück bearbeiten: Stimmen, Seiten, Drehen, Aufteilen
  js/importer.js   Import, automatisches Verknüpfen von Stimmen
  js/sync.js       Noten-Pool (Google-Drive-Ordner): Abgleich, Offline-Kopien
  js/search.js     Suche über Bibliothek, Nummern, Genres (#tag), Setlists, Pool
  js/genres.js     Genres: Chips, Auswahl, Verwaltung, Filterleiste
  js/settings.js   Einstellungen, Pool-Einrichtung
  js/lan.js        Dialoge „Im WLAN teilen“ / „Aus dem WLAN holen“
  js/lan-plan.js   was beim Holen entsteht: spiegelgleich oder hinzufügen, welche Dateien fehlen
  js/ui.js         DOM-Helfer, Icons, Dialoge, Menüs, Toasts
scripts/           copy-vendor (pdf.js), make-icon, run-tests, build-android-web (+ android/boot.js, pdfjs-shim.js)
test/              UI-Tests (laufen in der echten App) + Generator für Beispielnoten; android/ = Prüfumgebung
android/           Android-App (Gradle): MainActivity.java (WebView + Brücke), Preset.java (ZIP), Lan*.java (WLAN)
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
              pages: [{ id, file: 'a1b2….pdf', page: 1, rot: 90?, crop: { f, v, r: [x, y, w, h] }? }],
              layout: 'firstSingle'? }],               // im Notenmodus gewählt (Quer- und Hochformat)
  }],
  setlists: [{ id, name, entries: [{ id, pieceId, number: '47' }] }],
  genres: [{ name: 'Marsch' }],               // eigene Genres (#Hashtags)
  settings: { theme, invertSheets, portraitLayout, landscapeLayout, piecePresets, autoCrop, … },
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
  „two“ paart immer, „firstSingle“ zeigt Seite 1 allein und paart ab Seite 2, „pair2“ paart nur 2-seitige Stimmen.
- Welches Layout gilt, entscheidet `store.layoutOf(part, orientation)`: das der Stimme (`part.layout`, im Menü ⋯
  gewählt, für beide Ausrichtungen), solange `settings.piecePresets` an ist, sonst
  `settings.landscapeLayout`/`portraitLayout`. 1.6.0 speicherte je Ausrichtung ein Layout; `migratePiece` macht
  daraus eines.
- `DEVICE_SETTINGS` (die drei Layout-Einstellungen) gehören zum Bildschirm: `lan-plan.js` übernimmt sie im
  Spiegel-Modus nicht vom Host, und vor „Alles importieren“ merkt `keepDeviceSettings()` sie in `localStorage`,
  `store.init()` setzt sie nach dem Neuladen wieder ein.
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

## Im WLAN teilen

Ein Gerät teilt (Host, nur lesend), eines holt (Empfänger). Gleiches Protokoll in `lan/*.js` (Windows) und
`Lan*.java` (Android); `LanTest.java` prüft beide gegeneinander (über `test/lan-peer.js`).

- **Finden**: Der Empfänger fragt per UDP-Broadcast auf Port 47321 `{"np":"discover","v":1}`, Hosts antworten
  mit Name, TCP-Port, Version, Zahl der Stücke und ob sie gerade belegt sind. Ohne Broadcast: Adresse eingeben.
- **Verbinden**: TCP auf Port 47322 (ist er belegt, ein freier – dann steht der Port beim Code). Rahmen =
  4 Byte Länge (Big Endian) + Inhalt. Ein Empfänger zur Zeit, ein zweiter bekommt `busy`.
- **Schlüssel**: SPAKE2 in der 2048-Bit-Gruppe aus RFC 3526 (Untergruppe der Ordnung q = (p−1)/2, g = 2).
  w = SHA-256(„Notenpult SPAKE2 w “ + Code) mod q; M, N = Quadrat eines Hashwerts mod p (niemand kennt ihren
  Logarithmus). Empfänger sendet T = gˣ·Mʷ, Host S = gʸ·Nʷ; beide berechnen K = gˣʸ. Aus dem Transkript
  (T, S, K, w) entstehen per HMAC-SHA-256 je ein Bestätigungswert pro Richtung und je ein AES-Schlüssel pro
  Richtung. Falscher Code → Bestätigung passt nicht → `code`; ein Mithörer kann den Code nicht offline erraten,
  ein aktiver Angreifer hat einen Versuch pro Verbindung, der Host nach drei Fehlversuchen einen neuen Code.
- **Danach**: AES-256-GCM, Nonce = Richtungs-Zähler (kein Wiederholen, keine Umsortierung möglich). Erstes Byte
  im Klartext: 1 = JSON, 2 = Dateidaten. Nachrichten: `manifest` (Bibliothek, Anmerkungen, Dateiliste mit
  Größen), `get` (eine Notendatei, in Blöcken zu 256 KiB), `bye`. Dateinamen nur nach `[A-Za-z0-9_-]+\.ext`.
- **Holen**: `lan-plan.js` baut aus der eigenen Bibliothek und dem Manifest die neue (spiegelgleich = die des
  Hosts; hinzufügen = Stücke/Setlists nach ID zusammenführen, Genres nach Name, eigene Einstellungen bleiben)
  und die Liste fehlender Dateien (nicht vorhanden oder andere Größe). Die Dateien landen als `.part` und werden
  erst vollständig umbenannt. `apply.js`/`LanApply.java` prüfen, dass jede gebrauchte Datei da ist, sichern den
  alten Stand nach `_vor-abgleich`, schreiben Anmerkungen und zuletzt `notenpult.json`; danach lädt die
  Oberfläche neu (wie beim ZIP-Import, Speichern ist solange angehalten).

## Android

```
android/app/src/main/java/…/MainActivity.java   WebView, https://notenpult.local, Brücke window.NotenpultAndroid
android/app/src/main/java/…/Preset.java         ZIP-Export/-Import (reines Java, JUnit-getestet)
android/app/src/main/java/…/Lan*.java           „Im WLAN teilen“ (wie lan/*.js, JUnit-getestet)
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
- **WLAN**: `lanHostStart`/`lanConnect`/`lanDownload`/`lanFinish` laufen in einem eigenen Thread und antworten
  über `__npResolve`; Ereignisse (Verbunden, Fortschritt, neuer Code) kommen über `window.__npLanEvent`. Beim
  Teilen hält ein `MulticastLock` den Empfang der Broadcasts offen. Gerätename aus den Android-Einstellungen.
- **Tests**: `test/android.js` lädt das Bündel in Electron 14 (Chromium 93) mit `test/android/bridge.js` als
  Ersatz für die Java-Brücke (für das WLAN mit `lan/*.js`); `PresetTest.java` prüft den ZIP-Import, u. a. mit einer
  echten Windows-Export-Datei, `LanTest.java` das WLAN-Protokoll gegen die Windows-Implementierung.

## Updates

```
updater/index.js         Hauptprozess: GitHub-Release abfragen, Download mit SHA-256-Prüfung, ZIP entpacken (tar.exe)
updater/apply-update.js  läuft nach dem Beenden in Notenpult.exe (Node-Modus): tauscht app.asar bzw. spiegelt die App
updater/apply-update.ps1 nur für geschützte Ordner (C:\Program Files): dasselbe mit Administratorrechten (UAC)
updater/result.js        nach dem Neustart: Ergebnis aus apply-update.log lesen („aktualisiert“ / Grund des Fehlers)
renderer/js/updates.js   Einstellungen → Updates, automatische Suche beim Start, Punkt am Einstellungen-Knopf
```

1. `update:check` liest `releases/latest` und `update.json`. Ist die Electron-Version gleich, reicht `app.asar`
   (enthält main.js, preload.js, renderer, pdf.js), sonst kommt das ZIP.
2. `update:install` lädt in `%TEMP%\notenpult-update-<version>` (über `original-fs`, weil Electrons `fs` jede
   `*.asar`-Datei als Archiv behandelt), prüft Größe und Digest, startet den Tausch losgelöst und beendet die App.
   Den Tausch macht `apply-update.js` in einer Notenpult.exe mit `ELECTRON_RUN_AS_NODE=1` – für `app.asar` die
   installierte, für ein volles Update die neue aus `%TEMP%` (die installierten Laufzeitdateien dürfen dabei nicht
   in Benutzung sein). Grund: Der Ransomware-Schutz von Windows („Überwachter Ordnerzugriff“) und Virenscanner
   sperren PowerShell oft in „Dokumente“/OneDrive, Notenpult selbst aber nicht (es speichert dort seine Daten).
3. Der Helfer wartet auf das Ende der App, ersetzt die Dateien (nur in einem Ordner mit `Notenpult.exe`), prüft
   `app.asar` per Hash, schreibt `apply-update.log` und startet Notenpult neu (ohne `ELECTRON_RUN_AS_NODE`). Die
   Daten in `Dokumente\Notenpult` werden nie angefasst.
4. Schreibrechte prüft die App mit einer echten Testdatei – `fs.access` ignoriert unter Windows die Rechte (ACLs)
   und hält z. B. `C:\Program Files` für beschreibbar. `EPERM`/`EACCES` → `apply-update.ps1` startet sich per UAC
   mit Administratorrechten und danach Notenpult über `explorer.exe` wieder als normaler Benutzer. Andere Fehler
   (z. B. `ENOENT` durch den Ransomware-Schutz) → kein Update möglich; die App sagt das vor dem Download.
5. Beim nächsten Start liest `update:lastResult` (`updater/result.js`) das Protokoll: Erfolg → Hinweis
   „aktualisiert“, Fehlschlag (Ordner einer neueren Version mit Protokoll) → Dialog mit dem Grund.

## Tests

`npm test` → `scripts/run-tests.js` startet die App mit `NOTENPULT_TEST=<skript>` und einem leeren
Datenordner. `main.js` spritzt das Skript nach dem Laden ein; es steuert die Oberfläche über echte DOM-
und Pointer-Events und meldet `PASS …`/`FAIL …`. Das Fenster ist dabei unsichtbar.
