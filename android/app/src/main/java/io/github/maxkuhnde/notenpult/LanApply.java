package io.github.maxkuhnde.notenpult;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collection;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/**
 * Receiver: writes what came over the network (lan/apply.js on Windows). The new library and
 * annotations were put together in the page (renderer/js/lan-plan.js); the sheet files are
 * already downloaded. The previous library and annotations go to _vor-abgleich first; in
 * mirror mode sheet files no longer used are moved there instead of being deleted.
 */
final class LanApply {
    private LanApply() {
    }

    static void apply(File dataDir, String db, JSONObject ann, Collection<String> keep, boolean mirror) throws IOException {
        try {
            new JSONObject(db); // never write a broken library
        } catch (JSONException e) {
            throw new IOException("Die übertragene Bibliothek ist beschädigt.");
        }
        File sheets = new File(dataDir, "Noten");
        File annDir = new File(dataDir, "Anmerkungen");
        // Everything the new library needs must be here before anything changes.
        for (String f : keep) {
            if (!Lan.SAFE_FILE.matcher(f).matches() || !new File(sheets, f).isFile()) throw new IOException("Notendatei fehlt: " + f);
        }
        File backup = new File(dataDir, "_vor-abgleich");
        Preset.deleteRecursively(backup);
        File backupNotes = new File(backup, "Noten");
        File backupAnn = new File(backup, "Anmerkungen");
        if (!backupNotes.mkdirs() || !backupAnn.mkdirs()) throw new IOException("Sicherung lässt sich nicht anlegen.");
        sheets.mkdirs();
        annDir.mkdirs();
        File dbFile = new File(dataDir, Preset.DB);
        if (dbFile.isFile()) copy(dbFile, new File(backup, Preset.DB));
        File[] anns = annDir.listFiles();
        if (anns != null) for (File f : anns) copy(f, new File(backupAnn, f.getName()));

        if (mirror) {
            Set<String> keepSet = new HashSet<>(keep);
            File[] files = sheets.listFiles();
            if (files != null) {
                for (File f : files) {
                    if (!keepSet.contains(f.getName())) f.renameTo(new File(backupNotes, f.getName()));
                }
            }
            if (anns != null) {
                for (File f : anns) {
                    if (!ann.has(f.getName().replaceAll("\\.json$", ""))) f.delete();
                }
            }
        }
        Iterator<String> ids = ann.keys();
        while (ids.hasNext()) {
            String id = ids.next();
            if (Lan.SAFE_ID.matcher(id).matches()) writeAtomic(new File(annDir, id + ".json"), ann.optString(id));
        }
        writeAtomic(dbFile, db);
    }

    static void writeAtomic(File f, String text) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(text.getBytes(Lan.UTF8));
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) {
            f.delete();
            if (!tmp.renameTo(f)) throw new IOException("Speichern fehlgeschlagen: " + f.getName());
        }
    }

    private static void copy(File from, File to) throws IOException {
        try (InputStream in = new FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
            Preset.copy(in, out);
        }
    }
}
