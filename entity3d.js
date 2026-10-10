// entity3d.js: the drawn PLANET entity (person, quadruped, car, bike, blob) as a chunky, cartoony, RIGGED 3D model (v1.4,
// owner 10:12: "We're doing the character 3d modelling as well?"). astra-body.js reads the drawing into a "body spec"
// (type, head, torso, arms, legs, tail, vehicle, items, palette); this module builds the model from it on every screen, the
// way ship3d.js builds ships. No model call.
//
//   await loadEntityClips() → bool       // the A-008 person clips (33, rotation-only); once, before the first person build
//   buildEntity(spec, { drawingImage, color = 0x22d3ee, quality: "lite"|"phone"|"big" })
//     → { object3d, rig, sockets, wheels, bones, materials, fxMaterials, clips, radius, size: {x, y, z}, triangles, drawCalls, ms,
//         play(name, opts), update(dt), pose(name, phase), setOpacity(a),
//         instance({ color }) → the same view fields on a new bone tree (shared geometry), dispose() }
//   ENTITY_SIZES = { person: 1.8, quadruped: ~1.3-2.3, car: 4, bike: 2, blob: 1.4 }   (the longest side, metres)
//
// Frame: faces -Z, up +Y, the origin between the feet / wheels on the ground (y = 0). A person is 1.8 m tall, a car ~4 m
// long, a bike ~2 m, an animal 1.3-2.3 m (a long-legged, long-necked one is horse-sized), a blob ~1.4 m.
// Rig: every part is RIGID and attached to one bone (one SkinnedMesh per material, one bone per vertex), so clips animate it
// with no skinning artefacts. person = the A-008 skeleton (the same 19 bone names, parents and rest rotations, lengths from
// the drawing), so the A-008 clips (idle, walk, run, dig, jump, swim, ...) play on it unchanged; quadruped = the rigs.js
// quadruped bones with clips built here (idle, walk, run, gallop, jump, dig, sit, bite, hit, die); car / bike = a chassis
// bone and one bone per wheel (wheels: [{ pivot, radius }], rear to front: spin pivot.rotation.x like inflate.js's);
// blob = one body bone (anim.js squashes it).
// Draw calls: 1 = every solid part (one MeshStandardMaterial on the shared ship3d.js atlas, A-012 kit when loaded, tinted by
// vertex colours), 2 = the glow (lamps, eyes, flames; additive), 3 = the drawing as a small patch (chest, door, flank).
// Colours: the drawing's own colours when it has some, else the PLAYER's colour on the main parts. Deterministic for the
// same spec + options.
import * as THREE from "three";
import { shipTextures } from "./ship3d.js";

const Q = { lite: { tris: 2600, d: 0.62 }, phone: { tris: 4000, d: 0.85 }, big: { tris: 5000, d: 1.05 } };
const SELF = 0.12;
export const ENTITY_SIZES = { person: 1.8, quadruped: 1.6, car: 4.0, bike: 2.0, blob: 1.4 };
const RIG_OF = { person: "person", quadruped: "quadruped", car: "car", bike: "car", blob: "blob" };

// ---- Small math ----------------------------------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, def, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, lo, hi) : def; };
const lerp = (a, b, t) => a + (b - a) * t;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const madd = (o, d, s) => [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const spow = (x, e) => Math.sign(x) * Math.abs(x) ** e;
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function frame(o, dir, hint = [0, 1, 0]) {
  const f = nrm(dir);
  let h = hint;
  if (Math.abs(dot(f, h)) > 0.95) h = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [0, 0, -1];
  const u = nrm(sub(h, scl(f, dot(f, h))));
  return { o, f, u };
}

// ---- Textures: the shared ship3d.js atlas (procedural, or the A-012 kit once render.js applied it) --------------------

let TX = null;
function tex() {
  const T = shipTextures();
  if (!TX || TX.T !== T) TX = { T, A: T.size, REG: T.regions, DEC: T.decals };
  return TX;
}
const ruv = (r, s, t) => { const A = tex().A; return [(r.x + 3 + clamp(s, 0, 1) * (r.w - 6)) / A, (r.y + 3 + clamp(t, 0, 1) * (r.h - 6)) / A]; };
const R = (name) => tex().REG[name] || tex().REG.flat;

function mkCanvas(w, h) {
  if (typeof document !== "undefined") { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}

// ---- Geometry buffers (every vertex carries the bone it is attached to) -----------------------------------------------

class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.b = []; this.bone = 0; }
  get count() { return this.p.length / 3; }
  v(p, n, uv, c) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]); this.c.push(c[0], c[1], c[2]); this.b.push(this.bone);
    return this.count - 1;
  }
  tri(a, b, c) {
    const p = this.p, n = this.n;
    const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
    const ux = p[3 * b] - ax, uy = p[3 * b + 1] - ay, uz = p[3 * b + 2] - az, vx = p[3 * c] - ax, vy = p[3 * c + 1] - ay, vz = p[3 * c + 2] - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * fx + fy * fy + fz * fz < 1e-16) return;
    const sx = n[3 * a] + n[3 * b] + n[3 * c], sy = n[3 * a + 1] + n[3 * b + 1] + n[3 * c + 1], sz = n[3 * a + 2] + n[3 * b + 2] + n[3 * c + 2];
    if (fx * sx + fy * sy + fz * sz < 0) this.i.push(a, c, b); else this.i.push(a, b, c);
  }
}

// A surface of rings around an axis (ship3d.js): rows [{ t, a, b, n, x, y, v, c }].
function rings(B, rows, seg, fr, reg, col, opt = {}) {
  const { o, f, u } = fr, r = cross(u, f);
  const closed = opt.th1 == null, th0 = opt.th0 || 0, th1 = closed ? Math.PI * 2 : opt.th1;
  const nr = rows.length, nc = seg + 1, P = new Float64Array(nr * nc * 3);
  for (let i = 0; i < nr; i++) {
    const s = rows[i], n = s.n || 2, nb = s.nb || n;
    for (let j = 0; j < nc; j++) {
      const th = th0 + (th1 - th0) * j / seg, c = Math.cos(th), sn = Math.sin(th), e = sn >= 0 ? n : nb;
      const cx = spow(c, 2 / e) * s.a + (s.x || 0), cy = spow(sn, 2 / e) * s.b + (s.y || 0), k = (i * nc + j) * 3;
      for (let q = 0; q < 3; q++) P[k + q] = o[q] + f[q] * s.t + r[q] * cx + u[q] * cy;
    }
  }
  const at = (i, j) => { const k = (i * nc + j) * 3; return [P[k], P[k + 1], P[k + 2]]; };
  const N = new Array(nr * nc);
  for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
    let j0 = j - 1, j1 = j + 1;
    if (closed) { if (j0 < 0) j0 = seg - 1; if (j1 > seg) j1 = 1; } else { j0 = Math.max(0, j0); j1 = Math.min(seg, j1); }
    const dj = sub(at(i, j1), at(i, j0));
    let di = sub(at(Math.min(nr - 1, i + 1), j), at(Math.max(0, i - 1), j));
    if (len(di) < 1e-9) di = f;
    const n = cross(dj, di);
    N[i * nc + j] = len(n) < 1e-10 ? null : nrm(n);
  }
  for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (!N[i * nc + j]) N[i * nc + j] = (i + 1 < nr && N[(i + 1) * nc + j]) || (i > 0 && N[(i - 1) * nc + j]) || scl(f, i ? 1 : -1);
  const base = B.count;
  for (let i = 0; i < nr; i++) {
    const s = rows[i], vv = s.v ?? i / Math.max(1, nr - 1), cc = s.c || col;
    for (let j = 0; j < nc; j++) B.v(at(i, j), N[i * nc + j], ruv(s.reg || reg, j / seg, vv), cc);
  }
  const pole = (s) => s.a < 1e-7 && s.b < 1e-7;
  for (let i = 0; i < nr - 1; i++) {
    const p0 = pole(rows[i]), p1 = pole(rows[i + 1]);
    for (let j = 0; j < seg; j++) {
      const a = base + i * nc + j, b = a + nc, c = a + 1, d = b + 1;
      if (!p0) B.tri(a, c, b);
      if (!p1) B.tri(c, d, b);
    }
  }
}

