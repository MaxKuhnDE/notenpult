'use strict';

// Receiver side of "Im WLAN teilen" (see protocol.js): find hosts, connect with the code,
// read the manifest, download missing sheet files, then apply.js writes the library.

const dgram = require('dgram');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const {
  VERSION, DISCOVERY_PORT, TCP_PORT, SAFE_FILE, LanError, Wire, clientHandshake,
} = require('./protocol');

const fsp = fs.promises;

/** Broadcast addresses of all IPv4 networks of this device (plus the general one). */
function broadcastTargets() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b & mask[i]) | (~mask[i] & 255)).join('.'));
    }
  }
  return [...out];
}

/** Looks for sharing hosts; resolves to [{ name, address, port, app, pieces, busy }]. */
function discover({ timeoutMs = 2500, targets = broadcastTargets(), port = DISCOVERY_PORT } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket('udp4');
    const ask = Buffer.from(JSON.stringify({ np: 'discover', v: VERSION }));
    const timers = [];
    const finish = () => {
      timers.forEach(clearTimeout);
      try {
        sock.close();
      } catch { /* closed */ }
      resolve([...found.values()].sort((a, b) => a.name.localeCompare(b.name)));
    };
    sock.on('error', finish);
    sock.on('message', (msg, rinfo) => {
      try {
        const r = JSON.parse(msg.toString('utf8'));
        if (r.np !== 'host' || r.v !== VERSION) return;
        found.set(`${rinfo.address}:${r.port}`, {
          name: String(r.name || rinfo.address), address: rinfo.address, port: r.port, app: r.app, pieces: r.pieces, busy: !!r.busy,
        });
      } catch { /* not ours */ }
    });
    sock.bind(0, () => {
      sock.setBroadcast(true);
      const send = () => targets.forEach((t) => sock.send(ask, port, t, () => {}));
      [0, 700, 1400].forEach((ms) => timers.push(setTimeout(send, ms)));
      timers.push(setTimeout(finish, timeoutMs));
    });
  });
}

/** Connects and checks the code; resolves to a session. */
async function connect({
  address, port = TCP_PORT, code, name, timeoutMs = 10000,
}) {
  const socket = await new Promise((resolve, reject) => {
    const s = net.connect({ host: address, port });
    const t = setTimeout(() => {
      s.destroy();
      reject(new LanError('unreachable', 'Gerät nicht erreichbar'));
    }, timeoutMs);
    s.once('connect', () => {
      clearTimeout(t);
      resolve(s);
    });
    s.once('error', (err) => {
      clearTimeout(t);
      reject(new LanError('unreachable', err.message));
    });
  });
  socket.setNoDelay(true);
  socket.setTimeout(60000, () => socket.destroy());
  const wire = new Wire(socket);
  let channel;
  let hostName;
  try {
    ({ channel, hostName } = await clientHandshake(wire, String(code), name));
  } catch (err) {
    socket.destroy();
    throw err;
  }

  return {
    hostName,
    async manifest() {
      await channel.sendJson({ t: 'manifest' });
      return channel.recvJson();
    },
    /** Downloads into dir (".part" first, renamed when complete). */
    async download(names, dir, onProgress = () => {}) {
      await fsp.mkdir(dir, { recursive: true });
      let bytes = 0;
      for (let i = 0; i < names.length; i++) {
        const fileName = String(names[i]);
        if (!SAFE_FILE.test(fileName)) throw new LanError('protocol', `ungültiger Dateiname ${fileName}`);
        await channel.sendJson({ t: 'get', name: fileName });
        const head = await channel.recvJson();
        if (head.t !== 'file' || head.name !== fileName) throw new LanError('protocol');
        const part = path.join(dir, `${fileName}.part`);
        const out = fs.createWriteStream(part);
        let got = 0;
        try {
          while (got < head.size) {
            const m = await channel.recv();
            if (!m.data) throw new LanError('protocol');
            got += m.data.length;
            bytes += m.data.length;
            if (!out.write(m.data)) await new Promise((r) => out.once('drain', r));
            onProgress({ file: i, files: names.length, bytes });
          }
          await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
        } catch (err) {
          out.destroy();
          await fsp.rm(part, { force: true });
          throw err;
        }
        if (got !== head.size) throw new LanError('protocol', 'Datei unvollständig');
        await fsp.rename(part, path.join(dir, fileName));
        onProgress({ file: i + 1, files: names.length, bytes });
      }
    },
    async close(ok = false) {
      await channel.sendJson({ t: 'bye', ok }).catch(() => {});
      socket.end();
    },
    abort() {
      socket.destroy();
    },
  };
}

module.exports = { discover, connect, broadcastTargets };
