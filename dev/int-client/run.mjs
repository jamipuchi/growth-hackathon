// End-to-end test of the integrated game: one phone (WebKit, iPhone 13 landscape) plus the big screen (Chromium)
// play a whole round against the real server with ASTRA_MOCK=1. A Node driver reads /events itself and steers the
// phone's player through POST /input along the v1 route: nebula → FLARE and SCAN → DRILL the boss → planet → LAND →
// island → DIG a chest → win.
//   node dev/e2e/run.mjs [--port 8105] [--bots 8] [--route expert|regular] [--video] [--mock] [--headed] [--no-shots]
//   --mock   run dev/render/mock-server.js instead of server.js: only checks that both pages load, render and post perf
// Writes dev/e2e/report.json, dev/e2e/shots/<stage>-{big,phone}.png, dev/e2e/perf.log, dev/e2e/server.log and with
// --video dev/e2e/video/*.webm. Exit code 0 only when the report passes.
// Playwright is not a repo dependency: PW_CORE points at any playwright-core (default below), browsers come from the
// Playwright cache (newest chromium-* and webkit-*), overridable with E2E_CHROME and E2E_WEBKIT.
import { createRequire } from "module";
import { spawn, execSync } from "child_process";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const Contract = require(path.join(ROOT, "contract.js"));
const { TUNING: T } = Contract;

// ---- Options -------------------------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const PORT = Number(opt("port", 8120));
const BOTS = Number(opt("bots", 8));
const ROUTE = opt("route", "expert");
const MOCK = flag("mock");
const VIDEO = flag("video");
const HEADED = flag("headed");
const TAKEOFF = flag("takeoff");     // int-client: after landing, take off and land again (both shots on camera)
const NO_SHOTS = flag("no-shots");   // WebKit screenshots stall the phone for a frame or two: use for a clean 1% low
const ME = "e2e";
const BASE = `http://127.0.0.1:${PORT}`;
const ROUND_LIMIT_S = Number(opt("limit", 330));                    // fail the round after 5:30 of play
const DRAW_S = Number(opt("draw-seconds", ROUTE === "regular" ? 12 : 3)); // time "spent drawing" a button (PLAN.md step 8)
if (!["expert", "regular"].includes(ROUTE)) { console.error("--route is expert or regular"); process.exit(2); }

const SHOTS = path.join(HERE, "shots");
const VIDEOS = path.join(HERE, "video");
const PERF_LOG = path.join(HERE, "perf.log");
const SERVER_LOG = path.join(HERE, "server.log");
const REPORT = path.join(HERE, "report.json");

const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = process.env.PW_CACHE || path.join(os.homedir(), "Library/Caches/ms-playwright");
const newest = (prefix) => fs.readdirSync(CACHE).filter((d) => new RegExp(`^${prefix}-\\d+$`).test(d)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0];
const CHROME = process.env.E2E_CHROME || path.join(CACHE, newest("chromium") || "chromium", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const WEBKIT = process.env.E2E_WEBKIT || path.join(CACHE, newest("webkit") || "webkit", "pw_run.sh");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const since = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
const log = (...a) => console.log(`[e2e ${since()}s]`, ...a);

// ---- Server: start, wait, always kill ------------------------------------------------------------------------------

let server = null;
let browsers = [];
let cleaning = null;

function portBusy(port) {
  try { return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
}

async function startServer() {
  const busy = portBusy(PORT);
  if (busy) throw new Error(`port ${PORT} is already in use (pid ${busy}); pick another with --port`);
  const script = MOCK ? ["dev/render/mock-server.js", "--port", String(PORT), "--bots", String(BOTS)] : ["server.js", "--bots", String(BOTS)];
  const env = { ...process.env, PORT: String(PORT), ASTRA_MOCK: "1", PERF_LOG, HTTPS_PORT: "0" };
  delete env.OPENAI_API_KEY; // the mock never needs it; make sure nothing real can be called
  fs.writeFileSync(PERF_LOG, "");
  const out = fs.createWriteStream(SERVER_LOG);
  server = spawn(process.execPath, script, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.pipe(out); server.stderr.pipe(out);
  server.on("exit", (code, sig) => { if (!cleaning) log(`server exited early (code ${code}, signal ${sig}); see ${path.relative(ROOT, SERVER_LOG)}`); server = null; });
  log(`started ${script.join(" ")} on :${PORT} (pid ${server.pid})`);
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (!server) throw new Error("server exited before answering");
    const ok = await new Promise((resolve) => {
      http.get(`${BASE}/space.html`, (res) => { res.resume(); resolve(res.statusCode === 200); }).on("error", () => resolve(false));
    });
    if (ok) return;
    await sleep(200);
  }
  throw new Error("server did not answer /space.html within 15 s");
}

async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    for (const b of browsers) await Promise.race([b.close().catch(() => {}), sleep(5000)]);
    if (server) {
      const s = server;
      s.kill("SIGTERM");
      await Promise.race([new Promise((r) => s.once("exit", r)), sleep(2000)]);
      try { s.kill("SIGKILL"); } catch {}
    }
  })();
  return cleaning;
}
process.on("SIGINT", () => { log("interrupted"); cleanup().then(() => process.exit(130)); });
process.on("SIGTERM", () => cleanup().then(() => process.exit(143)));
process.on("exit", () => { try { server && server.kill("SIGKILL"); } catch {} });