// Primitives. seg = segments around; every size in metres in the root's rest frame.
let D = 1; // the quality factor of the current build (segments scale with it)
const sg = (n) => Math.max(5, Math.round(n * D));
// An ellipsoid with half axes rx (x), ry (along dir, default up), rz; n > 2 makes it boxier.
function ell(B, c, rx, ry, rz, seg, reg, col, { dir = [0, 1, 0], hint = [0, 0, -1], n = 2, rows: k0 } = {}) {
  const k = k0 || Math.max(4, Math.round(seg / 2)), rows = [];
  for (let i = 0; i <= k; i++) { const a = -Math.PI / 2 + Math.PI * i / k, cs = Math.cos(a); rows.push({ t: Math.sin(a) * ry, a: Math.abs(cs) < 1e-6 ? 0 : spow(cs, n === 2 ? 1 : 0.7) * rx, b: Math.abs(cs) < 1e-6 ? 0 : spow(cs, n === 2 ? 1 : 0.7) * rz, n, v: i / k }); }
  rings(B, rows, seg, frame(c, dir, hint), reg, col);
}
// A capsule from p0 (radius r0) to p1 (r1) with round ends.
function capsule(B, p0, p1, r0, r1, seg, reg, col, n = 2) {
  const L = len(sub(p1, p0)), k = Math.max(2, Math.round(seg / 4)), rows = [];
  for (let i = 0; i <= k; i++) { const a = -Math.PI / 2 + Math.PI / 2 * i / k; rows.push({ t: r0 * Math.sin(a), a: r0 * Math.cos(a), b: r0 * Math.cos(a), n }); }
  for (let i = 0; i <= k; i++) { const a = Math.PI / 2 * i / k; rows.push({ t: L + r1 * Math.sin(a), a: r1 * Math.cos(a), b: r1 * Math.cos(a), n }); }
  rows[0].a = rows[0].b = 0; rows[rows.length - 1].a = rows[rows.length - 1].b = 0;
  rings(B, rows, seg, frame(p0, sub(p1, p0), [0, 0, -1]), reg, col);
}
// A cylinder from p0 to p1 with bevelled caps (r0 at p0, r1 at p1).
function cyl(B, p0, p1, r0, r1, seg, reg, col, bevel = 0.25, hint = [0, 1, 0]) {
  const L = len(sub(p1, p0)), e = Math.min(L * 0.3, Math.max(r0, r1) * bevel);
  rings(B, [{ t: 0, a: 0, b: 0 }, { t: 0, a: r0 * 0.8, b: r0 * 0.8 }, { t: e * 0.5, a: r0, b: r0 }, { t: L - e * 0.5, a: r1, b: r1 }, { t: L, a: r1 * 0.8, b: r1 * 0.8 }, { t: L, a: 0, b: 0 }],
    seg, frame(p0, sub(p1, p0), hint), reg, col);
}
// A rounded box centred at c: half sizes hx (x), hy (y), hz (z); n: superellipse (4 boxy, 2.6 soft).
function box(B, c, hx, hy, hz, reg, col, { n = 4, seg = 12, dir = [0, 1, 0], hint = [0, 0, -1], taper = 1, round } = {}) {
  const e = round ?? Math.min(hx, hy, hz) * 0.45, L = hy * 2, k = taper;
  rings(B, [{ t: 0, a: 0, b: 0, n }, { t: 0, a: Math.max(1e-4, hx - e), b: Math.max(1e-4, hz - e), n }, { t: e * 0.3, a: hx - e * 0.3, b: hz - e * 0.3, n }, { t: e, a: hx, b: hz, n },
    { t: L - e, a: hx * k, b: hz * k, n }, { t: L - e * 0.3, a: hx * k - e * 0.3, b: hz * k - e * 0.3, n }, { t: L, a: Math.max(1e-4, hx * k - e), b: Math.max(1e-4, hz * k - e), n }, { t: L, a: 0, b: 0, n }],
  sg(seg), frame(madd(c, nrm(dir), -hy), dir, hint), reg, col);
}
// A tube along a polyline (radius per point), rounded caps.
function tube(B, pts, rad, seg, reg, col) {
  const n = pts.length;
  const T = pts.map((p, i) => nrm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  let N0 = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  N0 = nrm(sub(N0, scl(T[0], dot(N0, T[0]))));
  const base = B.count, Ns = [];
  for (let i = 0; i < n; i++) { if (i) N0 = nrm(sub(N0, scl(T[i], dot(N0, T[i])))); Ns.push(N0); }
  for (let i = 0; i < n; i++) {
    const Bn = cross(T[i], Ns[i]), r = typeof rad === "number" ? rad : rad[i];
    for (let j = 0; j <= seg; j++) {
      const a = 2 * Math.PI * j / seg, d = add(scl(Ns[i], Math.cos(a)), scl(Bn, Math.sin(a)));
      B.v(madd(pts[i], d, r), d, ruv(reg, j / seg, i / (n - 1)), col);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = base + i * (seg + 1) + j, b = a + seg + 1;
    B.tri(a, a + 1, b); B.tri(a + 1, b + 1, b);
  }
  for (const [i, s] of [[0, -1], [n - 1, 1]]) {
    const r = typeof rad === "number" ? rad : rad[i], c = B.v(madd(pts[i], T[i], s * r * 0.6), scl(T[i], s), ruv(reg, 0.5, 0.5), col);
    const ring = base + i * (seg + 1);
    for (let j = 0; j < seg; j++) B.tri(c, ring + j, ring + j + 1);
  }
}
// A flat chunky plate: convex outline [[s, c]...] in the plane (o, S, C) with normal N, half thickness th, rounded edge.
function plate(B, poly, o, S, C, th, reg, col, colEdge) {
  const Nn = nrm(cross(S, C));
  const P = (s, c, h) => [o[0] + S[0] * s + C[0] * c + Nn[0] * h, o[1] + S[1] * s + C[1] * c + Nn[1] * h, o[2] + S[2] * s + C[2] * c + Nn[2] * h];
  const K = poly.length;
  let cs = 0, cc = 0, ar = 0;
  for (let k = 0; k < K; k++) { const [s0, c0] = poly[k], [s1, c1] = poly[(k + 1) % K]; cs += s0 / K; cc += c0 / K; ar += s0 * c1 - s1 * c0; }
  const sgn = ar >= 0 ? 1 : -1;
  for (const side of [1, -1]) {
    const nn = scl(Nn, side), ci = B.v(P(cs, cc, side * th), nn, ruv(reg, 0.5, 0.5), col), first = B.count;
    for (const [s, c] of poly) B.v(P(s, c, side * th), nn, ruv(reg, 0.5 + s * 0.4, 0.5 + c * 0.4), col);
    for (let k = 0; k < K; k++) B.tri(ci, first + k, first + (k + 1) % K);
  }
  const base = B.count, Rr = 5, ce = colEdge || col;
  for (let k = 0; k < K; k++) {
    const a = poly[(k + K - 1) % K], p = poly[k], b = poly[(k + 1) % K];
    const n0 = nrm([(p[1] - a[1]) * sgn, -(p[0] - a[0]) * sgn, 0]), n1 = nrm([(b[1] - p[1]) * sgn, -(b[0] - p[0]) * sgn, 0]);
    const e = nrm([n0[0] + n1[0], n0[1] + n1[1], 0]), out = add(scl(S, e[0]), scl(C, e[1]));
    for (let m = 0; m < Rr; m++) {
      const ph = Math.PI / 2 - Math.PI * m / (Rr - 1), cp = Math.cos(ph), sp = Math.sin(ph);
      B.v(madd(P(p[0], p[1], th * sp), out, th * 0.8 * cp), nrm(add(scl(out, cp), scl(Nn, sp))), ruv(R("flat"), 0.5, 0.5), ce);
    }
  }
  for (let k = 0; k < K; k++) for (let m = 0; m < Rr - 1; m++) {
    const a = base + k * Rr + m, b = base + ((k + 1) % K) * Rr + m;
    B.tri(a, b, a + 1); B.tri(b, b + 1, a + 1);
  }
}

// ---- Colours -------------------------------------------------------------------------------------------------------

const C = (v) => { const c = new THREE.Color(v); return [c.r, c.g, c.b]; };
function shade(rgb, l = 1, s = 1, dh = 0) {
  const c = new THREE.Color(rgb[0], rgb[1], rgb[2]), hsl = {};
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL((hsl.h + dh + 1) % 1, clamp(hsl.s * s, 0, 1), clamp(hsl.l * l, 0, 1), THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const hex = (v) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : "");
const vivid = (rgb) => { const c = new THREE.Color(rgb[0], rgb[1], rgb[2]), h = {}; c.getHSL(h, THREE.SRGBColorSpace); c.setHSL(h.h, Math.max(h.s, 0.6), clamp(h.l, 0.45, 0.6), THREE.SRGBColorSpace); return [c.r, c.g, c.b]; };

function palette(spec, color) {
  const P = spec.palette || {};
  const drawn = (v) => (hex(v) ? C(hex(v)) : null);
  const player = vivid(C(color));
  const main = drawn(spec.torso.color) || drawn(spec.vehicle.color) || drawn(P.main) || player;
  const ink = !P.colored && !drawn(spec.torso.color) && !drawn(spec.vehicle.color);
  const second = drawn(spec.legs.color) || drawn(P.second) || shade(main, 0.62, 1.05, -0.02);
  const accent = drawn(P.accent) || (ink ? C("#ffcf33") : shade(main, 1.25, 1.1, 0.08));
  return {
    main, second, accent, player, ink,
    arms: drawn(spec.arms.color) || main,
    legs: drawn(spec.legs.color) || (ink ? shade(main, 0.6, 1.0) : second),
    head: drawn(spec.head.color) || null,
    gear: drawn(spec.head.gearColor) || null,
    face: drawn(spec.head.faceColor) || null,
    skin: drawn(P.skin) || C("#f2c28e"),
    tail: drawn(spec.tail.color) || null,
    white: C("#f3f5f8"), light: C("#dfe5ee"), trim: C("#2a2e3a"), dark: C("#1b1d26"), metal: C("#c9d1dc"), steel: C("#8c96a6"),
    glass: C("#2f6fd6"), gold: C("#ffb627"), red: C("#ef2d2d"), black: C("#121218"), pink: C("#ff8fb1"),
  };
}

// ---- Rigs ----------------------------------------------------------------------------------------------------------

// The A-008 person skeleton: names, parents and rest rotations (x, y, z, w), exactly as person.glb (rotation-only clips
// play on it unchanged). Positions come from the drawing's proportions.
const PERSON_BONES = [
  ["hips", null, [0, 0, 0, 1]], ["spine", "hips", [0, 0, 0, 1]], ["chest", "spine", [0, 0, 0, 1]], ["neck", "chest", [0, 0, 0, 1]], ["head", "neck", [0, 0, 0, 1]],
  ["shoulder_l", "chest", [-0.5, -0.5, -0.5, 0.5]], ["upper_arm_l", "shoulder_l", [0, 2.1855694143368964e-08, 0, 1]], ["fore_arm_l", "upper_arm_l", [0, 0, 0, 1]], ["hand_l", "fore_arm_l", [0, 0, 0, 1]],
  ["shoulder_r", "chest", [-0.5, 0.5, 0.5, 0.5]], ["upper_arm_r", "shoulder_r", [0, -2.1855694143368964e-08, 0, 1]], ["fore_arm_r", "upper_arm_r", [0, 0, 0, 1]], ["hand_r", "fore_arm_r", [0, 0, 0, 1]],
  ["thigh_l", "hips", [1, 0, 7.549790126404332e-08, 0]], ["shin_l", "thigh_l", [0, -7.549790126404332e-08, 0, 1]], ["foot_l", "shin_l", [0.5719679594039917, 0, 0, 0.8202759623527527]],
  ["thigh_r", "hips", [1, 0, 7.549790126404332e-08, 0]], ["shin_r", "thigh_r", [0, -7.549790126404332e-08, 0, 1]], ["foot_r", "shin_r", [0.5719679594039917, 0, 0, 0.8202759623527527]],
];
const QUAD_LEGS = ["front_l", "front_r", "back_l", "back_r"];
const QUAD_BONES = [
  ["hips", null], ["spine_1", "hips"], ["spine_2", "spine_1"], ["neck", "spine_2"], ["head", "neck"], ["tail_1", "hips"], ["tail_2", "tail_1"],
  ...QUAD_LEGS.flatMap((l) => [[`${l}_upper`, l.startsWith("front") ? "spine_2" : "hips"], [`${l}_lower`, `${l}_upper`], [`${l}_foot`, `${l}_lower`]]),
].map(([n, p]) => [n, p, [0, 0, 0, 1]]);

// A rig plan: bones [{ name, parent, q, world: [x, y, z] }] in parent order, sockets { name: { bone, at: [x, y, z] } }.
class Rig {
  constructor(kind) { this.kind = kind; this.bones = []; this.index = new Map(); this.sockets = {}; this.wheels = []; }
  bone(name, parent, world, q = [0, 0, 0, 1]) { this.index.set(name, this.bones.length); this.bones.push({ name, parent, q, world }); return this.bones.length - 1; }
  id(name) { return this.index.get(name) ?? 0; }
  socket(name, bone, at) { this.sockets[name] = { bone, at }; }
  // The rest pose: THREE.Bones (local positions from the world targets) and each bone's inverse rest matrix.
  realize() {
    const objs = [];
    for (const b of this.bones) {
      const o = new THREE.Bone();
      o.name = b.name;
      o.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3]).normalize();
      const parent = b.parent != null ? objs[this.id(b.parent)] : null;
      if (parent) { parent.add(o); parent.updateMatrixWorld(true); o.position.copy(parent.worldToLocal(new THREE.Vector3(...b.world))); }
      else o.position.set(...b.world);
      o.updateMatrixWorld(true);
      objs.push(o);
    }
    objs[0].updateMatrixWorld(true);
    this.local = objs.map((o) => ({ p: o.position.toArray(), q: o.quaternion.toArray() }));
    this.inverses = objs.map((o) => o.matrixWorld.clone().invert());
    this.restWorld = objs.map((o) => o.matrixWorld.clone());
    return this;
  }
  // A fresh bone tree (per instance).
  tree() {
    const objs = this.bones.map((b, i) => { const o = new THREE.Bone(); o.name = b.name; o.position.fromArray(this.local[i].p); o.quaternion.fromArray(this.local[i].q); return o; });
    this.bones.forEach((b, i) => { if (b.parent != null) objs[this.id(b.parent)].add(objs[i]); });
    return objs;
  }
}

// ---- Shared clip libraries -------------------------------------------------------------------------------------------

const PERSON_LOOPS = new Set("idle walk run sprint fall crouch aim block dig climb swim glide sit push kneel look read celebrate wave".split(" "));
let PERSON_CLIPS = null, clipsPromise = null;
// The A-008 person clips (assets/A-008-rigs/person.glb through person.js). Resolves true when loaded, false when missing.
export function loadEntityClips() {
  if (PERSON_CLIPS) return Promise.resolve(true);
  return clipsPromise ??= import(new URL("./assets/A-008-rigs/person.js", import.meta.url).href)
    .then((m) => m.loadPersonRig())
    .then((gltf) => {
      // Keep only the quaternion tracks of the 19 bones (the asset is rotation-only; be safe against extras).
      const names = new Set(PERSON_BONES.map((b) => b[0]));
      PERSON_CLIPS = gltf.animations.map((c) => new THREE.AnimationClip(c.name, c.duration, c.tracks.filter((t) => t.name.endsWith(".quaternion") && names.has(t.name.slice(0, -11)))));
      return true;
    })
    .catch((e) => { console.warn("[entity3d] A-008 person clips unavailable:", e?.message || e); clipsPromise = null; return false; });
}

// Quadruped clips, built once: rotation tracks on the rigs.js quadruped bones (identity rest, so a track is the bone's
// rotation). Gaits swing the legs about X (forward = -Z), the spine flexes, the head bobs, the tail wags.
let QUAD_CLIPS = null;
function quadClips() {
  if (QUAD_CLIPS) return QUAD_CLIPS;
  const qx = new THREE.Quaternion(), e = new THREE.Euler();
  const track = (bone, dur, n, fn) => {
    const times = [], values = [];
    for (let i = 0; i <= n; i++) { const t = (i / n) * dur; const [x, y, z] = fn(i / n); e.set(x, y, z, "YXZ"); qx.setFromEuler(e); times.push(t); values.push(qx.x, qx.y, qx.z, qx.w); }
    return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
  };
  const T = Math.PI * 2, S = Math.sin, Cc = Math.cos;
  const gait = (name, dur, amp, knee, phases, spine, head, tailAmp) => new THREE.AnimationClip(name, dur, [
    ...QUAD_LEGS.flatMap((l, i) => {
      const ph = phases[i] * T, front = l.startsWith("front");
      return [
        track(`${l}_upper`, dur, 24, (u) => [S(u * T + ph) * amp, 0, 0]),
        // the knee folds while the leg swings forward (front legs bend backwards, back legs forwards)
        track(`${l}_lower`, dur, 24, (u) => [(front ? -1 : 1) * Math.max(0, Cc(u * T + ph)) * knee, 0, 0]),
        track(`${l}_foot`, dur, 24, (u) => [-S(u * T + ph) * amp * 0.6, 0, 0]),
      ];
    }),
    track("spine_1", dur, 24, (u) => [S(u * T * 2) * spine, 0, 0]),
    track("spine_2", dur, 24, (u) => [-S(u * T * 2) * spine, 0, 0]),
    track("neck", dur, 24, (u) => [S(u * T * 2 + 0.6) * head, 0, 0]),
    track("head", dur, 24, (u) => [-S(u * T * 2 + 0.6) * head * 0.6, 0, 0]),
    track("tail_1", dur, 24, (u) => [0.25, S(u * T) * tailAmp, 0]),
    track("tail_2", dur, 24, (u) => [0.1, S(u * T - 0.8) * tailAmp, 0]),
  ]);
  const idle = new THREE.AnimationClip("idle", 3, [
    track("spine_1", 3, 24, (u) => [S(u * T) * 0.02, 0, 0]),
    track("neck", 3, 24, (u) => [-0.05 + S(u * T) * 0.04, S(u * T * 0.5) * 0.25, 0]),
    track("head", 3, 24, (u) => [S(u * T + 1) * 0.05, 0, S(u * T * 0.5) * 0.08]),
    track("tail_1", 3, 24, (u) => [0.35, S(u * T * 3) * 0.45, 0]),
    track("tail_2", 3, 24, (u) => [0.15, S(u * T * 3 - 0.9) * 0.5, 0]),
  ]);
  const dig = new THREE.AnimationClip("dig", 0.6, [
    track("front_l_upper", 0.6, 24, (u) => [-0.35 + S(u * T) * 0.75, 0, 0]),
    track("front_l_lower", 0.6, 24, (u) => [-Math.max(0, Cc(u * T)) * 1.2, 0, 0]),
    track("front_r_upper", 0.6, 24, (u) => [-0.35 + S(u * T + Math.PI) * 0.75, 0, 0]),
    track("front_r_lower", 0.6, 24, (u) => [-Math.max(0, Cc(u * T + Math.PI)) * 1.2, 0, 0]),
    track("back_l_upper", 0.6, 4, () => [-0.2, 0, 0]), track("back_r_upper", 0.6, 4, () => [-0.2, 0, 0]),
    track("back_l_lower", 0.6, 4, () => [0.35, 0, 0]), track("back_r_lower", 0.6, 4, () => [0.35, 0, 0]),
    track("spine_1", 0.6, 4, () => [-0.08, 0, 0]), track("spine_2", 0.6, 4, () => [-0.12, 0, 0]),
    track("neck", 0.6, 24, (u) => [-0.55 + S(u * T * 2) * 0.06, 0, 0]),
    track("head", 0.6, 24, (u) => [-0.15, 0, S(u * T) * 0.1]),
    track("tail_1", 0.6, 24, (u) => [0.45, S(u * T * 2) * 0.6, 0]),
    track("tail_2", 0.6, 24, (u) => [0.15, S(u * T * 2 - 1) * 0.6, 0]),
  ]);
  const jump = new THREE.AnimationClip("jump", 0.8, [
    track("front_l_upper", 0.8, 8, (u) => [0.7 * S(u * Math.PI), 0, 0]), track("front_r_upper", 0.8, 8, (u) => [0.7 * S(u * Math.PI), 0, 0]),
    track("front_l_lower", 0.8, 8, (u) => [-0.6 * S(u * Math.PI), 0, 0]), track("front_r_lower", 0.8, 8, (u) => [-0.6 * S(u * Math.PI), 0, 0]),
    track("back_l_upper", 0.8, 8, (u) => [-0.7 * S(u * Math.PI), 0, 0]), track("back_r_upper", 0.8, 8, (u) => [-0.7 * S(u * Math.PI), 0, 0]),
    track("back_l_lower", 0.8, 8, (u) => [0.4 * S(u * Math.PI), 0, 0]), track("back_r_lower", 0.8, 8, (u) => [0.4 * S(u * Math.PI), 0, 0]),
    track("neck", 0.8, 8, (u) => [0.2 * S(u * Math.PI), 0, 0]), track("tail_1", 0.8, 8, (u) => [0.5 * S(u * Math.PI), 0, 0]),
  ]);
  const sit = new THREE.AnimationClip("sit", 1.2, [
    track("hips", 1.2, 4, () => [0.35, 0, 0]),
    track("back_l_upper", 1.2, 4, () => [0.9, 0, 0]), track("back_r_upper", 1.2, 4, () => [0.9, 0, 0]),
    track("back_l_lower", 1.2, 4, () => [-1.6, 0, 0]), track("back_r_lower", 1.2, 4, () => [-1.6, 0, 0]),
    track("front_l_upper", 1.2, 4, () => [-0.35, 0, 0]), track("front_r_upper", 1.2, 4, () => [-0.35, 0, 0]),
    track("neck", 1.2, 4, () => [-0.25, 0, 0]), track("tail_1", 1.2, 12, (u) => [0.8, S(u * T) * 0.3, 0]),
  ]);
  const bite = new THREE.AnimationClip("bite", 0.5, [
    track("neck", 0.5, 10, (u) => [-0.5 * S(u * Math.PI), 0, 0]), track("head", 0.5, 10, (u) => [0.3 * S(u * Math.PI), 0, 0]),
    track("spine_2", 0.5, 10, (u) => [0.1 * S(u * Math.PI), 0, 0]),
  ]);
  const hit = new THREE.AnimationClip("hit", 0.4, [
    track("spine_1", 0.4, 8, (u) => [-0.2 * S(u * Math.PI), 0, 0.1 * S(u * Math.PI)]), track("neck", 0.4, 8, (u) => [-0.4 * S(u * Math.PI), 0, 0]),
  ]);
  const die = new THREE.AnimationClip("die", 1.0, [
    ...QUAD_LEGS.map((l) => track(`${l}_upper`, 1, 6, (u) => [(l.startsWith("front") ? -0.8 : 0.8) * Math.min(1, u * 2), 0, 0])),
    track("neck", 1, 6, (u) => [0.6 * Math.min(1, u * 1.5), 0, 0]),
  ]);
  QUAD_CLIPS = [
    idle,
    gait("walk", 1.0, 0.42, 0.7, [0, 0.5, 0.5, 0], 0.03, 0.06, 0.35),
    gait("run", 0.55, 0.7, 1.1, [0, 0.12, 0.55, 0.67], 0.12, 0.1, 0.25),
    gait("gallop", 0.55, 0.7, 1.1, [0, 0.12, 0.55, 0.67], 0.12, 0.1, 0.25),
    jump, dig, sit, bite, hit, die,
  ];
  return QUAD_CLIPS;
}
const QUAD_LOOPS = new Set(["idle", "walk", "run", "gallop", "dig", "sit"]);
const VEH_LOOPS = new Set(["idle", "walk", "run", "dig"]);

// v1.6: per-clip tool grip. A person holding a digging tool has it on a prop bone (buildPerson); every A-008 clip gets one more
// track, the prop's rotation sampled along the clip so the tool points where that clip wants it, in the body's frame:
//   dig / kneel: from the fists to the ground in front of the feet (both fists end up on the shaft; the drill bores down);
//   a drill or saw in any other clip: held out forward, a little down;
//   a shovel or pickaxe in any other clip: along the forearm, tip forward (it hangs at the side and swings with the arm).
const PROP_TOOLS = new Set(["shovel", "pickaxe", "drill", "saw"]);
const DIG_TOOLS = new Set(["shovel", "pickaxe"]);
function propClips(rig, clips) {
  if (!rig.props || !rig.props.length || !clips.length) return clips;
  const bones = rig.tree(), root = new THREE.Group();
  root.add(bones[0]);
  const by = new Map(bones.map((b) => [b.name, b]));
  const mixer = new THREE.AnimationMixer(root);
  const props = rig.props.map((p) => ({ ...p, rest: new THREE.Quaternion().setFromRotationMatrix(rig.restWorld[rig.id(p.bone)]), hand: by.get(`hand_${p.side}`), fore: by.get(`fore_arm_${p.side}`) }));
  const qh = new THREE.Quaternion(), qw = new THREE.Quaternion(), m = new THREE.Matrix4(), m0 = new THREE.Matrix4(), ph = new THREE.Vector3(), pf = new THREE.Vector3();
  const D0 = new THREE.Vector3(0, 0, -1), U0 = new THREE.Vector3(0, 1, 0), S0 = new THREE.Vector3().crossVectors(D0, U0);
  m0.makeBasis(D0, U0, S0).transpose(); // the inverse of the tool's authored frame (orthonormal)
  const d = new THREE.Vector3(), u = new THREE.Vector3(), s = new THREE.Vector3();
  const out = [];
  for (const clip of clips) {
    const act = mixer.clipAction(clip);
    act.reset().setLoop(THREE.LoopOnce, 1);
    act.clampWhenFinished = true;
    act.play();
    const digging = clip.name === "dig" || clip.name === "kneel";
    const n = digging ? 16 : clamp(Math.round(clip.duration * 6), 2, 12);
    const tr = props.map(() => ({ t: [], v: [] }));
    for (let i = 0; i <= n; i++) {
      const t = clip.duration * i / n;
      act.time = t; mixer.update(0); root.updateMatrixWorld(true);
      props.forEach((p, j) => {
        p.hand.getWorldPosition(ph); p.fore.getWorldPosition(pf); p.hand.getWorldQuaternion(qh);
        if (digging) d.set(0, 0.04, -0.62).sub(ph);
        else if (DIG_TOOLS.has(p.kind)) { d.copy(ph).sub(pf).normalize().multiplyScalar(0.6); d.y -= 0.7; d.z -= 0.6; } // mostly down, swings a little
        else d.set(0, -0.25, -1);
        d.normalize();
        // a shovel's blade lies across the body (its face forwards); a drill keeps its housing on top
        if (DIG_TOOLS.has(p.kind)) { s.set(1, 0, 0).addScaledVector(d, -d.x); if (s.lengthSq() < 1e-4) s.set(0, 0, 1); s.normalize(); u.crossVectors(s, d); }
        else { u.set(0, 1, 0).addScaledVector(d, -d.y); if (u.lengthSq() < 1e-4) u.set(0, 0, 1); u.normalize(); s.crossVectors(d, u); }
        m.makeBasis(d, u, s).multiply(m0);
        qw.setFromRotationMatrix(m).multiply(p.rest); // the prop's wanted rotation in the body's frame
        const local = qh.invert().multiply(qw); // relative to the hand
        tr[j].t.push(t); tr[j].v.push(local.x, local.y, local.z, local.w);
      });
    }
    act.stop();
    mixer.uncacheAction(clip);
    out.push(new THREE.AnimationClip(clip.name, clip.duration, [...clip.tracks, ...props.map((p, j) => new THREE.QuaternionKeyframeTrack(`${p.bone}.quaternion`, tr[j].t, tr[j].v))]));
  }
  mixer.uncacheRoot(root);
  return out;
}

// v1.6: vehicle clips (car, bike), per build (the rest positions differ): the chassis idles, rocks while driving, noses up in a
// jump and DIGS: it dips and shudders nose-down, the drill bit (bone "tool") spins and dust puffs (bone "dust", hidden at
// scale ~0 in every other clip) billow at the front. The wheels stay render.js's (no wheel tracks).
function vehicleClips(rig) {
  const ci = rig.index.get("chassis");
  if (ci == null) return [];
  const V = rig.veh || {}, T = Math.PI * 2, S = Math.sin;
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  const keys = (dur, n, fn, w) => { const times = [], values = []; for (let i = 0; i <= n; i++) { const u = i / n; times.push(u * dur); values.push(...fn(u)); } return [times, values]; };
  const pos = (bone, dur, n, fn) => { const p0 = rig.local[rig.id(bone)].p; const [t, v] = keys(dur, n, (u) => { const o = fn(u); return [p0[0] + o[0], p0[1] + o[1], p0[2] + o[2]]; }); return new THREE.VectorKeyframeTrack(`${bone}.position`, t, v); };
  const rot = (bone, dur, n, fn) => { const [t, v] = keys(dur, n, (u) => { const [x, y, z] = fn(u); e.set(x, y, z, "YXZ"); q.setFromEuler(e); return [q.x, q.y, q.z, q.w]; }); return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, t, v); };
  const scale = (bone, dur, n, fn) => { const [t, v] = keys(dur, n, (u) => { const k = fn(u); return [k, k, k]; }); return new THREE.VectorKeyframeTrack(`${bone}.scale`, t, v); };
  const hasTool = rig.index.has("tool"), hasDust = rig.index.has("dust");
  const rest = (dur) => [...(hasDust ? [scale("dust", dur, 1, () => 0.001)] : []), ...(hasTool ? [rot("tool", dur, 1, () => [0, 0, 0])] : [])];
  const k = V.bike ? 0.7 : 1, dip = V.dip || 0.1;
  const idle = new THREE.AnimationClip("idle", 2, [pos("chassis", 2, 16, (u) => [0, S(u * T * 3) * 0.006 * k, 0]), rot("chassis", 2, 16, (u) => [S(u * T) * 0.004, 0, 0]), ...rest(2)]);
  const drive = (name, dur, amp) => new THREE.AnimationClip(name, dur, [pos("chassis", dur, 16, (u) => [0, Math.abs(S(u * T)) * amp, 0]), rot("chassis", dur, 16, (u) => [S(u * T) * amp * 0.5, 0, S(u * T * 0.5) * amp * 0.3]), ...rest(dur)]);
  const jump = new THREE.AnimationClip("jump", 0.8, [pos("chassis", 0.8, 8, (u) => [0, 0.06 * S(u * Math.PI), 0]), rot("chassis", 0.8, 8, (u) => [0.14 * S(u * Math.PI) * k, 0, 0]), ...rest(0.8)]);
  // dig: two plunges per cycle, nose down, a fast shudder; the bit turns 3 times (quarter-turn keys: shortest-path slerp)
  const D = 0.6;
  const dig = new THREE.AnimationClip("dig", D, [
    pos("chassis", D, 24, (u) => [S(u * T * 6) * 0.012, -dip * (0.6 + 0.4 * S(u * T * 2)), 0]),
    rot("chassis", D, 24, (u) => [-(V.bike ? 0.1 : 0.09) - 0.045 * S(u * T * 2), 0, S(u * T * 5) * 0.014]),
    ...(hasTool ? [rot("tool", D, 12, (u) => [0, 0, -u * T * 3])] : []),
    ...(hasDust ? [scale("dust", D, 12, (u) => 0.75 + 0.3 * S(u * T * 2)), rot("dust", D, 12, (u) => [0, u * T * 0.25, 0])] : []),
  ]);
  return [idle, drive("walk", 0.6, 0.012 * k), drive("run", 0.4, 0.02 * k), jump, dig];
}

