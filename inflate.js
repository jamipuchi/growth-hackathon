// inflate.js: a drawing becomes a plush 3D body on the device (PLAN.md section 6, "Look"). No model call.
//
//   inflateDrawing(inkImage, { kind: "ship"|"person", size, quality: "phone"|"big", color, noseUp })
//     → { object3d, sockets, radius, materials, triangles, ms, size: {x, y, z}, dispose() }
//
// inkImage: ImageBitmap | HTMLImageElement | canvas. Transparent ink on nothing (the phone's ink PNG); an opaque
// drawing (dark ink on white paper) works too: the ink is then taken from the darkness.
// Steps: ink mask → close small gaps (dilate, fill enclosed regions, erode) → drop specks → distance transform →
// round "plush" heights → a front and a mirrored darker back sharing one rim → the drawing as the texture.
//   ship:   lies flat, front (the drawing) on top (+Y), nose towards -Z. The nose is the drawing's right side, or its
//           top when the drawing is clearly taller than wide (noseUp: true/false forces it). Centred on the origin.
//   person: stands up on y = 0 facing -Z (the drawing is its front), centred in x and z.
// sockets: Object3D children named socket_<name> (anim.js finds them by traversal) and returned by name:
//   ship   nose, wing_l, wing_r, back, belly, seat, engine_l, engine_r
//   person head, hand_l, hand_r, feet, back
// Budgets: ≤ 4k triangles ("phone"), ≤ 12k ("big"), one texture ≤ 512 px.
import * as THREE from "three";

const Q = {
  phone: { maskPx: 112, tris: 4000, texPx: 384 },
  big: { maskPx: 160, tris: 12000, texPx: 512 },
};
const KIND = {
  ship: { thick: 0.55, grow: 0.028, closes: [0.035, 0.07, 0.11], backShade: 0.62 },
  person: { thick: 0.62, grow: 0.03, closes: [0.03], backShade: 0.62 },
};
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
  return { mask, W, H, pad, box: { x0, y0, bw, bh }, k, gw, gh };
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
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.82, metalness: 0.0 });
  const rim = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uRim;")
      .replace("#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n  float rimF = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);\n  totalEmissiveRadiance += uRim * rimF * 0.45;");
  };
  mat.customProgramCacheKey = () => "inflate-rim";
  return mat;
}

// ---- Inflate -------------------------------------------------------------------------------------------------------

export function inflateDrawing(inkImage, opts = {}) {
  const t0 = performance.now();
  const kind = opts.kind === "person" ? "person" : "ship";
  const quality = Q[opts.quality] ? opts.quality : "phone";
  const { maskPx, tris: triBudget, texPx } = Q[quality];
  const K = KIND[kind];
  const color = opts.color ?? 0x22d3ee;
  const sizeM = opts.size || (kind === "ship" ? 3.2 : 1.8);

  const src = readInk(inkImage, Math.max(texPx, maskPx * 2));
  const sil = silhouette(src, kind, maskPx);
  const { mask, W, H } = sil;

  // Heights: distance to the outline, a round profile (sqrt-ish) so it is soft like a plush toy, then one blur.
  const dist = distance(mask, W, H);
  let D = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > D) D = dist[i];
  const hRaw = new Float32Array(W * H);
  for (let i = 0; i < hRaw.length; i++) {
    if (!mask[i]) continue;
    const t = Math.min(1, dist[i] / D);
    hRaw[i] = K.thick * D * Math.sqrt(t * (2 - t));
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

  // Orientation: grid (x right, y down) → metres. Longest side of the silhouette = sizeM.
  let mx0 = W, my0 = H, mx1 = 0, my1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; if (y < my0) my0 = y; if (y > my1) my1 = y; }
  mx1 += 1; my1 += 1;
  const sw = mx1 - mx0, sh = my1 - my0;
  const m = sizeM / Math.max(sw, sh);
  const cx = (mx0 + mx1) / 2, cy = (my0 + my1) / 2;
  const noseUp = opts.noseUp ?? sh > sw * 1.25;
  const tex = makeTexture(src, sil, color, texPx);
  // place(x, y, h) → [X, Y, Z]: front side h > 0, back side h < 0.
  let place;
  if (kind === "person") place = (x, y, h) => [-(x - cx) * m, (my1 - y) * m, -h * m];
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
  const front = kind === "person" ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
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
  const material = makeMaterial(tex.tex, color);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = `inflated_${kind}`;

  const object3d = new THREE.Group();
  object3d.name = `drawn_${kind}`;
  object3d.add(mesh);

  // Sockets from the silhouette (grid pixels → metres).
  const S = kind === "person" ? personSockets(mask, W, H, hf, mx0, my0, mx1, my1) : shipSockets(mask, W, H, hf, noseUp);
  const sockets = {};
  for (const [name, [x, y, h]] of Object.entries(S)) {
    const o = new THREE.Object3D();
    o.name = `socket_${name}`;
    o.position.fromArray(place(x, y, h));
    object3d.add(o);
    sockets[name] = o;
  }
  if (kind === "person") sockets.feet.position.y = 0;

  const bb = geo.boundingBox;
  const size = { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z };
  let radius = 0;
  for (let i = 0; i < pos.length; i += 3) radius = Math.max(radius, Math.hypot(pos[i], kind === "person" ? 0 : pos[i + 1], pos[i + 2]));
  if (kind === "person") radius = Math.max(radius, size.y / 2);
  return {
    object3d, sockets, radius, size, materials: [material], kind, noseUp,
    triangles: index.length / 3, vertices: pos.length / 3, texture: { w: tex.tw, h: tex.th },
    ms: Math.round((performance.now() - t0) * 10) / 10,
    dispose() { geo.dispose(); material.dispose(); tex.tex.dispose(); object3d.removeFromParent(); },
  };
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

// Load a drawing URL once (cached per URL) → ImageBitmap or HTMLImageElement.
const loaded = new Map();
export function loadDrawing(url) {
  if (!loaded.has(url)) {
    const p = (async () => {
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) throw new Error(`drawing ${res.status}`);
      const blob = await res.blob();
      try { return await createImageBitmap(blob); } catch {}
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      await img.decode();
      return img;
    })();
    p.catch(() => loaded.delete(url));
    loaded.set(url, p);
  }
  return loaded.get(url);
}
