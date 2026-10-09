// Sample drawings for the v1.1 client tests: pure Node (zlib only), no dependencies, no browser.
//   const S = require("./samples.cjs");
//   S.NAMES                           ["ship", "controller", "car", "bike", "astronaut", "dog"]
//   S.render(name, { variant, size }) → { name, variant, width, height, png (Buffer), dataUrl, strokes, aspect }
//   S.dataUrl(name, variant)          → "data:image/png;base64,..."
//   S.strokesForPad(name, variant, padAspect) → strokes (arrays of [x, y], 0..1 of a pad with that width/height ratio) to
//                                      replay with pointer events when a page has no drawSample hook
//   S.writeAll(dir, variants)         → writes <name>.png (variant 0), <ship>-v1.png... and contact-sheet.png
// CLI: node dev/v11-client/samples.cjs [--out dir] [--variants N]   (default out: dev/v11-client/samples)
// Look: dark ink (#1a1a1a) on white, round pen, hand wobble, at most 512 px on the longest side, like the phone's own export
// (ship / explorers are cropped to the ink box + 4 % margin; the controller is the whole pad, 2.2 : 1).
// Variant 0 is the clean reference drawing; variant n > 0 changes proportions, parts and wobble deterministically, so a
// lobby of seeded players gets different ships. The ship is a rocket seen from the side, nose to the RIGHT (what inflate.js
// expects), with exhaust flames at the back (boost) and a cannon on top (shoot).
"use strict";
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const NAMES = ["ship", "controller", "car", "bike", "astronaut", "dog"];
const INK = 26;          // #1a1a1a
const MAX_PX = 512;
const PAD_ASPECT = 2.2;  // the controller drawing is the whole pad

// ---- PNG (8-bit grayscale) ----------------------------------------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
// data: w*h bytes (channels 1, grayscale) or w*h*3 bytes (channels 3, RGB).
function encodePng(w, h, data, channels = 1) {
  const stride = w * channels;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = channels === 3 ? 2 : 0;   // 8 bit, RGB or grayscale
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---- Thick-line rasteriser ------------------------------------------------------------------------------------------------

// strokes: arrays of [x, y] in pixels; returns coverage 0..1 per pixel (round caps and joins, anti-aliased by distance).
function rasterise(strokes, w, h, widthPx) {
  const cov = new Float32Array(w * h);
  const r = widthPx / 2;
  const segment = (a, b) => {
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r - 1)), x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0]) + r + 1));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r - 1)), y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1]) + r + 1));
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        let t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
        const c = r + 0.5 - d;
        const v = c <= 0 ? 0 : c >= 1 ? 1 : c;
        if (v > cov[y * w + x]) cov[y * w + x] = v;
      }
    }
  };
  for (const s of strokes) {
    if (s.length === 1) segment(s[0], s[0]);
    for (let i = 1; i < s.length; i++) segment(s[i - 1], s[i]);
  }
  return cov;
}

// ---- Geometry helpers (design space: 1 unit = the drawing's height, x grows right, y grows DOWN) -----------------------------

const TAU = Math.PI * 2;
const arc = (cx, cy, rx, ry, a0, a1, n = 28) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
const circle = (cx, cy, r) => arc(cx, cy, r, r, 0, TAU, 36);
const ellipse = (cx, cy, rx, ry) => arc(cx, cy, rx, ry, 0, TAU, 40);
function rrect(x, y, w, h, r = 0.04) {
  r = Math.min(r, w / 2, h / 2);
  return [...arc(x + w - r, y + r, r, r, -Math.PI / 2, 0, 6), ...arc(x + w - r, y + h - r, r, r, 0, Math.PI / 2, 6), ...arc(x + r, y + h - r, r, r, Math.PI / 2, Math.PI, 6), ...arc(x + r, y + r, r, r, Math.PI, Math.PI * 1.5, 6), [x + w - r, y]];
}
// Catmull-Rom through the points (a smooth organic line).
function spline(pts, { closed = false, seg = 8 } = {}) {
  const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let s = 0; s < seg; s++) {
      const t = s / seg, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(closed ? out[0] : P[P.length - 2]);
  return out;
}
const rot = (pts, cx, cy, a) => pts.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);

