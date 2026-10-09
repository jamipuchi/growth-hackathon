// inflate.js: a drawing becomes a plush 3D body on the device (PLAN.md section 6, "Look"). No model call.
//
//   inflateDrawing(inkImage, { kind: "ship"|"person"|"car"|"bike"|"quadruped"|"blob", size, quality: "phone"|"big",
//                              color, noseUp })
//     → { object3d, sockets, wheels, radius, materials, triangles, ms, size: {x, y, z},
//         instance({ color }) → { object3d, sockets, wheels, materials, dispose() },   // a view: shared geometry + texture
//         dispose() }                                                                  // frees geometry + texture
//
// inkImage: ImageBitmap | HTMLImageElement | canvas. Transparent ink on nothing (the phone's ink PNG); an opaque
// drawing (dark ink on white paper) works too: the ink is then taken from the darkness.
// Steps: ink mask → close small gaps (dilate, fill enclosed regions, erode) → drop specks → distance transform →
// round "plush" heights → a front and a mirrored darker back sharing one rim → the drawing as the texture.
//   ship:   lies flat, front (the drawing) on top (+Y), nose towards -Z. The nose is the drawing's right side, or its
//           top when the drawing is clearly taller than wide (noseUp: true/false forces it). Centred on the origin.
//   person: stands up on y = 0 facing -Z (the drawing is its front), centred in x and z.
//   car, bike, quadruped, blob: SIDE views. The drawing's right side is the front (-Z); the drawing shows on the
//           entity's right flank (+X, mirrored and darker on the left), standing on y = 0, centred in x and z.
//           car is a chunky bevelled slab, bike a thin one, quadruped and blob are round plush.
//   car and bike get wheels: rings of ink that touch the bottom of the drawing are found (circle matching), and each
//           becomes a short disc (an axle with a disc on each side for the car, one fat disc for the bike) around an
//           X-axis pivot, textured with the drawn wheel itself so the drawing visibly spins. Without a drawn wheel
//           two plain chunky wheels (dark tyre, light hub) sit at ~20 % and ~80 % of the length.
//           wheels: [{ pivot: Object3D, radius (m), drawn: bool }], rear to front. Spin: pivot.rotation.x -= v / radius * dt.
// sockets: Object3D children named socket_<name> (anim.js finds them by traversal) and returned by name:
//   ship   nose, wing_l, wing_r, back, belly, seat, engine_l, engine_r
//   person head, hand_l, hand_r, feet, back
//   car, bike, quadruped, blob   front, back, roof, top, seat, mouth, tail, centre (all of them, for every side kind)
// Budgets: ≤ 4k triangles ("phone"), ≤ 12k ("big") for the body (+ ~200 for wheels), one texture ≤ 512 px.
import * as THREE from "three";

const Q = {
  phone: { maskPx: 112, tris: 4000, texPx: 384, seg: 18 },
  big: { maskPx: 160, tris: 12000, texPx: 512, seg: 28 },
};
// thick: plush half-thickness as a fraction of the biggest inside radius; bevel: how far from the outline the height
// takes to rise (1 = a plush dome, less = flatter top with rounded edges); minHalf: at least this fraction of the
// longest side as half-thickness (chunky machines); wheels: how many wheels a drawing is expected to have.
const KIND = {
  ship: { thick: 0.55, grow: 0.028, closes: [0.035, 0.07, 0.11], backShade: 0.62, size: 3.2 },
  person: { thick: 0.62, grow: 0.03, closes: [0.03], backShade: 0.62, size: 1.8 },
  car: { thick: 0.5, grow: 0.026, closes: [0.025, 0.05, 0.09], backShade: 0.66, size: 2.8, side: true, bevel: 0.5, minHalf: 0.2, wheels: 2, twin: true },
  bike: { thick: 0.5, grow: 0.02, closes: [0.02, 0.04, 0.07], backShade: 0.66, size: 1.9, side: true, bevel: 0.7, minHalf: 0.05, wheels: 2, twin: false },
  quadruped: { thick: 0.9, grow: 0.03, closes: [0.03, 0.06, 0.1], backShade: 0.62, size: 2.0, side: true, bevel: 1 },
  blob: { thick: 1.0, grow: 0.03, closes: [0.03, 0.06], backShade: 0.66, size: 1.4, side: true, bevel: 1 },
};
export const KINDS = Object.keys(KIND);
const PAPER = new THREE.Color(0xf6f1e4);
const GRAPHITE = [34, 34, 46];

// ---- Image → pixels ------------------------------------------------------------------------------------------------

function sizeOf(img) {
  return { w: img.naturalWidth || img.videoWidth || img.width, h: img.naturalHeight || img.videoHeight || img.height };
}

function canvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

// The source at most `px` on its longest side → { W, H, ink: Float32Array 0..1 }.
function readInk(img, px) {
  const { w, h } = sizeOf(img);
  if (!w || !h) throw new Error("inflate: empty image");
  const s = Math.min(1, px / Math.max(w, h));
  const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
  const c = canvas(W, H);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const N = W * H, ink = new Float32Array(N);
  let clear = 0;
  for (let j = 3; j < d.length; j += 16) if (d[j] < 250) clear++;
  if (clear > N / 4 * 0.05) {
    // Transparent: alpha is the ink, whatever its colour.
    for (let i = 0, j = 3; i < N; i++, j += 4) ink[i] = d[j] / 255;
  } else {
    // Opaque: paper is the bright level (90th percentile), ink is what is clearly darker than it.
    const L = new Uint8Array(N), hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < N; i++, j += 4) { const l = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8; L[i] = l; hist[l]++; }
    let acc = 0, paper = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= N * 0.9) { paper = v; break; } }
    paper = Math.max(80, paper);
    for (let i = 0; i < N; i++) ink[i] = Math.min(1, Math.max(0, (paper * 0.78 - L[i]) / (paper * 0.4)));
  }
  return { W, H, ink };
}