// ---- The model: one function per type, parts into B (solid) and F (glow), on the rig's bones --------------------------

function sane(spec) {
  const s = spec && typeof spec === "object" ? spec : {};
  const o = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const type = ["person", "quadruped", "car", "bike", "blob"].includes(s.type) ? s.type : "person";
  const h = o(s.head), t = o(s.torso), a = o(s.arms), l = o(s.legs), tl = o(s.tail), v = o(s.vehicle), p = o(s.palette);
  return {
    type, seed: Number(s.seed) >>> 0, style: String(s.style || "chunky"), view: s.view, facing: s.facing,
    head: { shape: h.shape || (type === "blob" ? "none" : "round"), size: num(h.size, type === "quadruped" ? 0.3 : 0.24, 0.05, 0.7), gear: h.gear || "none", face: h.face || "eyes",
      eyes: Math.round(num(h.eyes, 2, 0, 6)), snout: num(h.snout, type === "quadruped" ? 0.45 : 0, 0, 1), color: hex(h.color), gearColor: hex(h.gearColor), faceColor: hex(h.faceColor) },
    torso: { shape: t.shape || "box", width: num(t.width, 0.28, 0.04, 0.8), color: hex(t.color), belt: t.belt === true, emblem: String(t.emblem || "") },
    arms: { count: type === "person" ? (Number(a.count) === 0 ? 0 : 2) : 0, length: num(a.length, 0.38, 0.1, 0.7), thickness: a.thickness || "normal", hands: a.hands || "mitten", color: hex(a.color) },
    legs: { count: type === "person" ? 2 : type === "quadruped" ? 4 : Number(l.count) >= 2 ? 2 : 0, length: num(l.length, type === "quadruped" ? 0.5 : 0.45, 0.1, 1.3), thickness: l.thickness || "normal", feet: l.feet || "boots", color: hex(l.color) },
    neck: num(s.neck, type === "quadruped" ? 0.15 : 0, 0, 0.9),
    tail: { kind: tl.kind || (type === "quadruped" ? "short" : "none"), color: hex(tl.color) },
    vehicle: { body: v.body || (type === "bike" ? "bicycle" : "sedan"), height: num(v.height, type === "bike" ? 0.5 : 0.36, 0.1, 1), cabin: v.cabin || (type === "car" ? "closed" : "none"),
      wheels: Math.round(num(v.wheels, type === "bike" ? 2 : 4, 0, 12)), wheelSize: num(v.wheelSize, type === "bike" ? 0.4 : 0.22, 0.08, 0.7), color: hex(v.color), rider: v.rider === true },
    items: (Array.isArray(s.items) ? s.items : []).filter((x) => x && typeof x === "object").slice(0, 6).map((x) => ({ kind: String(x.kind || "other"), where: String(x.where || ""), size: num(x.size, 0.3, 0.03, 1.2), color: hex(x.color), verb: x.verb || null })),
    palette: { colored: p.colored === true, main: hex(p.main), second: hex(p.second), accent: hex(p.accent), skin: hex(p.skin) },
  };
}

// Eyes: white balls with dark pupils and a glint, looking along `fwd` (-Z by default).
function eyes(B, centres, r, fwd = [0, 0, -1], col = [1, 1, 1], pupil = [0.07, 0.07, 0.1]) {
  for (const c of centres) {
    ell(B, c, r, r, r * 0.8, sg(12), R("flat"), col, { dir: fwd, hint: [0, 1, 0] });
    ell(B, madd(c, fwd, r * 0.62), r * 0.55, r * 0.55, r * 0.35, sg(10), R("flat"), pupil, { dir: fwd, hint: [0, 1, 0] });
    ell(B, add(madd(c, fwd, r * 0.95), [r * 0.18, r * 0.22, 0]), r * 0.16, r * 0.16, r * 0.1, 6, R("flat"), [1, 1, 1], { dir: fwd, hint: [0, 1, 0] });
  }
}

// An atlas decal (ship3d.js's: star, bolt, cross, heart, skull, digits...) as a cutout quad on a surface, tinted by col.
function emblemDecal(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  if (/light|bolt|zap|thunder/.test(t)) return "bolt";
  if (/heart/.test(t)) return "heart";
  if (/skull/.test(t)) return "skull";
  if (/^(x|\+|cross|plus)$/.test(t) || /cross/.test(t)) return "cross";
  if (/^[0-9]$/.test(t)) return t;
  if (/^[0-9]+$/.test(t)) return t[0];
  if (/ring|circle|o$/.test(t)) return "ring";
  if (/arrow/.test(t)) return "arrow";
  return "star";
}
function decal(B, name, c, n, up, r, col) {
  const reg = tex().DEC[name];
  if (!reg) return;
  const nn = nrm(n), sx = nrm(cross(up, nn)), uy = nrm(cross(nn, sx));
  const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => B.v(add(add(c, scl(sx, a * r)), scl(uy, b * r)), nn, ruv(reg, (a + 1) / 2, (1 - b) / 2), col));
  B.tri(q[0], q[1], q[2]); B.tri(q[0], q[2], q[3]);
}

// Tools and attachments. g = the grip point, d = the shaft direction (unit), u = the head's "up" (unit, ⟂ d), L = length.
function tool(B, F, kind, g, d, u, L, P, col) {
  const s = cross(d, u);
  const metal = P.metal, wood = C("#a0662f");
  let c = col || null;
  switch (kind) {
    case "shovel": case "pickaxe": {
      const shaft = L * 0.78;
      cyl(B, madd(g, d, -L * 0.22), madd(g, d, shaft - L * 0.22), L * 0.03, L * 0.03, sg(8), R("flat"), c || wood, 0.4);
      tube(B, [madd(madd(g, d, -L * 0.24), s, -L * 0.07), madd(g, d, -L * 0.28), madd(madd(g, d, -L * 0.24), s, L * 0.07)], L * 0.022, 6, R("trim"), P.dark); // the D grip
      const tip = madd(g, d, shaft - L * 0.24);
      if (kind === "shovel") {
        plate(B, [[-0.5, 0], [0.5, 0], [0.42, 0.62], [0, 1], [-0.42, 0.62]].map(([a, b]) => [a * L * 0.3, b * L * 0.36]), tip, s, d, L * 0.018, R("metal"), metal, P.steel);
      } else {
        tube(B, [madd(madd(tip, u, -L * 0.04), d, L * 0.02), madd(tip, u, L * 0.01), madd(madd(tip, u, L * 0.04), d, -L * 0.03)].map((p, i) => madd(p, s, (i - 1) * L * 0.26)), [L * 0.025, L * 0.04, L * 0.02], 6, R("metal"), metal);
      }
      break;
    }
    case "drill": case "saw": {
      // a chunky hand drill: grip, a body, a hazard-striped cone pointing along d
      const body0 = madd(g, u, L * 0.08);
      box(B, madd(body0, d, L * 0.12), L * 0.09, L * 0.2, L * 0.1, R("panels"), c || P.gold, { dir: d, hint: u, n: 3.5, seg: 10 });
      box(B, madd(g, u, -L * 0.04), L * 0.05, L * 0.1, L * 0.06, R("trim"), P.dark, { dir: u, hint: d, n: 3, seg: 8 });
      if (kind === "saw") { plate(B, Array.from({ length: 10 }, (_, i) => { const a = i / 10 * Math.PI * 2; return [Math.cos(a) * L * 0.2, Math.sin(a) * L * 0.2]; }), madd(body0, d, L * 0.42), d, u, L * 0.012, R("metal"), metal, P.steel); }
      else {
        const base = madd(body0, d, L * 0.3);
        cyl(B, base, madd(base, d, L * 0.06), L * 0.07, L * 0.07, sg(10), R("metal"), metal);
        const rows = [], k = 7;
        for (let i = 0; i <= k; i++) { const t = i / k; rows.push({ t: L * 0.06 + t * L * 0.42, a: L * 0.075 * (1 - t) + 1e-4, b: L * 0.075 * (1 - t) + 1e-4, v: t }); }
        rows[rows.length - 1].a = rows[rows.length - 1].b = 0;
        rings(B, rows, sg(10), frame(base, d, u), R("hazard"), [1, 1, 1]);
      }
      break;
    }
    case "blaster": case "cannon": {
      const k = kind === "cannon" ? 1.5 : 1.25;
      if (c) c = shade(c, 1.35, 1.1);
      box(B, madd(madd(g, u, L * 0.09 * k), d, L * 0.12), L * 0.08 * k, L * 0.22 * k, L * 0.1 * k, R("panels"), c || P.accent, { dir: d, hint: u, n: 3.5, seg: 10 });
      box(B, madd(g, u, -L * 0.02), L * 0.045, L * 0.09, L * 0.055, R("trim"), P.dark, { dir: u, hint: d, n: 3, seg: 8 });
      const m0 = madd(madd(g, u, L * 0.11 * k), d, L * 0.3 * k);
      cyl(B, m0, madd(m0, d, L * 0.3 * k), L * 0.04 * k, L * 0.04 * k, sg(9), R("metal"), P.steel);
      cyl(B, madd(m0, d, L * 0.28 * k), madd(m0, d, L * 0.36 * k), L * 0.06 * k, L * 0.06 * k, sg(9), R("trim"), P.dark);
      ell(F, madd(m0, d, L * 0.37 * k), L * 0.035 * k, L * 0.035 * k, L * 0.035 * k, 8, R("flat"), [0.3, 0.9, 1.4]);
      break;
    }
    case "lamp": case "torch": {
      cyl(B, madd(g, d, -L * 0.15), madd(g, d, L * 0.25), L * 0.05, L * 0.06, sg(9), R("trim"), c ? shade(c, 0.6) : P.dark);
      const head = madd(g, d, L * 0.25);
      cyl(B, head, madd(head, d, L * 0.14), L * 0.08, L * 0.11, sg(10), R("metal"), c || P.gold);
      ell(B, madd(head, d, L * 0.15), L * 0.09, L * 0.03, L * 0.09, sg(10), R("glass"), [1, 0.96, 0.75], { dir: d, hint: u });
      ell(F, madd(head, d, L * 0.17), L * 0.16, L * 0.06, L * 0.16, sg(10), R("flat"), [1.6, 1.25, 0.5], { dir: d, hint: u });
      // a soft cone of light along d
      const rows = [{ t: 0, a: L * 0.1, b: L * 0.1, c: [0.2, 0.17, 0.07] }, { t: L * 0.7, a: L * 0.3, b: L * 0.3, c: [0, 0, 0] }];
      rings(F, rows, sg(10), frame(madd(head, d, L * 0.18), d, u), R("flat"), [0.5, 0.4, 0.15]);
      break;
    }
    case "shield": {
      const k = L * 0.7;
      plate(B, Array.from({ length: 12 }, (_, i) => { const a = i / 12 * Math.PI * 2; return [Math.cos(a) * k * 0.5, Math.sin(a) * k * 0.62]; }), madd(g, u, -0.04), s, d, k * 0.035, R("panels"), c || P.accent, P.trim);
      ell(B, madd(madd(g, u, -0.04), cross(s, d), -k * 0.04), k * 0.14, k * 0.14, k * 0.05, sg(10), R("metal"), P.gold, { dir: cross(s, d), hint: d });
      break;
    }
    case "sword": {
      cyl(B, madd(g, d, -L * 0.12), madd(g, d, L * 0.1), L * 0.03, L * 0.03, 6, R("trim"), P.dark);
      box(B, madd(g, d, L * 0.12), L * 0.14, L * 0.02, L * 0.03, R("metal"), P.gold, { dir: d, hint: u, n: 3, seg: 6 });
      plate(B, [[-0.05, 0], [0.05, 0], [0.05, 0.85], [0, 1], [-0.05, 0.85]].map(([a, b]) => [a * L, b * L * 0.75]), madd(g, d, L * 0.14), s, d, L * 0.012, R("metal"), c || metal, P.steel);
      break;
    }
    case "wand": {
      cyl(B, madd(g, d, -L * 0.1), madd(g, d, L * 0.45), L * 0.02, L * 0.015, 6, R("flat"), P.dark);
      ell(F, madd(g, d, L * 0.5), L * 0.07, L * 0.07, L * 0.07, 8, R("flat"), [1.4, 0.6, 1.6]);
      ell(B, madd(g, d, L * 0.5), L * 0.045, L * 0.045, L * 0.045, 8, R("glass"), [1, 0.7, 1]);
      break;
    }
    case "magnet": {
      const pts = Array.from({ length: 9 }, (_, i) => { const a = Math.PI * i / 8; return madd(madd(g, s, Math.cos(a) * L * 0.18), d, L * 0.15 + Math.sin(a) * L * 0.2); });
      tube(B, pts, L * 0.06, sg(8), R("flat"), c || P.red);
      for (const e of [pts[0], pts[8]]) cyl(B, e, madd(e, d, -L * 0.1), L * 0.065, L * 0.065, sg(8), R("metal"), P.metal);
      break;
    }
    default: { // a generic gadget: a box with a light
      box(B, madd(g, d, L * 0.1), L * 0.1, L * 0.14, L * 0.1, R("panels"), c || P.accent, { dir: d, hint: u, n: 3.5, seg: 8 });
      ell(F, madd(g, d, L * 0.26), L * 0.05, L * 0.05, L * 0.05, 6, R("flat"), [1.2, 1.0, 0.4]);
    }
  }
}
const HAND_TOOLS = new Set(["shovel", "pickaxe", "drill", "saw", "blaster", "cannon", "lamp", "torch", "shield", "sword", "wand", "magnet", "other", "flag", "dish", "eye", "star"]);

