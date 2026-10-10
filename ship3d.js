// ship3d.js: the drawn ship as a chunky, cartoony 3D model (v1.4, owner 09:30: "now it looks like a cookie").
// astra-ship.js reads the drawing into a "ship spec" (hull, cockpit, wings, fins, engines, weapons, extras, palette);
// this module builds the ship from it on every screen, with the player's drawing on the hull as a sticker. No model call.
//
//   buildShip(spec, { drawingImage, color = 0x22d3ee, quality: "lite"|"phone"|"big" })
//     → { object3d, sockets, materials, fxMaterials, radius, size: {x, y, z}, triangles, drawCalls, ms,
//         instance({ color }) → { object3d, sockets, materials, fxMaterials, setEnginePower(p), setOpacity(a), dispose() },
//         setEnginePower(p), setOpacity(a), dispose() }
//   shipTextures() → { atlas, rough, normal, canvas, size, regions, decals, kit }   // the shared procedural set (cached)
//   useShipKit(kit) → bool    // composites a hand-made kit (A-012 loadShipKit()) into the atlas regions
//   SHIP_LENGTH = 3.2
//
// Frame: nose towards -Z, up +Y, right +X, centred on the origin, the longest horizontal side ≈ SHIP_LENGTH.
// At most 3 draw calls: 1 = every solid part merged (one MeshStandardMaterial on the shared 1024 atlas, tinted by vertex
// colours, atlas decals as cutouts, a rim in the player colour), 2 = the sticker (the drawing on a ≤ 512 canvas, on both
// hull sides and on top, conforming to the hull), 3 = FX (additive: flames, nozzle glows, lamps; bloom picks them up).
// materials = the lit ones [body, sticker?] (render.js multiplies color, zeroes emissive, fades them); fxMaterials = the
// additive one (fade it with opacity only). setEnginePower(p): 0 off, 0.35 idle, 1 flying, 2.2 boost; call every frame.
// Deterministic: the same spec + options give the same geometry (variation from spec.seed only).
import * as THREE from "three";

export const SHIP_LENGTH = 3.2;
const Q = { lite: { tris: 2600, d: 0.62 }, phone: { tris: 4000, d: 0.86 }, big: { tris: 5000, d: 1.05 } };
const SELF = 0.12; // self-light (× albedo) through material.emissive: the soft toon fill; render.js zeroes it for a wreck

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
// An orthonormal frame { o, f, u } with f along dir (r = u × f is the third axis).
function frame(o, dir, hint = [0, 1, 0]) {
  const f = nrm(dir);
  let h = hint;
  if (Math.abs(dot(f, h)) > 0.95) h = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [0, 0, -1];
  const u = nrm(sub(h, scl(f, dot(f, h))));
  return { o, f, u };
}

// ---- The shared texture set ----------------------------------------------------------------------------------------

const A = 1024;
const RR = (x, y, w, h) => ({ x, y, w, h });
const REG = {
  panels: RR(0, 0, 512, 512), hazard: RR(512, 0, 512, 128), racing: RR(512, 128, 512, 128), glass: RR(512, 256, 256, 256),
  nozzle: RR(768, 256, 256, 256), trim: RR(0, 512, 256, 128), flat: RR(256, 512, 128, 128), glow: RR(384, 512, 128, 128),
  flame: RR(512, 512, 256, 128), metal: RR(768, 512, 256, 128),
};
const DECAL_NAMES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "star", "chevrons", "cross", "bolt", "skull", "ring", "arrow", "dot", "heart"];
const DEC = Object.fromEntries(DECAL_NAMES.map((n, i) => [n, RR((i % 8) * 128, 640 + Math.floor(i / 8) * 128, 128, 128)]));
// UV of a point (s, t) ∈ [0,1]² inside a region (inset 3 px against bleeding; flipY = false: v grows downwards).
const ruv = (r, s, t) => [(r.x + 3 + clamp(s, 0, 1) * (r.w - 6)) / A, (r.y + 3 + clamp(t, 0, 1) * (r.h - 6)) / A];

function mkCanvas(w, h) {
  if (typeof document !== "undefined") { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}

function paintAtlas(g) {
  g.clearRect(0, 0, A, A);
  const rnd = rng(1234);
  // Panels: greyscale painted metal (tinted by vertex colour), symmetric around u = 0.25 (top) and 0.75 (belly).
  { const { x, y, w, h } = REG.panels;
    g.fillStyle = "#d9dde4"; g.fillRect(x, y, w, h);
    const us = [0, 0.13, 0.37, 0.5, 0.63, 0.87, 1], vs = [0, 0.1, 0.27, 0.45, 0.6, 0.76, 0.9, 1];
    for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < vs.length - 1; j++) {
      const s = 200 + Math.floor(rnd() * 26);
      const px = x + us[i] * w, py = y + vs[j] * h, pw = (us[i + 1] - us[i]) * w, ph = (vs[j + 1] - vs[j]) * h;
      g.fillStyle = `rgb(${s},${s},${s + 4})`; g.fillRect(px, py, pw, ph);
      g.fillStyle = "rgba(255,255,255,0.45)"; g.fillRect(px + 3, py + 3, pw - 6, 3); g.fillRect(px + 3, py + 3, 3, ph - 6);
      g.fillStyle = "rgba(120,128,142,0.55)"; g.fillRect(px + 3, py + ph - 6, pw - 6, 3); g.fillRect(px + pw - 6, py + 3, 3, ph - 6);
      if (rnd() < 0.22 && pw > 40 && ph > 40) { // vents
        g.fillStyle = "#4b5262";
        for (let k = 0; k < 4; k++) g.fillRect(px + pw * 0.25, py + ph * (0.25 + k * 0.14), pw * 0.5, ph * 0.06);
      } else if (rnd() < 0.25 && pw > 40 && ph > 40) { // a hatch
        g.strokeStyle = "#8d96a5"; g.lineWidth = 3; g.strokeRect(px + pw * 0.22, py + ph * 0.22, pw * 0.56, ph * 0.56);
      }
    }
    g.fillStyle = "#7c8597";
    for (const u of us) g.fillRect(x + u * w - 2, y, 4, h);
    for (const v of vs) g.fillRect(x, y + v * h - 2, w, 4);
    for (const u of us) for (let py = y + 10; py < y + h; py += 22) { // rivets
      g.fillStyle = "#a3abb8"; g.beginPath(); g.arc(x + u * w + 7, py, 3.2, 0, 7); g.fill();
      g.fillStyle = "#ffffff"; g.beginPath(); g.arc(x + u * w + 6, py - 1, 1.3, 0, 7); g.fill();
    }
  }
  // Hazard stripes (colour baked), period 64 px so the drill's spiral wraps seamlessly.
  { const { x, y, w, h } = REG.hazard;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = "#ffc61a"; g.fillRect(x, y, w, h);
    g.fillStyle = "#1f2129";
    for (let k = -4; k < 12; k++) { const x0 = x + k * 64; g.beginPath(); g.moveTo(x0, y + h); g.lineTo(x0 + 30, y + h); g.lineTo(x0 + 30 + h, y); g.lineTo(x0 + h, y); g.fill(); }
    g.restore(); }
  // Racing stripes: white bands on nothing (cutout), tinted.
  { const { x, y, w, h } = REG.racing;
    g.fillStyle = "#ffffff"; g.fillRect(x, y + 0.3 * h, w, 0.4 * h); g.fillRect(x, y + 0.1 * h, w, 0.09 * h); g.fillRect(x, y + 0.81 * h, w, 0.09 * h); }
  // Glass: bright towards u = 0.25 (top / front), a white highlight streak.
  { const { x, y, w, h } = REG.glass;
    const id = g.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = i / w, v = j / h, b = 0.5 + 0.5 * Math.cos(2 * Math.PI * (u - 0.25));
      const k = (j * w + i) * 4, t = b * (0.85 + 0.15 * (1 - v));
      id.data[k] = lerp(10, 110, t * t); id.data[k + 1] = lerp(26, 225, t); id.data[k + 2] = lerp(70, 255, Math.sqrt(t)); id.data[k + 3] = 255;
    }
    g.putImageData(id, x, y);
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.beginPath(); g.ellipse(x + 0.19 * w, y + 0.45 * h, 0.035 * w, 0.3 * h, 0, 0, 7); g.fill();
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.beginPath(); g.ellipse(x + 0.27 * w, y + 0.3 * h, 0.018 * w, 0.12 * h, 0, 0, 7); g.fill(); }
  // Nozzle: bands along v: metal, dark ring, heat tint, bright lip, dark inside.
  { const { x, y, w, h } = REG.nozzle;
    const band = (a, b, c0, c1) => { const gr = g.createLinearGradient(0, y + a * h, 0, y + b * h); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(x, y + a * h, w, (b - a) * h + 1); };
    band(0, 0.3, "#e3e8ef", "#aeb7c4"); band(0.3, 0.36, "#30343f", "#30343f"); band(0.36, 0.5, "#a7b0c2", "#7a6cf0");
    band(0.5, 0.62, "#7a6cf0", "#ff8a3d"); band(0.62, 0.7, "#f4f7fb", "#cfd6e0"); band(0.7, 1, "#26282f", "#09090c"); }
  // Trim: dark rubber with faint grip lines.
  { const { x, y, w, h } = REG.trim;
    g.fillStyle = "#2b2f3b"; g.fillRect(x, y, w, h);
    g.fillStyle = "#363b49"; for (let k = 0; k < h; k += 16) g.fillRect(x, y + k, w, 4); }
  { const { x, y, w, h } = REG.flat; g.fillStyle = "#ffffff"; g.fillRect(x, y, w, h); }
  // Glow: a soft radial dot (FX).
  { const { x, y, w, h } = REG.glow;
    const id = g.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const r = Math.hypot(i - w / 2 + 0.5, j - h / 2 + 0.5) / (w / 2), k = (j * w + i) * 4, I = Math.max(0, 1 - r) ** 2.2 * 255;
      id.data[k] = id.data[k + 1] = id.data[k + 2] = I; id.data[k + 3] = 255;
    }
    g.putImageData(id, x, y); }
  // Flame: a soft teardrop, base at u = 0, tip at u = 1 (FX).
  { const { x, y, w, h } = REG.flame;
    const id = g.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const s = i / (w - 1), q = Math.abs((j + 0.5) / h * 2 - 1);
      const rad = (1 - s) ** 0.75 * Math.min(1, 0.55 + s * 6);
      const I = rad > 0 ? Math.max(0, 1 - q / rad) ** 1.4 * (1 - s) ** 0.6 * Math.min(1, s * 14 + 0.3) : 0;
      const k = (j * w + i) * 4; id.data[k] = id.data[k + 1] = id.data[k + 2] = I * 255; id.data[k + 3] = 255;
    }
    g.putImageData(id, x, y); }
  // Metal: brushed light grey.
  { const { x, y, w, h } = REG.metal;
    g.fillStyle = "#d3dae3"; g.fillRect(x, y, w, h);
    for (let k = 0; k < 60; k++) { g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.35)" : "rgba(90,100,115,0.18)"; g.fillRect(x, y + rnd() * h, w, 1 + rnd() * 2); } }
  // Decal sheet (cutouts on nothing): digits, star, chevrons, red cross, bolt, skull, ring, arrow, dot, heart.
  for (const name of DECAL_NAMES) {
    const r = DEC[name], cx = r.x + 64, cy = r.y + 64;
    g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    g.lineJoin = "round"; g.lineCap = "round";
    const both = (path, fill, stroke = "#1b1d26", lw = 12) => { path(); g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); path(); g.fillStyle = fill; g.fill(); };
    if (/^\d$/.test(name)) {
      g.font = "900 108px 'Arial Black', Impact, 'Helvetica Neue', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.strokeStyle = "#1b1d26"; g.lineWidth = 16; g.strokeText(name, cx, cy + 6); g.fillStyle = "#ffffff"; g.fillText(name, cx, cy + 6);
    } else if (name === "star" || name === "dot" || name === "ring") {
      both(() => { g.beginPath(); if (name === "star") { for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 22 : 54; g.lineTo(cx + Math.cos(a) * rr, cy + 6 + Math.sin(a) * rr); } g.closePath(); } else { g.arc(cx, cy, 48, 0, 7); if (name === "ring") g.arc(cx, cy, 26, 0, 7, true); } }, "#ffffff");
    } else if (name === "chevrons" || name === "arrow") {
      const path = () => { g.beginPath(); if (name === "chevrons") { for (const oy of [-20, 22]) { g.moveTo(cx - 40, cy + oy + 22); g.lineTo(cx, cy + oy - 14); g.lineTo(cx + 40, cy + oy + 22); } } else { g.moveTo(cx, cy - 46); g.lineTo(cx, cy + 46); g.moveTo(cx - 34, cy - 10); g.lineTo(cx, cy - 46); g.lineTo(cx + 34, cy - 10); } };
      path(); g.strokeStyle = "#1b1d26"; g.lineWidth = 30; g.stroke(); path(); g.strokeStyle = "#ffffff"; g.lineWidth = 17; g.stroke();
    } else if (name === "cross") {
      both(() => { g.beginPath(); g.rect(cx - 17, cy - 50, 34, 100); g.rect(cx - 50, cy - 17, 100, 34); }, "#ef2d2d", "#ffffff", 16);
      g.fillStyle = "#ef2d2d"; g.fillRect(cx - 17, cy - 50, 34, 100); g.fillRect(cx - 50, cy - 17, 100, 34);
    } else if (name === "bolt") {
      both(() => { g.beginPath(); for (const [px, py] of [[14, -56], [-30, 6], [-2, 6], [-16, 56], [32, -10], [4, -10], [22, -56]]) g.lineTo(cx + px, cy + py); g.closePath(); }, "#ffd21a");
    } else if (name === "skull") {
      both(() => { g.beginPath(); g.arc(cx, cy - 8, 42, 0, 7); g.rect(cx - 24, cy + 20, 48, 30); }, "#ffffff");
      g.fillStyle = "#1b1d26"; g.beginPath(); g.arc(cx - 16, cy - 8, 11, 0, 7); g.arc(cx + 16, cy - 8, 11, 0, 7); g.fill();
      g.fillRect(cx - 3, cy + 6, 6, 12); for (const k of [-12, 0, 12]) g.fillRect(cx + k - 2, cy + 30, 4, 18);
    } else if (name === "heart") {
      both(() => { g.beginPath(); g.moveTo(cx, cy + 46); g.bezierCurveTo(cx - 70, cy - 4, cx - 34, cy - 60, cx, cy - 22); g.bezierCurveTo(cx + 34, cy - 60, cx + 70, cy - 4, cx, cy + 46); }, "#ff4d6d");
    }
    g.restore();
  }
}