// A tiny stroke font (capital letters) on a 0.7 x 1 box, y down. Enough for FIRE, BOOST, LAND, DIG, SCAN...
const GLYPHS = {
  A: [[[0, 1], [0.35, 0], [0.7, 1]], [[0.13, 0.65], [0.57, 0.65]]],
  B: [[[0, 1], [0, 0], [0.45, 0], [0.6, 0.12], [0.6, 0.38], [0.45, 0.5], [0, 0.5]], [[0.45, 0.5], [0.65, 0.62], [0.65, 0.88], [0.5, 1], [0, 1]]],
  C: [[[0.7, 0.15], [0.5, 0], [0.2, 0], [0, 0.2], [0, 0.8], [0.2, 1], [0.5, 1], [0.7, 0.85]]],
  D: [[[0, 0], [0, 1], [0.35, 1], [0.65, 0.8], [0.65, 0.2], [0.35, 0], [0, 0]]],
  E: [[[0.65, 0], [0, 0], [0, 1], [0.65, 1]], [[0, 0.5], [0.5, 0.5]]],
  F: [[[0.65, 0], [0, 0], [0, 1]], [[0, 0.5], [0.5, 0.5]]],
  G: [[[0.7, 0.15], [0.5, 0], [0.2, 0], [0, 0.2], [0, 0.8], [0.2, 1], [0.5, 1], [0.7, 0.8], [0.7, 0.55], [0.4, 0.55]]],
  H: [[[0, 0], [0, 1]], [[0.65, 0], [0.65, 1]], [[0, 0.5], [0.65, 0.5]]],
  I: [[[0.1, 0], [0.5, 0]], [[0.3, 0], [0.3, 1]], [[0.1, 1], [0.5, 1]]],
  J: [[[0.5, 0], [0.5, 0.8], [0.35, 1], [0.15, 1], [0, 0.85]]],
  K: [[[0, 0], [0, 1]], [[0.65, 0], [0, 0.55]], [[0.2, 0.4], [0.65, 1]]],
  L: [[[0, 0], [0, 1], [0.6, 1]]],
  M: [[[0, 1], [0, 0], [0.35, 0.55], [0.7, 0], [0.7, 1]]],
  N: [[[0, 1], [0, 0], [0.65, 1], [0.65, 0]]],
  O: [[[0.2, 0], [0.5, 0], [0.7, 0.2], [0.7, 0.8], [0.5, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0]]],
  P: [[[0, 1], [0, 0], [0.45, 0], [0.65, 0.15], [0.65, 0.4], [0.45, 0.55], [0, 0.55]]],
  Q: [[[0.2, 0], [0.5, 0], [0.7, 0.2], [0.7, 0.8], [0.5, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0]], [[0.4, 0.7], [0.72, 1.05]]],
  R: [[[0, 1], [0, 0], [0.45, 0], [0.65, 0.15], [0.65, 0.4], [0.45, 0.55], [0, 0.55]], [[0.3, 0.55], [0.65, 1]]],
  S: [[[0.65, 0.15], [0.45, 0], [0.2, 0], [0, 0.15], [0, 0.35], [0.2, 0.5], [0.45, 0.5], [0.65, 0.65], [0.65, 0.85], [0.45, 1], [0.2, 1], [0, 0.85]]],
  T: [[[0, 0], [0.7, 0]], [[0.35, 0], [0.35, 1]]],
  U: [[[0, 0], [0, 0.8], [0.2, 1], [0.5, 1], [0.7, 0.8], [0.7, 0]]],
  V: [[[0, 0], [0.35, 1], [0.7, 0]]],
  W: [[[0, 0], [0.15, 1], [0.35, 0.4], [0.55, 1], [0.7, 0]]],
  X: [[[0, 0], [0.7, 1]], [[0.7, 0], [0, 1]]],
  Y: [[[0, 0], [0.35, 0.5], [0.7, 0]], [[0.35, 0.5], [0.35, 1]]],
  Z: [[[0, 0], [0.7, 0], [0, 1], [0.7, 1]]],
  0: [[[0.2, 0], [0.5, 0], [0.7, 0.2], [0.7, 0.8], [0.5, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0]]],
  1: [[[0.1, 0.2], [0.35, 0], [0.35, 1]]],
  2: [[[0, 0.2], [0.2, 0], [0.5, 0], [0.7, 0.2], [0.7, 0.4], [0, 1], [0.7, 1]]],
  3: [[[0, 0.1], [0.2, 0], [0.5, 0], [0.7, 0.15], [0.7, 0.4], [0.45, 0.5], [0.7, 0.6], [0.7, 0.85], [0.5, 1], [0.2, 1], [0, 0.9]]],
  4: [[[0.55, 1], [0.55, 0], [0, 0.65], [0.7, 0.65]]],
  5: [[[0.65, 0], [0.05, 0], [0, 0.45], [0.4, 0.4], [0.65, 0.55], [0.7, 0.8], [0.5, 1], [0.2, 1], [0, 0.9]]],
  6: [[[0.6, 0.05], [0.3, 0], [0, 0.3], [0, 0.8], [0.2, 1], [0.5, 1], [0.7, 0.8], [0.7, 0.6], [0.5, 0.45], [0.2, 0.45], [0, 0.6]]],
  7: [[[0, 0], [0.7, 0], [0.25, 1]]],
  8: [[[0.35, 0.5], [0.1, 0.4], [0.1, 0.1], [0.35, 0], [0.6, 0.1], [0.6, 0.4], [0.35, 0.5], [0.05, 0.62], [0, 0.88], [0.35, 1], [0.7, 0.88], [0.65, 0.62], [0.35, 0.5]]],
  9: [[[0.1, 0.95], [0.4, 1], [0.7, 0.7], [0.7, 0.2], [0.5, 0], [0.2, 0], [0, 0.2], [0, 0.4], [0.2, 0.55], [0.5, 0.55], [0.7, 0.4]]],
  "-": [[[0, 0.5], [0.6, 0.5]]],
  _: [[[0, 1], [0.7, 1]]],
  ".": [[[0.3, 0.95], [0.35, 1]]],
};
const textWidth = (str, h) => str.length * 0.7 * h + (str.length - 1) * 0.3 * h;
// The string's strokes with its left edge at x, top at y, letter height h.
function text(str, x, y, h) {
  const out = [];
  let cx = x;
  for (const ch of str.toUpperCase()) {
    for (const s of GLYPHS[ch] || []) out.push(s.map(([gx, gy]) => [cx + gx * h, y + gy * h]));
    cx += 1.0 * h;
  }
  return out;
}

