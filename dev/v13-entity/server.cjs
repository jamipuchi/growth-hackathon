// Test server for the v1.3 entity kit (dev/v13-entity/run.mjs starts it; it can also run by hand):
//   PORT=8274 V13_MODE=replay|mock|real [V13_REAL_MAX=N] node dev/v13-entity/server.cjs
// It is the REAL server.js of this tree (never edited), required in-process after this wrapper has set up:
//   env      HTTPS_PORT=0 (no HTTPS), PORT (default 8274), PERF_LOG → dev/v13-entity/out/perf.log, Astra's drawing copies →
//            dev/v13-entity/out/controllers (astra._internals.setDir; the repo's controllers/ stays untouched), and the
//            round clock stretched (assists at 25:00, cap at 30:00) so a run never meets the 3:00 assists (which would add
//            gate skills to every entity) or the 4:00 cap (which would send landed explorers back to space).
//   modes    V13_MODE=replay (default): OpenAI is never called. globalThis.fetch answers https://api.openai.com/ with the
//              REAL gpt-6.1-sol answer recorded for that exact image in the generation corpus
//              (dev/gen-corpus/fixtures/{after,confirm,pad}/*.json, keyed by sha1 of the image data URL, as
//              dev/astra/fake-openai.cjs does), else a scripted answer the runner registered (POST /__test/script), else
//              HTTP 599 (Astra then falls back to the dev kit, which run.mjs reports as a failure). OPENAI_API_KEY is set
//              to a dummy, so Astra calls fetch and never reads the .env. Every step after the model (Astra's parsing,
//              wiring, the card, server.js, world.js, the event stream) is the real code.
//            V13_MODE=mock: ASTRA_MOCK=1 and OPENAI_API_KEY="" (Astra's offline answer: the dev kit for every entity; no
//              refusals, no types other than ship / person).
//            V13_MODE=real: the real API for at most V13_REAL_MAX HTTP requests (default 0; hedged requests and retries
//              count too), then replay as above. The key is whatever Astra finds (the environment or its own .env read);
//              this file never reads, prints or logs it.
//            V13_REPLAY_MS: delay every replayed / scripted answer by this many ms (default 0; ~1500 is a real call).
//   hooks    GET  /__test/info                  pid, port, mode, round timing, the counts of model calls
//            GET  /__test/state                 phase, boss, planet, every player's mode, landing and live entity
//            GET  /__test/calls                 { mode, cap, real, replayed, scripted, missing, blocked, log: [...] }
//            POST /__test/script { answers: { <sha1 of the image data URL>: <model answer JSON> } }
//            POST /__test/planet { players: [names], timeoutMs? }   puts those players on the planet the way the game
//              does it: START (if in the lobby), the boss's last hit (a helper ship "kithelper" with the dev kit fires at a
//              boss left with 1 HP), then for each player a LAND-capable ship if theirs cannot land (the dev kit through
//              world.setEntity: their own ship drawing is replaced, which is why ship drawings use other players), a
//              place 10 m off the planet and LAND pressed through world.handleInput; it answers once every one of them
//              touched down (mode "planet") or after timeoutMs (default 9000).
//   parent   V13_EXIT_WITH_PARENT=1 (run.mjs sets it): the server exits when the process that started it is gone.
// Touches only the live world object (captured from world.createWorld) and public world.js functions.
"use strict";
const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const log = (...a) => console.log("[v13-entity-server]", ...a);

// ---- Environment (before server.js and astra.js are required) ----------------------------------------------------

const MODE = ["replay", "mock", "real"].includes(process.env.V13_MODE) ? process.env.V13_MODE : "replay";
const REAL_MAX = Math.max(0, Math.floor(Number(process.env.V13_REAL_MAX) || 0));
const REPLAY_MS = Math.max(0, Number(process.env.V13_REPLAY_MS) || 0);
process.env.HTTPS_PORT = "0";
process.env.PORT = process.env.PORT || "8274";
const PORT = Number(process.env.PORT);
fs.mkdirSync(OUT, { recursive: true });
process.env.PERF_LOG = process.env.PERF_LOG || path.join(OUT, "perf.log");
try { fs.writeFileSync(process.env.PERF_LOG, ""); } catch {}
const DRAWINGS_DIR = path.join(OUT, "controllers");
if (MODE === "mock") {
  process.env.ASTRA_MOCK = "1";
  process.env.OPENAI_API_KEY = ""; // present but blank: Astra never falls back to the .env
} else {
  delete process.env.ASTRA_MOCK;
  if (MODE === "replay") process.env.OPENAI_API_KEY = "sk-v13-entity-kit-offline-replay"; // a dummy: fetch below answers
  // real: the environment's key, or Astra's own .env read
}

