// The ship drawings of the v14 model comparison (compare.mjs): 12 drawings, a mix of clean, messy, side-view, top-view,
// coloured and photos of paper drawings. 10 come from the committed corpora; 2 coloured ones are generated here
// (deterministic PNGs: the corpus is all dark pen, and the spec must prove it reads the drawing's colours).
//   import { SHIPS, imageOf } from "./drawings.mjs"   → imageOf(d) = { dataUrl, bytes, mime, file }
//   node dev/v14-ship/drawings.mjs --write           writes the generated ones to dev/v14-ship/drawings/
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { encodePng } from "../v13-entity/drawings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");

// skills: what the entity reading unlocked for it (the corpus's must list; compare.mjs reconciles the spec with them).
export const SHIPS = [
  { id: "E01-plain-fighter", file: "dev/gen-corpus/entity/E01.png", source: "draw", view: "side", desc: "plain fighter (clean)", skills: [] },
  { id: "E04-cannon-flames", file: "dev/gen-corpus/entity/E04.png", source: "draw", view: "side", desc: "fighter + cannon + flames", skills: ["shoot", "boost"] },
  { id: "E06-nose-drill", file: "dev/gen-corpus/entity/E06.png", source: "draw", view: "side", desc: "fighter + drill on the nose", skills: ["shoot"] },
  { id: "E08-saucer", file: "dev/gen-corpus/entity/E08.png", source: "draw", view: "side", desc: "saucer + legs + lamp", skills: ["land", "flare"] },
  { id: "E09-rocket", file: "dev/gen-corpus/entity/E09.png", source: "draw", view: "side", desc: "rocket (nose up) + flames + legs", skills: ["boost", "land"] },
  { id: "E10-chunky", file: "dev/gen-corpus/entity/E10.png", source: "draw", view: "side", desc: "chunky box ship: cannon, drill, flames, legs", skills: ["shoot", "boost", "land"] },
  { id: "genqa-topview", file: "dev/v14-ship/drawings/genqa-topview.png", source: "draw", view: "top", desc: "top view: fighter with wings spread, gun, flames", skills: ["shoot", "boost"] },
  { id: "jaume-jet", file: "dev/gen-corpus/real/jaume-ship-drawn-in-controller-step.png", source: "draw", view: "side", desc: "the owner's own jet (real, finger)", skills: ["shoot", "boost"] },
  { id: "photo-E13", file: "dev/gen-corpus/photos/E13.jpg", source: "photo", view: "side", desc: "PHOTO on lined paper: fighter + cannon + flames", skills: ["shoot", "boost"] },
  { id: "photo-E16", file: "dev/gen-corpus/photos/E16.jpg", source: "photo", view: "side", desc: "PHOTO with a thumb: box ship + bomb + shield bubble", skills: ["blast", "shield"] },
  { id: "color-topview", gen: "colorTop", source: "draw", view: "top", desc: "generated: coloured top view (red hull, yellow wings, blue canopy, orange flames, wing guns)", skills: ["shoot", "boost"] },
  { id: "color-messy", gen: "colorMessy", source: "draw", view: "side", desc: "generated: messy coloured scribble (green blob, purple dome, orange flames, antenna)", skills: ["boost", "scan"] },
];

// ---- Generated drawings ---------------------------------------------------------------------------------------------

function page(w, h) {
  const px = new Uint8Array(w * h * 4).fill(255);
  const put = (x, y, c, a = 1) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * (1 - a) + c[k] * a);
  };
  const dot = (cx, cy, r, c) => {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const a = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
      if (a) put(x, y, c, a);
    }
  };
  const line = (pts, r, c, closed = false) => {
    const P = closed ? [...pts, pts[0]] : pts;
    for (let i = 0; i + 1 < P.length; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[i + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
      for (let k = 0; k <= n; k++) dot(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, r, c);
    }
  };
  const fill = (pts, c) => { // even-odd scanline fill
    const ys = pts.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
        if ((y0 <= y + 0.5) !== (y1 <= y + 0.5)) xs.push(x0 + (y + 0.5 - y0) / (y1 - y0) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.ceil(xs[i]); x < xs[i + 1]; x++) put(x, y, c);
    }
  };
  const ellipse = (cx, cy, rx, ry, n = 48, wob = 0, seed = 1) => Array.from({ length: n }, (_, i) => {
    const t = i / n * Math.PI * 2, k = 1 + wob * Math.sin(t * 3 + seed) * Math.cos(t * 5 + seed * 2);
    return [cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k];
  });
  return { w, h, px, line, fill, ellipse, png: () => encodePng(w, h, px) };
}
const INK = [24, 24, 32], RED = [230, 57, 70], YEL = [255, 210, 63], BLUE = [76, 201, 240], ORANGE = [255, 123, 0], GREY = [90, 96, 110];
const GREEN = [42, 157, 143], PURPLE = [131, 56, 236];

