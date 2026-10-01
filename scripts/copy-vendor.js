// Copies the parts of pdfjs-dist the app needs into renderer/vendor/pdfjs.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'pdfjs-dist');
const dest = path.join(root, 'renderer', 'vendor', 'pdfjs');

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  fs.copyFileSync(path.join(src, 'build', file), path.join(dest, file));
}
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (fs.existsSync(path.join(src, dir))) {
    fs.cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true });
  }
}
fs.copyFileSync(path.join(src, 'LICENSE'), path.join(dest, 'LICENSE'));

console.log('pdf.js copied to', path.relative(root, dest));
