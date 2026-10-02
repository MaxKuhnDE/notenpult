// Builds the web part of the Android app into android/app/src/main/assets/www:
//   index.html   CSP for the WebView, loads boot.js (version check, start errors)
//   js/app.js    renderer/ as one script for Chrome 92–95 (Android 5 WebView)
//   styles.css   renderer/styles.css, lowered for the same browsers
//   vendor/pdfjs pdf.js 3.11 legacy build (pdf.js 6 needs a newer Chrome)
// and assets/cacerts.pem: current root certificates for Net.java (Android 5's are outdated).
//
//   node scripts/build-android-web.js [output folder]
'use strict';

const { execFileSync, execSync } = require('node:child_process');
const { X509Certificate } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'android', 'app', 'src', 'main', 'assets');
const out = path.resolve(process.argv[2] || path.join(assets, 'www'));
const PDFJS_VERSION = '3.11.174';
const TARGET = ['chrome92'];

/** pdfjs-dist 3.11 via "npm pack": only the package itself, without its optional node-canvas dependency. */
function pdfjsLegacy() {
  const dir = path.join(root, 'node_modules', '.cache', `pdfjs-dist-${PDFJS_VERSION}`);
  const pkg = path.join(dir, 'package');
  if (fs.existsSync(path.join(pkg, 'legacy', 'build', 'pdf.worker.min.js'))) return pkg;
  fs.mkdirSync(dir, { recursive: true });
  execSync(`npm pack pdfjs-dist@${PDFJS_VERSION} --silent`, { cwd: dir, stdio: 'ignore' });
  execFileSync('tar', ['-xzf', `pdfjs-dist-${PDFJS_VERSION}.tgz`], { cwd: dir });
  return pkg;
}

/**
 * Mozilla's root list as Node ships it. GitHub needs ISRG Root X1 (downloads via Let's Encrypt)
 * and Sectigo/USERTrust (github.com, api.github.com) – none of them is known to Android 5.
 */
function writeRootCertificates(file) {
  const names = tls.rootCertificates.map((pem) => new X509Certificate(pem).subject);
  for (const needed of ['ISRG Root X1', 'USERTrust ECC Certification Authority']) {
    if (!names.some((n) => n.includes(needed))) throw new Error(`Stammzertifikat fehlt in Node: ${needed}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${tls.rootCertificates.join('\n')}\n`);
  return names.length;
}

async function main() {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'js'), { recursive: true });

  const pdfjs = pdfjsLegacy();
  const vendor = path.join(out, 'vendor', 'pdfjs');
  fs.mkdirSync(vendor, { recursive: true });
  for (const f of ['pdf.min.js', 'pdf.worker.min.js']) fs.copyFileSync(path.join(pdfjs, 'legacy', 'build', f), path.join(vendor, f));
  fs.copyFileSync(path.join(pdfjs, 'LICENSE'), path.join(vendor, 'LICENSE'));
  fs.cpSync(path.join(pdfjs, 'cmaps'), path.join(vendor, 'cmaps'), { recursive: true });
  fs.cpSync(path.join(pdfjs, 'standard_fonts'), path.join(vendor, 'standard_fonts'), { recursive: true });

  const shim = {
    name: 'pdfjs-legacy',
    setup(build) {
      build.onResolve({ filter: /vendor\/pdfjs\/pdf\.min\.mjs$/ }, () => ({ path: path.join(__dirname, 'android', 'pdfjs-shim.js') }));
    },
  };
  await esbuild.build({
    entryPoints: [path.join(root, 'renderer', 'js', 'app.js')],
    outfile: path.join(out, 'js', 'app.js'),
    bundle: true,
    format: 'iife',
    target: TARGET,
    charset: 'utf8',
    // render.js resolves pdf.js files relative to its own URL.
    define: { 'import.meta.url': 'document.baseURI' },
    plugins: [shim],
    logLevel: 'warning',
  });
  await esbuild.build({
    entryPoints: [path.join(root, 'renderer', 'styles.css')],
    outfile: path.join(out, 'styles.css'),
    bundle: true,
    target: TARGET,
    charset: 'utf8',
    logLevel: 'warning',
  });
  fs.copyFileSync(path.join(__dirname, 'android', 'boot.js'), path.join(out, 'boot.js'));

  let html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "connect-src 'self' blob: data:",
  ].join('; ');
  html = html
    .replace(/content="default-src[^"]*"/, `content="${csp}"`)
    .replace(/<script type="module" src="js\/app\.js"><\/script>/, '<script src="boot.js"></script>');
  if (!html.includes('boot.js') || html.includes('wasm-unsafe-eval')) throw new Error('renderer/index.html hat sich geändert – Ersetzungen anpassen');
  fs.writeFileSync(path.join(out, 'index.html'), html);

  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const size = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
  console.log(`Android-Web ${version} → ${path.relative(root, out)} (${(size(out) / 1048576).toFixed(1)} MB)`);
  // Only for the app itself (tests build into a temporary folder).
  if (!process.argv[2]) console.log(`Stammzertifikate: ${writeRootCertificates(path.join(assets, 'cacerts.pem'))} → assets/cacerts.pem`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
