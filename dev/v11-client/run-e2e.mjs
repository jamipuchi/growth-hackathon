// COPY of dev/e2e/run.mjs for the v1.1 client harness. Differences: every output goes to dev/v11-client/e2e-out/ (report.json,
// report-<route>.json, perf.log, server.log, shots/<route>/, video/, controllers/), the default port is 8172, the server is the test
// wrapper dev/v11-client/server.cjs (it also serves /inflate.js, which server.js does not serve yet; --real-server starts the
// unchanged server.js instead, which writes Astra's drawing copies to the repo's controllers/), HTTPS is off, and WebKit is
// pinned to webkit-2311 when it exists (the newer webkit-2368 hangs playwright-core 1.58.2; E2E_WEBKIT overrides).
// End-to-end test of the integrated game: one phone (WebKit, iPhone 13 landscape) plus the big screen (Chromium)
// play a whole round against the real server with ASTRA_MOCK=1. A Node driver reads /events itself and steers the
// phone's player through POST /input along the v1.1 route (PLAN.md section 0): lobby → START (the big screen's button,
// else POST /start) → draw the ship (unlocks its skills; the mock answers the dev kit) → nebula → FLARE and SCAN →
// shoot the boss → planet → LAND → island → draw the explorer → DIG buried chests and DRILL rock chests → the round
// ends (every chest open, or the 4:00 cap) → scoreboard; most points wins.
// The route driver lives in driver.mjs (shared with the fast-forward balance sim, dev/netcode/balance-sim.mjs).
//   expert: draws the ship and explorer in the lobby and every button as the route needs it. Passes when it WINS the
//           round, opens a chest and the boss is down by --boss-by seconds (default 150, "well before 3:00").
//   regular: draws nothing up front; waits at each gate for the hint (part first, then button), then DRAW_S drawing.
//           Passes when the round ends with a chest opened before the 4:00 cap.
//   Both: valid messages, a skill unlocked by drawing, no console errors, the phone perf gate.
//   node dev/v11-client/run-e2e.mjs [--port 8172] [--bots 24] [--route expert|regular] [--video] [--mock] [--headed] [--no-shots] [--real-server]
//   --mock   run dev/render/mock-server.js instead of server.js: only checks that both pages load, render and post perf
// Writes dev/v11-client/e2e-out/report.json (and report-<route>.json), e2e-out/shots/<route>/<stage>-{big,phone}.png,
// e2e-out/perf.log, e2e-out/server.log and with --video e2e-out/video/*.webm. Exit code 0 only when the report passes.
// Playwright is not a repo dependency: PW_CORE points at any playwright-core (default below), browsers come from the
// Playwright cache (newest chromium-* and webkit-*), overridable with E2E_CHROME and E2E_WEBKIT.
import { createRequire } from "module";
import { spawn, execSync } from "child_process";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createDriver, judge } from "./driver.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const Contract = require(path.join(ROOT, "contract.js"));
const { TUNING: T } = Contract;

// ---- Options -------------------------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const PORT = Number(opt("port", 8172));
const BOTS = Number(opt("bots", 24));
const ROUTE = opt("route", "expert");
const MOCK = flag("mock");
const REAL_SERVER = flag("real-server");   // the unchanged server.js instead of the wrapper
const VIDEO = flag("video");
const HEADED = flag("headed");
const NO_SHOTS = flag("no-shots");   // WebKit screenshots stall the phone for a frame or two: use for a clean 1% low
const ME = "e2e";
const BASE = `http://127.0.0.1:${PORT}`;
const ROUND_LIMIT_S = Number(opt("limit", 270));                    // the round ends by 4:00; fail after 4:30 of play
const DRAW_S = Number(opt("draw-seconds", ROUTE === "regular" ? 12 : 3)); // time "spent drawing" a button (PLAN.md step 8)
const BOSS_BY = Number(opt("boss-by", 150));                       // expert: the boss must be down by then ("well before 3:00")
if (!["expert", "regular"].includes(ROUTE)) { console.error("--route is expert or regular"); process.exit(2); }