const Contract = require(path.join(ROOT, "contract.js"));
const Verbs = require(path.join(ROOT, "verbs.js"));
const ROUND_DEFAULTS = { ...Contract.ROUND };
Contract.ROUND.assistsAt = 1500;
Contract.ROUND.maxSeconds = 1800;

// ---- The model, replayed -------------------------------------------------------------------------------------------

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const recorded = new Map(); // image sha1 → the recorded Responses API body
for (const run of ["after", "confirm", "pad"]) {
  const dir = path.join(ROOT, "dev/gen-corpus/fixtures", run);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { continue; }
  for (const file of files) {
    try {
      const f = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      const call = (f.calls || []).find((c) => c.status === 200 && c.response);
      if (call && f.imageSha) recorded.set(f.imageSha, call.response);
    } catch {}
  }
}
const scripted = new Map(); // image sha1 → a model answer object (wrapped as a Responses API body when served)
const responseOf = (answer) => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] });

// The image a request carries: the input_image of the Responses API request, else the first image data URL in it.
function imageOf(body) {
  const text = typeof body === "string" ? body : "";
  try {
    const req = JSON.parse(text);
    for (const item of Array.isArray(req.input) ? req.input : []) {
      for (const c of Array.isArray(item && item.content) ? item.content : []) {
        if (c && c.type === "input_image" && typeof c.image_url === "string") return c.image_url;
      }
    }
  } catch {}
  const m = /"(data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)"/.exec(text);
  return m ? m[1] : null;
}

const calls = { real: 0, replayed: 0, scripted: 0, missing: 0, blocked: 0, log: [] };
function note(sha, source, status, t0) {
  calls[source] = (calls[source] || 0) + 1;
  calls.log.push({ t: Date.now(), sha, source, status, ms: Date.now() - t0 });
  if (calls.log.length > 400) calls.log.shift();
}
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const realFetch = globalThis.fetch;
globalThis.fetch = async function kitFetch(url, opts = {}) {
  if (!String(url && url.url ? url.url : url).startsWith("https://api.openai.com/")) return realFetch(url, opts);
  const t0 = Date.now();
  const image = imageOf(opts && opts.body);
  const sha = image ? sha1(image) : null;
  if (MODE === "real" && calls.real < REAL_MAX) {
    calls.real++; // counted before the request: the cap holds even for requests that fail
    try {
      const res = await realFetch(url, opts);
      calls.log.push({ t: Date.now(), sha, source: "real", status: res.status, ms: Date.now() - t0 });
      return res;
    } catch (err) {
      calls.log.push({ t: Date.now(), sha, source: "real", status: "error", ms: Date.now() - t0 });
      throw err;
    }
  }
  if (MODE === "mock") { note(sha, "blocked", 599, t0); return jsonResponse({ error: { message: "the entity kit's mock mode never calls OpenAI" } }, 599); }
  const body = sha && recorded.get(sha);
  const answer = !body && sha && scripted.get(sha);
  if (REPLAY_MS && (body || answer)) await new Promise((r) => setTimeout(r, REPLAY_MS));
  if (body) { note(sha, "replayed", 200, t0); return jsonResponse(body); }
  if (answer) { note(sha, "scripted", 200, t0); return jsonResponse(responseOf(answer)); }
  note(sha, "missing", 599, t0);
  return jsonResponse({ error: { message: "no recorded or scripted answer for this image (entity kit replay)" } }, 599);
};

// ---- Astra: drawing copies into out/ ----------------------------------------------------------------------------------

try {
  const astra = require(path.join(ROOT, "astra.js"));
  if (astra._internals && typeof astra._internals.setDir === "function") astra._internals.setDir(DRAWINGS_DIR);
} catch (err) {
  log(`astra.js did not load (${err.message}): server.js will answer finished drawings with its fallback dev kit`);
}

// ---- The live world (test hooks only) ---------------------------------------------------------------------------------

