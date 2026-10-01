# Changelog

Alle nennenswerten Änderungen an Notenpult. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

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
