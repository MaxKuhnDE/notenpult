'use strict';

// After a restart: did the last update work? apply-update.ps1 logs into
// %TEMP%\notenpult-update-<version>\apply-update.log. Without Electron, so tests can use it.
//   { updated: '1.3.1' }                          the running version came from an update
//   { failed: '1.3.1', reason: '…', log: '…' }    an update to a newer version did not get in
//   null                                          nothing to report

const path = require('node:path');

// In Electron, the plain fs (the folders hold a real app.asar file); in Node tests, node:fs.
let fs;
try {
  fs = require('original-fs');
} catch {
  fs = require('node:fs');
}

const fsp = fs.promises;
const FOLDER = /^notenpult-update-(\d+\.\d+\.\d+)$/;

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/** The reason from the log: the last ERROR line, else the last failed attempt. */
function reasonOf(log) {
  const lines = log.split(/\r?\n/).map((l) => l.replace(/^\d\d:\d\d:\d\d\s+/, '')).filter(Boolean);
  const error = [...lines].reverse().find((l) => l.startsWith('ERROR:'));
  const attempt = [...lines].reverse().find((l) => /^attempt \d+ failed:/.test(l));
  return (error || attempt || 'unbekannter Fehler').replace(/^ERROR:\s*/, '').replace(/^attempt \d+ failed:\s*/, '');
}

/**
 * Looks at the update folders in {@code tempDir} once per start. Folders of the running or an
 * older version are done and get removed; a log for a newer version means that update failed
 * (it is renamed, so it is reported only once). Folders without a log are downloads only.
 */
async function lastUpdateResult(tempDir, current) {
  let names = [];
  try {
    names = await fsp.readdir(tempDir);
  } catch {
    return null;
  }
  let result = null;
  for (const name of names) {
    const m = FOLDER.exec(name);
    if (!m) continue;
    const dir = path.join(tempDir, name);
    const logFile = path.join(dir, 'apply-update.log');
    let log = null;
    try {
      log = await fsp.readFile(logFile, 'utf8');
    } catch { /* no update was applied from here */ }
    if (compareVersions(m[1], current) <= 0) {
      if (log && m[1] === current && log.includes('update applied')) result = { updated: current };
      if (log) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    if (!log) continue;
    result = { failed: m[1], current, reason: reasonOf(log), log: logFile };
    await fsp.rename(logFile, path.join(dir, 'apply-update.reported.log')).catch(() => {});
  }
  return result;
}

module.exports = { lastUpdateResult, compareVersions, reasonOf };
