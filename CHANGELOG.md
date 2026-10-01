# Changelog

Alle nennenswerten Änderungen an Notenpult. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt
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

[Unreleased]: https://github.com/MaxKuhnDE/notenpult/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/MaxKuhnDE/notenpult/releases/tag/v1.1.0
