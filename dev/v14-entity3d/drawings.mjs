// The planet-entity drawings of the v14 body-spec test (compare.mjs): 10 drawings. 6 come from the committed entity corpus
// (dark pen: astronauts, a car, a bike, a dog, a blob); 4 coloured ones are generated here (deterministic PNGs drawn like a
// kid's marker drawing: thick dark outlines and flat fills; the spec must prove it reads the drawing's colours).
//   import { BODIES, imageOf } from "./drawings.mjs"   → imageOf(d) = { dataUrl, bytes, mime, file }
//   node dev/v14-entity3d/drawings.mjs --write        writes the generated ones to dev/v14-entity3d/drawings/
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { encodePng } from "../v13-entity/drawings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");

// type: the entity reading's type (compare.mjs reconciles the spec with it); skills: what the entity reading unlocked.
export const BODIES = [
  { id: "astronaut-shovel", file: "dev/gen-corpus/entity/E17.png", source: "draw", type: "person", desc: "astronaut + shovel", skills: ["dig"] },
  { id: "astronaut-drill", file: "dev/gen-corpus/entity/E18.png", source: "draw", type: "person", desc: "astronaut + hand drill", skills: ["drill"] },
  { id: "car-cannon", file: "dev/gen-corpus/entity/E23.png", source: "draw", type: "car", desc: "car + cannon on the roof", skills: ["shoot"] },
  { id: "bike-lamp", file: "dev/gen-corpus/entity/E26.png", source: "draw", type: "bike", desc: "bike + headlamp", skills: ["flare"] },
  { id: "dog-claws", file: "dev/gen-corpus/entity/E28.png", source: "draw", type: "quadruped", desc: "dog with big digging claws", skills: ["dig"] },
  { id: "blob", file: "dev/gen-corpus/entity/E29.png", source: "draw", type: "blob", desc: "blob with a face", skills: [] },
  { id: "color-person", gen: "colorPerson", source: "draw", type: "person", desc: "generated: coloured girl explorer (peach face, pink hair puffs, orange jumpsuit, blue boots, green backpack, yellow lamp in the image-left hand)", skills: ["flare"] },
  { id: "color-robot", gen: "colorRobot", source: "draw", type: "person", desc: "generated: coloured box robot (silver head, cyan eyes, red-ball antenna, blue torso + yellow bolt, red pincers, blaster in the image-right hand)", skills: ["shoot", "scan"] },
  { id: "horse-saddle", gen: "horseSaddle", source: "draw", type: "quadruped", desc: "generated: coloured brown horse, dark mane and long tail, black hooves, red saddle (side view, facing right)", skills: [] },
  { id: "monster-truck", gen: "monsterTruck", source: "draw", type: "car", desc: "generated: coloured green monster truck, blue window, huge black wheels, exhaust flames at the back, drill at the front", skills: ["boost", "drill"] },
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
  // Kid-marker helpers: a filled shape with a thick dark outline; a thick outlined limb (a stroke inside a darker stroke).
  const shape = (poly, c, ow = OUTLINE) => { fill(poly, c); line(poly, ow, INK, true); };
  const disc = (cx, cy, rx, c, ry = rx) => shape(ellipse(cx, cy, rx, ry, 64), c);
  const limb = (pts, r, c) => { line(pts, r + OUTLINE * 1.4, INK); line(pts, r, c); };
  return { w, h, px, line, fill, ellipse, shape, disc, limb, dot, png: () => encodePng(w, h, px) };
}
// A rounded rectangle as a polygon.
function rrect(x0, y0, x1, y1, r) {
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= 6; i++) { const t = a0 + i / 6 * Math.PI / 2; pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); } };
  corner(x1 - r, y0 + r, -Math.PI / 2); corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI);
  return pts;
}
const OUTLINE = 1.8; // a 3.6 px marker line
const INK = [28, 26, 38], RED = [230, 57, 70], YEL = [255, 210, 63], BLUE = [37, 99, 235], ORANGE = [255, 123, 0], GREY = [138, 145, 158];
const PEACH = [255, 203, 164], PINK = [255, 95, 162], GREEN = [43, 178, 76], SILVER = [196, 202, 212], CYAN = [34, 211, 238];
const BROWN = [160, 98, 45], DARKBROWN = [92, 52, 22], BLACK = [26, 24, 30], DARKGREY = [90, 96, 110], LIGHTBLUE = [120, 200, 255];

