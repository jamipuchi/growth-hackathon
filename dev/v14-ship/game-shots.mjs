#!/usr/bin/env node
// v14-ship3d in the real game: drawn ships built from their spec (ship3d.js) on the TV (Chromium 1440x900) and on a phone
// (WebKit 844x390, DPR 3, iPhone UA, touch), against the real server.js with the v14 patch (dev/v14-ship/server.cjs).
//   node dev/v14-ship/game-shots.mjs [--port 8402] [--real 14] [--bots 3]
// 1. the phone joins through its own UI (name, JOIN, default controller) as "ace"; four more players join over HTTP
// 2. each posts a finished ship drawing (POST /generate): the answer's entity carries spec (source model | entity)
// 3. the phone's result card: render.js createEntityPreview with the phone's own drawing (dev/v14-ship/preview.html), which
//    finds the spec by the drawing's hash (GET /ship-spec)
// 4. screenshots: TV lobby, TV playing, phone playing (its own ship, chase view), phone result card → dev/v14-ship/shots/
// Writes dev/v14-ship/shots/game-report.json (spec sources, /generate ms, render stats from window.__game where present).
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
const PORT = Number(opt("port", 8402)), REAL = Number(opt("real", 14)), BOTS = Number(opt("bots", 3));
const REPLAY = argv.includes("--replay"); // no network: real answers recorded earlier (out/controllers + compare specs)
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(HERE, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = path.join(os.homedir(), "Library/Caches/ms-playwright");
const newest = (prefix) => fs.readdirSync(CACHE).filter((x) => new RegExp(`^${prefix}-\\d+$`).test(x)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0];
const CHROME = path.join(CACHE, newest("chromium"), "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const WEBKIT = path.join(CACHE, newest("webkit"), "pw_run.sh");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const png = (file) => `data:image/png;base64,${fs.readFileSync(path.join(ROOT, file)).toString("base64")}`;
async function post(p, body) {
  const t0 = Date.now();
  const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null), ms: Date.now() - t0 };
}

const PLAYERS = [
  { name: "ace", file: "dev/gen-corpus/real/jaume-ship-drawn-in-controller-step.png", phone: true, spec: "jaume-jet" },
  { name: "bolt", file: "dev/v14-ship/drawings/color-topview.png", spec: "color-topview" },
  { name: "cosmo", file: "dev/gen-corpus/entity/E10.png", spec: "E10-chunky" },
  { name: "dot", file: "dev/gen-corpus/entity/E08.png", spec: "E08-saucer" },
  { name: "echo", file: "dev/gen-corpus/entity/E13.png", spec: "photo-E13" },
];
let fixturesFile = null;
if (REPLAY) {
  const fx = {};
  for (const p of PLAYERS) {
    const key = (await import("crypto")).createHash("sha1").update(png(p.file)).digest("hex");
    const entity = JSON.parse(fs.readFileSync(path.join(HERE, "out/controllers", `${p.name}-ship.json`), "utf8"));
    const spec = JSON.parse(fs.readFileSync(path.join(HERE, "compare/gpt-6.1-sol-prompt2", `${p.spec}.spec.json`), "utf8")).raw;
    fx[key] = { entity, spec };
  }
  fixturesFile = path.join(HERE, "out", "replay-fixtures.json");
  fs.writeFileSync(fixturesFile, JSON.stringify(fx));
}