// Back, head, body attachments shared by every type: c = anchor, up, back (outward normal), size scale k.
function attachment(B, F, kind, c, up, out, k, P, col) {
  const side = nrm(cross(up, out));
  switch (kind) {
    case "backpack": case "jetpack": {
      box(B, madd(c, out, k * 0.13), k * 0.2, k * 0.24, k * 0.11, R("panels"), col || (P.ink ? P.light : P.second), { dir: up, hint: out, n: 4, seg: 10 });
      if (kind === "jetpack") {
        for (const sx of [-1, 1]) {
          const t = madd(madd(c, out, k * 0.2), side, sx * k * 0.12);
          cyl(B, madd(t, up, k * 0.15), madd(t, up, -k * 0.3), k * 0.07, k * 0.08, sg(10), R("metal"), P.metal);
          cyl(B, madd(t, up, -k * 0.3), madd(t, up, -k * 0.36), k * 0.08, k * 0.065, sg(10), R("nozzle"), [1, 1, 1]);
          const rows = [{ t: 0, a: k * 0.06, b: k * 0.06, c: [1.5, 0.9, 0.25] }, { t: k * 0.18, a: k * 0.05, b: k * 0.05, c: [1.2, 0.45, 0.1] }, { t: k * 0.4, a: 0, b: 0, c: [0.4, 0.05, 0] }];
          rings(F, rows, sg(8), frame(madd(t, up, -k * 0.36), scl(up, -1), out), R("flat"), [1, 0.5, 0.1]);
        }
      } else {
        box(B, madd(madd(c, out, k * 0.25), up, -k * 0.08), k * 0.14, k * 0.08, k * 0.05, R("trim"), P.trim, { dir: up, hint: out, n: 4, seg: 8 });
      }
      break;
    }
    case "antenna": {
      const top = madd(c, up, k * 0.5);
      cyl(B, c, top, k * 0.02, k * 0.015, 6, R("metal"), P.steel);
      ell(B, top, k * 0.06, k * 0.06, k * 0.06, sg(8), R("flat"), col || P.red);
      ell(F, top, k * 0.1, k * 0.1, k * 0.1, 8, R("flat"), (col ? scl(col, 0.6) : [0.9, 0.15, 0.15]));
      break;
    }
    case "dish": {
      cyl(B, c, madd(c, up, k * 0.2), k * 0.02, k * 0.02, 6, R("metal"), P.steel);
      const rows = [{ t: 0, a: 0, b: 0 }, { t: k * 0.02, a: k * 0.08, b: k * 0.08 }, { t: k * 0.08, a: k * 0.2, b: k * 0.2 }, { t: k * 0.06, a: k * 0.2, b: k * 0.2 }, { t: 0, a: k * 0.02, b: k * 0.02 }];
      rings(B, rows, sg(12), frame(madd(c, up, k * 0.2), nrm(add(up, scl(out, -0.6))), out), R("metal"), col || P.light);
      break;
    }
    case "cape": {
      plate(B, [[-0.5, 0], [0.5, 0], [0.7, -1], [-0.7, -1]].map(([a, b]) => [a * k * 0.42, b * k * 0.75]), madd(c, out, k * 0.06), side, up, k * 0.012, R("flat"), col || P.red, shade(col || P.red, 0.7));
      break;
    }
    case "spikes": {
      for (let i = 0; i < 4; i++) {
        const b0 = madd(madd(c, up, (i - 1.5) * k * 0.14), out, 0);
        const rows = [{ t: 0, a: k * 0.06, b: k * 0.06 }, { t: k * 0.18, a: 0, b: 0 }];
        rings(B, rows, sg(6), frame(b0, out, up), R("metal"), col || P.metal);
      }
      break;
    }
    case "wings": {
      for (const sx of [-1, 1]) plate(B, [[0, 0], [0.9, 0.35], [1, 0.05], [0.7, -0.25]].map(([a, b]) => [a * k * 0.7 * sx, b * k * 0.6]), madd(c, out, k * 0.08), side, up, k * 0.015, R("flat"), col || P.white, P.light);
      break;
    }
    case "cross": case "lightning": case "star": {
      const pts = kind === "cross" ? [[-0.15, -0.5], [0.15, -0.5], [0.15, -0.15], [0.5, -0.15], [0.5, 0.15], [0.15, 0.15], [0.15, 0.5], [-0.15, 0.5], [-0.15, 0.15], [-0.5, 0.15], [-0.5, -0.15], [-0.15, -0.15]]
        : kind === "lightning" ? [[-0.1, 0.5], [0.35, 0.5], [0.08, 0.06], [0.32, 0.06], [-0.2, -0.55], [-0.02, -0.08], [-0.28, -0.08]]
          : Array.from({ length: 10 }, (_, i) => { const a = Math.PI / 2 + i / 10 * Math.PI * 2, r = i % 2 ? 0.22 : 0.5; return [Math.cos(a) * r, Math.sin(a) * r]; });
      // concave outlines: fan from the centre is fine for these (star-shaped from the centre)
      plate(B, pts.map(([a, b]) => [a * k * 0.3, b * k * 0.3]), madd(c, out, k * 0.015), side, up, k * 0.012, R("flat"), col || (kind === "cross" ? P.red : P.gold), P.white);
      break;
    }
    case "bomb": {
      ell(B, madd(c, out, k * 0.1), k * 0.11, k * 0.11, k * 0.11, sg(10), R("flat"), P.dark);
      tube(B, [madd(madd(c, out, k * 0.1), up, k * 0.1), madd(madd(c, out, k * 0.14), up, k * 0.17)], k * 0.015, 5, R("flat"), P.light);
      ell(F, madd(madd(c, out, k * 0.15), up, k * 0.19), k * 0.04, k * 0.04, k * 0.04, 6, R("flat"), [1.5, 0.8, 0.2]);
      break;
    }
    case "octopus": case "ink bottle": {
      ell(B, madd(c, out, k * 0.1), k * 0.1, k * 0.12, k * 0.1, sg(10), R("flat"), col || C("#9b5de5"));
      for (let i = 0; i < 4; i++) tube(B, [madd(madd(c, out, k * 0.1), side, (i - 1.5) * k * 0.05), madd(madd(madd(c, out, k * 0.13), side, (i - 1.5) * k * 0.08), up, -k * 0.18)], k * 0.02, 5, R("flat"), col || C("#9b5de5"));
      break;
    }
    case "flag": {
      cyl(B, c, madd(c, up, k * 0.8), k * 0.015, k * 0.015, 6, R("metal"), P.steel);
      plate(B, [[0, 0], [0.4, 0], [0.4, -0.25], [0, -0.25]].map(([a, b]) => [a * k, b * k]), madd(c, up, k * 0.8), side, up, k * 0.01, R("flat"), col || P.accent);
      break;
    }
    case "springs": {
      const pts = Array.from({ length: 25 }, (_, i) => { const a = i / 24 * Math.PI * 8; return add(madd(c, up, -i / 24 * k * 0.18), [Math.cos(a) * k * 0.06, 0, Math.sin(a) * k * 0.06]); });
      tube(B, pts, k * 0.012, 5, R("metal"), P.metal);
      break;
    }
    case "eye": {
      eyes(B, [madd(c, out, k * 0.08)], k * 0.1, out);
      break;
    }
    default: {
      box(B, madd(c, out, k * 0.06), k * 0.1, k * 0.1, k * 0.06, R("panels"), col || P.accent, { dir: up, hint: out, n: 3.5, seg: 8 });
    }
  }
}

// ---- Person ------------------------------------------------------------------------------------------------------------

function buildPerson(s, P, B, F, rig, rnd) {
  const H = 1.8, robot = s.style === "robot" || s.head.shape === "square" && s.head.gear !== "astronaut helmet" && s.head.face !== "visor";
  const astro = s.head.gear === "astronaut helmet" || (s.head.face === "visor" && (s.head.gear === "none" || s.head.gear === "helmet") && !robot);
  // Proportions: the drawing's, pulled into chunky, readable limits.
  const fHead = clamp(0.18 + (s.head.size - 0.14) * 0.6, 0.19, 0.29) + (astro ? 0.012 : 0);
  const fLeg = clamp(0.33 + (s.legs.length - 0.3) * 0.55, 0.33, 0.45);
  const headH = H * fHead, legL = H * fLeg;
  const thick = { thin: 0.85, normal: 1, thick: 1.22 };
  const tw = clamp(0.21 + (s.torso.width - 0.15) * 0.45, 0.2, 0.32) * (s.torso.shape === "slim" ? 0.88 : s.torso.shape === "barrel" || s.torso.shape === "round" ? 1.06 : 1);
  const shoulderHalf = H * tw / 2;
  const footH = 0.1, neckL = H * 0.03;
  const top = H - headH - neckL; // the shoulder line
  const armY = top - 0.07;
  const rA = 0.06 * thick[s.arms.thickness] * (robot ? 1.12 : 1), rL = 0.078 * thick[s.legs.thickness] * (robot ? 1.1 : 1);
  const hipHalf = Math.min(shoulderHalf * 0.62, 0.15);
  const armLen = H * clamp(0.27 + (s.arms.length - 0.3) * 0.4, 0.27, 0.36);
  const spineY = legL + (top - legL) * 0.28, chestY = legL + (top - legL) * 0.55;
  const kneeY = footH + (legL - footH) * 0.5;
  // Bones (world targets, A-008 rest rotations).
  const W = {
    hips: [0, legL, 0], spine: [0, spineY, 0], chest: [0, chestY, 0], neck: [0, top, 0], head: [0, top + neckL, 0],
    shoulder_l: [0.06, armY, 0], upper_arm_l: [shoulderHalf, armY, 0], fore_arm_l: [shoulderHalf + armLen * 0.45, armY, 0], hand_l: [shoulderHalf + armLen * 0.82, armY, 0],
    shoulder_r: [-0.06, armY, 0], upper_arm_r: [-shoulderHalf, armY, 0], fore_arm_r: [-(shoulderHalf + armLen * 0.45), armY, 0], hand_r: [-(shoulderHalf + armLen * 0.82), armY, 0],
    thigh_l: [hipHalf, legL, 0], shin_l: [hipHalf, kneeY, 0], foot_l: [hipHalf, footH, 0],
    thigh_r: [-hipHalf, legL, 0], shin_r: [-hipHalf, kneeY, 0], foot_r: [-hipHalf, footH, 0],
  };
  for (const [name, parent, q] of PERSON_BONES) rig.bone(name, parent, W[name], q);
  const on = (name) => { B.bone = F.bone = rig.id(name); };
  const suit = P.main, suit2 = P.legs, glove = P.ink ? P.white : (P.arms === P.main ? shade(P.main, 0.75) : P.arms);
  const bootCol = P.ink ? P.white : (s.legs.color ? shade(P.legs, 0.7) : shade(P.second, 0.55));
  const panel = R(robot ? "panels" : "flat"), suitReg = R(robot || astro ? "panels" : "flat");
  const torsoN = s.torso.shape === "box" || robot ? 4 : 2.6, depth = shoulderHalf * (s.torso.shape === "slim" ? 0.6 : 0.72);
  // Torso: pelvis (hips), belly (spine), chest (chest), overlapping rounded blocks.
  on("hips");
  box(B, [0, legL + 0.02, 0], hipHalf + rL * 0.95, 0.11, depth * 0.92, suitReg, suit2, { n: torsoN, seg: 14 });
  on("spine");
  box(B, [0, (legL + chestY) / 2 + 0.03, 0], shoulderHalf * (s.torso.shape === "round" || s.torso.shape === "barrel" ? 1.0 : 0.86), (chestY - legL) / 2 + 0.05, depth * (s.torso.shape === "round" ? 1.08 : 0.95), suitReg, suit, { n: torsoN, seg: 14 });
  if (s.torso.belt || astro) { box(B, [0, legL + 0.11, 0], hipHalf + rL + 0.012, 0.035, depth * 0.98, R("trim"), P.trim, { n: torsoN, seg: 14, round: 0.02 }); box(B, [0, legL + 0.11, -depth * 0.98], 0.05, 0.03, 0.012, R("metal"), P.gold, { n: 3, seg: 6, round: 0.008 }); }
  on("chest");
  const chestH = (top - chestY) / 2 + 0.06;
  box(B, [0, chestY + chestH - 0.06, 0], shoulderHalf * 1.02, chestH, depth, suitReg, suit, { n: torsoN, seg: 16, taper: s.torso.shape === "tall" ? 0.92 : 1.0 });
  if (astro) {
    // collar ring and a chest control box with lights
    cyl(B, [0, top - 0.035, 0], [0, top + 0.035, 0], depth * 0.85, depth * 0.8, sg(16), R("metal"), P.light, 0.5);
    const bx = -shoulderHalf * 0.42;
    box(B, [bx, chestY + 0.04, -depth - 0.012], shoulderHalf * 0.36, 0.06, 0.03, R("panels"), P.light, { n: 4, seg: 8, round: 0.015 });
    for (let i = 0; i < 3; i++) ell(F, [bx - shoulderHalf * 0.18 + i * shoulderHalf * 0.18, chestY + 0.05, -depth - 0.045], 0.016, 0.016, 0.01, 6, R("flat"), [[1.4, 0.3, 0.3], [0.3, 1.4, 0.5], [1.4, 1.1, 0.2]][i]);
  }
  const emb = emblemDecal(s.torso.emblem);
  if (emb) decal(B, emb, [0, chestY + chestH * 0.55, -depth - 0.008], [0, 0, -1], [0, 1, 0], Math.min(shoulderHalf * 0.55, 0.13), emb === "bolt" || emb === "star" ? C("#ffd23f") : emb === "heart" ? P.red : [1, 1, 1]);
  rig.patch = { bone: "chest", c: [shoulderHalf * (emb ? 0.62 : 0.45), chestY + chestH * (emb ? 0.25 : 0.55), -depth - 0.01], n: [0, 0, -1], up: [0, 1, 0], r: Math.min(0.075, shoulderHalf * 0.32) };
  rig.socket("back", "chest", [0, chestY + 0.02, depth + 0.02]);
  // Shoulder pads, arms, hands.
  for (const side of ["l", "r"]) {
    const sx = side === "l" ? 1 : -1;
    on(`shoulder_${side}`);
    ell(B, [sx * (shoulderHalf - 0.01), armY + 0.01, 0], rA * 1.55, rA * 1.35, rA * 1.45, sg(12), suitReg, robot ? P.steel : shade(suit, 0.9));
    if (!s.arms.count) continue;
    on(`upper_arm_${side}`);
    const ua0 = [sx * shoulderHalf, armY, 0], el = [sx * (shoulderHalf + armLen * 0.45), armY, 0], wr = [sx * (shoulderHalf + armLen * 0.82), armY, 0];
    capsule(B, ua0, el, rA * 1.08, rA, sg(10), panel, P.arms, robot ? 3.2 : 2);
    on(`fore_arm_${side}`);
    capsule(B, el, wr, rA, rA * 0.95, sg(10), panel, P.arms, robot ? 3.2 : 2);
    cyl(B, madd(wr, [sx, 0, 0], -0.05), madd(wr, [sx, 0, 0], 0.0), rA * 1.25, rA * 1.3, sg(10), R("flat"), glove, 0.4, [0, 0, -1]); // glove cuff
    on(`hand_${side}`);
    const hc = madd(wr, [sx, 0, 0], rA * 1.1);
    if (s.arms.hands === "claw" || s.arms.hands === "robot") {
      box(B, hc, rA * 1.1, rA * 0.8, rA * 1.0, R("metal"), robot ? P.steel : glove, { n: 4, seg: 8, dir: [sx, 0, 0], hint: [0, 1, 0] });
      for (const dz of [-1, 1]) capsule(B, add(hc, [sx * rA * 0.6, 0, dz * rA * 0.55]), add(hc, [sx * rA * 2.0, 0, dz * rA * 0.3]), rA * 0.38, rA * 0.22, 8, R("flat"), robot ? (P.ink ? P.red : P.accent) : glove);
    } else {
      ell(B, hc, rA * 1.3, rA * 1.15, rA * 1.25, sg(10), R("flat"), glove);
      ell(B, add(hc, [-sx * rA * 0.2, rA * 0.15, -rA * 1.0]), rA * 0.5, rA * 0.45, rA * 0.55, 8, R("flat"), glove); // thumb
    }
    rig.socket(`hand_${side}`, `hand_${side}`, add(hc, [sx * rA * 0.6, 0, -0.02]));
  }
  // Legs and boots.
  for (const side of ["l", "r"]) {
    const sx = side === "l" ? 1 : -1, x = sx * hipHalf;
    on(`thigh_${side}`);
    capsule(B, [x, legL, 0], [x, kneeY, 0], rL * 1.12, rL, sg(10), panel, suit2, robot ? 3.2 : 2);
    on(`shin_${side}`);
    capsule(B, [x, kneeY, 0], [x, footH + 0.04, 0], rL, rL * 0.92, sg(10), panel, suit2, robot ? 3.2 : 2);
    if (astro || s.legs.feet === "boots") cyl(B, [x, footH + 0.02, 0], [x, footH + 0.13, 0], rL * 1.22, rL * 1.15, sg(10), R("flat"), bootCol, 0.5);
    on(`foot_${side}`);
    if (s.legs.feet === "wheels") {
      cyl(B, [x - 0.06, 0.07, -0.02], [x + 0.06, 0.07, -0.02], 0.07, 0.07, sg(10), R("trim"), P.dark, 0.4);
    } else {
      const toe = s.legs.feet === "shoes" ? 0.2 : 0.24;
      box(B, [x, footH * 0.62, -0.04], rL * 1.25, footH * 0.62, toe / 2 + 0.03, R("flat"), bootCol, { n: 2.8, seg: 10, dir: [0, 1, 0], round: 0.04 });
      box(B, [x, 0.022, -0.04], rL * 1.3, 0.022, toe / 2 + 0.04, R("trim"), P.trim, { n: 3, seg: 10, round: 0.012 });
    }
  }
  rig.socket("feet", "hips", [0, 0, 0]);
  // Head.
  on("neck");
  cyl(B, [0, top - 0.02, 0], [0, top + neckL + 0.03, 0], rA * 1.2, rA * 1.1, sg(10), R("flat"), astro ? P.light : robot ? P.steel : P.skin, 0.3);
  on("head");
  const hb = top + neckL; // head bottom
  const hr = headH / 2, hc = [0, hb + hr, 0];
  const skin = P.face || P.head || P.skin;
  if (astro) {
    const Rh = hr * 1.04, cc = [0, H - Rh, 0];
    const shell = P.gear || P.head || (P.ink ? P.white : P.light);
    ell(B, cc, Rh, Rh * 0.98, Rh, sg(20), R("flat"), shell);
    // the visor: a glass bulge on the front, framed
    const vcol = s.head.faceColor ? mix(P.face, [1, 1, 1], 0.35) : [1, 1, 1];
    ell(B, add(cc, [0, -Rh * 0.05, -Rh * 0.44]), Rh * 0.9, Rh * 0.72, Rh * 0.7, sg(18), R("flat"), P.ink ? P.player : shade(shell, 0.8), { dir: [0, 0, -1], hint: [0, 1, 0] }); // the visor's frame
    ell(B, add(cc, [0, -Rh * 0.05, -Rh * 0.5]), Rh * 0.8, Rh * 0.62, Rh * 0.7, sg(18), R("glass"), vcol, { dir: [0, 0, -1], hint: [0, 1, 0] });
    ell(B, add(cc, [-Rh * 0.3, Rh * 0.18, -Rh * 1.12]), Rh * 0.17, Rh * 0.07, Rh * 0.05, 8, R("flat"), [1.6, 1.6, 1.6], { dir: [0, 0, -1], hint: [0, 1, 0] }); // a glint
    for (const sx of [-1, 1]) cyl(B, add(cc, [sx * Rh * 0.92, -Rh * 0.05, 0]), add(cc, [sx * Rh * 1.06, -Rh * 0.05, 0]), Rh * 0.24, Rh * 0.2, sg(10), R("metal"), P.ink ? P.player : P.metal, 0.4);
    if (P.ink) box(B, add(cc, [0, Rh * 0.75, 0]), Rh * 0.16, Rh * 0.08, Rh * 0.55, R("racing"), P.player, { n: 3, seg: 8, round: 0.02 }); // a stripe over the top
  } else if (robot || s.head.shape === "square") {
    const hx = hr * clamp(0.85 + s.torso.width, 0.95, 1.2);
    box(B, hc, hx, hr, hr * 0.9, R("panels"), P.head || (robot ? P.metal : skin), { n: 5, seg: 14, round: hr * 0.25 });
    if (s.head.face === "visor" || s.head.face === "goggles") {
      box(B, add(hc, [0, hr * 0.12, -hr * 0.88]), hx * 0.82, hr * 0.26, hr * 0.06, R("glass"), mix(P.face || C("#22d3ee"), [1, 1, 1], 0.1), { n: 4, seg: 10, round: 0.02 });
      ell(F, add(hc, [0, hr * 0.12, -hr * 0.95]), hx * 0.6, hr * 0.14, 0.01, 8, R("flat"), scl(P.face || C("#22d3ee"), 0.8));
    } else {
      const ne = clamp(s.head.eyes || 2, 1, 3);
      for (let i = 0; i < ne; i++) {
        const ex = (i - (ne - 1) / 2) * hx * 0.62, ec = add(hc, [ex, hr * 0.15, -hr * 0.9]);
        const ecol = P.face || C("#22d3ee");
        cyl(B, add(ec, [0, 0, 0.03]), add(ec, [0, 0, -0.025]), hr * 0.28, hr * 0.28, sg(12), R("trim"), P.dark, 0.3, [0, 1, 0]);
        ell(B, add(ec, [0, 0, -0.03]), hr * 0.2, hr * 0.2, hr * 0.06, sg(10), R("glass"), ecol, { dir: [0, 0, -1], hint: [0, 1, 0] });
        ell(F, add(ec, [0, 0, -0.045]), hr * 0.24, hr * 0.24, 0.01, 8, R("flat"), scl(ecol, 1.1), { dir: [0, 0, -1], hint: [0, 1, 0] });
      }
      box(B, add(hc, [0, -hr * 0.45, -hr * 0.88]), hx * 0.4, hr * 0.07, hr * 0.05, R("trim"), P.dark, { n: 4, seg: 8, round: 0.01 }); // mouth grille
    }
    for (const sx of [-1, 1]) cyl(B, add(hc, [sx * hx * 0.95, 0, 0]), add(hc, [sx * hx * 1.12, 0, 0]), hr * 0.25, hr * 0.2, sg(10), R("metal"), P.steel, 0.4);
  } else {
    // a round / oval head with a face
    const ry = s.head.shape === "oval" ? hr * 1.12 : hr;
    ell(B, hc, hr * 0.98, ry, hr * 0.95, sg(18), R("flat"), skin);
    if (s.head.face === "visor" || s.head.face === "goggles") {
      box(B, add(hc, [0, hr * 0.12, -hr * 0.78]), hr * 0.8, hr * 0.22, hr * 0.18, R("glass"), mix(P.face || C("#3d7bff"), [1, 1, 1], 0.1), { n: 3, seg: 12, round: 0.03 });
    } else if (s.head.face !== "none" && s.head.face !== "mask") {
      const ne = clamp(s.head.eyes || 2, 1, 3);
      eyes(B, Array.from({ length: ne }, (_, i) => add(hc, [(i - (ne - 1) / 2) * hr * 0.62, hr * 0.12, -hr * 0.78])), hr * 0.2);
      tube(B, Array.from({ length: 7 }, (_, i) => { const a = Math.PI * (0.15 + 0.7 * i / 6); return add(hc, [Math.cos(a) * hr * 0.32, -hr * 0.3 - Math.sin(a) * hr * 0.14, -hr * 0.9 + Math.sin(a) * 0.01]); }), hr * 0.045, 5, R("flat"), C("#7a2a2a"));
      ell(B, add(hc, [0, -hr * 0.05, -hr * 0.97]), hr * 0.12, hr * 0.1, hr * 0.1, 8, R("flat"), shade(skin, 0.92));
    }
    if (s.head.face === "mask") box(B, add(hc, [0, -hr * 0.2, -hr * 0.72]), hr * 0.7, hr * 0.35, hr * 0.3, R("flat"), P.gear || P.dark, { n: 3, seg: 10 });
    const gearCol = P.gear || P.accent;
    switch (s.head.gear) {
      case "helmet": {
        const rows = [];
        for (let i = 0; i <= 6; i++) { const a = Math.PI / 2 * i / 6; rows.push({ t: Math.sin(a) * hr * 1.08, a: Math.cos(a) * hr * 1.08, b: Math.cos(a) * hr * 1.08 }); }
        rows[rows.length - 1].a = rows[rows.length - 1].b = 0;
        rings(B, rows, sg(18), frame(add(hc, [0, hr * 0.12, 0.01]), [0, 1, 0], [0, 0, -1]), R("panels"), P.gear || P.player);
        cyl(B, add(hc, [0, hr * 0.1, 0]), add(hc, [0, hr * 0.2, 0]), hr * 1.1, hr * 1.1, sg(18), R("trim"), P.trim, 0.3);
        break;
      }
      case "cap": {
        const rows = [];
        for (let i = 0; i <= 5; i++) { const a = Math.PI / 2 * i / 5; rows.push({ t: Math.sin(a) * hr * 1.02, a: Math.cos(a) * hr * 1.03, b: Math.cos(a) * hr * 1.03 }); }
        rows[rows.length - 1].a = rows[rows.length - 1].b = 0;
        rings(B, rows, sg(16), frame(add(hc, [0, hr * 0.2, 0]), [0, 1, 0], [0, 0, -1]), R("flat"), gearCol);
        box(B, add(hc, [0, hr * 0.24, -hr * 1.0]), hr * 0.6, hr * 0.05, hr * 0.38, R("flat"), shade(gearCol, 0.8), { n: 2.5, seg: 10 });
        break;
      }
      case "hat": {
        cyl(B, add(hc, [0, hr * 0.55, 0]), add(hc, [0, hr * 0.63, 0]), hr * 1.6, hr * 1.6, sg(18), R("flat"), gearCol, 0.3);
        cyl(B, add(hc, [0, hr * 0.6, 0]), add(hc, [0, hr * 1.5, 0]), hr * 0.85, hr * 0.8, sg(16), R("flat"), gearCol, 0.3);
        cyl(B, add(hc, [0, hr * 0.62, 0]), add(hc, [0, hr * 0.8, 0]), hr * 0.87, hr * 0.87, sg(16), R("flat"), P.dark, 0.2);
        break;
      }
      case "hair": case "mohawk": {
        const hcol = P.gear || P.head && P.head !== skin && P.head || C("#5a3215");
        if (s.head.gear === "mohawk") for (let i = 0; i < 5; i++) ell(B, add(hc, [0, ry * 0.95 + Math.sin(i / 4 * Math.PI) * hr * 0.15, (i - 2) * hr * 0.32]), hr * 0.12, hr * 0.3, hr * 0.18, 8, R("flat"), hcol);
        else {
          ell(B, add(hc, [0, ry * 0.42, hr * 0.22]), hr * 1.06, ry * 0.72, hr * 0.92, sg(16), R("flat"), hcol);
          ell(B, add(hc, [0, ry * 0.62, -hr * 0.3]), hr * 0.86, ry * 0.36, hr * 0.62, sg(12), R("flat"), hcol); // the fringe
          for (const sx of [-1, 1]) ell(B, add(hc, [sx * hr * 0.95, ry * 0.3, hr * 0.05]), hr * 0.42, hr * 0.42, hr * 0.42, sg(10), R("flat"), hcol); // puffs
        }
        break;
      }
      case "crown": {
        for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const b0 = add(hc, [Math.cos(a) * hr * 0.55, ry * 0.85, Math.sin(a) * hr * 0.55]); rings(B, [{ t: 0, a: hr * 0.16, b: hr * 0.16 }, { t: hr * 0.38, a: 0, b: 0 }], 6, frame(b0, [0, 1, 0]), R("metal"), P.gold); }
        cyl(B, add(hc, [0, ry * 0.75, 0]), add(hc, [0, ry * 0.95, 0]), hr * 0.62, hr * 0.62, sg(14), R("metal"), P.gold, 0.2);
        break;
      }
      case "antenna": attachment(B, F, "antenna", add(hc, [0, ry * 0.95, 0]), [0, 1, 0], [0, 0, -1], 0.5, P, P.gear); break;
      case "horns": for (const sx of [-1, 1]) capsule(B, add(hc, [sx * hr * 0.5, ry * 0.7, 0]), add(hc, [sx * hr * 0.85, ry * 1.25, -hr * 0.1]), hr * 0.15, hr * 0.04, 8, R("flat"), P.gear || P.light); break;
      case "ears": for (const sx of [-1, 1]) ell(B, add(hc, [sx * hr * 0.6, ry * 0.85, 0]), hr * 0.22, hr * 0.38, hr * 0.12, 8, R("flat"), P.gear || skin); break;
      default: break;
    }
  }
  rig.socket("head", "head", [0, H, 0]);
  // Items: hand tools in the hands (right = the image's right = hand_r, the rig's -X), the rest on the back, head or chest.
  const HAND_DIR = { right: [-1, 0, 0], left: [1, 0, 0] };
  for (const it of s.items) {
    const k = it.kind;
    if (k === "claws") { for (const side of ["l", "r"]) { on(`hand_${side}`); const sx = side === "l" ? 1 : -1, hc2 = [sx * (shoulderHalf + armLen * 0.82 + rA * 1.1), armY, 0]; for (let i = -1; i <= 1; i++) capsule(B, add(hc2, [sx * rA, 0, i * rA * 0.6]), add(hc2, [sx * rA * 2.6, -rA * 0.4, i * rA * 0.9]), rA * 0.3, rA * 0.08, 6, R("flat"), it.color ? C(it.color) : P.light); } continue; }
    if (k === "springs") { for (const side of ["l", "r"]) { on(`foot_${side}`); attachment(B, F, "springs", [(side === "l" ? 1 : -1) * hipHalf, 0.0, -0.03], [0, 1, 0], [0, 0, -1], 0.6, P, null); } continue; }
    const handed = it.where === "right hand" || it.where === "left hand" || it.where === "both hands" || (HAND_TOOLS.has(k) && !["back", "head", "chest"].includes(it.where));
    if (handed && s.arms.count) {
      const side = it.where === "left hand" ? "l" : "r";
      const sx = side === "l" ? 1 : -1, g = [sx * (shoulderHalf + armLen * 0.82 + rA * 1.15), armY, -0.005];
      // v1.6: a digging tool rides its own bone (prop_l / prop_r, a child of the hand at the grip, beyond the 19 A-008 bones) so
      // each clip holds it its own way (propClips): a shovel hangs at the side, both fists dig with it, a drill points forward.
      const pb = `prop_${side}`;
      if (PROP_TOOLS.has(k) && !rig.index.has(pb)) { rig.bone(pb, `hand_${side}`, g); (rig.props || (rig.props = [])).push({ bone: pb, side, kind: k }); on(pb); }
      else on(`hand_${side}`);
      const L = k === "shovel" || k === "pickaxe" ? clamp(it.size * H, 0.85, 1.1) : k === "sword" ? clamp(it.size * H, 0.6, 0.9) : k === "drill" || k === "saw" ? clamp(it.size * H * 1.4, 0.62, 0.78) : clamp(it.size * H, 0.48, 0.6); // v1.6: a drill big enough to read on the TV
      // grip: tools along the fist's axis (forward, -Z in the T-pose); a shield's face outwards.
      const d = GRIP[k] || GRIP.default, dd = d.dir, uu = d.up(sx);
      tool(B, F, k, g, dd, uu, L, P, it.color ? C(it.color) : null);
      void HAND_DIR;
      continue;
    }
    if (it.where === "head") { on("head"); attachment(B, F, k === "lamp" || k === "torch" ? "lamp-head" : k, [0, H - (astro ? 0.02 : 0.04), 0], [0, 1, 0], [0, 0, -1], 0.55, P, it.color ? C(it.color) : null); if (k === "lamp" || k === "torch") { cyl(B, [0, H - headH * 0.35, -headH * 0.5], [0, H - headH * 0.35, -headH * 0.62], 0.05, 0.06, 10, R("metal"), P.gold); ell(F, [0, H - headH * 0.35, -headH * 0.66], 0.09, 0.09, 0.03, 8, R("flat"), [1.6, 1.3, 0.5], { dir: [0, 0, -1], hint: [0, 1, 0] }); } continue; }
    if (it.where === "chest" || it.where === "front") { on("chest"); attachment(B, F, k, [-shoulderHalf * 0.3, chestY + 0.1, -depth], [0, 1, 0], [0, 0, -1], 0.5, P, it.color ? C(it.color) : null); continue; }
    on("chest");
    attachment(B, F, HAND_TOOLS.has(k) && k !== "dish" && k !== "flag" ? "backpack" : k, [0, chestY + 0.06, depth], [0, 1, 0], [0, 0, 1], k === "backpack" || k === "jetpack" ? 1.25 : 0.9, P, it.color ? C(it.color) : null);
  }
}
// The tool's direction in the T-pose (the hand at ±X, palm down): the fist's axis is Z, so a tool held forwards points -Z.
const GRIP = {
  default: { dir: [0, 0, -1], up: () => [0, 1, 0] },
  shovel: { dir: [0, 0, -1], up: () => [0, 1, 0] },
  pickaxe: { dir: [0, 0, -1], up: () => [0, 1, 0] },
  shield: { dir: [0, 0, -1], up: (sx) => [sx, 0, 0] },
};

