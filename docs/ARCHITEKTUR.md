# Architektur

Notenpult ist eine Electron-App. Die Oberfläche ist reines JavaScript (ES-Module) ohne Framework und
ohne Build-Schritt; pdf.js rendert die Noten. Dieselbe Oberfläche läuft in der Android-App (siehe unten).

```
main.js            Hauptprozess: Fenster, Datenordner, Datei-Import, Noten-Pool-Scan, app://-Protokoll
preload.js         sichere Brücke (contextBridge) → window.notenpult
updater/           In-App-Updates aus GitHub-Releases (siehe unten)
preset.js          „Alles exportieren/importieren“: komplette Bibliothek als ZIP (tar.exe)
hwkeys.js          Lautstärke-/Medientasten für Fernbedienungen (globale Tastenkürzel, solange die Notenansicht sie will)
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
  js/remote.js     Fußpedal & Fernbedienung: Tastenbelegung, Tasten lernen, MIDI
  js/tuner.js      Stimmgerät: Tonerkennung (YIN), Notennamen, Dialog, Cent-Anzeige auf dem Blatt
  js/metronome.js  Metronom auf dem Blatt: Tempo-Feld, − / +, Start/Stopp, Klick über die Web-Audio-Uhr
  js/floating.js   Verschieben/Vergrößern für Stimmgerät und Metronom auf dem Blatt
  js/face.js       Blättern per Gesicht: Kamera, MediaPipe Face Landmarker, Gesten
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

## Oberfläche (Stil)

Zwei Stile in `styles.css`, gewählt über `<html data-style>` (`theme.js`, Einstellung `uiStyle`):
„classic“ sind die Tokens am Anfang (Bernstein), „v2“ (Standard ab 2.0) setzt am Ende eigene Tokens (Graphit,
Silber im Dunkelmodus) und ein paar Regeln für ruhigere Listen und kleinere Radien. Komponenten verwenden nur
Tokens (`--accent`, `--surface` …); ein neuer Stil braucht also keine Änderung im JavaScript.

Eine eigene Akzentfarbe (`settings.accentColor`) setzt `theme.js` als Inline-Variablen auf `<html>` – sie
gelten vor beiden Stilen. `accentTokens()` leitet aus der einen Farbe Hover-Ton, Schrift auf Knöpfen
(schwarz oder weiß, je nach Kontrast), Tönung und eine Textfarbe mit mindestens 4,5 : 1 gegen die Fläche ab,
getrennt für hell und dunkel; bei `null` werden die Variablen entfernt.

## Fußpedal & Fernbedienung

- Tasten kommen auf drei Wegen an: als `keydown` (Pedale melden sich als Tastatur), als Systemtaste
  (`backend.onHardwareKey`) und als MIDI (`navigator.requestMIDIAccess`, nur wenn eine MIDI-Taste belegt ist).
  `remote.keyId()` gibt allen einen Namen („PageDown“, „AudioVolumeUp“, „midi:cc64“ …), `actionFor()` die Aktion
  aus `settings.remoteKeys` (null = `DEFAULT_KEYS`).
- **Systemtasten**: Lautstärke-, Medien- und Kameratasten erreichen die Seite nicht von selbst. Solange die
  Notenansicht offen ist (und `volumeKeys` an) oder der Dialog „Tasten testen & zuweisen“, ruft `remote.capture()`
  `backend.setHardwareCapture(true)`: Windows registriert sie in `hwkeys.js` als globale Kürzel (nur solange das
  Fenster den Fokus hat), Android nimmt sie in `MainActivity.dispatchKeyEvent` (`HardwareKeys.java`). Beide
  schicken den Namen wie in einem keydown an die Seite.
- Im Notenmodus (`viewer.js` `runRemote`): gehaltene Tasten (`repeat`) blättern nicht weiter; kommen eine
  Systemtaste und eine andere Taste innerhalb von 150 ms (Selfie-Auslöser: Enter + Lauter), zählt nur die erste.
  Mausrad: eine Seite pro Drehung (Summe ≥ 50 px, Ende nach 250 ms Pause). Nach oben/unten wischen (> 60 px)
  blättert wie nach links/rechts.
- Die Belegung und die Schalter stehen in `DEVICE_SETTINGS`: Sie bleiben beim Übertragen auf dem Gerät.

## Geschwindigkeit

`test/perf.js` misst mit 600 Stücken, 25 Setlists und 2000 Pool-Dateien und bricht bei deutlicher
Verlangsamung ab. Was dafür sorgt, dass es schnell bleibt:

- `app.js` baut die Ansicht hinter der Notenansicht nicht neu (`onViewerClosed` holt es einmal nach).
- `library.js` baut lange Listen schrittweise (`FIRST_ROWS`, dann `STEP_ROWS` je Frame); war die Liste gescrollt,
  sofort komplett, damit die Position stimmt; die Buchstabenleiste baut fehlende Gruppen sofort.
  `rowInfo()` zählt Setlists und Pool-Dateien einmal pro Liste.
- `ui.icon()` klont vorbereitete SVGs statt sie je Aufruf zu parsen.
- `store.js` speichert 40 ms nach der letzten Änderung, nie zweimal gleichzeitig, und höchstens einmal
  nachträglich für Änderungen während eines Speicherns. `flushSaves()` schreibt sofort (Android: beim Wechsel in
  den Hintergrund, Windows: beim Schließen).
- `render.js` lädt pdf.js per `import()` erst mit dem ersten PDF; unter Android lädt `boot.js` die App vor
  pdf.js, und die Weiche (`pdfjs-shim.js`) wartet auf pdf.js.

## Notenmodus 2.1

- **Halbe Seite**: `screensOf()` setzt zwischen zwei Einzelseiten einen Bildschirm `{ idx: [nächste, aktuelle],
  dir: 'half' }`. Beide Seiten liegen in voller Größe übereinander (`.spread.half`, `clip-path` zeigt je eine Hälfte),
  so stimmen Anmerkungen und Treffer (`slotAt` wählt nach der Mitte). Positionen tragen `half` mit (`step`,
  `screenIndex`).
- **Sprung-Links** stehen an der Stimme: `part.links = [{ id, from: { pageId, x, y }, to: { … } }]` (Seitenanteile
  der ungedrehten Seite). `boxPoint()` bildet sie über die Seitentransformation auf den Bildschirm ab.
- **Anmerkungen**: Neben Strichen gibt es Textmarker (`m: 1`, eine durchscheinende Linie, unter allem anderen),
  Text (`t: 'text'`) und Stempel (`t: 'stamp'`, `k` aus `ink.STAMPS`, als Vektor gezeichnet). Text und Stempel
  haben ein leeres `p`, damit ältere Versionen sie überspringen.

## Stimmgerät und Gesicht

- `tuner.js`: Mikrofon (`getUserMedia`, ohne Echo-/Rauschunterdrückung) → `AnalyserNode` (4096 Werte) →
  `detectPitch` (YIN: grob bei halber Abtastrate, fein bei voller, Parabel ins Minimum) etwa 15-mal pro Sekunde,
  Median der letzten fünf. `noteFor` rechnet mit dem Kammerton und der Stimmung des Instruments.
- Stimmgerät auf dem Blatt: `startSheetTuner()` nutzt dieselbe Mikrofon-Schleife (`listenPitch`) und zeigt nur
  die Cent (`centsLabel`). Es hängt am Notenmodus (`V.sheetTuner`), nicht an der Seite; Zeiger-Ereignisse
  enden dort, damit nichts blättert. Größe in `settings.sheetTunerSize` (Geräte-Einstellung, gespeichert mit
  `persist()` ohne Neuzeichnen).
- Mehrseitige Stücke scrollen (`settings.scrollPages`, Geräte-Einstellung): `store.defaultLayout()` liefert für
  Stimmen mit mehr als einer Seite die Ansicht `'scroll'` (eine eigene, gemerkte Ansicht geht vor). `screensOf`
  macht daraus einen einzigen Bildschirm mit allen Seiten (`dir: 'scroll'`), `layoutBoxes` rechnet wie bei
  „Breite“ auf volle Breite, der `.stage` scrollt. `next()`/`prev()` scrollen erst und blättern am Ende ins
  nächste/vorige Stück; die Seitenzahl in der Leiste folgt dem Scrollen (`pagesInView`).
- Metronom auf dem Blatt: `startSheetMetronome()` legt die Klicks alle 25 ms bis 0,12 s im Voraus auf die
  Uhr des `AudioContext` (kurzer Dreieckston) – unabhängig davon, ob der Haupt-Thread gerade zeichnet. Ein neues
  Tempo gilt ab dem nächsten Schlag; Stopp trennt den Ausgang (bereits geplante Klicks bleiben stumm) und
  pausiert den Kontext. Tempo `settings.metronomeBpm`, Größe `settings.sheetMetronomeSize` (beide Geräte-
  Einstellungen, `persist()`). Hängt wie das Stimmgerät am Notenmodus (`V.sheetMetronome`).
- `floating.js` (`makeFloating`): Ziehen, Ecke, zwei Finger, Mausrad für beide Anzeigen auf dem Blatt. Auf
  Knöpfen und dem Tempo-Feld wird ein Druck erst nach 6 px Bewegung zum Verschieben; der Klick danach wird
  verschluckt. Zeiger-Ereignisse enden dort, damit nichts blättert.
- Messing-Glanz: `--accent-metal` (Verlauf) und `--metal-edge` (Glanzkante) in styles.css; für eine eigene Farbe
  rechnet `theme.metalSheen()` den Verlauf aus.
- `face.js`: MediaPipe Face Landmarker (`@mediapipe/tasks-vision`, Bündel + wasm + Modell aus `assets/mediapipe`,
  kopiert von `scripts/mediapipe.js`), GPU mit Rückfall auf CPU. Aus Blendshapes (`jawOpen`, `eyeBlink…`) und der
  Kopfdrehung (Transformationsmatrix) macht `createGestureDetector` mit Haltezeit, Rückkehr zur Ausgangshaltung
  und Pause „weiter“/„zurück“. MediaPipes Startmeldungen werden aus der Konsole gefiltert. Scheitert die GPU beim
  Erkennen dreimal hintereinander, lädt `face.js` neu auf der CPU.
- CSP und WebAssembly: Windows erlaubt es mit `'wasm-unsafe-eval'`. Das Android-WebView (Chrome ≤ 95) kennt das
  nicht und braucht `'unsafe-eval'` (scripts/build-android-web.js). Electron 14 im Android-Test setzt die CSP für
  WebAssembly nicht durch – `test/android.js` prüft deshalb die Regel selbst.
- Rechte: Electron erteilt sie selbst; Android gibt sie in `onPermissionRequest` nur der eigenen Seite und fragt ab
  Android 6 einmal nach. Tests laufen mit Chromiums künstlicher Kamera und künstlichem Mikrofon
  (`use-fake-device-for-media-stream`).

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
android/app/src/main/java/…/HardwareKeys.java   Lautstärke-/Medien-/Kameratasten → Namen wie in remote.js
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
