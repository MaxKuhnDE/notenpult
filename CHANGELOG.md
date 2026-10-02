# Changelog

Alle nennenswerten Änderungen an Notenpult. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

## [1.3.0] – 2026-10-02

### Hinzugefügt
- **Android-App** (`Notenpult-android.apk` am Release) für Tablets ab Android 5.0 – gedacht für das
  Galaxy Tab S2 (Android 5.0.2). Gleiche Oberfläche wie unter Windows: Setlists, A–Z, Stimmen, Genres,
  Zwei-Seiten-Ansicht, Anmerkungen (ohne Stift über den Zeichenmodus mit dem Finger), Dunkelmodus,
  Vollbild, Bildschirm bleibt an, Zurück-Taste schließt Dialoge und die Notenansicht.
- Auf dem Tablet: „Export vom PC importieren“ übernimmt die ZIP vom PC – danach ist alles spiegelgleich.
  Export vom Tablet zurück auf den PC geht genauso. Einzelne PDFs/Bilder über „Noten importieren“.
- Updates der Android-App über *Einstellungen → Updates* (lädt die neue APK im Browser).
- Test `android.js`: die Android-Oberfläche in Chromium 93 (älter als die WebView von Android 5);
  JUnit-Tests für den ZIP-Import auf Android, u. a. mit einer echten Export-Datei aus Windows.
- **Alles exportieren / importieren** (Einstellungen → Daten): eine ZIP-Datei mit allen Stücken, PDFs, Stimmen,
  Setlists, Genres, Anmerkungen und Einstellungen. Der Import ersetzt alles – danach ist das Gerät spiegelgleich
  zum exportierenden; der bisherige Stand bleibt in `_vor-import`. Geht schief, wird der alte Stand zurückgelegt.
- Test `preset.js`: Export, Änderungen, Import und Neustart – danach muss alles identisch sein.

### Geändert
- Kein `structuredClone` und Ersatzfarben für `color-mix` – Vorbereitung für ältere Android-Browser.
- Bilder: Ersatzweg für Browser, die `imageOrientation: 'from-image'` noch nicht kennen.
- Offene Änderungen werden auch gespeichert, wenn die App in den Hintergrund geht.

## [1.2.0] – 2026-10-01

### Hinzugefügt
- **Update-Knopf** unter Einstellungen → Updates: sucht die neueste Version auf GitHub, zeigt was neu ist und
  installiert sie mit einem Tipp – Notenpult startet danach neu. Meist wird nur der App-Teil (wenige MB) geladen,
  das komplette Paket nur bei einer neuen Laufzeit. Download wird per SHA-256 geprüft; Noten, Setlists und
  Anmerkungen bleiben unberührt.
- Optional automatische Suche beim Start mit Hinweis und rotem Punkt am Einstellungen-Knopf.
- Releases entstehen automatisch: Erhöht ein gemergter Pull Request die Version, baut GitHub Actions das Release
  (`app.asar`, ZIP, `update.json`) mit den Notizen aus diesem Changelog.
- Genres als Hashtags (#Marsch, #Polka, …): eigene Genres anlegen, umbenennen (auch zusammenführen) und löschen,
  Vorschläge per Antippen.
- Zuordnen über das Stück-Menü „Genres …“, im Stück-Editor oder gesammelt pro Genre („Stücke zuordnen“).
- Genre-Filter als Chips in der A–Z-Liste und im Setlist-Dialog „Stücke hinzufügen“ (mit „Alle angezeigten wählen“).
- Suche: `#polka` findet genau das Genre, normale Begriffe finden auch Genre-Namen; die globale Suche zeigt
  passende Genres und öffnet die gefilterte Liste.
- Test `smoke3.js` für Genres.
- Ansicht „Zwei Seiten“: immer zwei Seiten zusammen (nebeneinander oder untereinander, je nachdem was größer ist).
- Ansicht „Nur 2-seitige“: Stücke mit genau zwei Seiten komplett auf einem Bildschirm, alle anderen einseitig.
  Beide Optionen getrennt für Quer- und Hochformat, in den Einstellungen und im Menü ⋯ der Notenansicht.

## [1.1.0] – 2026-10-01

### Hinzugefügt
- Mehrere Stimmen pro Stück, im Notenmodus per Knopf (oder Taste `S`) umschaltbar.
- Automatisches Verknüpfen beim Import: `Stück - 2. Stimme.pdf`, `Stück - Flügelhorn 2.pdf` usw.
- Stück-Editor mit Stimmen-Reitern; vorhandenes Stück als Stimme übernehmen.
- Noten-Pool aus Google Drive (über Google Drive für Desktop): Filter auf die eigene Stimme,
  Ordner-Struktur „Unterordner = Stück“, automatischer Abgleich, Offline-Kopien.
- Suche über Bibliothek, Stimmen, Setlist-Nummern und Noten-Pool; im Notenmodus wird ein Stück eingeschoben.
- Layout „Automatisch“ für A4 und A5 (nebeneinander/untereinander), automatisches Abschneiden weißer Ränder.
- Seiten um 90° drehen (Leiste und Editor), Anmerkungen drehen mit.

### Geändert
- Hinweis „Als Nächstes“ steht in der oberen Leiste statt über den Noten.
- Leiste im Hochformat zweizeilig, damit alle Knöpfe erreichbar bleiben.

### Migration
- Bibliotheken aus 1.0 werden beim ersten Start übernommen; vorher wird einmalig
  `notenpult.vor-update.json` als Sicherung angelegt.

## 1.0.0 – 2026-10-01 (vor dem Repository)

### Hinzugefügt
- Setlists mit Ordner-Nummern, Zehnerblöcken, Sortieren und Ziehen zum Umordnen.
- A–Z-Bibliothek mit Buchstabenleiste und Suche; Import von PDFs, Bildern und ganzen Ordnern.
- Notenmodus: Tippen blättert, Wischen/Rechtsklick zurück, Nummernblock, Vollbild, Bildschirm bleibt an.
- Stift-Anmerkungen in Rot und Schwarz, Radierer-Ende, Rückgängig, Handballen-Erkennung.
- Dunkelmodus, invertierte Noten, Hoch- und Querformat.

[Unreleased]: https://github.com/MaxKuhnDE/notenpult/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/MaxKuhnDE/notenpult/releases/tag/v1.3.0
[1.2.0]: https://github.com/MaxKuhnDE/notenpult/releases/tag/v1.2.0
[1.1.0]: https://github.com/MaxKuhnDE/notenpult/commits/main