function paintRough(g) {
  const s = 256 / A, put = (r, v) => { g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r.x * s, r.y * s, r.w * s, r.h * s); };
  g.fillStyle = "rgb(150,150,150)"; g.fillRect(0, 0, 256, 256);
  put(REG.panels, 228); put(REG.hazard, 215); put(REG.racing, 210); put(REG.glass, 75); put(REG.nozzle, 95); put(REG.trim, 225);
  put(REG.flat, 150); put(REG.metal, 110);
}

let TEX = null;
export function shipTextures() {
  if (TEX) return TEX;
  const canvas = mkCanvas(A, A);
  paintAtlas(canvas.getContext("2d"));
  const atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.flipY = false; atlas.anisotropy = 4; atlas.name = "ship3d_atlas";
  const roughCanvas = mkCanvas(256, 256);
  paintRough(roughCanvas.getContext("2d"));
  const rough = new THREE.CanvasTexture(roughCanvas);
  rough.flipY = false; rough.name = "ship3d_rough";
  TEX = { atlas, rough, normal: null, canvas, roughCanvas, size: A, regions: REG, decals: DEC, kit: false };
  return TEX;
}

// A hand-made kit (assets/A-012-ship-kit/ship-kit.js loadShipKit()) replaces the procedural regions: each kit texture's
// image (or its offset/repeat view of a shared sheet) is drawn into the matching atlas region. Safe on missing images.
// Ships built afterwards also get the kit's panel normal map. Returns true when at least one region was replaced.
export function useShipKit(kit) {
  const T = shipTextures();
  if (!kit || typeof kit !== "object") return false;
  const g = T.canvas.getContext("2d");
  let used = 0;
  const src = (tex) => {
    const img = tex && tex.image;
    const iw = img && (img.naturalWidth || img.width), ih = img && (img.naturalHeight || img.height);
    if (!iw || !ih) return null;
    const ox = tex.offset ? tex.offset.x : 0, oy = tex.offset ? tex.offset.y : 0, rx = tex.repeat ? tex.repeat.x : 1, ry = tex.repeat ? tex.repeat.y : 1;
    return { img, sx: ox * iw, sy: (tex.flipY !== false ? 1 - oy - ry : oy) * ih, sw: rx * iw, sh: ry * ih };
  };
  const put = (tex, reg, ctx = g) => {
    const s = src(tex);
    if (!s) return false;
    try { ctx.clearRect(reg.x, reg.y, reg.w, reg.h); ctx.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, reg.x, reg.y, reg.w, reg.h); used++; return true; } catch { return false; }
  };
  put(kit.panels, REG.panels); put(kit.stripes || kit.hazard, REG.hazard); if (kit.racing) put(kit.racing, REG.racing);
  put(kit.glass, REG.glass); put(kit.nozzle, REG.nozzle); put(kit.trim, REG.trim);
  const dimg = kit.decals && kit.decals.image, rects = kit.decalRects || {};
  if (dimg) for (const name of DECAL_NAMES) {
    const r = rects[name] || (name === "bolt" && rects.lightning);
    if (!r || !(r.width > 0)) continue;
    const d = DEC[name];
    try { g.clearRect(d.x, d.y, d.w, d.h); g.drawImage(dimg, r.x, r.y, r.width, r.height, d.x + 8, d.y + 8, d.w - 16, d.h - 16); used++; } catch { /* keep the procedural one */ }
  }
  if (kit.panelsNormal && src(kit.panelsNormal)) {
    const nc = mkCanvas(A, A), ng = nc.getContext("2d");
    ng.fillStyle = "rgb(128,128,255)"; ng.fillRect(0, 0, A, A);
    if (put(kit.panelsNormal, REG.panels, ng)) {
      if (T.normal) T.normal.dispose();
      T.normal = new THREE.CanvasTexture(nc); T.normal.flipY = false; T.normal.name = "ship3d_normal";
    }
  }
  T.atlas.needsUpdate = true;
  T.kit = T.kit || used > 0;
  return used > 0;
}

// ---- Geometry buffers ----------------------------------------------------------------------------------------------

class Buf {
  constructor(fx = false) { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.fx = fx ? [] : null; this.fxv = [0, 0, 0, 0]; }
  get count() { return this.p.length / 3; }
  v(p, n, uv, c) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]); this.c.push(c[0], c[1], c[2]);
    if (this.fx) this.fx.push(this.fxv[0], this.fxv[1], this.fxv[2], this.fxv[3]);
    return this.count - 1;
  }
  // A triangle wound so its face normal agrees with its vertex normals (every builder below can ignore winding).
  tri(a, b, c) {
    const p = this.p, n = this.n;
    const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
    const ux = p[3 * b] - ax, uy = p[3 * b + 1] - ay, uz = p[3 * b + 2] - az, vx = p[3 * c] - ax, vy = p[3 * c + 1] - ay, vz = p[3 * c + 2] - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * fx + fy * fy + fz * fz < 1e-14) return;
    const sx = n[3 * a] + n[3 * b] + n[3 * c], sy = n[3 * a + 1] + n[3 * b + 1] + n[3 * c + 1], sz = n[3 * a + 2] + n[3 * b + 2] + n[3 * c + 2];
    if (fx * sx + fy * sy + fz * sz < 0) this.i.push(a, c, b); else this.i.push(a, b, c);
  }
}