// ---- Seeded randomness (variant n > 0) --------------------------------------------------------------------------------------

function rng(seed) {
  let a = (seed * 2654435761 + 12345) >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const f = (lo, hi) => lo + (hi - lo) * next();
  return { f, i: (lo, hi) => Math.floor(f(lo, hi + 1)), pick: (a) => a[Math.floor(next() * a.length)], next };
}
// Variant 0 returns the middle of every range, so it is the same clean drawing every time.
function params(variant) {
  if (!variant) return { f: (lo, hi) => (lo + hi) / 2, i: (lo, hi) => Math.round((lo + hi) / 2), pick: (a) => a[0], next: () => 0.5 };
  return rng(variant);
}

// ---- The drawings (each returns strokes in design space) ------------------------------------------------------------------

function ship(R) {
  const L = R.f(1.35, 1.85), H = R.f(0.36, 0.52), cy = 0.5, x0 = 0.45;
  const top = cy - H / 2, bot = cy + H / 2, nose = x0 + L, noseLen = R.f(0.4, 0.7);
  const strokes = [];
  // Hull: tail, top edge, a round nose cone, bottom edge, back to the tail.
  const cone = spline([[nose - noseLen, top], [nose - noseLen * 0.4, top + H * 0.14], [nose, cy], [nose - noseLen * 0.4, bot - H * 0.14], [nose - noseLen, bot]], { seg: 8 });
  strokes.push([[x0, top], [x0 + L * 0.3, top - 0.01], ...cone, [x0 + L * 0.3, bot + 0.01], [x0, bot], [x0 - 0.04, cy], [x0, top]]);
  // Fins top and bottom at the tail.
  const fin = R.f(0.16, 0.32), sweep = R.f(0.1, 0.25);
  strokes.push([[x0 + 0.04, top], [x0 - sweep, top - fin], [x0 + 0.36, top]]);
  strokes.push([[x0 + 0.04, bot], [x0 - sweep, bot + fin], [x0 + 0.36, bot]]);
  // Portholes along the hull.
  const windows = R.i(1, 3), wr = R.f(0.05, 0.075);
  for (let k = 0; k < windows; k++) strokes.push(circle(nose - noseLen - 0.1 - k * (wr * 2 + 0.1), cy, wr));
  // A band near the tail.
  strokes.push([[x0 + 0.3, top + 0.005], [x0 + 0.3, bot - 0.005]]);
  // Cannon on top: a turret block sitting on the hull and a tilted barrel with a muzzle ring.
  const tx = x0 + L * R.f(0.42, 0.55), ang = -R.f(0.3, 0.55), bl = R.f(0.34, 0.5), bw = 0.032, base = top - 0.05;
  strokes.push(rrect(tx - 0.1, base, 0.2, 0.052, 0.02));
  const at = (pts) => rot(pts.map(([x, y]) => [x, y + base]), tx, base, ang);
  strokes.push(at([[tx, -bw], [tx + bl, -bw], [tx + bl, bw], [tx, bw], [tx, -bw]]));
  strokes.push(at([[tx + bl + 0.015, -bw - 0.015], [tx + bl + 0.015, bw + 0.015]]));
  // Exhaust flames behind the tail: S-shaped tongues of fire (boost), the middle one longest.
  const tongues = R.i(2, 4), span = H * 0.6;
  for (let k = 0; k < tongues; k++) {
    const y = tongues === 1 ? cy : cy - span / 2 + (span * k) / (tongues - 1);
    const mid = 1 - Math.abs(k - (tongues - 1) / 2) / tongues;
    const len = R.f(0.42, 0.62) * mid, w = H * 0.15 + 0.01, phase = R.f(0, TAU), amp = R.f(0.25, 0.4) * w;
    const edge = (t, sign) => [x0 - 0.02 - len * t, y + sign * w * Math.pow(1 - t, 0.85) + Math.sin(t * Math.PI * 2 + phase) * amp * t];
    const up = Array.from({ length: 6 }, (_, i) => edge(i / 6, -1));
    const down = Array.from({ length: 6 }, (_, i) => edge((5 - i) / 6, 1));
    strokes.push(spline([...up, edge(1, 0), ...down], { seg: 4 }));
  }
  return { strokes, crop: true, width: 0.021 };
}