// Front view: a girl explorer, a lamp with rays raised in the image-LEFT hand, a green backpack behind the image-right shoulder.
function colorPerson() {
  const p = page(400, 512);
  // backpack behind the image-right shoulder (drawn first: the body covers it)
  p.shape(rrect(232, 178, 300, 312, 16), GREEN);
  p.shape(rrect(270, 228, 304, 288, 8), GREEN); // its side pocket
  // legs + blue boots
  p.limb([[176, 340], [172, 440]], 15, ORANGE);
  p.limb([[226, 340], [230, 440]], 15, ORANGE);
  p.shape(rrect(138, 428, 194, 470, 14), BLUE);
  p.shape(rrect(208, 428, 264, 470, 14), BLUE);
  // arms: the image-left one raised out holding the lamp, the image-right one down
  p.limb([[150, 208], [104, 248], [86, 262]], 13, ORANGE);
  p.limb([[252, 208], [282, 270], [290, 312]], 13, ORANGE);
  // orange jumpsuit body with a belt and a zip
  p.shape(rrect(140, 180, 262, 362, 26), ORANGE);
  p.line([[146, 300], [256, 300]], 3, INK);
  p.line([[201, 186], [201, 296]], 1.6, INK);
  // backpack strap over the image-right shoulder
  p.limb([[240, 186], [234, 296]], 4, GREEN);
  // lamp: a yellow handle in the hand, a yellow bulb on top, straight rays fanning out
  p.shape([[76, 214], [96, 214], [92, 292], [80, 292]], YEL);
  p.disc(86, 196, 22, YEL);
  for (let k = 0; k < 7; k++) {
    const t = -Math.PI + k / 6 * Math.PI, c = [86 + Math.cos(t) * 32, 196 + Math.sin(t) * 32], e = [86 + Math.cos(t) * 62, 196 + Math.sin(t) * 62];
    p.line([c, e], 4.2, INK); p.line([c, e], 2.2, YEL);
  }
  // hands
  p.disc(86, 266, 13, PEACH);
  p.disc(290, 318, 13, PEACH);
  // hair puffs behind the head, the head, a pink fringe
  p.disc(130, 104, 36, PINK);
  p.disc(270, 104, 36, PINK);
  p.disc(200, 118, 64, PEACH);
  const fringe = [];
  for (let i = 0; i <= 24; i++) { const t = Math.PI + i / 24 * Math.PI; fringe.push([200 + Math.cos(t) * 64, 118 + Math.sin(t) * 64]); }
  fringe.push([248, 92], [222, 82], [200, 92], [176, 82], [152, 92]);
  p.shape(fringe, PINK);
  // face: two dot eyes and a smile
  p.dot(178, 122, 7, INK); p.dot(222, 122, 7, INK);
  const smile = [];
  for (let i = 0; i <= 12; i++) { const t = Math.PI * 0.18 + i / 12 * Math.PI * 0.64; smile.push([200 + Math.cos(t) * 26, 138 + Math.sin(t) * 18]); }
  p.line(smile, 2.6, INK);
  p.dot(162, 146, 8, [255, 150, 150]); p.dot(238, 146, 8, [255, 150, 150]); // cheeks
  return p.png();
}

// Front view: a box robot; a blaster in the image-RIGHT pincer hand.
function colorRobot() {
  const p = page(400, 512);
  // antenna with a red ball
  p.limb([[200, 70], [200, 30]], 3, GREY);
  p.disc(200, 24, 13, RED);
  // stubby legs + blue feet
  p.shape(rrect(156, 322, 190, 404, 4), GREY);
  p.shape(rrect(210, 322, 244, 404, 4), GREY);
  p.shape(rrect(138, 398, 196, 430, 10), BLUE);
  p.shape(rrect(204, 398, 262, 430, 10), BLUE);
  // thick grey arms
  p.limb([[128, 196], [96, 248], [80, 300]], 16, GREY);
  p.limb([[272, 196], [306, 236], [320, 268]], 16, GREY);
  // image-left red pincer (open claw)
  p.shape([[66, 300], [94, 300], [96, 318], [86, 350], [80, 322], [76, 322], [70, 350], [62, 318]], RED);
  // the blaster in the image-right hand: a grip, a body and a straight barrel pointing out to the right
  p.shape([[316, 284], [332, 284], [328, 320], [312, 320]], DARKGREY);
  p.shape(rrect(300, 258, 352, 288, 6), DARKGREY);
  p.shape([[350, 264], [392, 264], [392, 280], [350, 280]], DARKGREY);
  p.line([[392, 258], [392, 286]], 2.4, INK);
  // image-right red pincer gripping the blaster
  p.shape([[306, 262], [336, 262], [340, 284], [330, 300], [326, 284], [316, 284], [312, 300], [302, 284]], RED);
  // blue box torso + yellow lightning bolt
  p.shape(rrect(118, 178, 282, 330, 8), BLUE);
  p.shape([[214, 196], [168, 262], [198, 262], [182, 314], [234, 240], [204, 240], [222, 196]], YEL);
  // neck
  p.shape([[184, 158], [216, 158], [216, 182], [184, 182]], GREY);
  // silver square head, cyan eyes, a grille mouth
  p.shape(rrect(138, 62, 262, 164, 8), SILVER);
  for (const x of [172, 228]) { p.disc(x, 104, 17, CYAN); p.dot(x, 104, 5, INK); }
  p.shape([[172, 132], [228, 132], [228, 148], [172, 148]], GREY);
  for (const x of [186, 200, 214]) p.line([[x, 133], [x, 147]], 1.4, INK);
  // rivets on the head corners
  for (const [x, y] of [[148, 72], [252, 72], [148, 154], [252, 154]]) p.dot(x, y, 3, INK);
  return p.png();
}

