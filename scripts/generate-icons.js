/* generate-icons.js — writes PNG app icons with zero dependencies.
 * Design: gradient rounded square + white "button" disc + red "no" slash.
 * Usage: node scripts/generate-icons.js
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function drawIcon(N) {
  const buf = Buffer.alloc(N * N * 4);
  const r = N * 0.225;            // corner radius
  const cx = N * 0.5, cy = N * 0.465;
  const discR = N * 0.258;
  const x1 = N * 0.26, y1 = N * 0.75, x2 = N * 0.74, y2 = N * 0.235;
  const slashHalf = N * 0.05;

  const blue = [79, 140, 255], purple = [124, 92, 255];
  const discEdge = [223, 230, 255], discCenter = [255, 255, 255];
  const red = [255, 59, 70];

  function insideRounded(x, y) {
    const nx = Math.min(Math.max(x, r), N - r);
    const ny = Math.min(Math.max(y, r), N - r);
    const dx = x - nx, dy = y - ny;
    return dx * dx + dy * dy <= r * r;
  }
  function distToSeg(px, py) {
    const dx = x2 - x1, dy = y2 - y1;
    const t = clamp01(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy));
    const lx = x1 + t * dx, ly = y1 + t * dy;
    return Math.hypot(px - lx, py - ly);
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      if (!insideRounded(x + 0.5, y + 0.5)) { buf[i + 3] = 0; continue; }
      const g = (x + y) / (2 * N);
      let col = mix(blue, purple, g);
      const dd = Math.hypot(x - cx, y - cy);
      if (dd < discR) {
        const disc = mix(discCenter, discEdge, dd / discR);
        const aa = clamp01((discR - dd) / 2);
        col = mix(col, disc, aa);
      }
      const ds = distToSeg(x + 0.5, y + 0.5);
      if (ds < slashHalf) {
        const aa = clamp01((slashHalf - ds) / 2);
        col = mix(col, red, aa);
      }
      buf[i] = Math.round(col[0]);
      buf[i + 1] = Math.round(col[1]);
      buf[i + 2] = Math.round(col[2]);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(N, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0;
    rgba.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = path.join(__dirname, '..', 'icons');
[[512, 'icon-512.png'], [192, 'icon-192.png'], [180, 'apple-touch-icon.png']].forEach(function (spec) {
  const N = spec[0], name = spec[1];
  const png = encodePNG(N, drawIcon(N));
  fs.writeFileSync(path.join(outDir, name), png);
  console.log('wrote', name, png.length, 'bytes');
});
