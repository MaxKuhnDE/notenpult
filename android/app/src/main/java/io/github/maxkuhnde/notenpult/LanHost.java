package io.github.maxkuhnde.notenpult;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.BindException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Deque;

/**
 * Host side of "Im WLAN teilen" (lan/host.js on Windows): answers discovery broadcasts and
 * serves the library – read-only – to one receiver at a time. Each code works for one
 * receiver; after a finished transfer or 3 wrong attempts there is a new one.
 */
final class LanHost {
    interface Listener {
        void event(JSONObject e);
    }

    private static final int MAX_ATTEMPTS = 3;

    private final File dbFile;
    private final File sheetDir;
    private final File annDir;
    private final String name;
    private final String app;
    private final Listener listener;
    private final Deque<String> fixedCodes = new ArrayDeque<>();
    private ServerSocket server;
    private DatagramSocket udp;
    private volatile Socket active;
    private volatile boolean stopped;
    private String code;
    private int attempts;
    private int pieces;

    LanHost(File dataDir, String name, String app, Listener listener, String... codes) {
        this.dbFile = new File(dataDir, Preset.DB);
        this.sheetDir = new File(dataDir, "Noten");
        this.annDir = new File(dataDir, "Anmerkungen");
        this.name = name;
        this.app = app;
        this.listener = listener;
        fixedCodes.addAll(Arrays.asList(codes));
        this.code = nextCode();
    }

    private String nextCode() {
        return fixedCodes.isEmpty() ? Lan.newCode() : fixedCodes.poll();
    }

    synchronized String code() {
        return code;
    }

    private synchronized void renew() {
        code = nextCode();
        attempts = 0;
        listener.event(Lan.json("type", "newCode", "code", code));
    }

    private synchronized void wrongCode() {
        attempts++;
        listener.event(Lan.json("type", "wrongCode", "attemptsLeft", Math.max(0, MAX_ATTEMPTS - attempts)));
        if (attempts >= MAX_ATTEMPTS) renew();
    }

    /** Starts listening; returns the TCP port. bind == null: all networks. */
    int start(InetAddress bind, int port, int discoveryPort) throws IOException {
        try {
            JSONArray list = new JSONObject(readText(dbFile)).optJSONArray("pieces");
            pieces = list == null ? 0 : list.length();
        } catch (IOException | JSONException e) {
            pieces = 0;
        }
        server = new ServerSocket();
        server.setReuseAddress(true);
        try {
            server.bind(new InetSocketAddress(bind, port));
        } catch (BindException e) {
            server = new ServerSocket();
            server.bind(new InetSocketAddress(bind, 0));
        }
        final int tcpPort = server.getLocalPort();
        Thread accept = new Thread(() -> {
            while (!stopped) {
                final Socket s;
                try {
                    s = server.accept();
                } catch (IOException e) {
                    return; // stopped
                }
                if (active != null) {
                    new Thread(() -> busy(s), "lan-busy").start();
                    continue;
                }
                active = s;
                new Thread(() -> serve(s), "lan-serve").start();
            }
        }, "lan-accept");
        accept.setDaemon(true);
        accept.start();

        // Discovery: answer receivers looking for a host. Without it (port taken) the address
        // shown on screen still works.
        try {
            udp = new DatagramSocket(null);
            udp.setReuseAddress(true);
            udp.bind(new InetSocketAddress(bind, discoveryPort));
            Thread discovery = new Thread(() -> answerDiscovery(tcpPort), "lan-discovery");
            discovery.setDaemon(true);
            discovery.start();
        } catch (IOException e) {
            udp = null;
        }
        return tcpPort;
    }

    private void answerDiscovery(int tcpPort) {
        byte[] buf = new byte[2048];
        while (!stopped) {
            DatagramPacket p = new DatagramPacket(buf, buf.length);
            try {
                udp.receive(p);
                JSONObject q = new JSONObject(new String(p.getData(), 0, p.getLength(), Lan.UTF8));
                if (!"discover".equals(q.optString("np"))) continue;
                byte[] answer = Lan.json("np", "host", "v", Lan.VERSION, "name", name, "port", tcpPort, "app", app,
                        "pieces", pieces, "busy", active != null).toString().getBytes(Lan.UTF8);
                udp.send(new DatagramPacket(answer, answer.length, p.getAddress(), p.getPort()));
            } catch (JSONException e) {
                // not ours
            } catch (IOException e) {
                if (stopped) return;
            }
        }
    }

