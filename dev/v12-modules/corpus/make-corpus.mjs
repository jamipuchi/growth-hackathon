// Builds 10 hand-drawn controller drawings (what the phone sends after its photo pipeline: dark ink on white,
// cropped, landscape, 512 px wide; one in draw mode, white ink on dark) plus the layout Astra would read from each.
//   node dev/v12-modules/corpus/make-corpus.mjs
// Writes dev/v12-modules/corpus/cNN-<name>.png and corpus.json ([{ name, file, source, layout }]). Uses headless
// Chromium (Playwright cache) only to rasterise a canvas with the macOS handwriting fonts.
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = path.join(os.homedir(), "Library/Caches/ms-playwright");
const newest = (prefix) => fs.readdirSync(CACHE).filter((d) => new RegExp(`^${prefix}-\\d+$`).test(d)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0];
const CHROME = path.join(CACHE, newest("chromium"), "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const W = 512, H = 236;

// Each control: { type, action, label, x, y, w, h } (fractions), plus how to draw it: shape box|circle|stick|dpad|
// arrow|toggle, optional doodle, tilt (radians) and font.
const CORPUS = [
  { name: "c01-basic", items: [
    { type: "stick", action: "steer", label: "", x: 0.05, y: 0.3, w: 0.27, h: 0.6, shape: "stick" },
    { type: "button", action: "shoot", label: "FIRE", x: 0.74, y: 0.48, w: 0.2, h: 0.34, shape: "box" },
    { type: "button", action: "boost", label: "BOOST", x: 0.47, y: 0.6, w: 0.21, h: 0.28, shape: "box" },
  ] },
  { name: "c02-dpad", items: [
    { type: "stick", action: "steer", label: "", x: 0.04, y: 0.3, w: 0.28, h: 0.62, shape: "dpad" },
    { type: "button", action: "shoot", label: "SHOOT", x: 0.72, y: 0.5, w: 0.22, h: 0.42, shape: "circle" },
    { type: "button", action: "shield", label: "SHIELD", x: 0.45, y: 0.62, w: 0.2, h: 0.26, shape: "box" },
    { type: "button", action: "land", label: "LAND", x: 0.76, y: 0.07, w: 0.18, h: 0.26, shape: "box", doodle: "legs" },
  ] },
  { name: "c03-twosticks", items: [
    { type: "stick", action: "steer", label: "", x: 0.04, y: 0.36, w: 0.26, h: 0.58, shape: "stick" },
    { type: "stick", action: "move", label: "", x: 0.7, y: 0.36, w: 0.26, h: 0.58, shape: "stick" },
    { type: "button", action: "shoot", label: "PEW", x: 0.42, y: 0.12, w: 0.15, h: 0.32, shape: "circle" },
    { type: "button", action: "boost", label: "TURBO", x: 0.39, y: 0.62, w: 0.21, h: 0.24, shape: "box" },
  ] },
  { name: "c04-arrows", items: [
    { type: "button", action: "left", label: "◀", x: 0.03, y: 0.42, w: 0.12, h: 0.24, shape: "arrow", dir: "left" },
    { type: "button", action: "right", label: "▶", x: 0.27, y: 0.42, w: 0.12, h: 0.24, shape: "arrow", dir: "right" },
    { type: "button", action: "up", label: "▲", x: 0.15, y: 0.14, w: 0.12, h: 0.26, shape: "arrow", dir: "up" },
    { type: "button", action: "down", label: "▼", x: 0.15, y: 0.68, w: 0.12, h: 0.26, shape: "arrow", dir: "down" },
    { type: "button", action: "shoot", label: "ZAP", x: 0.68, y: 0.3, w: 0.26, h: 0.56, shape: "circle", doodle: "bolt" },
  ] },
  { name: "c05-gates", items: [
    { type: "stick", action: "steer", label: "", x: 0.04, y: 0.34, w: 0.27, h: 0.6, shape: "stick" },
    { type: "button", action: "drill", label: "DRILL", x: 0.42, y: 0.12, w: 0.18, h: 0.3, shape: "box", doodle: "drill" },
    { type: "button", action: "land", label: "LAND", x: 0.66, y: 0.12, w: 0.16, h: 0.3, shape: "box" },
    { type: "button", action: "scan", label: "SCAN", x: 0.43, y: 0.6, w: 0.16, h: 0.32, shape: "circle" },
    { type: "button", action: "shoot", label: "FIRE", x: 0.72, y: 0.55, w: 0.22, h: 0.36, shape: "box" },
  ] },
  { name: "c06-planet", items: [
    { type: "stick", action: "move", label: "WALK", x: 0.05, y: 0.3, w: 0.27, h: 0.62, shape: "stick" },
    { type: "button", action: "dig", label: "DIG", x: 0.74, y: 0.5, w: 0.2, h: 0.4, shape: "box", doodle: "shovel" },
    { type: "button", action: "jump", label: "JUMP", x: 0.5, y: 0.62, w: 0.17, h: 0.3, shape: "circle" },
    { type: "button", action: "takeoff", label: "TAKE OFF", x: 0.7, y: 0.08, w: 0.26, h: 0.24, shape: "box" },
  ] },
  { name: "c07-many", items: [
    { type: "stick", action: "steer", label: "", x: 0.03, y: 0.36, w: 0.25, h: 0.58, shape: "stick" },
    { type: "button", action: "heal", label: "HEAL", x: 0.36, y: 0.1, w: 0.14, h: 0.27, shape: "box", doodle: "cross" },
    { type: "button", action: "flare", label: "FLARE", x: 0.54, y: 0.1, w: 0.14, h: 0.27, shape: "circle", doodle: "sun" },
    { type: "button", action: "blast", label: "NUKE", x: 0.72, y: 0.1, w: 0.14, h: 0.27, shape: "box" },
    { type: "button", action: "invisible", label: "CLOAK", x: 0.36, y: 0.6, w: 0.16, h: 0.27, shape: "box" },
    { type: "button", action: "boost", label: "BOOST", x: 0.56, y: 0.6, w: 0.16, h: 0.27, shape: "box" },
    { type: "button", action: "shoot", label: "FIRE", x: 0.77, y: 0.52, w: 0.19, h: 0.4, shape: "circle" },
  ] },
  { name: "c08-toggle", items: [
    { type: "stick", action: "steer", label: "", x: 0.05, y: 0.34, w: 0.27, h: 0.6, shape: "stick" },
    { type: "toggle", action: "view", label: "CAM", x: 0.4, y: 0.1, w: 0.2, h: 0.2, shape: "toggle" },
    { type: "button", action: "shoot", label: "FIRE", x: 0.72, y: 0.5, w: 0.22, h: 0.4, shape: "box" },
    { type: "button", action: "shield", label: "SHIELD", x: 0.44, y: 0.56, w: 0.2, h: 0.36, shape: "circle", doodle: "shieldicon" },
  ] },
  { name: "c09-messy", tilt: true, items: [
    { type: "button", action: "forward", label: "GO", x: 0.08, y: 0.12, w: 0.18, h: 0.3, shape: "box" },
    { type: "button", action: "back", label: "BRAKE", x: 0.06, y: 0.58, w: 0.22, h: 0.3, shape: "box" },
    { type: "button", action: "blast", label: "BOOM", x: 0.36, y: 0.32, w: 0.2, h: 0.4, shape: "star" },
    { type: "stick", action: "move", label: "", x: 0.68, y: 0.3, w: 0.27, h: 0.6, shape: "stick" },
  ] },
  { name: "c10-drawmode", source: "draw", items: [
    { type: "stick", action: "steer", label: "", x: 0.06, y: 0.28, w: 0.3, h: 0.64, shape: "stick" },
    { type: "button", action: "shoot", label: "X", x: 0.7, y: 0.4, w: 0.22, h: 0.46, shape: "circle" },
  ] },
];

function pageScript(corpus, W, H) {
  // Runs in the browser: draws each drawing on a canvas and returns PNG data URLs.
  const fonts = ['"Marker Felt"', '"Chalkboard SE"', '"Bradley Hand"', '"Noteworthy"'];
  const out = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const j = (a) => (rnd() - 0.5) * 2 * a;
  for (const [n, d] of corpus.entries()) {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    const draw = d.source === "draw";
    g.fillStyle = draw ? "#101218" : "#fbfaf6"; g.fillRect(0, 0, W, H);
    if (!draw) for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`; g.fillRect(rnd() * W, rnd() * H, 1, 1); }
    const ink = draw ? "#f2f6ff" : "#1c1c22";
    g.strokeStyle = ink; g.fillStyle = ink; g.lineCap = "round"; g.lineJoin = "round";
    const pen = (w) => (g.lineWidth = (draw ? 3.2 : 2.2) * w + j(0.3));
    const line = (pts, amp = 1.2) => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x + j(amp), y + j(amp)) : g.moveTo(x + j(amp), y + j(amp))));
      g.stroke();
    };
    const seg = (x0, y0, x1, y1) => { // a hand line: subdivided, wobbly, slight overshoot
      const pts = [], k = Math.max(3, Math.round(Math.hypot(x1 - x0, y1 - y0) / 14));
      for (let i = 0; i <= k; i++) pts.push([x0 + (x1 - x0) * (i / k) * 1.04 - (x1 - x0) * 0.02, y0 + (y1 - y0) * (i / k) * 1.04 - (y1 - y0) * 0.02]);
      line(pts, 1.1);
    };
    const box = (x, y, w, h) => { pen(1); seg(x, y, x + w, y); seg(x + w, y, x + w, y + h); seg(x + w, y + h, x, y + h); seg(x, y + h, x, y); };
    const ellipse = (cx, cy, rx, ry, turns = 1.06) => {
      pen(1); const pts = []; const a0 = rnd() * 6.28;
      for (let a = 0; a <= 6.283 * turns; a += 0.18) { const r = 1 + j(0.035); pts.push([cx + Math.cos(a0 + a) * rx * r, cy + Math.sin(a0 + a) * ry * r]); }
      line(pts, 0.6);
    };
    const text = (s, cx, cy, size, font) => {
      g.save(); g.translate(cx, cy); g.rotate(j(0.06)); g.font = `${size}px ${font}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(s, 0, 0); g.restore();
    };
    const arrowHead = (x, y, dir, s) => {
      const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
      const [dx, dy] = v, px = -dy, py = dx;
      pen(1.2);
      line([[x + px * s * 0.55 - dx * s * 0.5, y + py * s * 0.55 - dy * s * 0.5], [x + dx * s * 0.5, y + dy * s * 0.5], [x - px * s * 0.55 - dx * s * 0.5, y - py * s * 0.55 - dy * s * 0.5]], 0.8);
    };
    const doodle = (kind, cx, cy, s) => {
      pen(0.8);
      if (kind === "drill") { line([[cx - s * 0.3, cy - s], [cx + s * 0.3, cy - s], [cx + s * 0.3, cy - s * 0.6], [cx - s * 0.3, cy - s * 0.6], [cx - s * 0.3, cy - s]]); line([[cx - s * 0.25, cy - s * 0.6], [cx, cy + s * 0.2], [cx + s * 0.25, cy - s * 0.6]]); seg(cx - s * 0.2, cy - s * 0.4, cx + s * 0.18, cy - s * 0.5); }
      if (kind === "legs") { line([[cx - s, cy - s * 0.4], [cx + s, cy - s * 0.4]]); line([[cx - s * 0.6, cy - s * 0.4], [cx - s, cy + s * 0.3]]); line([[cx + s * 0.6, cy - s * 0.4], [cx + s, cy + s * 0.3]]); }
      if (kind === "shovel") { seg(cx, cy - s, cx, cy + s * 0.1); line([[cx - s * 0.35, cy + s * 0.1], [cx + s * 0.35, cy + s * 0.1], [cx + s * 0.25, cy + s * 0.6], [cx, cy + s * 0.8], [cx - s * 0.25, cy + s * 0.6], [cx - s * 0.35, cy + s * 0.1]]); }
      if (kind === "cross") { seg(cx, cy - s * 0.5, cx, cy + s * 0.5); seg(cx - s * 0.5, cy, cx + s * 0.5, cy); }
      if (kind === "sun") { ellipse(cx, cy, s * 0.3, s * 0.3); for (let a = 0; a < 6.28; a += 0.785) seg(cx + Math.cos(a) * s * 0.45, cy + Math.sin(a) * s * 0.45, cx + Math.cos(a) * s * 0.7, cy + Math.sin(a) * s * 0.7); }
      if (kind === "bolt") line([[cx + s * 0.2, cy - s], [cx - s * 0.3, cy + s * 0.05], [cx + s * 0.1, cy + s * 0.05], [cx - s * 0.2, cy + s]]);
      if (kind === "shieldicon") line([[cx, cy - s * 0.6], [cx + s * 0.5, cy - s * 0.4], [cx + s * 0.45, cy + s * 0.1], [cx, cy + s * 0.6], [cx - s * 0.45, cy + s * 0.1], [cx - s * 0.5, cy - s * 0.4], [cx, cy - s * 0.6]]);
    };
    const font = fonts[n % fonts.length];
    for (const it of d.items) {
      const x = it.x * W, y = it.y * H, w = it.w * W, h = it.h * H, cx = x + w / 2, cy = y + h / 2;
      g.save();
      if (d.tilt) { g.translate(cx, cy); g.rotate(j(0.12)); g.translate(-cx, -cy); }
      const labelSize = Math.min(h * 0.34, (w * 1.5) / Math.max(2, it.label.length));
      const ty = it.doodle ? cy + h * 0.24 : cy;
      if (it.shape === "box") { box(x, y, w, h); if (it.doodle) doodle(it.doodle, cx, cy - h * 0.12, Math.min(w, h) * 0.24); text(it.label, cx, ty, labelSize, font); }
      if (it.shape === "circle") { ellipse(cx, cy, w / 2, h / 2); if (it.doodle) doodle(it.doodle, cx, cy - h * 0.12, Math.min(w, h) * 0.22); text(it.label, cx, ty, labelSize, font); }
      if (it.shape === "star") { pen(1); const pts = []; for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.45 : 1; pts.push([cx + Math.cos(a) * (w / 2) * r, cy + Math.sin(a) * (h / 2) * r]); } line(pts, 1.2); text(it.label, cx, cy + h * 0.04, labelSize * 0.7, font); }
      if (it.shape === "stick") {
        const r = Math.min(w, h) / 2;
        ellipse(cx, cy, r, r); ellipse(cx, cy, r * 0.32, r * 0.32);
        for (const dir of ["left", "right", "up", "down"]) { const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir]; arrowHead(cx + v[0] * r * 0.68, cy + v[1] * r * 0.68, dir, r * 0.2); }
        if (it.label) text(it.label, cx, y + h + 9 > H ? y - 6 : cy + r + 8, 13, font);
      }
      if (it.shape === "dpad") {
        const s = Math.min(w, h) / 2, t = s * 0.36; pen(1);
        line([[cx - t, cy - s], [cx + t, cy - s], [cx + t, cy - t], [cx + s, cy - t], [cx + s, cy + t], [cx + t, cy + t], [cx + t, cy + s], [cx - t, cy + s], [cx - t, cy + t], [cx - s, cy + t], [cx - s, cy - t], [cx - t, cy - t], [cx - t, cy - s]], 1);
        for (const dir of ["left", "right", "up", "down"]) { const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir]; arrowHead(cx + v[0] * s * 0.7, cy + v[1] * s * 0.7, dir, s * 0.22); }
      }
      if (it.shape === "arrow") {
        box(x, y, w, h);
        const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[it.dir], s = Math.min(w, h) * 0.32;
        pen(1.2); seg(cx - v[0] * s, cy - v[1] * s, cx + v[0] * s, cy + v[1] * s); arrowHead(cx + v[0] * s * 0.6, cy + v[1] * s * 0.6, it.dir, s * 0.9);
      }
      if (it.shape === "toggle") {
        const r = h / 2; pen(1);
        line([[x + r, y], [x + w - r, y]]); line([[x + r, y + h], [x + w - r, y + h]]);
        g.beginPath(); g.arc(x + r, cy, r, Math.PI / 2, Math.PI * 1.5); g.stroke(); g.beginPath(); g.arc(x + w - r, cy, r, -Math.PI / 2, Math.PI / 2); g.stroke();
        g.beginPath(); g.arc(x + w - r, cy, r * 0.62, 0, 6.283); g.fill();
        text(it.label, cx - r * 0.5, y - 9 < 0 ? y + h + 10 : y - 9, 13, font);
      }
      g.restore();
    }
    out.push(c.toDataURL("image/png"));
  }
  return out;
}

async function main() {
  const { chromium } = require(PW_CORE);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><body></body>");
    const corpus = CORPUS.map((d) => ({ ...d, items: d.items.map((it) => ({ ...it })) }));
    const urls = await page.evaluate(`(${pageScript.toString()})(${JSON.stringify(corpus)}, ${W}, ${H})`);
    const index = [];
    CORPUS.forEach((d, i) => {
      const file = `${d.name}.png`;
      fs.writeFileSync(path.join(HERE, file), Buffer.from(urls[i].split(",")[1], "base64"));
      index.push({ name: d.name, file, source: d.source || "photo", layout: { buttons: d.items.map(({ type, action, label, x, y, w, h }) => ({ type, action, label, x, y, w, h })), source: "model" } });
    });
    fs.writeFileSync(path.join(HERE, "corpus.json"), JSON.stringify(index, null, 1));
    console.log(`wrote ${index.length} drawings + corpus.json to ${HERE}`);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