// ---- Browsers ------------------------------------------------------------------------------------------------------

const consoleErrors = [];
const perfSamples = [];   // as posted by the pages (seen in the browser), plus perf.log after the run

function watchPage(page, screen) {
  page.on("pageerror", (e) => consoleErrors.push({ screen, t: +since(), text: `pageerror: ${e.message}` }));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push({ screen, t: +since(), text: m.text().slice(0, 400) }); });
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().endsWith("/perf")) return;
    try { perfSamples.push({ ...JSON.parse(req.postData()), seen: Date.now() }); } catch {}
  });
}

async function openPages() {
  const { chromium, webkit } = require(PW_CORE);
  for (const [name, exe] of [["chromium", CHROME], ["webkit", WEBKIT]]) if (!fs.existsSync(exe)) throw new Error(`${name} not found at ${exe}`);
  const chrome = await chromium.launch({ executablePath: CHROME, headless: !HEADED, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--autoplay-policy=no-user-gesture-required"] });
  browsers.push(chrome);
  const bigCtx = await chrome.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const big = await bigCtx.newPage();
  watchPage(big, "big");

  const wk = await webkit.launch({ executablePath: WEBKIT, headless: !HEADED });
  browsers.push(wk);
  fs.mkdirSync(VIDEOS, { recursive: true });
  const phoneCtx = await wk.newContext({
    viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA,
    ...(VIDEO ? { recordVideo: { dir: VIDEOS, size: { width: 844, height: 390 } } } : {}),
  });
  const phone = await phoneCtx.newPage();
  watchPage(phone, "phone");

  // The render mock appends /perf to the render lane's dev/render/perf.log: answer it here instead (still recorded).
  if (MOCK) for (const ctx of [bigCtx, phoneCtx]) await ctx.route("**/perf", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 204 }) : r.continue()));
  await Promise.all([big.goto(`${BASE}/space.html?perf`), phone.goto(`${BASE}/controller.html?perf`)]);
  await phone.evaluate(() => localStorage.clear());
  await phone.reload();
  return { big, phone };
}

// Screenshots are queued per page so the driver never waits for them.
const shotQueue = { big: Promise.resolve(), phone: Promise.resolve() };
const shots = [];
function shoot(pages, stage) {
  if (NO_SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const screen of ["big", "phone"]) {
    const file = path.join(SHOTS, `${stage}-${screen}.png`);
    shotQueue[screen] = shotQueue[screen].then(() => pages[screen].screenshot({ path: file, timeout: 8000 }).then(() => shots.push(path.relative(ROOT, file))).catch((e) => log(`screenshot ${stage}-${screen} failed: ${e.message.split("\n")[0]}`)));
  }
}

