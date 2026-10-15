package io.github.maxkuhnde.notenpult;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.nio.charset.Charset;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * "Im WLAN teilen" – the wire format of lan/protocol.js (Windows); keep both in step,
 * LanTest checks them against each other. In short: UDP discovery, then TCP frames
 * (uint32 length + bytes); a SPAKE2 handshake in the RFC 3526 2048-bit group mixes the
 * 4-digit code into a Diffie-Hellman exchange; afterwards AES-256-GCM per frame.
 * Plain Java (org.json only), so it runs in unit tests.
 */
final class Lan {
    static final int VERSION = 1;
    static final int DISCOVERY_PORT = 47321;
    static final int TCP_PORT = 47322;
    static final int MAX_FRAME = 64 * 1024 * 1024;
    static final int CHUNK = 256 * 1024;
    static final Pattern SAFE_FILE = Pattern.compile("[A-Za-z0-9_-]{1,64}\\.[a-z0-9]{1,5}");
    static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    static final Charset UTF8 = Charset.forName("UTF-8");

    static final BigInteger P = new BigInteger(
            "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74"
                    + "020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437"
                    + "4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
                    + "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF05"
                    + "98DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB"
                    + "9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B"
                    + "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718"
                    + "3995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF", 16);
    static final BigInteger Q = P.subtract(BigInteger.ONE).shiftRight(1);
    static final BigInteger G = BigInteger.valueOf(2);
    static final int ELEMENT = 256;
    static final BigInteger M = hashToGroup("Notenpult SPAKE2 M");
    static final BigInteger N = hashToGroup("Notenpult SPAKE2 N");

    private static final SecureRandom RANDOM = new SecureRandom();

    private Lan() {
    }

    /** code: "code" | "busy" | "version" | "protocol" | "closed" | "missing" | "unreachable" | "empty". */
    static final class LanException extends IOException {
        final String code;

        LanException(String code) {
            this(code, code);
        }

        LanException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    // ---------- math ----------

    static byte[] sha(String algorithm, byte[]... parts) {
        try {
            MessageDigest d = MessageDigest.getInstance(algorithm);
            for (byte[] p : parts) d.update(p);
            return d.digest();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    static BigInteger hashToGroup(String label) {
        ByteArrayOutputStream blocks = new ByteArrayOutputStream();
        for (int i = 0; i < 5; i++) {
            byte[] b = sha("SHA-512", label.getBytes(UTF8), new byte[]{(byte) i});
            blocks.write(b, 0, b.length);
        }
        return new BigInteger(1, blocks.toByteArray()).mod(P).modPow(BigInteger.valueOf(2), P);
    }

    static BigInteger codeScalar(String code) {
        return new BigInteger(1, sha("SHA-256", ("Notenpult SPAKE2 w " + code).getBytes(UTF8))).mod(Q);
    }

    static BigInteger randomScalar() {
        for (;;) {
            byte[] b = new byte[32];
            RANDOM.nextBytes(b);
            BigInteger x = new BigInteger(1, b).mod(Q);
            if (x.compareTo(BigInteger.ONE) > 0) return x;
        }
    }

    static void checkElement(BigInteger v) throws LanException {
        if (v.compareTo(BigInteger.ONE) <= 0 || v.compareTo(P.subtract(BigInteger.ONE)) >= 0 || !v.modPow(Q, P).equals(BigInteger.ONE)) {
            throw new LanException("protocol", "ungültiger Schlüssel");
        }
    }

    static byte[] toBytes(BigInteger n, int len) {
        byte[] raw = n.toByteArray();
        byte[] out = new byte[len];
        int copy = Math.min(raw.length, len);
        System.arraycopy(raw, raw.length - copy, out, len - copy, copy);
        return out;
    }

    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) {
            sb.append(Character.forDigit((x >> 4) & 15, 16)).append(Character.forDigit(x & 15, 16));
        }
        return sb.toString();
    }

    static byte[] unhex(String s) {
        if (s == null || s.length() % 2 != 0) return new byte[0];
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = Character.digit(s.charAt(2 * i), 16);
            int lo = Character.digit(s.charAt(2 * i + 1), 16);
            if (hi < 0 || lo < 0) return new byte[0];
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }

    static final class Keys {
        byte[] confirmHost;
        byte[] confirmClient;
        byte[] hostToClient;
        byte[] clientToHost;
    }

