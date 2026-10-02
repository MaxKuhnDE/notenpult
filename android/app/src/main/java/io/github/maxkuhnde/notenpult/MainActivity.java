package io.github.maxkuhnde.notenpult;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.security.cert.CertificateExpiredException;
import java.security.cert.CertificateNotYetValidException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

import javax.net.ssl.SSLException;
import javax.net.ssl.SSLSocketFactory;

/**
 * Notenpult for Android: the user interface of the Windows app (renderer/, bundled into
 * assets/www by scripts/build-android-web.js) in a WebView.
 *
 * <ul>
 * <li>https://notenpult.local/… is answered here: app files from assets/www, sheets from
 *     /library/&lt;file&gt; (files/Notenpult/Noten).</li>
 * <li>window.NotenpultAndroid is the bridge for renderer/js/store.js (androidBackend). Calls that
 *     need a dialog answer later through window.__npResolve(id, json).</li>
 * <li>Data layout as on Windows: files/Notenpult/notenpult.json, Noten/, Anmerkungen/.</li>
 * </ul>
 * Runs on Android 5.0 (API 21) – its WebView can be updated up to Chrome 95.
 */
public class MainActivity extends Activity {
    private static final String TAG = "Notenpult";
    private static final String HOST = "notenpult.local";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final String DATA = "Notenpult";
    private static final int REQ_PICK = 1;
    private static final int REQ_EXPORT = 2;
    private static final int REQ_IMPORT = 3;
    private static final String RELEASE_API = "https://api.github.com/repos/MaxKuhnDE/notenpult/releases/latest";
    private static final String DOWNLOAD_PREFIX = "https://github.com/MaxKuhnDE/notenpult/releases/download/";