async function phoneJoin(phone) {
  await phone.waitForFunction(() => window.__sp && document.readyState === "complete", null, { timeout: 15000 });
  await phone.fill("#name", ME);
  await phone.locator("#joinForm button").tap();
  await phone.waitForFunction(() => window.__sp.screen === "draw", null, { timeout: 10000 });
  await phone.locator("#useDefault").tap();
  await phone.waitForFunction(() => window.__sp.screen === "play", null, { timeout: 10000 });
  const player = await phone.evaluate(() => window.__sp.player);
  log(`phone joined as "${player}" with the default controller`);
  return player;
}

async function phoneReady(phone) {
  const btn = phone.locator("#readyBtn");
  try { await btn.waitFor({ state: "visible", timeout: 4000 }); } catch {
    await post("/input", { type: "input", player: ME, action: "ready", down: true });
    log("Ready button not visible: sent ready over POST /input");
    return "post";
  }
  try { await btn.tap({ timeout: 2000 }); log("phone tapped Ready"); return "tap"; } catch {
    // Visible but not tappable (an overlay on top): click it through the page so its own handler still sends ready.
    await phone.evaluate(() => document.getElementById("readyBtn").click());
    log("Ready not tappable (covered?): clicked it through the DOM");
    return "dom-click";
  }
}

// ---- HTTP helpers --------------------------------------------------------------------------------------------------

function post(pathname, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(`${BASE}${pathname}`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (text += d));
      res.on("end", () => { let json = null; try { json = text ? JSON.parse(text) : null; } catch {} resolve({ status: res.statusCode, json }); });
    });
    req.on("error", (e) => resolve({ status: 0, json: null, error: e.message }));
    req.end(data);
  });
}

function events(onMessage) {
  const req = http.get(`${BASE}/events`, (res) => {
    let buf = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of block.split("\n")) if (line.startsWith("data:")) { try { onMessage(JSON.parse(line.slice(5))); } catch {} }
      }
    });
  });
  req.on("error", (e) => log(`event stream error: ${e.message}`));
  return req;
}

// A small grey PNG "drawing" of a button: a box with a few strokes, different per label so the hash differs.
function pngDataUrl(label, w = 96, h = 48) {
  const raw = Buffer.alloc((w + 1) * h, 255);
  const seed = [...label].reduce((s, c) => s * 31 + c.charCodeAt(0), 7);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const edge = x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
      const stroke = (x + y * ((seed % 5) + 1)) % 17 < 2 && x > 10 && x < w - 10 && y > 12 && y < h - 12;
      if (edge || stroke) raw[y * (w + 1) + 1 + x] = 20;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return "data:image/png;base64," + png.toString("base64");
}

// ---- Perf ----------------------------------------------------------------------------------------------------------