// ---- Quadruped -----------------------------------------------------------------------------------------------------

function buildQuadruped(s, P, B, F, rig, rnd) {
  const big = clamp((s.legs.length - 0.35) / 0.4 + s.neck * 1.6 + (s.items.some((x) => x.kind === "saddle") ? 0.6 : 0), 0, 1);
  const Lb = lerp(0.62, 1.1, big); // shoulder to hip
  const legH = Lb * clamp(0.62 + (s.legs.length - 0.5) * 0.7, 0.5, 1.05) * lerp(0.95, 1.12, big);
  const bodyR = Lb * lerp(0.33, 0.28, big), bodyW = bodyR * 0.95;
  const backY = legH + bodyR * 0.55;
  const zF = -Lb / 2, zB = Lb / 2;
  // v1.6: a big (horse-like) animal gets a shorter, thicker, more forward neck (it read as a llama); a small one (dog-like) a
  // bigger head with a real muzzle, bigger ears and a curled-up tail.
  const dogLike = big < 0.75, horseLike = !dogLike;
  const neckL = Lb * clamp(0.18 + s.neck * 0.9, 0.18, 0.62) * lerp(1, 0.8, big);
  const headL = Lb * clamp(0.36 + (s.head.size - 0.25) * 0.5, 0.34, 0.52) * lerp(1, 0.98, big) * (dogLike ? 1.1 : 1);
  const neckA = lerp(0.62, 0.7, big); // radians above the horizontal
  const neck0 = [0, backY + bodyR * 0.25, zF - bodyR * 0.25];
  const head0 = add(neck0, [0, Math.sin(neckA) * neckL, -Math.cos(neckA) * neckL]);
  const W = {
    hips: [0, backY, zB * 0.55], spine_1: [0, backY, 0.02], spine_2: [0, backY, zF * 0.55], neck: neck0, head: head0,
    tail_1: [0, backY + bodyR * 0.25, zB + bodyR * 0.4], tail_2: [0, backY + bodyR * 0.25 + 0.12, zB + bodyR * 0.4 + 0.22],
  };
  const legX = bodyW * 0.6, lr = Lb * lerp(0.1, 0.085, big) * ({ thin: 0.9, normal: 1, thick: 1.25 }[s.legs.thickness] || 1);
  for (const l of QUAD_LEGS) {
    const sx = l.endsWith("_l") ? 1 : -1, z = l.startsWith("front") ? zF + bodyR * 0.25 : zB - bodyR * 0.25;
    W[`${l}_upper`] = [sx * legX, legH + bodyR * 0.15, z];
    W[`${l}_lower`] = [sx * legX, legH * 0.5, z + (l.startsWith("front") ? 0.0 : 0.02)];
    W[`${l}_foot`] = [sx * legX, lr * 1.1, z];
  }
  for (const [name, parent, q] of QUAD_BONES) rig.bone(name, parent, W[name], q);
  const on = (name) => { B.bone = F.bone = rig.id(name); };
  const fur = P.main, belly = P.ink ? mix(fur, [1, 1, 1], 0.55) : (P.accent && !P.ink ? mix(fur, [1, 1, 1], 0.4) : mix(fur, [1, 1, 1], 0.45));
  const dark = P.ink ? shade(fur, 0.55) : (P.second || shade(fur, 0.6));
  const furReg = R("flat");
  // Body: rump (hips), barrel (spine_1), chest (spine_2).
  // one long barrel (spine_1) with the rump and the chest tucked inside its ends: a smooth body that still flexes
  on("spine_1"); ell(B, [0, backY - bodyR * 0.1, 0], bodyW, Lb * 0.5 + bodyR * 0.55, bodyR, sg(20), furReg, fur, { dir: [0, 0, -1], hint: [0, 1, 0] });
  ell(B, [0, backY - bodyR * 0.42, -Lb * 0.05], bodyW * 0.8, Lb * 0.42, bodyR * 0.62, sg(12), furReg, belly, { dir: [0, 0, -1], hint: [0, 1, 0] });
  on("hips"); ell(B, [0, backY - bodyR * 0.02, zB * 0.7], bodyW * 0.96, bodyR * 0.94, bodyR * 1.0, sg(16), furReg, fur);
  on("spine_2"); ell(B, [0, backY + bodyR * 0.02, zF * 0.7], bodyW * 1.0, bodyR * 0.98, bodyR * 1.0, sg(16), furReg, fur);
  rig.patch = { bone: "spine_1", c: [bodyW * 0.985, backY - bodyR * 0.05, 0.02], n: [1, 0, 0], up: [0, 1, 0], r: bodyR * 0.36, mirror: true };
  rig.socket("seat", "spine_1", [0, backY + bodyR * 0.85, 0]);
  rig.socket("back", "spine_1", [0, backY + bodyR * 0.9, 0.1]);
  // Neck and head.
  on("neck");
  capsule(B, neck0, head0, bodyR * lerp(0.62, 0.68, big), bodyR * lerp(0.42, 0.36, big), sg(12), furReg, fur);
  if (s.head.gear === "hair" || s.head.gear === "mohawk" || s.items.some((x) => x.kind === "saddle") || horseLike) { // a mane along the neck
    const mane = P.gear || P.tail || dark;
    for (let i = 0; i < 5; i++) { const p = add(lerp3(neck0, head0, 0.1 + i * 0.2), [0, bodyR * 0.42, bodyR * 0.12]); ell(B, p, bodyR * 0.12, bodyR * 0.22, bodyR * 0.2, 8, furReg, mane); }
  }
  on("head");
  const hr = headL * 0.42, hcen = add(head0, [0, hr * 0.35, -hr * 0.2]);
  ell(B, hcen, hr * 0.95, hr * 0.9, hr, sg(16), furReg, P.head || fur);
  const snL = headL * clamp(0.25 + (dogLike ? Math.max(s.head.snout, 0.45) : s.head.snout) * 0.6, 0.15, 0.8);
  // a horse's long face slopes down; a dog's muzzle is level
  const snout0 = add(hcen, [0, -hr * 0.25, -hr * 0.55]), snout1 = add(snout0, [0, -snL * (horseLike ? 0.55 : 0.12), -snL]);
  capsule(B, snout0, snout1, hr * (dogLike ? 0.6 : 0.55), hr * (dogLike ? 0.5 : 0.48), sg(12), furReg, P.ink ? belly : horseLike ? shade(P.head || fur, 1.12) : mix(P.head || fur, [1, 1, 1], 0.3));
  ell(B, add(snout1, [0, hr * 0.2, -hr * 0.38]), hr * 0.2, hr * 0.15, hr * 0.14, 8, furReg, P.black); // nose
  eyes(B, [-1, 1].map((sx) => add(hcen, [sx * hr * 0.48, hr * 0.28, -hr * 0.62])), hr * 0.22, nrm([0, 0.05, -1]));
  // ears
  const earKind = s.head.gear === "horns" ? "horns" : "ears", floppy = s.head.snout > 0.35 && big < 0.5 && s.head.gear !== "horns";
  for (const sx of [-1, 1]) {
    const e0 = add(hcen, [sx * hr * 0.5, hr * 0.7, hr * 0.1]);
    if (earKind === "horns") capsule(B, e0, add(e0, [sx * hr * 0.4, hr * 0.7, hr * 0.15]), hr * 0.18, hr * 0.05, 8, furReg, P.gear || P.light);
    else if (floppy) ell(B, add(e0, [sx * hr * 0.25, -hr * 0.25, 0]), hr * 0.18, hr * 0.48, hr * 0.32, 10, furReg, dark, { dir: nrm([sx * 0.35, -1, 0]), hint: [0, 0, -1] });
    else if (dogLike) rings(B, [{ t: 0, a: hr * 0.42, b: hr * 0.17 }, { t: hr * 0.5, a: hr * 0.3, b: hr * 0.12 }, { t: hr * 1.05, a: 0, b: 0 }], 8, frame(e0, nrm([sx * 0.45, 1, 0.05]), [0, 0, -1]), furReg, dark);
    else rings(B, [{ t: 0, a: hr * 0.3, b: hr * 0.14 }, { t: hr * 0.75, a: 0, b: 0 }], 8, frame(e0, nrm([sx * 0.3, 1, 0.1]), [0, 0, -1]), furReg, dark);
  }
  rig.socket("mouth", "head", add(snout1, [0, 0, -hr * 0.45]));
  rig.socket("head", "head", add(hcen, [0, hr, 0]));
  // Legs.
  for (const l of QUAD_LEGS) {
    const [x, y0, z] = W[`${l}_upper`], yk = W[`${l}_lower`][1], yf = W[`${l}_foot`][1];
    on(`${l}_upper`); capsule(B, [x, y0, z], [x, yk, z], lr * 1.35, lr * 1.05, sg(10), furReg, fur);
    on(`${l}_lower`); capsule(B, [x, yk, z], [x, yf, z], lr * 1.0, lr * 0.85, sg(10), furReg, fur);
    on(`${l}_foot`);
    if (s.legs.feet === "hooves") cyl(B, [x, 0, z - 0.01], [x, yf + lr * 0.4, z - 0.01], lr * 1.15, lr * 0.95, sg(10), R("trim"), P.dark, 0.3);
    else ell(B, [x, lr * 0.7, z - lr * 0.45], lr * 1.25, lr * 0.7, lr * 1.55, sg(10), furReg, P.ink ? belly : dark);
    if (s.legs.feet === "claws") for (let i = -1; i <= 1; i++) capsule(B, [x + i * lr * 0.5, lr * 0.5, z - lr * 1.5], [x + i * lr * 0.65, lr * 0.08, z - lr * 2.4], lr * 0.26, lr * 0.06, 6, R("flat"), P.light);
  }
  rig.socket("feet", "hips", [0, 0, 0]);
  // Tail.
  if (s.tail.kind !== "none") {
    const t0 = W.tail_1, t1 = W.tail_2, tc = P.tail || (horseLike ? dark : fur);
    const longT = s.tail.kind === "long" || s.tail.kind === "bushy" || s.tail.kind === "curly";
    const t2 = add(t1, longT ? (horseLike ? [0, -0.45, 0.22] : dogLike ? [0, 0.2, 0.12] : [0, -0.05, 0.25]) : [0, 0.02, 0.06]);
    on("tail_1"); capsule(B, t0, t1, bodyR * (dogLike ? 0.2 : 0.16), bodyR * (dogLike ? 0.18 : 0.13), 8, furReg, tc);
    on("tail_2");
    if (s.tail.kind === "bushy" || horseLike) ell(B, lerp3(t1, t2, 0.55), bodyR * 0.22, len(sub(t2, t1)) * 0.7 + 0.08, bodyR * 0.16, 10, furReg, tc, { dir: nrm(sub(t2, t1)), hint: [1, 0, 0] });
    else if (dogLike && longT) tube(B, [t1, add(t1, [0, 0.13, 0.1]), t2, add(t2, [0, 0.02, -0.06])], [bodyR * 0.18, bodyR * 0.16, bodyR * 0.12, bodyR * 0.07], 8, furReg, tc); // curled up
    else capsule(B, t1, t2, bodyR * 0.13, bodyR * 0.07, 8, furReg, tc);
    rig.socket("tail", "tail_2", t2);
  } else rig.socket("tail", "hips", [0, backY, zB + bodyR]);
  // Items.
  for (const it of s.items) {
    const k = it.kind, col = it.color ? C(it.color) : null;
    if (k === "saddle") {
      on("spine_1");
      const sc = [0, backY + bodyR * 0.72, 0.02];
      box(B, sc, bodyW * 0.62, bodyR * 0.12, Lb * 0.2, R("flat"), col || P.red, { n: 2.6, seg: 12 });
      box(B, add(sc, [0, bodyR * 0.12, Lb * 0.14]), bodyW * 0.42, bodyR * 0.14, Lb * 0.04, R("flat"), shade(col || P.red, 0.75), { n: 2.6, seg: 10 }); // cantle
      for (const sx of [-1, 1]) tube(B, [add(sc, [sx * bodyW * 0.7, 0, 0]), add(sc, [sx * bodyW * 1.02, -bodyR * 0.9, 0])], 0.012, 5, R("trim"), P.dark);
      for (const sx of [-1, 1]) box(B, add(sc, [sx * bodyW * 1.04, -bodyR * 0.95, 0]), 0.05, 0.02, 0.05, R("metal"), P.metal, { n: 3, seg: 6 });
      // v1.6: a rider in the player's colour on the saddle, hands on the reins at the withers, feet in the stirrups
      const rk = clamp(Lb / 1.0, 0.6, 1.05);
      rider(B, F, P, { hip: add(sc, [0, bodyR * 0.16, 0.03]), grips: [[0.13 * rk, backY + bodyR * 0.75, zF * 0.6], [-0.13 * rk, backY + bodyR * 0.75, zF * 0.6]],
        feet: [add(sc, [bodyW * 1.04, -bodyR * 0.88, -0.02]), add(sc, [-bodyW * 1.04, -bodyR * 0.88, -0.02])], lean: 0.12, k: rk });
      continue;
    }
    if (k === "claws") {
      for (const l of QUAD_LEGS) {
        on(`${l}_foot`);
        const [x, , z] = W[`${l}_upper`];
        for (let i = -1; i <= 1; i++) capsule(B, [x + i * lr * 0.5, lr * 0.5, z - lr * 1.6], [x + i * lr * 0.65, lr * 0.08, z - lr * 2.5], lr * 0.28, lr * 0.06, 6, R("flat"), col || P.light);
      }
      continue;
    }
    if (it.where === "head" || k === "antenna" || k === "lamp" || k === "torch" || k === "eye") {
      on("head");
      if (k === "lamp" || k === "torch") { cyl(B, add(hcen, [0, hr * 0.85, -hr * 0.2]), add(hcen, [0, hr * 0.85, -hr * 0.45]), hr * 0.22, hr * 0.28, 10, R("metal"), P.gold); ell(F, add(hcen, [0, hr * 0.85, -hr * 0.5]), hr * 0.3, hr * 0.3, hr * 0.08, 8, R("flat"), [1.6, 1.3, 0.5], { dir: [0, 0, -1], hint: [0, 1, 0] }); }
      else attachment(B, F, k, add(hcen, [0, hr * 0.8, 0]), [0, 1, 0], [0, 0, -1], Lb * 0.6, P, col);
      continue;
    }
    if (it.where === "front" && HAND_TOOLS.has(k) && !["lamp", "torch"].includes(k)) {
      on("head");
      tool(B, F, k, add(snout1, [0, -hr * 0.1, -hr * 0.2]), [0, 0, -1], [0, 1, 0], clamp(it.size * Lb * 1.6, 0.3, 0.7), P, col);
      continue;
    }
    on("spine_1");
    const kind = k === "blaster" ? "cannon" : k;
    if (kind === "cannon") tool(B, F, "cannon", [0, backY + bodyR * 0.95, Lb * 0.1], [0, 0, -1], [0, 1, 0], Lb * 0.7, P, col);
    else attachment(B, F, kind, [0, backY + bodyR * 0.75, Lb * 0.05], [0, 0, -1], [0, 1, 0], Lb * 0.7, P, col);
  }
}
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---- Car and bike --------------------------------------------------------------------------------------------------