function controller(R) {
  const strokes = [];
  // Left: a steering stick (circle with a knob, a cross of arrows).
  const sx = R.f(0.46, 0.5), sy = R.f(0.5, 0.54), sr = R.f(0.34, 0.37);
  strokes.push(circle(sx, sy, sr));
  strokes.push(circle(sx + R.f(-0.03, 0.03), sy + R.f(-0.03, 0.03), sr * 0.42));
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const ax = sx + dx * sr * 0.72, ay = sy + dy * sr * 0.72;
    strokes.push([[ax - dx * 0.04 + dy * 0.035, ay - dy * 0.04 + dx * 0.035], [ax + dx * 0.04, ay + dy * 0.04], [ax - dx * 0.04 - dy * 0.035, ay - dy * 0.04 - dx * 0.035]]);
  }
  // Right: two labelled boxes, BOOST and FIRE.
  const b = { x: R.f(0.95, 0.99), y: R.f(0.48, 0.54), w: 0.6, h: R.f(0.36, 0.42) };
  strokes.push(rrect(b.x, b.y, b.w, b.h, 0.05));
  const bh = 0.11;
  strokes.push(...text("BOOST", b.x + (b.w - textWidth("BOOST", bh)) / 2, b.y + (b.h - bh) / 2, bh));
  const f = { x: R.f(1.64, 1.67), y: R.f(0.22, 0.3), w: 0.5, h: R.f(0.56, 0.64) };
  strokes.push(rrect(f.x, f.y, f.w, f.h, 0.06));
  const fh = 0.12;
  strokes.push(...text("FIRE", f.x + (f.w - textWidth("FIRE", fh)) / 2, f.y + (f.h - fh) / 2, fh));
  return { strokes, crop: false, aspect: PAD_ASPECT, width: 0.017 };
}

