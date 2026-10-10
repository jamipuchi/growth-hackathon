// The entity drawings the v1.3 entity kit posts (run.mjs), one per case of PLAN.md section 0 / contract.js entity types:
// a ship with a gun and exhaust flames, a plain ship, a ship with landing legs, a photo of a ship, an astronaut with a
// shovel, an astronaut with a drill, a car, a bike, an animal, a blob, a controller drawn in the ship step and in the
// explorer step (the wrong kind), and an unreadable scribble.
//
// Every drawing but the scribble is reused from the generation corpus (dev/gen-corpus, committed; desc and must/ok
// skills from its .json), whose fixtures hold the REAL gpt-6.1-sol answer recorded for that exact image
// (dev/gen-corpus/fixtures/{after,confirm}/<id>.json, keyed by sha1 of the data URL): server.cjs replays them. The
// scribble is generated here (a deterministic PNG, no dependency), with a scripted model answer ("nothing").
//
//   import { DRAWINGS, loadDrawing, dataUrlOf, encodePng } from "./drawings.mjs"
//   node dev/v13-entity/drawings.mjs --write      writes every drawing to dev/v13-entity/drawings/<id>.png (for a look)
//   node dev/v13-entity/drawings.mjs --list       prints the manifest
//
// expect (what run.mjs checks; "generous": the drawn gate skills must be unlocked, extra skills are fine):
//   ok: true      an entity comes back; types: the allowed entity types; must: skills that MUST be unlocked;
//                 none: true = nothing may be unlocked (a plain drawing only moves; soft with a real model)
//   ok: false     refused in plain words: error (Astra's), message (a RegExp on the server's plain text); anyway: true =
//                 "Use it anyway" (anyway: true) then answers an entity
//   ok: "either"  a scribble: refused in plain words, or (a generous real model) a plain entity; both are fine
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
const CORPUS = path.join(ROOT, "dev/gen-corpus");

// player: the name the kit joins with (Contract.cleanName: a-z0-9, at most 20). world: where it is posted (space = the
// lobby, planet = after /__test/planet landed the player). corpus: dev/gen-corpus/<dir>/<id>.png.
export const DRAWINGS = [
  { id: "ship-gun-flames", player: "kshipgun", kind: "ship", world: "space", corpus: "entity/E04", source: "draw",
    desc: "fighter with a cannon and exhaust flames", expect: { ok: true, types: ["ship"], must: ["shoot", "boost"] } },
  { id: "ship-plain", player: "kshipplain", kind: "ship", world: "space", corpus: "entity/E01", source: "draw",
    desc: "plain fighter: only flies", expect: { ok: true, types: ["ship"], must: [], none: true } },
  { id: "ship-landing-legs", player: "kshiplegs", kind: "ship", world: "space", corpus: "entity/E05", source: "draw",
    desc: "fighter with landing legs (the LAND gate)", expect: { ok: true, types: ["ship"], must: ["land"] } },
  // The same landing-legs drawing for a second player who then LANDS with it (its drawn skill, no help from the test
  // hook): the parked ship on the pad must show this drawing (world.island.parked[].image). Not rebuilt in the browsers.
  { id: "ship-lands", player: "klander", kind: "ship", world: "space", corpus: "entity/E05", source: "draw", lands: true,
    desc: "the landing-legs ship, landed with its own LAND: the pad shows its drawing", expect: { ok: true, types: ["ship"], must: ["land"] } },
  { id: "ship-photo", player: "kshipphoto", kind: "ship", world: "space", corpus: "entity/E13", source: "photo",
    desc: "photo of a paper drawing: fighter, cannon, flames", expect: { ok: true, types: ["ship"], must: ["shoot", "boost"] } },
  { id: "ship-wrong-controller", player: "kshipwrong", kind: "ship", world: "space", corpus: "wrong/W09", source: "draw",
    desc: "a controller (stick, FIRE, BOOST) drawn in the ship step",
    expect: { ok: false, error: "looks like a controller", looksLike: "controller", message: /looks like a controller/i, anyway: true } },
  { id: "ship-scribble", player: "kscribble", kind: "ship", world: "space", gen: "scribble", source: "draw",
    desc: "an unreadable scribble", expect: { ok: "either", error: "nothing to read", message: /drawing|bigger|darker|read/i },
    script: { looksLike: "nothing", type: "ship", parts: [], verbs: [], unlocked: [] } },
  { id: "astronaut-shovel", player: "kastroshovel", kind: "explorer", world: "planet", corpus: "entity/E17", source: "draw",
    desc: "astronaut holding a shovel (the DIG gate)", expect: { ok: true, types: ["person"], must: ["dig"] } },
  { id: "astronaut-drill", player: "kastrodrill", kind: "explorer", world: "planet", corpus: "entity/E18", source: "draw",
    desc: "astronaut with a hand drill (the DRILL gate)", expect: { ok: true, types: ["person"], must: ["drill"] } },
  { id: "car-cannon", player: "kcar", kind: "explorer", world: "planet", corpus: "entity/E23", source: "draw",
    desc: "car with a cannon on the roof", expect: { ok: true, types: ["car"], must: ["shoot"] } },
  { id: "bike-lamp", player: "kbike", kind: "explorer", world: "planet", corpus: "entity/E26", source: "draw",
    desc: "bike with a headlamp", expect: { ok: true, types: ["bike"], must: ["flare"] } },
  { id: "dog-claws", player: "kdog", kind: "explorer", world: "planet", corpus: "entity/E28", source: "draw",
    desc: "dog with big digging claws (an animal: quadruped)", expect: { ok: true, types: ["quadruped"], must: ["dig"] } },
  { id: "blob", player: "kblob", kind: "explorer", world: "planet", corpus: "entity/E29", source: "draw",
    desc: "a blob with a face (the fallback type)", expect: { ok: true, types: ["blob"], must: [], none: true } },
  { id: "explorer-wrong-controller", player: "kexplwrong", kind: "explorer", world: "planet", corpus: "wrong/W11", source: "draw",
    desc: "a controller (stick, DIG, JUMP) drawn in the explorer step",
    expect: { ok: false, error: "looks like a controller", looksLike: "controller", message: /looks like a controller/i, anyway: true } },
];