    private static final Pattern SAFE_FILE = Pattern.compile("[A-Za-z0-9_-]{1,64}\\.[a-z0-9]{1,5}");
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final String[] SHEET_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"};
    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "application/javascript");
        MIME.put("mjs", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("pdf", "application/pdf");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("svg", "image/svg+xml");
        MIME.put("ttf", "font/ttf");
        MIME.put("wasm", "application/wasm");
    }

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final SecureRandom random = new SecureRandom();
    private WebView web;
    private File root;
    private File dataDir;
    private File sheetDir;
    private File annDir;
    private File dbFile;
    private String pickCallback;
    private String exportCallback;
    private String importCallback;
    private boolean fullscreen;
    private SSLSocketFactory tls;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = getFilesDir();
        Preset.recover(root, DATA);
        dataDir = new File(root, DATA);
        sheetDir = new File(dataDir, "Noten");
        annDir = new File(dataDir, "Anmerkungen");
        dbFile = new File(dataDir, "notenpult.json");
        sheetDir.mkdirs();
        annDir.mkdirs();
        if (state == null) ApkProvider.updateFile(this).delete(); // installed (or given up) by now
        if (state == null && dbFile.isFile()) {
            // One rolling backup of the library index per start (as on Windows).
            try {
                writeText(new File(dataDir, "notenpult.backup.json"), readText(dbFile));
            } catch (IOException e) {
                Log.w(TAG, "backup", e);
            }
        }

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#1c1b1f"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setHapticFeedbackEnabled(false);
        web.setOnLongClickListener(v -> true); // no text selection / context menu on long press
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100); // Android's font size setting must not scale the layout
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new Bridge(), "NotenpultAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        setContentView(web);
        web.loadUrl(START_URL);
    }

    // ---------- lifecycle ----------

    @Override
    protected void onPause() {
        // Android may end the app while it is in the background: write pending changes now.
        web.evaluateJavascript("window.__npFlush && window.__npFlush()", null);
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && fullscreen) applyFullscreen();
    }

    @Override
    public void onBackPressed() {
        // The page closes dialogs and the sheet view itself; otherwise the app goes to the background.
        web.evaluateJavascript("window.__npBack ? window.__npBack() : false", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onDestroy() {
        worker.shutdown();
        web.destroy();
        super.onDestroy();
    }

    private void applyFullscreen() {
        int flags = 0;
        if (fullscreen) {
            flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        }
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    // ---------- requests to https://notenpult.local ----------

    private final class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!HOST.equals(url.getHost())) return null; // GitHub (updates) goes to the network
            String path = url.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            try {
                if (path.startsWith("/library/")) {
                    String name = path.substring("/library/".length());
                    File f = new File(sheetDir, name);
                    if (!SAFE_FILE.matcher(name).matches() || !f.isFile()) return notFound();
                    return respond(name, new FileInputStream(f));
                }
                if (path.contains("..")) return notFound();
                return respond(path, getAssets().open("www" + path));
            } catch (IOException e) {
                return notFound();
            }
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (HOST.equals(Uri.parse(url).getHost())) return false;
            openExternal(url);
            return true;
        }
    }

    private static WebResourceResponse respond(String name, InputStream data) {
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        String encoding = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json") ? "utf-8" : null;
        return new WebResourceResponse(mime, encoding, 200, "OK", headers, data);
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(),
                new ByteArrayInputStream(new byte[0]));
    }

    // ---------- bridge: window.NotenpultAndroid ----------

    private final class Bridge {
        @JavascriptInterface
        public String loadDb() {
            return readTextOrNull(dbFile);
        }

        @JavascriptInterface
        public boolean saveDb(String text) {
            try {
                writeText(dbFile, text);
                return true;
            } catch (IOException e) {
                Log.e(TAG, "saveDb", e);
                return false;
            }
        }

        @JavascriptInterface
        public String loadAnnotations(String id) {
            return SAFE_ID.matcher(id).matches() ? readTextOrNull(new File(annDir, id + ".json")) : null;
        }

        @JavascriptInterface
        public boolean saveAnnotations(String id, String text) {
            if (!SAFE_ID.matcher(id).matches()) return false;
            try {
                writeText(new File(annDir, id + ".json"), text);
                return true;
            } catch (IOException e) {
                Log.e(TAG, "saveAnnotations", e);
                return false;
            }
        }

        @JavascriptInterface
        public void deleteAnnotations(String id) {
            if (SAFE_ID.matcher(id).matches()) new File(annDir, id + ".json").delete();
        }

        @JavascriptInterface
        public void deleteFiles(String json) {
            try {
                JSONArray names = new JSONArray(json);
                for (int i = 0; i < names.length(); i++) {
                    String name = names.optString(i);
                    if (SAFE_FILE.matcher(name).matches()) new File(sheetDir, name).delete();
                }
            } catch (JSONException e) {
                Log.w(TAG, "deleteFiles", e);
            }
        }

        @JavascriptInterface
        public String info() {
            JSONObject o = new JSONObject();
            try {
                o.put("version", appVersion());
                o.put("platform", "android");
                o.put("packaged", true);
                o.put("dataDir", "Tablet – interner Speicher der App (sichern mit „Alles exportieren“)");
                o.put("android", Build.VERSION.RELEASE);
                o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            } catch (JSONException ignored) {
                // cannot happen with these values
            }
            return o.toString();
        }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public void setFullscreen(final boolean on) {
            runOnUiThread(() -> {
                fullscreen = on;
                applyFullscreen();
            });
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            if (url != null && url.startsWith("https://")) runOnUiThread(() -> openExternal(url));
        }

        /**
         * The latest GitHub release as JSON; answers { ok, status, body }. Not via fetch() in the
         * page: the WebView only knows Android 5's old root certificates (see Net).
         */
        @JavascriptInterface
        public void checkUpdate(final String callback) {
            worker.execute(() -> {
                try {
                    String[] res = Net.getText(RELEASE_API, userAgent(), tls());
                    JSONObject r = new JSONObject();
                    r.put("ok", true);
                    r.put("status", Integer.parseInt(res[0]));
                    r.put("body", res[1]);
                    resolve(callback, r);
                } catch (IOException | GeneralSecurityException | JSONException e) {
                    Log.w(TAG, "checkUpdate", e);
                    resolve(callback, error(networkMessage(e)));
                }
            });
        }

        /** Downloads the new APK (progress: window.__npUpdateProgress) and opens Android's installer. */
        @JavascriptInterface
        public void installUpdate(final String callback, final String url, final String digest) {
            worker.execute(() -> resolve(callback, downloadAndInstall(url, digest)));
        }

        /** PDFs and images from the tablet (Downloads, USB stick, …) → Noten/; answers { records }. */
        @JavascriptInterface
        public void pickFiles(final String callback) {
            runOnUiThread(() -> {
                pickCallback = callback;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, SHEET_TYPES);
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startForResult(i, REQ_PICK, callback);
            });
        }

        @JavascriptInterface
        public void exportPreset(final String callback) {
            runOnUiThread(() -> {
                exportCallback = callback;
                String stamp = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/zip");
                i.putExtra(Intent.EXTRA_TITLE, "Notenpult-Export-" + stamp + ".zip");
                startForResult(i, REQ_EXPORT, callback);
            });
        }

        @JavascriptInterface
        public void importPreset(final String callback) {
            runOnUiThread(() -> {
                importCallback = callback;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*"); // ZIPs come as application/zip, x-zip-compressed or octet-stream
                startForResult(i, REQ_IMPORT, callback);
            });
        }
    }

    private void startForResult(Intent intent, int request, String callback) {
        try {
            startActivityForResult(intent, request);
        } catch (ActivityNotFoundException e) {
            resolve(callback, error("Auf diesem Gerät gibt es keine Dateiauswahl."));
        }
    }

    @Override
    protected void onActivityResult(int request, int result, final Intent data) {
        super.onActivityResult(request, result, data);
        final boolean ok = result == RESULT_OK && data != null;
        if (request == REQ_PICK) {
            final String cb = pickCallback;
            pickCallback = null;
            if (cb == null) return;
            final List<Uri> uris = new ArrayList<>();
            if (ok && data.getClipData() != null) {
                ClipData clip = data.getClipData();
                for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
            } else if (ok && data.getData() != null) {
                uris.add(data.getData());
            }
            worker.execute(() -> resolve(cb, importSheets(uris)));
        } else if (request == REQ_EXPORT) {
            final String cb = exportCallback;
            exportCallback = null;
            if (cb == null) return;
            if (!ok || data.getData() == null) resolve(cb, canceled());
            else worker.execute(() -> resolve(cb, exportTo(data.getData())));
        } else if (request == REQ_IMPORT) {
            final String cb = importCallback;
            importCallback = null;
            if (cb == null) return;
            if (!ok || data.getData() == null) resolve(cb, canceled());
            else worker.execute(() -> resolve(cb, importFrom(data.getData())));
        }
    }

    private void resolve(String callback, JSONObject result) {
        final String js = "window.__npResolve && window.__npResolve(" + JSONObject.quote(callback) + ","
                + JSONObject.quote(result.toString()) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    // ---------- import of single sheets ----------

    private JSONObject importSheets(List<Uri> uris) {
        JSONArray records = new JSONArray();
        for (Uri uri : uris) {
            String display = displayName(uri);
            String ext = extensionOf(display, getContentResolver().getType(uri));
            JSONObject r = new JSONObject();
            try {
                String base = display.contains(".") ? display.substring(0, display.lastIndexOf('.')) : display;
                if (ext == null) {
                    r.put("error", "Nur PDF, JPG, PNG und WebP werden unterstützt.");
                    r.put("name", display);
                    records.put(r);
                    continue;
                }
                String file = newFileName() + ext;
                try (InputStream in = getContentResolver().openInputStream(uri);
                     OutputStream out = new FileOutputStream(new File(sheetDir, file))) {
                    if (in == null) throw new IOException("Datei lässt sich nicht öffnen.");
                    Preset.copy(in, out);
                }
                r.put("file", file);
                r.put("name", base);
                r.put("ext", ext);
            } catch (IOException | JSONException | SecurityException e) {
                try {
                    r.put("error", String.valueOf(e.getMessage()));
                    r.put("name", display);
                } catch (JSONException ignored) {
                    // cannot happen
                }
            }
            records.put(r);
        }
        JSONObject o = new JSONObject();
        try {
            o.put("records", records);
        } catch (JSONException ignored) {
            // cannot happen
        }
        return o;
    }

    private static String extensionOf(String name, String mime) {
        String lower = name.toLowerCase(Locale.ROOT);
        for (String ext : new String[]{".pdf", ".jpg", ".jpeg", ".png", ".webp"}) {
            if (lower.endsWith(ext)) return ext;
        }
        if ("application/pdf".equals(mime)) return ".pdf";
        if ("image/jpeg".equals(mime)) return ".jpg";
        if ("image/png".equals(mime)) return ".png";
        if ("image/webp".equals(mime)) return ".webp";
        return null;
    }

    private String newFileName() {
        byte[] b = new byte[8];
        random.nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    // ---------- "Alles exportieren / importieren" ----------

    private JSONObject exportTo(Uri uri) {
        try {
            String dbText = readTextOrNull(dbFile);
            if (dbText == null) {
                deleteDocument(uri);
                return error("Es gibt noch nichts zu exportieren.");
            }
            String[] sheets = sheetDir.list();
            JSONObject counts = countsOf(dbText);
            counts.put("files", sheets == null ? 0 : sheets.length);
            JSONObject manifest = new JSONObject();
            manifest.put("format", "notenpult-preset");
            manifest.put("formatVersion", 1);
            manifest.put("appVersion", appVersion());
            manifest.put("platform", "android");
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));
            manifest.put("exportedAt", iso.format(new Date()));
            manifest.put("counts", counts);
            long size;
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("Ziel lässt sich nicht beschreiben.");
                size = Preset.export(dataDir, manifest.toString(2), out);
            }
            JSONObject r = new JSONObject();
            r.put("ok", true);
            r.put("name", displayName(uri));
            r.put("size", size);
            r.put("counts", counts);
            return r;
        } catch (IOException | JSONException | SecurityException e) {
            Log.e(TAG, "export", e);
            deleteDocument(uri);
            return error(e.getMessage());
        }
    }

    private JSONObject importFrom(Uri uri) {
        File zip = new File(getCacheDir(), "import.zip");
        final JSONObject[] counts = {new JSONObject()};
        final String[] from = {""};
        try {
            try (InputStream in = getContentResolver().openInputStream(uri);
                 OutputStream out = new FileOutputStream(zip)) {
                if (in == null) throw new IOException("Datei lässt sich nicht öffnen.");
                Preset.copy(in, out);
            }
            Preset.importZip(zip, root, DATA, (manifestFile, db) -> {
                JSONObject manifest;
                try {
                    manifest = new JSONObject(readText(manifestFile));
                } catch (JSONException e) {
                    throw new Preset.Failure(Preset.NOT_AN_EXPORT);
                }
                if (!"notenpult-preset".equals(manifest.optString("format"))) throw new Preset.Failure(Preset.NOT_AN_EXPORT);
                if (manifest.optInt("formatVersion", 1) > 1) {
                    throw new Preset.Failure("Die Datei stammt aus einer neueren Notenpult-Version – bitte zuerst Notenpult aktualisieren.");
                }
                String dbText = readText(db);
                try {
                    new JSONObject(dbText);
                } catch (JSONException e) {
                    throw new Preset.Failure(Preset.BROKEN);
                }
                JSONObject c = manifest.optJSONObject("counts");
                counts[0] = c != null ? c : countsOf(dbText);
                from[0] = manifest.optString("platform");
            });
            JSONObject r = new JSONObject();
            r.put("ok", true);
            r.put("counts", counts[0]);
            r.put("from", from[0]);
            return r;
        } catch (Preset.Failure e) {
            return error(e.getMessage());
        } catch (IOException | JSONException | SecurityException e) {
            Log.e(TAG, "import", e);
            return error("Import nicht möglich: " + e.getMessage());
        } finally {
            zip.delete();
        }
    }

    private static JSONObject countsOf(String dbText) {
        JSONObject c = new JSONObject();
        try {
            JSONObject db = new JSONObject(dbText);
            JSONArray pieces = db.optJSONArray("pieces");
            JSONArray setlists = db.optJSONArray("setlists");
            c.put("pieces", pieces == null ? 0 : pieces.length());
            c.put("setlists", setlists == null ? 0 : setlists.length());
        } catch (JSONException ignored) {
            // counts are only for the message
        }
        return c;
    }

    // ---------- updates ----------

    private synchronized SSLSocketFactory tls() throws IOException, GeneralSecurityException {
        if (tls == null) {
            try (InputStream in = getAssets().open("cacerts.pem")) {
                tls = Net.socketFactory(Net.readPem(in), true);
            }
        }
        return tls;
    }

    private String userAgent() {
        return "Notenpult-Android/" + appVersion();
    }

    private JSONObject downloadAndInstall(String url, String digest) {
        if (url == null || !url.startsWith(DOWNLOAD_PREFIX)) return error("Unerwartete Download-Adresse.");
        File apk = ApkProvider.updateFile(this);
        try {
            Net.download(url, apk, digest, userAgent(), tls(), this::progress);
            PackageInfo info = getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
            if (info == null || !getPackageName().equals(info.packageName)) {
                apk.delete();
                return error("Die geladene Datei ist keine Notenpult-App.");
            }
            final Intent install = new Intent(Intent.ACTION_VIEW);
            if (Build.VERSION.SDK_INT >= 24) {
                install.setDataAndType(ApkProvider.uri(), ApkProvider.MIME);
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                apk.setReadable(true, false); // the installer runs as another user
                install.setDataAndType(Uri.fromFile(apk), ApkProvider.MIME);
            }
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            runOnUiThread(() -> {
                try {
                    startActivity(install);
                } catch (ActivityNotFoundException e) {
                    Log.w(TAG, "no installer", e);
                }
            });
            JSONObject r = new JSONObject();
            r.put("ok", true);
            r.put("opened", true);
            return r;
        } catch (IOException | GeneralSecurityException | JSONException e) {
            Log.w(TAG, "installUpdate", e);
            return error(networkMessage(e));
        }
    }

    private void progress(long received, long total) {
        final String js = "window.__npUpdateProgress && window.__npUpdateProgress({phase:'download',received:"
                + received + ",total:" + total + "})";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    private static String networkMessage(Exception e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof CertificateExpiredException || t instanceof CertificateNotYetValidException) {
                return "Sichere Verbindung abgelehnt – stimmen Datum und Uhrzeit des Tablets?";
            }
            if (t instanceof UnknownHostException) return "Keine Internetverbindung – später noch einmal versuchen.";
            if (t instanceof SocketTimeoutException) return "GitHub antwortet nicht – später noch einmal versuchen.";
        }
        if (e instanceof SSLException) return "Sichere Verbindung zu GitHub fehlgeschlagen: " + e.getMessage();
        return e.getMessage() != null ? e.getMessage() : e.toString();
    }

    // ---------- helpers ----------

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "?";
        }
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "no browser for " + url);
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && c.getString(0) != null) return c.getString(0);
        } catch (RuntimeException e) {
            Log.w(TAG, "displayName", e);
        }
        String last = uri.getLastPathSegment();
        return last != null ? last.substring(last.lastIndexOf('/') + 1) : "Datei";
    }

    private void deleteDocument(Uri uri) {
        try {
            DocumentsContract.deleteDocument(getContentResolver(), uri);
        } catch (RuntimeException | java.io.FileNotFoundException e) {
            Log.w(TAG, "deleteDocument", e);
        }
    }

    private static JSONObject canceled() {
        JSONObject o = new JSONObject();
        try {
            o.put("canceled", true);
        } catch (JSONException ignored) {
            // cannot happen
        }
        return o;
    }

    private static JSONObject error(String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false);
            o.put("error", message == null ? "unbekannter Fehler" : message);
        } catch (JSONException ignored) {
            // cannot happen
        }
        return o;
    }

    private static String readText(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.max(16, f.length()));
            Preset.copy(in, out);
            return out.toString("UTF-8");
        }
    }

    private static String readTextOrNull(File f) {
        try {
            return f.isFile() ? readText(f) : null;
        } catch (IOException e) {
            Log.e(TAG, "read " + f, e);
            return null;
        }
    }

    /** Write to a temporary file first, then rename – a crash never leaves a half-written file. */
    private static synchronized void writeText(File f, String text) throws IOException {
        File parent = f.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Ordner fehlt: " + parent);
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(text.getBytes("UTF-8"));
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new IOException("Speichern fehlgeschlagen: " + f.getName());
    }
}