    static Keys deriveKeys(BigInteger t, BigInteger s, BigInteger k, BigInteger w) {
        ByteArrayOutputStream transcript = new ByteArrayOutputStream();
        byte[][] parts = {"Notenpult LAN 1".getBytes(UTF8), toBytes(t, ELEMENT), toBytes(s, ELEMENT), toBytes(k, ELEMENT), toBytes(w, 32)};
        for (byte[] p : parts) {
            transcript.write(p.length >>> 24);
            transcript.write(p.length >>> 16);
            transcript.write(p.length >>> 8);
            transcript.write(p.length);
            transcript.write(p, 0, p.length);
        }
        byte[] tt = sha("SHA-256", transcript.toByteArray());
        Keys keys = new Keys();
        keys.confirmHost = hmac(tt, "confirm host");
        keys.confirmClient = hmac(tt, "confirm client");
        keys.hostToClient = hmac(tt, "key host to client");
        keys.clientToHost = hmac(tt, "key client to host");
        return keys;
    }

    static byte[] hmac(byte[] key, String label) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(label.getBytes(UTF8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    static JSONObject json(Object... kv) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        return o;
    }

    // ---------- frames ----------

    /** Length-prefixed frames on a socket. */
    static final class Wire {
        private final DataInputStream in;
        private final DataOutputStream out;

        Wire(InputStream in, OutputStream out) {
            this.in = new DataInputStream(in);
            this.out = new DataOutputStream(out);
        }

        byte[] recv() throws IOException {
            int len;
            try {
                len = in.readInt();
            } catch (EOFException e) {
                throw new LanException("closed", "Verbindung getrennt");
            }
            if (len < 0 || len > MAX_FRAME) throw new LanException("protocol", "Datenblock zu groß");
            byte[] b = new byte[len];
            in.readFully(b);
            return b;
        }

        synchronized void send(byte[] payload) throws IOException {
            out.writeInt(payload.length);
            out.write(payload);
            out.flush();
        }

        void sendJson(JSONObject o) throws IOException {
            send(o.toString().getBytes(UTF8));
        }

        JSONObject recvJson() throws IOException {
            try {
                return new JSONObject(new String(recv(), UTF8));
            } catch (JSONException e) {
                throw new LanException("protocol", "unlesbare Antwort");
            }
        }
    }

    static final class Message {
        final JSONObject json;
        final byte[] data;

        Message(JSONObject json, byte[] data) {
            this.json = json;
            this.data = data;
        }
    }

    /** AES-256-GCM frames after the handshake; nonce = 4 zero bytes + 64-bit counter. */
    static final class Channel {
        private final Wire wire;
        private final SecretKeySpec sendKey;
        private final SecretKeySpec recvKey;
        private long sendCounter;
        private long recvCounter;

        Channel(Wire wire, byte[] sendKey, byte[] recvKey) {
            this.wire = wire;
            this.sendKey = new SecretKeySpec(sendKey, "AES");
            this.recvKey = new SecretKeySpec(recvKey, "AES");
        }

        static byte[] nonce(long n) {
            byte[] b = new byte[12];
            for (int i = 0; i < 8; i++) b[4 + i] = (byte) (n >>> (56 - 8 * i));
            return b;
        }

        synchronized void send(int type, byte[] payload, int off, int len) throws IOException {
            byte[] plain = new byte[len + 1];
            plain[0] = (byte) type;
            System.arraycopy(payload, off, plain, 1, len);
            try {
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.ENCRYPT_MODE, sendKey, new GCMParameterSpec(128, nonce(sendCounter++)));
                wire.send(c.doFinal(plain)); // ciphertext + 16-byte tag, as in Node
            } catch (GeneralSecurityException e) {
                throw new IOException("Verschlüsselung nicht verfügbar: " + e.getMessage());
            }
        }

        void sendJson(JSONObject o) throws IOException {
            byte[] b = o.toString().getBytes(UTF8);
            send(1, b, 0, b.length);
        }

        Message recv() throws IOException {
            byte[] f = wire.recv();
            if (f.length < 17) throw new LanException("protocol", "Datenblock zu kurz");
            byte[] plain;
            try {
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE, recvKey, new GCMParameterSpec(128, nonce(recvCounter++)));
                plain = c.doFinal(f);
            } catch (GeneralSecurityException e) {
                throw new LanException("protocol", "Daten wurden unterwegs verändert");
            }
            if (plain[0] == 1) {
                try {
                    return new Message(new JSONObject(new String(plain, 1, plain.length - 1, UTF8)), null);
                } catch (JSONException e) {
                    throw new LanException("protocol", "unlesbare Antwort");
                }
            }
            byte[] data = new byte[plain.length - 1];
            System.arraycopy(plain, 1, data, 0, data.length);
            return new Message(null, data);
        }