// ---- Mask operations on a grid -------------------------------------------------------------------------------------

// Chamfer (3-4) distance, in pixels, from every pixel where mask is 1 to the nearest 0 (0 where mask is 0).
// edge: whether the world beyond the grid counts as 0 (true for the silhouette; false when dilating ink).
function distance(mask, W, H, edge = true) {
  const BIG = 1e9, E = edge ? 3 : BIG, d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? BIG : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3); else v = Math.min(v, E);
    if (y > 0) {
      v = Math.min(v, d[i - W] + 3);
      if (x > 0) v = Math.min(v, d[i - W - 1] + 4);
      if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4);
    } else v = Math.min(v, E);
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + 3); else v = Math.min(v, E);
    if (y < H - 1) {
      v = Math.min(v, d[i + W] + 3);
      if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4);
      if (x > 0) v = Math.min(v, d[i + W - 1] + 4);
    } else v = Math.min(v, E);
    d[i] = v;
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

const invert = (m) => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; };
function dilate(m, W, H, r) { const d = distance(invert(m), W, H, false); const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = d[i] <= r ? 1 : 0; return o; }
function erode(m, W, H, r) { const d = distance(m, W, H); const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = d[i] > r ? 1 : 0; return o; }

// Everything the outside cannot reach from the border is inside: enclosed regions are filled.
function fillHoles(m, W, H) {
  const out = new Uint8Array(m.length), stack = new Int32Array(m.length);
  let sp = 0;
  const seed = (i) => { if (!m[i] && !out[i]) { out[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp], x = i % W;
    if (x > 0) seed(i - 1); if (x < W - 1) seed(i + 1);
    if (i >= W) seed(i - W); if (i < m.length - W) seed(i + W);
  }
  const f = new Uint8Array(m.length);
  let area = 0;
  for (let i = 0; i < m.length; i++) if (!out[i]) { f[i] = 1; area++; }
  return { mask: f, area };
}

// Keep the connected parts bigger than `keepFrac` of the largest (specks, stray marks and noise go). diag: 8-connected.
function dropSpecks(m, W, H, keepFrac = 0.04, diag = false) {
  const label = new Int32Array(m.length), stack = new Int32Array(m.length), sizes = [0];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || label[s]) continue;
    const id = sizes.length;
    let sp = 0, n = 0;
    label[s] = id; stack[sp++] = s;
    while (sp) {
      const i = stack[--sp], x = i % W;
      n++;
      const l = x > 0, r = x < W - 1;
      const visit = (j) => { if (j >= 0 && j < m.length && m[j] && !label[j]) { label[j] = id; stack[sp++] = j; } };
      if (l) visit(i - 1); if (r) visit(i + 1); visit(i - W); visit(i + W);
      if (diag) { if (l) { visit(i - W - 1); visit(i + W - 1); } if (r) { visit(i - W + 1); visit(i + W + 1); } }
    }
    sizes.push(n);
  }
  let big = 0;
  for (const n of sizes) if (n > big) big = n;
  const keep = big * keepFrac;
  const o = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) if (label[i] && sizes[label[i]] >= keep) o[i] = 1;
  return o;
}

// ---- The silhouette ------------------------------------------------------------------------------------------------

