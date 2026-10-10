#!/usr/bin/env node
// Triangles / draw calls / build ms of every compare spec at the three qualities (lite = the phone's game view, phone = the
// result card, big = the TV), in one headless Chromium on serve.mjs (port 8441). → out/budget.json
import { createRequire } from "module";
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
// node dev/v14-entity3d/budget.mjs [port=8441] [out.json=dev/v14-entity3d/out/budget.json]   (v16: port 8500-8509)
const PORT = Number(process.argv[2] || 8441), DIR = path.join(HERE, "compare", "gpt-6.1-sol");
const OUT_FILE = process.argv[3] ? path.resolve(HERE, "../..", process.argv[3]) : path.join(HERE, "out", "budget.json");
const CACHE = path.join(os.homedir(), "Library/Caches/ms-playwright");
const newest = (p) => fs.readdirSync(CACHE).filter((x) => new RegExp(`^${p}-\\d+$`).test(x)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0];
const CHROME = path.join(CACHE, newest("chromium"), "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const server = spawn(process.execPath, [path.join(HERE, "serve.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => server.stdout.once("data", r));
const pw = require(process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const browser = await pw.chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] });
const out = {};
try {
  const page = await browser.newPage(); page.on("pageerror", () => {});
  await page.goto(`http://127.0.0.1:${PORT}/dev/v14-entity3d/view.html?spec=none`).catch(() => {});
  const ids = fs.readdirSync(DIR).filter((f) => f.endsWith(".view.json")).map((f) => f.slice(0, -10));
  const specs = Object.fromEntries(ids.map((id) => [id, JSON.parse(fs.readFileSync(path.join(DIR, `${id}.view.json`), "utf8"))]));
  Object.assign(out, await page.evaluate(async (specs) => {
    const E = await import("/entity3d.js");
    await E.loadEntityClips();
    const r = {};
    for (const [id, spec] of Object.entries(specs)) {
      r[id] = {};
      for (const quality of ["lite", "phone", "big"]) {
        const t0 = performance.now();
        const e = E.buildEntity(spec, { color: 0x22d3ee, quality });
        const inst = e.instance({ color: 0x22d3ee });
        // every clip plays (v1.6: the tool-grip tracks, the vehicle clips) without a missing-bone warning
        let played = 0; const warn = console.warn; let warned = 0; console.warn = (...a) => { warned++; warn(...a); };
        try { if (inst.play) for (const c of inst.clips) { inst.play(c.name, { fade: 0 }); inst.update(0.1); played++; } } finally { console.warn = warn; }
        r[id][quality] = { triangles: e.triangles, drawCalls: e.drawCalls, buildMs: +e.ms, totalMs: +(performance.now() - t0).toFixed(1), detail: e.detail, size: e.size, clips: e.clips.length, played, warned, bones: e.bones.size, wheels: e.wheels.length };
        inst.dispose(); e.dispose();
      }
    }
    return r;
  }, specs));
} finally { await browser.close(); server.kill(); }
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
for (const [id, q] of Object.entries(out)) console.log(id.padEnd(17), ["lite", "phone", "big"].map((k) => `${k} ${q[k].triangles}t/${q[k].drawCalls}c/${q[k].buildMs}ms`).join("  "), `size ${q.big.size.x}x${q.big.size.y}x${q.big.size.z}`, `bones ${q.big.bones} clips ${q.big.played}/${q.big.clips} warn ${q.big.warned}`);
