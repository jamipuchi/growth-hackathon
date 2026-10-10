// Shared helpers for the v1.1 client harness tools (shots.mjs, perf25.mjs, seed.mjs): server control, the laptop-vitals
// gate, browsers (Chromium big screen, WebKit iPhone), page watchers, phone UI helpers, seeding fake players.
// Everything here writes only under dev/v11-client/. Nothing here edits the game.
import { createRequire } from "module";
import { spawn, execSync } from "child_process";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

export const nodeRequire = createRequire(import.meta.url);
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = "/private/tmp/claude-501/v14-test";
export const Contract = nodeRequire(path.join(ROOT, "contract.js"));
export const Terrain = nodeRequire(path.join(ROOT, "terrain.js"));
export const Samples = nodeRequire("/private/tmp/claude-501/v14-test/dev/v11-client/samples.cjs");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeLogger(label) {
  const t0 = Date.now();
  const fn = (...a) => console.log(`[${label} ${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
  fn.since = () => (Date.now() - t0) / 1000;
  return fn;
}

export function args(argv = process.argv.slice(2)) {
  const flag = (n) => argv.includes(`--${n}`);
  const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
  const num = (n, d) => { const v = opt(n); return v == null || !Number.isFinite(Number(v)) ? d : Number(v); };
  const list = (n) => String(opt(n, "") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return { argv, flag, opt, num, list };
}

export function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout after ${ms} ms: ${label}`)), ms); })]).finally(() => clearTimeout(timer));
}

// ---- Laptop vitals (the orchestrator's watchdog writes them; HOLD means "no heavy runs now") -------------------------------

const STATUS = path.join(ROOT, ".orch/status");
export function vitals() {
  let hold = null, last = "";
  try { if (fs.existsSync(path.join(STATUS, "HOLD"))) hold = fs.readFileSync(path.join(STATUS, "HOLD"), "utf8").trim() || "on"; } catch {}
  try { const lines = fs.readFileSync(path.join(STATUS, "vitals.log"), "utf8").trim().split("\n"); last = lines[lines.length - 1] || ""; } catch {}
  const num = (re) => { const m = re.exec(last); return m ? Number(m[1]) : null; };
  return { hold, last, pressure: num(/pressure=(\d+)/), load: num(/load=([\d.]+)/), swapfree: num(/swapfree=([\d.]+)MB/) };
}
// Waits (polling) until HOLD is gone and the memory pressure is back to 1. Returns false when it gave up.
export async function waitForCalm({ log, maxWaitMs = 30 * 60 * 1000, skip = false } = {}) {
  if (skip) return true;
  const start = Date.now();
  let warned = 0;
  for (;;) {
    const v = vitals();
    if (!v.hold && !(v.pressure >= 2)) return true;
    if (Date.now() - start > maxWaitMs) { log && log(`gave up waiting for the laptop to calm down: ${v.last}`); return false; }
    if (Date.now() - warned > 60000) { warned = Date.now(); log && log(`waiting for the laptop (HOLD ${v.hold ? `on: ${v.hold}` : "off"}, memory pressure ${v.pressure}): ${v.last}`); }
    await sleep(10000);
  }
}

// ---- HTTP -------------------------------------------------------------------------------------------------------------------

