// Runs the Electron UI tests (test/*.js) against fresh data folders.
// Each test prints "PASS …" / "FAIL …" lines; any FAIL, crash or timeout fails the run.
//
//   npm test                 -> all suites
//   npm test -- smoke2.js    -> one suite
'use strict';

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const suites = process.argv.slice(2).length ? process.argv.slice(2) : ['smoke.js', 'smoke2.js', 'smoke3.js', 'migrate.js'];
const TIMEOUT_MS = 240000;

/** Data folder as written by version 1.0 (pages directly on the piece, layout 'two'). */
function setupV1(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'Noten'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'Anmerkungen'), { recursive: true });
  fs.copyFileSync(path.join(root, 'test', 'samples', 'Florentiner Marsch.pdf'), path.join(dataDir, 'Noten', 'v1flo.pdf'));
  const db = {
    version: 1,
    pieces: [{ id: 'p1', title: 'Florentiner Marsch', addedAt: 1, pages: [{ id: 'pg1', file: 'v1flo.pdf', page: 1 }, { id: 'pg2', file: 'v1flo.pdf', page: 2 }] }],
    setlists: [{ id: 's1', name: 'Alt', entries: [{ id: 'e1', pieceId: 'p1', number: '47' }] }],
    settings: { theme: 'light', landscapeLayout: 'two' },
    ui: { mode: 'setlists', setlistId: 's1' },
  };
  fs.writeFileSync(path.join(dataDir, 'notenpult.json'), JSON.stringify(db));
  fs.writeFileSync(path.join(dataDir, 'Anmerkungen', 'p1.json'), JSON.stringify({ pages: { pg1: [{ c: 'red', w: 0.003, p: [0.2, 0.2, 0.5, 0.4, 0.2, 0.5] }] } }));
}

const SETUP = { 'migrate.js': setupV1 };
const AFTER = {
  'migrate.js': (dataDir) => {
    const backup = path.join(dataDir, 'notenpult.vor-update.json');
    const ok = fs.existsSync(backup) && JSON.parse(fs.readFileSync(backup, 'utf8')).version === 1;
    return [`${ok ? 'PASS' : 'FAIL'} backup of the 1.0 library before migration`];
  },
};

function runSuite(name) {
  // Fresh sample files and pool folder for every suite (smoke2 modifies the pool).
  execFileSync(process.execPath, [path.join(root, 'test', 'make-samples.js')], { stdio: 'ignore' });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notenpult-test-'));
  SETUP[name]?.(dataDir);
  const env = { ...process.env, NOTENPULT_DATA_DIR: dataDir, NOTENPULT_TEST: path.join(root, 'test', name) };
  delete env.ELECTRON_RUN_AS_NODE;

  return new Promise((resolve) => {
    const child = spawn(electron, [root], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let pass = 0;
    let fail = 0;
    let crashed = false;
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).replace(/^\[renderer:\w+\]\s*/, '').trimEnd();
        buffer = buffer.slice(i + 1);
        if (/^PASS /.test(line)) pass++;
        else if (/^FAIL /.test(line)) fail++;
        else if (/SMOKE FAIL|Test script failed/.test(line)) crashed = true;
        if (/^(PASS|FAIL) |FAIL|error/i.test(line)) console.log(`  ${line}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => process.stderr.write(d));
    const timer = setTimeout(() => {
      crashed = true;
      console.log(`  TIMEOUT after ${TIMEOUT_MS / 1000}s`);
      child.kill();
    }, TIMEOUT_MS);
    child.on('exit', () => {
      clearTimeout(timer);
      for (const line of AFTER[name]?.(dataDir) || []) {
        console.log(`  ${line}`);
        if (line.startsWith('PASS')) pass++;
        else fail++;
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
      const ok = !fail && !crashed && pass > 0;
      console.log(`${ok ? '✔' : '✘'} ${name}: ${pass} bestanden, ${fail} fehlgeschlagen${crashed ? ', abgebrochen' : ''}\n`);
      resolve(ok);
    });
  });
}

(async () => {
  let allOk = true;
  for (const suite of suites) {
    console.log(`▶ ${suite}`);
    allOk = (await runSuite(suite)) && allOk;
  }
  process.exit(allOk ? 0 : 1);
})();
