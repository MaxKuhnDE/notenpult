# Arbeitsweise

## Branches und Pull Requests

- `main` ist immer lauffähig. Direkt auf `main` wird nicht gearbeitet.
- Jede Änderung bekommt einen eigenen Branch:
  - `feature/<kurzname>` für neue Funktionen (z. B. `feature/genres`)
  - `fix/<kurzname>` für Fehlerbehebungen
  - `docs/<kurzname>` für reine Doku
- Fertige Änderungen gehen als **Pull Request** nach `main`. Die CI (GitHub Actions) muss grün sein:
  Sie startet alle UI-Tests und baut die Windows-App. Screenshots der Tests und die gebaute App hängen
  als Artefakte am Lauf.
- Gemergt wird per „Squash and merge“, damit `main` pro Änderung einen sauberen Commit hat.

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
- Release: Version in `package.json` und `CHANGELOG.md` setzen, mergen, dann Tag pushen:

```bash
git tag v1.2.0
```

```bash
git push origin v1.2.0
```

  Der Release-Workflow baut die App und hängt `Notenpult-win32-x64.zip` an das GitHub-Release.

## Tests

`npm test` muss vor jedem Pull Request lokal grün sein. Neue Funktionen bekommen Prüfungen in einem
Test unter `test/` (Muster: `check('beschreibung', bedingung)` → `PASS …`/`FAIL …`).