const WorldModule = require(path.join(ROOT, "world.js"));
let world = null;
const realCreateWorld = WorldModule.createWorld;
WorldModule.createWorld = function createWorld(...args) { world = realCreateWorld.apply(this, args); return world; };

const r2 = (n) => Math.round(n * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const devKitShip = () => ({ type: "ship", unlocked: Verbs.DEV_KIT.space.map((u) => ({ ...u })), parts: [], source: "devkit" });

function snapshot() {
  if (!world) return { ok: false, error: "world not captured" };
  const d = world.debug();
  const players = {};
  for (const [name, p] of Object.entries(world.players)) {
    const e = p.entity || {};
    players[name] = {
      mode: p.mode, bot: !!p.bot, dead: !!p.dead, landingFor: r2(p.landingFor || 0), x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z),
      drawingsLeft: world.drawingsLeft(name),
      entity: { type: e.type, rig: e.rig, source: e.source, verbs: e.verbs, unlocked: e.unlocked, card: e.card, assisted: e.assisted, image: e.image },
    };
  }
  const boss = d.boss && { hp: Math.round(d.boss.hp), maxHp: d.boss.maxHp, dead: !!d.boss.dead, radius: d.boss.radius, x: r2(d.boss.pos.x), y: r2(d.boss.pos.y), z: r2(d.boss.pos.z) };
  return { ok: true, phase: world.phase, round: world.round, assists: !!d.assists, boss, planet: d.planet || null, parked: d.parked || [], players };
}

function place(p, at, target) {
  p.pos = { x: at.x, y: at.y, z: at.z };
  p.vy = 0;
  p.vel = { x: 0, y: 0, z: 0 };
  if (target) {
    const dx = target.x - at.x, dy = target.y - at.y, dz = target.z - at.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
}

// The boss's last hit, as in play: a ship with a weapon fires at a boss left with 1 HP. The helper re-aims from 25 m off
// the boss's surface every 100 ms (ships keep flying forward).
async function killBoss(timeoutMs) {
  const HELPER = "kithelper";
  if (!world.players[HELPER]) world.join(HELPER, "kit-helper-device");
  if (!world.players[HELPER]) return { ok: false, error: "the helper could not join (game full?)" };
  world.setEntity(HELPER, "ship", devKitShip());
  const boss = world.debug().boss;
  if (!boss) return { ok: false, error: "no boss" };
  boss.hp = Math.min(boss.hp, 1);
  const p = world.players[HELPER];
  const until = Date.now() + timeoutMs;
  world.handleInput({ type: "input", player: HELPER, action: "shoot", down: true });
  while (!world.debug().planet && Date.now() < until) {
    const b = world.debug().boss;
    place(p, { x: b.pos.x, y: b.pos.y, z: b.pos.z + b.radius + 25 }, b.pos);
    p.hp = Contract.TUNING.shipHp; p.dead = false;
    await sleep(100);
  }
  world.handleInput({ type: "input", player: HELPER, action: "shoot", down: false });
  if (world.debug().planet) place(p, { x: p.pos.x, y: p.pos.y + 120, z: p.pos.z + 200 }, null); // out of the way
  return world.debug().planet ? { ok: true } : { ok: false, error: "the boss did not die" };
}

async function toPlanet(body) {
  if (!world) return { ok: false, error: "world not captured" };
  const t0 = Date.now();
  const timeoutMs = Number.isFinite(Number(body.timeoutMs)) ? Number(body.timeoutMs) : 9000;
  const names = (Array.isArray(body.players) ? body.players : [body.player]).map((n) => Contract.cleanName(n)).filter(Boolean);
  if (world.phase === "lobby" && !world.start()) return { ok: false, error: "START refused" };
  if (world.phase !== "playing" && world.phase !== "assists") return { ok: false, error: `phase is ${world.phase}` };
  let started = { ok: true };
  if (!world.debug().planet) started = await killBoss(Math.min(6000, timeoutMs));
  if (!started.ok) return { ...started, ms: Date.now() - t0 };
  const pl = world.debug().planet;
  const granted = [];
  const players = {};
  const press = (name, down) => world.handleInput({ type: "input", player: name, action: "land", down });
  const approach = (p, i) => {
    const a = (i / Math.max(1, names.length)) * Math.PI * 2;
    const r = pl.radius + 10;
    place(p, { x: pl.x + Math.cos(a) * r, y: pl.y, z: pl.z + Math.sin(a) * r }, pl);
  };
  names.forEach((name, i) => {
    const p = world.players[name];
    if (!p) { players[name] = { ok: false, error: "no such player" }; return; }
    if (p.mode === "planet") return;
    if (!(p.entity && Array.isArray(p.entity.verbs) && p.entity.verbs.includes("land"))) { world.setEntity(name, "ship", devKitShip()); granted.push(name); }
    approach(p, i);
    press(name, true);
  });
  const until = Date.now() + timeoutMs;
  let tries = 0;
  while (Date.now() < until) {
    const waiting = names.filter((n) => world.players[n] && world.players[n].mode !== "planet");
    if (!waiting.length) break;
    if (++tries % 4 === 0) {
      // Not landing yet (a refused press, a drift out of range): put it back and press LAND again.
      waiting.forEach((n) => { const p = world.players[n]; if (!(p.landingFor > 0)) { press(n, false); approach(p, names.indexOf(n)); press(n, true); } });
    }
    await sleep(100);
  }
  for (const n of names) {
    const p = world.players[n];
    if (!p) continue;
    press(n, false);
    players[n] = players[n] || { ok: p.mode === "planet", mode: p.mode, landingFor: r2(p.landingFor || 0), type: p.entity && p.entity.type };
  }
  const ok = names.length > 0 && names.every((n) => players[n] && players[n].ok);
  return { ok, phase: world.phase, granted, players, ms: Date.now() - t0 };
}

// ---- Hooks --------------------------------------------------------------------------------------------------------------

const json = (res, status, body) => res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}
const callsView = () => ({ mode: MODE, cap: REAL_MAX, real: calls.real, replayed: calls.replayed, scripted: calls.scripted, missing: calls.missing, blocked: calls.blocked, recorded: recorded.size, log: calls.log });

