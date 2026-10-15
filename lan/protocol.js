'use strict';

// "Im WLAN teilen": one-way transfer of the library from a host to a receiver in the same
// network (also a phone hotspot). Implemented twice – here (Windows) and in
// android/…/Lan.java – with the same wire format; keep both in step (test: LanTest.java
// runs against this code).
//
//   discovery  UDP 47321: receiver broadcasts {"np":"discover","v":1}, a sharing host answers
//              {"np":"host","v":1,"name","port","app","pieces"}
//   connection TCP (47322 by default); every frame = uint32 big-endian length + bytes
//   handshake  plain JSON frames, SPAKE2 in the RFC 3526 2048-bit group: a Diffie-Hellman
//              exchange with the 4-digit code mixed in. Listening in reveals nothing, and a
//              wrong guess costs a whole connection (the host makes a new code after 3).
//                receiver → {"t":"hello","v":1,"name","T"}
//                host     → {"t":"hello","v":1,"name","S","c"}  (c = host's key confirmation)
//                receiver → {"t":"confirm","c"}  or {"t":"error","error":"code"}
//                host     → {"t":"ok"}           or {"t":"error","error":"code"|"busy"|"version"}
//   afterwards AES-256-GCM per frame, nonce = 4 zero bytes + 64-bit counter per direction;
//              plaintext = 1 type byte (1 = JSON, 2 = data) + payload
//                {"t":"manifest"} → {"t":"manifest","name","app","db","ann":{id:text},"files":[[name,size]]}
//                {"t":"get","name"} → {"t":"file","name","size"} + data frames | {"t":"error","error":"missing"}
//                {"t":"bye"}

const crypto = require('crypto');

const VERSION = 1;
const DISCOVERY_PORT = 47321;
const TCP_PORT = 47322;
const MAX_FRAME = 64 * 1024 * 1024;
const CHUNK = 256 * 1024;
const SAFE_FILE = /^[A-Za-z0-9_-]{1,64}\.[a-z0-9]{1,5}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

// RFC 3526 group 14 (2048-bit MODP); 2 generates the subgroup of prime order Q.
const P = BigInt(`0x${[
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74',
  '020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437',
  '4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED',
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF05',
  '98DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB',
  '9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B',
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718',
  '3995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF',
].join('')}`);
const Q = (P - 1n) / 2n;
const G = 2n;
const ELEMENT = 256; // bytes

class LanError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // 'code' | 'busy' | 'version' | 'protocol' | 'closed' | 'missing'
  }
}

function modPow(base, exp, mod) {
  let r = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return r;
}

const toBytes = (n, len = ELEMENT) => Buffer.from(n.toString(16).padStart(len * 2, '0'), 'hex');
const toBig = (buf) => (buf.length ? BigInt(`0x${buf.toString('hex')}`) : 0n);
const sha256 = (...parts) => {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

/** A group element nobody knows the discrete logarithm of (SPAKE2's M and N). */
function hashToGroup(label) {
  const blocks = [];
  for (let i = 0; i < 5; i++) blocks.push(crypto.createHash('sha512').update(label, 'utf8').update(Buffer.from([i])).digest());
  return modPow(toBig(Buffer.concat(blocks)) % P, 2n, P);
}
const M = hashToGroup('Notenpult SPAKE2 M');
const N = hashToGroup('Notenpult SPAKE2 N');

const codeScalar = (code) => toBig(sha256(Buffer.from(`Notenpult SPAKE2 w ${code}`, 'utf8'))) % Q;

function randomScalar() {
  for (;;) {
    const x = toBig(crypto.randomBytes(32)) % Q;
    if (x > 1n) return x;
  }
}

function checkElement(v) {
  if (v <= 1n || v >= P - 1n || modPow(v, Q, P) !== 1n) throw new LanError('protocol', 'ungültiger Schlüssel');
}

/** Session keys from the SPAKE2 transcript. */
function deriveKeys(T, S, K, w) {
  const h = crypto.createHash('sha256');
  for (const part of [Buffer.from('Notenpult LAN 1', 'utf8'), toBytes(T), toBytes(S), toBytes(K), toBytes(w, 32)]) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(part.length);
    h.update(len);
    h.update(part);
  }
  const tt = h.digest();
  const mac = (label) => crypto.createHmac('sha256', tt).update(label, 'utf8').digest();
  return {
    confirmHost: mac('confirm host'),
    confirmClient: mac('confirm client'),
    hostToClient: mac('key host to client'),
    clientToHost: mac('key client to host'),
  };
}

const sameBytes = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
const hexBuf = (s) => Buffer.from(typeof s === 'string' && /^[0-9a-f]*$/i.test(s) ? s : '', 'hex');