function silhouette(src, kind, maskPx) {
  const K = KIND[kind];
  // Solid ink, without specks (parts under 2 % of the biggest stroke): a stray dot on the paper must not become a blob
  // or stretch the box. Dots inside the body (eyes, windows) drop out of the mask only; the texture keeps them.
  const solid = new Uint8Array(src.W * src.H);
  for (let i = 0; i < solid.length; i++) solid[i] = src.ink[i] > 0.35 ? 1 : 0;
  const kept = dropSpecks(solid, src.W, src.H, 0.02, true);
  // Ink bounding box in source pixels.
  let x0 = src.W, y0 = src.H, x1 = -1, y1 = -1;
  for (let y = 0; y < src.H; y++) for (let x = 0; x < src.W; x++) {
    if (kept[y * src.W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error("inflate: no ink in the drawing");
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // Grid: the ink box at maskPx on its longest side, plus a border wide enough for the biggest closing.
  const k = Math.min(1, maskPx / Math.max(bw, bh));
  const pad = Math.ceil(maskPx * (Math.max(...K.closes) + K.grow) + 3);
  const gw = Math.max(1, Math.round(bw * k)), gh = Math.max(1, Math.round(bh * k));
  const W = gw + 2 * pad, H = gh + 2 * pad;
  const ink = new Uint8Array(W * H);
  // Max-pool the source into the grid cells so thin pencil lines survive the downscale.
  const sx = bw / gw, sy = bh / gh;
  for (let gy = 0; gy < gh; gy++) {
    const ya = y0 + Math.floor(gy * sy), yb = Math.min(src.H, y0 + Math.max(Math.floor(gy * sy) + 1, Math.floor((gy + 1) * sy)));
    for (let gx = 0; gx < gw; gx++) {
      const xa = x0 + Math.floor(gx * sx), xb = Math.min(src.W, x0 + Math.max(Math.floor(gx * sx) + 1, Math.floor((gx + 1) * sx)));
      let v = 0;
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (kept[y * src.W + x]) { v = 1; break; }
      if (v) ink[(gy + pad) * W + gx + pad] = 1;
    }
  }
  const L = Math.max(gw, gh);
  const grow = Math.max(1, K.grow * L);
  let inkArea = 0;
  for (let i = 0; i < ink.length; i++) inkArea += ink[i];
  // Close gaps: try a small closing first; a sketchy outline that does not enclose anything gets a bigger one.
  let best = null;
  for (const c of K.closes) {
    const r = Math.max(1.5, c * L);
    const filled = fillHoles(dilate(ink, W, H, r), W, H);
    const mask = erode(filled.mask, W, H, Math.max(0, r - grow));
    let area = 0;
    for (let i = 0; i < mask.length; i++) area += mask[i];
    best = { mask, area, r };
    if (area > inkArea * 2.2) break; // the outline encloses a body: done
  }
  const mask = dropSpecks(best.mask, W, H);
  return { mask, ink, W, H, pad, box: { x0, y0, bw, bh }, k, gw, gh };
}

// ---- Texture: the drawing in graphite on a pale body colour --------------------------------------------------------

function makeTexture(src, sil, color, texPx) {
  const { W, H, pad, box, k } = sil;
  // The texture covers the whole padded grid. Grid cell (gx, gy) ↔ source pixel x0 + (gx - pad) / k.
  const s = Math.min(texPx / W, texPx / H);
  const tw = Math.max(8, Math.round(W * s)), th = Math.max(8, Math.round(H * s));
  const c = canvas(tw, th);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(tw, th), d = img.data;
  const body = PAPER.clone().lerp(new THREE.Color(color), 0.38);
  const br = body.r * 255, bg = body.g * 255, bb = body.b * 255;
  const toSrc = 1 / (s * k);
  let seed = 1234567;
  for (let ty = 0; ty < th; ty++) {
    const sy = box.y0 + (ty + 0.5) * toSrc - pad / k;
    const iy = Math.floor(sy);
    for (let tx = 0; tx < tw; tx++) {
      const sx = box.x0 + (tx + 0.5) * toSrc - pad / k;
      const ix = Math.floor(sx);
      let a = 0;
      if (ix >= 0 && iy >= 0 && ix < src.W && iy < src.H) a = src.ink[iy * src.W + ix];
      // A touch of paper grain so it keeps the pencil look.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const grain = 1 + ((seed / 0x7fffffff) - 0.5) * 0.07;
      const ink = Math.min(1, a * 1.15) * 0.92;
      const j = (ty * tw + tx) * 4;
      d[j] = (br * (1 - ink) + GRAPHITE[0] * ink) * grain;
      d[j + 1] = (bg * (1 - ink) + GRAPHITE[1] * ink) * grain;
      d[j + 2] = (bb * (1 - ink) + GRAPHITE[2] * ink) * grain;
      d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.flipY = false; // uv (0,0) is the canvas' top-left
  return { tex, tw, th, s };
}

// ---- The material: standard, plus a soft rim in the body colour ----------------------------------------------------

function makeMaterial(map, color) {
  // A little self-light through the same texture (ink stays dark) keeps the drawing readable in the shade and gives the
  // bright, cartoony look; the rim in the player colour is added in the shader below.
  const mat = new THREE.MeshStandardMaterial({
    map, vertexColors: true, roughness: 0.82, metalness: 0.0,
    emissive: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55), emissiveMap: map, emissiveIntensity: 0.3,
  });
  const rim = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35);
  const rimK = { value: 1 }; // material.userData.rimK.value: 0 switches the rim off (a charred wreck)
  mat.userData.rimK = rimK;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uRimK = rimK;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uRim;\nuniform float uRimK;")
      .replace("#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n  float rimF = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);\n  totalEmissiveRadiance += uRim * rimF * 0.45 * uRimK;");
  };
  mat.customProgramCacheKey = () => "inflate-rim";
  return mat;
}

// ---- Wheels (car, bike) --------------------------------------------------------------------------------------------

// Ink thickened by one pixel in every direction (3 x 3).
function dilate3(m, W, H) {
  const t = new Uint8Array(m.length), o = new Uint8Array(m.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; t[i] = m[i] | (x > 0 ? m[i - 1] : 0) | (x < W - 1 ? m[i + 1] : 0); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; o[i] = t[i] | (y > 0 ? t[i - W] : 0) | (y < H - 1 ? t[i + W] : 0); }
  return o;
}

// Circles of ink that touch the bottom of the drawing, in grid px [{ cx, cy, r }] sorted by cx. A hand-drawn ring is never
// a perfect circle, so it is matched against the ink thickened by 1 px: at least 78 % of the points on the circle must be
// ink and at least 7 of its 8 octants must be mostly ink (a circle that just follows two or three straight body lines, like
// a corner of the box, does not pass), and it must not sit inside a solid area (the circle 3.5 px outside it must be mostly
// empty). A wheel touches the ground, so the centre height follows from the radius (give or take a little): only x and r
// are searched. The best match wins, bigger circles ahead of equals: the hub inside a wheel (and the inner ring of a tyre)
// are concentric with it and drop out; the others must be about the same size and may at most touch it.
function findWheels(sil) {
  const { ink, W, H, pad, gw, gh } = sil;
  const L = Math.max(gw, gh);
  const yb = pad + gh - 1, xa = pad, xb = pad + gw - 1; // the ink box in grid px, inclusive
  const fat = dilate3(ink, W, H);
  const rMin = Math.max(5, Math.round(0.055 * L)), rMax = Math.max(rMin, Math.round(0.23 * L));
  const trig = new Map();
  const table = (n) => {
    let t = trig.get(n);
    if (!t) {
      t = { c: new Float32Array(n), s: new Float32Array(n) };
      for (let k = 0; k < n; k++) { t.c[k] = Math.cos((k / n) * Math.PI * 2); t.s[k] = Math.sin((k / n) * Math.PI * 2); }
      trig.set(n, t);
    }
    return t;
  };
  const oct = new Int32Array(8);
  // The fraction of the n points on the circle (cx, cy, r) that lie on `arr` (every `stride`-th point only, for a quick
  // look). As a side effect `octs` is the number of octants of the circle that are at least half on `arr`.
  let octs = 0;
  const ring = (arr, cx, cy, r, n, stride = 1) => {
    const t = table(n);
    let hit = 0, tot = 0;
    oct.fill(0);
    for (let k = 0; k < n; k += stride) {
      const x = Math.round(cx + r * t.c[k]), y = Math.round(cy + r * t.s[k]);
      tot++;
      if (x >= 0 && y >= 0 && x < W && y < H && arr[y * W + x]) { hit++; oct[(k * 8 / n) | 0]++; }
    }
    octs = 0;
    for (let o = 0; o < 8; o++) if (oct[o] >= (n / 8) * 0.5 / stride) octs++;
    return hit / tot;
  };
  const cands = [];
  for (let r = rMin; r <= rMax; r++) {
    const n = Math.min(96, Math.max(24, r * 4));
    const slack = Math.max(1, Math.round(r * 0.08));
    for (let s = -slack; s <= slack; s++) {
      const cy = yb - r + s;
      if (cy < pad + gh * 0.4) continue; // wheels sit in the lower part of the drawing
      for (let cx = Math.ceil(xa + r - 2); cx <= Math.floor(xb - r + 2); cx++) {
        if (ring(fat, cx, cy, r, n, 4) < 0.55) continue;
        const cover = ring(fat, cx, cy, r, n), around = octs; // `around`: how many of the 8 octants are mostly ink
        if (cover < 0.78 || around < 7) continue;
        const outer = ring(ink, cx, cy, r + 3.5, n);
        if (outer > 0.35) continue;
        cands.push({ cx, cy, r, score: cover + 0.25 * (around / 8) - 0.6 * outer + r / L });
      }
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cands) {
    if (out.length >= 4) break;
    if (out.length && (c.r < 0.75 * out[0].r || c.r > 1.35 * out[0].r)) continue; // wheels of one vehicle are about the same size
    // The same wheel again, or a circle inside / overlapping one already taken (two wheels at most touch).
    if (out.some((w) => Math.hypot(w.cx - c.cx, w.cy - c.cy) < 0.9 * (w.r + c.r))) continue;
    out.push(c);
  }
  out.sort((a, b) => a.cx - b.cx);
  // The thickened ink reaches ~1 px past the stroke: the circle found is a pixel or so bigger than the drawn ring.
  return out.map((w) => ({ cx: w.cx, cy: w.cy, r: Math.max(3, w.r - 0.5) }));
}

// One wheel (or an axle with a disc on each side) around the X axis, centred on the pivot. uvAt(y, z) → [u, v] for a point
// of a cap, so the drawn wheel is what spins; plain wheels (none drawn) get a dark tyre and a light hub instead.
function wheelGeometry({ R, hw, xs, seg, uvAt, plain, backShade }) {
  const pos = [], uv = [], col = [], idx = [];
  const vert = (x, y, z, shade) => {
    pos.push(x, y, z);
    const t = uvAt(y, z);
    uv.push(t[0], t[1]);
    col.push(shade, shade, shade);
    return pos.length / 3 - 1;
  };
  // A cap triangle facing +X (want 1) or -X (want -1): the winding follows from the cross product.
  const capTri = (a, b, c, want) => {
    const by = pos[b * 3 + 1] - pos[a * 3 + 1], bz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const cy = pos[c * 3 + 1] - pos[a * 3 + 1], cz = pos[c * 3 + 2] - pos[a * 3 + 2];
    if ((by * cz - bz * cy) * want < 0) idx.push(a, c, b); else idx.push(a, b, c);
  };
  // A tread triangle facing away from the axis.
  const radialTri = (a, b, c) => {
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const my = pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1], mz = pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2];
    if (ny * my + nz * mz < 0) idx.push(a, c, b); else idx.push(a, b, c);
  };
  const ringAt = (x, r, shade) => {
    const out = [];
    for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; out.push(vert(x, r * Math.sin(a), r * Math.cos(a), shade)); }
    return out;
  };
  const fan = (x, want, r, shade) => {
    const c = vert(x, 0, 0, shade), ring = ringAt(x, r, shade);
    for (let k = 0; k < seg; k++) capTri(c, ring[k], ring[(k + 1) % seg], want);
  };
  const annulus = (x, want, r0, r1, shade) => {
    const a = ringAt(x, r0, shade), b = ringAt(x, r1, shade);
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      capTri(a[k], b[k], b[k1], want);
      capTri(a[k], b[k1], a[k1], want);
    }
  };
  const TYRE = 0.3, HUB = 0.95;
  for (const xc of xs) {
    for (const want of [1, -1]) {
      const x = xc + want * hw, shade = want > 0 ? 1 : backShade;
      if (!plain) fan(x, want, R, shade);
      else { annulus(x, want, R * 0.58, R, TYRE); fan(x + want * 0.004, want, R * 0.58, HUB * shade); }
    }
    const t0 = ringAt(xc - hw, R, TYRE), t1 = ringAt(xc + hw, R, TYRE);
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      radialTri(t0[k], t1[k], t1[k1]);
      radialTri(t0[k], t1[k1], t0[k1]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// A one-triangle mesh with the material of the inflated bodies: add it to a scene and renderer.compile() it once, so the
// first real drawing does not stall on compiling its shader. dispose() frees it.
export function warmMaterial(color = 0xffffff) {
  const tex = new THREE.CanvasTexture(canvas(2, 2));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  const material = makeMaterial(tex, color);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { mesh, dispose() { mesh.removeFromParent(); geo.dispose(); material.dispose(); tex.dispose(); } };
}

// ---- Inflate -------------------------------------------------------------------------------------------------------

export function inflateDrawing(inkImage, opts = {}) {
  const t0 = performance.now();
  const kind = KIND[opts.kind] ? opts.kind : "ship";
  const K = KIND[kind];
  const side = !!K.side;
  const quality = Q[opts.quality] ? opts.quality : "phone";
  const { maskPx, tris: triBudget, texPx, seg } = Q[quality];
  const color = opts.color ?? 0x22d3ee;
  const sizeM = opts.size || K.size;
  const mark = (name) => { if (opts.timing) opts.timing[name] = Math.round((performance.now() - t0) * 10) / 10; };

  const src = readInk(inkImage, Math.max(texPx, maskPx * 2));
  mark("ink");
  const sil = silhouette(src, kind, maskPx);
  mark("silhouette");
  const { mask, W, H } = sil;

  // Orientation: grid (x right, y down) → metres. The silhouette's longest side = sizeM.
  let mx0 = W, my0 = H, mx1 = 0, my1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; if (y < my0) my0 = y; if (y > my1) my1 = y; }
  mx1 += 1; my1 += 1;
  const sw = mx1 - mx0, sh = my1 - my0;
  const m = sizeM / Math.max(sw, sh);
  const cx = (mx0 + mx1) / 2, cy = (my0 + my1) / 2;
  const noseUp = kind === "ship" ? (opts.noseUp ?? sh > sw * 1.25) : false;

  // Wheels first: without a drawn one the body is lifted a little so two plain chunky wheels fit under it.
  let wheelList = [];
  let plainWheels = false, plainR = 0, lift = 0;
  if (K.wheels) {
    wheelList = findWheels(sil);
    mark("wheels");
    if (wheelList.length === 1 && K.wheels > 1) {
      // One wheel found: its twin sits at the mirrored place (same drawing), if there is room for it.
      const w = wheelList[0], cx2 = 2 * cx - w.cx;
      if (Math.abs(cx2 - w.cx) > 2 * w.r && cx2 - w.r > mx0 - 2 && cx2 + w.r < mx1 + 2) wheelList.push({ ...w, cx: cx2, ux: w.cx, uy: w.cy });
      wheelList.sort((a, b) => a.cx - b.cx);
    }
    if (!wheelList.length) {
      plainWheels = true;
      plainR = Math.min(0.5, Math.max(0.25, 0.15 * sizeM));
      lift = 0.55 * plainR;
      wheelList = [0.2, 0.8].map((f) => ({ cx: mx0 + f * sw, cy: my1 - plainR / m, r: plainR / m, plain: true }));
    }
  }

  // Heights: distance to the outline, a round profile (sqrt-ish) so it is soft like a plush toy, then one blur. Machines
  // (car, bike) rise over a shorter distance (a flat top, rounded edges) and are at least `minHalf` thick.
  const dist = distance(mask, W, H);
  let D = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > D) D = dist[i];
  const Hmax = Math.min(1.6 * D, Math.max(K.thick * D, (K.minHalf || 0) * Math.max(sw, sh)));
  const Bv = Math.max(1, (K.bevel || 1) * D);
  const hRaw = new Float32Array(W * H);
  for (let i = 0; i < hRaw.length; i++) {
    if (!mask[i]) continue;
    const t = Math.min(1, dist[i] / Bv);
    hRaw[i] = Hmax * Math.sqrt(t * (2 - t));
  }
  const hf = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!mask[i]) continue;
    hf[i] = (4 * hRaw[i] + hRaw[i - 1] + hRaw[i + 1] + hRaw[i - W] + hRaw[i + W]) / 8;
  }
  const hAt = (x, y) => { // bilinear in grid pixel coordinates (pixel centres at +0.5)
    const fx = Math.min(W - 1.001, Math.max(0, x - 0.5)), fy = Math.min(H - 1.001, Math.max(0, y - 0.5));
    const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy, i = iy * W + ix;
    return (hf[i] * (1 - ax) + hf[i + 1] * ax) * (1 - ay) + (hf[i + W] * (1 - ax) + hf[i + W + 1] * ax) * ay;
  };

  // Mesh grid: cells of `step` grid pixels, as fine as the triangle budget allows (4 triangles per cell).
  let area = 0;
  for (let i = 0; i < mask.length; i++) area += mask[i];
  let step = Math.max(1, Math.sqrt((4 * area) / (triBudget * 0.92)));
  let cols, rows, cell, cells;
  for (;;) {
    cols = Math.ceil(W / step); rows = Math.ceil(H / step);
    cell = new Uint8Array(cols * rows); cells = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const px = Math.min(W - 1, Math.floor((c + 0.5) * step)), py = Math.min(H - 1, Math.floor((r + 0.5) * step));
      if (mask[py * W + px]) { cell[r * cols + c] = 1; cells++; }
    }
    if (cells * 4 <= triBudget) break;
    step *= 1.06;
  }

  // Vertices at cell corners. A corner touching an outside cell is on the rim (height 0, shared by both sides).
  const VC = cols + 1;
  const used = new Uint8Array(VC * (rows + 1)), rim = new Uint8Array(VC * (rows + 1));
  const cellIn = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && cell[r * cols + c] === 1;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const n = cellIn(c - 1, r - 1) + cellIn(c, r - 1) + cellIn(c - 1, r) + cellIn(c, r);
    if (n) { used[r * VC + c] = 1; if (n < 4) rim[r * VC + c] = 1; }
  }
  // Grid-pixel positions; the rim is smoothed along itself so the staircase becomes a soft outline.
  const gx = new Float32Array(VC * (rows + 1)), gy = new Float32Array(VC * (rows + 1));
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) { gx[r * VC + c] = c * step; gy[r * VC + c] = r * step; }
  for (let it = 0; it < 3; it++) {
    const nx = gx.slice(), ny = gy.slice();
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      const v = r * VC + c;
      if (!rim[v]) continue;
      let sx = 0, sy = 0, n = 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc > cols || rr > rows) continue;
        const u = rr * VC + cc;
        if (!rim[u]) continue;
        // only along an edge of an inside cell
        const edgeIn = dc ? cellIn(Math.min(c, cc), r - 1) || cellIn(Math.min(c, cc), r) : cellIn(c - 1, Math.min(r, rr)) || cellIn(c, Math.min(r, rr));
        if (!edgeIn) continue;
        sx += gx[u]; sy += gy[u]; n++;
      }
      if (n) { nx[v] = gx[v] * 0.5 + (sx / n) * 0.5; ny[v] = gy[v] * 0.5 + (sy / n) * 0.5; }
    }
    gx.set(nx); gy.set(ny);
  }

  mark("mesh grid");
  const tex = makeTexture(src, sil, color, texPx);
  mark("texture");
  // place(x, y, h) → [X, Y, Z]: front side h > 0, back side h < 0.
  let place;
  if (kind === "person") place = (x, y, h) => [-(x - cx) * m, (my1 - y) * m, -h * m];
  else if (side) place = (x, y, h) => [h * m, (my1 - y) * m + lift, -(x - cx) * m];
  else if (noseUp) place = (x, y, h) => [(x - cx) * m, h * m, (y - cy) * m];
  else place = (x, y, h) => [(y - cy) * m, h * m, -(x - cx) * m];

  const frontIdx = new Int32Array(VC * (rows + 1)).fill(-1), backIdx = new Int32Array(VC * (rows + 1)).fill(-1);
  const pos = [], uv = [], col = [];
  const push = (x, y, h, shade) => {
    const p = place(x, y, h);
    pos.push(p[0], p[1], p[2]);
    uv.push((x * tex.s) / tex.tw, (y * tex.s) / tex.th);
    col.push(shade, shade, shade);
    return pos.length / 3 - 1;
  };
  for (let v = 0; v < used.length; v++) {
    if (!used[v]) continue;
    const h = rim[v] ? 0 : hAt(gx[v], gy[v]);
    frontIdx[v] = push(gx[v], gy[v], h, rim[v] ? (1 + K.backShade) / 2 : 1);
    backIdx[v] = rim[v] ? frontIdx[v] : push(gx[v], gy[v], -h, K.backShade);
  }
  const index = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!cell[r * cols + c]) continue;
    const a = r * VC + c, b = a + 1, d = a + VC, e = d + 1;
    index.push(frontIdx[a], frontIdx[d], frontIdx[b], frontIdx[b], frontIdx[d], frontIdx[e]);
    index.push(backIdx[a], backIdx[b], backIdx[d], backIdx[b], backIdx[e], backIdx[d]);
  }
  // Winding: the first front triangle must face the front direction; flip everything otherwise.
  const front = kind === "person" ? new THREE.Vector3(0, 0, -1) : side ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const P = (i) => new THREE.Vector3(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
  const n0 = new THREE.Vector3().crossVectors(P(index[1]).sub(P(index[0])), P(index[2]).sub(P(index[0])));
  if (n0.dot(front) < 0) for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  // Sockets from the silhouette (grid pixels → metres).
  const S = kind === "person" ? personSockets(mask, W, H, hf, mx0, my0, mx1, my1) : side ? sideSockets(mask, W, H, hf, mx0, my0, mx1, my1) : shipSockets(mask, W, H, hf, noseUp);
  const socketSpecs = Object.entries(S).map(([name, [x, y, h]]) => ({ name, p: place(x, y, h) }));
  if (kind === "person") socketSpecs.find((s) => s.name === "feet").p[1] = 0;

  // Wheels: a pivot at the wheel centre (on the body's middle plane) holding one mesh with the disc(s).
  const heightNear = (gcx, gcy, rpx) => { // the body's biggest half-thickness (m) inside a circle of the drawing
    let best = 0;
    for (let y = Math.max(0, Math.floor(gcy - rpx)); y <= Math.min(H - 1, Math.ceil(gcy + rpx)); y++) {
      for (let x = Math.max(0, Math.floor(gcx - rpx)); x <= Math.min(W - 1, Math.ceil(gcx + rpx)); x++) {
        if ((x - gcx) * (x - gcx) + (y - gcy) * (y - gcy) <= rpx * rpx && hf[y * W + x] > best) best = hf[y * W + x];
      }
    }
    return best * m;
  };
  const wheelSpecs = [];
  for (const w of wheelList) {
    const R = w.r * m, Yc = w.plain ? R : (my1 - w.cy) * m + lift, Zc = -(w.cx - cx) * m;
    const Hw = w.plain ? Hmax * m * 0.8 : heightNear(w.cx, w.cy, w.r);
    let td, xs;
    if (K.twin) { td = Math.min(0.36, Math.max(0.16, 0.6 * R)); xs = [Hw * 0.78 + td / 2, -(Hw * 0.78 + td / 2)]; } // an axle: a disc on each side
    else { td = Math.max(0.2, 2 * (Hw + 0.03)); xs = [0]; } // one fat disc in the middle plane
    const ucx = w.ux ?? w.cx, ucy = w.uy ?? w.cy;
    const uvAt = w.plain ? () => [0.004, 0.004] : (y, z) => [((ucx - z / m) * tex.s) / tex.tw, ((ucy - y / m) * tex.s) / tex.th];
    wheelSpecs.push({ p: [0, Yc, Zc], R, drawn: !w.plain, geo: wheelGeometry({ R, hw: td / 2, xs, seg, uvAt, plain: !!w.plain, backShade: K.backShade }) });
  }

  // A view of the inflated drawing: shared geometry and texture, its own material (so flashes and fades are per view).
  const instance = (o = {}) => {
    const material = makeMaterial(tex.tex, o.color ?? color);
    const root = new THREE.Group();
    root.name = `drawn_${kind}`;
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `inflated_${kind}`;
    root.add(mesh);
    const sockets = {};
    for (const s of socketSpecs) {
      const ob = new THREE.Object3D();
      ob.name = `socket_${s.name}`;
      ob.position.fromArray(s.p);
      root.add(ob);
      sockets[s.name] = ob;
    }
    const wheels = [];
    for (const w of wheelSpecs) {
      const pivot = new THREE.Group();
      pivot.name = "wheel";
      pivot.position.fromArray(w.p);
      pivot.add(new THREE.Mesh(w.geo, material));
      root.add(pivot);
      wheels.push({ pivot, radius: w.R, drawn: w.drawn });
    }
    return { object3d: root, sockets, wheels, materials: [material], kind, dispose() { material.dispose(); root.removeFromParent(); } };
  };
  const first = instance();
  mark("done");

  const bb = geo.boundingBox;
  const size = { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z };
  const standing = kind === "person" || side;
  let radius = 0;
  for (let i = 0; i < pos.length; i += 3) radius = Math.max(radius, Math.hypot(pos[i], standing ? 0 : pos[i + 1], pos[i + 2]));
  if (standing) radius = Math.max(radius, size.y / 2);
  let triangles = index.length / 3;
  for (const w of wheelSpecs) triangles += w.geo.index.count / 3;
  return {
    object3d: first.object3d, sockets: first.sockets, wheels: first.wheels, materials: first.materials,
    radius, size, kind, noseUp, plainWheels, triangles, vertices: pos.length / 3, texture: { w: tex.tw, h: tex.th },
    ms: Math.round((performance.now() - t0) * 10) / 10,
    instance,
    dispose() { geo.dispose(); for (const w of wheelSpecs) w.geo.dispose(); tex.tex.dispose(); first.dispose(); },
  };
}