function car(R) {
  const strokes = [];
  const base = R.f(0.7, 0.76), r = R.f(0.15, 0.19), lowTop = R.f(0.45, 0.5), roof = R.f(0.2, 0.26);
  const x0 = 0.1, x1 = R.f(1.85, 2.05), c0 = R.f(0.55, 0.65), c1 = x1 - R.f(0.5, 0.6);
  // Body with a cabin on top, one outline.
  strokes.push([[x0, base], [x0, lowTop + 0.02], [c0 - 0.1, lowTop], [c0 + 0.08, roof], [c1 - 0.08, roof], [c1 + 0.12, lowTop], [x1 - 0.1, lowTop + 0.03], [x1, lowTop + 0.1], [x1, base], [x0, base]]);
  // Window posts and a door line.
  const mid = (c0 + c1) / 2;
  strokes.push([[mid, roof + 0.01], [mid, lowTop]]);
  strokes.push([[mid + 0.1, lowTop + 0.02], [mid + 0.1, base - 0.04]]);
  // Wheels with hubs.
  const wx = [x0 + R.f(0.32, 0.4), x1 - R.f(0.34, 0.42)];
  for (const x of wx) { strokes.push(circle(x, base + 0.02, r)); strokes.push(circle(x, base + 0.02, r * 0.38)); }
  // Headlight and tail light.
  strokes.push(circle(x1 - 0.06, lowTop + 0.1, 0.035));
  strokes.push([[x0 + 0.01, lowTop + 0.1], [x0 + 0.07, lowTop + 0.1]]);
  return { strokes, crop: true, width: 0.021 };
}

function bike(R) {
  const strokes = [];
  const wr = R.f(0.27, 0.32), y = 0.62, rx = 0.34, fx = rx + R.f(1.1, 1.3);
  strokes.push(circle(rx, y, wr), circle(fx, y, wr));
  strokes.push(circle(rx, y, 0.03), circle(fx, y, 0.03));
  // Spokes.
  for (const cx of [rx, fx]) for (const a of [0.4, 1.4, 2.4]) strokes.push([[cx + Math.cos(a) * wr * 0.95, y + Math.sin(a) * wr * 0.95], [cx - Math.cos(a) * wr * 0.95, y - Math.sin(a) * wr * 0.95]]);
  const bb = [rx + (fx - rx) * R.f(0.42, 0.5), y + 0.04], seat = [rx + (fx - rx) * R.f(0.3, 0.38), y - R.f(0.34, 0.4)], head = [fx - R.f(0.12, 0.2), y - R.f(0.36, 0.42)];
  strokes.push([[rx, y], bb, seat, [rx, y]]);   // rear triangle
  strokes.push([seat, head], [bb, head]);       // top and down tubes
  strokes.push([head, [fx, y]]);                // fork
  strokes.push([[head[0] - 0.02, head[1] - 0.06], [head[0] + 0.06, head[1] - 0.1], [head[0] + 0.16, head[1] - 0.06]]);   // handlebar
  strokes.push([[seat[0] - 0.12, seat[1] - 0.04], [seat[0] + 0.1, seat[1] - 0.04]]);   // saddle
  strokes.push(circle(bb[0], bb[1], 0.045), [[bb[0] - 0.07, bb[1] + 0.07], [bb[0] + 0.07, bb[1] - 0.07]]);   // pedals
  return { strokes, crop: true, width: 0.02 };
}

