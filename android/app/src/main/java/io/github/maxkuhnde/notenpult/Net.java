package io.github.maxkuhnde.notenpult;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/**
 * HTTPS to GitHub (update check, APK download) with current root certificates.
 * <p>
 * Android 5 does not know the roots GitHub uses today (ISRG Root X1 for downloads – only in
 * Android 7.1.1 and newer – and Sectigo's E46/USERTrust chain for github.com). So the app
 * brings Mozilla's root list (assets/cacerts.pem, written by scripts/build-android-web.js)
 * and accepts a server if either that list or the system trusts it. Certificates and host
 * names are checked as usual. Plain Java, so it runs in unit tests.
 */
final class Net {
    private static final Charset UTF8 = Charset.forName("UTF-8");

    interface Progress {
        void update(long received, long total);
    }

    private Net() {
    }

    // ---------- trust ----------

    /** All certificates of a PEM file (several BEGIN/END CERTIFICATE blocks). */
    static List<X509Certificate> readPem(InputStream in) throws IOException, CertificateException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        Preset.copy(in, buf);
        String text = new String(buf.toByteArray(), UTF8);
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        List<X509Certificate> certs = new ArrayList<>();
        String begin = "-----BEGIN CERTIFICATE-----";
        String end = "-----END CERTIFICATE-----";
        for (int i = text.indexOf(begin); i >= 0; i = text.indexOf(begin, i + 1)) {
            int j = text.indexOf(end, i);
            if (j < 0) break;
            byte[] block = text.substring(i, j + end.length()).getBytes(UTF8);
            certs.add((X509Certificate) cf.generateCertificate(new ByteArrayInputStream(block)));
        }
        return certs;
    }

    static X509TrustManager trustManager(List<X509Certificate> roots) throws GeneralSecurityException, IOException {
        KeyStore ks = null;
        if (roots != null) {
            ks = KeyStore.getInstance(KeyStore.getDefaultType());
            ks.load(null, null);
            for (int i = 0; i < roots.size(); i++) ks.setCertificateEntry("root" + i, roots.get(i));
        }
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(ks); // null = the system's roots
        for (TrustManager tm : tmf.getTrustManagers()) {
            if (tm instanceof X509TrustManager) return (X509TrustManager) tm;
        }
        throw new GeneralSecurityException("no X509TrustManager");
    }

    /** Trusts what the bundled roots or (if {@code withSystem}) the system's roots trust. */
    static SSLSocketFactory socketFactory(List<X509Certificate> roots, boolean withSystem)
            throws GeneralSecurityException, IOException {
        final X509TrustManager bundled = trustManager(roots);
        final X509TrustManager system = withSystem ? trustManager(null) : null;
        X509TrustManager either = new X509TrustManager() {
            @Override
            public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                bundled.checkClientTrusted(chain, authType);
            }

            @Override
            public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                try {
                    bundled.checkServerTrusted(chain, authType);
                } catch (CertificateException e) {
                    if (system == null) throw e;
                    try {
                        system.checkServerTrusted(chain, authType);
                    } catch (CertificateException ignored) {
                        throw e;
                    }
                }
            }

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                return bundled.getAcceptedIssuers();
            }
        };
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(null, new TrustManager[]{either}, null);
        return ctx.getSocketFactory();
    }

    // ---------- requests ----------

    /** Opens an HTTPS GET and follows redirects itself (each hop with our trust). */
    static HttpURLConnection open(String url, String accept, String userAgent, SSLSocketFactory tls) throws IOException {
        for (int hop = 0; hop < 6; hop++) {
            URL u = new URL(url);
            if (!"https".equals(u.getProtocol())) throw new IOException("Nur HTTPS ist erlaubt: " + url);
            HttpsURLConnection c = (HttpsURLConnection) u.openConnection();
            c.setSSLSocketFactory(tls);
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", userAgent); // GitHub's API rejects requests without one
            c.setRequestProperty("Accept", accept);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                url = new URL(u, c.getHeaderField("Location")).toString();
                c.disconnect();
                continue;
            }
            return c;
        }
        throw new IOException("Zu viele Weiterleitungen");
    }

    /** Status code and body text (e.g. the GitHub API's JSON). */
    static String[] getText(String url, String userAgent, SSLSocketFactory tls) throws IOException {
        HttpURLConnection c = open(url, "application/vnd.github+json", userAgent, tls);
        try {
            int code = c.getResponseCode();
            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            if (in != null) {
                try {
                    Preset.copy(in, buf);
                } finally {
                    in.close();
                }
            }
            return new String[]{String.valueOf(code), new String(buf.toByteArray(), UTF8)};
        } finally {
            c.disconnect();
        }
    }

    /**
     * Downloads to {@code target}; checks the SHA-256 digest if one is given ("sha256:…",
     * as the GitHub API lists it for release assets).
     */
    static void download(String url, File target, String digest, String userAgent, SSLSocketFactory tls, Progress progress)
            throws IOException, GeneralSecurityException {
        HttpURLConnection c = open(url, "application/octet-stream", userAgent, tls);
        try {
            if (c.getResponseCode() != 200) throw new IOException("Download fehlgeschlagen (HTTP " + c.getResponseCode() + ")");
            long total = c.getContentLength();
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            long received = 0;
            long reported = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(target)) {
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    sha.update(buf, 0, n);
                    received += n;
                    if (progress != null && received - reported >= 128 * 1024) {
                        reported = received;
                        progress.update(received, total);
                    }
                }
            }
            if (total > 0 && received != total) throw new IOException("Download unvollständig");
            if (progress != null) progress.update(received, total);
            if (digest != null && digest.toLowerCase(Locale.ROOT).startsWith("sha256:")) {
                StringBuilder hex = new StringBuilder();
                for (byte b : sha.digest()) hex.append(String.format(Locale.ROOT, "%02x", b));
                if (!digest.substring(7).equalsIgnoreCase(hex.toString())) {
                    throw new IOException("Prüfsumme stimmt nicht – Download beschädigt, bitte noch einmal versuchen.");
                }
            }
        } finally {
            c.disconnect();
        }
    }
}
