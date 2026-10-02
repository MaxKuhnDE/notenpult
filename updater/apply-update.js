'use strict';

// Applies a downloaded update after Notenpult has quit, then starts it again. Run by a
// Notenpult.exe in Node mode (ELECTRON_RUN_AS_NODE) – not by PowerShell: Windows' ransomware
// protection ("Überwachter Ordnerzugriff") and virus scanners often block PowerShell from
// writing into Documents or OneDrive, while Notenpult – which keeps its data there – may.
//   asar: the installed Notenpult.exe copies the new resources\app.asar
//   full: the new build's Notenpult.exe (in %TEMP%) mirrors itself into the installation
// The protected-folder case (C:\Program Files, needs UAC) still goes through apply-update.ps1.
//
//   Notenpult.exe apply-update.js --pid 123 --mode asar|full --source <file|folder>
//                 --target <installation> --exe <installation>\Notenpult.exe [--no-restart]
// Everything is logged to apply-update.log next to this script; after the restart the app
// reports the result (updater/result.js). User data (Documents\Notenpult) is never touched.

process.noAsar = true; // app.asar is a plain file to copy here

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const LOG = path.join(__dirname, 'apply-update.log');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'no-restart') out.noRestart = true;
    else out[key] = argv[++i];
  }
  return out;
}

function log(message) {
  const t = new Date().toTimeString().slice(0, 8);
  fs.appendFileSync(LOG, `${t} ${message}\r\n`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Virus scanners or cloud sync may hold a file for a moment – try again for a while. */
async function retry(what, fn, attempts = 20) {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (err) {
      log(`attempt ${i} failed: ${what}: ${err.message}`);
      if (i >= attempts) throw err;
      await sleep(1000);
    }
  }
}

function listFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out);
    else out.push(path.relative(base, p));
  }
  return out;
}

async function applyAsar(source, target) {
  const dest = path.join(target, 'resources', 'app.asar');
  const want = sha256(source);
  await retry('app.asar', () => {
    fs.copyFileSync(source, dest);
    if (sha256(dest) !== want) throw new Error('app.asar differs from the download after copying');
  });
}

/** Like robocopy /MIR: every file of the new build, files the new build does not have go. */
async function applyFull(source, target) {
  const files = listFiles(source);
  for (const rel of files) {
    await retry(rel, () => {
      const to = path.join(target, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(source, rel), to);
    });
  }
  const keep = new Set(files.map((f) => f.toLowerCase()));
  for (const rel of listFiles(target)) {
    if (!keep.has(rel.toLowerCase())) fs.rmSync(path.join(target, rel), { force: true });
  }
}

function restart(exe) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // otherwise Notenpult would start in Node mode again
  spawn(exe, [], {
    cwd: path.dirname(exe), env, detached: true, stdio: 'ignore',
  }).unref();
  log('restarted');
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  try {
    // Safety first: only ever write into a Notenpult installation.
    if (!a.target || !fs.existsSync(path.join(a.target, 'Notenpult.exe'))) throw new Error(`Target is not a Notenpult installation: ${a.target}`);
    if (a.mode === 'full' && !fs.existsSync(path.join(a.source, 'Notenpult.exe'))) throw new Error(`Source is not a Notenpult build: ${a.source}`);
    if (a.mode === 'asar' && !(fs.existsSync(a.source) && fs.statSync(a.source).isFile())) throw new Error(`Missing app.asar: ${a.source}`);
    if (a.mode !== 'asar' && a.mode !== 'full') throw new Error(`Unknown mode: ${a.mode}`);

    const pid = Number(a.pid) || 0;
    for (let i = 0; pid && alive(pid) && i < 600; i++) await sleep(100);
    await sleep(800); // helper processes and file handles of the old app

    if (a.mode === 'asar') await applyAsar(a.source, a.target);
    else await applyFull(a.source, a.target);
    log(`update applied (${a.mode})`);
  } catch (err) {
    const blocked = err.code === 'ENOENT' || err.code === 'EPERM' || err.code === 'EACCES';
    log(`ERROR: ${err.message}${blocked ? ` [${err.code}]` : ''}`);
  }
  if (!a.noRestart && a.exe && fs.existsSync(a.exe)) {
    try {
      restart(a.exe);
    } catch (err) {
      log(`restart failed: ${err.message}`);
    }
  }
}

main();
