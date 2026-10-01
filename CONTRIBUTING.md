# Arbeitsweise

## Branches und Pull Requests

- `main` ist immer lauffähig. Direkt auf `main` wird nicht gearbeitet.
- Jede Änderung bekommt einen eigenen Branch:
  - `feature/<kurzname>` für neue Funktionen (z. B. `feature/genres`)
  - `fix/<kurzname>` für Fehlerbehebungen
  - `docs/<kurzname>` für reine Doku
- Fertige Änderungen gehen als **Pull Request** nach `main`. Die CI (GitHub Actions) startet alle UI-Tests
  und baut die Windows-App. Screenshots der Tests und die gebaute App hängen als Artefakte am Lauf.
- **Automatisches Mergen**: `main` ist geschützt – der Check „Tests & Windows-Build“ muss grün sein.
  Jeder PR bekommt beim Öffnen Auto-Merge (Merge-Commit):

```bash
gh pr merge --auto --merge
```

  Sobald die CI grün ist, landet der PR in `main` und der Branch wird gelöscht. Ist die CI rot, bleibt der
  PR offen, bis er repariert ist.
- Bauen zwei offene PRs aufeinander auf (z. B. beide ändern `CHANGELOG.md`), wird der zweite auf den Branch des
  ersten gesetzt (`git rebase`); dank Merge-Commits gehen beide nacheinander sauber durch.

## Commits

Kurze, aussagekräftige Nachrichten nach [Conventional Commits](https://www.conventionalcommits.org/de/):

```
feat: Genres als Hashtags für Stücke
fix: Nummernblock springt bei doppelter Nr. zur ersten
docs: Google-Drive-Einrichtung beschrieben
test: Genre-Filter in smoke3 abgedeckt
```

## Versionen und Releases

- Versionsnummern nach [SemVer](https://semver.org/lang/de/): neue Funktion → Minor (1.**2**.0), Fehlerbehebung → Patch (1.1.**1**).
- Jede Änderung trägt sich in `CHANGELOG.md` unter **Unreleased** ein.
- **Release = Version erhöhen.** Ein PR, der `version` in `package.json` hochsetzt und im Changelog aus
  *Unreleased* einen Abschnitt `## [x.y.z] – Datum` macht, wird nach dem Merge automatisch veröffentlicht:
  `.github/workflows/release.yml` merkt, dass es `vx.y.z` noch nicht gibt, testet, baut und legt das Release an mit
  - `app.asar` – kleines Update (nur App-Teil),
  - `Notenpult-win32-x64.zip` – komplette App,
  - `update.json` – `{ version, electron }`, damit die App weiß, ob der kleine Download reicht.

  Die Release-Notizen kommen aus dem Changelog (`scripts/release-notes.js`). Die installierten Apps finden das
  Release über *Einstellungen → Updates*.

## Tests

`npm test` muss vor jedem Pull Request lokal grün sein. Neue Funktionen bekommen Prüfungen in einem
Test unter `test/` (Muster: `check('beschreibung', bedingung)` → `PASS …`/`FAIL …`):

- `*.js` laufen in der echten App (unsichtbares Fenster), `*.node.js` als reine Node-Tests.
- `update.js` nutzt einen lokalen Ersatz für die GitHub-API (in `scripts/run-tests.js`), lädt das Update herunter
  und prüft es, ersetzt aber nichts; `apply-update.node.js` testet den Dateitausch an Wegwerf-Ordnern.
- Mit `VERBOSE=1` zeigt der Runner die komplette Ausgabe der App.