// For tests: the stages of the pipeline.
export const __test = { readInk, silhouette, findWheels };

// Side-view sockets in grid px [x, y, h]; forward is +x (the drawing's right).
function sideSockets(mask, W, H, hf, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0;
  const avg = (xa, xb, ya, yb, fallback) => {
    let ax = 0, ay = 0, k = 0;
    for (let y = Math.max(0, Math.floor(ya)); y < Math.min(H, Math.ceil(yb)); y++) {
      for (let x = Math.max(0, Math.floor(xa)); x < Math.min(W, Math.ceil(xb)); x++) if (mask[y * W + x]) { ax += x; ay += y; k++; }
    }
    return k ? [ax / k + 0.5, ay / k + 0.5] : fallback;
  };
  const mid = [(x0 + x1) / 2, (y0 + y1) / 2];
  const centre = avg(x0, x1, y0, y1, mid);
  const front = avg(x1 - Math.max(2, w * 0.05), x1, y0, y1, [x1, mid[1]]);
  const back = avg(x0, x0 + Math.max(2, w * 0.05), y0, y1, [x0, mid[1]]);
  const roof = avg(x0, x1, y0, y0 + Math.max(2, h * 0.06), [mid[0], y0]);
  const mouth = avg(x1 - Math.max(2, w * 0.06), x1, y0, y0 + h * 0.7, front);
  const tail = avg(x0, x0 + Math.max(2, w * 0.06), y0, y0 + h * 0.7, back);
  // The highest point of the middle third: where a rider sits.
  let sx = mid[0], sy = y1;
  for (let x = Math.floor(x0 + w / 3); x < Math.ceil(x1 - w / 3); x++) {
    for (let y = y0; y < y1; y++) if (mask[y * W + x]) { if (y < sy) { sy = y; sx = x; } break; }
  }
  const seat = [sx + 0.5, sy + h * 0.1, 0];
  seat[2] = hf[Math.round(seat[1]) * W + Math.round(seat[0])] || 0;
  const flat = (p) => [p[0], p[1], 0];
  return { front: flat(front), back: flat(back), roof: flat(roof), top: flat(roof), seat, mouth: flat(mouth), tail: flat(tail), centre: flat(centre) };
}