function wheel(B, rig, name, c, r, w, P, opt = {}) {
  rig.bone(name, "root", c);
  B.bone = rig.id(name);
  const ax = [1, 0, 0];
  // tyre (v1.6, N7): a CLOSED ring (rings around the X axis), tread from the trim region: bead, sidewall, rounded
  // shoulder, tread, shoulder, sidewall, bead, then the inner barrel back to the first bead. The beads sit inside the hub
  // (radius 0.98 ri), so no gap shows around it; the tread never passes r: its lowest vertex is exactly r below the
  // centre (wheels are built at y = r, so they touch y = 0 and never sink below it).
  const ri = r * (opt.thin ? 0.82 : 0.62), rIn = opt.thin ? ri : ri * 0.9, seg = sg(opt.thin ? 18 : 16);
  let low = 0;
  for (let j = 0; j < seg; j++) low = Math.min(low, Math.sin(Math.PI * 2 * j / seg)); // the lowest vertex, in radii (-1 .. -0.95)
  const top = r / -low; // the tread radius whose lowest vertex is r below the centre
  const sh = Math.min(w * 0.35, (top - rIn) * 0.45), c45 = 1 - Math.SQRT1_2, fine = D > 0.75; // lite: 6 bands, else 10
  const half = [{ t: w * 0.42, a: rIn }];
  if (fine) half.push({ t: w / 2, a: lerp(rIn, top - sh, 0.4) });
  half.push({ t: w / 2, a: top - sh });
  if (fine) half.push({ t: w / 2 - sh * c45, a: top - sh + sh * Math.SQRT1_2 });
  half.push({ t: w / 2 - sh, a: top });
  const prof = [...half.map((q) => ({ t: -q.t, a: q.a })), ...half.slice().reverse(), { t: -w * 0.42, a: rIn }];
  const tyre = prof.map((q, i) => ({ t: q.t, a: q.a, b: q.a, v: i / (prof.length - 1) }));
  rings(B, tyre, seg, frame(c, ax, [0, 1, 0]), R("trim"), P.dark);
  // hub
  const hubC = opt.hubColor || P.metal;
  if (!opt.thin) cyl(B, madd(c, ax, -w * 0.42), madd(c, ax, w * 0.42), ri * 0.98, ri * 0.98, sg(14), R("metal"), shade(hubC, 0.8), 0.15);
  else cyl(B, madd(c, ax, -w * 0.7), madd(c, ax, w * 0.7), 0.035, 0.035, 8, R("metal"), hubC, 0.3);
  for (const sx of [-1, 1]) {
    if (!opt.thin) ell(B, madd(c, ax, sx * w * 0.42), ri * 0.62, w * 0.12, ri * 0.62, sg(12), R("metal"), hubC, { dir: scl(ax, sx), hint: [0, 1, 0] });
    if (!opt.thin && D > 0.65) for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.4; ell(B, add(madd(c, ax, sx * w * 0.46), [0, Math.cos(a) * ri * 0.4, Math.sin(a) * ri * 0.4]), ri * 0.09, w * 0.06, ri * 0.09, 6, R("trim"), P.dark, { dir: scl(ax, sx), hint: [0, 1, 0] }); }
  }
  if (opt.thin) for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI; tube(B, [add(c, [0, Math.cos(a) * ri, Math.sin(a) * ri]), add(c, [0, -Math.cos(a) * ri, -Math.sin(a) * ri])], 0.008, 4, R("metal"), P.metal); }
  rig.wheels.push({ bone: name, radius: r });
}

// v1.6 helpers for vehicles and mounts.
// The dig dust: chunky puffs on a "dust" bone (parent root) on the ground at `at`; vehicleClips shows them only in "dig".
function dustPuffs(B, rig, at, k) {
  rig.bone("dust", "root", at);
  B.bone = rig.id("dust");
  const col = C("#e2c9a0");
  for (const [x, y, z, r] of [[-0.42, 0.16, 0.05, 0.22], [0.42, 0.18, 0.0, 0.24], [0, 0.26, -0.18, 0.28], [-0.2, 0.46, -0.05, 0.2], [0.24, 0.5, -0.1, 0.17]]) {
    ell(B, add(at, [x * k, y * k, z * k]), r * k, r * k * 0.85, r * k, sg(9), R("flat"), shade(col, 0.92 + (x + 0.5) * 0.12));
  }
}
// A drill on a vehicle: the housing on the current bone, the bit (collar + hazard cone along -Z) on its own "tool" bone that
// spins about its axis in "dig".
function vehicleDrill(B, rig, parent, base, L, P, col) {
  box(B, add(base, [0, 0, L * 0.06]), L * 0.16, L * 0.16, L * 0.12, R("panels"), col || P.gold, { n: 3.5, seg: 10, dir: [0, 0, -1], hint: [0, 1, 0] });
  const tip0 = add(base, [0, 0, -L * 0.06]);
  rig.bone("tool", parent, tip0);
  B.bone = rig.id("tool");
  cyl(B, tip0, add(tip0, [0, 0, -L * 0.07]), L * 0.13, L * 0.13, sg(10), R("metal"), P.metal);
  const rows = [], k = 7;
  for (let i = 0; i <= k; i++) { const t = i / k; rows.push({ t: L * 0.07 + t * L * 0.55, a: L * 0.13 * (1 - t) + 1e-4, b: L * 0.13 * (1 - t) + 1e-4, v: t }); }
  rows[rows.length - 1].a = rows[rows.length - 1].b = 0;
  rings(B, rows, sg(10), frame(tip0, [0, 0, -1], [0, 1, 0]), R("hazard"), [1, 1, 1]);
  B.bone = rig.id(parent);
}
// A small rider in the player's colour (bikes, saddled animals): hips at `hip`, hands on `grips` [left, right], feet on
// `feet` [left, right]; `lean` tips the torso forward (radians). Rigid on the current bone (the chassis / the back).
function rider(B, F, P, { hip, grips, feet, lean = 0.3, k = 1 }) {
  const suit = P.player, dark = P.trim, boot = C("#2b2f3d");
  const td = nrm([0, Math.cos(lean), -Math.sin(lean)]);
  ell(B, add(hip, [0, 0.05 * k, 0.02 * k]), 0.15 * k, 0.1 * k, 0.13 * k, sg(10), R("flat"), shade(suit, 0.7));
  box(B, madd(hip, td, 0.24 * k), 0.15 * k, 0.2 * k, 0.1 * k, R("panels"), suit, { n: 3, seg: 10, dir: td, hint: [0, 0, -1] });
  const sh = madd(hip, td, 0.42 * k);
  for (const [i, sx] of [[0, 1], [1, -1]]) { // arms: shoulder → elbow → the grip
    const s0 = add(sh, [sx * 0.15 * k, 0, 0]), g = grips[i], el = add(lerp3(s0, g, 0.5), [sx * 0.06 * k, -0.06 * k, 0.04 * k]);
    ell(B, s0, 0.07 * k, 0.07 * k, 0.07 * k, sg(8), R("flat"), shade(suit, 0.85));
    tube(B, [s0, el, g], [0.05 * k, 0.045 * k, 0.04 * k], sg(7), R("flat"), suit);
    ell(B, g, 0.055 * k, 0.05 * k, 0.055 * k, 6, R("flat"), dark);
  }
  for (const [i, sx] of [[0, 1], [1, -1]]) { // legs: hip → knee (forward, out) → foot
    const h0 = add(hip, [sx * 0.09 * k, 0.02 * k, 0]), f = feet[i], kn = add(lerp3(h0, f, 0.5), [sx * 0.06 * k, 0.1 * k, -0.18 * k]);
    tube(B, [h0, kn, f], [0.07 * k, 0.06 * k, 0.05 * k], sg(7), R("flat"), shade(suit, 0.7));
    box(B, add(f, [0, 0.0, -0.04 * k]), 0.055 * k, 0.045 * k, 0.09 * k, R("flat"), boot, { n: 3, seg: 8, round: 0.02 * k });
  }
  // the head: a white helmet with a stripe in the player's colour and a dark visor
  const hc = add(madd(sh, td, 0.1 * k), [0, 0.13 * k, -0.02 * k]);
  ell(B, hc, 0.14 * k, 0.14 * k, 0.15 * k, sg(14), R("flat"), P.white);
  box(B, add(hc, [0, 0.11 * k, 0.01 * k]), 0.035 * k, 0.04 * k, 0.12 * k, R("flat"), suit, { n: 3, seg: 8, round: 0.015 * k });
  ell(B, add(hc, [0, -0.01 * k, -0.08 * k]), 0.11 * k, 0.07 * k, 0.09 * k, sg(12), R("glass"), mix(P.glass, [0, 0, 0], 0.35), { dir: [0, 0, -1], hint: [0, 1, 0] });
}

