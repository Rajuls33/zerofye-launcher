const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 1. Safe UI-only display replacements (never touches Cargo.toml, Cargo.lock, or Rust crate/mod names)
const uiReplacements = [
  [/github\.com\/storytold\/craft-launcher/g, 'github.com/Rajuls33/zerofye-launcher'],
  [/github\.com\/storytold\/deckcraft/g, 'github.com/Rajuls33/securedeck'],
  [/github\.com\/storytold\/gridcraft/g, 'github.com/Rajuls33/securegrid'],
  [/github\.com\/storytold\/pdfcraft/g, 'github.com/Rajuls33/securepdf'],
  [/github\.com\/storytold\/photocraft/g, 'github.com/Rajuls33/securephoto'],
  [/github\.com\/storytold\/wordcraft/g, 'github.com/Rajuls33/secureword'],
  [/"ArtCraft"/g, '"Zerofye"'],
  [/"DeckCraft"/g, '"SecureDeck"'],
  [/"GridCraft"/g, '"SecureGrid"'],
  [/"PdfCraft"/g, '"SecurePDF"'],
  [/"PhotoCraft"/g, '"SecurePhoto"'],
  [/"WordCraft"/g, '"SecureWord"'],
  [/CRAFT APP SUITE/g, 'ZEROFYE APP SUITE']
];

const APP_BADGES = {
  artcraft:    { code: 'Z',  bg: '#111111' },
  deckcraft:   { code: 'SD', bg: '#E85D04' },
  gridcraft:   { code: 'SG', bg: '#1B7F46' },
  pdfcraft:    { code: 'SP', bg: '#B91C1C' },
  photocraft:  { code: 'PX', bg: '#1D4ED8' },
  wordcraft:   { code: 'SW', bg: '#2563EB' }
};

function makeSvg(code, bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect x="8" y="8" width="240" height="240" rx="44" fill="${bg}" />
  <text x="128" y="152" font-family="monospace" font-weight="900" font-size="96" fill="#FFFFFF" text-anchor="middle">${code}</text>
  <text x="128" y="206" font-family="monospace" font-weight="700" font-size="22" fill="#FFFFFF" fill-opacity="0.85" text-anchor="middle" letter-spacing="3">ZEROFYE</text>
</svg>`;
}

function createPng(size, hexBg) {
  const r = parseInt(hexBg.slice(1, 3), 16);
  const g = parseInt(hexBg.slice(3, 5), 16);
  const b = parseInt(hexBg.slice(5, 7), 16);
  const rowSize = size * 4 + 1;
  const raw = Buffer.alloc(rowSize * size);
  const pad = Math.floor(size * 0.14);
  const stroke = Math.max(2, Math.floor(size * 0.11));

  for (let y = 0; y < size; y++) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < size; x++) {
      const idx = y * rowSize + 1 + x * 4;
      let isFg = false;
      if (x >= pad && x < size - pad && y >= pad && y < size - pad) {
        const innerW = size - 2 * pad;
        const innerH = size - 2 * pad;
        const lx = x - pad;
        const ly = y - pad;
        if (ly < stroke || ly >= innerH - stroke || Math.abs((innerW - lx) - ly) < stroke * 0.85) isFg = true;
      }
      raw[idx] = isFg ? 255 : r;
      raw[idx + 1] = isFg ? 255 : g;
      raw[idx + 2] = isFg ? 255 : b;
      raw[idx + 3] = 255;
    }
  }

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function createIco(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 64; entry[1] = 64;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngBuf]);
}

const ignoreDirs = new Set(['.git', 'node_modules', 'target', 'zerofye-overlay']);
const brandIconRegex = /(app-icon|app-icons|brand)/i;

function applyOverlay(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      applyOverlay(fullPath);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.rs' || ext === '.html') {
        let content = fs.readFileSync(fullPath, 'utf8');
        let updated = content;
        for (const [pat, rep] of uiReplacements) updated = updated.replace(pat, rep);
        if (updated !== content) fs.writeFileSync(fullPath, updated, 'utf8');
      } else if (brandIconRegex.test(dir)) {
        const base = path.basename(entry.name, ext).toLowerCase();
        const badge = Object.entries(APP_BADGES).find(([k]) => base.includes(k))?.[1] || { code: 'Z', bg: '#111111' };
        if (ext === '.svg') fs.writeFileSync(fullPath, makeSvg(badge.code, badge.bg), 'utf8');
        else if (ext === '.png') {
          const m = entry.name.match(/(\d{2,4})/);
          const sz = m ? Math.min(512, Math.max(16, parseInt(m[1], 10))) : 128;
          fs.writeFileSync(fullPath, createPng(sz, badge.bg));
        } else if (ext === '.ico') fs.writeFileSync(fullPath, createIco(createPng(64, badge.bg)));
      }
    }
  }
}

applyOverlay(process.cwd());
console.log('Zerofye build-time overlay applied cleanly.');