function astronaut(R) {
  const strokes = [];
  const cx = 0.5, hr = R.f(0.15, 0.18), headY = 0.2, shoulder = R.f(0.38, 0.4);
  strokes.push(circle(cx, headY, hr));                                  // helmet
  strokes.push(rrect(cx - hr * 0.62, headY - hr * 0.32, hr * 1.24, hr * 0.78, hr * 0.3));   // visor
  strokes.push(rrect(cx - 0.12, shoulder - 0.02, 0.24, R.f(0.28, 0.32), 0.05));                // torso
  strokes.push(rrect(cx - 0.065, shoulder + 0.06, 0.13, 0.07, 0.015));                         // chest panel
  strokes.push(rrect(cx - 0.17, shoulder + 0.02, 0.05, 0.2, 0.02));                            // backpack edge
  const armY = shoulder + 0.02, hand = R.f(0.2, 0.3);
  strokes.push([[cx - 0.12, armY], [cx - 0.22, armY + 0.1], [cx - 0.2, armY + hand]]);           // arms
  strokes.push([[cx + 0.12, armY], [cx + 0.22, armY + 0.1], [cx + 0.2, armY + hand]]);
  strokes.push(circle(cx - 0.2, armY + hand + 0.025, 0.03), circle(cx + 0.2, armY + hand + 0.025, 0.03));   // gloves
  const hip = shoulder + 0.28, foot = 0.93;
  strokes.push(rrect(cx - 0.115, hip - 0.04, 0.095, foot - hip, 0.03));                         // legs
  strokes.push(rrect(cx + 0.02, hip - 0.04, 0.095, foot - hip, 0.03));
  strokes.push(rrect(cx - 0.14, foot - 0.04, 0.12, 0.06, 0.02), rrect(cx + 0.02, foot - 0.04, 0.12, 0.06, 0.02));   // boots
  return { strokes, crop: true, width: 0.021 };
}

function dog(R) {
  const strokes = [];
  const bx = 0.75, by = R.f(0.46, 0.5), brx = R.f(0.38, 0.45), bry = R.f(0.17, 0.22);
  strokes.push(spline([[bx - brx, by - 0.02], [bx - brx * 0.5, by - bry], [bx + brx * 0.5, by - bry * 1.02], [bx + brx, by - 0.04], [bx + brx * 0.95, by + 0.08], [bx + brx * 0.4, by + bry], [bx - brx * 0.5, by + bry * 0.95], [bx - brx * 0.95, by + 0.06]], { closed: true, seg: 6 }));
  // Head, snout, ear, eye, nose.
  const hx = bx + brx + R.f(0.04, 0.1), hy = by - R.f(0.12, 0.18), hr = R.f(0.15, 0.18);
  strokes.push(circle(hx, hy, hr));
  strokes.push(ellipse(hx + hr * 1.05, hy + hr * 0.3, hr * 0.7, hr * 0.42));
  strokes.push(spline([[hx - hr * 0.5, hy - hr * 0.7], [hx - hr * 0.95, hy - hr * 0.2], [hx - hr * 0.85, hy + hr * 0.7], [hx - hr * 0.4, hy + hr * 0.5]], { seg: 6 }));
  strokes.push(circle(hx + hr * 0.25, hy - hr * 0.2, 0.014), circle(hx + hr * 1.62, hy + hr * 0.18, 0.022));
  // Four legs with paws, and a tail.
  const ground = by + bry + R.f(0.2, 0.27);
  for (const lx of [bx - brx * 0.62, bx - brx * 0.3, bx + brx * 0.35, bx + brx * 0.7]) {
    strokes.push(rrect(lx - 0.035, by + bry * 0.6, 0.07, ground - by - bry * 0.6, 0.025));
    strokes.push(ellipse(lx + 0.01, ground + 0.005, 0.05, 0.022));
  }
  strokes.push(spline([[bx - brx * 0.95, by], [bx - brx - 0.1, by - 0.1], [bx - brx - 0.12, by - 0.24], [bx - brx - 0.05, by - 0.3]], { seg: 6 }));
  return { strokes, crop: true, width: 0.02 };
}