const OUT = path.join(HERE, "e2e-out");          // every output lands here, never in dev/e2e/
const SHOTS = path.join(OUT, "shots", MOCK ? "mock" : ROUTE);
const VIDEOS = path.join(OUT, "video");
const PERF_LOG = path.join(OUT, "perf.log");
const SERVER_LOG = path.join(OUT, "server.log");
const REPORT = path.join(OUT, "report.json");
const ROUTE_REPORT = path.join(OUT, `report-${MOCK ? "mock" : ROUTE}.json`);

const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = process.env.PW_CACHE || path.join(os.homedir(), "Library/Caches/ms-playwright");
const newest = (prefix) => fs.readdirSync(CACHE).filter((d) => new RegExp(`^${prefix}-\\d+$`).test(d)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0];
const CHROME = process.env.E2E_CHROME || path.join(CACHE, newest("chromium") || "chromium", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
// Pinned: webkit-2311 when it exists (the newer webkit-2368 hangs playwright-core 1.58.2), else the newest.
const WEBKIT_PINNED = path.join(CACHE, "webkit-2311", "pw_run.sh");
const WEBKIT = process.env.E2E_WEBKIT || (fs.existsSync(WEBKIT_PINNED) ? WEBKIT_PINNED : path.join(CACHE, newest("webkit") || "webkit", "pw_run.sh"));
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
  const script = MOCK ? ["dev/render/mock-server.js", "--port", String(PORT), "--bots", String(BOTS)]
    : [REAL_SERVER ? "server.js" : "dev/v11-client/server.cjs", "--bots", String(BOTS)];
  const env = { ...process.env, PORT: String(PORT), ASTRA_MOCK: "1", PERF_LOG, HTTPS_PORT: "0", V11_DRAWINGS_DIR: path.join(OUT, "controllers"), V11_EXIT_WITH_PARENT: "1" };
  delete env.OPENAI_API_KEY; // the mock never needs it; make sure nothing real can be called
  fs.mkdirSync(OUT, { recursive: true });
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

// The host's START: the big screen's button when the client track has one, else POST /start.
async function hostStart(big) {
  for (const sel of ["#startBtn", "#start", "button:has-text('START')"]) {
    const btn = big.locator(sel).first();
    try { await btn.waitFor({ state: "visible", timeout: 1500 }); await btn.click({ timeout: 2000 }); log(`big screen: clicked START (${sel})`); return `click ${sel}`; } catch {}
  }
  const r = await post("/start", { countdown: false });   // v1.4: the button plays the server's 3-2-1; the fallback starts at once
  log(`no START button on the big screen: POST /start {countdown:false} → ${r.status}`);
  return `post ${r.status}`;
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
  const { D, onMessage, lobbyDraws } = createDriver({ route: ROUTE, me: ME, drawSeconds: DRAW_S, now: Date.now, post, onStage: (name) => shoot(pages, name), log, Contract });
  const stream = events(onMessage);
  const joined = await phoneJoin(pages.phone);
  if (joined !== ME) D.issues.push(`phone joined as ${joined}, expected ${ME}`);
  await sleep(500);
  shoot(pages, "lobby");
  D.readyVia = await phoneReady(pages.phone);
  // expert: draws the ship and the explorer in the lobby (two of the space five), then the host presses START.
  await lobbyDraws();
  await sleep(1500);
  D.startVia = await hostStart(pages.big);
  // The explorer prompt after touchdown: v1 uses the default explorer.
  const explorerWatch = setInterval(async () => {
    const vis = await pages.phone.evaluate(() => { const e = document.getElementById("explorer"); return !!e && !e.classList.contains("hidden"); }).catch(() => false);
    if (vis) { await pages.phone.locator("#expDefault").tap({ timeout: 2000 }).catch(() => {}); if (!D.stages.explorer) { D.stages.explorer = { t: D.playingAt ? +((Date.now() - D.playingAt) / 1000).toFixed(2) : 0, clock: D.tick && D.tick.clock, choice: "default" }; log("phone: Use default explorer"); } }
  }, 1000);
  const limit = Date.now() + (ROUND_LIMIT_S + 20) * 1000;
  while (!D.endedAt && Date.now() < limit) await sleep(250);
  if (!D.endedAt) D.issues.push(`the round did not end within ${ROUND_LIMIT_S} s of play`);
  await sleep(2500); // scoreboard shot and one more perf post
  shoot(pages, "scoreboard");
  clearInterval(explorerWatch);
  stream.destroy();
  return D;
}
const ROUND = Contract.ROUND;

// ---- Main ----------------------------------------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
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
    // expert: wins, opens a chest, boss down by BOSS_BY s; regular: the round ends with a chest opened before 4:00.
    const verdict = judge(D, { route: ROUTE, me: ME, maxSeconds: ROUND.maxSeconds, bossBy: BOSS_BY });
    report.roundSeconds = D.endedAt ? +((D.endedAt - D.playingAt) / 1000).toFixed(1) : null;
    report.roundClock = D.wonClock;
    report.winner = D.winner;
    report.result = D.result;
    report.leaderboard = D.leaderboard;
    report.chestsOpened = D.chestsOpened;
    report.startVia = D.startVia;
    report.entities = D.entities;
    report.refusedToasts = D.refused;
    report.gates = { ...verdict.gates, noConsoleErrors: consoleErrors.length === 0, phonePerf: phonePerfOk };
    report.pass = Object.values(report.gates).every(Boolean);
    report.bossDownClock = verdict.bossDown;
    report.firstChestClock = verdict.firstChest;
    report.stageClocks = Object.fromEntries(Object.entries(D.stages).map(([k, v]) => [k, v.clock]));
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
  fs.writeFileSync(ROUTE_REPORT, JSON.stringify(report, null, 2));
  printReport(report);
  return report.pass;
}

