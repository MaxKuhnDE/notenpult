// Generates fake sheet-music PDFs and one PNG scan for testing.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const out = path.join(__dirname, 'samples');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let seed = 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);

function circle(cx, cy, r) {
  const k = 0.5523 * r;
  return `${cx + r} ${cy} m ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c `
    + `${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c `
    + `${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c `
    + `${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c f\n`;
}

/**
 * Draws a fake sheet into the area W x H (points). `yTop` is the top edge of
 * the area on the page (to put an A5 sheet onto the upper half of an A4 page).
 */
function pageContent(title, part, i, n, W = 595, H = 842, yTop = H) {
  let s = '';
  const x0 = 50;
  const x1 = W - 50;
  if (i === 1) {
    const w = title.length * 22 * 0.56;
    s += `BT /F1 22 Tf 1 0 0 1 ${(W - w) / 2} ${yTop - 52} Tm (${esc(title)}) Tj ET\n`;
    s += `BT /F2 11 Tf 1 0 0 1 ${x0} ${yTop - 77} Tm (${esc(part)}) Tj ET\n`;
    s += `BT /F2 11 Tf 1 0 0 1 ${x1 - 60} ${yTop - 77} Tm (Marsch) Tj ET\n`;
  } else {
    s += `BT /F2 10 Tf 1 0 0 1 ${x0} ${yTop - 37} Tm (${esc(title)} - ${esc(part)}) Tj ET\n`;
  }
  const top = yTop - (i === 1 ? 107 : 62);
  const staves = Math.floor((top - (yTop - H) - 50) / 66) + 1;
  s += '0.6 w 0 G\n';
  for (let st = 0; st < staves; st++) {
    const y0 = top - st * 66;
    for (let l = 0; l < 5; l++) s += `${x0} ${y0 - l * 7} m ${x1} ${y0 - l * 7} l S\n`;
    s += `${x0} ${y0} m ${x0} ${y0 - 28} l S\n`;
    const bars = Math.max(2, Math.round((x1 - x0) / 124));
    const bw = (x1 - x0 - 40) / bars;
    for (let b = 1; b <= bars; b++) {
      const x = x0 + 40 + b * bw;
      s += `${x} ${y0} m ${x} ${y0 - 28} l S\n`;
    }
    for (let b = 0; b < bars; b++) {
      for (let k = 0; k < 4; k++) {
        const x = x0 + 40 + b * bw + 18 + k * ((bw - 24) / 4);
        const pos = Math.floor(rnd() * 9);
        const y = y0 - 28 + pos * 3.5;
        s += circle(x, y, 3.3);
        s += `1 w ${x + 3} ${y} m ${x + 3} ${y + 21} l S 0.6 w\n`;
      }
    }
    s += `BT /F1 20 Tf 1 0 0 1 ${x0 + 4} ${y0 - 24} Tm (&) Tj ET\n`;
  }
  s += `BT /F2 10 Tf 1 0 0 1 ${W / 2 - 25} ${yTop - H + 22} Tm (Seite ${i} / ${n}) Tj ET\n`;
  return s;
}

function makePdf(file, title, part, pages, { W = 595, H = 842, contentH = H, dir = out } = {}) {
  const objs = [];
  const add = (body) => {
    objs.push(body);
    return objs.length;
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (let i = 1; i <= pages; i++) {
    const content = pageContent(title, part, i, pages, W, contentH, H);
    const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), Buffer.from(pdf, 'latin1'));
}

function makePng(file, w, hgt) {
  const raw = Buffer.alloc((w + 1) * hgt, 255);
  for (let y = 0; y < hgt; y++) raw[y * (w + 1)] = 0; // filter byte
  const setPx = (x, y, v) => {
    if (x >= 0 && y >= 0 && x < w && y < hgt) raw[y * (w + 1) + 1 + x] = v;
  };
  for (let st = 0; st < 9; st++) {
    const y0 = 220 + st * 165;
    for (let l = 0; l < 5; l++) for (let x = 110; x < w - 110; x++) for (let t = 0; t < 2; t++) setPx(x, y0 + l * 18 + t, 30);
    for (let k = 0; k < 16; k++) {
      const cx = 220 + k * 58;
      const cy = y0 + Math.floor(rnd() * 9) * 9;
      for (let dy = -8; dy <= 8; dy++) for (let dx = -10; dx <= 10; dx++) if ((dx * dx) / 100 + (dy * dy) / 64 <= 1) setPx(cx + dx, cy + dy, 20);
      for (let dy = 0; dy < 55; dy++) for (let t = 0; t < 2; t++) setPx(cx + 9 + t, cy - dy, 20);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(hgt, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path.join(out, file), png);
}

makePdf('Florentiner Marsch.pdf', 'Florentiner Marsch', 'Flügelhorn 1 in B', 2);
makePdf('Böhmischer Traum.pdf', 'Böhmischer Traum', 'Flügelhorn 1 in B', 1);
makePdf('Alte Kameraden.pdf', 'Alte Kameraden', 'Flügelhorn 1 in B', 3);
makePdf('Zillertaler_Hochzeitsmarsch.pdf', 'Zillertaler Hochzeitsmarsch', 'Flügelhorn 1 in B', 1);
makePdf('Abel Tasman.pdf', 'Abel Tasman', 'Flügelhorn 1 in B', 2);
makePdf('Ein Leben lang.pdf', 'Ein Leben lang', 'Flügelhorn 1 in B', 1);
makePng('Polka Nr 5.png', 1240, 1754);

// A4/A5 formats
const A5L = { W: 595, H: 420 }; // A5 landscape (Marschbuch)
makePdf('Bergsee-Marsch (A5).pdf', 'Bergsee-Marsch', 'Flügelhorn 1 in B', 2, A5L);
makePdf('Kleiner Marsch (A5 auf A4).pdf', 'Kleiner Marsch', 'Flügelhorn 1 in B', 1, { W: 595, H: 842, contentH: 420 });
makePdf('Florentiner Marsch - 2. Stimme.pdf', 'Florentiner Marsch', 'Flügelhorn 2 in B', 2);

// Simulated Google Drive "Noten-Pool"
const pool = path.join(__dirname, 'pool');
fs.rmSync(pool, { recursive: true, force: true });
const P = { dir: pool };
makePdf('Polkas\\Rosen aus dem Süden\\Flügelhorn 1.pdf', 'Rosen aus dem Süden', 'Flügelhorn 1 in B', 1, P);
makePdf('Polkas\\Rosen aus dem Süden\\Flügelhorn 2.pdf', 'Rosen aus dem Süden', 'Flügelhorn 2 in B', 1, P);
makePdf('Polkas\\Rosen aus dem Süden\\Tenorhorn.pdf', 'Rosen aus dem Süden', 'Tenorhorn in B', 1, P);
makePdf('Märsche\\Gruß aus Tirol\\Flügelhorn 1.pdf', 'Gruß aus Tirol', 'Flügelhorn 1 in B', 2, { ...P, ...A5L });
makePdf('Märsche\\Gruß aus Tirol\\Tenorhorn.pdf', 'Gruß aus Tirol', 'Tenorhorn in B', 2, { ...P, ...A5L });
makePdf('Choral Abendlied - Flügelhorn 1.pdf', 'Choral Abendlied', 'Flügelhorn 1 in B', 1, P);
console.log('samples written to', out, 'and', pool);
