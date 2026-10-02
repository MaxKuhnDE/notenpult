package io.github.maxkuhnde.notenpult;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.cert.CertPath;
import java.security.cert.CertPathValidator;
import java.security.cert.CertPathValidatorException;
import java.security.cert.CertificateFactory;
import java.security.cert.PKIXParameters;
import java.security.cert.TrustAnchor;
import java.security.cert.X509Certificate;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * The bundled roots (assets/cacerts.pem from scripts/build-android-web.js) must accept GitHub's
 * certificate chains – Android 5's own roots do not. The chains were recorded on 2026-10-02 and
 * are checked for that day, so the test does not depend on the network or on expiry dates.
 */
public class NetTest {
    private static final Date RECORDED = new Date(1790936754000L); // 2026-10-02T10:25:54Z

    private static List<X509Certificate> bundledRoots() throws Exception {
        File pem = new File("src/main/assets/cacerts.pem");
        if (!pem.isFile()) fail("assets/cacerts.pem fehlt – zuerst node scripts/build-android-web.js ausführen");
        try (InputStream in = new FileInputStream(pem)) {
            return Net.readPem(in);
        }
    }

    private List<X509Certificate> chain(String name) throws Exception {
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(name)) {
            return Net.readPem(in);
        }
    }

    private static void validate(List<X509Certificate> chain, List<X509Certificate> roots) throws Exception {
        Set<TrustAnchor> anchors = new HashSet<>();
        for (X509Certificate r : roots) anchors.add(new TrustAnchor(r, null));
        PKIXParameters params = new PKIXParameters(anchors);
        params.setRevocationEnabled(false);
        params.setDate(RECORDED);
        CertPath path = CertificateFactory.getInstance("X.509").generateCertPath(chain);
        CertPathValidator.getInstance("PKIX").validate(path, params);
    }

    @Test
    public void bundledRootsAreComplete() throws Exception {
        List<X509Certificate> roots = bundledRoots();
        assertTrue("at least 100 roots, got " + roots.size(), roots.size() >= 100);
        StringBuilder names = new StringBuilder();
        for (X509Certificate r : roots) names.append(r.getSubjectX500Principal().getName()).append('\n');
        assertTrue(names.toString().contains("ISRG Root X1"));
        assertTrue(names.toString().contains("USERTrust ECC Certification Authority"));
    }

    @Test
    public void acceptsGitHubApiChain() throws Exception {
        validate(chain("github-api-chain.pem"), bundledRoots()); // Sectigo E46 → USERTrust ECC
    }

    @Test
    public void acceptsGitHubDownloadChain() throws Exception {
        validate(chain("github-download-chain.pem"), bundledRoots()); // Let's Encrypt → ISRG Root X1
    }

    @Test
    public void rejectsChainsWithoutTheirRoot() throws Exception {
        List<X509Certificate> unrelated = chain("github-api-chain.pem").subList(0, 1); // a leaf is no root
        try {
            validate(chain("github-download-chain.pem"), unrelated);
            fail("chain accepted without its root");
        } catch (CertPathValidatorException expected) {
            // fine
        }
    }

    @Test
    public void socketFactoryBuildsFromBundledRoots() throws Exception {
        assertTrue(Net.socketFactory(bundledRoots(), true) != null);
    }
}