// ---- A tiny PNG encoder (RGBA, 8 bit, no filter) -----------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
// rgba: a Uint8Array / Buffer of w × h × 4 bytes.
export function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- Generated drawings: dark ink strokes on a transparent page, like the phone's ink PNG --------------------------

function canvas(w, h) {
  const px = new Uint8Array(w * h * 4);
  const INK = [22, 22, 30];
  // A round pen of radius r, anti-aliased at the edge, stamped every half pixel along each segment.
  function dot(cx, cy, r) {
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const a = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
        if (!a) continue;
        const i = (y * w + x) * 4;
        const alpha = Math.max(px[i + 3], Math.round(a * 255));
        px[i] = INK[0]; px[i + 1] = INK[1]; px[i + 2] = INK[2]; px[i + 3] = alpha;
      }
    }
  }
  function stroke(points, r = 3) {
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      if (i === 0) { dot(x, y, r); continue; }
      const [px0, py0] = points[i - 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x - px0, y - py0) * 2));
      for (let k = 1; k <= n; k++) dot(px0 + ((x - px0) * k) / n, py0 + ((y - py0) * k) / n, r);
    }
  }
  return { px, stroke, png: () => encodePng(w, h, px) };
}

// A seeded PRNG (mulberry32): the same scribble every run, so its hash (and its scripted answer) never changes.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Catmull-Rom through the control points: a smooth pen path.
function spline(ctrl, steps = 10) {
  const out = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

// An unreadable scribble: one tangled pen line looping over itself in a ball, the way a child scribbles something out.
function scribble() {
  const W = 512, H = 420, c = canvas(W, H), rand = rng(1310);
  const ctrl = [];
  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 2, r = 40 + rand() * 140;
    ctrl.push([W / 2 + Math.cos(a) * r * 1.25, H / 2 + Math.sin(a) * r * 0.95]);
  }
  c.stroke(spline(ctrl, 12), 2.6);
  // a few hard zigzags across it
  const zig = [];
  for (let i = 0; i < 14; i++) zig.push([90 + i * 24 + rand() * 10, i % 2 ? 120 + rand() * 30 : 290 + rand() * 30]);
  c.stroke(zig, 2.2);
  return c.png();
}

const GENERATORS = { scribble };

// ---- Loading --------------------------------------------------------------------------------------------------------

export const corpusFile = (d) => (d.corpus ? path.join(CORPUS, `${d.corpus}.png`) : null);
const cache = new Map();
// The PNG bytes of a drawing (a corpus file, or generated).
export function loadDrawing(d) {
  if (cache.has(d.id)) return cache.get(d.id);
  let buf;
  if (d.gen) {
    const make = GENERATORS[d.gen];
    if (!make) throw new Error(`${d.id}: no generator "${d.gen}"`);
    buf = make();
  } else {
    const file = corpusFile(d);
    if (!file || !fs.existsSync(file)) throw new Error(`${d.id}: corpus drawing missing (${file})`);
    buf = fs.readFileSync(file);
  }
  cache.set(d.id, buf);
  return buf;
}
// What the phone posts as `image`: a PNG data URL (the server keeps PNGs only, at most 1024 px a side).
export const dataUrlOf = (buf) => `data:image/png;base64,${buf.toString("base64")}`;
// The key the replay fetch uses (dev/astra/fake-openai.cjs and the corpus fixtures: sha1 of the image data URL).
export const imageSha = (dataUrl) => crypto.createHash("sha1").update(dataUrl).digest("hex");
// PNG width × height from the IHDR chunk.
export const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
// The corpus metadata for a drawing (desc, must / ok skills), or null.
export function corpusMeta(d) {
  if (!d.corpus) return null;
  try { return JSON.parse(fs.readFileSync(path.join(CORPUS, `${d.corpus}.json`), "utf8")); } catch { return null; }
}

// ---- CLI ------------------------------------------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--write")) {
    const dir = path.join(HERE, "drawings");
    fs.mkdirSync(dir, { recursive: true });
    for (const d of DRAWINGS) {
      const buf = loadDrawing(d);
      fs.writeFileSync(path.join(dir, `${d.id}.png`), buf);
      const { w, h } = pngSize(buf);
      console.log(`${d.id.padEnd(26)} ${String(w).padStart(4)}x${String(h).padEnd(4)} ${String(buf.length).padStart(6)} B  ${d.gen ? `generated (${d.gen})` : d.corpus}`);
    }
  } else {
    for (const d of DRAWINGS) console.log(`${d.id.padEnd(26)} ${d.kind.padEnd(8)} ${d.world.padEnd(6)} ${(d.gen ? `gen:${d.gen}` : d.corpus).padEnd(12)} ${d.desc}`);
    if (!args.includes("--list")) console.log("\n--write writes them to dev/v13-entity/drawings/");
  }
}