// A surface of rings around an axis. rows: [{ t, a, b, n, nb, x, y, v, c }]: t along f, half sizes a (along r = u × f)
// and b (along u), superellipse exponents n (upper half) / nb (lower), offsets x / y, the v in the region, a colour.
// a = b = 0 is a pole. Normals from the grid; opt: th0/th1 (an open arc), uOf (u range in the region).
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
  for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (!N[i * nc + j]) N[i * nc + j] = (i + 1 < nr && N[(i + 1) * nc + j]) || (i > 0 && N[(i - 1) * nc + j]) || f;
  const base = B.count, u0 = opt.u0 ?? 0, u1 = opt.u1 ?? 1;
  for (let i = 0; i < nr; i++) {
    const s = rows[i], vv = s.v ?? i / Math.max(1, nr - 1), cc = s.c || col;
    for (let j = 0; j < nc; j++) {
      const p = at(i, j), cl = opt.colFn ? opt.colFn(p, N[i * nc + j], cc) : cc;
      B.v(p, N[i * nc + j], ruv(s.reg || reg, lerp(u0, u1, j / seg), vv), cl);
    }
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

// A chunky plate (wing, fin, blade): a convex planform poly [[s, c]...] in the frame { o, s, c, n } with half
// thickness th(s), flat faces and a fully rounded edge (darker), so it never looks paper-thin.
function slab(B, poly, fr, th, reg, colTop, colEdge, colBot, rows = 3) {
  const { o } = fr, S = fr.s, C = fr.c, Nn = fr.n;
  const P = (s, c, h) => [o[0] + S[0] * s + C[0] * c + Nn[0] * h, o[1] + S[1] * s + C[1] * c + Nn[1] * h, o[2] + S[2] * s + C[2] * c + Nn[2] * h];
  let ar = 0, cs = 0, cc = 0, smin = Infinity, smax = -Infinity, cmin = Infinity, cmax = -Infinity;
  const K = poly.length;
  for (let k = 0; k < K; k++) {
    const [s0, c0] = poly[k], [s1, c1] = poly[(k + 1) % K];
    ar += s0 * c1 - s1 * c0; cs += s0; cc += c0;
    smin = Math.min(smin, s0); smax = Math.max(smax, s0); cmin = Math.min(cmin, c0); cmax = Math.max(cmax, c0);
  }
  cs /= K; cc /= K;
  const sgn = ar >= 0 ? 1 : -1;
  const puv = (s, c) => ruv(reg, (s - smin) / ((smax - smin) || 1) * 0.6 + 0.2, (c - cmin) / ((cmax - cmin) || 1) * 0.6 + 0.2);
  for (const side of [1, -1]) {
    const nn = scl(Nn, side), col = side > 0 ? colTop : colBot;
    const ci = B.v(P(cs, cc, side * th(cs)), nn, puv(cs, cc), col);
    const first = B.count;
    for (const [s, c] of poly) B.v(P(s, c, side * th(s)), nn, puv(s, c), col);
    for (let k = 0; k < K; k++) B.tri(ci, first + k, first + (k + 1) % K);
  }
  // The rounded edge: rows from the top face round the outline to the bottom face.
  const E = poly.map((p, k) => {
    const a = poly[(k + K - 1) % K], b = poly[(k + 1) % K];
    const e0 = [p[0] - a[0], p[1] - a[1]], e1 = [b[0] - p[0], b[1] - p[1]];
    const n0 = nrm([e0[1] * sgn, -e0[0] * sgn, 0]), n1 = nrm([e1[1] * sgn, -e1[0] * sgn, 0]);
    return nrm([n0[0] + n1[0], n0[1] + n1[1], 0]);
  });
  const base = B.count, R = rows * 2 + 1, fu = ruv(REG.flat, 0.5, 0.5);
  for (let k = 0; k < K; k++) {
    const [s, c] = poly[k], h = th(s), e = E[k], out = add(scl(S, e[0]), scl(C, e[1]));
    for (let m = 0; m < R; m++) {
      const ph = Math.PI / 2 - Math.PI * m / (R - 1), cp = Math.cos(ph), sp = Math.sin(ph);
      const p = madd(P(s, c, h * sp), out, h * 0.9 * cp);
      B.v(p, nrm(add(scl(out, cp), scl(Nn, sp))), fu, colEdge);
    }
  }
  for (let k = 0; k < K; k++) for (let m = 0; m < R - 1; m++) {
    const a = base + k * R + m, b = base + ((k + 1) % K) * R + m;
    B.tri(a, b, a + 1); B.tri(b, b + 1, a + 1);
  }
}

// A tube along a polyline (radius per point), parallel-transported rings, rounded caps.
function tube(B, pts, rad, seg, reg, col) {
  const n = pts.length;
  const T = pts.map((p, i) => nrm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  let N0 = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  N0 = nrm(sub(N0, scl(T[0], dot(N0, T[0]))));
  const base = B.count, Ns = [];
  for (let i = 0; i < n; i++) {
    if (i) N0 = nrm(sub(N0, scl(T[i], dot(N0, T[i]))));
    Ns.push(N0);
  }
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
  for (const [i, sg] of [[0, -1], [n - 1, 1]]) { // caps
    const r = typeof rad === "number" ? rad : rad[i], c = B.v(madd(pts[i], T[i], sg * r * 0.6), scl(T[i], sg), ruv(reg, 0.5, 0.5), col);
    const ring = base + i * (seg + 1);
    for (let j = 0; j < seg; j++) B.tri(c, ring + j, ring + j + 1);
  }
}

// Revolved helpers on rings().
const sphere = (B, c, r, seg, reg, col, sy = 1, dir = [0, 1, 0]) => {
  const rows = [], k = Math.max(4, Math.round(seg / 2));
  for (let i = 0; i <= k; i++) { const a = -Math.PI / 2 + Math.PI * i / k; rows.push({ t: Math.sin(a) * r * sy, a: Math.cos(a) * r, b: Math.cos(a) * r, v: i / k }); }
  rings(B, rows, seg, frame(c, dir, [0, 0, -1]), reg, col);
};
// A cylinder from p0 to p1 with bevelled caps (r0 at p0, r1 at p1).
const cyl = (B, p0, p1, r0, r1, seg, reg, col, bevel = 0.25) => {
  const L = len(sub(p1, p0)), e = Math.min(L * 0.3, Math.max(r0, r1) * bevel);
  rings(B, [{ t: 0, a: 0, b: 0 }, { t: 0, a: r0 * 0.75, b: r0 * 0.75 }, { t: e * 0.5, a: r0, b: r0 }, { t: L - e * 0.5, a: r1, b: r1 }, { t: L, a: r1 * 0.75, b: r1 * 0.75 }, { t: L, a: 0, b: 0 }],
    seg, frame(p0, sub(p1, p0)), reg, col);
};
// A rounded box along dir (length l, half sizes a × b, superellipse n), centred at c.
const rbox = (B, c, dir, l, a, b, seg, reg, col, n = 5, hint) => {
  const fr = frame(madd(c, nrm(dir), -l / 2), dir, hint), e = Math.min(a, b, l / 2) * 0.35;
  rings(B, [{ t: 0, a: 0, b: 0, n }, { t: 0, a: a - e, b: b - e, n }, { t: e, a, b, n }, { t: l - e, a, b, n }, { t: l, a: a - e, b: b - e, n }, { t: l, a: 0, b: 0, n }], seg, fr, reg, col);
};

// ---- The hull: an analytic body every part snaps onto ---------------------------------------------------------------

const HULLS = ["capsule", "wedge", "saucer", "box", "dart", "rocket"];
function makeHull(spec, L) {
  const h = spec.hull;
  const shape = HULLS.includes(h.shape) ? h.shape : "dart";
  if (shape === "saucer") {
    const R = num(h.width, 0.95, 0.5, 1.1) * L / 2, H = num(h.height, 0.32, 0.12, 0.6) * L;
    const ht = H * 0.42, hb = H * 0.34, n = 2.4, m = 2.2;
    const top = (x, z) => { const q = Math.hypot(x, z) / R; return q >= 1 ? 0 : ht * (1 - q ** n) ** (1 / m); };
    const bot = (x, z) => { const q = Math.hypot(x, z) / R; return q >= 1 ? 0 : -hb * (1 - q ** n) ** (1 / m); };
    const side = (z, y) => { const hh = y >= 0 ? ht : hb, q = Math.abs(y) / hh; if (q >= 1) return 0; const rr = R * (1 - q ** m) ** (1 / n); return Math.sqrt(Math.max(0, rr * rr - z * z)); };
    const H0 = {
      shape, saucer: true, L: 2 * R, R, ht, hb, z0: -R, z1: R, z: (t) => -R + 2 * R * t, t: (z) => (z + R) / (2 * R),
      top, bot, side,
      sec(t) { const z = this.z(t), tp = top(0, z), bt = bot(0, z); return { a: side(z, 0), b: (tp - bt) / 2, yc: (tp + bt) / 2, n: 2, nb: 2 }; },
    };
    H0.build = (B, d, col) => {
      const rows = [], k = Math.max(10, Math.round(18 * d));
      for (let i = 0; i <= k; i++) {
        const a = -Math.PI / 2 + Math.PI * i / k, s = Math.sin(a), c = Math.cos(a);
        const rr = R * Math.abs(c) ** (2 / n), y = (s >= 0 ? ht : hb) * spow(s, 2 / m);
        rows.push({ t: y, a: rr, b: rr, v: i / k });
      }
      rings(B, rows, Math.max(20, Math.round(36 * d)), frame([0, 0, 0], [0, 1, 0], [0, 0, -1]), REG.panels, col.main,
        { colFn: (p, nn, c) => (Math.abs(p[1]) < H * 0.06 ? col.second : nn[1] < -0.3 ? col.belly : c), u1: 2 });
    };
    return H0;
  }
  let W = num(h.width, 0.26, 0.1, 0.8) * L, Hh = num(h.height, 0.22, 0.08, 0.7) * L;
  if (shape === "rocket") W = Hh = Math.max(W, Hh, 0.2 * L);
  if (shape === "dart") { W = Math.min(W, 0.36 * L); Hh = Math.min(Hh, 0.28 * L); }
  W = Math.max(W, 0.13 * L); Hh = Math.max(Hh, 0.11 * L);
  const nose = ["pointed", "round", "blunt", "flat"].includes(h.nose) ? h.nose : shape === "box" ? "blunt" : "pointed";
  const tail = ["tapered", "flat", "round"].includes(h.tail) ? h.tail : "flat";
  const P = {
    dart: { n: 2.3, nb: 2.0, tn: 0.4 }, capsule: { n: 2.1, nb: 2.1, tn: 0.24 }, rocket: { n: 2, nb: 2, tn: 0.3 },
    box: { n: 4.6, nb: 4.6, tn: nose === "pointed" ? 0.24 : 0.1 }, wedge: { n: 2.4, nb: 7, tn: 0.16 },
  }[shape];
  const tt = 0.16;
  const noseF = (q) => {
    q = clamp(q, 0, 1);
    if (nose === "pointed") return 1 - (1 - q) ** 2;
    const r = Math.sqrt(1 - (1 - q) ** 2);
    return nose === "round" ? r : nose === "blunt" ? 0.52 + 0.48 * r : 0.8 + 0.2 * r;
  };
  const tailF = (s) => (tail === "tapered" ? 1 - 0.42 * s ** 1.4 : tail === "flat" ? 1 - 0.07 * s * s : Math.sqrt(Math.max(0, 1 - s * s)));
  const A0 = W / 2, B0 = Hh / 2;
  const sec = (t) => {
    t = clamp(t, 0, 1);
    const nf = noseF(t / P.tn), tf = t > 1 - tt ? tailF((t - (1 - tt)) / tt) : 1;
    let a = A0 * nf * tf, b = B0 * (shape === "dart" ? noseF(t / (P.tn * 1.15)) : nf) * tf, yc = 0;
    if (shape === "wedge") { a *= 0.32 + 0.68 * t ** 0.85; b *= 0.42 + 0.58 * t; yc = -B0 + b; }
    if (shape === "dart") { a *= 1 - 0.18 * Math.max(0, t - 0.55); }
    return { a, b, yc, n: P.n, nb: P.nb };
  };
  const z0 = -L / 2, zf = (t) => z0 + t * L, tf = (z) => (z - z0) / L;
  const top = (x, z) => { const s = sec(tf(z)); const q = Math.abs(x) / (s.a || 1e-6); return q >= 1 ? s.yc : s.yc + s.b * (1 - q ** s.n) ** (1 / s.n); };
  const bot = (x, z) => { const s = sec(tf(z)); const q = Math.abs(x) / (s.a || 1e-6); return q >= 1 ? s.yc : s.yc - s.b * (1 - q ** s.nb) ** (1 / s.nb); };
  const side = (z, y) => { const s = sec(tf(z)); const q = (y - s.yc) / (s.b || 1e-6), e = q >= 0 ? s.n : s.nb; return Math.abs(q) >= 1 ? 0 : s.a * (1 - Math.abs(q) ** e) ** (1 / e); };
  const H0 = { shape, saucer: false, L, W, H: Hh, nose, tail, z0, z1: -z0, z: zf, t: tf, sec, top, bot, side };
  H0.rows = (d) => {
    const N = Math.max(14, Math.round(30 * d)), rows = [];
    const s0 = sec(0), s1 = sec(1);
    const front = s0.a > 1e-4, back = s1.a > 1e-4;
    if (front) { rows.push({ t: zf(0), a: 0, b: 0 }); rows.push({ t: zf(0), a: s0.a * 0.82, b: s0.b * 0.82, y: s0.yc }); }
    for (let i = 0; i < N; i++) {
      const q = i / (N - 1), t = 0.5 * q + 0.5 * (1 - Math.cos(Math.PI * q)) / 2;
      const tt2 = front && i === 0 ? 0.008 : back && i === N - 1 ? 0.992 : t;
      const s = sec(tt2);
      rows.push({ t: zf(tt2), a: s.a, b: s.b, y: s.yc });
    }
    if (back) { rows.push({ t: zf(1), a: s1.a * 0.84, b: s1.b * 0.84, y: s1.yc }); rows.push({ t: zf(1) - 0.012 * L, a: 0, b: 0, y: s1.yc }); }
    for (const r of rows) { r.n = P.n; r.nb = P.nb; r.v = clamp((r.t - z0) / L, 0, 1); }
    return rows;
  };
  H0.build = (B, d, col) => {
    rings(B, H0.rows(d), Math.max(16, Math.round(30 * d) & ~1), frame([0, 0, 0], [0, 0, 1], [0, 1, 0]), REG.panels, col.main,
      { colFn: (p, nn, c) => (nn[1] < -0.42 ? col.belly : c) });
  };
  return H0;
}

// A conforming patch on the hull: "side" (projected along ±X onto the skin, z × y) or "top" (along +Y, z × x).
// uvf(i, j) → [u, v] with i along the ship (0 = back end, 1 = nose end) and j across (0 = top / left, 1 = bottom / right).
function patch(B, hull, mode, zc, cc, w, h, nz, ny, uvf, col, lift = 0.008, sign = 1) {
  const point = (z, q) => {
    if (mode === "side") {
      const s = hull.sec(hull.t(z)), y = clamp(q, s.yc - 0.93 * s.b, s.yc + 0.93 * s.b);
      return [sign * hull.side(z, y), y, z];
    }
    const s = hull.sec(hull.t(z)), x = clamp(q, -0.93 * s.a, 0.93 * s.a);
    return [x, hull.top(x, z), z];
  };
  const base = B.count;
  for (let i = 0; i <= nz; i++) for (let j = 0; j <= ny; j++) {
    const z = zc + w / 2 - w * i / nz, q = mode === "side" ? cc + h / 2 - h * j / ny : cc - h / 2 + h * j / ny;
    const p = point(z, q), e = 0.01;
    const pz = sub(point(z + e, q), point(z - e, q)), pq = sub(point(z, q + e), point(z, q - e));
    let n = nrm(cross(pz, pq));
    if ((mode === "side" && n[0] * sign < 0) || (mode === "top" && n[1] < 0)) n = scl(n, -1);
    if (!Number.isFinite(n[0]) || len(n) < 0.5) n = mode === "side" ? [sign, 0, 0] : [0, 1, 0];
    B.v(madd(p, n, lift), n, uvf(i / nz, j / ny), col);
  }
  for (let i = 0; i < nz; i++) for (let j = 0; j < ny; j++) {
    const a = base + i * (ny + 1) + j, b = a + ny + 1;
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
function palette(spec, color) {
  const P = spec.palette || {};
  const player = C(color);
  // A dull player colour still paints a bright ship: lift saturation and lightness a little.
  const vivid = (rgb) => { const c = new THREE.Color(rgb[0], rgb[1], rgb[2]), h = {}; c.getHSL(h, THREE.SRGBColorSpace); c.setHSL(h.h, Math.max(h.s, 0.55), clamp(h.l, 0.42, 0.62), THREE.SRGBColorSpace); return [c.r, c.g, c.b]; };
  const drawn = (v) => (hex(v) ? C(hex(v)) : null);
  const main = drawn(spec.hull.color) || drawn(P.main) || vivid(player);
  const isPlayer = !drawn(spec.hull.color) && !drawn(P.main);
  const second = drawn(spec.wings.color) || drawn(P.second) || shade(main, 0.62, 1.1, -0.03);
  const accent = drawn(spec.hull.stripe) || drawn(P.accent) || (isPlayer ? C("#ffcf33") : vivid(player));
  return {
    main, second, accent, player: vivid(player), isPlayer,
    belly: mix(main, [1, 1, 1], 0.55), trim: C("#2a2e3a"), metal: C("#d9dfe7"), white: [1, 1, 1], dark: C("#1d2029"),
    glass: drawn(spec.cockpit.color) ? mix(C(spec.cockpit.color), [1, 1, 1], 0.35) : [1, 1, 1],
    red: C("#ef2d2d"), yellow: C("#ffd21a"), purple: C("#9b5de5"),
    flameTip: drawn(spec.engines.flameColor) || (hex(spec.engines.flameColor) ? C(spec.engines.flameColor) : null),
  };
}

// ---- Spec defaults (normalized specs already have everything; this keeps odd input from throwing) -------------------

function sane(spec) {
  const s = spec && typeof spec === "object" ? spec : {};
  const o = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
  const h = o(s.hull), c = o(s.cockpit), w = o(s.wings), e = o(s.engines), p = o(s.palette);
  return {
    seed: Number(s.seed) >>> 0, noseDir: ["right", "left", "up", "down"].includes(s.noseDir) ? s.noseDir : "right", style: s.style || "chunky",
    hull: { shape: h.shape, width: h.width, height: h.height, nose: h.nose, tail: h.tail, color: hex(h.color), stripe: hex(h.stripe) },
    cockpit: { kind: ["none", "bubble", "canopy", "visor", "windows"].includes(c.kind) ? c.kind : "canopy", at: num(c.at, 0.28, 0, 1), size: num(c.size, 0.22, 0.06, 0.6), color: hex(c.color) },
    wings: { count: Math.round(num(w.count, 2, 0, 4)) >= 3 ? 4 : Math.round(num(w.count, 2, 0, 4)) >= 1 ? 2 : 0, shape: ["delta", "swept", "straight", "forward", "round"].includes(w.shape) ? w.shape : "swept",
      at: num(w.at, 0.6, 0.1, 0.95), span: num(w.span, 0.8, 0.2, 1.4), chord: num(w.chord, 0.32, 0.08, 0.8), mount: ["low", "mid", "high"].includes(w.mount) ? w.mount : "mid", color: hex(w.color) },
    fins: arr(s.fins).slice(0, 3).map((f) => ({ kind: ["tail", "side", "belly"].includes(f.kind) ? f.kind : "tail", at: num(f.at, 0.85, 0, 1), size: num(f.size, 0.22, 0.06, 0.6), color: hex(f.color) })),
    engines: { count: Math.round(num(e.count, 0, 0, 4)), size: num(e.size, 0.16, 0.06, 0.45), flame: e.flame === true, flameColor: hex(e.flameColor), layout: ["single", "pair", "row", "stack", "pods"].includes(e.layout) ? e.layout : "single" },
    weapons: arr(s.weapons).slice(0, 4).map((x) => ({ kind: x.kind, count: Number(x.count) >= 1.5 ? 2 : 1, at: num(x.at, 0.3, 0, 1), mount: x.mount, size: num(x.size, 0.25, 0.06, 0.6), color: hex(x.color) })),
    extras: arr(s.extras).slice(0, 6).map((x) => ({ kind: String(x.kind || "other"), at: num(x.at, 0.5, 0, 1), mount: x.mount, size: num(x.size, 0.15, 0.04, 1), color: hex(x.color), label: String(x.label || "").slice(0, 12) })),
    palette: { colored: p.colored === true, main: hex(p.main), second: hex(p.second), accent: hex(p.accent) },
  };
}

// ---- The sticker (the player's drawing, per ship) ------------------------------------------------------------------

function inkBox(img, w, h) {
  try {
    const k = Math.min(1, 160 / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const c = mkCanvas(cw, ch), g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, cw, ch);
    const d = g.getImageData(0, 0, cw, ch).data;
    let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      if (d[i + 3] > 60 && d[i] + d[i + 1] + d[i + 2] < 560) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < x0) return [0, 0, w, h];
    const m = 2;
    return [Math.max(0, (x0 - m) / k), Math.max(0, (y0 - m) / k), Math.min(w, (x1 + 1 + m) / k), Math.min(h, (y1 + 1 + m) / k)];
  } catch { return [0, 0, w, h]; }
}
// The drawing's ink alone (v1.6): paper (light, unsaturated pixels) becomes transparent, black ink a dark navy, coloured strokes
// keep their colour a little darker. A canvas the size it is drawn at. Falls back to the raw image if pixels cannot be read.
function inkLayer(img, x0, y0, bw, bh, w, h) {
  try {
    const cv = mkCanvas(w, h), g = cv.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, x0, y0, bw, bh, 0, 0, w, h);
    const im = g.getImageData(0, 0, w, h), d = im.data;
    // the paper's level = the median of the darkest channel (most of a line drawing is paper): a grey photo of paper clears too
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) hist[Math.min(d[i], d[i + 1], d[i + 2])]++;
    let paper = 255;
    for (let v = 0, acc = 0, half = d.length / 8; v < 256; v++) { acc += hist[v]; if (acc >= half) { paper = v; break; } }
    paper = clamp(paper, 110, 255);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2], mn = Math.min(r, gg, b), mx = Math.max(r, gg, b);
      const a = clamp((paper - 30 - mn) / 60, 0, 1) * (d[i + 3] / 255), sat = mx - mn;
      if (sat > 60) { d[i] = r * 0.8; d[i + 1] = gg * 0.8; d[i + 2] = b * 0.8; } else { d[i] = 22; d[i + 1] = 24; d[i + 2] = 40; }
      d[i + 3] = Math.round(a * 255);
    }
    g.putImageData(im, 0, 0);
    return cv;
  } catch { return img; }
}
// → { tex, aspect (width / height of the sticker with its nose to the right), rect: [u0, v0, u1, v1], label: rect | null }
// px: the texture's size (drawn at 512, then scaled: the phone's game view uses 256 so 16 cached ships stay ~6 MB of GPU).
function makeSticker(img, color, noseDir, label, px = 512) {
  const W = 512, Hc = 512, cv = mkCanvas(W, Hc), g = cv.getContext("2d");
  const hasImg = !!img && !!(img.naturalWidth || img.width);
  let aspect = 1.5, rect = null, lrect = null;
  const stH = label ? 376 : 512;
  if (hasImg) {
    const iw = img.naturalWidth || img.videoWidth || img.width, ih = img.naturalHeight || img.videoHeight || img.height;
    const [x0, y0, x1, y1] = inkBox(img, iw, ih), bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    const turned = noseDir === "up" || noseDir === "down";
    aspect = clamp(turned ? bh / bw : bw / bh, 0.7, 2.6);
    const pad = 30, sw = aspect >= W / stH ? W : stH * aspect, sh = sw / aspect;
    const ox = (W - sw) / 2, oy = 0;
    // v1.6: no paper card and no rim any more: only the INK, on transparent paper (the decal shader discards alpha < 0.5),
    // so the drawing reads as lines painted on the hull, not as a pink label stuck on it.
    const iwid = sw - 2 * pad, ihei = sh - 2 * pad;
    const dw = turned ? ihei : iwid, dh = turned ? iwid : ihei, k = Math.min(dw / bw, dh / bh);
    const ink = inkLayer(img, x0, y0, bw, bh, Math.max(1, Math.round(bw * k)), Math.max(1, Math.round(bh * k)));
    g.save();
    g.translate(ox + sw / 2, oy + sh / 2);
    if (noseDir === "left") g.scale(-1, 1);
    else if (noseDir === "up") g.rotate(Math.PI / 2);
    else if (noseDir === "down") g.rotate(-Math.PI / 2);
    // the ink drawn a few times with small offsets: thicker lines read at game distance
    const th = Math.max(1.5, Math.min(dw, dh) / 110);
    try { for (const [ox2, oy2] of [[0, 0], [th, 0], [-th, 0], [0, th], [0, -th], [th * 0.7, th * 0.7], [-th * 0.7, -th * 0.7], [th * 0.7, -th * 0.7], [-th * 0.7, th * 0.7]]) g.drawImage(ink, -bw * k / 2 + ox2, -bh * k / 2 + oy2, bw * k, bh * k); } catch { /* an undecodable image: a blank sticker */ }
    g.restore();
    rect = [ox / W, oy / Hc, (ox + sw) / W, (oy + sh) / Hc];
  }
  if (label) {
    g.font = "900 96px 'Arial Black', Impact, 'Helvetica Neue', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    const tw = Math.min(W - 20, g.measureText(label).width + 30), y = stH + (Hc - stH) / 2;
    g.lineJoin = "round"; g.lineWidth = 18; g.strokeStyle = "#1b1d26";
    g.save(); g.translate(W / 2, y); const sx = Math.min(1, (W - 30) / tw); g.scale(sx, 1);
    g.strokeText(label, 0, 4); g.fillStyle = "#ffffff"; g.fillText(label, 0, 4); g.restore();
    lrect = [(W - tw * Math.min(1, (W - 30) / tw)) / 2 / W, stH / Hc, 1 - (W - tw * Math.min(1, (W - 30) / tw)) / 2 / W, 1, tw / (Hc - stH)];
  }
  if (!rect && !lrect) return null;
  let out = cv;
  if (px < W) {
    out = mkCanvas(px, px);
    const og = out.getContext("2d");
    og.imageSmoothingQuality = "high";
    og.drawImage(cv, 0, 0, px, px);
  }
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 4; tex.name = "ship3d_sticker";
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { tex, aspect, rect, label: lrect };
}

