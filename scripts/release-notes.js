// Prints the CHANGELOG.md section of one version (used as GitHub release notes).
//   node scripts/release-notes.js 1.2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const version = process.argv[2];
if (!version) {
  console.error('Version fehlt, z. B.: node scripts/release-notes.js 1.2.0');
  process.exit(1);
}
const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
const start = text.indexOf(`## [${version}]`);
if (start < 0) {
  console.error(`Kein Abschnitt "## [${version}]" in CHANGELOG.md`);
  process.exit(1);
}
const rest = text.slice(start);
const firstLineEnd = rest.indexOf('\n');
const next = rest.indexOf('\n## ', firstLineEnd);
const linkDefs = rest.indexOf('\n[', firstLineEnd);
const ends = [next, linkDefs].filter((i) => i > 0);
const body = rest.slice(firstLineEnd + 1, ends.length ? Math.min(...ends) : undefined).trim();
process.stdout.write(`${body}\n\nDaten (Noten, Setlists, Anmerkungen) bleiben beim Update erhalten. In der App: Einstellungen → Updates.\n`);