// Ship sockets in grid pixels [x, y, h]. "forward" is +x (drawing's right) or -y (top) when noseUp.
function shipSockets(mask, W, H, hf, noseUp) {
  // Work in (f, l): f forward, l lateral (left = smaller l after the turn). Collect inside pixels.
  const F = (x, y) => (noseUp ? -y : x), Lat = (x, y) => (noseUp ? x : y);
  let fMin = Infinity, fMax = -Infinity, lMin = Infinity, lMax = -Infinity, sx = 0, sy = 0, n = 0, top = -1, topI = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!mask[i]) continue;
    const f = F(x, y), l = Lat(x, y);
    fMin = Math.min(fMin, f); fMax = Math.max(fMax, f); lMin = Math.min(lMin, l); lMax = Math.max(lMax, l);
    sx += x; sy += y; n++;
    if (hf[i] > top) { top = hf[i]; topI = i; }
  }
  const band = (fa, fb) => { // inside pixels with f in [fa, fb]: mean x, y and lateral extent
    let ax = 0, ay = 0, k = 0, a = Infinity, b = -Infinity, ex = 0, ey = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      const f = F(x, y);
      if (f < fa || f > fb) continue;
      ax += x; ay += y; k++;
      const l = Lat(x, y);
      if (l < a) a = l; if (l > b) b = l;
    }
    return k ? { x: ax / k, y: ay / k, a, b } : null;
  };
  const len = fMax - fMin, wid = lMax - lMin;
  const nose = band(fMax - len * 0.04, fMax), tail = band(fMin, fMin + len * 0.12);
  const xy = (f, l) => (noseUp ? [l, -f] : [f, l]);
  const extreme = (wantMin) => { // the widest point sideways, averaged over a thin band
    let ax = 0, ay = 0, k = 0;
    const lim = wantMin ? lMin + wid * 0.04 : lMax - wid * 0.04;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      const l = Lat(x, y);
      if (wantMin ? l <= lim : l >= lim) { ax += x; ay += y; k++; }
    }
    return [ax / k, ay / k];
  };
  const [cx, cy] = [sx / n, sy / n];
  const hC = hf[Math.round(cy) * W + Math.round(cx)] || top * 0.5;
  // Facing -Z, left is -X. Not noseUp: X = (y - cy), so smaller y = left. noseUp: X = (x - cx), smaller x = left.
  const wl = extreme(true), wr = extreme(false);
  // The rearmost body pixel on a lateral line (so engines sit on the hull, not in the gap between two fins).
  const rearAt = (l0) => {
    let best = Infinity;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!mask[y * W + x] || Math.abs(Lat(x, y) - l0) > 1.5) continue;
      const f = F(x, y);
      if (f < best) best = f;
    }
    return xy((best === Infinity ? fMin : best) + 0.5, l0);
  };
  const lMid = Lat(tail.x, tail.y), spread = Math.min((tail.b - tail.a) * 0.14, wid * 0.12);
  const [tx0, ty0] = rearAt(lMid - spread), [tx1, ty1] = rearAt(lMid + spread);
  const [nx, ny] = xy(fMax + 0.5, Lat(nose.x, nose.y));
  const [bx, by] = rearAt(lMid);
  return {
    nose: [nx, ny, 0],
    back: [bx, by, 0],
    wing_l: [wl[0], wl[1], 0],
    wing_r: [wr[0], wr[1], 0],
    belly: [cx, cy, -hC],
    seat: [topI % W, Math.floor(topI / W), top],
    engine_l: [tx0, ty0, 0],
    engine_r: [tx1, ty1, 0],
  };
}