// ---- Materials -----------------------------------------------------------------------------------------------------

function bodyMaterial(map, color, { rough = null, normal = null, decal = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map, vertexColors: !decal, roughness: decal ? 0.95 : 1, roughnessMap: decal ? null : rough, metalness: 0,
    emissive: new THREE.Color(SELF, SELF, SELF).multiplyScalar(decal ? 0.5 : 1), emissiveIntensity: 1,
  });
  if (normal && !decal) { mat.normalMap = normal; mat.normalScale.set(0.7, 0.7); }
  if (decal) { mat.color.setScalar(0.74); mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -4; } // a matte sticker under the TV bloom
  const rim = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35);
  const rimK = { value: 1 }; // material.userData.rimK.value: 0 switches the rim off (a charred wreck), as inflate.js
  mat.userData.rimK = rimK;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uRimK = rimK;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uRim;\nuniform float uRimK;")
      .replace("#include <map_fragment>", "#include <map_fragment>\n#ifdef USE_MAP\n  if (sampledDiffuseColor.a < 0.5) discard;\n  diffuseColor.a = opacity;\n#endif")
      .replace("#include <emissivemap_fragment>",
        "totalEmissiveRadiance *= diffuseColor.rgb;\n  float rimF = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);\n  totalEmissiveRadiance += uRim * rimF * 0.38 * uRimK;");
  };
  mat.customProgramCacheKey = () => "ship3d-body";
  return mat;
}