        JSONObject recvJson() throws IOException {
            Message m = recv();
            if (m.json == null) throw new LanException("protocol", "unerwartete Daten");
            if ("error".equals(m.json.optString("t"))) throw new LanException(m.json.optString("error", "protocol"));
            return m.json;
        }
    }

    // ---------- handshake (SPAKE2) ----------

    static final class Connected {
        final Channel channel;
        final String peerName;

        Connected(Channel channel, String peerName) {
            this.channel = channel;
            this.peerName = peerName;
        }
    }

    static Connected clientHandshake(Wire wire, String code, String name) throws IOException {
        BigInteger w = codeScalar(code);
        BigInteger x = randomScalar();
        BigInteger t = G.modPow(x, P).multiply(M.modPow(w, P)).mod(P);
        wire.sendJson(json("t", "hello", "v", VERSION, "name", name, "T", hex(toBytes(t, ELEMENT))));
        JSONObject r = wire.recvJson();
        if ("error".equals(r.optString("t"))) throw new LanException(r.optString("error", "protocol"));
        if (!"hello".equals(r.optString("t")) || r.optInt("v") != VERSION) throw new LanException("version");
        BigInteger s = new BigInteger(1, unhex(r.optString("S")));
        checkElement(s);
        BigInteger k = s.multiply(N.modPow(Q.subtract(w), P)).mod(P).modPow(x, P);
        Keys keys = deriveKeys(t, s, k, w);
        if (!MessageDigest.isEqual(unhex(r.optString("c")), keys.confirmHost)) {
            try {
                wire.sendJson(json("t", "error", "error", "code"));
            } catch (IOException ignored) {
                // the host may already be gone
            }
            throw new LanException("code");
        }
        wire.sendJson(json("t", "confirm", "c", hex(keys.confirmClient)));
        JSONObject ok = wire.recvJson();
        if (!"ok".equals(ok.optString("t"))) throw new LanException(ok.optString("error", "code"));
        return new Connected(new Channel(wire, keys.clientToHost, keys.hostToClient), r.optString("name"));
    }

    static Connected hostHandshake(Wire wire, String code, String name) throws IOException {
        JSONObject h = wire.recvJson();
        if (!"hello".equals(h.optString("t")) || h.optInt("v") != VERSION) {
            try {
                wire.sendJson(json("t", "error", "error", "version"));
            } catch (IOException ignored) {
                // the receiver may already be gone
            }
            throw new LanException("version");
        }
        BigInteger t = new BigInteger(1, unhex(h.optString("T")));
        checkElement(t);
        BigInteger w = codeScalar(code);
        BigInteger y = randomScalar();
        BigInteger s = G.modPow(y, P).multiply(N.modPow(w, P)).mod(P);
        BigInteger k = t.multiply(M.modPow(Q.subtract(w), P)).mod(P).modPow(y, P);
        Keys keys = deriveKeys(t, s, k, w);
        wire.sendJson(json("t", "hello", "v", VERSION, "name", name, "S", hex(toBytes(s, ELEMENT)), "c", hex(keys.confirmHost)));
        JSONObject c = wire.recvJson();
        if (!"confirm".equals(c.optString("t")) || !MessageDigest.isEqual(unhex(c.optString("c")), keys.confirmClient)) {
            try {
                wire.sendJson(json("t", "error", "error", "code"));
            } catch (IOException ignored) {
                // the receiver may already be gone
            }
            throw new LanException("code");
        }
        wire.sendJson(json("t", "ok"));
        return new Connected(new Channel(wire, keys.hostToClient, keys.clientToHost), h.optString("name"));
    }

    static String newCode() {
        return String.format(java.util.Locale.ROOT, "%04d", RANDOM.nextInt(10000));
    }
}
