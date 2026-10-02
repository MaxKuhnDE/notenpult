// Tests the file swap after the app quits on throw-away folders – updater/apply-update.js
// (normal case, run by Notenpult.exe in Node mode; here by node), updater/apply-update.ps1
// (protected folders) – and updater/result.js (what the app reports after the restart).
'use strict';

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lastUpdateResult } = require('../updater/result');

const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notenpult-apply-'));
// Run a copy: the script writes its log next to itself.
const script = path.join(tmp, 'apply-update.ps1');
fs.copyFileSync(path.join(__dirname, '..', 'updater', 'apply-update.ps1'), script);
const jsDir = path.join(tmp, 'js');
fs.mkdirSync(jsDir);
const jsScript = path.join(jsDir, 'apply-update.js');
fs.copyFileSync(path.join(__dirname, '..', 'updater', 'apply-update.js'), jsScript);

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(...p));
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
function fakeInstall(dir) {
  write(path.join(dir, 'Notenpult.exe'), 'old exe');
  write(path.join(dir, 'resources', 'app.asar'), 'old asar');
  write(path.join(dir, 'old-only.dll'), 'old');
}
function apply(mode, source, target) {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Mode', mode, '-Source', source, '-Target', target, '-Exe', path.join(target, 'Notenpult.exe'), '-NoRestart', '-NoElevate'],
    { stdio: 'ignore', timeout: 120000 });
  } catch { /* the script logs errors itself */ }
}

function applyJs(mode, source, target, extra = []) {
  execFileSync(process.execPath, [jsScript, '--mode', mode, '--source', source, '--target', target,
    '--exe', path.join(target, 'Notenpult.exe'), '--no-restart', ...extra], { stdio: 'ignore', timeout: 120000 });
}
const jsLog = () => (fs.existsSync(path.join(jsDir, 'apply-update.log')) ? read(jsDir, 'apply-update.log') : '');

