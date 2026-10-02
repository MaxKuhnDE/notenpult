package io.github.maxkuhnde.notenpult;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * "Alles exportieren / importieren" – the same ZIP as the Windows app (preset.js):
 * <pre>
 *   notenpult-preset.json   { format: 'notenpult-preset', formatVersion: 1, appVersion, platform, exportedAt, counts }
 *   notenpult.json          library (pieces, parts, setlists, genres, settings)
 *   Noten/…                 PDFs and images
 *   Anmerkungen/…           pen strokes per piece
 * </pre>
 * Import replaces everything. Plain Java without Android classes, so it runs in unit tests.
 */
final class Preset {
    static final String MANIFEST = "notenpult-preset.json";
    static final String DB = "notenpult.json";
    static final String[] DIRS = {"Noten", "Anmerkungen"};
    /** Next to the data folder: the unpacked import and, during the swap, the previous data. */
    static final String STAGING = ".import-neu";
    static final String PREVIOUS = ".import-alt";

    static final String NOT_A_ZIP = "Die Datei lässt sich nicht entpacken – ist es wirklich ein Notenpult-Export (ZIP)?";
    static final String NOT_AN_EXPORT = "Das ist keine Notenpult-Export-Datei.";
    static final String BROKEN = "Die Export-Datei ist beschädigt (notenpult.json fehlt oder ist ungültig).";

    private static final Charset UTF8 = Charset.forName("UTF-8");

    /** An error whose message is meant for the user as it is. */
    static final class Failure extends IOException {
        Failure(String message) {
            super(message);
        }
    }

    /** Checks the unpacked manifest and library before anything is replaced; throws {@link Failure}. */
    interface Check {
        void verify(File manifest, File db) throws IOException;
    }

    private Preset() {
    }

    // ---------- export ----------

    /** Writes the complete library of {@code dataDir} as ZIP; returns the number of bytes written. */
    static long export(File dataDir, String manifestJson, OutputStream target) throws IOException {
        CountingStream counter = new CountingStream(new BufferedOutputStream(target, 1 << 16));
        ZipOutputStream zip = new ZipOutputStream(counter);
        zip.setLevel(Deflater.BEST_SPEED); // PDFs are compressed already
        try {
            zip.putNextEntry(new ZipEntry(MANIFEST));
            zip.write(manifestJson.getBytes(UTF8));
            zip.closeEntry();
            putFile(zip, DB, new File(dataDir, DB));
            for (String dir : DIRS) {
                zip.putNextEntry(new ZipEntry(dir + "/"));
                zip.closeEntry();
                File[] files = new File(dataDir, dir).listFiles();
                if (files == null) continue;
                Arrays.sort(files);
                for (File f : files) {
                    if (f.isFile()) putFile(zip, dir + "/" + f.getName(), f);
                }
            }
            zip.finish();
            zip.flush();
        } finally {
            zip.close();
        }
        return counter.count;
    }

    private static void putFile(ZipOutputStream zip, String name, File file) throws IOException {
        ZipEntry entry = new ZipEntry(name);
        entry.setTime(file.lastModified());
        zip.putNextEntry(entry);
        try (InputStream in = new FileInputStream(file)) {
            copy(in, zip);
        }
        zip.closeEntry();
    }

    // ---------- import ----------

    /**
     * Unpacks {@code zipFile} and swaps it in as {@code root/name}. On any error the current
     * data stays exactly as it was.
     */
    static void importZip(File zipFile, File root, String name, Check check) throws IOException {
        recover(root, name);
        File staging = new File(root, STAGING);
        if (!staging.mkdirs()) throw new IOException("Import-Ordner lässt sich nicht anlegen.");
        try {
            unzip(zipFile, staging);
            File manifest = new File(staging, MANIFEST);
            File db = new File(staging, DB);
            if (!manifest.isFile()) throw new Failure(NOT_AN_EXPORT);
            if (!db.isFile()) throw new Failure(BROKEN);
            check.verify(manifest, db);
            if (!manifest.delete()) throw new IOException("Import-Ordner lässt sich nicht aufräumen.");
            for (String dir : DIRS) {
                File d = new File(staging, dir);
                if (!d.isDirectory() && !d.mkdirs()) throw new IOException("Ordner " + dir + " lässt sich nicht anlegen.");
            }
            swap(staging, new File(root, name), new File(root, PREVIOUS));
        } finally {
            deleteRecursively(staging);
        }
    }

    /** Only the known parts of an export are unpacked; nothing may end up outside {@code into}. */
    static void unzip(File zipFile, File into) throws IOException {
        String base = into.getCanonicalPath() + File.separator;
        ZipFile zip;
        try {
            zip = new ZipFile(zipFile);
        } catch (ZipException e) {
            throw new Failure(NOT_A_ZIP);
        }
        try {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String n = entry.getName().replace('\\', '/');
                while (n.startsWith("./")) n = n.substring(2);
                if (entry.isDirectory() || n.endsWith("/") || !wanted(n)) continue;
                File out = new File(into, n);
                if (!out.getCanonicalPath().startsWith(base)) continue;
                File parent = out.getParentFile();
                if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("Ordner lässt sich nicht anlegen: " + n);
                try (InputStream in = zip.getInputStream(entry); OutputStream os = new FileOutputStream(out)) {
                    copy(in, os);
                }
            }
        } catch (ZipException e) {
            throw new Failure(NOT_A_ZIP);
        } finally {
            zip.close();
        }
    }

    static boolean wanted(String n) {
        if (n.equals(MANIFEST) || n.equals(DB)) return true;
        if (n.contains("../") || n.startsWith("/")) return false;
        for (String dir : DIRS) {
            if (n.startsWith(dir + "/") && n.length() > dir.length() + 1) return true;
        }
        return false;
    }

    /**
     * Two renames: data → previous, fresh → data. {@link #recover} finishes or undoes an
     * import that was interrupted in between (app closed, battery empty).
     */
    static void swap(File fresh, File data, File previous) throws IOException {
        deleteRecursively(previous);
        if (data.exists() && !data.renameTo(previous)) throw new IOException("Die bisherigen Daten lassen sich nicht verschieben.");
        if (!fresh.renameTo(data)) {
            if (previous.exists()) previous.renameTo(data);
            throw new IOException("Die neuen Daten lassen sich nicht einsetzen.");
        }
        deleteRecursively(previous);
    }

    /** Call at start: brings back the data of an interrupted import and removes leftovers. */
    static void recover(File root, String name) {
        File data = new File(root, name);
        File previous = new File(root, PREVIOUS);
        if (!data.exists() && previous.exists()) previous.renameTo(data);
        deleteRecursively(previous);
        deleteRecursively(new File(root, STAGING));
    }

    // ---------- helpers ----------

    static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[1 << 16];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }

    static void deleteRecursively(File f) {
        if (!f.exists()) return;
        File[] children = f.listFiles();
        if (children != null) {
            for (File c : children) deleteRecursively(c);
        }
        f.delete();
    }

    private static final class CountingStream extends FilterOutputStream {
        long count;

        CountingStream(OutputStream out) {
            super(out);
        }

        @Override
        public void write(int b) throws IOException {
            out.write(b);
            count++;
        }

        @Override
        public void write(byte[] b, int off, int len) throws IOException {
            out.write(b, off, len);
            count += len;
        }
    }
}
