/* generate-splash.js — writes a 2732x2732 splash screen (dark, centered mark)
 * into assets/ for @capacitor/assets. Opaque RGB PNG, zero dependencies.
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

function draw(N) {
  const buf = Buffer.alloc(N * N * 4);
  const cx = N / 2, cy = N / 2;
  const discR = N * 0.13;
  const dcx = cx, dcy = cy;
  const slashHalf = N * 0.024;
  const x1 = dcx - discR * 0.95, y1 = dcy + discR * 0.95, x2 = dcx + discR * 0.95, y2 = dcy - discR * 0.95;

  const bgIn = [28, 28, 46], bgOut = [11, 11, 18];
  const discEdge = [223, 230, 255], discCenter = [255, 255, 255];
  const red = [255, 59, 70];

  function distToSeg(px, py) {
    const dx = x2 - x1, dy = y2 - y1;
    const t = clamp01(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const rr = Math.hypot(x - cx, y - cy) / (N * 0.6);
      let col = mix(bgIn, bgOut, clamp01(rr));
      const dd = Math.hypot(x - dcx, y - dcy);
      if (dd < discR + 2) {
        const disc = mix(discCenter, discEdge, clamp01(dd / discR));
        col = mix(col, disc, clamp01((discR - dd) / 2));
      }
      const ds = distToSeg(x + 0.5, y + 0.5);
      if (ds < slashHalf + 1) col = mix(col, red, clamp01((slashHalf - ds) / 2));
      buf[i] = Math.round(col[0]); buf[i + 1] = Math.round(col[1]); buf[i + 2] = Math.round(col[2]); buf[i + 3] = 255;
    }
  }
  return buf;
}

function crc32(b) { let c, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const b = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b), 0); return Buffer.concat([l, b, c]); }
function encodePNG(N, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(N * (N * 3 + 1));
  for (let y = 0; y < N; y++) { const rs = y * (N * 3 + 1); raw[rs] = 0; for (let x = 0; x < N; x++) { const s = (y * N + x) * 4, d = rs + 1 + x * 3; raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2]; } }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const dir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(dir, { recursive: true });
const png = encodePNG(2732, draw(2732));
fs.writeFileSync(path.join(dir, 'splash.png'), png);
fs.writeFileSync(path.join(dir, 'splash-dark.png'), png);
console.log('wrote assets/splash.png + splash-dark.png', png.length, 'bytes');