    private static void busy(Socket s) {
        try {
            // Read the receiver's hello first: closing with unread data resets the connection
            // and the answer would get lost.
            s.setSoTimeout(5000);
            Lan.Wire wire = new Lan.Wire(s.getInputStream(), s.getOutputStream());
            wire.recv();
            wire.sendJson(Lan.json("t", "error", "error", "busy"));
            s.shutdownOutput();
        } catch (IOException ignored) {
            // nothing to tell
        } finally {
            closeQuietly(s);
        }
    }

    private void serve(Socket s) {
        try {
            s.setSoTimeout(60000);
            s.setTcpNoDelay(true);
            Lan.Wire wire = new Lan.Wire(new BufferedInputStream(s.getInputStream(), 1 << 16), new BufferedOutputStream(s.getOutputStream(), 1 << 16));
            Lan.Connected c;
            try {
                c = Lan.hostHandshake(wire, code(), name);
            } catch (Lan.LanException e) {
                if ("code".equals(e.code)) wrongCode();
                return;
            }
            listener.event(Lan.json("type", "connected", "name", c.peerName));
            int files = 0;
            long bytes = 0;
            for (;;) {
                JSONObject m = c.channel.recvJson();
                String t = m.optString("t");
                if ("manifest".equals(t)) {
                    c.channel.sendJson(manifest());
                    listener.event(Lan.json("type", "progress", "name", c.peerName, "files", 0, "bytes", 0));
                } else if ("get".equals(t)) {
                    String fileName = m.optString("name");
                    File f = new File(sheetDir, fileName);
                    if (!Lan.SAFE_FILE.matcher(fileName).matches() || !f.isFile()) {
                        c.channel.sendJson(Lan.json("t", "error", "error", "missing"));
                        continue;
                    }
                    c.channel.sendJson(Lan.json("t", "file", "name", fileName, "size", f.length()));
                    byte[] buf = new byte[Lan.CHUNK];
                    try (InputStream in = new FileInputStream(f)) {
                        int n;
                        while ((n = readFully(in, buf)) > 0) {
                            c.channel.send(2, buf, 0, n);
                            bytes += n;
                        }
                    }
                    files++;
                    listener.event(Lan.json("type", "progress", "name", c.peerName, "files", files, "bytes", bytes));
                } else if ("bye".equals(t)) {
                    listener.event(Lan.json("type", "done", "name", c.peerName, "files", files, "bytes", bytes, "ok", m.optBoolean("ok")));
                    renew(); // one code, one receiver
                    return;
                } else {
                    throw new Lan.LanException("protocol");
                }
            }
        } catch (IOException e) {
            if (!stopped && !(e instanceof Lan.LanException && "closed".equals(((Lan.LanException) e).code))) {
                listener.event(Lan.json("type", "error", "message", String.valueOf(e.getMessage())));
            }
        } finally {
            if (active == s) active = null;
            closeQuietly(s);
        }
    }

    /** Fills buf as far as the file goes (so chunks are full-sized except the last). */
    private static int readFully(InputStream in, byte[] buf) throws IOException {
        int total = 0;
        while (total < buf.length) {
            int n = in.read(buf, total, buf.length - total);
            if (n < 0) break;
            total += n;
        }
        return total;
    }

    private JSONObject manifest() throws IOException {
        String db = readText(dbFile);
        try {
            JSONObject ann = new JSONObject();
            File[] annFiles = annDir.listFiles();
            if (annFiles != null) {
                for (File f : annFiles) {
                    String id = f.getName().replaceAll("\\.json$", "");
                    if (f.getName().endsWith(".json") && Lan.SAFE_ID.matcher(id).matches()) ann.put(id, readText(f));
                }
            }
            JSONArray files = new JSONArray();
            File[] sheets = sheetDir.listFiles();
            if (sheets != null) {
                for (File f : sheets) {
                    if (f.isFile() && Lan.SAFE_FILE.matcher(f.getName()).matches()) files.put(new JSONArray().put(f.getName()).put(f.length()));
                }
            }
            return Lan.json("t", "manifest", "name", name, "app", app, "db", db, "ann", ann, "files", files);
        } catch (JSONException e) {
            throw new IOException(e.getMessage());
        }
    }

    void stop() {
        stopped = true;
        try {
            if (server != null) server.close();
        } catch (IOException ignored) {
            // closing anyway
        }
        if (udp != null) udp.close();
        Socket s = active;
        if (s != null) closeQuietly(s);
    }

    static String readText(File f) throws IOException {
        if (!f.isFile()) throw new Lan.LanException("empty", "Auf diesem Gerät gibt es noch keine Noten.");
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.max(16, f.length()));
            Preset.copy(in, out);
            return out.toString("UTF-8");
        }
    }

    private static void closeQuietly(Socket s) {
        try {
            s.close();
        } catch (IOException ignored) {
            // closed
        }
    }
}
