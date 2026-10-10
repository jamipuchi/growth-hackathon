#!/usr/bin/env node
// v14-entity3d in the real game: drawn explorers posted through /generate (real astra.js: entity reading + body spec in
// parallel), kept by server.js (entity.spec, GET /ship-spec), landed on the planet (the v13 test hook), then
//   TV (Chromium 1440x900, space.html?screen=big): the game follows each explorer in the chase view → shots/tv-<name>.png
//   phone result card (WebKit 844x390, DPR 3, iPhone UA, touch): render.js createEntityPreview → shots/card-<name>.png
//   node dev/v14-entity3d/game-check.mjs [--port 8442] [--real 10]     (--real 0: the dev kit, no OpenAI calls)
// The server is dev/v14-entity3d/server.cjs (a copy of the v13 kit's: the real server.js in-process, HTTPS off, test hooks);
// it is started on the given port (8440-8449) and killed by its PID at the end. Writes out/game-report.json.
import { createRequire } from "module";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(opt("port", 8442)), REAL = Number(opt("real", 10));
if (!(PORT >= 8440 && PORT <= 8449)) { console.error("port must be 8440-8449"); process.exit(2); }
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(HERE, "shots"), OUT = path.join(HERE, "out");
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = path.join(os.homedir(), "Library/Caches/ms-playwright");
const newest = (prefix) => fs.readdirSync(CACHE).filter((x) => new RegExp(`^${prefix}-\\d+$`).test(x)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0];
const CHROME = path.join(CACHE, newest("chromium"), "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const WEBKIT = path.join(CACHE, newest("webkit"), "pw_run.sh");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const png = (file) => `data:image/png;base64,${fs.readFileSync(path.join(ROOT, file)).toString("base64")}`;
async function http(method, p, body) {
  const t0 = Date.now();
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null), ms: Date.now() - t0 };
}
const PLAYERS = [
  { name: "e3dastro", kind: "person", file: "dev/gen-corpus/entity/E17.png" },
  { name: "e3dcar", kind: "car", file: "dev/gen-corpus/entity/E23.png" },
  { name: "e3ddog", kind: "quadruped", file: "dev/gen-corpus/entity/E28.png" },
  { name: "e3drobot", kind: "person", file: "dev/v14-entity3d/drawings/color-robot.png" },
];

const report = { at: new Date().toISOString(), port: PORT, real: REAL, players: [], tv: [], cards: [] };
const server = spawn(process.execPath, [path.join(HERE, "server.cjs")], {
  env: { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", V13_MODE: REAL > 0 ? "real" : "mock", V13_REAL_MAX: String(REAL), V13_EXIT_WITH_PARENT: "1" },
  stdio: ["ignore", fs.openSync(path.join(OUT, "server.log"), "w"), fs.openSync(path.join(OUT, "server.log"), "a")],
});
let browserA = null, browserB = null;
const done = async (code) => {
  try { await browserA?.close(); } catch {}
  try { await browserB?.close(); } catch {}
  try { server.kill(); } catch {}
  fs.writeFileSync(path.join(OUT, "game-report.json"), JSON.stringify(report, null, 2));
  process.exit(code);
};
const watchdog = setTimeout(() => { log("watchdog: 5 min"); done(3); }, 300000);
try {
  for (let i = 0; i < 60; i++) { try { const r = await http("GET", "/__test/info"); if (r.status === 200) break; } catch {} await sleep(250); }
  log("server up", server.pid);
  // 1. draw the explorers (finished drawings; the spec rides along or comes late)
  for (const p of PLAYERS) {
    await http("POST", "/join", { player: p.name });
    const g = await http("POST", "/generate", { player: p.name, kind: "explorer", image: png(p.file), source: "draw", speculative: false, requestId: `${p.name}-1` });
    const e = g.json && g.json.entity;
    const rec = { name: p.name, file: p.file, status: g.status, ms: g.ms, ok: !!(g.json && g.json.ok), type: e && e.type, verbs: e && e.verbs, image: e && e.image, spec: e && e.spec ? { source: e.spec.source, type: e.spec.type, items: (e.spec.items || []).map((x) => x.kind) } : null };
    report.players.push(rec);
    log(p.name, g.status, `${g.ms} ms`, rec.type, rec.spec ? `spec ${rec.spec.type}/${rec.spec.source}` : "no spec yet");
  }
  await sleep(4500); // late specs (the model's) land through the onShipSpec listener
  for (const rec of report.players) {
    const v = /[?&]v=([0-9a-f]{6,40})/.exec(rec.image || "");
    const s = v ? await http("GET", `/ship-spec?v=${v[1]}`) : null;
    rec.kept = s && s.json && s.json.spec ? { source: s.json.spec.source, type: s.json.spec.type, items: (s.json.spec.items || []).map((x) => x.kind) } : null;
    log(rec.name, "kept spec:", JSON.stringify(rec.kept));
  }
  // 2. land them
  const pl = await http("POST", "/__test/planet", { players: PLAYERS.map((p) => p.name), timeoutMs: 15000 });
  report.planet = pl.json;
  log("planet:", pl.status, JSON.stringify(pl.json).slice(0, 200));
  const pw = require(PW_CORE);
  // 3. TV: follow each explorer in the chase view
  browserA = await pw.chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] });
  const tv = await browserA.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  tv.on("pageerror", (e) => errs.push(e.message));
  tv.on("console", (m) => { const t = m.text(); if (/entity3d|\[render\]/.test(t)) errs.push(`console: ${t.slice(0, 200)}`); });
  await tv.goto(`${BASE}/space.html?screen=big`);
  await sleep(9000);
  for (const p of PLAYERS) {
    await tv.evaluate((n) => { try { window.__game.setPlayer(n); window.__game.setView("chase"); } catch (e) { return String(e); } }, p.name);
    await sleep(3500);
    const file = path.join(SHOTS, `tv-${p.name}.png`);
    await tv.screenshot({ path: file });
    report.tv.push({ name: p.name, shot: path.relative(ROOT, file) });
    log("tv shot", p.name);
  }
  report.tvErrors = errs.slice(0, 20);
  await browserA.close(); browserA = null;
  // 4. the phone's result card (WebKit, iPhone)
  browserB = await pw.webkit.launch({ executablePath: WEBKIT, headless: true });
  const ctx = await browserB.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  const cardHtml = fs.readFileSync(path.join(HERE, "card.html"), "utf8");
  await page.route("**/__card.html*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: cardHtml }));
  for (const rec of report.players) {
    if (!rec.image) continue;
    const p = PLAYERS.find((x) => x.name === rec.name);
    await page.goto(`${BASE}/__card.html?img=${encodeURIComponent(rec.image)}&kind=${rec.type || p.kind}`);
    const ready = await page.waitForFunction(() => window.__ready, null, { timeout: 30000 }).then((h) => h.jsonValue()).catch((e) => ({ error: e.message }));
    const file = path.join(SHOTS, `card-${rec.name}.png`);
    await page.screenshot({ path: file });
    report.cards.push({ name: rec.name, ready, shot: path.relative(ROOT, file) });
    log("card", rec.name, JSON.stringify(ready).slice(0, 160));
  }
  const calls = await http("GET", "/__test/calls");
  report.calls = calls.json ? { mode: calls.json.mode, real: calls.json.real, replayed: calls.json.replayed, missing: calls.json.missing, blocked: calls.json.blocked } : null;
  log("calls:", JSON.stringify(report.calls));
  clearTimeout(watchdog);
  await done(0);
} catch (e) {
  console.error(e);
  report.error = String(e && e.stack || e);
  await done(1);
}