function printReport(r) {
  const line = (s = "") => console.log(s);
  const pf = (x) => (x ? `${x.fps} fps (min ${x.fpsMin}), 1% low ${x.low1} (min ${x.low1Min}), p90 ${x.p90ms} ms, ${x.calls} calls (max ${x.callsMax}), ${Math.round(x.tris / 1000)}k tris (max ${Math.round(x.trisMax / 1000)}k), tier ${x.tier}, ${x.size}, ${x.samples} samples` : "no samples");
  line(); line(`==== Space Party e2e (${r.mode}${r.mode === "full" ? `, ${r.route}` : ""}, ${r.bots} bots) ${r.pass ? "PASS" : "FAIL"} ====`);
  if (r.mode === "full") {
    line(`round: ${r.roundSeconds == null ? "did not end" : `ended after ${r.roundSeconds} s (clock ${r.roundClock}, ${r.result && r.result.reason})`}, winner ${r.winner || "-"}, my chests ${r.chestsOpened}, deaths ${r.deaths}, start via ${r.startVia}`);
    line(`boss down at clock ${r.bossDownClock ?? "-"} (maxHp ${r.stages.bossDead ? r.stages.bossDead.hp : "?"}), first chest at clock ${r.firstChestClock ?? "-"}`);
    line(`scores: ${r.result ? r.result.scores.slice(0, 5).map(([n, s]) => `${n} ${s}`).join(", ") : "-"}; gates ${JSON.stringify(r.gates)}`);
    line(`entities: ${r.entities.map((e) => `${e.t}s ${e.type} [${e.verbs.join(" ")}] ${e.source}`).join(" | ")}`);
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
  line(`shots: ${r.shots.length} in ${path.relative(ROOT, SHOTS)}${r.video ? `, video ${r.video}` : ""}; report ${path.relative(ROOT, REPORT)} and ${path.relative(ROOT, ROUTE_REPORT)}`);
}

main().then((pass) => process.exit(pass ? 0 : 1)).catch(async (e) => {
  console.error(`[e2e] failed: ${e.stack || e.message}`);
  await cleanup();
  try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(REPORT, JSON.stringify({ pass: false, error: e.message, consoleErrors, measuredAt: new Date().toISOString() }, null, 2)); } catch {}
  process.exit(1);
});