const MAKERS = { ship, controller, car, bike, astronaut, dog };

// ---- Rendering ------------------------------------------------------------------------------------------------------------

// Hand wobble: split long segments, then shift every point a little (smoothed noise).
function wobble(strokes, amp, rand) {
  return strokes.map((s) => {
    const dense = [];
    for (let i = 0; i < s.length; i++) {
      dense.push(s[i]);
      if (i + 1 < s.length) {
        const n = Math.floor(Math.hypot(s[i + 1][0] - s[i][0], s[i + 1][1] - s[i][1]) / 0.05);
        for (let k = 1; k <= n; k++) dense.push([s[i][0] + ((s[i + 1][0] - s[i][0]) * k) / (n + 1), s[i][1] + ((s[i + 1][1] - s[i][1]) * k) / (n + 1)]);
      }
    }
    let ox = 0, oy = 0;
    const out = dense.map(([x, y]) => { ox = ox * 0.6 + (rand() - 0.5) * 0.8 * amp; oy = oy * 0.6 + (rand() - 0.5) * 0.8 * amp; return [x + ox, y + oy]; });
    // A closed outline stays closed.
    const a = dense[0], b = dense[dense.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) out[out.length - 1] = out[0];
    return out;
  });
}

// Design a drawing: strokes in design space, plus the box they live in (the ink box or the whole pad).
function design(name, variant = 0) {
  const make = MAKERS[name];
  if (!make) throw new Error(`unknown sample "${name}" (${NAMES.join(", ")})`);
  const R = params(variant);
  const d = make(R);
  let strokes = d.strokes;
  if (variant) {
    const wobbleRand = rng(variant * 7919 + 13).next;
    strokes = wobble(strokes, 0.006, wobbleRand);
    if (d.crop) {
      const a = (rng(variant * 31 + 5).next() - 0.5) * 0.09;   // a little tilt, up to about 2.5 degrees
      const all = strokes.flat(), cx = all.reduce((s, p) => s + p[0], 0) / all.length, cy = all.reduce((s, p) => s + p[1], 0) / all.length;
      strokes = strokes.map((s) => rot(s, cx, cy, a));
    }
  }
  let box;
  if (d.crop) {
    const all = strokes.flat();
    const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0])), y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
    const m = 0.04 * Math.max(x1 - x0, y1 - y0) + d.width / 2;
    box = { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
  } else box = { x: 0, y: 0, w: d.aspect, h: 1 };
  return { strokes, box, width: d.width, crop: d.crop };
}

