# Changelog

Alle nennenswerten Änderungen an Notenpult. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

## [1.4.1] – 2026-10-02

### Behoben
- **Windows-Update in „Dokumente“ / OneDrive:** Der Ransomware-Schutz von Windows („Überwachter Ordnerzugriff“)
  und manche Virenscanner verbieten PowerShell das Schreiben dort – das Update scheiterte mit „Datei … konnte
  nicht gefunden werden“. Jetzt spielt **Notenpult.exe selbst** das Update ein (Node-Modus von Electron):
  Was Notenpult schreiben darf (es speichert seine Daten ja auch in „Dokumente“), kann es auch aktualisieren.
  PowerShell bleibt nur für geschützte Ordner wie `C:\Programme`, die Administratorrechte brauchen.
- Blockiert Windows den Programmordner trotzdem, sagt Notenpult das schon vor dem Download und nennt die Abhilfe
  (Ordner nach `%LOCALAPPDATA%\Programs\Notenpult` verschieben) – kein Beenden und Neustarten mehr umsonst.
- Fehlerdialog nach einem gescheiterten Update erklärt diesen Fall verständlich statt der Windows-Meldung.

## [1.4.0] – 2026-10-02

### Hinzugefügt
- **Mehrfachauswahl in A–Z:** vorne auf das Symbol eines Stücks tippen (oder „Auswählen“) – dann wählt jeder
  Tipp auf eine Zeile aus. Umschalt+Klick wählt einen Bereich, „Alle mit A“ einen ganzen Buchstaben,
  „Alle angezeigten“ alles, was Suche und Genre-Filter gerade zeigen (z. B. 100 Stücke mit einem Tipp).
- Mit der Auswahl **auf einmal löschen** (mit Rückfrage: Anzahl, Titel, betroffene Setlists) oder
  **zu einer Setlist hinzufügen**. Setlist-Einträge, Anmerkungen und nicht mehr benutzte Notendateien gehen mit,
  der Noten-Pool holt gelöschte Stücke nicht zurück.
- Auswahl beenden: ✕ in der Leiste, Esc, Android-Zurück-Taste oder Wechsel zu den Setlists.
- Test `select.js` (u. a. 120 Stücke auf einmal löschen).

## [1.3.1] – 2026-10-02

### Behoben
- **Android: Verbindung zu GitHub.** Android 5 kennt die Stammzertifikate nicht mehr, mit denen GitHub heute
  arbeitet (Let's Encrypt/ISRG Root X1 für Downloads, Sectigo E46 für github.com) – Update-Suche und Download
  scheiterten, auch im Browser („unsichere Seite“). Die App bringt jetzt die aktuelle Zertifikatsliste von
  Mozilla mit und spricht GitHub selbst an (Java statt WebView); Zertifikate und Hostnamen werden wie üblich
  geprüft.
- **Android: Update direkt in der App.** „Jetzt aktualisieren“ lädt die APK selbst (mit Fortschritt und
  SHA-256-Prüfung) und öffnet die Android-Installation – kein Umweg über den Browser mehr.
- **Windows: Update in geschützten Ordnern** (z. B. `C:\Programme`). Notenpult hielt den Ordner für
  beschreibbar (`fs.access` prüft unter Windows keine Rechte), das Update-Skript scheiterte dann still und
  startete die alte Version. Jetzt prüft die App mit einer echten Testdatei; fehlen Rechte, fragt Windows nach
  Administratorrechten, danach startet Notenpult wieder als normaler Benutzer.
- **Update-Ergebnis wird angezeigt:** nach dem Neustart „Notenpult ist jetzt auf Version … aktualisiert“ –
  oder, falls es nicht geklappt hat, ein Hinweis mit dem Grund aus dem Update-Protokoll.
- Das Update-Skript wartet auf alle Notenpult-Prozesse, prüft die kopierte Datei per Prüfsumme und versucht es
  länger, falls ein Virenscanner die Datei kurz sperrt.
- Vollständiges Update kopiert jede Datei, auch wenn Größe und Zeitstempel zufällig gleich sind.
- Release: Der Signaturschlüssel der Android-App wird auch mit Zeilenumbrüchen im Secret gelesen.
- Tests laufen mit eigenem Browser-Profil und stören eine geöffnete Notenpult-App nicht mehr.

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

[Unreleased]: https://github.com/MaxKuhnDE/notenpult/compare/v1.4.1...HEAD
[1.4.1]: https://github.com/MaxKuhnDE/notenpult/releases/tag/v1.4.1
[1.4.0]: https://github.com/MaxKuhnDE/notenpult/releases/tag/v1.4.0
[1.3.1]: https://github.com/MaxKuhnDE/notenpult/releases/tag/v1.3.1
[1.3.0]: https://github.com/MaxKuhnDE/notenpult/releases/tag/v1.3.0
[1.2.0]: https://github.com/MaxKuhnDE/notenpult/releases/tag/v1.2.0
[1.1.0]: https://github.com/MaxKuhnDE/notenpult/commits/main