function fxMaterial(map) {
  // Additive light that never writes alpha: on the phone's transparent result-card canvas an additive quad would otherwise
  // leave its dark texels as an opaque black square (alpha accumulates); in the game scenes it is plain additive.
  const mat = new THREE.MeshBasicMaterial({ map, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  mat.forceSinglePass = true; // one draw call (a transparent double-sided material is otherwise drawn twice)
  const U = { uLen: { value: 1 }, uWid: { value: 1 }, uPow: { value: 1 } };
  mat.userData.fx = U;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 fx;\nuniform float uLen;\nuniform float uWid;\nuniform float uPow;\nvarying float vK;")
      .replace("#include <begin_vertex>", `vec3 transformed = vec3(position);
  vK = 1.0;
  // v1.6: seen from behind (the phone's chase camera), the exhaust points at the camera: a shorter, narrower, dimmer flame and
  // a smaller glow, so they never hide the hull. bh = 0 from the side or the front, 1 straight from behind.
  vec3 fxAxV = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  vec3 fxToCam = normalize(-(modelViewMatrix * vec4(fx.xyz, 1.0)).xyz);
  float bh = smoothstep(0.3, 0.9, dot(fxAxV, fxToCam));
  if (fx.w > 0.5 && fx.w < 1.5) { transformed.z = fx.z + (position.z - fx.z) * uLen * (1.0 - 0.6 * bh); transformed.xy = fx.xy + (position.xy - fx.xy) * uWid * (1.0 - 0.35 * bh); vK = uPow * (1.0 - 0.45 * bh); }
  else if (fx.w > 1.5 && fx.w < 2.5) { vK = uPow * (1.0 - 0.45 * bh); }
  else if (fx.w > 3.5) { vK = uPow * (1.0 - 0.5 * bh); }`)
      .replace("#include <project_vertex>", `vec4 mvPosition;
  if (fx.w > 1.5 && fx.w < 3.5) {
    float sc = length(modelViewMatrix[0].xyz);
    float grow = fx.w < 2.5 ? (0.55 + 0.45 * min(uPow, 1.6)) * (1.0 - 0.45 * bh) : 1.0;
    mvPosition = modelViewMatrix * vec4(fx.xyz, 1.0);
    mvPosition.xy += position.xy * sc * grow;
  } else {
    mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  }
  gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vK;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb *= vK;");
  };
  mat.customProgramCacheKey = () => "ship3d-fx";
  return mat;
}

// ---- FX primitives (draw 3) ----------------------------------------------------------------------------------------

// A camera-facing glow dot: type 2 follows the engine power, type 3 is constant.
function glow(F, c, size, col, type = 3) {
  F.fxv = [c[0], c[1], c[2], type];
  const b = F.count, n = [0, 0, 1];
  F.v([-size, -size, 0], n, ruv(REG.glow, 0, 0), col); F.v([size, -size, 0], n, ruv(REG.glow, 1, 0), col);
  F.v([size, size, 0], n, ruv(REG.glow, 1, 1), col); F.v([-size, size, 0], n, ruv(REG.glow, 0, 1), col);
  F.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
}
// A flame from the nozzle exit o (towards +Z): three crossed soft quads, white-yellow core → orange → tip colour.
function flame(F, o, r, length, tip) {
  F.fxv = [o[0], o[1], o[2], 1];
  const cols = [[1.55, 1.2, 0.72], [1.45, 0.6, 0.16], tip]; // v1.6: a less white core (bright, not blown out)
  for (let k = 0; k < 3; k++) {
    const a = Math.PI * k / 3, d = [Math.cos(a), Math.sin(a), 0], b = F.count, n = [0, 0, 1];
    for (let i = 0; i < 3; i++) {
      const s = [0, 0.4, 1][i], z = o[2] - 0.04 + length * s;
      for (const q of [-1, 1]) F.v([o[0] + d[0] * r * q, o[1] + d[1] * r * q, z], n, ruv(REG.flame, s, (q + 1) / 2), cols[i]);
    }
    for (let i = 0; i < 2; i++) { const a0 = b + i * 2; F.i.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2); }
  }
}
// A flat disc facing dir (type 4: brightness follows the engine power; 0: constant).
function disc(F, c, dir, r, col, seg, type = 4) {
  F.fxv = [c[0], c[1], c[2], type];
  const fr = frame(c, dir), rr = cross(fr.u, fr.f), b = F.count;
  F.v(c, fr.f, ruv(REG.glow, 0.5, 0.5), col);
  for (let j = 0; j <= seg; j++) { const a = 2 * Math.PI * j / seg; F.v(add(c, add(scl(rr, Math.cos(a) * r), scl(fr.u, Math.sin(a) * r))), fr.f, ruv(REG.glow, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)), col); }
  for (let j = 0; j < seg; j++) F.i.push(b, b + 1 + j, b + 2 + j);
}

// ---- Assembly ------------------------------------------------------------------------------------------------------

// fl (v1.6, 0.5..1): how far the parts' minimum segment counts may give way (1 = not at all; buildShip lowers it only when the
// detail d alone cannot bring a busy ship inside its budget). A minimum of 3 or less never changes.
function assemble(spec, color, d, sticker, fl = 1) {
  const L = SHIP_LENGTH;
  const Bd = new Buf(), Dc = new Buf(), F = new Buf(true);
  const col = palette(spec, color);
  const hull = makeHull(spec, L);
  const R = rng(spec.seed || 1);
  const sg = (n, min = 6) => Math.max(min <= 3 || fl >= 1 ? min : Math.max(3, Math.round(min * fl)), Math.round(n * d));
  const S = {}; // sockets
  const flat = REG.flat, metal = REG.metal, trim = REG.trim, glass = REG.glass;
  hull.build(Bd, d, col);
  const zAt = (t) => hull.z(clamp(t, 0, 1));
  const sec = (t) => hull.sec(clamp(t, 0, 1));
  const saucer = hull.saucer;

  // Racing stripe along the top (cutout, accent colour): the chase camera sees it.
  if (!saucer) {
    const t0 = hull.nose === "pointed" ? 0.1 : 0.04, t1 = 0.97, z0 = zAt(t0), z1 = zAt(t1);
    const w = Math.min(sec(0.5).a * 0.5, 0.2);
    patch(Bd, hull, "top", (z0 + z1) / 2, 0, z1 - z0, w * 2, sg(16), 2, (i, j) => ruv(REG.racing, i, j), scl(col.accent, 0.72), 0.006);
  } else {
    // a ring of rim lights
    const n = 10;
    for (let k = 0; k < n; k++) { const a = 2 * Math.PI * (k + 0.5) / n, rr = hull.R * 1.0; glow(F, [Math.cos(a) * rr, 0, Math.sin(a) * rr], 0.13, k % 2 ? scl(col.player, 1.6) : [1.6, 1.3, 0.5]); }
  }

  // ---- Cockpit
  const ck = spec.cockpit;
  let seat = null;
  if (saucer) {
    const r = clamp(ck.size * L * 0.9, hull.R * 0.32, hull.R * 0.55), hgt = Math.max(r * 0.8, 0.3);
    if (ck.kind !== "none") {
      const rows = [], k = sg(8, 5), y0 = hull.top(r * 0.9, 0) - 0.04;
      for (let i = 0; i <= k; i++) { const a = Math.PI / 2 * i / k; rows.push({ t: y0 + Math.sin(a) * hgt, a: Math.cos(a) * r, b: Math.cos(a) * r, v: i / k }); }
      rings(Bd, rows, sg(24, 12), frame([0, 0, 0], [0, 1, 0], [0, 0, -1]), glass, col.glass);
      rings(Bd, [{ t: y0 - 0.02, a: r * 1.08, b: r * 1.08 }, { t: y0 + 0.05, a: r * 1.1, b: r * 1.1 }, { t: y0 + 0.07, a: r * 1.0, b: r * 1.0 }, { t: y0 + 0.07, a: r * 0.9, b: r * 0.9 }],
        sg(24, 12), frame([0, 0, 0], [0, 1, 0], [0, 0, -1]), trim, col.white);
      seat = [0, y0 + hgt * 0.5, 0];
      glow(F, [-r * 0.35, y0 + hgt * 0.75, -r * 0.45], 0.1, [1.2, 1.2, 1.2]);
    } else seat = [0, hull.top(0, 0), 0];
  } else if (ck.kind !== "none") {
    const at = clamp(ck.at, 0.1, 0.8), zc = zAt(at), s = sec(at), cl = clamp(ck.size * L, 0.35, L * 0.4);
    if (ck.kind === "bubble" || ck.kind === "canopy") {
      const long = ck.kind === "canopy", rows = [], k = sg(12, 7);
      const halfW = Math.min(s.a * 0.72, long ? cl * 0.3 : cl * 0.45), hgt = Math.max(long ? halfW * 0.85 : halfW * 1.0, 0.16);
      const zf = zc - cl * (long ? 0.45 : 0.4), zb = zc + cl * (long ? 0.55 : 0.4);
      for (let i = 0; i <= k; i++) {
        const q = i / k, z = lerp(zf, zb, q), prof = long ? Math.sin(Math.PI * Math.min(1, q * 1.6 / (q < 0.62 ? 1 : 1)) ** 0.8) : Math.sin(Math.PI * q);
        const pr = long ? (q < 0.4 ? Math.sin(Math.PI / 2 * q / 0.4) : Math.cos(Math.PI / 2 * (q - 0.4) / 0.6) ** 0.7) : Math.sqrt(Math.max(0, prof));
        const base = hull.top(0, z) - hgt * 0.35;
        rows.push({ t: z, a: Math.max(1e-6, halfW * pr), b: Math.max(1e-6, (hgt * 1.35) * pr), y: base, v: q, n: 2.2 });
      }
      rows[0].a = rows[0].b = 0; rows[k].a = rows[k].b = 0;
      rings(Bd, rows, sg(20, 10), frame([0, 0, 0], [0, 0, 1], [0, 1, 0]), glass, col.glass, { th0: 0, th1: Math.PI });
      // the frame: a dark rim where the glass meets the hull
      const fr = [];
      for (let i = 0; i <= k; i++) { const r0 = rows[i]; fr.push({ t: r0.t, a: r0.a * 1.06 + 0.012, b: Math.min(r0.b, hgt * 0.5) * 0.7 + 0.01, y: r0.y, v: i / k }); }
      fr[0].a = fr[0].b = fr[k].a = fr[k].b = 0;
      rings(Bd, fr, sg(14, 8), frame([0, 0, 0], [0, 0, 1], [0, 1, 0]), trim, col.white, { th0: 0, th1: Math.PI });
      seat = [0, hull.top(0, zc) + hgt * 0.3, zc];
      glow(F, [halfW * 0.4, hull.top(0, zc - cl * 0.1) + hgt * 0.75, zc - cl * 0.15], 0.07, [1.0, 1.0, 1.0]);
    } else if (ck.kind === "visor") {
      const t0 = clamp(at - ck.size / 2, 0.03, 0.9), t1 = clamp(at + ck.size / 2, t0 + 0.05, 0.95), rows = [], k = sg(8, 5);
      for (let i = 0; i <= k; i++) { const t = lerp(t0, t1, i / k), s2 = sec(t); rows.push({ t: zAt(t), a: s2.a + 0.02, b: s2.b + 0.02, y: s2.yc, n: s2.n, nb: s2.nb, v: i / k }); }
      rings(Bd, rows, sg(16, 8), frame([0, 0, 0], [0, 0, 1], [0, 1, 0]), glass, col.glass, { th0: 0.3, th1: Math.PI - 0.3 });
      seat = [0, hull.top(0, zc), zc];
    } else if (ck.kind === "windows") {
      seat = [0, hull.top(0, zc), zc];
    }
  } else seat = [0, hull.top(0, zAt(0.3)), zAt(0.3)];
  S.seat = seat;
  const portholes = (n, tc, spread, ySide) => {
    for (let k = 0; k < n; k++) {
      const z = saucer ? lerp(-hull.R * 0.5, hull.R * 0.5, n > 1 ? k / (n - 1) : 0.5) : zAt(tc) + (n > 1 ? (k / (n - 1) - 0.5) * spread : 0);
      for (const sgn of [1, -1]) {
        const s = saucer ? null : hull.sec(hull.t(z)), y = saucer ? hull.ht * 0.05 : s.yc + s.b * ySide;
        const x = sgn * hull.side(z, y), p = [x, y, z];
        const e = 0.01, n0 = nrm(cross(sub([sgn * hull.side(z + e, y), y, z + e], [sgn * hull.side(z - e, y), y, z - e]), sub([sgn * hull.side(z, y + e), y + e, z], [sgn * hull.side(z, y - e), y - e, z])));
        const nn = n0[0] * sgn < 0 ? scl(n0, -1) : n0;
        const r = saucer ? Math.min(0.13, hull.ht * 0.4) : clamp(s.b * 0.32, 0.07, 0.15);
        const fr = frame(p, nn);
        rings(Bd, [{ t: -0.04, a: r * 1.2, b: r * 1.2 }, { t: 0.02, a: r * 1.3, b: r * 1.3 }, { t: 0.035, a: r * 1.05, b: r * 1.05 }, { t: 0.03, a: r * 0.92, b: r * 0.92 }], sg(12, 8), fr, trim, col.white);
        rings(Bd, [{ t: 0.03, a: r * 0.92, b: r * 0.92 }, { t: 0.04, a: r * 0.6, b: r * 0.6 }, { t: 0.044, a: 0, b: 0 }], sg(12, 8), fr, glass, col.glass, { u0: 0.1, u1: 0.4 });
      }
    }
  };
  const winN = spec.extras.filter((x) => x.kind === "window").length;
  const sidePorts = ck.kind === "windows" || winN > 0;
  let portsDone = false;
  if (ck.kind === "windows") { portsDone = true; portholes(clamp(Math.max(3, winN), 3, 4), clamp(ck.at, 0.15, 0.8), clamp(ck.size * L, 0.6, 1.2), 0.45); }

  // ---- Wings
  const wg = spec.wings, wingInfo = [];
  const addWingPair = (at, span, chord, shape, mount, scale, roll, colW) => {
    const zc = zAt(at), s = sec(at);
    const ky = { low: -0.5, mid: 0, high: 0.5 }[mount] ?? 0, y = saucer ? 0 : s.yc + s.b * ky;
    const x0 = Math.max(0.02, (saucer ? hull.side(zc, 0) : hull.side(zc, y)) * 0.7);
    const semi = Math.max(span * L * scale / 2 - x0, 0.55 * scale), c = Math.max(chord, 0.26) * L * scale;
    let poly;
    const le = -c / 2;
    if (shape === "delta") poly = [[0, le], [semi, le + c * 0.86], [semi, le + c * 1.0], [0, c / 2]];
    else if (shape === "swept") poly = [[0, le], [semi, le + c * 0.62], [semi, le + c * 1.05], [0, c / 2]];
    else if (shape === "straight") poly = [[0, le], [semi, le + c * 0.08], [semi, le + c * 0.82], [0, c / 2]];
    else if (shape === "forward") poly = [[0, le + c * 0.1], [semi, le - c * 0.3], [semi, le + c * 0.25], [0, c / 2]];
    else { poly = []; for (let k = 0; k <= 6; k++) { const a = Math.PI * k / 6; poly.push([Math.sin(a) * semi, -Math.cos(a) * c / 2]); } }
    const thR = clamp(0.035 * L * Math.sqrt(scale), 0.05, 0.1), thT = thR * 0.5;
    const th = (sv) => lerp(thR, thT, clamp(sv / semi, 0, 1));
    for (const sgn of [1, -1]) {
      const dh = (roll ?? 0.1) * sgn;
      const Sd = [sgn * Math.cos(roll ?? 0.1), Math.sin(Math.abs(roll ?? 0.1)) * (roll < 0 ? -1 : 1), 0];
      const Nn = nrm(cross([0, 0, 1], Sd)), Nup = Nn[1] < 0 ? scl(Nn, -1) : Nn;
      const fr = { o: [sgn * x0, y, zc], s: Sd, c: [0, 0, 1], n: Nup };
      slab(Bd, poly, fr, th, REG.panels, colW, shade(colW, 0.55), shade(colW, 0.8), sg(3, 2));
      // a stripe across the chord near the tip, top and bottom (player colour / accent)
      const s1 = semi * 0.62, s2 = semi * 0.8, ch = (sv) => chordAt(poly, sv);
      const [a1, b1] = ch(s1), [a2, b2] = ch(s2);
      for (const side of [1, -1]) {
        const P = (sv, cv) => madd(madd(madd(fr.o, Sd, sv), [0, 0, 1], cv), Nup, side * (th(sv) + 0.006));
        const bq = Bd.count, nn = scl(Nup, side), stc = col.isPlayer ? col.accent : col.player;
        Bd.v(P(s1, a1), nn, ruv(REG.racing, 0, 0), stc); Bd.v(P(s1, b1), nn, ruv(REG.racing, 1, 0), stc);
        Bd.v(P(s2, b2), nn, ruv(REG.racing, 1, 1), stc); Bd.v(P(s2, a2), nn, ruv(REG.racing, 0, 1), stc);
        Bd.tri(bq, bq + 1, bq + 2); Bd.tri(bq, bq + 2, bq + 3);
      }
      const tipC = ch(semi * 0.97);
      wingInfo.push({ sgn, tip: madd(madd(fr.o, Sd, semi), [0, 0, 1], (tipC[0] + tipC[1]) / 2), mid: madd(madd(fr.o, Sd, semi * 0.5), [0, 0, 1], (ch(semi * 0.5)[0] + ch(semi * 0.5)[1]) / 2), th: th(semi * 0.5), y, under: (sv) => madd(madd(fr.o, Sd, sv), Nup, -th(sv)), z: zc, scale });
      dh;
    }
  };
  if (wg.count > 0 && !saucer) {
    const xWing = wg.count === 4 && (hull.shape === "rocket" || hull.shape === "box" || hull.shape === "capsule");
    if (xWing) { addWingPair(wg.at, wg.span, wg.chord, wg.shape, "mid", 1, 0.62, col.second); addWingPair(wg.at, wg.span, wg.chord, wg.shape, "mid", 1, -0.62, col.second); }
    else {
      addWingPair(wg.at, wg.span, wg.chord, wg.shape, wg.mount, 1, 0.1, col.second);
      if (wg.count === 4) addWingPair(clamp(wg.at - 0.36, 0.12, 0.8), wg.span * 0.85, wg.chord * 0.85, wg.shape, wg.mount, 0.55, 0.06, col.second);
    }
  } else if (wg.count > 0 && saucer) {
    // a saucer's "wings": two stubby side plates on the rim
    for (const sgn of [1, -1]) {
      const fr = { o: [sgn * hull.R * 0.85, 0, 0], s: [sgn, 0, 0], c: [0, 0, 1], n: [0, 1, 0] };
      slab(Bd, [[0, -0.35], [0.45, 0.05], [0.45, 0.3], [0, 0.4]], fr, () => 0.06, REG.panels, col.second, shade(col.second, 0.55), shade(col.second, 0.8), 2);
      wingInfo.push({ sgn, tip: [sgn * (hull.R * 0.85 + 0.45), 0, 0.15], mid: [sgn * (hull.R * 0.85 + 0.22), 0, 0], th: 0.06, y: 0, under: (sv) => [sgn * (hull.R * 0.85 + sv), -0.06, 0], z: 0, scale: 1 });
    }
  }
  const tipR = wingInfo.find((w) => w.sgn > 0 && w.scale === 1), tipL = wingInfo.find((w) => w.sgn < 0 && w.scale === 1);
  {
    const zc = zAt(0.55), s = sec(0.55);
    S.wing_r = tipR ? tipR.tip : [hull.side(zc, s.yc) + 0.05, s.yc, zc];
    S.wing_l = tipL ? tipL.tip : [-(hull.side(zc, s.yc) + 0.05), s.yc, zc];
  }

  // ---- Fins
  for (const fin of spec.fins) {
    const at = clamp(fin.at, 0.45, 0.97), zc = zAt(at), s = sec(at), colF = fin.color ? C(fin.color) : col.second;
    const size = clamp(fin.size, 0.08, 0.5) * L, rc = clamp(size * 1.1, 0.35, L * 0.45), hgt = clamp(size * 0.95, 0.3, L * 0.38);
    const zcc = Math.min(zc, hull.z1 - rc * 0.45);
    const polyV = [[0, -rc / 2], [hgt, -rc / 2 + rc * 0.62], [hgt, -rc / 2 + rc * 0.98], [0, rc / 2]];
    const th = (sv) => lerp(0.05, 0.028, clamp(sv / hgt, 0, 1));
    if (fin.kind === "tail" || fin.kind === "belly") {
      const up = fin.kind === "tail" ? 1 : -1, y0 = up > 0 ? hull.top(0, zcc) - 0.05 : hull.bot(0, zcc) + 0.05;
      const hgt2 = up > 0 ? hgt : hgt * 0.6, poly = polyV.map(([a, b]) => [a * hgt2 / hgt, b]);
      const fr = { o: [0, y0, zcc], s: [0, up, 0], c: [0, 0, 1], n: [1, 0, 0] };
      slab(Bd, poly, fr, (sv) => lerp(0.05, 0.028, clamp(sv / hgt2, 0, 1)), REG.panels, colF, shade(colF, 0.55), colF, sg(3, 2));
      const [a1, b1] = chordAt(poly, hgt2 * 0.7), [a2, b2] = chordAt(poly, hgt2 * 0.86);
      for (const side of [1, -1]) {
        const P = (sv, cv) => [side * (th(sv) + 0.006), y0 + up * sv, zcc + cv], b = Bd.count, nn = [side, 0, 0], stc = col.isPlayer ? col.accent : col.player;
        Bd.v(P(hgt2 * 0.7, a1), nn, ruv(REG.racing, 0, 0), stc); Bd.v(P(hgt2 * 0.7, b1), nn, ruv(REG.racing, 1, 0), stc);
        Bd.v(P(hgt2 * 0.86, b2), nn, ruv(REG.racing, 1, 1), stc); Bd.v(P(hgt2 * 0.86, a2), nn, ruv(REG.racing, 0, 1), stc);
        Bd.tri(b, b + 1, b + 2); Bd.tri(b, b + 2, b + 3);
      }
      if (up > 0) S.back = [0, y0 + hgt2 * 0.5, zcc];
    } else {
      for (const sgn of [1, -1]) {
        const x0 = hull.side(zcc, s.yc) * 0.7, a = 0.55, Sd = [sgn * Math.cos(a), Math.sin(a), 0];
        const Nn = nrm(cross([0, 0, 1], Sd)), Nup = Nn[1] < 0 ? scl(Nn, -1) : Nn;
        slab(Bd, polyV.map(([p, q]) => [p * 0.7, q]), { o: [sgn * x0, s.yc, zcc], s: Sd, c: [0, 0, 1], n: Nup }, (sv) => lerp(0.045, 0.025, clamp(sv / (hgt * 0.7), 0, 1)), REG.panels, colF, shade(colF, 0.55), shade(colF, 0.8), sg(3, 2));
      }
    }
  }

  // ---- Engines
  const en = spec.engines, nozzles = [];
  {
    let count = en.count, layout = en.layout;
    const tailT = saucer ? 1 : 0.985, zt = saucer ? hull.R * 0.82 : hull.z1, st = sec(saucer ? 0.5 : 0.97);
    let small = false;
    if (count === 0 && !saucer) { count = 1; layout = "single"; small = true; }
    if (count === 2 && layout === "single") layout = "pair";
    if (count >= 3 && (layout === "single" || layout === "pair")) layout = "row";
    if (layout === "pods" && !wingInfo.length) layout = count >= 2 ? "pair" : "single";
    const rMax = saucer ? 0.28 : Math.max(0.1, Math.min(st.a, st.b) * 0.92);
    let rH = clamp(en.size * L * 0.5, 0.12, 0.42) * (small ? 0.6 : 1);
    const spots = [];
    if (layout === "pods") {
      const pods = wingInfo.filter((w) => w.scale === 1);
      for (const w of pods) {
        const p = add(w.under(0.75 * len(sub(w.tip, add(w.under(0), [0, 0, 0]))) || 0.4), [0, -0.02, 0]);
        const r = clamp(rH * 0.8, 0.1, 0.22), pl = clamp(r * 6, 0.6, 1.1), pc = [w.tip[0] * 0.78, w.y - w.th - r * 0.6, w.z + 0.05];
        p;
        rings(Bd, [{ t: -pl / 2, a: 0, b: 0 }, { t: -pl / 2 + r * 0.6, a: r * 0.8, b: r * 0.8 }, { t: -pl / 2 + r * 1.6, a: r, b: r }, { t: pl / 2, a: r, b: r }], sg(14, 8), frame([pc[0], pc[1], pc[2]], [0, 0, 1], [0, 1, 0]), REG.panels, col.main);
        spots.push({ p: [pc[0], pc[1], pc[2] + pl / 2], r: r * 0.95 });
      }
    } else {
      rH = Math.min(rH, layout === "single" ? rMax : layout === "row" ? Math.max(0.09, st.a * 1.8 / (count * 2.1)) : Math.max(0.1, Math.min(st.a, st.b) * 0.55));
      const yc = saucer ? 0 : st.yc;
      if (layout === "single") spots.push({ p: [0, yc, zt], r: rH });
      else if (layout === "pair") for (const sx of [-1, 1]) spots.push({ p: [sx * Math.min(st.a * 0.52, rH * 1.15 + 0.02), yc, zt], r: rH });
      else if (layout === "stack") for (const sy of [1, -1]) spots.push({ p: [0, yc + sy * Math.min(st.b * 0.5, rH * 1.1), zt], r: rH });
      else { const n = clamp(count, 3, 4), wdt = Math.min(st.a * 0.9, rH * 1.1 * (n - 1)); for (let k = 0; k < n; k++) spots.push({ p: [lerp(-wdt, wdt, k / (n - 1)), yc, zt], r: rH }); }
      if (saucer) for (const sp of spots) { sp.p[2] = Math.sqrt(Math.max(0, hull.R * hull.R * 0.8 - sp.p[0] * sp.p[0])); }
    }
    tailT;
    const tip = col.flameTip || mix(col.player, [1, 0.45, 0.1], 0.35);
    for (const sp of spots) {
      const r = sp.r, ln = r * 1.15, z0 = sp.p[2] - r * 0.5, rb = r * 1.22, o = [sp.p[0], sp.p[1], z0];
      const rows = [
        { t: 0, a: r * 0.85, b: r * 0.85, v: 0.02 }, { t: r * 0.5, a: r, b: r, v: 0.12 }, { t: r * 0.5 + ln * 0.3, a: r * 1.02, b: r * 1.02, v: 0.26 },
        { t: r * 0.5 + ln * 0.36, a: r * 0.93, b: r * 0.93, v: 0.33 }, { t: r * 0.5 + ln * 0.44, a: r * 0.96, b: r * 0.96, v: 0.4 },
        { t: r * 0.5 + ln, a: rb, b: rb, v: 0.6 }, { t: r * 0.5 + ln + 0.025, a: rb * 1.03, b: rb * 1.03, v: 0.66 },
        { t: r * 0.5 + ln + 0.01, a: rb * 0.86, b: rb * 0.86, v: 0.74 }, { t: r * 0.5 + ln * 0.45, a: r * 0.62, b: r * 0.62, v: 0.9 }, { t: r * 0.5 + ln * 0.45, a: 0, b: 0, v: 1 },
      ];
      rings(Bd, rows, sg(18, 10), frame(o, [0, 0, 1], [0, 1, 0]), REG.nozzle, col.white);
      const exit = [sp.p[0], sp.p[1], z0 + r * 0.5 + ln + 0.02];
      nozzles.push({ p: exit, r: rb });
      // Softer than a lamp: the chase camera sits right behind the nozzle, and render.js adds its own engine glow + trail there.
      disc(F, [exit[0], exit[1], z0 + r * 0.5 + ln * 0.47], [0, 0, 1], r * 0.62, [0.95, 0.6, 0.34], sg(12, 8), 4);
      glow(F, exit, rb * 1.15, en.flame ? [0.62, 0.34, 0.15] : scl(col.player, 0.6), 2); // v1.6: smaller, less white
      if (en.flame) flame(F, [exit[0], exit[1], exit[2] - 0.05], rb * 0.95, rb * 5.2, tip);
    }
    if (nozzles.length) {
      const l = nozzles.reduce((a, b) => (b.p[0] < a.p[0] ? b : a)), r = nozzles.reduce((a, b) => (b.p[0] > a.p[0] ? b : a));
      S.engine_l = l === r ? add(l.p, [-Math.min(0.15, l.r * 0.5), 0, 0]) : l.p;
      S.engine_r = l === r ? add(r.p, [Math.min(0.15, r.r * 0.5), 0, 0]) : r.p;
    } else { S.engine_l = [-0.15, 0, hull.z1]; S.engine_r = [0.15, 0, hull.z1]; }
  }

  // ---- Weapons
  let muzzle = null;
  for (const w of spec.weapons) {
    const kind = ["cannon", "laser", "missile", "drill", "saw", "bomb"].includes(w.kind) ? w.kind : "cannon";
    const lw = clamp(w.size, 0.1, 0.5) * L, at = clamp(w.at, 0.05, 0.9);
    const colW = w.color ? C(w.color) : null;
    if (kind === "drill" || kind === "saw") {
      const zt = saucer ? -hull.R : hull.z0, s0 = sec(saucer ? 0.5 : 0.06);
      const yc = saucer ? 0 : sec(0.02).yc;
      if (kind === "drill") {
        const r = clamp(lw * 0.26, 0.12, 0.3), l = clamp(lw, 0.4, 1.0), zb = zt + (saucer ? 0.1 : 0.06);
        cyl(Bd, [0, yc, zb + 0.12], [0, yc, zb - 0.1], r * 1.05, r * 1.12, sg(16, 10), trim, col.white);
        const rows = [], k = sg(8, 5);
        for (let i = 0; i <= k; i++) { const q = i / k; rows.push({ t: q * l, a: r * (1 - q) ** 1.05, b: r * (1 - q) ** 1.05, v: q }); }
        rows.unshift({ t: 0, a: 0, b: 0, v: 0 });
        rings(Bd, rows, sg(16, 10), frame([0, yc, zb - 0.1], [0, 0, -1], [0, 1, 0]), REG.hazard, colW || col.white);
        muzzle = muzzle || [0, yc, zb - 0.1 - l];
      } else {
        const r = clamp(lw * 0.5, 0.25, 0.5), c = [0, yc, zt - r * 0.55], teeth = 14, poly = [];
        for (let k = 0; k < teeth * 2; k++) { const a = Math.PI * 2 * k / (teeth * 2), rr = k % 2 ? r * 0.82 : r; poly.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
        slab(Bd, poly, { o: c, s: [0, 1, 0], c: [0, 0, 1], n: [1, 0, 0] }, () => 0.025, metal, colW || col.metal, col.metal, colW || col.metal, 1);
        cyl(Bd, [-0.07, c[1], c[2]], [0.07, c[1], c[2]], r * 0.28, r * 0.28, sg(12, 8), flat, col.red);
        rbox(Bd, [0, yc, zt + 0.02], [0, 0, -1], r * 0.9, 0.05, 0.08, 8, trim, col.white);
        muzzle = muzzle || [0, yc, c[2] - r];
      }
      continue;
    }
    if (kind === "bomb") {
      const r = clamp(lw * 0.32, 0.12, 0.28), zc = zAt(at), yb = saucer ? hull.bot(0, 0) : hull.bot(0, zc);
      const xs = w.count === 2 ? [-0.3, 0.3] : [0];
      for (const x of xs) {
        const c = [x, yb - r * 1.15, zc];
        rbox(Bd, [x, yb - r * 0.3, zc], [0, 0, 1], r * 1.2, 0.04, r * 0.45, 8, trim, col.white);
        sphere(Bd, c, r, sg(14, 8), flat, colW || col.dark);
        cyl(Bd, add(c, [0, r * 0.2, r * 0.85]), add(c, [0, r * 0.4, r * 1.35]), 0.025, 0.02, 6, flat, col.metal);
        glow(F, add(c, [0, r * 0.42, r * 1.4]), 0.09, [1.8, 0.9, 0.2], 3);
      }
      continue;
    }
    // barrel weapons: cannon, laser, missile
    const zc = zAt(at), cnt = w.count;
    let mount = ["nose", "top", "belly", "wings", "sides"].includes(w.mount) ? w.mount : "belly";
    if (mount === "wings" && !wingInfo.length) mount = "sides";
    const hh = kind === "laser" ? 0.07 : kind === "missile" ? clamp(lw * 0.09, 0.07, 0.12) : clamp(lw * 0.12, 0.08, 0.15);
    const spots = [];
    if (mount === "wings") { for (const wi of wingInfo.filter((q) => q.scale === 1)) { const p = wi.under(len(sub(wi.tip, wi.under(0))) * 0.45); spots.push([p[0], p[1] - hh * 0.9, wi.z - 0.05]); } }
    else if (mount === "sides") { const s = sec(at); for (const sx of [1, -1]) spots.push([sx * (hull.side(zc, s.yc) + hh * 0.7), s.yc, zc]); }
    else {
      const t2 = mount === "nose" ? clamp(at, 0.12, 0.3) : at, z2 = zAt(t2), s = sec(t2);
      const xs = cnt === 2 ? [-Math.max(s.a * 0.45, 0.14), Math.max(s.a * 0.45, 0.14)] : [0];
      for (const x of xs) spots.push([x, mount === "top" ? hull.top(x, z2) + hh * 0.75 : hull.bot(x, z2) - hh * 0.75, z2]);
    }
    for (const p of spots) {
      if (kind === "missile") {
        const r = hh, l = clamp(lw, 0.45, 1.1), zf = p[2] - l / 2;
        rings(Bd, [{ t: 0, a: 0, b: 0, v: 0, c: col.red }, { t: r * 0.6, a: r * 0.7, b: r * 0.7, v: 0.1, c: col.red }, { t: r * 1.6, a: r, b: r, v: 0.2, c: col.red }, { t: r * 1.65, a: r, b: r, v: 0.25 }, { t: l, a: r * 0.9, b: r * 0.9, v: 1 }, { t: l, a: 0, b: 0, v: 1 }],
          sg(12, 8), frame([p[0], p[1], zf], [0, 0, 1], [0, 1, 0]), metal, colW || col.white);
        for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2, Sd = [Math.cos(a), Math.sin(a), 0]; slab(Bd, [[0, -r * 1.2], [r * 1.3, 0], [r * 1.3, r * 0.6], [0, r * 0.8]], { o: [p[0], p[1], zf + l - r * 0.8], s: Sd, c: [0, 0, 1], n: nrm(cross([0, 0, 1], Sd)) }, () => 0.018, flat, col.red, shade(col.red, 0.6), col.red, 1); }
        glow(F, [p[0], p[1], zf + l + 0.03], r * 1.2, [1.4, 0.6, 0.2], 2);
        muzzle = muzzle || [p[0], p[1], zf];
      } else {
        const housingL = clamp(lw * 0.45, 0.25, 0.6), barrelL = clamp(lw * (kind === "laser" ? 0.75 : 0.62), 0.3, 1.0);
        const zh = p[2] + housingL * 0.15;
        rbox(Bd, [p[0], p[1], zh], [0, 0, 1], housingL, hh * 1.25, hh, sg(12, 8), REG.panels, colW || col.second, 4.5);
        const zb0 = zh - housingL / 2 + 0.03, zb1 = zb0 - barrelL, br = kind === "laser" ? hh * 0.32 : hh * 0.48;
        rings(Bd, [{ t: 0, a: br, b: br, v: 0 }, { t: barrelL * 0.82, a: br, b: br, v: 0.2 }, { t: barrelL * 0.84, a: br * 1.35, b: br * 1.35, v: 0.25 }, { t: barrelL, a: br * 1.35, b: br * 1.35, v: 0.3 },
          { t: barrelL + 0.01, a: br * 0.75, b: br * 0.75, v: 0.85, reg: REG.nozzle }, { t: barrelL - 0.04, a: 0, b: 0, v: 1, reg: REG.nozzle }], sg(12, 8), frame([p[0], p[1], zb0], [0, 0, -1], [0, 1, 0]), metal, col.metal);
        if (kind === "laser") {
          cyl(Bd, [p[0], p[1], zb0 - barrelL * 0.3], [p[0], p[1], zb0 - barrelL * 0.38], br * 1.7, br * 1.7, sg(12, 8), trim, col.white);
          glow(F, [p[0], p[1], zb1 - 0.02], br * 3.2, scl(colW || [1, 0.25, 0.3], 1.8), 3);
        }
        muzzle = muzzle || [p[0], p[1], zb1 - 0.02];
      }
    }
  }
  S.nose = muzzle || (saucer ? [0, 0, -hull.R] : [0, sec(0).yc, hull.z0]);

  // ---- Extras
  let labelPlaced = false;
  for (const x of spec.extras) {
    const at = clamp(x.at, 0.06, 0.94), zc = saucer ? lerp(-hull.R * 0.7, hull.R * 0.7, at) : zAt(at), s = sec(saucer ? hull.t(zc) : at);
    const size = clamp(x.size, 0.05, 0.6) * L, colX = x.color ? C(x.color) : null;
    const topY = saucer ? hull.top(0, zc) : hull.top(0, zc), botY = saucer ? hull.bot(0, zc) : hull.bot(0, zc);
    const sideDecal = (rect, h, colD) => {
      const hh = Math.min(h, (saucer ? hull.ht * 1.4 : s.b * 1.6)), ww = hh;
      for (const sgn of [1, -1]) patch(Bd, hull, "side", zc, saucer ? hull.ht * 0.1 : s.yc, ww, hh, 3, 3, (i, j) => ruv(rect, 1 - i, j), colD, 0.007, sgn);
    };
    switch (x.kind) {
      case "legs": {
        const pts = [];
        if (saucer) { for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; pts.push([Math.cos(a) * hull.R * 0.5, Math.sin(a) * hull.R * 0.5]); } }
        else if (x.mount === "tail") { for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; pts.push([Math.cos(a), Math.sin(a), 1]); } }
        else { const za = zAt(clamp(at - 0.2, 0.15, 0.8)), zb = zAt(clamp(at + 0.2, 0.25, 0.9)); for (const z of [za, zb]) for (const sx of [-1, 1]) pts.push([sx, z]); }
        const legL = clamp(0.32 + size * 0.6, 0.35, 0.8);
        for (const q of pts) {
          let p0, p1;
          if (saucer) { p0 = [q[0], hull.bot(q[0], q[1]) + 0.05, q[1]]; p1 = [q[0] * 1.35, p0[1] - legL, q[1] * 1.35]; }
          else if (q.length === 3) { const st = sec(0.9), zt = zAt(0.88); p0 = [q[0] * st.a * 0.8, st.yc + q[1] * st.b * 0.8, zt]; p1 = [q[0] * (st.a + legL * 0.6), st.yc + q[1] * (st.b + legL * 0.6), hull.z1 + legL * 0.45]; }
          else { const z = q[1], st = hull.sec(hull.t(z)), x0 = q[0] * st.a * 0.5; p0 = [x0, hull.bot(x0, z) + 0.05, z]; p1 = [q[0] * (st.a * 0.5 + legL * 0.35), p0[1] - legL, z + (z < 0 ? -0.08 : 0.08)]; }
          cyl(Bd, p0, p1, 0.045, 0.035, sg(8, 6), metal, col.metal);
          sphere(Bd, madd(p0, nrm(sub(p1, p0)), 0.05), 0.07, sg(8, 6), trim, col.white);
          const fd = nrm(sub(p1, p0));
          rings(Bd, [{ t: -0.03, a: 0, b: 0 }, { t: -0.03, a: 0.13, b: 0.13 }, { t: 0.02, a: 0.15, b: 0.15 }, { t: 0.04, a: 0.1, b: 0.1 }, { t: 0.04, a: 0, b: 0 }], sg(12, 8), frame(p1, q.length === 3 ? fd : [0, -1, 0]), trim, col.white);
        }
        break;
      }
      case "antenna": {
        const p0 = [0, topY - 0.02, zc], h = clamp(0.3 + size * 0.8, 0.35, 0.9), p1 = add(p0, [0, h, h * 0.25]);
        cyl(Bd, p0, p1, 0.03, 0.02, 6, metal, col.metal);
        sphere(Bd, p1, 0.07, sg(10, 6), flat, colX || col.red);
        glow(F, p1, 0.22, scl(colX || [1, 0.25, 0.25], 1.7), 3);
        break;
      }
      case "dish": {
        const p0 = [0, topY - 0.02, zc], r = clamp(size * 0.7, 0.2, 0.45), c = add(p0, [0, 0.22, 0]);
        cyl(Bd, p0, c, 0.05, 0.04, 8, metal, col.metal);
        const dir = nrm([0, 1, -0.8]);
        rings(Bd, [{ t: -r * 0.1, a: 0, b: 0 }, { t: r * 0.3, a: r, b: r }, { t: r * 0.32, a: r * 0.92, b: r * 0.92 }, { t: r * 0.05, a: r * 0.2, b: r * 0.2 }, { t: r * 0.04, a: 0, b: 0 }], sg(16, 10), frame(c, dir), metal, colX || col.white);
        sphere(Bd, madd(c, dir, r * 0.45), 0.045, 8, flat, col.red);
        break;
      }
      case "eye": {
        const r = clamp(size * 0.45, 0.14, 0.32), zz = x.mount === "nose" ? zAt(0.14) : zc, c = [0, hull.top(0, zz) + r * 0.2, zz];
        sphere(Bd, c, r, sg(16, 10), flat, col.white);
        const fwd = nrm([0, 0.25, -1]);
        rings(Bd, [{ t: r * 0.86, a: r * 0.55, b: r * 0.55 }, { t: r * 0.96, a: r * 0.35, b: r * 0.35, c: colX || C("#3a86ff") }, { t: r * 1.0, a: r * 0.24, b: r * 0.24, c: col.dark }, { t: r * 1.02, a: 0, b: 0, c: col.dark }], sg(16, 10), frame(c, fwd), flat, colX || C("#3a86ff"));
        glow(F, madd(add(c, [r * 0.25, r * 0.3, 0]), fwd, r), 0.06, [1.3, 1.3, 1.3]);
        break;
      }
      case "lamp": {
        const nose = x.mount === "nose" || at < 0.15;
        const base = saucer ? (nose ? [0, 0, -hull.R + 0.02] : [0, topY, zc]) : nose ? [0, sec(0.03).yc, hull.z0 + 0.04] : [0, topY - 0.02, zc];
        const dir = nose ? [0, 0, -1] : [0, 1, 0], r = clamp(size * 0.35, 0.09, 0.18), c = madd(base, dir, 0.1 + r);
        cyl(Bd, base, madd(base, dir, 0.12), r * 0.8, r * 0.9, sg(12, 8), metal, col.metal);
        sphere(Bd, c, r, sg(12, 8), flat, colX ? mix(colX, [1, 1, 1], 0.4) : C("#fff2a8"), 1, dir);
        glow(F, c, r * 3.0, scl(colX || [1, 0.85, 0.4], 1.15), 3); // v1.6: toned down (it blew out white under the TV bloom)
        break;
      }
      case "shield": {
        const c = [0, topY + 0.02, zc], r = clamp(size * 0.6, 0.18, 0.32);
        cyl(Bd, add(c, [0, -0.06, 0]), add(c, [0, 0.08, 0]), r * 0.55, r * 0.45, sg(12, 8), metal, col.metal);
        const rows = [];
        for (let k = 0; k <= 8; k++) { const a = Math.PI * 2 * k / 8; rows.push({ t: 0.11 + Math.sin(a) * 0.035, a: r + Math.cos(a) * 0.035, b: r + Math.cos(a) * 0.035, v: k / 8 }); }
        rings(Bd, rows, sg(18, 10), frame(c, [0, 1, 0], [0, 0, -1]), flat, colX || C("#4cc9f0"));
        glow(F, add(c, [0, 0.13, 0]), r * 1.7, scl(colX || [0.3, 0.8, 1], 1.0), 3); // v1.6: toned down
        break;
      }
      case "cross": sideDecal(DEC.cross, clamp(size, 0.35, 0.6), col.white); break;
      case "lightning": sideDecal(DEC.bolt, clamp(size, 0.35, 0.6), col.white); break;
      case "star": sideDecal(DEC.star, clamp(size, 0.3, 0.55), colX || col.accent); break;
      case "skull": sideDecal(DEC.skull, clamp(size, 0.3, 0.55), colX || col.white); break;
      case "number": {
        const digits = (x.label.replace(/\D/g, "") || String(1 + Math.floor(R() * 9))).slice(0, 2), hgt = clamp(size, 0.3, saucer ? 0.3 : s.b * 1.5);
        for (let k = 0; k < digits.length; k++) {
          const off = (k - (digits.length - 1) / 2) * hgt * 0.62;
          for (const sgn of [1, -1]) patch(Bd, hull, "side", zc - off * sgn * -1 * (sgn > 0 ? 1 : 1), saucer ? 0 : s.yc, hgt * 0.7, hgt, 2, 3, (i, j) => ruv(DEC[digits[sgn > 0 ? k : digits.length - 1 - k]], 1 - (i * 0.7 + 0.15), j), colX || col.white, 0.007, sgn);
        }
        break;
      }
      case "text": labelPlaced = { at, size, colX }; break;
      case "stripe": {
        for (const sgn of [1, -1]) patch(Bd, hull, "side", zAt(0.55), saucer ? 0 : sec(0.55).yc, saucer ? hull.R : L * 0.7, saucer ? 0.12 : s.b * 0.45, sg(12, 6), 2, (i, j) => ruv(REG.racing, i, j), colX || col.accent, 0.007, sgn);
        break;
      }
      case "spikes": {
        const n = 4, z0 = zAt(clamp(at - x.size / 2, 0.15, 0.8)), z1 = zAt(clamp(at + x.size / 2, 0.25, 0.92));
        for (let k = 0; k < n; k++) { const z = lerp(z0, z1, k / (n - 1)), y = hull.top(0, z) - 0.03, h = 0.22 - 0.02 * Math.abs(k - 1.5); rings(Bd, [{ t: 0, a: 0, b: 0 }, { t: 0, a: 0.09, b: 0.09 }, { t: h, a: 0, b: 0 }], sg(10, 6), frame([0, y, z], [0, 1, 0.25]), metal, colX || col.metal); }
        break;
      }
      case "magnet": {
        const c = [0, botY - 0.05, zc], w = clamp(size * 0.4, 0.14, 0.24), h = w * 1.2, pts = [];
        for (let k = 0; k <= 8; k++) { const a = Math.PI * k / 8; pts.push([c[0] - Math.cos(a) * w, c[1] - h - Math.sin(a) * w * -1 + (k === 0 || k === 8 ? 0 : 0), c[2]]); }
        const path = [[c[0] - w, c[1] - h * 1.6, c[2]], ...pts.map((p) => [p[0], p[1] + h, p[2]]).reverse().map((p) => [p[0], p[1] - h * 0.6, p[2]]), [c[0] + w, c[1] - h * 1.6, c[2]]];
        cyl(Bd, add(c, [0, 0.06, 0]), add(c, [0, -0.12, 0]), 0.05, 0.05, 8, metal, col.metal);
        tube(Bd, path.map((p) => [p[0], p[1] + 0.05, p[2]]), 0.065, sg(10, 6), flat, colX || col.red);
        for (const sx of [-1, 1]) cyl(Bd, [c[0] + sx * w, c[1] - h * 1.55 + 0.05, c[2]], [c[0] + sx * w, c[1] - h * 1.95 + 0.05, c[2]], 0.07, 0.07, 8, metal, col.metal);
        break;
      }
      case "octopus": {
        const c = [0, topY - 0.03, zc], r = clamp(size * 0.45, 0.16, 0.28), pc = colX || col.purple;
        sphere(Bd, add(c, [0, r * 0.5, 0]), r, sg(12, 8), flat, pc, 0.9);
        for (let k = 0; k < 6; k++) {
          const a = Math.PI * 2 * k / 6, pts = [];
          for (let q = 0; q <= 4; q++) { const f = q / 4; pts.push([c[0] + Math.cos(a) * (r * 0.7 + f * r * 0.8), c[1] + r * 0.2 - f * 0.05, c[2] + Math.sin(a) * (r * 0.7 + f * r * 0.8) + Math.sin(f * 4 + k) * 0.03]); }
          tube(Bd, pts, [0.05, 0.045, 0.04, 0.03, 0.02], 6, flat, pc);
        }
        for (const sx of [-1, 1]) { sphere(Bd, add(c, [sx * r * 0.38, r * 0.75, -r * 0.75]), r * 0.24, 8, flat, col.white); sphere(Bd, add(c, [sx * r * 0.4, r * 0.75, -r * 0.94]), r * 0.11, 6, flat, col.dark); }
        break;
      }
      case "portal": {
        const c = [0, topY + 0.35, zc], r = clamp(size * 0.7, 0.25, 0.42), rows = [];
        for (let k = 0; k <= 8; k++) { const a = Math.PI * 2 * k / 8; rows.push({ t: Math.sin(a) * 0.05, a: r + Math.cos(a) * 0.05, b: r + Math.cos(a) * 0.05, v: k / 8 }); }
        rings(Bd, rows, sg(20, 12), frame(c, [0, 0, 1]), trim, col.white);
        cyl(Bd, [0, topY - 0.02, zc], [0, c[1] - r, zc], 0.05, 0.05, 8, metal, col.metal);
        disc(F, c, [0, 0, 1], r * 0.95, scl(colX || [0.55, 0.3, 1.0], 1.5), sg(16, 10), 0);
        glow(F, c, r * 1.8, [0.5, 0.35, 1.2], 3);
        break;
      }
      case "cape": {
        const z0 = zAt(clamp(at, 0.3, 0.7)), cc = colX || col.red, w = Math.max(s.a * 1.1, 0.35);
        const fr = { o: [0, hull.top(0, z0) + 0.03, z0], s: [1, 0, 0], c: nrm([0, -0.25, 1]), n: nrm([0, 1, 0.25]) };
        slab(Bd, [[-w * 0.6, 0], [w * 0.6, 0], [w * 1.05, L * 0.42], [0, L * 0.5], [-w * 1.05, L * 0.42]], fr, () => 0.02, flat, cc, shade(cc, 0.6), shade(cc, 0.75), 1);
        break;
      }
      case "parachute": {
        const zt = zAt(0.88), c = [0, hull.top(0, zt) - 0.02, zt], r = clamp(size * 0.5, 0.16, 0.3);
        sphere(Bd, c, r, sg(12, 8), flat, colX || C("#ff9f1c"), 0.75);
        cyl(Bd, add(c, [0, -0.02, 0]), add(c, [0, 0.06, 0]), r * 1.04, r * 1.04, sg(12, 8), trim, col.white);
        break;
      }
      case "mini copy": {
        if (saucer) { sphere(Bd, [hull.R * 1.25, 0, 0], 0.22, sg(12, 8), REG.panels, col.main, 0.4); break; }
        const k = 0.32, xo = s.a + 0.35, rows = hull.rows(d * 0.5).map((r0) => ({ ...r0, t: r0.t * k, a: r0.a * k, b: r0.b * k, y: (r0.y || 0) * k }));
        rings(Bd, rows, sg(12, 8), frame([xo, s.yc, zc], [0, 0, 1], [0, 1, 0]), REG.panels, col.main);
        rbox(Bd, [xo / 2 + 0.05, s.yc, zc], [1, 0, 0], xo - 0.05, 0.05, 0.03, 8, trim, col.white, 4, [0, 1, 0]);
        glow(F, [xo, s.yc, zc + L * k / 2 + 0.02], 0.12, scl(col.player, 1.3), 2);
        break;
      }
      case "flag": {
        const p0 = [0, topY - 0.02, zc], p1 = add(p0, [0, 0.6, 0]);
        cyl(Bd, p0, p1, 0.022, 0.02, 6, metal, col.metal);
        slab(Bd, [[0.32, 0], [0.56, 0], [0.56, 0.42], [0.32, 0.42]], { o: [0, p0[1], zc], s: [0, 1, 0], c: [0, 0, 1], n: [1, 0, 0] }, () => 0.012, flat, colX || col.accent, shade(colX || col.accent, 0.6), colX || col.accent, 1);
        break;
      }
      case "propeller": {
        const nose = x.mount !== "tail", c = nose ? (saucer ? [0, 0, -hull.R - 0.05] : [0, sec(0.02).yc, hull.z0 - 0.04]) : [0, sec(0.98).yc, hull.z1 + 0.1];
        const dir = nose ? [0, 0, -1] : [0, 0, 1], r = clamp(size * 0.9, 0.35, 0.6);
        rings(Bd, [{ t: -0.08, a: 0.12, b: 0.12 }, { t: 0.05, a: 0.11, b: 0.11 }, { t: 0.16, a: 0, b: 0 }], sg(12, 8), frame(c, dir), flat, col.red);
        for (let k = 0; k < 3; k++) { const a = Math.PI * 2 * k / 3 + 0.3, Sd = [Math.cos(a), Math.sin(a), 0]; slab(Bd, [[0, -0.05], [r, -0.07], [r, 0.04], [0, 0.06]], { o: c, s: Sd, c: nrm(cross(dir, Sd)), n: dir }, () => 0.018, metal, col.metal, shade(col.metal, 0.6), col.metal, 1); }
        break;
      }
      case "window": if (!portsDone) { portsDone = true; portholes(clamp(winN, 3, 4), saucer ? 0.5 : at, clamp(x.size * L, 0.6, 1.2), 0.45); } break;
      case "bomb": {
        const r = clamp(size * 0.35, 0.12, 0.26), c = [0, botY - r * 1.15, zc];
        rbox(Bd, [0, botY - r * 0.3, zc], [0, 0, 1], r * 1.2, 0.04, r * 0.45, 8, trim, col.white);
        sphere(Bd, c, r, sg(14, 8), flat, colX || col.dark);
        cyl(Bd, add(c, [0, r * 0.2, r * 0.85]), add(c, [0, r * 0.4, r * 1.35]), 0.025, 0.02, 6, flat, col.metal);
        glow(F, add(c, [0, r * 0.42, r * 1.4]), 0.09, [1.8, 0.9, 0.2], 3);
        break;
      }
      default: { // "other": a greeble pod on top
        const c = [0, topY + 0.04, zc], l = clamp(size, 0.3, 0.7);
        rbox(Bd, c, [0, 0, 1], l, 0.13, 0.08, sg(12, 8), REG.panels, colX || col.second, 3);
        cyl(Bd, add(c, [0, 0, -l / 2 - 0.02]), add(c, [0, 0, -l / 2 + 0.08]), 0.1, 0.1, sg(10, 6), trim, col.white);
        break;
      }
    }
  }

  // ---- The sticker (draw 2): the drawing on both sides and on top, the label text on the sides
  if (sticker && sticker.rect) {
    const [u0, v0, u1, v1] = sticker.rect, asp = sticker.aspect, uvS = (i, j) => [lerp(u0, u1, i), lerp(v0, v1, j)];
    if (saucer) {
      const h = hull.ht * 0.75, w = Math.min(h * asp, hull.R * 0.6); // v1.6: smaller
      if (!sidePorts) for (const sgn of [1, -1]) patch(Dc, hull, "side", 0, hull.ht * 0.05, w, w / asp, sg(8, 5), sg(5, 3), uvS, [1, 1, 1], 0.012, sgn);
      const zf = (spec.cockpit.kind === "none" ? 0.1 : clamp(spec.cockpit.size * L * 0.9, hull.R * 0.32, hull.R * 0.55) * 1.15) + 0.04, zb = hull.R * 0.88;
      const l = Math.max(0.3, (zb - zf) * 0.85), wx = Math.min(l / asp, hull.R * 0.75);
      patch(Dc, hull, "top", (zf + zb) / 2, 0, l, wx, sg(8, 5), sg(6, 3), uvS, [1, 1, 1], 0.012);
    } else {
      // side: centred behind the cockpit, as tall as the hull allows
      const tc = clamp(0.56, 0.3, 0.7), sc = sec(tc);
      let h = sc.b * 2 * (sidePorts ? 0.4 : 0.52), w = h * asp; // v1.6: a smaller, subtler sticker
      if (w > L * 0.36) { w = L * 0.36; h = w / asp; }
      for (const sgn of [1, -1]) patch(Dc, hull, "side", zAt(tc), sidePorts ? sc.yc - sc.b * 0.42 + h / 2 - sc.b * 0.1 : sc.yc, w, h, sg(10, 6), sg(6, 4), uvS, [1, 1, 1], 0.012, sgn);
      // top: behind the canopy, nose forward
      const cEnd = spec.cockpit.kind === "none" ? 0.2 : clamp(spec.cockpit.at + spec.cockpit.size * 0.55, 0.2, 0.6);
      const tA = clamp(cEnd + 0.03, 0.22, 0.62), st = sec(clamp(tA + 0.15, 0, 0.9));
      let wx = st.a * 2 * 0.52, l = wx * asp;
      const room = (0.95 - tA) * L;
      if (l > Math.min(room, L * 0.32)) { l = Math.min(room, L * 0.32); wx = l / asp; }
      patch(Dc, hull, "top", zAt(tA) + l / 2, 0, l, wx, sg(10, 6), sg(6, 4), uvS, [1, 1, 1], 0.012);
    }
  }
  if (sticker && sticker.label && labelPlaced) {
    const [u0, v0, u1, v1, asp] = sticker.label, at = labelPlaced.at, s = sec(at);
    const h = Math.min(saucer ? 0.24 : s.b * 0.8, 0.36), w = Math.min(h * asp, L * 0.5);
    for (const sgn of [1, -1]) patch(Dc, hull, "side", saucer ? 0 : zAt(at), saucer ? -hull.hb * 0.3 : s.yc - s.b * 0.35, w, h, sg(8, 5), 2, (i, j) => [lerp(u0, u1, sgn > 0 ? i : i), lerp(v0, v1, j)], [1, 1, 1], 0.013, sgn);
  }

  // ---- Sockets that depend on the hull only
  if (!S.back) S.back = saucer ? [0, hull.top(0, hull.R * 0.5), hull.R * 0.5] : [0, hull.top(0, zAt(0.75)), zAt(0.75)];
  S.belly = saucer ? [0, hull.bot(0, 0), 0] : [0, hull.bot(0, zAt(0.5)), zAt(0.5)];
  return { Bd, Dc, F, S, tris: (Bd.i.length + Dc.i.length + F.i.length) / 3 };
}

// [c at the leading edge, c at the trailing edge] of a convex planform at span s.
function chordAt(poly, s) {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < poly.length; k++) {
    const [s0, c0] = poly[k], [s1, c1] = poly[(k + 1) % poly.length];
    if ((s0 - s) * (s1 - s) > 0) continue;
    const c = Math.abs(s1 - s0) < 1e-9 ? null : c0 + (c1 - c0) * (s - s0) / (s1 - s0);
    for (const v of c == null ? [c0, c1] : [c]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  return lo === Infinity ? [0, 0] : [lo, hi];
}

function toGeometry(B, fx = false) {
  if (!B.i.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(B.p, 3));
  if (!fx) g.setAttribute("normal", new THREE.Float32BufferAttribute(B.n, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(B.uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(B.c, 3));
  if (fx) g.setAttribute("fx", new THREE.Float32BufferAttribute(B.fx, 4));
  g.setIndex(B.count > 65535 ? new THREE.Uint32BufferAttribute(B.i, 1) : new THREE.Uint16BufferAttribute(B.i, 1));
  return g;
}

// ---- Build ---------------------------------------------------------------------------------------------------------

export function buildShip(specIn, { drawingImage = null, color = 0x22d3ee, quality = "phone" } = {}) {
  const t0 = performance.now();
  const q = Q[quality] ? quality : "phone";
  const spec = sane(specIn);
  const T = shipTextures();
  const label = (spec.extras.find((x) => x.kind === "text") || {}).label || "";
  const sticker = makeSticker(drawingImage, color, spec.noseDir, label ? label.toUpperCase() : "", q === "lite" ? 256 : 512);
  let d = Q[q].d, fl = 1, A0 = null;
  for (let k = 0; k < 6; k++) {
    A0 = assemble(spec, color, d, sticker, fl);
    if (A0.tris <= Q[q].tris) break;
    // v1.5 (iPhone hitches): triangles grow about with d², so the next pass jumps to the detail that fits (a little under, at most
    // 0.82 and at least 0.5 of this one) instead of five 0.82 steps: a busy drawing builds in two passes, not up to five.
    const r = Q[q].tris / A0.tris;
    // v1.6 (every ship inside its budget): still over after the second pass means the small parts sit at their minimum segment
    // counts, which d cannot go under (a "lite" landing-legs ship stayed at 3020 > 2600 after five passes, plain ships at 2660):
    // from then on the minimums give way too (fl, down to 0.5: 8-sided rings become 6-, then 4-sided). A "phone" or "big" ship
    // that fitted in two passes before is built exactly as before; "lite" (d 0.62) has most parts at their minimums from the
    // first pass, so there the minimums give way at once (two passes, not three).
    if (k >= 1 || q === "lite") fl = Math.max(0.5, fl * Math.max(0.55, Math.min(0.8, r * 0.85)));
    d *= Math.max(0.5, Math.min(0.82, Math.sqrt(r) * 0.96));
  }
  const { Bd, Dc, F, S } = A0;
  // Centre on the origin and scale the longest horizontal side to SHIP_LENGTH (flames are not counted).
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < Bd.p.length; i += 3) {
    const x = Bd.p[i], y = Bd.p[i + 1], z = Bd.p[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const k = SHIP_LENGTH / Math.max(x1 - x0, z1 - z0, 1e-3), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const tr = (arr, i) => { arr[i] = (arr[i] - cx) * k; arr[i + 1] = (arr[i + 1] - cy) * k; arr[i + 2] = (arr[i + 2] - cz) * k; };
  for (let i = 0; i < Bd.p.length; i += 3) tr(Bd.p, i);
  for (let i = 0; i < Dc.p.length; i += 3) tr(Dc.p, i);
  for (let v = 0; v < F.count; v++) {
    const w = F.fx[v * 4 + 3];
    if (w > 1.5 && w < 3.5) { F.p[v * 3] *= k; F.p[v * 3 + 1] *= k; F.p[v * 3 + 2] *= k; } else tr(F.p, v * 3);
    tr(F.fx, v * 4);
  }
  const sockets = {};
  for (const [name, p] of Object.entries(S)) { const a = [p[0], p[1], p[2]]; tr(a, 0); sockets[name] = a; }
  const gBody = toGeometry(Bd), gDecal = sticker ? toGeometry(Dc) : null, gFx = toGeometry(F, true);
  gBody.computeBoundingBox(); gBody.computeBoundingSphere();
  if (gDecal) { gDecal.computeBoundingSphere(); }
  if (gFx) { gFx.boundingSphere = gBody.boundingSphere.clone(); gFx.boundingSphere.radius += 3.5; }
  const bb = gBody.boundingBox;
  let radius = 0;
  for (let i = 0; i < Bd.p.length; i += 3) radius = Math.max(radius, Math.hypot(Bd.p[i], Bd.p[i + 1], Bd.p[i + 2]));
  const triangles = (Bd.i.length + (gDecal ? Dc.i.length : 0) + F.i.length) / 3;
  const drawCalls = 1 + (gDecal ? 1 : 0) + (gFx ? 1 : 0);

  const instance = (o = {}) => {
    const c = o.color ?? color;
    const body = bodyMaterial(T.atlas, c, { rough: T.rough, normal: T.normal });
    const materials = [body], fxMaterials = [];
    const root = new THREE.Group();
    root.name = "ship3d";
    const m1 = new THREE.Mesh(gBody, body);
    m1.name = "ship3d_body";
    root.add(m1);
    if (gDecal) {
      const dm = bodyMaterial(sticker.tex, c, { decal: true });
      materials.push(dm);
      const m2 = new THREE.Mesh(gDecal, dm);
      m2.name = "ship3d_sticker"; m2.renderOrder = 1;
      root.add(m2);
    }
    let U = null;
    if (gFx) {
      const fm = fxMaterial(T.atlas);
      fxMaterials.push(fm);
      U = fm.userData.fx;
      const m3 = new THREE.Mesh(gFx, fm);
      m3.name = "ship3d_fx"; m3.renderOrder = 2;
      root.add(m3);
    }
    const sk = {};
    for (const [name, p] of Object.entries(sockets)) {
      const ob = new THREE.Object3D();
      ob.name = `socket_${name}`;
      ob.position.fromArray(p);
      root.add(ob);
      sk[name] = ob;
    }
    const view = {
      object3d: root, sockets: sk, materials, fxMaterials,
      setEnginePower(p) {
        if (!U) return;
        p = Number(p);
        p = Number.isFinite(p) ? clamp(p, 0, 3) : 0;
        const t = performance.now() * 0.001, fl = 1 + 0.07 * Math.sin(t * 37.0) + 0.05 * Math.sin(t * 23.0 + 1.3);
        const on = p > 0.01, p1 = Math.min(p, 1), p2 = Math.max(0, p - 1);
        U.uLen.value = on ? (0.3 + 0.7 * p1 + 0.6 * p2) * fl : 0.0001;
        U.uWid.value = on ? (0.72 + 0.28 * p1 + 0.15 * p2) * (2 - fl) : 0.0001;
        U.uPow.value = (0.14 + 0.86 * p1 + 0.3 * p2) * fl;
      },
      setOpacity(a) {
        a = Number.isFinite(Number(a)) ? clamp(Number(a), 0, 1) : 1;
        for (const m of materials) {
          const tr = a < 0.999;
          if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } // r160: transparent switches the OPAQUE define
          m.opacity = a; m.depthWrite = !tr;
        }
        for (const m of fxMaterials) m.opacity = a;
      },
      dispose() { for (const m of materials) m.dispose(); for (const m of fxMaterials) m.dispose(); root.removeFromParent(); },
    };
    view.setEnginePower(0.35);
    return view;
  };
  const first = instance();
  return {
    object3d: first.object3d, sockets: first.sockets, materials: first.materials, fxMaterials: first.fxMaterials,
    radius, size: { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z }, triangles, drawCalls,
    quality: q, sticker: sticker ? { w: sticker.tex.image.width, h: sticker.tex.image.height } : null,
    ms: Math.round((performance.now() - t0) * 10) / 10,
    instance,
    setEnginePower: first.setEnginePower, setOpacity: first.setOpacity,
    dispose() { gBody.dispose(); if (gDecal) gDecal.dispose(); if (gFx) gFx.dispose(); if (sticker) sticker.tex.dispose(); first.dispose(); },
  };
}