function perfFromLog() {
  try {
    return fs.readFileSync(PERF_LOG, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function summarisePerf(samples, screen) {
  const s = samples.filter((x) => x.screen === screen && Number.isFinite(x.fps));
  if (!s.length) return null;
  const warm = s.length > 2 ? s.slice(1) : s;  // the first 5 s include page load and shader compiles
  const avg = (k) => +(warm.reduce((a, x) => a + Number(x[k] || 0), 0) / warm.length).toFixed(1);
  const max = (k) => Math.max(...warm.map((x) => Number(x[k] || 0)));
  const min = (k) => Math.min(...warm.map((x) => Number(x[k] || 0)));
  const last = s[s.length - 1];
  return {
    samples: s.length, fps: avg("fps"), fpsMin: min("fps"), low1: avg("low1"), low1Min: min("low1"), p90ms: avg("p90ms"),
    calls: avg("calls"), callsMax: max("calls"), tris: Math.round(avg("tris")), trisMax: max("tris"),
    tier: last.tier, size: `${last.w}x${last.h}@${last.dpr}`, ua: String(last.ua || "").slice(0, 60),
    contractErrors: [...new Set(s.flatMap((x) => Contract.CHECKS.perf(x)))],
  };
}

// ---- The route driver ----------------------------------------------------------------------------------------------

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const GATE_SKETCH = { drill: "drill", land: "landing", dig: "shovel" };
const GATE_REGION = { drill: { x: 0.38, y: 0.08, w: 0.18, h: 0.2 }, land: { x: 0.58, y: 0.08, w: 0.18, h: 0.2 }, dig: { x: 0.38, y: 0.3, w: 0.18, h: 0.2 } };

function createDriver(pages) {
  const D = {
    world: null, tick: null, me: null, playingAt: null, wonAt: null, wonClock: null, winner: null, lastPhase: null,
    stages: {}, toasts: [], announces: [], generates: [], issues: [], ticks: 0, invalid: { world: 0, tick: 0 },
    held: {}, queue: [], axes: {}, pressedAt: {}, gates: {}, deaths: 0, wasDead: false,
  };

  const playT = () => (D.playingAt ? +((Date.now() - D.playingAt) / 1000).toFixed(2) : 0);
  function stage(name, extra = {}) {
    if (D.stages[name]) return;
    D.stages[name] = { t: playT(), clock: D.tick ? D.tick.clock : null, ...extra };
    log(`stage ${name.padEnd(12)} at ${D.stages[name].t.toFixed(1)} s (clock ${D.stages[name].clock})${Object.keys(extra).length ? " " + JSON.stringify(extra) : ""}`);
    shoot(pages, name);
  }

  // int-client: three screenshots inside the landing / take-off shot (approach, white-out, touchdown).
  function series(prefix) { for (const [i, ms] of [[1, 700], [2, 1500], [3, 2300]]) setTimeout(() => shoot(pages, `${prefix}-${i}`), ms); }

  // Inputs: held keys are sent only when they change, axes once per tick, all in one POST /input per tick.
  const key = (action, down) => { down = !!down; if (!!D.held[action] === down) return; D.held[action] = down; D.queue.push({ type: "input", player: ME, action, down }); };
  const axis = (name, x, y) => { D.axes[name] = { type: "axis", player: ME, axis: name, x: +clamp(x).toFixed(3), y: +clamp(y).toFixed(3) }; };
  const press = (action) => { D.queue.push({ type: "input", player: ME, action, down: true }); D.pressedAt[action] = Date.now(); D.release = [...(D.release || []), action]; };
  function releaseAll() {
    for (const a of Object.keys(D.held)) key(a, false);
    axis("steer", 0, 0); axis("move", 0, 0);
  }
  function flush() {
    const batch = [...D.queue, ...Object.values(D.axes)];
    D.queue = []; D.axes = {};
    for (const a of D.release || []) D.queue.push({ type: "input", player: ME, action: a, down: false });
    D.release = [];
    if (batch.length) post("/input", batch);
  }

  // Point the ship (or the explorer) at a target with the steer stick; returns the remaining angle error.
  function aim(target) {
    const p = D.me;
    const v = { x: target.x - p.x, y: (target.y || 0) - p.y, z: target.z - p.z };
    const yawErr = wrap(Math.atan2(-v.x, -v.z) - p.yaw);
    const pitchErr = p.mode === "space" ? Math.atan2(v.y, Math.hypot(v.x, v.z)) - p.pitch : 0;
    axis("steer", -yawErr * 3, pitchErr * 3);
    return Math.hypot(yawErr, pitchErr);
  }

  // Buttons for the three gates. expert: draws each one as soon as the route needs it (while flying);
  // regular: waits at the gate for a hint toast, then spends DRAW_S drawing it.
  function gate(name, here) {
    const g = (D.gates[name] = D.gates[name] || { state: "idle" });
    const now = Date.now();
    if (g.state === "idle") {
      if (ROUTE === "expert") { g.state = "drawing"; g.from = now; }
      else if (here) { g.state = "waiting"; g.armedAt = now; g.toastsBefore = D.toasts.length; }
    }
    if (g.state === "waiting") {
      const hint = D.toasts.slice(g.toastsBefore).find((t) => !t.sketch || t.sketch === GATE_SKETCH[name] || (t.ghost && t.ghost.action === name) || new RegExp(name, "i").test(t.text || ""));
      if (hint) { g.state = "drawing"; g.from = now; g.hint = hint; stage(`hint-${name}`, { text: hint.text || "", sketch: hint.sketch || null }); }
      else if (now - g.armedAt > 40000) { g.state = "drawing"; g.from = now; D.issues.push(`no hint toast for ${name} within 40 s at the gate`); }
    }
    if (g.state === "drawing" && now - g.from >= DRAW_S * 1000) {
      g.state = "requested";
      const ghost = (D.toasts.slice().reverse().find((t) => t.ghost && t.ghost.action === name) || {}).ghost;
      const region = ghost ? { x: ghost.x, y: ghost.y, w: ghost.w, h: ghost.h } : GATE_REGION[name];
      const sent = Date.now();
      post("/generate", { player: ME, kind: "button", image: pngDataUrl(name.toUpperCase()), region, source: "draw", speculative: false, requestId: `e2e-${name}-${sent}` }).then((r) => {
        const ms = Date.now() - sent;
        const ok = !!(r.json && r.json.ok);
        const actions = ok ? r.json.layout.buttons.map((b) => b.action) : [];
        D.generates.push({ gate: name, ok, ms, status: r.status, actions, error: r.json && r.json.error, drawingsLeft: r.json && r.json.drawingsLeft });
        if (!ok) D.issues.push(`POST /generate button for ${name} failed: ${r.status} ${r.json && r.json.error}`);
        else if (!actions.includes(name)) D.issues.push(`mock /generate for ${name} returned ${actions.join(",")} (astra mockLayout always answers LAND); inputs still sent`);
        g.state = "done";
        stage(`button-${name}`, { ms, actions });
      });
    }
    return g.state === "done";
  }

  function think() {
    const p = D.me, w = D.world, ph = D.tick.phase;
    if (!p || !w || (ph !== "playing" && ph !== "assists")) return;
    if (p.flags.dead) { if (!D.wasDead) { D.deaths++; log(`died (${D.deaths})`); } D.wasDead = true; releaseAll(); return; }
    D.wasDead = false;
    if (p.flags.landing || p.flags.takingOff) { releaseAll(); return; }
    const boss = (w.targets || []).find((t) => t.kind === "boss");
    const expert = ROUTE === "expert";

    if (p.mode === "space" && boss && !boss.dead) {
      key("shoot", false);
      if (w.nebula && dist(p, w.nebula) < w.nebula.radius) {
        stage("nebula");
        if (!D.pressedAt.flare) { press("flare"); stage("flare"); }
        else if (!D.pressedAt.scan && Date.now() - D.pressedAt.flare > 1000) { press("scan"); stage("scan"); }
      }
      const d = dist(p, boss) - boss.radius;
      if (d < 40) stage("boss");
      const err = aim(boss);
      key("boost", expert && d > 80 && err < 0.3);
      key("forward", d > 45);
      if (boss.armour > 0) {
        if (!gate("drill", d < 40)) {
          // Waiting for the button: shoot at it from 30 m, then circle out of reach of its shots.
          key("back", d < 30);
          key("shoot", err < 0.05 && d < 60);
          if (d < 25) axis("steer", 1, 0);
          key("drill", false);
        } else {
          key("back", d < 15);
          key("drill", d < T.boss.drillRange - 2);
          key("shield", p.hp < 50);
          if (D.held.drill) stage("drilling");
        }
      } else {
        stage("cracked");
        key("drill", false); key("shield", false);
        key("back", d < 40);
        key("shoot", err < 0.06);
      }
    } else if (p.mode === "space") {
      stage("bossDown");
      key("shoot", false); key("shield", false); key("drill", false);
      const planet = w.planet;
      if (!planet) { releaseAll(); return; }
      const d = dist(p, planet), within = planet.radius + planet.landRange;
      const err = aim(planet);
      key("boost", expert && d > within + 40 && err < 0.3);
      key("forward", d > within + 3);
      key("back", d <= within + 3);
      if (d < within) stage("planet");
      if (gate("land", d < within) && d < within - 2 && (!D.pressedAt.land || Date.now() - D.pressedAt.land > 1500)) { press("land"); stage("land-pressed"); if (!D.landShots || (D.tookOff && !D.reLandShots)) { if (D.landShots) D.reLandShots = true; D.landShots = true; series(D.reLandShots ? "shot-reland" : "shot-land"); } }
    } else {
      stage("landed");
      for (const k of ["forward", "back", "shoot", "drill", "shield"]) key(k, false);
      if (TAKEOFF && !D.tookOff && D.stages.explorer && playT() - D.stages.explorer.t > 2.5) {
        D.tookOff = true; releaseAll(); press("takeoff"); stage("takeoff-pressed"); series("shot-takeoff"); return;
      }
      if (p.flags && p.flags.takingOff) { releaseAll(); return; }
      const chests = (w.chests || []).filter((c) => !c.open);
      const buried = chests.filter((c) => c.buried);
      const pool = buried.length ? buried : chests;
      if (!pool.length) { releaseAll(); return; }
      const chest = pool.slice().sort((a, b) => dist2(a, p) - dist2(b, p))[0];
      const dd = dist2(chest, p);
      const near = dd <= 1.5;
      const err = aim({ x: chest.x, y: 0, z: chest.z });
      axis("move", 0, !near && err < 0.5 ? 1 : 0);
      if (near) axis("steer", 0, 0);
      key("boost", expert && dd > 6);
      if (dd < T.island.pickupRange + 2) stage("chest", { id: chest.id });
      const hasDig = gate("dig", dd < T.island.pickupRange + 2);
      key("dig", near && chest.buried && hasDig);
      if (D.held.dig) stage("digging");
      if (!chest.buried) stage("dug", { id: chest.id });
    }
  }

  function onMessage(m) {
    if (m.type === "world") {
      D.world = m;
      if (Contract.CHECKS.world(m).length) D.invalid.world++;
      const boss = (m.targets || []).find((t) => t.kind === "boss");
      if (D.playingAt && boss && boss.cracked) stage("cracked");
    } else if (m.type === "tick") {
      D.tick = m; D.ticks++;
      if (Contract.CHECKS.tick(m).length) D.invalid.tick++;
      D.me = (m.players || []).find((p) => p.name === ME) || null;
      if (m.phase !== D.lastPhase) { log(`phase ${m.phase} (clock ${m.clock})`); D.lastPhase = m.phase; }
      if ((m.phase === "playing" || m.phase === "assists") && !D.playingAt && !D.wonAt) { D.playingAt = Date.now(); stage("playing"); }
      if (m.phase === "assists") stage("assists");
      if (!D.wonAt) { think(); flush(); }
    } else if (m.type === "toast") {
      if (Contract.cleanName(m.player) !== ME) return;
      D.toasts.push({ t: playT(), text: m.text || "", sketch: m.sketch || null, ghost: m.ghost || null });
      log(`toast "${m.text || ""}"${m.sketch ? ` sketch ${m.sketch}` : ""}${m.ghost ? ` ghost ${m.ghost.action}` : ""}`);
    } else if (m.type === "announce") {
      D.announces.push({ t: playT(), text: m.text, big: !!m.big });
      if (D.playingAt && !D.wonAt && /wins/i.test(m.text || "")) {
        D.wonAt = Date.now(); D.wonClock = D.tick && D.tick.clock;
        D.winner = (m.text.match(/(\S+) found the treasure/) || [])[1] || null;
        stage("won", { text: m.text });
        releaseAll(); flush();
      }
    }
  }
  return { D, onMessage };
}

// ---- Runs ----------------------------------------------------------------------------------------------------------

async function waitPerf(screens, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (screens.every((s) => perfSamples.some((x) => x.screen === s))) return true;
    await sleep(250);
  }
  return false;
}

async function canvasInfo(page) {
  return page.evaluate(() => [...document.querySelectorAll("canvas")].map((c) => ({ id: c.id, w: c.width, h: c.height, visible: c.getClientRects().length > 0 })).filter((c) => c.w > 0 && c.h > 0)).catch(() => []);
}

async function runMock(pages) {
  const checks = [];
  const ok = (name, pass, detail = "") => { checks.push({ name, pass, detail }); log(`${pass ? "PASS" : "FAIL"} ${name} ${detail}`); };
  const player = await phoneJoin(pages.phone).catch((e) => (ok("phone joins and reaches play", false, e.message.split("\n")[0]), null));
  if (player) ok("phone joins and reaches play", player === ME, player);
  if (player) await phoneReady(pages.phone);
  // Walk the mock's pinned stages so every scene gets a screenshot.
  const stages = {};
  for (const st of ["lobby", "fly", "flare", "boss", "broken", "planet", "island", "assists"]) {
    await new Promise((r) => http.get(`${BASE}/mock?stage=${st}`, (res) => { res.resume(); res.on("end", r); }).on("error", r));
    stages[st] = { t: +since() };
    await sleep(3500);
    shoot(pages, st);
  }
  ok("big screen posts perf", await waitPerf(["big"], 12000));
  ok("phone posts perf", await waitPerf(["phone"], 12000));
  for (const screen of ["big", "phone"]) {
    const s = perfSamples.filter((x) => x.screen === screen);
    ok(`${screen} renders (draw calls and triangles > 0)`, s.some((x) => x.calls > 0 && x.tris > 0), s.length ? `last ${s[s.length - 1].calls} calls, ${s[s.length - 1].tris} tris` : "no samples");
    ok(`${screen} perf samples match the contract`, s.length > 0 && s.every((x) => !Contract.CHECKS.perf(x).length));
    const cv = await canvasInfo(pages[screen]);
    ok(`${screen} has a sized canvas`, cv.length > 0, cv.map((c) => `#${c.id || "?"} ${c.w}x${c.h}`).join(" "));
  }
  return { checks, stages };
}

async function runRound(pages) {
  const { D, onMessage } = createDriver(pages);
  const stream = events(onMessage);
  const joined = await phoneJoin(pages.phone);
  if (joined !== ME) D.issues.push(`phone joined as ${joined}, expected ${ME}`);
  await sleep(500);
  shoot(pages, "lobby");
  D.readyVia = await phoneReady(pages.phone);
  // The explorer prompt after touchdown: v1 uses the default explorer.
  const explorerWatch = setInterval(async () => {
    const vis = await pages.phone.evaluate(() => { const e = document.getElementById("explorer"); return !!e && !e.classList.contains("hidden"); }).catch(() => false);
    if (vis) { await pages.phone.locator("#expDefault").tap({ timeout: 2000 }).catch(() => {}); if (!D.stages.explorer) { D.stages.explorer = { t: D.playingAt ? +((Date.now() - D.playingAt) / 1000).toFixed(2) : 0, clock: D.tick && D.tick.clock, choice: "default" }; log("phone: Use default explorer"); } }
  }, 1000);
  const limit = Date.now() + ((ROUND.lobbySeconds || 20) + ROUND_LIMIT_S + 10) * 1000;
  while (!D.wonAt && Date.now() < limit) await sleep(250);
  if (!D.wonAt) D.issues.push(`no win within ${ROUND_LIMIT_S} s of play`);
  await sleep(2500); // scoreboard shot and one more perf post
  shoot(pages, "scoreboard");
  clearInterval(explorerWatch);
  stream.destroy();
  return D;
}
const ROUND = Contract.ROUND;

// ---- Main ----------------------------------------------------------------------------------------------------------

async function main() {
  fs.rmSync(SHOTS, { recursive: true, force: true });
  if (VIDEO) fs.rmSync(VIDEOS, { recursive: true, force: true });
  log(`mode ${MOCK ? "mock" : "full"}, route ${ROUTE}, bots ${BOTS}, port ${PORT}, draw ${DRAW_S} s per button`);
  await startServer();
  const pages = await openPages();
  const result = MOCK ? await runMock(pages) : await runRound(pages);
  await Promise.all(Object.values(shotQueue));
  let videoFile = null;
  if (VIDEO) { const v = pages.phone.video(); await pages.phone.context().close(); if (v) { const file = path.join(VIDEOS, "phone.webm"); fs.renameSync(await v.path(), file); videoFile = path.relative(ROOT, file); } }
  await cleanup();

  // Prefer the server's perf.log (what the orchestrator reads); fall back to what the pages posted.
  const logged = MOCK ? [] : perfFromLog();
  const source = logged.length ? "perf.log" : "browser POST /perf";
  const samples = logged.length ? logged : perfSamples;
  const perf = { source, phone: summarisePerf(samples, "phone"), big: summarisePerf(samples, "big"),
    note: "Phone numbers come from WebKit on a desktop Mac emulating an iPhone 13 (844x390 @3x): a proxy only, confirm on a real iPhone." };
  const phonePerfOk = !!perf.phone && perf.phone.fps >= 55 && perf.phone.low1 >= 30;
  const report = { mode: MOCK ? "mock" : "full", route: ROUTE, bots: BOTS, port: PORT, measuredAt: new Date().toISOString(), wallSeconds: +since() };

  if (MOCK) {
    Object.assign(report, { pass: result.checks.every((c) => c.pass) && consoleErrors.length === 0, checks: result.checks, stages: result.stages,
      phonePerfGate: { pass: phonePerfOk, rule: "fps avg >= 55 and 1% low avg >= 30 (informational in --mock)" } });
  } else {
    const D = result;
    const won = !!D.wonAt && D.winner === ME;
    report.roundSeconds = D.wonAt ? +((D.wonAt - D.playingAt) / 1000).toFixed(1) : null;
    report.roundClock = D.wonClock;
    report.winner = D.winner;
    report.pass = won && consoleErrors.length === 0 && phonePerfOk;
    report.gates = { won, noConsoleErrors: consoleErrors.length === 0, phonePerf: phonePerfOk };
    report.stages = D.stages;
    report.generates = D.generates;
    report.deaths = D.deaths;
    report.ticks = D.ticks;
    report.invalidMessages = D.invalid;
    report.announces = D.announces;
    report.issues = D.issues;
    report.readyVia = D.readyVia;
    report.toasts = D.toasts;
  }
  report.perf = perf;
  report.consoleErrors = consoleErrors;
  if (!MOCK) report.toasts = report.toasts || [];
  report.shots = shots.sort();
  report.video = videoFile;
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  printReport(report);
  return report.pass;
}

function printReport(r) {
  const line = (s = "") => console.log(s);
  const pf = (x) => (x ? `${x.fps} fps (min ${x.fpsMin}), 1% low ${x.low1} (min ${x.low1Min}), p90 ${x.p90ms} ms, ${x.calls} calls (max ${x.callsMax}), ${Math.round(x.tris / 1000)}k tris (max ${Math.round(x.trisMax / 1000)}k), tier ${x.tier}, ${x.size}, ${x.samples} samples` : "no samples");
  line(); line(`==== Space Party e2e (${r.mode}${r.mode === "full" ? `, ${r.route}` : ""}, ${r.bots} bots) ${r.pass ? "PASS" : "FAIL"} ====`);
  if (r.mode === "full") {
    line(`round: ${r.roundSeconds == null ? "not won" : `${r.roundSeconds} s (clock ${r.roundClock})`}, winner ${r.winner || "-"}, deaths ${r.deaths}`);
    line(`stages: ${Object.entries(r.stages).map(([k, v]) => `${k} ${v.t}`).join(" · ")}`);
    line(`toasts (${r.toasts.length}): ${r.toasts.map((t) => `${t.t}s "${t.text}"${t.sketch ? `[${t.sketch}]` : ""}`).join(" | ") || "-"}`);
    line(`generate: ${r.generates.map((g) => `${g.gate} ${g.ok ? "ok" : "FAIL"} ${g.ms} ms → ${g.actions.join(",")}`).join(" · ") || "-"}`);
    if (r.issues.length) line(`issues: ${r.issues.join(" | ")}`);
  } else {
    for (const c of r.checks) line(`${c.pass ? "PASS" : "FAIL"} ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
  }
  line(`perf (${r.perf.source}) phone: ${pf(r.perf.phone)}`);
  line(`perf (${r.perf.source}) big:   ${pf(r.perf.big)}`);
  line(`  ${r.perf.note}`);
  line(`console errors: ${r.consoleErrors.length}${r.consoleErrors.slice(0, 5).map((e) => `\n  [${e.screen} ${e.t}s] ${e.text}`).join("")}`);
  line(`shots: ${r.shots.length} in dev/int-client/shots${r.video ? `, video ${r.video}` : ""}; report dev/int-client/report.json`);
}

main().then((pass) => process.exit(pass ? 0 : 1)).catch(async (e) => {
  console.error(`[e2e] failed: ${e.stack || e.message}`);
  await cleanup();
  try { fs.writeFileSync(REPORT, JSON.stringify({ pass: false, error: e.message, consoleErrors, measuredAt: new Date().toISOString() }, null, 2)); } catch {}
  process.exit(1);
});