function render(name, { variant = 0, size = MAX_PX } = {}) {
  const d = design(name, variant);
  const k = size / Math.max(d.box.w, d.box.h);
  const width = Math.max(1, Math.round(d.box.w * k)), height = Math.max(1, Math.round(d.box.h * k));
  const px = d.strokes.map((s) => s.map(([x, y]) => [(x - d.box.x) * (width / d.box.w), (y - d.box.y) * (height / d.box.h)]));
  const cov = rasterise(px, width, height, Math.max(2, d.width * (height / d.box.h)));
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(255 - cov[i] * (255 - INK));
  const png = encodePng(width, height, gray);
  return { name, variant, width, height, aspect: width / height, png, dataUrl: "data:image/png;base64," + png.toString("base64"), gray };
}

const dataUrl = (name, variant = 0, size = MAX_PX) => render(name, { variant, size }).dataUrl;

// The drawing as strokes on a pad with this width / height ratio (0..1 coordinates), centred, covering `fill` of the pad:
// what a finger would draw. The controller keeps its own pad shape (letterboxed when the pad is a different shape).
function strokesForPad(name, variant = 0, padAspect = PAD_ASPECT, fill = 0.82) {
  const d = design(name, variant);
  const bw = d.box.w * 1, bh = d.box.h;               // in design units; the pad is padAspect x 1 in the same units
  const s = Math.min((padAspect * fill) / bw, fill / bh);
  const ox = (padAspect - bw * s) / 2 - d.box.x * s, oy = (1 - bh * s) / 2 - d.box.y * s;
  return d.strokes.map((st) => st.map(([x, y]) => [(x * s + ox) / padAspect, y * s + oy]));
}

// ---- Output ---------------------------------------------------------------------------------------------------------------

// A contact sheet of several renders (each re-rendered at the cell size) for a quick look.
function contactSheet(items, cell = 256, cols = 3) {
  const rows = Math.ceil(items.length / cols), W = cols * cell, H = rows * cell;
  const gray = new Uint8Array(W * H).fill(255);
  items.forEach((it, i) => {
    const r = render(it.name, { variant: it.variant, size: cell - 12 });
    const ox = (i % cols) * cell + Math.floor((cell - r.width) / 2), oy = Math.floor(i / cols) * cell + Math.floor((cell - r.height) / 2);
    for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) gray[(oy + y) * W + ox + x] = r.gray[y * r.width + x];
    for (let x = 0; x < cell; x++) { gray[(Math.floor(i / cols) * cell) * W + (i % cols) * cell + x] = 200; gray[(Math.floor(i / cols) * cell + cell - 1) * W + (i % cols) * cell + x] = 200; }
    for (let y = 0; y < cell; y++) { gray[(Math.floor(i / cols) * cell + y) * W + (i % cols) * cell] = 200; gray[(Math.floor(i / cols) * cell + y) * W + (i % cols) * cell + cell - 1] = 200; }
  });
  return encodePng(W, H, gray);
}

function writeAll(dir, variants = 3) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  const put = (file, buf) => { fs.writeFileSync(path.join(dir, file), buf); files.push(file); };
  for (const name of NAMES) put(`${name}.png`, render(name).png);
  for (let v = 1; v <= variants; v++) put(`ship-v${v}.png`, render("ship", { variant: v }).png);
  const items = [...NAMES.map((name) => ({ name, variant: 0 })), ...[1, 2, 3].map((v) => ({ name: "ship", variant: v })), { name: "car", variant: 1 }, { name: "dog", variant: 1 }];
  put("contact-sheet.png", contactSheet(items));
  return files;
}

module.exports = { NAMES, PAD_ASPECT, render, dataUrl, strokesForPad, writeAll, design, text, textWidth, rng, encodePng, rasterise };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const out = path.resolve(opt("out", path.join(__dirname, "samples")));
  const files = writeAll(out, Number(opt("variants", 3)));
  for (const name of NAMES) { const r = render(name); console.log(`${name.padEnd(11)} ${r.width}x${r.height} px, ${r.png.length} bytes (data URL ${r.dataUrl.length} chars)`); }
  console.log(`wrote ${files.length} files to ${out}`);
}