(async () => {
try {
  // ---------- apply-update.js (Notenpult.exe in Node mode) ----------
  const j1 = path.join(tmp, 'js-asar');
  fakeInstall(j1);
  const jsAsar = path.join(tmp, 'js-new.asar');
  write(jsAsar, 'new asar from js');
  // The old app is still running for a moment: the swap must wait for its process.
  const app = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)']);
  const t0 = Date.now();
  applyJs('asar', jsAsar, j1, ['--pid', String(app.pid)]);
  check('js: waits for the old app, then replaces app.asar only', Date.now() - t0 >= 1400
    && read(j1, 'resources', 'app.asar') === 'new asar from js' && read(j1, 'Notenpult.exe') === 'old exe'
    && /update applied \(asar\)/.test(jsLog()), `${Date.now() - t0} ms`);

  const j2 = path.join(tmp, 'js-full');
  fakeInstall(j2);
  const jsBuild = path.join(tmp, 'js-build');
  write(path.join(jsBuild, 'Notenpult.exe'), 'new exe');
  write(path.join(jsBuild, 'resources', 'app.asar'), 'full asar');
  write(path.join(jsBuild, 'locales', 'de.pak'), 'de');
  applyJs('full', jsBuild, j2);
  check('js: full update mirrors the new build', read(j2, 'Notenpult.exe') === 'new exe' && read(j2, 'resources', 'app.asar') === 'full asar'
    && exists(j2, 'locales', 'de.pak') && !exists(j2, 'old-only.dll'));

  const j3 = path.join(tmp, 'js-foreign');
  write(path.join(j3, 'important.txt'), 'keep me');
  applyJs('full', jsBuild, j3);
  check('js: refuses folders that are not Notenpult', read(j3, 'important.txt') === 'keep me' && !exists(j3, 'Notenpult.exe')
    && /ERROR: Target is not a Notenpult installation/.test(jsLog()));

  // Small update: only resources\app.asar changes
  const inst1 = path.join(tmp, 'install-asar');
  fakeInstall(inst1);
  const newAsar = path.join(tmp, 'new.asar');
  write(newAsar, 'new asar');
  apply('asar', newAsar, inst1);
  check('asar update replaces resources\\app.asar only', read(inst1, 'resources', 'app.asar') === 'new asar' && read(inst1, 'Notenpult.exe') === 'old exe');

  // Full update: the installation becomes a mirror of the new build
  const inst2 = path.join(tmp, 'install-full');
  fakeInstall(inst2);
  const build = path.join(tmp, 'build');
  write(path.join(build, 'Notenpult.exe'), 'new exe');
  write(path.join(build, 'resources', 'app.asar'), 'full asar');
  write(path.join(build, 'new.dll'), 'new');
  apply('full', build, inst2);
  check('full update mirrors the new build', read(inst2, 'Notenpult.exe') === 'new exe'
    && read(inst2, 'resources', 'app.asar') === 'full asar' && exists(inst2, 'new.dll') && !exists(inst2, 'old-only.dll'));

  // Safety: never touch a folder that is not a Notenpult installation
  const foreign = path.join(tmp, 'foreign');
  write(path.join(foreign, 'important.txt'), 'keep me');
  apply('full', build, foreign);
  const log = exists(tmp, 'apply-update.log') ? read(tmp, 'apply-update.log') : '';
  check('refuses folders that are not Notenpult', read(foreign, 'important.txt') === 'keep me'
    && !exists(foreign, 'Notenpult.exe') && log.includes('ERROR'));

  // Protected folder (like C:\Program Files): without administrator rights nothing changes and
  // the log says why. (The app would ask for the rights; -NoElevate keeps UAC out of tests.)
  const locked = path.join(tmp, 'install-locked');
  fakeInstall(locked);
  const me = execFileSync('whoami', { encoding: 'utf8' }).trim();
  const resources = path.join(locked, 'resources');
  execFileSync('icacls', [resources, '/deny', `${me}:(OI)(CI)(WD,AD,WEA,WA)`], { stdio: 'ignore' });
  try {
    fs.rmSync(path.join(tmp, 'apply-update.log'), { force: true });
    apply('asar', newAsar, locked);
    const lockedLog = exists(tmp, 'apply-update.log') ? read(tmp, 'apply-update.log') : '';
    check('protected folder: old version stays, log names the reason',
      read(locked, 'resources', 'app.asar') === 'old asar' && /ERROR: Zugriff verweigert/.test(lockedLog), lockedLog.trim().split('\n').pop());
  } finally {
    execFileSync('icacls', [resources, '/remove:d', me], { stdio: 'ignore' });
  }

  // After the restart the app reads the logs (updater/result.js).
  const temp = path.join(tmp, 'temp');
  write(path.join(temp, 'notenpult-update-1.4.0', 'apply-update.log'), '10:00:01 no write access - asking for administrator rights\r\n10:00:03 ERROR: Administratorrechte wurden nicht erteilt\r\n');
  write(path.join(temp, 'notenpult-update-1.3.0', 'apply-update.log'), '09:00:00 update applied (asar)\r\n09:00:00 restarted\r\n');
  write(path.join(temp, 'notenpult-update-1.5.0', 'app.asar'), 'only downloaded'); // no log: not an attempt
  const failed = await lastUpdateResult(temp, '1.3.0');
  check('failed update is reported with its reason', failed && failed.failed === '1.4.0' && failed.reason === 'Administratorrechte wurden nicht erteilt', JSON.stringify(failed));
  check('… only once, finished update folders are removed', (await lastUpdateResult(temp, '1.3.0')) === null
    && !exists(temp, 'notenpult-update-1.3.0') && exists(temp, 'notenpult-update-1.5.0'));
  write(path.join(temp, 'notenpult-update-1.4.0', 'apply-update.log'), '11:00:00 update applied (asar)\r\n');
  check('successful update is reported after the restart', JSON.stringify(await lastUpdateResult(temp, '1.4.0')) === '{"updated":"1.4.0"}');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
})();
