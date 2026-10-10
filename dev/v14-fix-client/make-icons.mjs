#!/usr/bin/env node
// Space Party app icons, drawn procedurally: plain Node 20+, no dependencies, no browser.
//   node dev/v14-fix-client/make-icons.mjs
// Writes (relative to the repo root, found from this file's own location):
//   icons/icon-180.png           apple-touch-icon
//   icons/icon-192.png           manifest, purpose "any"
//   icons/icon-512.png           manifest, purpose "any" (the rocket's bounding box fills the central 80 %)
//   icons/icon-maskable-512.png  manifest, purpose "maskable" (the rocket within the central 66 % and inside the
//                                40 %-radius safe circle; the sky and the stars run full bleed)
// The game's Fortnite sticker look: a violet radial sky (#4f2dbb near the top-left, #241568, #0d0b2e in the corners),
// white and gold stars, and a chunky cartoon rocket tilted 35° (white body with a thick #120a2e outline, a blue
// #2b7bff window with a white rim, red #ff3b5c fins, a gold #ffcb3d / #ffb000 flame). Every pixel is opaque (8-bit
// RGB: iOS paints transparent pixels black). Shapes are signed distance functions, painted back to front; each pixel
// averages 4 × 4 samples (anti-aliasing). Deterministic: the same bytes on every run.
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(ROOT, "icons");