// Side view facing right: a brown horse with a red saddle.
function horseSaddle() {
  const p = page(512, 400);
  // long dark tail (several strokes)
  for (const [dx, dy] of [[0, 0], [8, 4], [-6, 6], [14, 10]]) p.limb([[118 + dx * 0.2, 176], [90 + dx, 210 + dy], [76 + dx, 262 + dy], [84 + dx, 312 + dy]], 5, DARKBROWN);
  // far legs (behind the body)
  p.limb([[168, 222], [160, 286], [164, 344]], 11, BROWN);
  p.limb([[318, 222], [326, 286], [322, 344]], 11, BROWN);
  p.shape(rrect(150, 340, 180, 362, 4), BLACK); p.shape(rrect(308, 340, 338, 362, 4), BLACK);
  // body
  p.shape(p.ellipse(232, 196, 122, 54, 72), BROWN);
  // near legs
  p.limb([[192, 226], [196, 290], [192, 350]], 12, BROWN);
  p.limb([[296, 226], [292, 290], [298, 350]], 12, BROWN);
  p.shape(rrect(176, 346, 210, 368, 4), BLACK); p.shape(rrect(282, 346, 316, 368, 4), BLACK);
  // neck and head (facing right), an ear, an eye, a nostril
  p.shape([[296, 176], [330, 140], [368, 82], [404, 98], [372, 160], [348, 212]], BROWN);
  p.shape([[362, 82], [392, 62], [452, 98], [466, 122], [452, 136], [408, 124], [370, 110]], BROWN);
  p.shape([[378, 74], [384, 38], [400, 66]], BROWN);
  p.dot(408, 88, 6, INK);
  p.dot(452, 118, 3.5, INK);
  p.line([[432, 128], [452, 130]], 1.6, INK);
  // dark mane along the top of the neck
  const mane = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; mane.push([300 + t * 78 + (i % 2 ? -10 : 0), 168 - t * 104 + (i % 2 ? -6 : 0)]); }
  p.limb(mane, 6, DARKBROWN);
  // red saddle on the back + its strap and stirrup
  p.shape([[188, 148], [204, 136], [234, 146], [262, 140], [276, 132], [282, 150], [268, 170], [206, 172]], RED);
  p.limb([[238, 172], [240, 224]], 2.5, RED);
  p.shape([[228, 224], [252, 224], [248, 236], [232, 236]], GREY);
  return p.png();
}

// Side view facing right: a green lifted pickup with huge wheels, exhaust flames at the back, a drill on the front bumper.
function monsterTruck() {
  const p = page(512, 380);
  // suspension springs (behind the wheels and body)
  for (const x of [140, 372]) { p.limb([[x - 14, 172], [x + 14, 182], [x - 14, 192], [x + 14, 202], [x - 14, 212]], 3, GREY); }
  // huge black wheels with grey hubs and tread bumps
  for (const cx of [140, 372]) {
    const cy = 270, R = 82;
    const tread = [];
    for (let i = 0; i < 48; i++) { const t = i / 48 * Math.PI * 2, r = R + (i % 2 ? 0 : 7); tread.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); }
    p.shape(tread, BLACK);
    p.disc(cx, cy, 34, GREY);
    for (let k = 0; k < 5; k++) { const t = k / 5 * Math.PI * 2; p.dot(cx + Math.cos(t) * 20, cy + Math.sin(t) * 20, 4, INK); }
  }
  // exhaust pipe at the back + orange/yellow flames
  p.shape([[42, 138], [70, 138], [70, 152], [42, 152]], GREY);
  p.shape([[44, 128], [22, 92], [28, 120], [2, 104], [16, 136], [2, 148], [20, 158], [6, 192], [44, 162]], ORANGE);
  p.shape([[44, 134], [30, 114], [32, 132], [14, 128], [26, 146], [16, 150], [26, 158], [20, 174], [44, 156]], YEL);
  // the body: bed, cab, hood
  const body = [[64, 112], [250, 112], [262, 52], [346, 52], [374, 106], [452, 112], [458, 172], [64, 172]];
  p.shape(body, GREEN);
  p.line([[250, 112], [250, 170]], 2, INK);
  p.shape([[274, 64], [340, 64], [360, 106], [274, 106]], LIGHTBLUE);
  p.line([[282, 128], [300, 128]], 2.4, INK); // door handle
  // front bumper + a grey drill cone with spiral lines
  p.shape([[450, 124], [466, 124], [466, 176], [450, 176]], GREY);
  p.shape([[466, 124], [508, 150], [466, 176]], GREY);
  for (let k = 0; k < 4; k++) { const x = 472 + k * 9, h = 24 * (1 - (x - 466) / 42); p.line([[x, 150 - h], [x + 7, 150 + h * 0.9]], 1.6, INK); }
  // headlight
  p.disc(444, 126, 7, YEL);
  return p.png();
}
const GENERATORS = { colorPerson, colorRobot, horseSaddle, monsterTruck };

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
  for (const d of BODIES.filter((x) => x.gen)) { fs.rmSync(path.join(HERE, "drawings", `${d.id}.png`), { force: true }); console.log(imageOf(d).file); }
}