// Top view, nose to the right: red fuselage, yellow delta wings, blue canopy, guns on the wings, orange flames.
function colorTop() {
  const p = page(512, 400);
  const body = [[95, 200], [140, 176], [380, 180], [472, 200], [380, 220], [140, 224]];
  const wingT = [[190, 182], [330, 182], [225, 42]], wingB = [[190, 218], [330, 218], [225, 358]];
  const finT = [[100, 192], [160, 186], [92, 140]], finB = [[100, 208], [160, 214], [92, 260]];
  for (const [poly, c] of [[wingT, YEL], [wingB, YEL], [finT, RED], [finB, RED], [body, RED]]) { p.fill(poly, c); p.line(poly, 2.6, INK, true); }
  const can = p.ellipse(372, 200, 34, 13);
  p.fill(can, BLUE); p.line(can, 2.4, INK, true);
  p.line([[250, 112], [318, 112]], 4, GREY); p.line([[250, 288], [318, 288]], 4, GREY);
  for (const y of [190, 210]) p.line([[92, y], [62, y - 9], [74, y], [40, y - 5], [60, y + 4], [22, y + 1]], 3, ORANGE);
  return p.png();
}
// A messy side view: a wobbly green blob hull drawn twice, a purple scribbled dome, orange scribble flames, a crooked antenna.
function colorMessy() {
  const p = page(512, 360);
  p.line(p.ellipse(250, 210, 170, 70, 60, 0.07, 2), 3.2, GREEN, true);
  p.line(p.ellipse(254, 206, 166, 74, 60, 0.09, 5), 2.2, GREEN, true);
  const dome = [[190, 150], [205, 108], [240, 92], [282, 98], [306, 128], [312, 152]];
  p.line(dome, 3, PURPLE);
  for (let i = 0; i < 7; i++) p.line([[200 + i * 15, 148 - (i % 2) * 8], [212 + i * 15, 112 + (i % 3) * 6]], 1.6, PURPLE);
  for (let i = 0; i < 4; i++) p.line([[82, 190 + i * 12], [54, 182 + i * 14], [70, 196 + i * 11], [30, 188 + i * 13]], 2.4, ORANGE);
  p.line([[300, 140], [318, 70], [326, 58]], 2.6, INK); p.line(p.ellipse(330, 52, 9, 9, 20), 2.4, INK, true);
  for (const x of [160, 250, 340]) p.line(p.ellipse(x, 214, 13, 13, 24, 0.1, x), 2.4, INK, true);
  return p.png();
}
const GENERATORS = { colorTop, colorMessy };

export function imageOf(d) {
  if (d.gen) {
    const file = path.join(HERE, "drawings", `${d.id}.png`);
    let bytes;
    if (fs.existsSync(file)) bytes = fs.readFileSync(file);
    else { bytes = GENERATORS[d.gen](); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
    return { bytes, mime: "image/png", file: path.relative(ROOT, file), dataUrl: `data:image/png;base64,${bytes.toString("base64")}` };
  }
  const file = path.join(ROOT, d.file);
  const bytes = fs.readFileSync(file);
  const mime = /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
  return { bytes, mime, file: d.file, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--write")) {
  for (const d of SHIPS.filter((x) => x.gen)) { fs.rmSync(path.join(HERE, "drawings", `${d.id}.png`), { force: true }); console.log(imageOf(d).file); }
}