// ---------------------------------------------------------------- PNG: 8-bit RGB, filter 0 (None) on every row
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0); // the CRC covers the type and the data
  return Buffer.concat([head, data, crc]);
}
function encodePng(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h); // each row: filter byte 0, then the row's pixels
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13); // width, height, bit depth 8, colour type 2 (RGB), compression / filter / interlace 0
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- shapes (signed distances: < 0 inside)
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const COL = {
  ink: hex("#120a2e"), white: hex("#ffffff"), shade: hex("#d8d0f4"), blue: hex("#2b7bff"), red: hex("#ff3b5c"),
  gold: hex("#ffcb3d"), gold2: hex("#ffb000"), core: hex("#fff3c4"), nozzle: hex("#8a7fd0"),
  sky0: hex("#4f2dbb"), sky1: hex("#241568"), sky2: hex("#0d0b2e"), glow: hex("#8d6bff"),
};
const circle = (x, y, cx, cy, r) => Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) - r;
const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
// exact signed distance to a closed polygon (after Inigo Quilez)
function polygon(x, y, P) {
  let d = (x - P[0][0]) ** 2 + (y - P[0][1]) ** 2;
  let s = 1;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const ex = P[j][0] - P[i][0], ey = P[j][1] - P[i][1], wx = x - P[i][0], wy = y - P[i][1];
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const bx = wx - ex * t, by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = y >= P[i][1], c2 = y < P[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

// The rocket in its own units: nose up at y = -1, x right, y down. A lens body (two circles) with a flat base.
const OUTLINE = 0.075;
const body = (x, y) => Math.max(circle(x, y, 0.98, 0, 1.4), circle(x, y, -0.98, 0, 1.4), y - 0.62);
const FIN_L = [[-0.12, 0.06], [-0.6, 0.5], [-0.62, 0.86], [-0.14, 0.64]];
const FIN_R = FIN_L.map(([x, y]) => [-x, y]);
const NOZZLE = [[-0.2, 0.55], [0.2, 0.55], [0.16, 0.75], [-0.16, 0.75]];
const flame = (x, y, k) => {
  const a = smin(circle(x, y, 0, 0.78, 0.2 * k), circle(x, y, 0, 0.78 + 0.2 * k, 0.15 * k), 0.12);
  const b = smin(circle(x, y, 0, 0.78 + 0.37 * k, 0.09 * k), circle(x, y, 0, 0.78 + 0.5 * k, 0.04 * k), 0.12);
  return smin(a, b, 0.12);
};
// back to front: [signed distance, fill, outline width (painted in ink just outside the shape)]
const LAYERS = [
  [(x, y) => flame(x, y, 1), COL.gold2, OUTLINE],
  [(x, y) => flame(x, y, 0.62), COL.gold, 0],
  [(x, y) => circle(x, y, 0, 0.8, 0.06), COL.core, 0],
  [(x, y) => polygon(x, y, FIN_L) - 0.05, COL.red, OUTLINE],
  [(x, y) => polygon(x, y, FIN_R) - 0.05, COL.red, OUTLINE],
  [(x, y) => polygon(x, y, NOZZLE) - 0.03, COL.nozzle, OUTLINE],
  [body, COL.white, OUTLINE],
  [(x, y) => Math.max(body(x, y), -body(x + 0.13, y)), COL.shade, 0], // the shaded right flank
  [(x, y) => Math.max(body(x, y), y + 0.5), COL.red, 0.045], // nose cone, a thinner seam line
  [(x, y) => circle(x, y, 0, -0.12, 0.165), COL.white, OUTLINE], // window rim
  [(x, y) => circle(x, y, 0, -0.12, 0.112), COL.blue, 0.03], // glass, a thin dark ring inside the rim
  [(x, y) => circle(x, y, -0.04, -0.162, 0.034), COL.white, 0], // glint
];
function rocketAt(lx, ly) {
  let col = null;
  for (const [sd, fill, ow] of LAYERS) {
    const d = sd(lx, ly);
    if (d < 0) col = fill;
    else if (d < ow) col = COL.ink;
  }
  return col;
}

const TILT = (35 * Math.PI) / 180; // clockwise: the nose points up and to the right
const COS = Math.cos(TILT), SIN = Math.sin(TILT);

// Where the tilted rocket lands at scale 1: bounding box (its centre goes to the icon centre) and the farthest point.
function measure() {
  const pts = [];
  for (let ly = -1.3; ly <= 1.6; ly += 0.01) {
    for (let lx = -1.0; lx <= 1.0; lx += 0.01) if (rocketAt(lx, ly)) pts.push([COS * lx - SIN * ly, SIN * lx + COS * ly]);
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  let r = 0;
  for (const [x, y] of pts) r = Math.max(r, Math.hypot(x - mx, y - my));
  return { mx, my, size: Math.max(x1 - x0, y1 - y0), r };
}
const M = measure();
const S_ANY = 0.8 / M.size; // the bounding box fills the central 80 %
const S_MASK = Math.min(0.66 / M.size, 0.4 / M.r); // central 66 %, and every rocket pixel inside the safe circle

// ---------------------------------------------------------------- the scene
// [u, v, size, gold, 4-point sparkle (else a round dot)], in the free corners beside the rocket's diagonal
const STARS = [
  [0.23, 0.23, 0.065, 1, 1], [0.82, 0.75, 0.048, 0, 1], [0.42, 0.12, 0.016, 0, 0], [0.1, 0.43, 0.013, 0, 0],
  [0.91, 0.5, 0.014, 1, 0], [0.12, 0.1, 0.011, 0, 0], [0.9, 0.92, 0.012, 1, 0], [0.08, 0.8, 0.011, 0, 0],
];
const mix = (out, c, a) => {
  for (let i = 0; i < 3; i++) out[i] += (c[i] - out[i]) * a;
};

function shade(u, v, S, k, out) {
  // sky: a radial gradient from the upper left, plus a faint glow behind the rocket
  const t = Math.min(1, Math.hypot(u - 0.34, v - 0.28) / 0.86);
  const e = t * t * (3 - 2 * t);
  const [a, b, f] = e < 0.5 ? [COL.sky0, COL.sky1, e * 2] : [COL.sky1, COL.sky2, e * 2 - 1];
  for (let i = 0; i < 3; i++) out[i] = a[i] + (b[i] - a[i]) * f;
  const g = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) / (0.58 * k));
  mix(out, COL.glow, 0.2 * g * g);
  for (const [su, sv, size, gold, sparkle] of STARS) {
    const s = size * k;
    const dx = Math.abs(u - (0.5 + (su - 0.5) * k)) / s, dy = Math.abs(v - (0.5 + (sv - 0.5) * k)) / s;
    const c = gold ? COL.gold : COL.white;
    if (sparkle) {
      const r = Math.hypot(dx, dy);
      if (r < 1.8) mix(out, c, 0.28 * (1 - r / 1.8) ** 2); // soft halo
      if (Math.sqrt(dx) + Math.sqrt(dy) <= 1) mix(out, c, 1);
    } else if (dx * dx + dy * dy <= 1) mix(out, c, 1);
  }
  // the rocket: icon space → rocket space (undo the centring, the scale and the tilt)
  const sx = (u - 0.5) / S + M.mx, sy = (v - 0.5) / S + M.my;
  const lx = COS * sx + SIN * sy, ly = -SIN * sx + COS * sy;
  if (lx * lx + (ly - 0.2) * (ly - 0.2) < 2.6) {
    const col = rocketAt(lx, ly);
    if (col) mix(out, col, 1);
  }
}

function render(size, S) {
  const k = S / S_ANY; // the maskable icon shrinks the stars' layout with the rocket
  const rgb = Buffer.alloc(size * size * 3);
  const out = [0, 0, 0];
  const N = 4; // 4 × 4 samples per pixel
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          shade((px + (i + 0.5) / N) / size, (py + (j + 0.5) / N) / size, S, k, out);
          r += out[0];
          g += out[1];
          b += out[2];
        }
      }
      const o = (py * size + px) * 3;
      rgb[o] = Math.round(r / (N * N));
      rgb[o + 1] = Math.round(g / (N * N));
      rgb[o + 2] = Math.round(b / (N * N));
    }
  }
  return encodePng(size, size, rgb);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size, S] of [["icon-180.png", 180, S_ANY], ["icon-192.png", 192, S_ANY], ["icon-512.png", 512, S_ANY], ["icon-maskable-512.png", 512, S_MASK]]) {
  const png = render(size, S);
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  const box = Math.round(M.size * S * 100), far = Math.round(M.r * S * 100);
  console.log(`icons/${name}  ${size}x${size}  ${png.length} bytes  rocket box ${box} % of the side, farthest point ${far} % from the centre`);
}
