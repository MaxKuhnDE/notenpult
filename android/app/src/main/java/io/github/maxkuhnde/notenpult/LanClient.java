package io.github.maxkuhnde.notenpult;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Receiver side of "Im WLAN teilen" (lan/client.js on Windows): find hosts, connect with the
 * code, read the manifest, download missing sheet files. LanApply writes the library.
 */
final class LanClient {
    interface Progress {
        void update(int file, int files, long bytes);
    }

    private LanClient() {
    }

    /** Broadcast addresses of all IPv4 networks (plus the general one). */
    static List<InetAddress> broadcastTargets() {
        List<InetAddress> out = new ArrayList<>();
        try {
            out.add(InetAddress.getByName("255.255.255.255"));
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress a : ni.getInterfaceAddresses()) {
                    if (a.getBroadcast() != null && !out.contains(a.getBroadcast())) out.add(a.getBroadcast());
                }
            }
        } catch (IOException ignored) {
            // the general broadcast address is enough
        }
        return out;
    }

    /** Looks for sharing hosts; each result: { name, address, port, app, pieces, busy }. */
    static List<JSONObject> discover(int timeoutMs, int port, List<InetAddress> targets) {
        Map<String, JSONObject> found = new LinkedHashMap<>();
        byte[] ask = Lan.json("np", "discover", "v", Lan.VERSION).toString().getBytes(Lan.UTF8);
        try (DatagramSocket sock = new DatagramSocket()) {
            sock.setBroadcast(true);
            sock.setSoTimeout(150);
            long end = System.currentTimeMillis() + timeoutMs;
            long nextAsk = 0;
            byte[] buf = new byte[2048];
            while (System.currentTimeMillis() < end) {
                if (System.currentTimeMillis() >= nextAsk) {
                    for (InetAddress t : targets) {
                        try {
                            sock.send(new DatagramPacket(ask, ask.length, t, port));
                        } catch (IOException ignored) {
                            // a network without broadcast
                        }
                    }
                    nextAsk = System.currentTimeMillis() + 700;
                }
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try {
                    sock.receive(p);
                } catch (SocketTimeoutException e) {
                    continue;
                }
                try {
                    JSONObject r = new JSONObject(new String(p.getData(), 0, p.getLength(), Lan.UTF8));
                    if (!"host".equals(r.optString("np")) || r.optInt("v") != Lan.VERSION) continue;
                    String address = p.getAddress().getHostAddress();
                    JSONObject host = Lan.json("name", r.optString("name", address), "address", address, "port", r.optInt("port", Lan.TCP_PORT),
                            "app", r.optString("app"), "busy", r.optBoolean("busy"));
                    if (r.has("pieces")) host.put("pieces", r.optInt("pieces"));
                    found.put(address + ":" + host.optInt("port"), host);
                } catch (JSONException ignored) {
                    // not ours
                }
            }
        } catch (IOException ignored) {
            // no network: nothing found
        }
        return new ArrayList<>(found.values());
    }

    static Session connect(String address, int port, String code, String name, int timeoutMs) throws IOException {
        Socket s = new Socket();
        try {
            s.connect(new InetSocketAddress(address, port), timeoutMs);
        } catch (IOException e) {
            closeQuietly(s);
            throw new Lan.LanException("unreachable", e.getMessage());
        }
        s.setSoTimeout(60000);
        s.setTcpNoDelay(true);
        Lan.Wire wire = new Lan.Wire(new BufferedInputStream(s.getInputStream(), 1 << 16), new BufferedOutputStream(s.getOutputStream(), 1 << 16));
        try {
            return new Session(s, Lan.clientHandshake(wire, code, name));
        } catch (IOException e) {
            closeQuietly(s);
            throw e;
        }
    }

    static final class Session {
        private final Socket socket;
        private final Lan.Channel channel;
        final String hostName;

        Session(Socket socket, Lan.Connected c) {
            this.socket = socket;
            this.channel = c.channel;
            this.hostName = c.peerName;
        }

        JSONObject manifest() throws IOException {
            channel.sendJson(Lan.json("t", "manifest"));
            return channel.recvJson();
        }

        /** Downloads into dir (".part" first, renamed when complete). */
        void download(List<String> names, File dir, Progress progress) throws IOException {
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Ordner fehlt: " + dir);
            long bytes = 0;
            for (int i = 0; i < names.size(); i++) {
                String fileName = names.get(i);
                if (!Lan.SAFE_FILE.matcher(fileName).matches()) throw new Lan.LanException("protocol", "ungültiger Dateiname " + fileName);
                channel.sendJson(Lan.json("t", "get", "name", fileName));
                JSONObject head = channel.recvJson();
                if (!"file".equals(head.optString("t")) || !fileName.equals(head.optString("name"))) throw new Lan.LanException("protocol");
                long size = head.optLong("size");
                File part = new File(dir, fileName + ".part");
                long got = 0;
                try (OutputStream out = new FileOutputStream(part)) {
                    while (got < size) {
                        Lan.Message m = channel.recv();
                        if (m.data == null) throw new Lan.LanException("protocol");
                        out.write(m.data);
                        got += m.data.length;
                        bytes += m.data.length;
                        progress.update(i, names.size(), bytes);
                    }
                } catch (IOException e) {
                    part.delete();
                    throw e;
                }
                if (got != size) throw new Lan.LanException("protocol", "Datei unvollständig");
                File target = new File(dir, fileName);
                target.delete();
                if (!part.renameTo(target)) throw new IOException("Datei lässt sich nicht speichern: " + fileName);
                progress.update(i + 1, names.size(), bytes);
            }
        }

        void close(boolean ok) {
            try {
                channel.sendJson(Lan.json("t", "bye", "ok", ok));
            } catch (IOException ignored) {
                // host already gone
            }
            closeQuietly(socket);
        }

        void abort() {
            closeQuietly(socket);
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