const report = { at: new Date().toISOString(), port: PORT, players: [], shots: [] };
const server = spawn(process.execPath, [path.join(HERE, "server.cjs"), "--bots", String(BOTS)], { env: { ...process.env, PORT: String(PORT), V14_REAL_MAX: String(REAL), ...(fixturesFile ? { V14_REPLAY: fixturesFile } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
const serverLog = fs.createWriteStream(path.join(HERE, "out", "game-server.log"));
server.stdout.pipe(serverLog); server.stderr.pipe(serverLog);
let browsers = [];
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + "/info")).ok) break; } catch {} await sleep(200); }
  const pw = require(PW_CORE);
  const chrome = await pw.chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] });
  const wk = await pw.webkit.launch({ executablePath: WEBKIT, headless: true });
  browsers = [chrome, wk];
  const tv = await (await chrome.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const phoneCtx = await wk.newContext({ viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const phone = await phoneCtx.newPage();
  for (const [pg, n] of [[tv, "tv"], [phone, "phone"]]) pg.on("pageerror", (e) => log(`${n} pageerror: ${e.message}`));
  await tv.goto(`${BASE}/space.html`);
  await phone.goto(`${BASE}/controller.html`);
  await phone.evaluate(() => localStorage.clear());
  await phone.reload();
  // The phone joins through its own UI with the default controller.
  await phone.waitForFunction(() => window.__sp && document.readyState === "complete", null, { timeout: 20000 });
  await phone.fill("#name", "ace");
  await phone.locator("#joinForm button").tap();
  await phone.waitForFunction(() => window.__sp.screen === "draw", null, { timeout: 15000 });
  await phone.locator("#useDefault").tap();
  await phone.waitForFunction(() => window.__sp.screen === "play", null, { timeout: 15000 });
  log("phone joined as ace (default controller)");
  for (const p of PLAYERS) {
    if (!p.phone) await post("/join", { player: p.name });
    const g = await post("/generate", { player: p.name, kind: "ship", image: png(p.file), source: "draw", requestId: `v14-${p.name}` });
    const e = g.json && g.json.entity;
    const rec = { name: p.name, file: p.file, status: g.status, ms: g.ms, ok: g.json && g.json.ok, verbs: e && e.verbs, spec: e && e.spec ? e.spec.source : null, image: e && e.image };
    report.players.push(rec);
    log(`${p.name}: /generate ${g.status} in ${g.ms} ms, spec ${rec.spec}, verbs ${rec.verbs}`);
  }
  // Late model specs (the answer carried the entity's parts): GET /ship-spec until each is the model's (≤ 8 s).
  for (let i = 0; i < 16; i++) {
    let all = true;
    for (const rec of report.players) {
      const v = /v=([0-9a-f]+)/.exec(rec.image || "");
      if (!v) continue;
      const r = await fetch(`${BASE}/ship-spec?v=${v[1]}`).then((x) => x.json()).catch(() => null);
      rec.finalSpec = r && r.spec ? r.spec.source : null;
      if (rec.finalSpec !== "model") all = false;
    }
    if (all) break;
    await sleep(500);
  }
  log("final specs:", report.players.map((r) => `${r.name}=${r.finalSpec}`).join(" "));
  await sleep(3500); // every screen builds the ships (one per frame) and pops them in
  const shot = async (pg, name) => { const f = path.join(SHOTS, `${name}.png`); await pg.screenshot({ path: f }); report.shots.push(path.relative(ROOT, f)); log(`shot ${name}`); };
  await shot(tv, "game-tv-lobby");
  await shot(phone, "game-phone-lobby");
  const st = await post("/start", { countdown: false });
  log(`START ${st.status}`);
  // Fly: input drops the spawn shield; a gentle turn shows the ship banking (the phone's own stick sends the same axis).
  for (let i = 0; i < 12; i++) { await post("/input", { type: "axis", player: "ace", axis: "steer", x: i < 6 ? 0.45 : -0.3, y: 0.05 }); await sleep(250); }
  await sleep(2000);
  await shot(tv, "game-tv-playing");
  await shot(phone, "game-phone-playing");
  await sleep(2500);
  await shot(tv, "game-tv-playing2");
  // Render stats where the page exposes them.
  for (const [pg, n] of [[tv, "tv"], [phone, "phone"]]) {
    report[n] = await pg.evaluate(() => {
      const g = window.__game || (window.__sp && window.__sp.game);
      const I = g && g._internals;
      if (!I) return null;
      const entries = [...I.drawn.map.values()];
      return { cache: I.drawn.stats(), ship3dReady: entries.filter((e) => e.ship3d && e.state === "ready").length,
        builds: entries.filter((e) => e.state === "ready").map((e) => ({ ship3d: !!e.ship3d, tris: e.result && e.result.triangles, calls: e.result && e.result.drawCalls, ms: e.result && e.result.ms, spec: e.spec ? e.spec.source : null })),
        calls: I.renderer.info.render.calls, tris: I.renderer.info.render.triangles, textures: I.renderer.info.memory.textures, geometries: I.renderer.info.memory.geometries };
    }).catch((e) => ({ error: e.message }));
    log(`${n}: ${JSON.stringify(report[n]).slice(0, 400)}`);
  }
  // The phone's result card: createEntityPreview with the phone's own drawing (finds the spec by the drawing's hash).
  const card = await phoneCtx.newPage();
  card.on("pageerror", (e) => log(`card pageerror: ${e.message}`));
  await card.goto(`${BASE}/dev/v14-ship/preview.html?img=${encodeURIComponent(report.players[0].image || "")}`).catch((e) => log("preview.html:", e.message));
  report.card = await card.waitForFunction(() => window.__ready, null, { timeout: 20000 }).then((h) => h.jsonValue()).catch((e) => ({ error: e.message }));
  await sleep(1200);
  await shot(card, "game-phone-card");
} catch (err) {
  report.error = String(err && err.stack || err);
  log("FAILED", err);
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  server.kill();
  fs.writeFileSync(path.join(SHOTS, "game-report.json"), JSON.stringify(report, null, 2));
  log(`report: dev/v14-ship/shots/game-report.json`);
}