function buildCar(s, P, B, F, rig, rnd) {
  const body = s.vehicle.body, monster = body === "monster truck", race = body === "race car", truck = body === "truck" || monster, tank = body === "tank";
  const L = monster ? 4.3 : race ? 4.2 : truck ? 4.3 : body === "buggy" ? 3.4 : 4.0;
  const Wd = L * (monster ? 0.5 : race ? 0.48 : 0.46);
  const wr = clamp(s.vehicle.wheelSize * L / 2, monster ? 0.62 : 0.32, monster ? 0.95 : race ? 0.4 : 0.5) * (body === "buggy" ? 1.15 : 1);
  const lift = monster ? wr * 1.78 : body === "buggy" || body === "rover" ? wr * 0.55 : wr * 0.45;
  const hB = L * clamp(s.vehicle.height * (race ? 0.6 : 0.62), race ? 0.12 : 0.17, truck ? 0.3 : 0.26); // lower body height
  const y0 = lift, y1 = y0 + hB;
  rig.bone("root", null, [0, 0, 0]);
  rig.bone("chassis", "root", [0, y0, 0]);
  const on = (n) => { B.bone = F.bone = rig.id(n); };
  on("chassis");
  const paint = P.main, paint2 = P.ink ? shade(paint, 0.7) : P.second;
  // lower body: a long rounded block, nose at -Z
  box(B, [0, (y0 + y1) / 2, 0], Wd / 2, hB / 2, L / 2, R("panels"), paint, { n: 5, seg: 16, dir: [0, 1, 0], round: hB * 0.32 });
  // side skirt / stripe
  box(B, [0, y0 + hB * 0.28, 0], Wd / 2 + 0.012, hB * 0.08, L * 0.46, R("racing"), P.ink ? P.white : P.accent, { n: 5, seg: 12, round: 0.02 });
  // bumpers
  for (const sz of [-1, 1]) box(B, [0, y0 + hB * 0.22, sz * L * 0.5], Wd * 0.48, hB * 0.16, 0.08, R("trim"), P.trim, { n: 4, seg: 10, round: 0.04 });
  // cabin
  const cabinL = race ? L * 0.32 : truck ? L * 0.3 : L * 0.5, cabinZ = race ? L * 0.04 : truck ? -L * 0.12 : L * 0.04;
  const cabinH = race ? hB * 0.7 : L * clamp(s.vehicle.height * 0.42, 0.13, 0.2);
  if (s.vehicle.cabin !== "none" && !tank) {
    if (s.vehicle.cabin === "bubble") {
      ell(B, [0, y1, cabinZ], Wd * 0.38, cabinH * 1.1, cabinL * 0.55, sg(16), R("glass"), mix(P.glass, [1, 1, 1], 0.2));
    } else if (s.vehicle.cabin === "open" || body === "buggy") {
      // roll cage and seats
      for (const sx of [-1, 1]) tube(B, [[sx * Wd * 0.4, y1, cabinZ + cabinL * 0.45], [sx * Wd * 0.36, y1 + cabinH * 1.1, cabinZ + cabinL * 0.3], [sx * Wd * 0.36, y1 + cabinH * 1.1, cabinZ - cabinL * 0.2], [sx * Wd * 0.4, y1, cabinZ - cabinL * 0.4]], 0.035, 6, R("metal"), P.steel);
      tube(B, [[-Wd * 0.36, y1 + cabinH * 1.1, cabinZ + cabinL * 0.3], [Wd * 0.36, y1 + cabinH * 1.1, cabinZ + cabinL * 0.3]], 0.035, 6, R("metal"), P.steel);
      for (const sx of [-1, 1]) box(B, [sx * Wd * 0.2, y1 + cabinH * 0.35, cabinZ + cabinL * 0.15], Wd * 0.13, cabinH * 0.4, 0.08, R("flat"), P.dark, { n: 3, seg: 8 });
    } else {
      box(B, [0, y1 + cabinH / 2 - 0.02, cabinZ], Wd * 0.43, cabinH / 2, cabinL / 2, R("glass"), mix(P.glass, [1, 1, 1], 0.1), { n: 4, seg: 14, taper: 0.82, round: cabinH * 0.35 });
      box(B, [0, y1 + cabinH - 0.02, cabinZ + cabinL * 0.02], Wd * 0.37, 0.035, cabinL * 0.38, R("panels"), paint, { n: 4, seg: 12, round: 0.03 }); // roof
    }
  }
  if (truck) { // the bed behind the cab
    const bz = cabinZ + cabinL / 2 + (L / 2 - cabinZ - cabinL / 2) / 2;
    for (const sx of [-1, 1]) box(B, [sx * Wd * 0.47, y1 + 0.12, bz], 0.03, 0.12, (L / 2 - cabinZ - cabinL / 2) / 2 - 0.05, R("panels"), paint2, { n: 4, seg: 8, round: 0.02 });
  }
  if (tank) {
    box(B, [0, y1 + hB * 0.35, L * 0.05], Wd * 0.32, hB * 0.35, L * 0.22, R("panels"), paint2, { n: 4, seg: 14, round: 0.05 });
  }
  if (race) { // spoiler
    box(B, [0, y1 + 0.28, L * 0.46], Wd * 0.46, 0.02, 0.14, R("panels"), P.ink ? P.dark : P.accent, { n: 4, seg: 8, round: 0.01 });
    for (const sx of [-1, 1]) box(B, [sx * Wd * 0.3, y1 + 0.13, L * 0.46], 0.02, 0.14, 0.05, R("trim"), P.trim, { n: 4, seg: 6, round: 0.01 });
  }
  rig.patch = { bone: "chassis", c: [Wd / 2 + 0.012, (y0 + y1) / 2 + hB * 0.06, cabinZ + (truck ? 0 : cabinL * 0.12)], n: [1, 0, 0], up: [0, 1, 0], r: clamp(hB * 0.36, 0.14, 0.26), mirror: true };
  // lights: headlights (glass + glow), tail lights
  for (const sx of [-1, 1]) {
    ell(B, [sx * Wd * 0.33, y0 + hB * 0.62, -L * 0.5], 0.11, 0.07, 0.04, sg(10), R("glass"), [1, 0.97, 0.85], { dir: [0, 0, -1], hint: [0, 1, 0] });
    ell(F, [sx * Wd * 0.33, y0 + hB * 0.62, -L * 0.505], 0.14, 0.09, 0.02, 8, R("flat"), [0.9, 0.85, 0.6], { dir: [0, 0, -1], hint: [0, 1, 0] });
    ell(B, [sx * Wd * 0.35, y0 + hB * 0.65, L * 0.5], 0.1, 0.05, 0.03, 8, R("glass"), [1, 0.25, 0.25], { dir: [0, 0, 1], hint: [0, 1, 0] });
    ell(F, [sx * Wd * 0.35, y0 + hB * 0.65, L * 0.505], 0.11, 0.06, 0.02, 8, R("flat"), [0.8, 0.08, 0.05], { dir: [0, 0, 1], hint: [0, 1, 0] });
  }
  // wheels: pairs along the length, rear to front
  const nAx = tank ? 4 : clamp(Math.round((s.vehicle.wheels || 4) / 2), 2, 4);
  const zs = Array.from({ length: nAx }, (_, i) => lerp(L * 0.34, -L * 0.33, nAx === 1 ? 0.5 : i / (nAx - 1)));
  const tw = monster ? wr * 0.9 : wr * 0.62;
  let wi = 0;
  for (const z of zs) for (const sx of [-1, 1]) wheel(B, rig, `wheel_${wi++}`, [sx * (Wd / 2 + (monster ? tw * 0.35 : -tw * 0.05)), wr, z], wr, tw, P, { hubColor: P.ink ? P.metal : (P.accent || P.metal) });
  // arches over the wheels (on the chassis)
  on("chassis");
  for (const z of zs) for (const sx of [-1, 1]) {
    const c = [sx * (Wd / 2 + 0.01), Math.max(y0 + hB * 0.35, wr), z];
    if (!monster) ell(B, add(c, [0, wr * 0.15, 0]), 0.05, wr * 0.75, wr * 1.12, 10, R("trim"), P.trim, { dir: [0, 1, 0], hint: [0, 0, -1] });
  }
  if (monster) { // suspension struts
    for (const z of [zs[0], zs[zs.length - 1]]) for (const sx of [-1, 1]) tube(B, [[sx * Wd * 0.35, wr, z], [sx * Wd * 0.3, y0 + 0.05, z]], 0.05, 6, R("metal"), P.gold);
    tube(B, [[-Wd * 0.4, wr, zs[0]], [Wd * 0.4, wr, zs[0]]], 0.06, 6, R("metal"), P.steel);
    tube(B, [[-Wd * 0.4, wr, zs[zs.length - 1]], [Wd * 0.4, wr, zs[zs.length - 1]]], 0.06, 6, R("metal"), P.steel);
  }
  // items
  for (const it of s.items) {
    const k = it.kind, col = it.color ? C(it.color) : null;
    on("chassis");
    if (k === "cannon" || k === "blaster") {
      const base = [0, (s.vehicle.cabin !== "none" && !tank ? y1 + cabinH : y1 + hB * 0.7), cabinZ];
      cyl(B, base, add(base, [0, 0.12, 0]), 0.22, 0.2, sg(12), R("metal"), P.steel, 0.3);
      tool(B, F, "cannon", add(base, [0, 0.12, 0.15]), [0, 0, -1], [0, 1, 0], 1.0, P, col);
      continue;
    }
    if (["drill", "saw", "shovel", "pickaxe", "magnet", "claws"].includes(k)) {
      const front = [0, y0 + hB * 0.45, -L * 0.5 - 0.04];
      if (k === "drill" || k === "saw") {
        cyl(B, front, add(front, [0, 0, -0.12]), 0.2, 0.2, sg(12), R("metal"), P.metal);
        if (k === "drill" && !rig.index.has("tool")) vehicleDrill(B, rig, "chassis", add(front, [0, 0, -0.2]), 1.25, P, col); // v1.6: the bit spins in "dig"
        else tool(B, F, k, add(front, [0, -0.1, 0.1]), [0, 0, -1], [0, 1, 0], 1.25, P, col);
      }
      else if (k === "shovel" || k === "pickaxe" || k === "claws") { // a bulldozer scoop
        for (const sx of [-1, 1]) tube(B, [[sx * Wd * 0.3, y0 + hB * 0.4, -L * 0.42], [sx * Wd * 0.3, wr * 0.45, -L * 0.56]], 0.04, 6, R("metal"), P.steel);
        plate(B, [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]].map(([a, b]) => [a * Wd * 0.95, b * 0.32]), [0, 0.06, -L * 0.58], [1, 0, 0], nrm([0, 1, -0.35]), 0.025, R("hazard"), [1, 1, 1], P.steel);
      } else tool(B, F, k, front, [0, 0, -1], [0, 1, 0], 0.9, P, col);
      continue;
    }
    if ((k === "lamp" || k === "torch") && it.where !== "roof" && it.where !== "top") { // bright headlights
      for (const sx of [-1, 1]) ell(F, [sx * Wd * 0.33, y0 + hB * 0.62, -L * 0.52], 0.24, 0.17, 0.03, 8, R("flat"), [1.3, 1.15, 0.6], { dir: [0, 0, -1], hint: [0, 1, 0] });
      continue;
    }
    if (k === "lamp" || k === "torch") { // a roof light bar
      const yb = s.vehicle.cabin !== "none" && !tank ? y1 + cabinH + 0.03 : y1 + 0.03;
      box(B, [0, yb + 0.05, cabinZ - cabinL * 0.3], Wd * 0.3, 0.05, 0.06, R("trim"), P.trim, { n: 4, seg: 8, round: 0.02 });
      for (let i = 0; i < 4; i++) { const x = (i - 1.5) * Wd * 0.14; ell(B, [x, yb + 0.06, cabinZ - cabinL * 0.3 - 0.06], 0.05, 0.04, 0.02, 8, R("glass"), [1, 0.95, 0.7], { dir: [0, 0, -1], hint: [0, 1, 0] }); ell(F, [x, yb + 0.06, cabinZ - cabinL * 0.3 - 0.08], 0.09, 0.07, 0.02, 8, R("flat"), [1.5, 1.25, 0.5], { dir: [0, 0, -1], hint: [0, 1, 0] }); }
      continue;
    }
    if (k === "jetpack" || k === "flames") { // exhaust pipes and flames at the back
      for (const sx of [-1, 1]) {
        const p0 = [sx * Wd * 0.28, y0 + hB * 0.3, L * 0.48];
        cyl(B, p0, add(p0, [0, 0, 0.2]), 0.08, 0.1, sg(10), R("nozzle"), [1, 1, 1]);
        rings(F, [{ t: 0, a: 0.09, b: 0.09, c: [1.5, 0.9, 0.25] }, { t: 0.3, a: 0.07, b: 0.07, c: [1.2, 0.45, 0.1] }, { t: 0.7, a: 0, b: 0, c: [0.4, 0.05, 0] }], sg(8), frame(add(p0, [0, 0, 0.2]), [0, 0, 1]), R("flat"), [1, 0.5, 0.1]);
      }
      continue;
    }
    const roofY = s.vehicle.cabin !== "none" && !tank ? y1 + cabinH : y1;
    if (it.where === "side" || k === "cross" || k === "lightning" || k === "star") attachment(B, F, k, [Wd / 2 + 0.01, (y0 + y1) / 2, cabinZ], [0, 1, 0], [1, 0, 0], 1.2, P, col);
    else attachment(B, F, k, [0, roofY, cabinZ + cabinL * 0.2], [0, 1, 0], [0, 0, -1], 1.4, P, col);
  }
  rig.veh = { dip: monster ? 0.22 : 0.12 };
  dustPuffs(B, rig, [0, 0, -L * 0.5 - 0.5], monster ? 1.3 : 1.1);
  on("chassis");
  rig.socket("seat", "chassis", [0, y1 + 0.1, cabinZ]);
  rig.socket("roof", "chassis", [0, y1 + cabinH, cabinZ]);
  rig.socket("top", "chassis", [0, y1 + cabinH, cabinZ]);
  rig.socket("front", "chassis", [0, y0 + hB * 0.5, -L * 0.5]);
  rig.socket("back", "chassis", [0, y0 + hB * 0.5, L * 0.5]);
  rig.socket("mouth", "chassis", [0, y0 + hB * 0.5, -L * 0.5]);
  rig.socket("tail", "chassis", [0, y0 + hB * 0.5, L * 0.5]);
  rig.socket("centre", "chassis", [0, (y0 + y1) / 2, 0]);
}

function buildBike(s, P, B, F, rig, rnd) {
  const body = s.vehicle.body, motor = body === "motorbike", scooter = body === "scooter";
  const L = motor ? 2.2 : 1.9;
  const wr = clamp(s.vehicle.wheelSize * L / 2, motor ? 0.32 : 0.3, motor ? 0.42 : 0.4) * (scooter ? 0.6 : 1);
  const zb = L / 2 - wr, zf = -(L / 2 - wr);
  rig.bone("root", null, [0, 0, 0]);
  rig.bone("chassis", "root", [0, wr, 0]);
  const on = (n) => { B.bone = F.bone = rig.id(n); };
  on("chassis");
  const paint = P.main;
  const seatY = wr + (scooter ? 0.55 : motor ? 0.55 : 0.62), barY = seatY + (scooter ? 0.45 : 0.18);
  const head = [0, barY - 0.05, zf + 0.22], seat = [0, seatY, zb - (scooter ? 0.25 : 0.42)], crank = [0, wr * 0.95, (zb + zf) / 2 + 0.05];
  const fr = motor ? 0.06 : 0.035;
  if (scooter) {
    box(B, [0, wr * 0.6, (zb + zf) / 2 + 0.05], 0.14, 0.045, L * 0.33, R("panels"), paint, { n: 4, seg: 10, round: 0.03 });
    tube(B, [[0, wr * 0.6, zf + 0.12], head], 0.045, 8, R("flat"), paint);
    box(B, add(seat, [0, -0.15, 0]), 0.16, 0.18, 0.22, R("panels"), paint, { n: 4, seg: 10 });
  } else if (motor) {
    box(B, [0, seatY - 0.15, (zb + zf) / 2 - 0.1], 0.17, 0.16, 0.42, R("panels"), paint, { n: 4, seg: 14, round: 0.08 }); // tank / fairing
    box(B, [0, wr + 0.05, (zb + zf) / 2 + 0.05], 0.14, 0.15, 0.24, R("metal"), P.steel, { n: 5, seg: 10, round: 0.05 }); // engine
    tube(B, [[0.12, wr + 0.0, (zb + zf) / 2 + 0.1], [0.16, wr - 0.08, zb - 0.1], [0.16, wr + 0.02, zb + 0.15]], 0.04, 8, R("metal"), P.metal); // exhaust
    box(B, [0, seatY, zb - 0.38], 0.13, 0.05, 0.28, R("trim"), P.dark, { n: 3, seg: 10, round: 0.04 });
    box(B, [0, seatY + 0.02, zb - 0.02], 0.1, 0.04, 0.16, R("panels"), paint, { n: 3, seg: 8, round: 0.03 }); // tail
  } else {
    // bicycle diamond frame
    tube(B, [seat, crank], fr, 8, R("flat"), paint);
    tube(B, [crank, head], fr, 8, R("flat"), paint);
    tube(B, [add(seat, [0, -0.06, 0]), add(head, [0, -0.02, 0])], fr, 8, R("flat"), paint);
    tube(B, [crank, [0, wr, zb]], fr * 0.8, 6, R("flat"), paint);
    tube(B, [add(seat, [0, -0.05, 0]), [0, wr, zb]], fr * 0.8, 6, R("flat"), paint);
    cyl(B, add(crank, [-0.05, 0, 0]), add(crank, [0.05, 0, 0]), 0.08, 0.08, sg(12), R("metal"), P.metal, 0.3);
    box(B, add(seat, [0, 0.05, 0]), 0.08, 0.035, 0.13, R("trim"), P.dark, { n: 3, seg: 8, round: 0.03 });
  }
  // fork and handlebar
  tube(B, [head, [0, wr, zf]], fr * 0.9, 6, R("metal"), motor ? P.steel : paint);
  tube(B, [add(head, [-0.3, 0.06, 0.06]), add(head, [-0.22, 0.05, 0]), add(head, [0.22, 0.05, 0]), add(head, [0.3, 0.06, 0.06])], 0.025, 6, R("metal"), P.steel);
  for (const sx of [-1, 1]) cyl(B, add(head, [sx * 0.24, 0.055, 0.03]), add(head, [sx * 0.34, 0.06, 0.07]), 0.035, 0.035, 8, R("trim"), P.dark);
  // headlamp
  const lamp = add(head, [0, -0.05, -0.1]);
  const hasLamp = motor || s.items.some((x) => x.kind === "lamp" || x.kind === "torch");
  if (hasLamp) {
    cyl(B, add(lamp, [0, 0, 0.06]), add(lamp, [0, 0, -0.04]), 0.09, 0.11, sg(12), R("metal"), P.gold, 0.4);
    ell(B, add(lamp, [0, 0, -0.045]), 0.09, 0.09, 0.03, sg(10), R("glass"), [1, 0.96, 0.75], { dir: [0, 0, -1], hint: [0, 1, 0] });
    ell(F, add(lamp, [0, 0, -0.06]), 0.16, 0.16, 0.04, 8, R("flat"), [1.6, 1.3, 0.5], { dir: [0, 0, -1], hint: [0, 1, 0] });
    rings(F, [{ t: 0, a: 0.1, b: 0.1, c: [0.2, 0.17, 0.07] }, { t: 0.9, a: 0.3, b: 0.3, c: [0, 0, 0] }], sg(10), frame(add(lamp, [0, 0, -0.07]), nrm([0, -0.12, -1])), R("flat"), [0.5, 0.4, 0.15]);
  }
  wheel(B, rig, "wheel_0", [0, wr, zb], wr, motor ? 0.14 : 0.07, P, { thin: !motor && !scooter, hubColor: P.metal });
  wheel(B, rig, "wheel_1", [0, wr, zf], wr, motor ? 0.13 : 0.07, P, { thin: !motor && !scooter, hubColor: P.metal });
  // items (lamps handled above)
  on("chassis");
  for (const it of s.items) {
    const k = it.kind, col = it.color ? C(it.color) : null;
    if (k === "lamp" || k === "torch") continue;
    if (k === "drill" && !rig.index.has("tool")) { vehicleDrill(B, rig, "chassis", add(head, [0, -0.3, -0.32]), 0.7, P, col); continue; } // v1.6: under the bar, spins in "dig"
    if (["blaster", "cannon", "drill", "saw"].includes(k)) { tool(B, F, k === "cannon" ? "blaster" : k, add(head, [0.2, -0.12, -0.05]), [0, 0, -1], [0, 1, 0], 0.7, P, col); continue; }
    if (k === "jetpack" || k === "flames") { const p0 = [0.12, wr + 0.1, zb]; cyl(B, p0, add(p0, [0, 0.05, 0.25]), 0.07, 0.08, sg(10), R("nozzle"), [1, 1, 1]); rings(F, [{ t: 0, a: 0.08, b: 0.08, c: [1.5, 0.9, 0.25] }, { t: 0.5, a: 0, b: 0, c: [0.4, 0.05, 0] }], sg(8), frame(add(p0, [0, 0.05, 0.25]), [0, 0.15, 1]), R("flat"), [1, 0.5, 0.1]); continue; }
    attachment(B, F, k, add(seat, [0, 0.05, 0.25]), [0, 1, 0], [0, 0, 1], 0.9, P, col);
  }
  // v1.6: the rider (a small person in the player's colour), hands on the bar, feet on the pedals / pegs / the deck
  const mid = (zb + zf) / 2;
  const feet = motor ? [[0.17, wr + 0.04, mid + 0.18], [-0.17, wr + 0.04, mid + 0.18]] : scooter ? [[0.09, wr * 0.6 + 0.07, mid + 0.12], [-0.09, wr * 0.6 + 0.07, mid - 0.05]]
    : [add(crank, [0.13, 0.12, -0.1]), add(crank, [-0.13, -0.12, 0.1])];
  rider(B, F, P, { hip: add(seat, [0, scooter ? 0.12 : 0.08, 0.03]), grips: [add(head, [0.27, 0.07, 0.05]), add(head, [-0.27, 0.07, 0.05])], feet, lean: scooter ? 0.12 : motor ? 0.5 : 0.55 });
  rig.veh = { bike: true, dip: 0.07 };
  dustPuffs(B, rig, [0, 0, zf - 0.55], 0.75);
  on("chassis");
  rig.socket("seat", "chassis", add(seat, [0, 0.06, 0]));
  rig.socket("front", "chassis", [0, barY, -L / 2]);
  rig.socket("back", "chassis", [0, wr, L / 2]);
  rig.socket("roof", "chassis", add(seat, [0, 0.5, 0]));
  rig.socket("top", "chassis", add(seat, [0, 0.5, 0]));
  rig.socket("mouth", "chassis", lamp);
  rig.socket("tail", "chassis", [0, wr, L / 2]);
  rig.socket("centre", "chassis", [0, wr + 0.3, 0]);
}