export function request(base, method, pathname, body, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(new URL(pathname, base), { method, timeout, headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (text += d));
      res.on("end", () => { let json = null; try { json = text ? JSON.parse(text) : null; } catch {} resolve({ status: res.statusCode, json, text }); });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ status: 0, json: null, text: "", error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}
export const post = (base, p, body = {}) => request(base, "POST", p, body);
export const get = (base, p) => request(base, "GET", p);

// The server's /events stream: onMessage(message) for every JSON message.
export function openEvents(base, onMessage, onError) {
  const req = http.get(new URL("/events", base), (res) => {
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
  req.on("error", (e) => onError && onError(e));
  return { close: () => req.destroy() };
}

// ---- Cleanup: everything a tool starts is stopped by PID / handle, never by pattern ------------------------------------------

const cleanups = [];
const liveChildren = new Set();
let cleaning = null;
export function onCleanup(fn) { cleanups.push(fn); }
export function runCleanups() {
  if (!cleaning) cleaning = (async () => { for (const fn of cleanups.splice(0).reverse()) { try { await Promise.race([fn(), sleep(8000)]); } catch {} } })();
  return cleaning;
}
export function installSignalHandlers(log = console.log) {
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { log(`${sig}: cleaning up`); runCleanups().then(() => process.exit(sig === "SIGINT" ? 130 : 143)); });
  process.on("exit", () => { for (const c of liveChildren) { try { c.kill("SIGKILL"); } catch {} } });
  process.on("unhandledRejection", (e) => log(`unhandled rejection: ${(e && e.stack) || e}`));
}

// ---- Server -----------------------------------------------------------------------------------------------------------------

export function portBusy(port) {
  try { return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
}

// Starts dev/v11-client/server.cjs as OUR child process (never orphaned: the orchestrator's watchdog reaps orphaned node
// servers on ports 8101-8199 when memory pressure is high) and waits until it answers.
export async function startServer({ port, bots = 0, serverArgs = [], env = {}, logFile = null, script = "dev/v11-client/server.cjs", log = console.log }) {
  const busy = portBusy(port);
  if (busy) throw new Error(`port ${port} is already in use (pid ${busy}); pick another with --port`);
  const child = spawn(process.execPath, [script, "--bots", String(bots), ...serverArgs], { cwd: ROOT, env: { ...process.env, PORT: String(port), V11_EXIT_WITH_PARENT: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  liveChildren.add(child);
  if (logFile) { fs.mkdirSync(path.dirname(logFile), { recursive: true }); const out = fs.createWriteStream(logFile); child.stdout.pipe(out); child.stderr.pipe(out); } else { child.stdout.resume(); child.stderr.resume(); }
  let exited = false;
  child.on("exit", () => { exited = true; liveChildren.delete(child); });
  const base = `http://127.0.0.1:${port}`;
  const until = Date.now() + 25000;
  let up = false;
  while (Date.now() < until && !exited) {
    const r = await request(base, "GET", "/__test/info", undefined, { timeout: 1500 });
    if (r.status === 200) { up = true; break; }
    await sleep(200);
  }
  if (!up) { try { child.kill("SIGKILL"); } catch {} throw new Error(exited ? "the server exited before answering (see the server log)" : "the server did not answer within 25 s"); }
  log(`server up on :${port} (pid ${child.pid}, bots ${bots}${serverArgs.length ? `, ${serverArgs.join(" ")}` : ""})`);
  const server = {
    child, pid: child.pid, base, port,
    async stop() {
      if (exited) return;
      child.kill("SIGTERM");
      await Promise.race([new Promise((r) => child.once("exit", r)), sleep(2500)]);
      if (!exited) { try { child.kill("SIGKILL"); } catch {} }
    },
  };
  onCleanup(() => server.stop());
  return server;
}

// ---- Browsers ---------------------------------------------------------------------------------------------------------------

export const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
export function browserPaths() {
  const cache = process.env.PW_CACHE || path.join(os.homedir(), "Library/Caches/ms-playwright");
  const newest = (prefix) => fs.readdirSync(cache).filter((d) => new RegExp(`^${prefix}-\\d+$`).test(d)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0];
  const chrome = process.env.E2E_CHROME || path.join(cache, newest("chromium") || "chromium", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
  // The lead's rule: WebKit is pinned to webkit-2311 when it exists (the newer webkit-2368 hangs playwright-core 1.58.2).
  const pinned = path.join(cache, "webkit-2311", "pw_run.sh");
  const webkit = process.env.E2E_WEBKIT || (fs.existsSync(pinned) ? pinned : path.join(cache, newest("webkit") || "webkit", "pw_run.sh"));
  return { chrome, webkit };
}
export const loadPlaywright = () => nodeRequire(process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");

export async function launchBig({ headed = false } = {}) {
  const { chromium } = loadPlaywright();
  const { chrome } = browserPaths();
  if (!fs.existsSync(chrome)) throw new Error(`chromium not found at ${chrome}`);
  const browser = await chromium.launch({ executablePath: chrome, headless: !headed, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--autoplay-policy=no-user-gesture-required"] });
  onCleanup(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  return { browser, context, page };
}

// One WebKit browser; newPhone() opens an iPhone-like context (landscape 844x390 at DPR 3, touch, iPhone UA).
export async function launchPhoneBrowser({ headed = false } = {}) {
  const { webkit } = loadPlaywright();
  const { webkit: exe } = browserPaths();
  if (!fs.existsSync(exe)) throw new Error(`webkit not found at ${exe}`);
  const browser = await webkit.launch({ executablePath: exe, headless: !headed });
  onCleanup(() => browser.close());
  const contexts = [];
  return {
    browser,
    async newPhone({ video = null } = {}) {
      const context = await browser.newContext({
        viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA,
        ...(video ? { recordVideo: { dir: video, size: { width: 844, height: 390 } } } : {}),
      });
      contexts.push(context);
      const page = await context.newPage();
      return { context, page };
    },
  };
}

// Collects what a page does wrong (console errors, page errors, 4xx/5xx responses, failed requests, crashes) and the
// /perf samples it posts. drain() returns what is new since the last drain (per step).
export function watchPage(page, label, log = console.log) {
  const sink = { label, errors: [], warnings: [], http: [], failed: [], aborted: {}, perf: [], crashed: false, marks: { errors: 0, http: 0, failed: 0 } };
  const now = () => Date.now();
  page.on("pageerror", (e) => sink.errors.push({ t: now(), kind: "pageerror", text: String((e && e.message) || e).slice(0, 500) }));
  page.on("console", (m) => {
    const type = m.type();
    if (type === "error") sink.errors.push({ t: now(), kind: "console.error", text: m.text().slice(0, 500) });
    else if (type === "warning" && sink.warnings.length < 60) sink.warnings.push({ t: now(), text: m.text().slice(0, 300) });
  });
  page.on("response", (r) => { const status = r.status(); if (status >= 400) sink.http.push({ t: now(), status, url: r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 160) }); });
  // Aborted / cancelled requests (a POST /perf cut off by the browser, an /events stream closed by a reload) are noise, not
  // failures: they are counted in sink.aborted and left out of the per-step page problems.
  page.on("requestfailed", (r) => {
    const f = r.failure(), url = r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 160), error = (f && f.errorText) || "";
    if (/ERR_ABORTED|aborted|cancel/i.test(error)) sink.aborted[url.split("?")[0]] = (sink.aborted[url.split("?")[0]] || 0) + 1;
    else sink.failed.push({ t: now(), url, error });
  });
  page.on("crash", () => { sink.crashed = true; log(`PAGE CRASHED (${label})`); });
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().endsWith("/perf")) return;
    try { sink.perf.push({ ...JSON.parse(req.postData()), seen: now() }); } catch {}
  });
  sink.drain = () => {
    const out = { errors: sink.errors.slice(sink.marks.errors), http: sink.http.slice(sink.marks.http), failed: sink.failed.slice(sink.marks.failed) };
    sink.marks = { errors: sink.errors.length, http: sink.http.length, failed: sink.failed.length };
    return out;
  };
  return sink;
}

export async function shootPage(page, file, { timeout = 12000 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await withTimeout(page.screenshot({ path: file, timeout }), timeout + 3000, `screenshot ${path.basename(file)}`);
  return file;
}

// ---- Perf -------------------------------------------------------------------------------------------------------------------

// The page's own perf object when it exposes one (the big screen: window.__game.perf()).
export async function readGamePerf(page) {
  return page.evaluate(() => {
    const g = window.__game || (window.__sp && window.__sp.game);
    if (!g || typeof g.perf !== "function") return null;
    const p = g.perf();
    return p ? { fps: p.fps, low1: p.low1, p90ms: p.p90ms, calls: p.calls, tris: p.tris, textures: p.textures, tier: p.tier, w: p.w, h: p.h, dpr: p.dpr, scene: p.scene, followed: p.followed } : null;
  }).catch(() => null);
}

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const r1 = (n) => Math.round(n * 10) / 10;
// Summary of /perf samples (as the page posted them): skips the first sample (page load, shader compiles) when there are 3+.
export function summarisePerf(samples, { skipFirst = true } = {}) {
  const s = samples.filter((x) => Number.isFinite(x.fps));
  if (!s.length) return null;
  const warm = skipFirst && s.length > 2 ? s.slice(1) : s;
  const col = (k) => warm.map((x) => Number(x[k] || 0));
  const last = s[s.length - 1];
  return {
    samples: s.length, fps: r1(avg(col("fps"))), fpsMin: Math.min(...col("fps")), low1: r1(avg(col("low1"))), low1Min: Math.min(...col("low1")), p90ms: r1(avg(col("p90ms"))),
    calls: r1(avg(col("calls"))), callsMax: Math.max(...col("calls")), tris: Math.round(avg(col("tris"))), trisMax: Math.max(...col("tris")),
    textures: last.textures, tier: last.tier, size: `${last.w}x${last.h}@${last.dpr}`, dpr: last.dpr,
  };
}

// ---- Phone UI helpers (ids and hooks of SPEC section 9) -----------------------------------------------------------------------

export const sp = {
  step: (page) => page.evaluate(() => (window.__sp ? window.__sp.step || null : undefined)).catch(() => undefined),
  screen: (page) => page.evaluate(() => (window.__sp ? window.__sp.screen || null : undefined)).catch(() => undefined),
  // Which of the ids exist / are visible (rendered, not display:none, not class "hidden").
  async ids(page, ids) {
    return page.evaluate((list) => Object.fromEntries(list.map((id) => {
      const el = document.getElementById(id);
      if (!el) return [id, "missing"];
      const cs = getComputedStyle(el);
      const shown = el.getClientRects().length > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.classList.contains("hidden");
      return [id, shown ? "visible" : "hidden"];
    })), ids).catch(() => ({}));
  },
  async visible(page, id) { const r = await sp.ids(page, [id]); return r[id] === "visible"; },
  async exists(page, id) { const r = await sp.ids(page, [id]); return r[id] && r[id] !== "missing"; },
  async text(page, id) { return page.evaluate((i) => { const e = document.getElementById(i); return e ? (e.innerText || e.textContent || "").trim() : null; }, id).catch(() => null); },
  async attr(page, id, name) { return page.evaluate(([i, n]) => { const e = document.getElementById(i); return e ? e.getAttribute(n) : null; }, [id, name]).catch(() => null); },
  // Waits for __sp.step to be one of `steps`. A page that has no __sp.step at all (the v1.0 phone) fails after 2 s instead
  // of using the whole timeout.
  async waitStep(page, steps, timeout = 15000) {
    const want = Array.isArray(steps) ? steps : [steps];
    const t0 = Date.now(), until = t0 + timeout;
    let last;
    while (Date.now() < until) {
      last = await sp.step(page);
      if (want.includes(last)) return last;
      if ((last === null || last === undefined) && Date.now() - t0 > 2000) throw new Error(`step ${want.join("|")} not reached: the page has no __sp.step (${last === undefined ? "no window.__sp" : "not implemented yet"})`);
      await sleep(150);
    }
    throw new Error(`step ${want.join("|")} not reached (stuck at ${last})`);
  },
  async waitVisible(page, id, timeout = 10000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (await sp.visible(page, id)) return true; await sleep(150); }
    return false;
  },
  // A real touch tap when the element can take one; else a click, else a DOM click. Returns the method used.
  async tap(page, id, { timeout = 6000 } = {}) {
    // Missing: fail at once. Hidden (e.g. a button of another sheet): give it 1.5 s to appear, then fail at once.
    let state = (await sp.ids(page, [id]))[id];
    for (let i = 0; i < 10 && state === "hidden"; i++) { await sleep(150); state = (await sp.ids(page, [id]))[id]; }
    if (state === "missing" || !state) throw new Error(`missing #${id}`);
    if (state !== "visible") throw new Error(`hidden #${id}`);
    const loc = page.locator(`#${id}`).first();
    try { await loc.tap({ timeout }); return "tap"; } catch {}
    try { await loc.click({ timeout: 2000, force: true }); return "click"; } catch {}
    await page.evaluate((i) => document.getElementById(i).click(), id);
    return "dom-click";
  },
  async hasHook(page, name) { return page.evaluate((n) => !!(window.__spTest && typeof window.__spTest[n] === "function"), name).catch(() => false); },
};

// Draws a sample on the visible drawing pad: the page's own hook (__spTest.drawSample) when it has one, else real
// mouse strokes over #drawPad (variant picks a different drawing of the same sample). Returns "hook" or "mouse".
export async function drawSample(page, name, { variant = 0, padId = "drawPad" } = {}) {
  if (await sp.hasHook(page, "drawSample")) {
    const r = await page.evaluate(async (n) => { try { await window.__spTest.drawSample(n); return "ok"; } catch (e) { return `error: ${e && e.message}`; } }, name);
    if (r === "ok") return "hook";
  }
  const box = await page.evaluate((id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, padId);
  if (!box || box.w < 20 || box.h < 20) throw new Error(`no drawing pad #${padId} to draw on`);
  const strokes = Samples.strokesForPad(name, variant, box.w / box.h);
  for (const s of strokes) {
    const pts = s.length > 60 ? s.filter((_, i) => i % 2 === 0 || i === s.length - 1) : s;
    await page.mouse.move(box.x + pts[0][0] * box.w, box.y + pts[0][1] * box.h);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) await page.mouse.move(box.x + pts[i][0] * box.w, box.y + pts[i][1] * box.h);
    await page.mouse.up();
  }
  return "mouse";
}

// ---- Seeding fake players -----------------------------------------------------------------------------------------------------

// Names with meaning: car… draws explorers that are cars, bike… bikes, dog… quadrupeds, blob… blobs (server.cjs forces the
// type by prefix). The first eight cover every type. "carol" is left for the phone's own player in shots.mjs.
export const SEED_NAMES = [
  "ana", "ben", "carla", "bikeboy", "doggo", "blobby", "dina", "finn", "gus", "hana", "ivo", "jade", "kai", "carlos", "milo", "nora", "bikerose",
  "pia", "quin", "rosa", "dogma", "tess", "uma", "vic", "wes", "xena", "yara", "zoe", "abe", "bea", "cleo", "dax", "eve", "fay", "gil", "hal",
];
export const explorerSampleFor = (name) => (name.startsWith("car") ? "car" : name.startsWith("bike") ? "bike" : name.startsWith("dog") ? "dog" : "astronaut");

// Joins the players and gives each a drawn ship (a different rocket per player), optionally an explorer drawing and ready.
// names: explicit names, else SEED_NAMES[startAt .. startAt + n). Returns { names, ok, failed, entities }.
export async function seedPlayers(base, n, { names = null, startAt = 0, explorers = false, ready = false, log = () => {}, concurrency = 4 } = {}) {
  const list = names || SEED_NAMES.slice(startAt, startAt + n);
  const result = { names: list, ok: [], failed: [], entities: {}, variants: {} };
  let next = 0;
  // Joins are sequential (the spawn grid slots follow the join order, so lobbies look the same every run); the drawings
  // are generated a few at a time.
  const joined = new Set();
  for (const name of list) { const j = await post(base, "/join", { player: name }); if (j.status === 200) joined.add(name); else result.failed.push({ name, error: `join ${j.status}` }); }
  const one = async (name, idx) => {
    try {
      if (!joined.has(name)) return;
      result.variants[name] = startAt + idx + 1;
      const g = await post(base, "/generate", { player: name, kind: "ship", image: Samples.dataUrl("ship", result.variants[name]), source: "draw", speculative: false, requestId: `seed-ship-${name}` });
      if (!g.json || !g.json.ok) throw new Error(`generate ship: ${(g.json && g.json.error) || g.status}`);
      result.entities[name] = { ship: { type: g.json.entity.type, verbs: g.json.entity.verbs, image: g.json.entity.image } };
      if (explorers) {
        const e = await post(base, "/generate", { player: name, kind: "explorer", image: Samples.dataUrl(explorerSampleFor(name), result.variants[name]), source: "draw", speculative: false, requestId: `seed-explorer-${name}` });
        if (!e.json || !e.json.ok) throw new Error(`generate explorer: ${(e.json && e.json.error) || e.status}`);
        result.entities[name].explorer = { type: e.json.entity.type, verbs: e.json.entity.verbs };
      }
      if (ready) await post(base, "/input", { type: "input", player: name, action: "ready", down: true });
      result.ok.push(name);
    } catch (err) { result.failed.push({ name, error: err.message }); }
  };
  const workers = Array.from({ length: Math.min(concurrency, list.length) }, async () => { while (next < list.length) { const idx = next++; await one(list[idx], idx); } });
  await Promise.all(workers);
  log(`seeded ${result.ok.length}/${list.length} players${result.failed.length ? `, ${result.failed.length} failed: ${result.failed.map((f) => `${f.name} (${f.error})`).join("; ")}` : ""}`);
  return result;
}

// Keeps seeded players "active" (world.js drops a human after 10 minutes without input) with a harmless input.
export function keepAlive(base, names, everyMs = 60000) {
  const timer = setInterval(() => { for (const player of names) post(base, "/input", { type: "input", player, action: "view", down: false }); }, everyMs);
  onCleanup(() => clearInterval(timer));
  return () => clearInterval(timer);
}

// Test hooks of server.cjs (skip travel time); every one answers { ok: false } instead of throwing.
export const hook = {
  state: async (base) => { const r = await get(base, "/__test/state"); return r.json && r.json.ok ? r.json : null; },
  info: async (base) => { const r = await get(base, "/__test/info"); return r.json; },
  round: (base, body) => post(base, "/__test/round", body).then((r) => r.json),
  teleport: (base, body) => post(base, "/__test/teleport", body).then((r) => r.json),
  boss: (base, body) => post(base, "/__test/boss", body).then((r) => r.json),
};

export const input = (base, player, action, down) => post(base, "/input", { type: "input", player, action, down });
export const axis = (base, player, name, x, y) => post(base, "/input", { type: "axis", player, axis: name, x, y });

export function summariseConsole(sinks) {
  return Object.fromEntries(sinks.map((s) => [s.label, { errors: s.errors.map(({ kind, text }) => ({ kind, text })), http: s.http.map(({ status, url }) => ({ status, url })), failed: s.failed.map(({ url, error }) => ({ url, error })), abortedRequests: s.aborted, warnings: s.warnings.length, crashed: s.crashed }]));
}

// ---- Scenario helpers (test hooks of server.cjs: skip the minutes of travel, the game rules still run) ----------------------------

export async function waitFor(fn, { timeout = 10000, every = 250 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return null;
    await sleep(every);
  }
}
const hasVerbs = (st, player, verbs) => { const p = st && st.players[player]; return !!p && verbs.every((v) => (p.verbs || []).includes(v)); };

// Makes sure the player's ship can shoot and land: a plain ship gets them from the assists (hook: assistsAt 0).
async function ensureShipSkills(base, player, log) {
  let st = await hook.state(base);
  if (hasVerbs(st, player, ["shoot", "land"])) return st;
  log(`${player} has no weapon / landing legs: switching the assists on`);
  await hook.round(base, { assistsAt: 0 });
  return waitFor(async () => { const s = await hook.state(base); return hasVerbs(s, player, ["shoot", "land"]) ? s : null; }, { timeout: 4000 });
}

// The player's ship kills the boss: boss HP down to a couple of hits, ship put 25 m off its surface facing it, SHOOT held.
export async function killBoss(base, player, { log = () => {} } = {}) {
  let st = await ensureShipSkills(base, player, log);
  if (!st) throw new Error("hooks unavailable or the ship cannot shoot");
  if (st.boss && st.boss.dead) return st;
  const b = st.boss;
  await hook.boss(base, { hp: 24 });
  await hook.teleport(base, { player, near: { x: b.x, y: b.y, z: b.z }, distance: b.radius + 25, face: { x: b.x, y: b.y, z: b.z }, heal: true });
  await input(base, player, "shoot", true);
  st = await waitFor(async () => { const s = await hook.state(base); return s && s.boss && s.boss.dead ? s : null; }, { timeout: 8000, every: 200 });
  await input(base, player, "shoot", false);
  if (!st) throw new Error("the boss did not die");
  log(`boss down at play clock ${st.playT} s; the planet appeared`);
  return st;
}

// Puts the ship 22 m inside the landing range of the planet, facing it, and presses LAND (the landing shot plays 3 s).
export async function pressLand(base, player, { log = () => {} } = {}) {
  const st = await hook.state(base);
  if (!st || !st.planet) throw new Error("no planet yet (the boss is alive)");
  const p = st.planet;
  await hook.teleport(base, { player, near: { x: p.x, y: p.y, z: p.z }, distance: p.radius + 22, face: { x: p.x, y: p.y, z: p.z }, heal: true });
  await input(base, player, "land", true);
  await sleep(250);
  await input(base, player, "land", false);
  log(`${player} pressed LAND`);
}
export async function waitForMode(base, player, mode, timeout = 12000) {
  return waitFor(async () => { const s = await hook.state(base); return s && s.players[player] && s.players[player].mode === mode ? s : null; }, { timeout, every: 250 });
}
// Several ships land together (each needs LAND: drawn dev-kit ships have it).
export async function landParty(base, names, { log = () => {} } = {}) {
  const st = await hook.state(base);
  if (!st || !st.planet) throw new Error("no planet yet");
  const p = st.planet;
  for (const name of names) {
    if (!st.players[name] || st.players[name].mode !== "space" || !(st.players[name].verbs || []).includes("land")) continue;
    await hook.teleport(base, { player: name, near: { x: p.x, y: p.y, z: p.z }, distance: p.radius + 18 + Math.random() * 6, face: { x: p.x, y: p.y, z: p.z }, heal: true });
    await input(base, name, "land", true);
  }
  await sleep(250);
  for (const name of names) await input(base, name, "land", false);
  log(`landing party: ${names.join(", ")}`);
}
// Next to a closed rock chest (kind "rock"), 2 m away, facing it. Returns the chest or null.
export async function standByRockChest(base, player, { kind = "rock" } = {}) {
  const st = await hook.state(base);
  const chest = st && st.chests.find((c) => c.kind === kind && c.buried && !c.open);
  if (!chest) return null;
  await hook.teleport(base, { player, x: chest.x + 2, z: chest.z, face: { x: chest.x, y: 0, z: chest.z }, heal: true });
  return chest;
}
