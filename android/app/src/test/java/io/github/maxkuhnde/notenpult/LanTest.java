package io.github.maxkuhnde.notenpult;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigInteger;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * "Im WLAN teilen" on Android: SPAKE2 handshake, transfer, wrong codes, writing the result –
 * and the same against the Windows implementation (lan/*.js via test/lan-peer.js, needs Node).
 */
public class LanTest {
    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static final File REPO = new File("../..").getAbsoluteFile();

    private File library() throws Exception {
        File dir = tmp.newFolder();
        Random r = new Random(1);
        byte[] big = new byte[700 * 1024];
        r.nextBytes(big);
        write(new File(dir, "Noten/aaaa1111.pdf"), big);
        write(new File(dir, "Noten/bbbb2222.png"), "png".getBytes(StandardCharsets.UTF_8));
        JSONObject db = new JSONObject()
                .put("version", 2)
                .put("pieces", new JSONArray()
                        .put(piece("p1", "Florentiner Marsch", "aaaa1111.pdf"))
                        .put(piece("p2", "Polka", "bbbb2222.png")))
                .put("setlists", new JSONArray().put(new JSONObject().put("id", "s1").put("name", "Konzert").put("entries", new JSONArray())))
                .put("genres", new JSONArray());
        write(new File(dir, "notenpult.json"), db.toString().getBytes(StandardCharsets.UTF_8));
        write(new File(dir, "Anmerkungen/p1.json"), "{\"pages\":{}}".getBytes(StandardCharsets.UTF_8));
        return dir;
    }

    private static JSONObject piece(String id, String title, String file) throws Exception {
        return new JSONObject().put("id", id).put("title", title).put("parts", new JSONArray().put(new JSONObject()
                .put("id", id + "a").put("name", "1. Stimme").put("pages", new JSONArray().put(new JSONObject().put("id", id + "g").put("file", file).put("page", 1)))));
    }

    private static void write(File f, byte[] data) throws IOException {
        f.getParentFile().mkdirs();
        Files.write(f.toPath(), data);
    }

    private static String errorCode(Runnable r) {
        try {
            r.run();
            return "ok";
        } catch (RuntimeException e) {
            return e.getCause() instanceof Lan.LanException ? ((Lan.LanException) e.getCause()).code : e.toString();
        }
    }

    /** Waits (up to 5 s) until the host has reported n events of this type. */
    private static void awaitEvents(List<JSONObject> events, String type, int n) throws InterruptedException {
        for (int i = 0; i < 250; i++) {
            int count = 0;
            for (JSONObject e : events) if (type.equals(e.optString("type"))) count++;
            if (count >= n) return;
            Thread.sleep(20);
        }
        fail("host did not report " + n + " × " + type);
    }

    private static LanClient.Session connect(int port, String code) {
        try {
            return LanClient.connect("127.0.0.1", port, code, "Java-Empfänger", 5000);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    @Test
    public void groupIsSound() {
        assertEquals(2048, Lan.P.bitLength());
        assertTrue(Lan.P.isProbablePrime(20));
        assertTrue(Lan.Q.isProbablePrime(20));
        for (BigInteger x : Arrays.asList(Lan.G, Lan.M, Lan.N)) assertEquals(BigInteger.ONE, x.modPow(Lan.Q, Lan.P));
        assertFalse(Lan.M.equals(Lan.N));
    }

    @Test
    public void javaHostAndReceiver() throws Exception {
        File dir = library();
        List<JSONObject> events = new CopyOnWriteArrayList<>();
        LanHost host = new LanHost(dir, "Tablet", "1.5.0", events::add, "1234", "5555");
        int port = host.start(InetAddress.getByName("127.0.0.1"), 0, 0);
        try {
            // The host finishes each attempt on its own thread; until then it answers "busy".
            assertEquals("code", errorCode(() -> connect(port, "0000")));
            awaitEvents(events, "wrongCode", 1);
            assertEquals("code", errorCode(() -> connect(port, "0001")));
            awaitEvents(events, "wrongCode", 2);
            assertEquals("code", errorCode(() -> connect(port, "0002")));
            awaitEvents(events, "newCode", 1);
            assertEquals("after 3 wrong codes a new one", "5555", host.code());
            assertEquals("code", errorCode(() -> connect(port, "1234")));
            awaitEvents(events, "wrongCode", 4);

            LanClient.Session s = connect(port, "5555");
            assertEquals("Tablet", s.hostName);
            assertEquals("busy", errorCode(() -> connect(port, "5555")));
            JSONObject m = s.manifest();
            assertEquals(2, new JSONObject(m.getString("db")).getJSONArray("pieces").length());
            assertTrue(m.getJSONObject("ann").has("p1"));
            File out = tmp.newFolder();
            List<String> names = new ArrayList<>();
            for (int i = 0; i < m.getJSONArray("files").length(); i++) names.add(m.getJSONArray("files").getJSONArray(i).getString(0));
            Collections.sort(names);
            final long[] last = {0};
            s.download(names, out, (file, files, bytes) -> last[0] = bytes);
            assertArrayEquals(Files.readAllBytes(new File(dir, "Noten/aaaa1111.pdf").toPath()), Files.readAllBytes(new File(out, "aaaa1111.pdf").toPath()));
            assertEquals(700 * 1024 + 3, last[0]);
            s.close(true);
            awaitEvents(events, "newCode", 2); // after "done": one code, one receiver
            boolean done = false;
            for (JSONObject e : events) done |= "done".equals(e.optString("type")) && e.optBoolean("ok") && e.optInt("files") == 2;
            assertTrue("host reports the finished transfer", done);
            assertFalse("new code after a transfer", "5555".equals(host.code()));
        } finally {
            host.stop();
        }
    }

    @Test
    public void discoveryAnswers() throws Exception {
        File dir = library();
        LanHost host = new LanHost(dir, "Tablet", "1.5.0", e -> { }, "1234");
        int discoveryPort = 47000 + new Random().nextInt(900);
        int port = host.start(InetAddress.getByName("127.0.0.1"), 0, discoveryPort);
        try {
            List<JSONObject> found = LanClient.discover(800, discoveryPort, Collections.singletonList(InetAddress.getByName("127.0.0.1")));
            assertEquals(1, found.size());
            assertEquals("Tablet", found.get(0).getString("name"));
            assertEquals(port, found.get(0).getInt("port"));
            assertEquals(2, found.get(0).getInt("pieces"));
        } finally {
            host.stop();
        }
    }

    @Test
    public void applyMirrorKeepsABackup() throws Exception {
        File dir = library();
        write(new File(dir, "Noten/alt00000.pdf"), "alt".getBytes(StandardCharsets.UTF_8));
        write(new File(dir, "Anmerkungen/alt.json"), "{}".getBytes(StandardCharsets.UTF_8));
        String db = new JSONObject().put("pieces", new JSONArray().put(piece("p1", "Neu", "aaaa1111.pdf"))).toString();
        try {
            LanApply.apply(dir, db, new JSONObject(), Arrays.asList("aaaa1111.pdf", "fehlt0000.pdf"), true);
            fail("missing file accepted");
        } catch (IOException expected) {
            assertTrue("nothing changed", new File(dir, "Noten/alt00000.pdf").isFile());
        }
        LanApply.apply(dir, db, new JSONObject().put("p1", "{\"pages\":{\"x\":[]}}"), Collections.singletonList("aaaa1111.pdf"), true);
        assertTrue(new String(Files.readAllBytes(new File(dir, "notenpult.json").toPath()), StandardCharsets.UTF_8).contains("Neu"));
        assertFalse(new File(dir, "Noten/alt00000.pdf").exists());
        assertTrue(new File(dir, "_vor-abgleich/Noten/alt00000.pdf").isFile());
        assertTrue(new File(dir, "_vor-abgleich/notenpult.json").isFile());
        assertFalse(new File(dir, "Anmerkungen/alt.json").exists());
        assertTrue(new File(dir, "Anmerkungen/p1.json").isFile());
    }

    // ---------- against the Windows implementation ----------

    private static Process node(String... args) throws IOException {
        List<String> cmd = new ArrayList<>(Arrays.asList("node", new File(REPO, "test/lan-peer.js").getPath()));
        cmd.addAll(Arrays.asList(args));
        return new ProcessBuilder(cmd).directory(REPO).redirectErrorStream(true).start();
    }

    private static boolean nodeAvailable() {
        try {
            return new ProcessBuilder("node", "--version").start().waitFor() == 0 && new File(REPO, "test/lan-peer.js").isFile();
        } catch (Exception e) {
            return false;
        }
    }

    @Test
    public void javaReceiverFromNodeHost() throws Exception {
        Assume.assumeTrue("Node.js not available", nodeAvailable());
        File dir = library();
        Process p = node("host", dir.getPath(), "4711");
        try {
            BufferedReader out = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8));
            String ready = out.readLine();
            assertTrue(ready, ready != null && ready.startsWith("READY "));
            int port = Integer.parseInt(ready.substring(6).trim());
            assertEquals("code", errorCode(() -> connect(port, "1111")));
            assertEquals("the Node host has handled the wrong code", "WRONG", out.readLine());
            LanClient.Session s = connect(port, "4711");
            assertEquals("Node-Host", s.hostName);
            JSONObject m = s.manifest();
            File target = tmp.newFolder();
            s.download(Arrays.asList("aaaa1111.pdf", "bbbb2222.png"), target, (f, n, b) -> { });
            assertArrayEquals(Files.readAllBytes(new File(dir, "Noten/aaaa1111.pdf").toPath()), Files.readAllBytes(new File(target, "aaaa1111.pdf").toPath()));
            assertEquals(2, new JSONObject(m.getString("db")).getJSONArray("pieces").length());
            s.close(true);
            String line;
            String done = null;
            while ((line = out.readLine()) != null) if (line.startsWith("DONE")) done = line;
            assertEquals("DONE 2", done);
        } finally {
            p.destroy();
        }
    }

    @Test
    public void nodeReceiverFromJavaHost() throws Exception {
        Assume.assumeTrue("Node.js not available", nodeAvailable());
        File dir = library();
        List<JSONObject> events = new CopyOnWriteArrayList<>();
        LanHost host = new LanHost(dir, "Java-Host", "1.5.0", events::add, "2468");
        int port = host.start(InetAddress.getByName("127.0.0.1"), 0, 0);
        try {
            File target = tmp.newFolder();
            Process p = node("client", String.valueOf(port), "2468", target.getPath());
            String result = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8)).readLine();
            p.waitFor();
            assertEquals("OK 2 2 Java-Host", result);
            assertArrayEquals(Files.readAllBytes(new File(dir, "Noten/aaaa1111.pdf").toPath()), Files.readAllBytes(new File(target, "aaaa1111.pdf").toPath()));
            awaitEvents(events, "done", 1);
            Process wrong = node("client", String.valueOf(port), "0000", target.getPath());
            assertEquals("ERROR code", new BufferedReader(new InputStreamReader(wrong.getInputStream(), StandardCharsets.UTF_8)).readLine());
        } finally {
            host.stop();
        }
    }
}