// Person sockets: head at the top, hands at the widest points of the middle band, feet at the bottom centre.
function personSockets(mask, W, H, hf, x0, y0, x1, y1) {
  const h = y1 - y0;
  const rowsAvg = (ya, yb) => {
    let ax = 0, ay = 0, k = 0;
    for (let y = Math.max(0, Math.floor(ya)); y < Math.min(H, Math.ceil(yb)); y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { ax += x; ay += y; k++; }
    return k ? [ax / k, ay / k] : [(x0 + x1) / 2, (ya + yb) / 2];
  };
  const head = rowsAvg(y0, y0 + h * 0.18);
  // hands: leftmost / rightmost inside pixels between 22 % and 70 % of the height
  let lx = Infinity, ly = 0, rx = -Infinity, ry = 0;
  for (let y = Math.floor(y0 + h * 0.22); y < y0 + h * 0.7; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    if (x < lx) { lx = x; ly = y; }
    if (x > rx) { rx = x; ry = y; }
  }
  const chest = rowsAvg(y0 + h * 0.3, y0 + h * 0.45);
  const hAt = (p) => hf[Math.round(p[1]) * W + Math.round(p[0])] || 0;
  // The person faces -Z: the image's left is the person's right hand.
  return {
    head: [head[0], head[1], hAt(head) * 0.5],
    hand_r: [lx + 0.5, ly, 0],
    hand_l: [rx + 0.5, ry, 0],
    feet: [(x0 + x1) / 2, y1, 0],
    back: [chest[0], chest[1], -hAt(chest)],
  };
}

// Load a drawing URL → ImageBitmap or HTMLImageElement. Cached per URL (at most 24 kept), unless `fresh`: then the caller
// owns the image (call image.close?.() once it is inflated, the pixels are not needed after that).
async function fetchDrawing(url) {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`drawing ${res.status}`);
  const blob = await res.blob();
  try { return await createImageBitmap(blob); } catch {}
  const img = new Image();
  const objectUrl = URL.createObjectURL(blob);
  img.src = objectUrl;
  try { await img.decode(); } finally { URL.revokeObjectURL(objectUrl); }
  return img;
}
const loaded = new Map();
export function loadDrawing(url, { fresh = false } = {}) {
  if (fresh) return fetchDrawing(url);
  if (!loaded.has(url)) {
    const p = fetchDrawing(url);
    p.catch(() => loaded.delete(url));
    loaded.set(url, p);
    if (loaded.size > 24) loaded.delete(loaded.keys().next().value);
  }
  return loaded.get(url);
}
