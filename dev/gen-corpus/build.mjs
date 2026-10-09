// Builds the generation corpus: every case in lib/cases.js is drawn with hand-drawn strokes and pushed through the
// SAME image pipeline as the phone (controller.html: strokesPNG for finger drawings; analysePhoto + renderPhoto for
// notebook photos, copied verbatim from controller.html at build time). Writes <dir>/<id>.png (the image Astra gets),
// <dir>/<id>.json (ground truth), photos/<id>.jpg (the simulated raw photo), index.json and contact sheets.
//   node dev/gen-corpus/build.mjs [--only C01,E02]
// One headless Chromium (playwright-core by absolute path, the cached headless shell); no server, no network.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const { chromium } = require("/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const CACHE = path.join(os.homedir(), "Library/Caches/ms-playwright");
const SHELL = fs.readdirSync(CACHE).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
const EXE = path.join(CACHE, SHELL, "chrome-headless-shell-mac-arm64/chrome-headless-shell");

const only = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? new Set(process.argv[i + 1].split(",")) : null; })();
const DIR_OF = { controller: "controller", button: "button", ship: "entity", explorer: "entity" };

// The phone's own code, cut out of controller.html so the corpus can never drift from it.
function phonePipeline() {
  const html = fs.readFileSync(path.join(ROOT, "controller.html"), "utf8");
  const cut = (from, to) => {
    const a = html.indexOf(from), b = html.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`controller.html: cannot find ${from}`);
    return html.slice(a, b);
  };
  const strokes = cut("function drawStrokes(", "// ---------- photo processing");
  const photo = cut("async function loadBitmap(", "// ---------- generation");
  return `(function(){ const IMAGE_PX = 512;\n${strokes}\n${photo}\nwindow.PIPE = { drawStrokes, strokesBox, strokesPNG, analysePhoto, renderPhoto }; })();`;
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const t0 = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: phonePipeline() });
  for (const f of ["hand.js", "cases.js", "photo.js"]) await page.addScriptTag({ content: fs.readFileSync(path.join(HERE, "lib", f), "utf8") });
  const ids = await page.evaluate(() => window.CASES.map((c) => c.id));
  const index = [];
  for (const id of ids) {
    if (only && !only.has(id)) continue;
    const r = await page.evaluate(async (id) => {
      const c = window.CASES.find((x) => x.id === id);
      const d = new window.HAND.Drawing(c.seed, { mess: c.mess, w: c.w, h: c.h });
      const gt = c.build(d) || { controls: [] };
      const rng = window.HAND.rngOf(c.seed ^ 0x9e3779b9);
      const meta = { id: c.id, kind: c.kind, source: c.source, desc: c.desc };
      if (c.region) meta.region = c.region;
      if (c.pad) meta.pad = c.pad;
      if (c.expect) meta.expect = c.expect;
      if (c.entity) meta.entity = c.entity;
      if (c.wrong) meta.wrong = { looksLike: c.wrong };
      if (c.photo) meta.photo = c.photo;
      let image, raw = null, rect;
      if (c.source === "draw") {
        const strokes = d.strokes.map((s) => s.map(([x, y]) => [x / c.w, y / c.h]));
        const crop = c.kind !== "controller";
        image = window.PIPE.strokesPNG(strokes, c.w / c.h, { crop });
        rect = (b) => ({ x: b.x / c.w, y: b.y / c.h, w: b.w / c.w, h: b.h / c.h });
      } else {
        const out = await window.PHOTO.run(d.strokes, c, rng, window.PIPE);
        image = out.image; raw = out.raw; rect = out.mapRect; meta.turns = out.turns;
      }
      const r3 = (b) => ({ x: +b.x.toFixed(4), y: +b.y.toFixed(4), w: +b.w.toFixed(4), h: +b.h.toFixed(4) });
      if (c.kind === "controller" && !c.wrong) {
        meta.controls = gt.controls.map((k) => ({ type: k.type, action: k.a, label: k.label, ...(k.icon ? { icon: k.icon } : {}), rect: r3(rect(k.rect)) }));
        if (gt.excluded && gt.excluded.length) meta.excluded = gt.excluded.map((e) => ({ what: e.what, rect: r3(rect(e.rect)) }));
      }
      const img = new Image(); img.src = image; await img.decode();
      meta.size = [img.naturalWidth, img.naturalHeight];
      return { meta, image, raw };
    }, id);
    const dir = r.meta.wrong ? "wrong" : DIR_OF[r.meta.kind];
    fs.mkdirSync(path.join(HERE, dir), { recursive: true });
    const file = `${dir}/${id}.png`;
    fs.writeFileSync(path.join(HERE, file), Buffer.from(r.image.split(",")[1], "base64"));
    if (r.raw) {
      fs.mkdirSync(path.join(HERE, "photos"), { recursive: true });
      fs.writeFileSync(path.join(HERE, "photos", `${id}.jpg`), Buffer.from(r.raw.split(",")[1], "base64"));
    }
    const meta = { ...r.meta, file };
    fs.writeFileSync(path.join(HERE, dir, `${id}.json`), JSON.stringify(meta, null, 1) + "\n");
    index.push(meta);
    process.stdout.write(`${id} `);
  }
  // The owner's two real failures (finger drawings exported by the phone).
  const real = [
    { id: "R01", kind: "controller", source: "draw", desc: "REAL (owner 23:15): a spaceship drawn in the controller step; the model returned one giant 'fly' button", file: "real/jaume-ship-drawn-in-controller-step.png", wrong: { looksLike: "entity" } },
    { id: "R02", kind: "button", source: "draw", desc: "REAL (owner 23:15): a figure drawn as an added button → 'unreadable button'", file: "real/jaume-figure-drawn-as-button.png", region: { x: 0.4, y: 0.3, w: 0.2, h: 0.3 }, wrong: { looksLike: "entity" } },
  ];
  for (const m of real) {
    if (only && !only.has(m.id)) continue;
    fs.writeFileSync(path.join(HERE, "real", `${m.id}.json`), JSON.stringify(m, null, 1) + "\n");
    index.push(m);
  }
  if (!only) {
    fs.writeFileSync(path.join(HERE, "index.json"), JSON.stringify(index, null, 1) + "\n");
    // Contact sheets, one per folder, to eyeball the corpus.
    fs.mkdirSync(path.join(HERE, "sheets"), { recursive: true });
    for (const dir of ["controller", "button", "entity", "wrong"]) {
      const items = index.filter((m) => m.file.startsWith(dir + "/")).map((m) => ({ id: m.id, url: "data:image/png;base64," + fs.readFileSync(path.join(HERE, m.file)).toString("base64"), controls: m.controls || [] }));
      const png = await page.evaluate(async (items) => {
        const cols = 6, cw = 260, chh = 170;
        const cv = document.createElement("canvas"); cv.width = cols * cw; cv.height = Math.ceil(items.length / cols) * chh;
        const g = cv.getContext("2d"); g.fillStyle = "#888"; g.fillRect(0, 0, cv.width, cv.height);
        for (let i = 0; i < items.length; i++) {
          const img = new Image(); img.src = items[i].url; await img.decode();
          const k = Math.min((cw - 10) / img.naturalWidth, (chh - 24) / img.naturalHeight);
          const x = (i % cols) * cw + 5, y = Math.floor(i / cols) * chh + 20, w = img.naturalWidth * k, h = img.naturalHeight * k;
          g.drawImage(img, x, y, w, h);
          g.strokeStyle = "rgba(255,0,0,0.8)"; g.lineWidth = 1.5;
          for (const c of items[i].controls) g.strokeRect(x + c.rect.x * w, y + c.rect.y * h, c.rect.w * w, c.rect.h * h);
          g.fillStyle = "#000"; g.font = "bold 14px sans-serif"; g.fillText(items[i].id, x, y - 5);
        }
        return cv.toDataURL("image/png");
      }, items);
      fs.writeFileSync(path.join(HERE, "sheets", `${dir}.png`), Buffer.from(png.split(",")[1], "base64"));
    }
  }
  console.log(`\nbuilt ${index.length} cases in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} finally {
  await browser.close();
}