/** Length-prefixed frames on a socket. */
class Wire {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frames = [];
    this.waiters = [];
    this.error = null;
    socket.on('data', (d) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
      this.pump();
    });
    socket.on('close', () => this.fail(new LanError('closed', 'Verbindung getrennt')));
    socket.on('error', (err) => this.fail(err));
  }

  pump() {
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (len > MAX_FRAME) {
        this.fail(new LanError('protocol', 'Datenblock zu groß'));
        this.socket.destroy();
        return;
      }
      if (this.buf.length < 4 + len) return;
      const frame = Buffer.from(this.buf.subarray(4, 4 + len));
      this.buf = this.buf.subarray(4 + len);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(frame);
      else this.frames.push(frame);
    }
  }

  fail(err) {
    if (!this.error) this.error = err;
    for (const w of this.waiters.splice(0)) w.reject(this.error);
  }

  recv() {
    if (this.frames.length) return Promise.resolve(this.frames.shift());
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  send(payload) {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(payload.length);
    const ok = this.socket.write(Buffer.concat([head, payload]));
    if (ok) return Promise.resolve();
    return new Promise((resolve) => this.socket.once('drain', resolve));
  }

  sendJson(obj) {
    return this.send(Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  async recvJson() {
    const f = await this.recv();
    try {
      return JSON.parse(f.toString('utf8'));
    } catch {
      throw new LanError('protocol', 'unlesbare Antwort');
    }
  }
}

/** AES-256-GCM frames after the handshake. */
class Channel {
  constructor(wire, sendKey, recvKey) {
    this.wire = wire;
    this.sendKey = sendKey;
    this.recvKey = recvKey;
    this.sendCounter = 0n;
    this.recvCounter = 0n;
  }

  static nonce(n) {
    const b = Buffer.alloc(12);
    b.writeBigUInt64BE(n, 4);
    return b;
  }

  send(type, payload) {
    const c = crypto.createCipheriv('aes-256-gcm', this.sendKey, Channel.nonce(this.sendCounter++));
    const body = Buffer.concat([c.update(Buffer.from([type])), c.update(payload), c.final(), c.getAuthTag()]);
    return this.wire.send(body);
  }

  sendJson(obj) {
    return this.send(1, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  async recv() {
    const f = await this.wire.recv();
    if (f.length < 17) throw new LanError('protocol', 'Datenblock zu kurz');
    const d = crypto.createDecipheriv('aes-256-gcm', this.recvKey, Channel.nonce(this.recvCounter++));
    d.setAuthTag(f.subarray(f.length - 16));
    let plain;
    try {
      plain = Buffer.concat([d.update(f.subarray(0, f.length - 16)), d.final()]);
    } catch {
      throw new LanError('protocol', 'Daten wurden unterwegs verändert');
    }
    if (plain[0] === 1) return { json: JSON.parse(plain.subarray(1).toString('utf8')) };
    return { data: plain.subarray(1) };
  }

  async recvJson() {
    const m = await this.recv();
    if (!m.json) throw new LanError('protocol', 'unerwartete Daten');
    if (m.json.t === 'error') throw new LanError(m.json.error || 'protocol');
    return m.json;
  }
}

/** Receiver side of the handshake; returns { channel, hostName }. */
async function clientHandshake(wire, code, name) {
  const w = codeScalar(code);
  const x = randomScalar();
  const T = (modPow(G, x, P) * modPow(M, w, P)) % P;
  await wire.sendJson({ t: 'hello', v: VERSION, name, T: toBytes(T).toString('hex') });
  const r = await wire.recvJson();
  if (r.t === 'error') throw new LanError(r.error || 'protocol');
  if (r.t !== 'hello' || r.v !== VERSION) throw new LanError('version');
  const S = toBig(hexBuf(r.S));
  checkElement(S);
  const K = modPow((S * modPow(N, Q - w, P)) % P, x, P);
  const keys = deriveKeys(T, S, K, w);
  if (!sameBytes(hexBuf(r.c), keys.confirmHost)) {
    await wire.sendJson({ t: 'error', error: 'code' }).catch(() => {});
    throw new LanError('code');
  }
  await wire.sendJson({ t: 'confirm', c: keys.confirmClient.toString('hex') });
  const ok = await wire.recvJson();
  if (ok.t !== 'ok') throw new LanError(ok.error || 'code');
  return { channel: new Channel(wire, keys.clientToHost, keys.hostToClient), hostName: String(r.name || '') };
}

/** Host side of the handshake; returns { channel, clientName }. */
async function hostHandshake(wire, code, name) {
  const h = await wire.recvJson();
  if (h.t !== 'hello' || h.v !== VERSION) {
    await wire.sendJson({ t: 'error', error: 'version' }).catch(() => {});
    throw new LanError('version');
  }
  const T = toBig(hexBuf(h.T));
  checkElement(T);
  const w = codeScalar(code);
  const y = randomScalar();
  const S = (modPow(G, y, P) * modPow(N, w, P)) % P;
  const K = modPow((T * modPow(M, Q - w, P)) % P, y, P);
  const keys = deriveKeys(T, S, K, w);
  await wire.sendJson({ t: 'hello', v: VERSION, name, S: toBytes(S).toString('hex'), c: keys.confirmHost.toString('hex') });
  const c = await wire.recvJson();
  if (c.t !== 'confirm' || !sameBytes(hexBuf(c.c), keys.confirmClient)) {
    await wire.sendJson({ t: 'error', error: 'code' }).catch(() => {});
    throw new LanError('code');
  }
  await wire.sendJson({ t: 'ok' });
  return { channel: new Channel(wire, keys.hostToClient, keys.clientToHost), clientName: String(h.name || '') };
}

const newCode = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

module.exports = {
  VERSION,
  DISCOVERY_PORT,
  TCP_PORT,
  CHUNK,
  SAFE_FILE,
  SAFE_ID,
  P,
  Q,
  M,
  N,
  LanError,
  Wire,
  Channel,
  clientHandshake,
  hostHandshake,
  codeScalar,
  deriveKeys,
  modPow,
  newCode,
};