// ---- Blob ----------------------------------------------------------------------------------------------------------

function buildBlob(s, P, B, F, rig, rnd) {
  const Rb = 0.62, cy = Rb * 0.92;
  rig.bone("root", null, [0, 0, 0]);
  rig.bone("body", "root", [0, cy * 0.4, 0]);
  B.bone = F.bone = rig.id("body");
  const goo = P.main;
  ell(B, [0, cy, 0], Rb * 1.05, cy, Rb, sg(22), R("flat"), goo);
  // lumps (deterministic per drawing)
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2, y = cy * (0.6 + rnd() * 0.7), r = Rb * (0.35 + rnd() * 0.2);
    ell(B, [Math.cos(a) * Rb * 0.7, y, Math.sin(a) * Rb * 0.6 + 0.1], r, r * 0.9, r, sg(12), R("flat"), shade(goo, 0.95 + rnd() * 0.1));
  }
  ell(B, [0, 0.08, 0], Rb * 1.12, 0.09, Rb * 1.05, sg(18), R("flat"), shade(goo, 0.8)); // the puddle foot
  const ne = clamp(s.head.eyes || 2, 1, 4);
  eyes(B, Array.from({ length: ne }, (_, i) => [(i - (ne - 1) / 2) * Rb * 0.5, cy * 1.15, -Rb * 0.78]), Rb * 0.2);
  tube(B, Array.from({ length: 7 }, (_, i) => { const a = Math.PI * (0.12 + 0.76 * i / 6); return [Math.cos(a) * Rb * 0.35, cy * 0.78 - Math.sin(a) * Rb * 0.18, -Rb * 0.95 + Math.sin(a) * 0.04]; }), Rb * 0.045, 5, R("flat"), C("#4a1a2a"));
  // a glossy highlight
  ell(B, [-Rb * 0.45, cy * 1.55, -Rb * 0.35], Rb * 0.16, Rb * 0.09, Rb * 0.12, 8, R("flat"), mix(goo, [1, 1, 1], 0.75));
  for (const it of s.items) {
    const k = it.kind, col = it.color ? C(it.color) : null;
    if (HAND_TOOLS.has(k) && !["eye", "star", "flag", "dish"].includes(k)) { tool(B, F, k, [-Rb * 0.95, cy * 0.9, -0.1], [0, 0, -1], [0, 1, 0], 0.55, P, col); continue; }
    if (it.where === "head" || k === "antenna" || k === "eye") attachment(B, F, k, [0, cy * 1.9, 0], [0, 1, 0], [0, 0, -1], 0.6, P, col);
    else attachment(B, F, k, [0, cy * 1.1, Rb * 0.9], [0, 1, 0], [0, 0, 1], 0.8, P, col);
  }
  for (const [n, p] of Object.entries({ centre: [0, cy, 0], top: [0, cy * 1.9, 0], front: [0, cy, -Rb], back: [0, cy, Rb], roof: [0, cy * 1.9, 0], seat: [0, cy * 1.9, 0], mouth: [0, cy * 0.78, -Rb], tail: [0, cy * 0.5, Rb], head: [0, cy * 1.9, 0] })) rig.socket(n, "body", p);
}

// ---- Materials -----------------------------------------------------------------------------------------------------

function bodyMaterial(map, color, { rough = null, normal = null, decal = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map, vertexColors: !decal, roughness: decal ? 0.9 : 1, roughnessMap: decal ? null : rough, metalness: 0,
    emissive: new THREE.Color(SELF, SELF, SELF).multiplyScalar(decal ? 0.6 : 1), emissiveIntensity: 1,
    transparent: decal, polygonOffset: decal, polygonOffsetFactor: decal ? -2 : 0, polygonOffsetUnits: decal ? -4 : 0,
  });
  if (normal && !decal) { mat.normalMap = normal; mat.normalScale.set(0.45, 0.45); }
  const rim = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35);
  const rimK = { value: 1 };
  mat.userData.rimK = rimK;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uRimK = rimK;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uRim;\nuniform float uRimK;")
      .replace("#include <map_fragment>", decal ? "#include <map_fragment>" : "#include <map_fragment>\n#ifdef USE_MAP\n  if (sampledDiffuseColor.a < 0.5) discard;\n  diffuseColor.a = opacity;\n#endif")
      .replace("#include <emissivemap_fragment>",
        "totalEmissiveRadiance *= diffuseColor.rgb;\n  float rimF = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);\n  totalEmissiveRadiance += uRim * rimF * 0.32 * uRimK;");
  };
  mat.customProgramCacheKey = () => (decal ? "entity3d-decal" : "entity3d-body");
  return mat;
}
function fxMaterial() {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  mat.name = "entity3d_fx";
  return mat;
}

// The player's drawing as a small patch (ink on a light, rounded badge with a rim in the player colour).
function makePatch(img, color) {
  if (!img || !(img.naturalWidth || img.width)) return null;
  try {
    const W = 256, cv = mkCanvas(W, W), g = cv.getContext("2d");
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 10, 0, Math.PI * 2);
    g.fillStyle = "#e9e6df"; g.fill(); g.lineWidth = 18; g.strokeStyle = new THREE.Color(color).getStyle(); g.stroke();
    g.save(); g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 22, 0, Math.PI * 2); g.clip();
    const k = Math.min((W - 64) / iw, (W - 64) / ih);
    g.globalCompositeOperation = "multiply";
    const th = 1.6;
    for (const [ox, oy] of [[0, 0], [th, 0], [-th, 0], [0, th], [0, -th]]) g.drawImage(img, W / 2 - iw * k / 2 + ox, W / 2 - ih * k / 2 + oy, iw * k, ih * k);
    g.restore();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.name = "entity3d_patch";
    return t;
  } catch { return null; }
}
// A flat disc quad (patch) at c facing n.
function patchQuad(Dc, c, n, up, r) {
  const s = nrm(cross(up, n)), u = nrm(cross(n, s));
  const base = Dc.count, K = 16;
  Dc.v(c, n, [0.5, 0.5], [1, 1, 1]);
  for (let i = 0; i <= K; i++) { const a = i / K * Math.PI * 2, x = Math.cos(a), y = Math.sin(a); Dc.v(add(add(c, scl(s, x * r)), scl(u, y * r)), n, [0.5 - x * 0.5, 0.5 - y * 0.5], [1, 1, 1]); }
  for (let i = 0; i < K; i++) Dc.tri(base, base + 1 + i, base + 2 + i);
}

function toGeometry(Bf, fx = false) {
  if (!Bf.i.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(Bf.p, 3));
  if (!fx) g.setAttribute("normal", new THREE.Float32BufferAttribute(Bf.n, 3));
  if (!fx) g.setAttribute("uv", new THREE.Float32BufferAttribute(Bf.uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(Bf.c, 3));
  const n = Bf.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = Bf.b[i]; sw[i * 4] = 1; }
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(Bf.i, 1) : new THREE.Uint16BufferAttribute(Bf.i, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// ---- Build ---------------------------------------------------------------------------------------------------------

function assemble(spec, color, d) {
  D = d;
  const P = palette(spec, color);
  const B = new Buf(), F = new Buf(), rig = new Rig(RIG_OF[spec.type]);
  const rnd = rng(spec.seed || 1);
  ({ person: buildPerson, quadruped: buildQuadruped, car: buildCar, bike: buildBike, blob: buildBlob })[spec.type](spec, P, B, F, rig, rnd);
  return { B, F, rig, P, tris: (B.i.length + F.i.length) / 3 };
}

export function buildEntity(specIn, { drawingImage = null, color = 0x22d3ee, quality = "phone" } = {}) {
  const t0 = performance.now();
  const q = Q[quality] ? quality : "phone";
  const spec = sane(specIn);
  let d = Q[q].d, A0 = null;
  for (let k = 0; k < 6; k++) { A0 = assemble(spec, color, d); if (A0.tris <= Q[q].tris) break; d *= 0.82; }
  const { B, F, rig, P } = A0;
  rig.realize();
  // The drawing as a small patch where it reads: a person's chest (left side), a car's doors, an animal's flank, the blob's back.
  const patchTex = q === "lite" ? null : makePatch(drawingImage, color);
  const Dc = new Buf();
  if (patchTex && rig.patch) {
    const pt = rig.patch;
    Dc.bone = rig.id(pt.bone);
    patchQuad(Dc, pt.c, pt.n, pt.up, pt.r);
    if (pt.mirror) patchQuad(Dc, [-pt.c[0], pt.c[1], pt.c[2]], [-pt.n[0], pt.n[1], pt.n[2]], pt.up, pt.r);
  }
  const gBody = toGeometry(B), gFx = toGeometry(F, true), gDecal = Dc.i.length ? toGeometry(Dc) : null;
  // size and radius of the body at rest, without the dig dust (hidden outside the dig clip)
  const dustBone = rig.index.has("dust") ? rig.id("dust") : -1;
  const bb = new THREE.Box3();
  for (let i = 0, v = new THREE.Vector3(); i < B.p.length; i += 3) if (B.b[i / 3] !== dustBone) bb.expandByPoint(v.set(B.p[i], B.p[i + 1], B.p[i + 2]));
  const size = { x: +(bb.max.x - bb.min.x).toFixed(3), y: +(bb.max.y - bb.min.y).toFixed(3), z: +(bb.max.z - bb.min.z).toFixed(3) };
  let radius = 0;
  for (let i = 0; i < B.p.length; i += 3) if (B.b[i / 3] !== dustBone) radius = Math.max(radius, Math.hypot(B.p[i], B.p[i + 1] - size.y / 2, B.p[i + 2]));
  const triangles = (B.i.length + F.i.length + Dc.i.length) / 3;
  const drawCalls = 1 + (gFx ? 1 : 0) + (gDecal ? 1 : 0);
  const T = tex().T;
  const wheelsOf = rig.wheels.slice();
  // A person's clips: the A-008 library plus the tool-grip tracks of this build (once per build, when the library is in).
  let propped = null;
  const personClips = () => {
    if (!PERSON_CLIPS) return [];
    if (!propped || propped.src !== PERSON_CLIPS) propped = { src: PERSON_CLIPS, clips: propClips(rig, PERSON_CLIPS) };
    return propped.clips;
  };
  const clipsOf = rig.kind === "person" ? personClips() : rig.kind === "quadruped" ? quadClips() : rig.kind === "car" ? vehicleClips(rig) : [];
  const loops = rig.kind === "person" ? PERSON_LOOPS : rig.kind === "car" ? VEH_LOOPS : QUAD_LOOPS;

  const instance = (o = {}) => {
    const c = o.color ?? color;
    const body = bodyMaterial(T.atlas, c, { rough: T.rough, normal: T.normal });
    const materials = [body], fxMaterials = [];
    const root = new THREE.Group();
    root.name = "entity3d";
    const bones = rig.tree();
    root.add(bones[0]);
    for (const b of bones) if (b.name === "dust") b.scale.setScalar(0.001); // the dig dust (vehicles) shows only while digging
    const skeleton = new THREE.Skeleton(bones, rig.inverses.map((m) => m.clone()));
    const mk = (geo, mat, name, order) => {
      const m = new THREE.SkinnedMesh(geo, mat);
      m.name = name; m.renderOrder = order; m.frustumCulled = false;
      root.add(m);
      m.bind(skeleton, new THREE.Matrix4());
      return m;
    };
    mk(gBody, body, "entity3d_body", 0);
    if (gDecal) { const dm = bodyMaterial(patchTex, c, { decal: true }); materials.push(dm); mk(gDecal, dm, "entity3d_patch", 1); }
    if (gFx) { const fm = fxMaterial(); fxMaterials.push(fm); mk(gFx, fm, "entity3d_fx", 2); }
    const byName = new Map(bones.map((b) => [b.name, b]));
    const sockets = {};
    for (const [name, sk] of Object.entries(rig.sockets)) {
      const bi = rig.id(sk.bone), ob = new THREE.Object3D();
      ob.name = `socket_${name}`;
      ob.position.copy(new THREE.Vector3(...sk.at).applyMatrix4(rig.inverses[bi]));
      ob.quaternion.copy(new THREE.Quaternion().setFromRotationMatrix(rig.inverses[bi]));
      bones[bi].add(ob);
      sockets[name] = ob;
    }
    const wheels = wheelsOf.map((w) => ({ pivot: byName.get(w.bone), radius: w.radius, drawn: false }));
    // Animation: one mixer per instance; the clips are shared.
    const clips = rig.kind === "person" ? personClips() : clipsOf;
    const mixer = clips.length ? new THREE.AnimationMixer(root) : null;
    const clipBy = new Map(clips.map((cl) => [cl.name, cl]));
    let current = null;
    const play = mixer ? (name, { fade = 0.12, loop = loops.has(name), restart = false } = {}) => {
      const clip = clipBy.get(name);
      if (!clip) throw new Error(`entity3d: unknown clip ${name}`);
      const next = mixer.clipAction(clip);
      if (!restart && current === next && next.isRunning()) return next;
      const prev = current;
      next.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      next.clampWhenFinished = !loop;
      next.play();
      if (prev && prev !== next) { if (fade) { prev.fadeOut(fade); next.fadeIn(fade); } else prev.stop(); }
      current = next;
      return next;
    } : undefined;
    if (play && clipBy.has("idle")) { play("idle", { fade: 0 }); mixer.update(0); } // a view nobody updates (a decoy) still stands in its idle pose
    const view = {
      object3d: root, rig: rig.kind, type: spec.type, sockets, wheels, bones: byName, skeleton, materials, fxMaterials,
      clips: clips.map((cl) => ({ name: cl.name, duration: cl.duration })), mixer,
      play, update: mixer ? (dt) => { if (Number.isFinite(dt) && dt >= 0) mixer.update(dt); } : undefined,
      // A deterministic pose: clip `name` at phase 0..1 (vehicles: wheels turned by the phase; unknown → idle).
      pose(name, phase = 0) {
        const ph = clamp(Number(phase) || 0, 0, 1);
        if (mixer) {
          const clip = clipBy.get(name) || clipBy.get(name === "run" ? "gallop" : "idle") || clipBy.get("idle");
          mixer.stopAllAction();
          const a = mixer.clipAction(clip);
          a.reset().setLoop(THREE.LoopRepeat, Infinity).play();
          a.time = ph * clip.duration;
          mixer.update(0);
          current = a;
        }
        for (const w of wheels) w.pivot.rotation.x = -ph * Math.PI * 2 * (name === "idle" ? 0 : 1);
        root.updateMatrixWorld(true);
      },
      setOpacity(a) {
        a = Number.isFinite(Number(a)) ? clamp(Number(a), 0, 1) : 1;
        for (const m of materials) { const tr = a < 0.999 || m.map === patchTex; if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } m.opacity = a; m.depthWrite = a > 0.999; }
        for (const m of fxMaterials) m.opacity = a;
      },
      dispose() { if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(root); } for (const m of materials) m.dispose(); for (const m of fxMaterials) m.dispose(); root.removeFromParent(); },
    };
    return view;
  };
  const first = instance();
  return {
    ...first, spec, triangles, drawCalls, size, radius, ms: +(performance.now() - t0).toFixed(1), quality: q, detail: +d.toFixed(3),
    instance,
    dispose() { first.dispose(); gBody.dispose(); if (gFx) gFx.dispose(); if (gDecal) gDecal.dispose(); if (patchTex) patchTex.dispose(); },
  };
}

export const _internals = { sane, palette, quadClips, PERSON_BONES, QUAD_BONES, Rig };
