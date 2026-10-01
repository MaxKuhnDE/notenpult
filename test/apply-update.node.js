// Tests updater/apply-update.ps1 (the file swap after the app quits) on throw-away folders.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notenpult-apply-'));
// Run a copy: the script writes its log next to itself.
const script = path.join(tmp, 'apply-update.ps1');
fs.copyFileSync(path.join(__dirname, '..', 'updater', 'apply-update.ps1'), script);

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
      '-Mode', mode, '-Source', source, '-Target', target, '-Exe', path.join(target, 'Notenpult.exe'), '-NoRestart'],
    { stdio: 'ignore', timeout: 120000 });
  } catch { /* the script logs errors itself */ }
}

try {
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
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
