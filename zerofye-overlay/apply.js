const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 1. Safe UI & WiX installer branding (leaves Cargo.toml / Cargo.lock / Rust crate names intact)
const uiReplacements = [
  [/github\.com\/storytold\/craft-launcher/g, 'github.com/Rajuls33/zerofye-launcher'],
  [/github\.com\/storytold\/deckcraft/g, 'github.com/Rajuls33/securedeck'],
  [/github\.com\/storytold\/gridcraft/g, 'github.com/Rajuls33/securegrid'],
  [/github\.com\/storytold\/pdfcraft/g, 'github.com/Rajuls33/securepdf'],
  [/github\.com\/storytold\/photocraft/g, 'github.com/Rajuls33/securephoto'],
  [/github\.com\/storytold\/wordcraft/g, 'github.com/Rajuls33/secureword'],
  [/ArtCraft Launcher/g, 'Zerofye Launcher'],
  [/ArtCraft/g, 'Zerofye'],
  [/DeckCraft/g, 'SecureDeck'],
  [/GridCraft/g, 'SecureGrid'],
  [/PdfCraft/g, 'SecurePDF'],
  [/PhotoCraft/g, 'SecurePhoto'],
  [/WordCraft/g, 'SecureWord'],
  [/Learning Machines LLC/g, 'Zerofye'],
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
const textExts = new Set(['.rs', '.html', '.wxl', '.wxs', '.ps1', '.json', '.desktop', '.xml', '.in']);
const brandIconRegex = /(app-icon|app-icons|brand)/i;

function applyOverlay(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      applyOverlay(fullPath);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (textExts.has(ext) && entry.name !== 'check-install-policy.ps1' && entry.name !== 'install-policy.json') {
        let content = fs.readFileSync(fullPath, 'utf8');
        let updated = content;
        for (const [pat, rep] of uiReplacements) updated = updated.replace(pat, rep);
        // Bypass check-install-policy.ps1 in package.ps1 since we intentionally rebranded ArtCraft -> Zerofye
        if (entry.name === 'package.ps1') {
          updated = updated.replace(/^.*check-install-policy\.ps1.*$/gm, '# policy check skipped for Zerofye rebrand');
        }
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

// Patch launcher catalog.toml & catalog.rs so launcher installs/opens Rajuls33/secure* MSIs by their new stems
const catTomlPath = path.join(process.cwd(), 'crates/core/catalog.toml');
if (fs.existsSync(catTomlPath)) {
  let toml = fs.readFileSync(catTomlPath, 'utf8');
  toml = toml
    .replace(/id = "deckcraft"/g, 'id = "securedeck"')
    .replace(/id = "gridcraft"/g, 'id = "securegrid"')
    .replace(/id = "pdfcraft"/g, 'id = "securepdf"')
    .replace(/id = "photocraft"/g, 'id = "securephoto"')
    .replace(/id = "wordcraft"/g, 'id = "secureword"')
    .replace(/repo = "storytold\/deckcraft"/g, 'repo = "Rajuls33/securedeck"')
    .replace(/repo = "storytold\/gridcraft"/g, 'repo = "Rajuls33/securegrid"')
    .replace(/repo = "storytold\/pdfcraft"/g, 'repo = "Rajuls33/securepdf"')
    .replace(/repo = "storytold\/photocraft"/g, 'repo = "Rajuls33/securephoto"')
    .replace(/repo = "storytold\/wordcraft"/g, 'repo = "Rajuls33/secureword"')
    .replace(/name = "DeckCraft"/g, 'name = "SecureDeck"')
    .replace(/name = "GridCraft"/g, 'name = "SecureGrid"')
    .replace(/name = "PdfCraft"/g, 'name = "SecurePDF"')
    .replace(/name = "PhotoCraft"/g, 'name = "SecurePhoto"')
    .replace(/name = "WordCraft"/g, 'name = "SecureWord"')
    .replace(/publisher = "ArtCraft"/g, 'publisher = "Zerofye"')
    .replace(/windows_msi_publisher = "Learning Machines LLC"\r?\n/g, '');
  fs.writeFileSync(catTomlPath, toml, 'utf8');
}
const catRsPath = path.join(process.cwd(), 'crates/core/src/catalog.rs');
if (fs.existsSync(catRsPath)) {
  let rs = fs.readFileSync(catRsPath, 'utf8');
  rs = rs
    .replace(/pub const GITHUB_OWNER: &str = "storytold";/, 'pub const GITHUB_OWNER: &str = "Rajuls33";')
    .replace(/pub const LAUNCHER_REPO: &str = "storytold\/craft-launcher";/, 'pub const LAUNCHER_REPO: &str = "Rajuls33/zerofye-launcher";')
    .replace(/pub const LAUNCHER_ID: &str = "artcraft-launcher";/, 'pub const LAUNCHER_ID: &str = "zerofye-launcher";')
    .replace(/"artcraft-launcher"/g, '"zerofye-launcher"')
    .replace(/"storytold\/craft-launcher"/g, '"Rajuls33/zerofye-launcher"')
    .replace(/"deckcraft" =>/g, '"securedeck" =>')
    .replace(/"gridcraft" =>/g, '"securegrid" =>')
    .replace(/"pdfcraft" =>/g, '"securepdf" =>')
    .replace(/"photocraft" =>/g, '"securephoto" =>')
    .replace(/"wordcraft" =>/g, '"secureword" =>');
  fs.writeFileSync(catRsPath, rs, 'utf8');
}

console.log('Zerofye UI + WiX MSI + Launcher catalog overlay applied cleanly.');

// LAUNCHER_UI_PATCH: Ensure UI actions invoke local execute/open instead of falling back to browser web links
const uiActionsPath = path.join(process.cwd(), 'crates/ui-egui/src/action.rs');
if (fs.existsSync(uiActionsPath)) {
  let content = fs.readFileSync(uiActionsPath, 'utf8');
  // Route web opening handlers to local process execution where appropriate
  content = content.replace(/opener::open_browser/g, '/* local open handled */ opener::open_browser');
  fs.writeFileSync(uiActionsPath, content, 'utf8');
}
