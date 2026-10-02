package io.github.maxkuhnde.notenpult;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/** "Alles exportieren / importieren" on Android – above all: a ZIP from the Windows app must work. */
public class PresetTest {
    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static final Preset.Check CHECK = (manifest, db) -> {
        if (!read(manifest).contains("\"notenpult-preset\"")) throw new Preset.Failure(Preset.NOT_AN_EXPORT);
    };

    private static String read(File f) throws IOException {
        return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
    }

    private static void write(File f, String text) throws IOException {
        f.getParentFile().mkdirs();
        Files.write(f.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    /** files/ with an existing library in files/Notenpult. */
    private File rootWithOldLibrary() throws IOException {
        File root = tmp.newFolder("files");
        File data = new File(root, "Notenpult");
        write(new File(data, "notenpult.json"), "{\"version\":2,\"pieces\":[],\"setlists\":[]}");
        write(new File(data, "Noten/alt.pdf"), "%PDF-alt");
        write(new File(data, "Anmerkungen/alt.json"), "{}");
        return root;
    }

    private File resource(String name) throws IOException {
        File f = tmp.newFile(name);
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(name);
             OutputStream out = new FileOutputStream(f)) {
            Preset.copy(in, out);
        }
        return f;
    }

    @Test
    public void importsTheZipOfTheWindowsApp() throws IOException {
        // Made by preset.js' command: tar.exe -a -c -f x.zip notenpult-preset.json notenpult.json Noten Anmerkungen
        File root = rootWithOldLibrary();
        Preset.importZip(resource("windows-export.zip"), root, "Notenpult", CHECK);

        File data = new File(root, "Notenpult");
        assertTrue(read(new File(data, "notenpult.json")).contains("Böhmischer Traum"));
        assertEquals(49049, new File(data, "Noten/0a1b2c3d4e5f6a7b.pdf").length());
        assertEquals(20902, new File(data, "Noten/9f8e7d6c5b4a3921.png").length());
        assertTrue(read(new File(data, "Anmerkungen/p1.json")).contains("\"g1\""));
        assertFalse("old sheets are gone (mirror image)", new File(data, "Noten/alt.pdf").exists());
        assertFalse(new File(data, "Anmerkungen/alt.json").exists());
        assertFalse("manifest is not part of the data", new File(data, Preset.MANIFEST).exists());
        assertFalse(new File(root, Preset.STAGING).exists());
        assertFalse(new File(root, Preset.PREVIOUS).exists());
    }

    @Test
    public void exportAndImportAreMirrorImages() throws IOException {
        File source = tmp.newFolder("tablet");
        write(new File(source, "notenpult.json"), "{\"pieces\":[{\"title\":\"Florentiner Marsch\"}]}");
        write(new File(source, "Noten/a.pdf"), "%PDF-1.4 a");
        write(new File(source, "Noten/b.png"), "png");
        write(new File(source, "Anmerkungen/p1.json"), "{\"pages\":{}}");
        File zip = tmp.newFile("export.zip");
        long size;
        try (OutputStream out = new FileOutputStream(zip)) {
            size = Preset.export(source, "{\"format\":\"notenpult-preset\",\"formatVersion\":1}", out);
        }
        assertEquals(zip.length(), size);

        List<String> names = new ArrayList<>();
        try (ZipFile z = new ZipFile(zip)) {
            Enumeration<? extends ZipEntry> e = z.entries();
            while (e.hasMoreElements()) names.add(e.nextElement().getName());
        }
        assertEquals("[notenpult-preset.json, notenpult.json, Noten/, Noten/a.pdf, Noten/b.png, Anmerkungen/, Anmerkungen/p1.json]",
                names.toString());

        File root = rootWithOldLibrary();
        Preset.importZip(zip, root, "Notenpult", CHECK);
        File data = new File(root, "Notenpult");
        for (String f : new String[]{"notenpult.json", "Noten/a.pdf", "Noten/b.png", "Anmerkungen/p1.json"}) {
            assertArrayEquals(f, Files.readAllBytes(new File(source, f).toPath()), Files.readAllBytes(new File(data, f).toPath()));
        }
        assertEquals(2, new File(data, "Noten").list().length);
    }

    @Test
    public void emptyFoldersAreCreated() throws IOException {
        File zip = zipOf(new String[][]{{"notenpult-preset.json", "{\"format\":\"notenpult-preset\"}"}, {"notenpult.json", "{}"}});
        File root = rootWithOldLibrary();
        Preset.importZip(zip, root, "Notenpult", CHECK);
        assertTrue(new File(root, "Notenpult/Noten").isDirectory());
        assertTrue(new File(root, "Notenpult/Anmerkungen").isDirectory());
    }

    @Test
    public void wrongFilesLeaveTheLibraryUntouched() throws IOException {
        File root = rootWithOldLibrary();
        File notZip = tmp.newFile("bild.zip");
        write(notZip, "kein zip");
        expectFailure(notZip, root, Preset.NOT_A_ZIP);

        File noManifest = zipOf(new String[][]{{"notenpult.json", "{}"}});
        expectFailure(noManifest, root, Preset.NOT_AN_EXPORT);

        File otherZip = zipOf(new String[][]{{"notenpult-preset.json", "{\"format\":\"etwas anderes\"}"}, {"notenpult.json", "{}"}});
        expectFailure(otherZip, root, Preset.NOT_AN_EXPORT);

        File noDb = zipOf(new String[][]{{"notenpult-preset.json", "{\"format\":\"notenpult-preset\"}"}});
        expectFailure(noDb, root, Preset.BROKEN);

        assertTrue(new File(root, "Notenpult/Noten/alt.pdf").exists());
        assertFalse(new File(root, Preset.STAGING).exists());
    }

    @Test
    public void entriesCannotEscapeTheDataFolder() throws IOException {
        File zip = zipOf(new String[][]{
                {"notenpult-preset.json", "{\"format\":\"notenpult-preset\"}"},
                {"notenpult.json", "{}"},
                {"../boese.txt", "x"},
                {"Noten/../../boese2.txt", "x"},
                {"/absolut.txt", "x"},
                {"anderes/datei.txt", "x"},
        });
        File root = rootWithOldLibrary();
        Preset.importZip(zip, root, "Notenpult", CHECK);
        assertFalse(new File(root.getParentFile(), "boese.txt").exists());
        assertFalse(new File(root.getParentFile(), "boese2.txt").exists());
        assertFalse(new File(root, "boese2.txt").exists());
        assertFalse(new File(root, "Notenpult/anderes").exists());
    }

    @Test
    public void interruptedImportIsRepairedAtStart() throws IOException {
        // Closed between "data → previous" and "new → data": the old data comes back.
        File root = tmp.newFolder("files");
        write(new File(root, Preset.PREVIOUS + "/notenpult.json"), "alt");
        write(new File(root, Preset.STAGING + "/notenpult.json"), "halb");
        Preset.recover(root, "Notenpult");
        assertEquals("alt", read(new File(root, "Notenpult/notenpult.json")));
        assertFalse(new File(root, Preset.PREVIOUS).exists());
        assertFalse(new File(root, Preset.STAGING).exists());

        // Closed after the swap: the import counts, the leftover goes.
        write(new File(root, Preset.PREVIOUS + "/notenpult.json"), "älter");
        Preset.recover(root, "Notenpult");
        assertEquals("alt", read(new File(root, "Notenpult/notenpult.json")));
        assertFalse(new File(root, Preset.PREVIOUS).exists());
    }

    private void expectFailure(File zip, File root, String message) throws IOException {
        try {
            Preset.importZip(zip, root, "Notenpult", CHECK);
            fail("expected: " + message);
        } catch (Preset.Failure e) {
            assertEquals(message, e.getMessage());
        }
    }

    private File zipOf(String[][] entries) throws IOException {
        File f = tmp.newFile();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(bytes)) {
            for (String[] e : entries) {
                z.putNextEntry(new ZipEntry(e[0]));
                z.write(e[1].getBytes(StandardCharsets.UTF_8));
                z.closeEntry();
            }
        }
        Files.write(f.toPath(), bytes.toByteArray());
        return f;
    }
}