async function testEndpoint(req, res, pathname) {
  try {
    if (pathname === "/__test/info") {
      const { log: _log, ...counts } = callsView();
      return json(res, 200, { ok: true, kit: "v13-entity", pid: process.pid, port: PORT, mode: MODE, round: { ...Contract.ROUND }, roundDefaults: ROUND_DEFAULTS, world: !!world, calls: counts, drawingsDir: DRAWINGS_DIR, perfLog: process.env.PERF_LOG });
    }
    if (pathname === "/__test/state") return json(res, 200, snapshot());
    if (pathname === "/__test/calls") return json(res, 200, { ok: true, ...callsView() });
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST expected" });
    const body = await readBody(req);
    if (pathname === "/__test/script") {
      let n = 0;
      for (const [sha, answer] of Object.entries((body && body.answers) || {})) if (/^[0-9a-f]{40}$/.test(sha) && answer && typeof answer === "object") { scripted.set(sha, answer); n++; }
      return json(res, 200, { ok: true, added: n, scripted: scripted.size });
    }
    if (pathname === "/__test/planet") return json(res, 200, await toPlanet(body));
    return json(res, 404, { ok: false, error: "unknown test hook" });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message });
  }
}

const realCreateServer = http.createServer;
http.createServer = function createServer(...args) {
  const i = args.findIndex((a) => typeof a === "function");
  if (i >= 0) {
    const handler = args[i];
    args[i] = function wrapped(req, res) {
      let pathname = req.url;
      try { pathname = new URL(req.url, "http://localhost").pathname; } catch {}
      if (pathname.startsWith("/__test/")) return testEndpoint(req, res, pathname);
      return handler(req, res);
    };
  }
  return realCreateServer.apply(this, args);
};

// ---- Start the real server ------------------------------------------------------------------------------------------------

if (process.env.V13_EXIT_WITH_PARENT === "1") {
  const parent = process.ppid;
  setInterval(() => { if (process.ppid !== parent) { log("the parent process is gone: exiting"); process.exit(0); } }, 1500).unref();
}
log(`mode ${MODE}${MODE === "real" ? ` (at most ${REAL_MAX} real requests, then replay)` : ""}; ${recorded.size} recorded answers; port ${PORT}; drawings → ${path.relative(ROOT, DRAWINGS_DIR)}`);
const probe = net.createServer();
probe.once("error", (err) => { console.error(`[v13-entity-server] port ${PORT} is not available (${err.code}); pick another with --port`); process.exit(3); });
probe.listen(PORT, "0.0.0.0", () => probe.close(() => require(path.join(ROOT, "server.js"))));
