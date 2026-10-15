// "Im WLAN teilen" without the app: protocol (SPAKE2 handshake, encrypted frames), host and
// receiver on 127.0.0.1, the plan (renderer/js/lan-plan.js) and writing the result.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startHost } = require('../lan/host');
const { discover, connect } = require('../lan/client');
const { applyReceive, localFiles } = require('../lan/apply');
const {
  P, Q, M, N, Channel, modPow,
} = require('../lan/protocol');

const check = (label, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notenpult-lan-'));
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pathsOf = (dir) => ({
  dataDir: dir, dbFile: path.join(dir, 'notenpult.json'), filesDir: path.join(dir, 'Noten'), annDir: path.join(dir, 'Anmerkungen'),
});
const piece = (id, title, files) => ({
  id, title, genres: [], part: 0, parts: [{ id: `${id}p`, name: '1. Stimme', pages: files.map((file, i) => ({ id: `${id}g${i}`, file, page: 1 })) }],
});
const errCode = async (promise) => {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    return err.code || err.message;
  }
};

(async () => {
  try {
    // ---------- group ----------
    check('group: P is the RFC 3526 2048-bit prime', P === BigInt(`0x${crypto.getDiffieHellman('modp14').getPrime('hex')}`));
    check('group: 2, M and N lie in the subgroup of order Q', [2n, M, N].every((x) => modPow(x, Q, P) === 1n) && M !== N);

    // ---------- host with a library ----------
    const hostDir = path.join(tmp, 'host');
    const hostPaths = pathsOf(hostDir);
    write(path.join(hostPaths.filesDir, 'aaaa1111.pdf'), crypto.randomBytes(700 * 1024)); // several chunks
    write(path.join(hostPaths.filesDir, 'bbbb2222.png'), crypto.randomBytes(1000));
    write(path.join(hostPaths.filesDir, 'cccc3333.pdf'), crypto.randomBytes(5000));
    write(hostPaths.dbFile, JSON.stringify({
      version: 2,
      pieces: [piece('p1', 'Florentiner Marsch', ['aaaa1111.pdf']), piece('p2', 'Polka', ['bbbb2222.png']), piece('p3', 'Walzer', ['cccc3333.pdf'])],
      setlists: [{ id: 's1', name: 'Konzert', entries: [{ id: 'e1', pieceId: 'p1', number: '47' }] }],
      genres: [{ name: 'Marsch' }],
      settings: { theme: 'dark' },
      ui: { mode: 'setlists' },
    }));
    write(path.join(hostPaths.annDir, 'p1.json'), '{"pages":{"p1g0":[{"c":"red","w":0.003,"p":[0.1,0.1,0.2,0.2]}]}}');
    const events = [];
    const host = await startHost({
      paths: hostPaths, name: 'Testgerät', app: '9.9.9', bind: '127.0.0.1', port: 0, discoveryPort: 47391, codes: ['1234', '5555', '7777'], onEvent: (e) => events.push(e),
    });
    check('host starts with a 4-digit code', /^\d{4}$/.test(host.code) && host.port > 0);

    const found = await discover({ targets: ['127.0.0.1'], port: 47391, timeoutMs: 800 });
    check('discovery finds the host with name and piece count', found.length === 1 && found[0].name === 'Testgerät' && found[0].pieces === 3 && found[0].port === host.port,
      JSON.stringify(found));

    // ---------- wrong codes ----------
    const target = { address: '127.0.0.1', port: host.port, name: 'Empfänger' };
    check('wrong code is refused', (await errCode(connect({ ...target, code: '0000' }))) === 'code');
    await errCode(connect({ ...target, code: '0001' }));
    await errCode(connect({ ...target, code: '0002' }));
    await new Promise((r) => setTimeout(r, 50));
    check('after 3 wrong codes there is a new one', events.filter((e) => e.type === 'wrongCode').length === 3 && events.some((e) => e.type === 'newCode' && e.code === '5555') && host.code === '5555');
    check('the old code no longer works', (await errCode(connect({ ...target, code: '1234' }))) === 'code');

    // ---------- transfer ----------
    const s = await connect({ ...target, code: '5555' });
    check('right code connects', s.hostName === 'Testgerät');
    check('a second receiver meanwhile hears "busy"', (await errCode(connect({ ...target, code: '5555' }))) === 'busy');
    const manifest = await s.manifest();
    check('manifest: library, annotations, file list', JSON.parse(manifest.db).pieces.length === 3 && manifest.ann.p1 && manifest.files.length === 3 && manifest.app === '9.9.9');
    const recvDir = path.join(tmp, 'recv');
    const recvPaths = pathsOf(recvDir);
    const progress = [];
    await s.download(['aaaa1111.pdf', 'bbbb2222.png'], recvPaths.filesDir, (p) => progress.push(p));
    check('files arrive intact (also larger than one chunk)', sha(path.join(recvPaths.filesDir, 'aaaa1111.pdf')) === sha(path.join(hostPaths.filesDir, 'aaaa1111.pdf'))
      && sha(path.join(recvPaths.filesDir, 'bbbb2222.png')) === sha(path.join(hostPaths.filesDir, 'bbbb2222.png')) && !fs.readdirSync(recvPaths.filesDir).some((f) => f.endsWith('.part')));
    check('download reports progress', progress.length > 2 && progress[progress.length - 1].file === 2);
    check('asking for files outside the library is refused', (await errCode(s.download(['../notenpult.json'], recvPaths.filesDir))) === 'protocol');
    await s.close(true);
    await new Promise((r) => setTimeout(r, 100));
    check('host reports the finished transfer and renews the code', events.some((e) => e.type === 'done' && e.ok && e.files === 2) && host.code === '7777');
    host.stop();

    // ---------- tampering ----------
    const frames = [];
    const key = crypto.randomBytes(32);
    const a = new Channel({ send: async (b) => frames.push(b) }, key, key);
    const b = new Channel({ recv: async () => frames.shift() }, key, key);
    await a.sendJson({ t: 'manifest' });
    frames[0][3] ^= 1;
    check('changed bytes on the way are detected', (await errCode(b.recv())) === 'protocol');

    // ---------- plan ----------
    const { planReceive } = await import('../renderer/js/lan-plan.js');
    const local = {
      version: 2,
      pieces: [piece('p2', 'Polka (alt)', ['bbbb2222.png']), piece('x1', 'Eigenes Stück', ['xxxx9999.pdf'])],
      setlists: [{ id: 'mine', name: 'Meine', entries: [] }],
      genres: [{ name: 'marsch' }, { name: 'Polka' }],
      settings: { theme: 'light' },
    };
    const have = { 'bbbb2222.png': 1000, 'xxxx9999.pdf': 10, 'aaaa1111.pdf': 1 /* broken copy */ };
    const mirror = planReceive({
      local, host: manifest, mode: 'mirror', localFiles: have,
    });
    check('mirror: library and settings of the host, only missing or different files', mirror.db.pieces.length === 3 && mirror.db.settings.theme === 'dark'
      && mirror.download.sort().join() === 'aaaa1111.pdf,cccc3333.pdf' && mirror.keep.length === 3 && !mirror.keep.includes('xxxx9999.pdf'), mirror.download.join());
    const add = planReceive({
      local, host: manifest, mode: 'add', localFiles: have,
    });
    check('add: own pieces stay, same id takes the host version, settings stay', add.db.pieces.length === 4 && add.db.pieces.find((p) => p.id === 'p2').title === 'Polka'
      && add.db.pieces.some((p) => p.id === 'x1') && add.db.settings.theme === 'light' && add.db.setlists.length === 2 && add.keep.includes('xxxx9999.pdf'));
    check('add: genres merged by name', add.db.genres.length === 2);

    // ---------- applying ----------
    write(path.join(recvPaths.filesDir, 'cccc3333.pdf'), fs.readFileSync(path.join(hostPaths.filesDir, 'cccc3333.pdf')));
    write(path.join(recvPaths.filesDir, 'xxxx9999.pdf'), 'eigen');
    write(recvPaths.dbFile, JSON.stringify(local));
    write(path.join(recvPaths.annDir, 'x1.json'), '{"pages":{}}');
    const before = fs.readFileSync(recvPaths.dbFile, 'utf8');
    check('missing sheet file: nothing is changed', (await errCode(applyReceive(recvPaths, {
      db: JSON.stringify(mirror.db), ann: {}, keep: [...mirror.keep, 'fehlt0000.pdf'], mode: 'mirror',
    }))) !== 'ok' && fs.readFileSync(recvPaths.dbFile, 'utf8') === before && fs.existsSync(path.join(recvPaths.filesDir, 'xxxx9999.pdf')));
    await applyReceive(recvPaths, {
      db: JSON.stringify(mirror.db), ann: mirror.ann, keep: mirror.keep, mode: 'mirror',
    });
    const backup = path.join(recvDir, '_vor-abgleich');
    check('mirror applied: library, annotations, unused files moved to _vor-abgleich', JSON.parse(fs.readFileSync(recvPaths.dbFile, 'utf8')).pieces.length === 3
      && fs.existsSync(path.join(recvPaths.annDir, 'p1.json')) && !fs.existsSync(path.join(recvPaths.annDir, 'x1.json'))
      && !fs.existsSync(path.join(recvPaths.filesDir, 'xxxx9999.pdf')) && fs.existsSync(path.join(backup, 'Noten', 'xxxx9999.pdf'))
      && JSON.parse(fs.readFileSync(path.join(backup, 'notenpult.json'), 'utf8')).pieces.length === 2);
    check('localFiles lists sizes', (await localFiles(recvPaths.filesDir))['cccc3333.pdf'] === 5000);
  } catch (err) {
    console.log(`FAIL ${err && err.stack ? err.stack : err}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(0);
})();
