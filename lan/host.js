'use strict';

// Host side of "Im WLAN teilen" (see protocol.js): answers discovery broadcasts and serves
// the library – read-only – to one receiver at a time. Each code works for one receiver;
// after a finished transfer or 3 wrong attempts there is a new one.

const dgram = require('dgram');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const {
  VERSION, DISCOVERY_PORT, TCP_PORT, CHUNK, SAFE_FILE, SAFE_ID, LanError, Wire, hostHandshake, newCode,
} = require('./protocol');

const fsp = fs.promises;
const MAX_ATTEMPTS = 3;

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

async function readManifest(paths, name, app) {
  const db = await fsp.readFile(paths.dbFile, 'utf8').catch(() => null);
  if (!db) throw new LanError('empty', 'Auf diesem Gerät gibt es noch keine Noten.');
  const ann = {};
  for (const f of await fsp.readdir(paths.annDir).catch(() => [])) {
    const id = f.replace(/\.json$/, '');
    if (f.endsWith('.json') && SAFE_ID.test(id)) ann[id] = await fsp.readFile(path.join(paths.annDir, f), 'utf8');
  }
  const files = [];
  for (const f of await fsp.readdir(paths.filesDir).catch(() => [])) {
    if (!SAFE_FILE.test(f)) continue;
    const st = await fsp.stat(path.join(paths.filesDir, f)).catch(() => null);
    if (st && st.isFile()) files.push([f, st.size]);
  }
  return { t: 'manifest', name, app, db, ann, files };
}

/**
 * Starts sharing. paths: { dbFile, filesDir, annDir }; onEvent gets
 * { type: 'connected'|'wrongCode'|'newCode'|'progress'|'done'|'error', … }.
 * Resolves to { code, port, addresses, name, stop() }.
 */
async function startHost({
  paths, name, app, bind = '0.0.0.0', port = TCP_PORT, discoveryPort = DISCOVERY_PORT, onEvent = () => {},
  codes = null, // tests: fixed codes to hand out first
}) {
  const nextCode = () => (codes && codes.length ? codes.shift() : newCode());
  let code = nextCode();
  let attempts = 0;
  let active = null; // socket of the current receiver
  let pieces = 0;
  try {
    pieces = (JSON.parse(await fsp.readFile(paths.dbFile, 'utf8')).pieces || []).length;
  } catch { /* empty library */ }

  const renew = () => {
    code = nextCode();
    attempts = 0;
    onEvent({ type: 'newCode', code });
  };

  async function serve(socket) {
    const wire = new Wire(socket);
    let channel;
    let clientName = '';
    try {
      ({ channel, clientName } = await hostHandshake(wire, code, name));
    } catch (err) {
      if (err.code === 'code') {
        attempts += 1;
        onEvent({ type: 'wrongCode', attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) });
        if (attempts >= MAX_ATTEMPTS) renew();
      }
      return;
    }
    onEvent({ type: 'connected', name: clientName });
    let sentFiles = 0;
    let sentBytes = 0;
    for (;;) {
      const msg = await channel.recvJson();
      if (msg.t === 'manifest') {
        const manifest = await readManifest(paths, name, app);
        await channel.sendJson(manifest);
        onEvent({ type: 'progress', name: clientName, files: 0, total: null });
      } else if (msg.t === 'get') {
        const file = path.join(paths.filesDir, String(msg.name));
        const st = SAFE_FILE.test(String(msg.name)) ? await fsp.stat(file).catch(() => null) : null;
        if (!st || !st.isFile()) {
          await channel.sendJson({ t: 'error', error: 'missing' });
          continue;
        }
        await channel.sendJson({ t: 'file', name: msg.name, size: st.size });
        for await (const chunk of fs.createReadStream(file, { highWaterMark: CHUNK })) {
          await channel.send(2, chunk);
          sentBytes += chunk.length;
        }
        sentFiles += 1;
        onEvent({ type: 'progress', name: clientName, files: sentFiles, bytes: sentBytes });
      } else if (msg.t === 'bye') {
        onEvent({
          type: 'done', name: clientName, files: sentFiles, bytes: sentBytes, ok: !!msg.ok,
        });
        renew(); // one code, one receiver
        return;
      } else {
        throw new LanError('protocol');
      }
    }
  }

  const server = net.createServer((socket) => {
    if (active) {
      // Someone else is already connected: say so in plain text and close.
      new Wire(socket).sendJson({ t: 'error', error: 'busy' }).finally(() => socket.end());
      return;
    }
    active = socket;
    socket.setNoDelay(true);
    socket.setTimeout(60000, () => socket.destroy());
    serve(socket)
      .catch((err) => {
        if (err.code !== 'closed') onEvent({ type: 'error', message: err.message });
      })
      .finally(() => {
        if (active === socket) active = null;
        socket.destroy();
      });
  });
  const actualPort = await new Promise((resolve, reject) => {
    const tryListen = (p) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && p !== 0) tryListen(0);
        else reject(err);
      });
      server.listen(p, bind, () => resolve(server.address().port));
    };
    tryListen(port);
  });

  // Discovery: answer receivers looking for a host. Without it (port taken) the address
  // shown on screen still works.
  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('error', () => udp.close());
  udp.on('message', (msg, rinfo) => {
    let q;
    try {
      q = JSON.parse(msg.toString('utf8'));
    } catch {
      return;
    }
    if (q.np !== 'discover') return;
    const answer = Buffer.from(JSON.stringify({
      np: 'host', v: VERSION, name, port: actualPort, app, pieces, busy: !!active,
    }));
    udp.send(answer, rinfo.port, rinfo.address);
  });
  await new Promise((resolve) => {
    udp.once('listening', resolve);
    udp.once('error', resolve);
    try {
      udp.bind(discoveryPort, bind === '0.0.0.0' ? undefined : bind);
    } catch {
      resolve();
    }
  });

  return {
    get code() {
      return code;
    },
    port: actualPort,
    addresses: bind === '0.0.0.0' ? localAddresses() : [bind],
    name,
    stop() {
      try {
        udp.close();
      } catch { /* closed */ }
      server.close();
      if (active) active.destroy();
    },
  };
}

module.exports = { startHost, localAddresses, readManifest };
