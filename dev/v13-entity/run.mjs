#!/usr/bin/env node
// v1.3 entity kit: proves that drawing an entity works end to end, for every entity type (PLAN.md section 0, contract.js
// entity message), the way a phone does it, against the real server.
//   node dev/v13-entity/run.mjs [--port P] [--real N] [--mock] [--only id,id] [--no-browser] [--headed]
//     (default)    replay: the server (dev/v13-entity/server.cjs around the real server.js) answers OpenAI with the REAL
//                  gpt-6.1-sol answers recorded for these exact drawings (dev/gen-corpus/fixtures); no network, no key.
//     --mock       ASTRA_MOCK=1: Astra's offline dev kit for every entity (types, skills and refusals are then "n/a").
//     --real N     the real model for at most N HTTP requests (hedges and retries count), the rest replayed.
//     --only ids   only these drawings (dev/v13-entity/drawings.mjs ids), e.g. --only ship-gun-flames,car-cannon
//     --no-browser the HTTP checks only (no Chromium / WebKit)
// Writes dev/v13-entity/report.json and dev/v13-entity/shots/*.png. Exit 0 only when every hard check passed (1: a
// check failed, 2: bad arguments, 3: the setup failed: port busy, server or browsers did not start).
//
// Per drawing (ships in the lobby, explorers after landing on the planet through the server's test hook):
//   1. a speculative POST /generate (the phone's, 1.2 s after the last stroke): spends nothing, sends no entity message
//   2. the finished POST /generate: an entity of the right type, the skills its drawn parts unlock (generous: the
//      drawn gate skills must be there), the unlock card in plain words, one drawing spent, the image URL, the image
//      served byte for byte, and the `entity` message with that image on the player's own stream and on the TV stream.
//      A controller drawn in the ship / explorer step is refused in plain words, spends nothing, sends nothing, and
//      "Use it anyway" (anyway: true) then answers an entity. The scribble is refused in plain words (a generous real
//      model may instead read a plain entity: both pass).
//   3. a TV that connects afterwards (an SSE stream, then space.html in Chromium: window.__game.entityOf) has every
//      entity with its image.
//   4. Chromium (the TV, 1440x900) and WebKit (iPhone 844x390, DPR 3, touch) each build every drawn entity with the
//      game's own code (inflate.js inflateDrawing on the served drawing, as render.js does; quality "big" on the TV,
//      "lite" = the phone's game view) and show it in render.js createEntityPreview (the phone's result card) for a
//      screenshot: triangles, draw calls, build ms and size in metres vs the expected (ship 3.2, person 1.8 tall,
//      car 4.0, bike 2.0, quadruped 2.0, blob 1.4: inflate.js KIND / render.js entSize).
import { createRequire } from "module";
import { spawn, execSync } from "child_process";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { DRAWINGS, loadDrawing, dataUrlOf, imageSha, pngSize, corpusFile, corpusMeta } from "./drawings.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const Verbs = require(path.join(ROOT, "verbs.js"));

// ---- Options ---------------------------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
if (flag("help") || flag("h")) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1).filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(0);
}
const PORT = Number(opt("port", 8274));
const REAL = opt("real") === null ? 0 : Number(opt("real"));
const MOCK = flag("mock");
const BROWSER = !flag("no-browser");
const HEADED = flag("headed");
const ONLY = opt("only") ? new Set(opt("only").split(",").map((s) => s.trim()).filter(Boolean)) : null;
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) { console.error("--port: 1024..65535"); process.exit(2); }
if (opt("real") !== null && !(Number.isInteger(REAL) && REAL >= 1)) { console.error("--real N: N is a whole number of real requests, at least 1"); process.exit(2); }
if (MOCK && REAL) { console.error("--mock and --real exclude each other"); process.exit(2); }
const MODE = MOCK ? "mock" : REAL ? "real" : "replay";
const SET = DRAWINGS.filter((d) => !ONLY || ONLY.has(d.id));
if (ONLY) for (const id of ONLY) if (!DRAWINGS.some((d) => d.id === id)) { console.error(`--only: no drawing "${id}" (ids: ${DRAWINGS.map((d) => d.id).join(", ")})`); process.exit(2); }

const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(HERE, "shots");
const OUT = path.join(HERE, "out");
const REPORT = path.join(HERE, "report.json");
const SERVER_LOG = path.join(OUT, "server.log");
const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = process.env.PW_CACHE || path.join(os.homedir(), "Library/Caches/ms-playwright");
const newest = (prefix) => { try { return fs.readdirSync(CACHE).filter((d) => new RegExp(`^${prefix}-\\d+$`).test(d)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0]; } catch { return null; } };
const CHROME = process.env.E2E_CHROME || path.join(CACHE, newest("chromium") || "chromium", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const WEBKIT = process.env.E2E_WEBKIT || path.join(CACHE, newest("webkit") || "webkit", "pw_run.sh");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// What the game builds (inflate.js KIND sizes = render.js entSize; the ship lies flat, side kinds are side views).
const EXPECTED_M = { ship: 3.2, person: 1.8, car: 4.0, bike: 2.0, quadruped: 2.0, blob: 1.4 };
const SIZE_TOL = { ship: 0.2, person: 0.1, car: 0.15, bike: 0.2, quadruped: 0.2, blob: 0.25 };
const measuredM = (type, s) => (type === "person" ? s.y : type === "ship" ? Math.max(s.x, s.z) : Math.max(s.z, s.y));
const measuredAxis = (type) => (type === "person" ? "height (y)" : type === "ship" ? "longest of x, z" : "longest of z, y");
// inflate.js budgets for the body (+ about 200 for wheels): phone 4k, lite 2.6k (the phone's game view), big 12k.
const TRI_BUDGET = { lite: 2600, phone: 4000, big: 12000 };
const TRI_SLACK = 400;
const BUILD_MS_TARGET = { tv: 150, phone: 250 };   // soft: PLAN.md section 6 says about 100 ms on the device
const DRAW_CALLS = { soft: 4, hard: 12 };
// Player-facing text must never show internal names or code (PLAN.md section 0, "SUPER CLEAR").
const INTERNAL = /\b(verbs?|entity|entities|slot|layout|devkit|undefined|null|NaN|true|false)\b|\[object|[{}<>]/i;
const WORLD_OF_KIND = { ship: "space", explorer: "planet" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const since = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
const log = (...a) => console.log(`[entity-kit ${since()}s]`, ...a);
const round = (n, d = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const device = () => crypto.randomBytes(8).toString("hex");

// ---- Report and checks -------------------------------------------------------------------------------------------------

const report = {
  kit: "v13-entity", startedAt: new Date().toISOString(), mode: MODE, realCap: REAL || 0, port: PORT, argv,
  drawings: [], late: { stream: [], browser: [] }, planet: null, browser: null, calls: null, consoleErrors: [], timeline: {}, setupError: null,
};
// A check: ok true / false, or null = not applicable in this mode. level "hard" fails the run, "soft" is reported only.
function checker(checks) {
  return (name, ok, detail = "", level = "hard") => {
    checks.push({ name, ok: ok === null ? null : !!ok, level, detail: typeof detail === "string" ? detail.slice(0, 400) : JSON.stringify(detail).slice(0, 400) });
    return ok;
  };
}
const globalChecks = [];
const gcheck = checker(globalChecks);
report.checks = globalChecks;

// ---- HTTP and the event stream ---------------------------------------------------------------------------------------------

function request(method, pathname, body, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const started = Date.now();
    const req = http.request(`${BASE}${pathname}`, { method, headers: data ? { "Content-Type": "application/json", "Content-Length": data.length } : {} }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString("utf8")); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, buf, ms: Date.now() - started });
      });
      res.on("error", (err) => resolve({ status: 0, error: err.message, ms: Date.now() - started }));
    });
    req.on("error", (err) => resolve({ status: 0, error: err.message, ms: Date.now() - started }));
    req.setTimeout(timeout, () => req.destroy(new Error(`timeout after ${timeout} ms`)));
    if (data) req.write(data);
    req.end();
  });
}
const post = (p, body, o) => request("POST", p, body, o);
const get = (p, o) => request("GET", p, undefined, o);

// An SSE stream like a screen's: /events?player=<name> (a phone) or ?screen=big (the TV). Ticks are skipped unparsed.
const streams = [];
function openStream(query, label) {
  const s = { label, entity: [], world: [], toast: [], firstWorld: null, open: false, waiters: new Set(), req: null };
  streams.push(s);
  s.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: no world message within 8 s`)), 8000);
    const req = http.get(`${BASE}/events?${query}`, { headers: { Accept: "text/event-stream" } }, (res) => {
      if (res.statusCode !== 200) { clearTimeout(timer); res.resume(); reject(new Error(`${label}: /events answered ${res.statusCode}`)); return; }
      s.open = true;
      res.setEncoding("utf8");
      let buf = "";
      res.on("data", (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data: ") || line.startsWith('data: {"type":"tick"')) continue;
            let m;
            try { m = JSON.parse(line.slice(6)); } catch { continue; }
            const rec = { t: Date.now(), m };
            if (m.type === "entity") s.entity.push(rec);
            else if (m.type === "world") {
              s.world.push(rec);
              if (!s.firstWorld) { s.firstWorld = rec; clearTimeout(timer); resolve(s); }
            } else if (m.type === "toast") s.toast.push(rec);
          }
          for (const w of [...s.waiters]) w();
        }
      });
      const closed = () => { s.open = false; };
      res.on("end", closed);
      res.on("error", closed);
      res.on("close", closed);
    });
    req.on("error", (err) => { clearTimeout(timer); reject(err); });
    s.req = req;
  });
  s.close = () => { try { s.req && s.req.destroy(); } catch {} s.open = false; };
  return s;
}
// The first entity message on stream s since `from` (ms) that pred accepts, or null after timeoutMs.
function waitEntity(s, pred, from, timeoutMs) {
  return new Promise((resolve) => {
    let timer = null;
    const find = () => s.entity.find((r) => r.t >= from && pred(r.m)) || null;
    const check = () => {
      const hit = find();
      if (!hit) return;
      clearTimeout(timer);
      s.waiters.delete(check);
      resolve(hit);
    };
    timer = setTimeout(() => { s.waiters.delete(check); resolve(find()); }, timeoutMs);
    s.waiters.add(check);
    check();
  });
}
const entitiesSince = (s, player, from, to = Infinity) => s.entity.filter((r) => r.t >= from && r.t < to && r.m.player === player);

// ---- Server -------------------------------------------------------------------------------------------------------------

let server = null;
let browsers = [];
let cleaning = null;

function portBusy(port) {
  try { return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
}

async function startServer() {
  const busy = portBusy(PORT);
  if (busy) throw new Error(`port ${PORT} is already in use (pid ${busy}); pick another with --port`);
  fs.mkdirSync(OUT, { recursive: true });
  const env = { ...process.env, PORT: String(PORT), V13_MODE: MODE, V13_REAL_MAX: String(REAL || 0), V13_EXIT_WITH_PARENT: "1" };
  const out = fs.createWriteStream(SERVER_LOG);
  server = spawn(process.execPath, [path.join(HERE, "server.cjs")], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.pipe(out);
  server.stderr.pipe(out);
  server.on("exit", (code, sig) => { if (!cleaning) log(`server exited early (code ${code}, signal ${sig}); see ${path.relative(ROOT, SERVER_LOG)}`); server = null; });
  log(`started dev/v13-entity/server.cjs (${MODE}) on :${PORT} (pid ${server.pid})`);
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (!server) throw new Error(`server exited before answering (see ${path.relative(ROOT, SERVER_LOG)})`);
    const r = await get("/__test/info", { timeout: 1500 });
    if (r.status === 200 && r.json && r.json.kit === "v13-entity") return r.json;
    await sleep(200);
  }
  throw new Error("server did not answer /__test/info within 15 s");
}

async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    for (const s of streams) s.close();
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

// ---- One drawing over HTTP --------------------------------------------------------------------------------------------------

const players = {};   // drawing id → { name, device, color, stream }
const imageOk = (url, name, kind) => typeof url === "string" && new RegExp(`^/drawings/${name}-${kind}\\.png\\?v=[0-9a-f]{6,40}$`).test(url);
const plainText = (s) => typeof s === "string" && s.length > 0 && s.length <= 140 && /^[A-Z"“]/.test(s) && /[.!?…]$/.test(s) && !INTERNAL.test(s);
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x) => b.includes(x));
const plainCard = (type) => { try { return typeof Verbs.cardOf === "function" ? Verbs.cardOf(type, []) : null; } catch { return null; } };
const cardOf = (type, unlocked) => { try { return typeof Verbs.cardOf === "function" ? Verbs.cardOf(type, unlocked) : null; } catch { return null; } };

// The checks on an entity answer (finished /generate, ok) and on its entity messages.
async function checkEntity(d, rec, check, res, { before, sentAt, tv, expectTypes, label = "" }) {
  const P = players[d.id];
  const world = WORLD_OF_KIND[d.kind];
  const j = res.json || {};
  const e = j.entity || {};
  const L = (s) => (label ? `${label}: ${s}` : s);
  check(L("answer is an entity"), res.status === 200 && j.ok === true && !!j.entity, `HTTP ${res.status} ok=${j.ok} ${j.error || ""}`);
  if (!j.entity) return null;
  check(L("type"), expectTypes.includes(e.type), `${e.type} (expected ${expectTypes.join(" or ")})`);
  check(L("rig"), e.rig === (Verbs.RIG_OF[e.type] || "blob"), `${e.rig} (rigs.js template for ${e.type}: ${Verbs.RIG_OF[e.type]})`);
  const innate = (Verbs.INNATE[e.type] || []).filter((v) => !((e.type === "car" || e.type === "bike") && v === "jump"));
  check(L("moves by itself"), innate.every((v) => (e.verbs || []).includes(v)), `verbs [${(e.verbs || []).join(" ")}], innate [${innate.join(" ")}]`);
  const unlocked = Array.isArray(e.unlocked) ? e.unlocked : [];
  const skills = Verbs.SKILLS[world] || [];
  check(L("unlocked skills are live skills of this world"), unlocked.every((u) => u && skills.includes(u.verb) && (e.verbs || []).includes(u.verb) && typeof u.part === "string" && u.part.trim()),
    unlocked.map((u) => `${u && u.verb} (${u && u.part})`).join(", ") || "none");
  check(L("parts"), Array.isArray(e.parts) && e.parts.every((p) => p && typeof p.name === "string" && p.name.trim() && [p.x, p.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)),
    (e.parts || []).map((p) => p && p.name).join(", ") || "none");
  const card = e.card;
  const head = plainCard(e.type);
  check(L("unlock card in plain words"), typeof card === "string" && card.length > 0 && card.length <= 200 && /^Your [a-z]+ can: [a-z]/.test(card) && !INTERNAL.test(card) && (!head || card.startsWith(head)),
    `"${card}"`);
  const want = cardOf(e.type, unlocked);
  check(L("card = Verbs.cardOf(type, unlocked)"), want === null ? null : card === want, want === null ? "verbs.js has no cardOf" : `want "${want}"`, "soft");
  check(L("animations wired"), !!e.anims && typeof e.anims === "object" && Object.keys(e.anims).length > 0, `${Object.keys(e.anims || {}).length} slots`, "soft");
  check(L("one drawing spent"), before && j.drawingsLeft ? j.drawingsLeft[world] === before[world] - 1 : false, `${before && before[world]} → ${j.drawingsLeft && j.drawingsLeft[world]} (${world})`);
  check(L("image URL on the answer"), imageOk(e.image, P.name, d.kind), e.image);
  rec.answers.push({ label: label || "finished", ms: res.ms, type: e.type, rig: e.rig, source: e.source, verbs: e.verbs, unlocked, parts: (e.parts || []).map((p) => p.name), card, image: e.image, fallback: !!j.fallback, looksLike: j.looksLike || null, drawingsLeft: j.drawingsLeft });
  // The drawing is served byte for byte (every screen inflates it from this URL).
  if (typeof e.image === "string") {
    const img = await get(e.image, { timeout: 5000 });
    check(L("image served"), img.status === 200 && /image\/png/.test(String(img.headers && img.headers["content-type"])) && img.buf && img.buf.equals(d.png),
      `HTTP ${img.status} ${img.headers && img.headers["content-type"]} ${img.buf ? img.buf.length : 0} B (posted ${d.png.length} B)`);
  }
  // The entity message: on the player's own stream and on the TV's, with the image.
  const match = (m) => m.player === P.name && m.entity && m.entity.image === e.image;
  const [mine, onTv] = await Promise.all([waitEntity(P.stream, match, sentAt, 3000), waitEntity(tv, match, sentAt, 3000)]);
  for (const [where, hit] of [["phone stream", mine], ["TV stream", onTv]]) {
    const m = hit && hit.m.entity;
    check(L(`entity message on the ${where}`), !!m && m.type === e.type && m.card === card && sameSet(m.verbs, e.verbs),
      m ? `type ${m.type}, ${hit.t - sentAt} ms after the post` : `no entity message with ${e.image} within 3 s`);
  }
  return e;
}

async function postDrawing(d, tv) {
  const P = players[d.id];
  const world = WORLD_OF_KIND[d.kind];
  const rec = report.drawings.find((r) => r.id === d.id);
  const check = checker(rec.checks);
  const exp = d.expect;
  const image = d.dataUrl;
  const body = (extra) => ({ player: P.name, kind: d.kind, image, source: d.source || "draw", device: P.device, ...extra });

  const st = await get("/__test/state");
  const before = st.json && st.json.players && st.json.players[P.name] ? st.json.players[P.name].drawingsLeft : null;
  check("drawing budget readable", !!before, JSON.stringify(before));

  // 1. The speculative call the phone makes 1.2 s after the last stroke.
  const specAt = Date.now();
  const spec = await post("/generate", body({ speculative: true, requestId: `${d.id}-spec-${specAt}` }));
  rec.speculative = { status: spec.status, ok: spec.json && spec.json.ok, error: spec.json && spec.json.error, ms: spec.ms };
  check("speculative call answered", spec.status === 200 && spec.json && (spec.json.ok === true || typeof spec.json.error === "string"), `HTTP ${spec.status} ${spec.json && (spec.json.error || "ok")}`);
  check("speculative call spends nothing", before && spec.json && spec.json.drawingsLeft ? spec.json.drawingsLeft[world] === before[world] : false,
    `${before && before[world]} → ${spec.json && spec.json.drawingsLeft && spec.json.drawingsLeft[world]}`);
  await sleep(250);

  // 2. The finished drawing (DONE).
  const doneAt = Date.now();
  check("speculative call sends no entity message", entitiesSince(tv, P.name, specAt, doneAt).length === 0, `${entitiesSince(tv, P.name, specAt, doneAt).length} message(s)`);
  const res = await post("/generate", body({ speculative: false, requestId: `${d.id}-done-${doneAt}` }));
  const j = res.json || {};
  rec.http = { status: res.status, ok: j.ok, error: j.error || null, message: j.message === undefined ? null : j.message, looksLike: j.looksLike || null, fallback: !!j.fallback, ms: res.ms, drawingsLeft: j.drawingsLeft || null };

  const expectTypes = MODE === "mock" ? [d.kind === "ship" ? "ship" : "person"] : exp.types || (d.kind === "ship" ? ["ship"] : Verbs.PLANET_TYPES);
  if (exp.ok === true || MODE === "mock") {
    if (MODE === "mock" && exp.ok !== true) check("refused in plain words", null, "n/a in --mock: the offline answer is the dev kit for every drawing");
    const e = await checkEntity(d, rec, check, res, { before, sentAt: doneAt, tv, expectTypes });
    if (e) {
      const verbs = (e.unlocked || []).map((u) => u.verb);
      const must = exp.must || [];
      check("drawn skills unlocked (generous)", must.every((v) => verbs.includes(v)), `must [${must.join(" ")}], unlocked [${verbs.join(" ")}]`);
      const cardText = String(e.card || "").toLowerCase();
      check("card names every drawn skill", must.every((v) => cardText.includes(Verbs.labelOf(v).toLowerCase())), `"${e.card}"`);
      if (exp.none) check("a plain drawing unlocks nothing", MODE === "mock" ? null : verbs.length === 0, MODE === "mock" ? "n/a in --mock" : `unlocked [${verbs.join(" ")}]`, MODE === "real" ? "soft" : "hard");
      check("answered by the model, not a fallback", MODE === "mock" ? e.source === "devkit" : e.source === "model" && !j.fallback, `source ${e.source}${j.fallback ? ", fallback: true" : ""}`);
      if (exp.ok === true) rec.built = { type: MODE === "mock" ? (exp.types || ["ship"])[0] : e.type, image: e.image, card: e.card, color: P.color };
    }
    return rec;
  }

  if (exp.ok === false || exp.ok === "either") {
    const refused = res.status === 200 && j.ok === false;
    const either = exp.ok === "either";
    if (!refused && either) {
      // A generous real model read the scribble as a plain entity: fine, but it must be a proper one.
      check("refused or read as a plain entity", MODE === "real", `accepted as ${j.entity && j.entity.type} (only a real model may do this)`, MODE === "real" ? "soft" : "hard");
      if (j.ok) await checkEntity(d, rec, check, res, { before, sentAt: doneAt, tv, expectTypes, label: "accepted" });
      return rec;
    }
    check("refused", refused, `HTTP ${res.status} ok=${j.ok} error=${j.error}`);
    if (!either || MODE !== "real") check("refusal reason", j.error === exp.error && (!exp.looksLike || j.looksLike === exp.looksLike), `error "${j.error}" looksLike ${j.looksLike} (expected "${exp.error}"${exp.looksLike ? ` / ${exp.looksLike}` : ""})`);
    check("refusal in plain words", plainText(j.message) && (!exp.message || exp.message.test(j.message)), `"${j.message}"`);
    check("a refusal spends nothing", before && j.drawingsLeft ? j.drawingsLeft[world] === before[world] : false, `${before && before[world]} → ${j.drawingsLeft && j.drawingsLeft[world]}`);
    await sleep(800);
    check("a refusal sends no entity message", entitiesSince(tv, P.name, doneAt).length === 0, `${entitiesSince(tv, P.name, doneAt).length} message(s)`);
    if (exp.anyway) {
      // "Use it anyway": the same drawing again with anyway: true, answered from the cache.
      const st2 = await get("/__test/state");
      const before2 = st2.json && st2.json.players && st2.json.players[P.name] ? st2.json.players[P.name].drawingsLeft : null;
      const anyAt = Date.now();
      const any = await post("/generate", body({ speculative: false, anyway: true, requestId: `${d.id}-anyway-${anyAt}` }));
      rec.anyway = { status: any.status, ok: any.json && any.json.ok, error: any.json && any.json.error, ms: any.ms };
      const anyTypes = d.kind === "ship" ? ["ship"] : Verbs.PLANET_TYPES;
      await checkEntity(d, rec, check, any, { before: before2, sentAt: anyAt, tv, expectTypes: anyTypes, label: "use it anyway" });
    }
  }
  return rec;
}

// ---- Browsers: every drawn entity built on the TV (Chromium) and the phone (WebKit) -------------------------------------------

// Runs in the page. Builds the drawing the way render.js does (inflate.js on the served URL), measures it, then shows it in
// render.js createEntityPreview (the phone's result card) on an overlay for the screenshot.
async function pageBuild(arg) {
  const { url, kind, color, quality, previewQuality, title, caption, settleMs } = arg;
  const K = window.__v13kit || (window.__v13kit = {});
  if (!K.ready) {
    // The game's own modules through a module script (the page's import map resolves "three" in every engine; a
    // dynamic import() from evaluated code may not). Same URLs as the page's imports: the same module instances.
    if (!window.__v13mods) {
      if (window.__v13modsError) return { ok: false, error: window.__v13modsError }; // failed once: fail fast after
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("render.js / inflate.js / three did not load within 25 s")), 25000);
          window.addEventListener("v13mods", () => { clearTimeout(timer); resolve(); }, { once: true });
          const s = document.createElement("script");
          s.type = "module";
          s.textContent = 'import * as R from "/render.js"; import * as inf from "/inflate.js"; import * as THREE from "three";' +
            ' window.__v13mods = { R, inf, THREE }; window.dispatchEvent(new Event("v13mods"));';
          document.head.appendChild(s);
        });
      } catch (e) {
        window.__v13modsError = String((e && e.message) || e);
        return { ok: false, error: window.__v13modsError };
      }
    }
    const { R, inf, THREE } = window.__v13mods;
    Object.assign(K, { R, inf, THREE });
    const wrap = document.createElement("div");
    wrap.id = "v13kit";
    wrap.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;" +
      "background:radial-gradient(circle at 50% 42%,#3b2a7a 0%,#120c2e 62%,#07051a 100%);color:#fff;pointer-events:none;" +
      "font:800 italic clamp(16px,4.2vh,36px)/1.1 'Bebas Neue','Barlow Condensed','Arial Narrow',system-ui,sans-serif;text-shadow:0 2px 0 #000,0 0 8px #000");
    const head = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("style", "width:min(94vw,150vh);height:70vh;display:block");
    const cap = document.createElement("div");
    cap.setAttribute("style", "max-width:94vw;text-align:center;font:600 clamp(11px,2.7vh,22px)/1.25 Barlow,system-ui,sans-serif");
    wrap.append(head, canvas, cap);
    document.body.appendChild(wrap);
    Object.assign(K, { head, cap, canvas, preview: R.createEntityPreview({ canvas, quality: previewQuality }) });
    try {
      const mc = document.createElement("canvas");
      mc.width = 256; mc.height = 256;
      K.mr = new THREE.WebGLRenderer({ canvas: mc, antialias: false });
      K.mr.info.autoReset = false;
    } catch (e) { K.mr = null; }
    K.ready = true;
  }
  const { inf, THREE } = K;
  const out = { ok: true };
  let img = null;
  try {
    const l0 = performance.now();
    img = await inf.loadDrawing(url, { fresh: true });
    out.loadMs = performance.now() - l0;
  } catch (e) { return { ok: false, error: `the drawing did not load: ${e && e.message}` }; }
  try {
    const b0 = performance.now();
    const built = inf.inflateDrawing(img, { kind, quality, color });
    out.buildMs = performance.now() - b0;
    out.inflateMs = built.ms;
    out.triangles = built.triangles;
    out.wheels = Array.isArray(built.wheels) ? built.wheels.length : 0;
    out.sockets = built.sockets ? Object.keys(built.sockets).length : 0;
    built.object3d.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(built.object3d);
    const s = box.getSize(new THREE.Vector3());
    out.size = { x: s.x, y: s.y, z: s.z };
    out.reportedSize = built.size || null;
    let meshes = 0;
    built.object3d.traverse((o) => { if (o.isMesh) meshes++; });
    out.meshes = meshes;
    if (K.mr) {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.2));
      scene.add(built.object3d);
      const sph = box.getBoundingSphere(new THREE.Sphere());
      const cam = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
      cam.position.set(sph.center.x + sph.radius * 1.6, sph.center.y + sph.radius * 1.2, sph.center.z + sph.radius * 2.2);
      cam.lookAt(sph.center);
      K.mr.info.reset();
      K.mr.render(scene, cam);
      out.drawCalls = K.mr.info.render.calls;
      out.renderedTriangles = K.mr.info.render.triangles;
      scene.remove(built.object3d);
    }
    built.dispose();
  } catch (e) {
    out.ok = false;
    out.error = `inflate failed: ${e && e.message}`;
  } finally {
    try { if (img && typeof img.close === "function") img.close(); } catch (e) { /* ignore */ }
  }
  K.head.textContent = title;
  K.cap.textContent = caption;
  try { out.preview = await K.preview.show({ image: url, kind, color }); } catch (e) { out.preview = { ok: false, error: String(e && e.message) }; }
  await new Promise((r) => setTimeout(r, settleMs));
  return out;
}

const consoleErrors = report.consoleErrors;
function watchPage(page, screen) {
  page.on("pageerror", (e) => consoleErrors.push({ screen, t: +since(), kind: "pageerror", text: String(e && e.message).slice(0, 400) }));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push({ screen, t: +since(), kind: "console", text: m.text().slice(0, 400) }); });
}

async function browserPhase(built) {
  let pw;
  try { pw = require(PW_CORE); } catch (err) { throw new Error(`playwright-core not found at ${PW_CORE} (set PW_CORE): ${err.message}`); }
  for (const [name, exe] of [["chromium", CHROME], ["webkit", WEBKIT]]) if (!fs.existsSync(exe)) throw new Error(`${name} not found at ${exe} (set E2E_CHROME / E2E_WEBKIT)`);
  fs.mkdirSync(SHOTS, { recursive: true });
  const chrome = await pw.chromium.launch({ executablePath: CHROME, headless: !HEADED, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--autoplay-policy=no-user-gesture-required"] });
  browsers.push(chrome);
  const tvCtx = await chrome.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, bypassCSP: true });
  const tv = await tvCtx.newPage();
  watchPage(tv, "tv");
  const wk = await pw.webkit.launch({ executablePath: WEBKIT, headless: !HEADED });
  browsers.push(wk);
  const phoneCtx = await wk.newContext({ viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, bypassCSP: true });
  const phone = await phoneCtx.newPage();
  watchPage(phone, "phone");
  const b = { tv: { url: `${BASE}/space.html`, viewport: "1440x900", browser: "chromium" }, phone: { url: `${BASE}/controller.html`, viewport: "844x390@3", browser: "webkit" }, shots: [] };
  report.browser = b;
  await Promise.all([tv.goto(b.tv.url, { waitUntil: "domcontentloaded", timeout: 30000 }), phone.goto(b.phone.url, { waitUntil: "domcontentloaded", timeout: 30000 })]);

  // A TV that connects after every drawing: render.js has each entity, with its drawing (game.entityOf).
  const names = built.map((x) => x.name);
  const hasGame = await tv.waitForFunction(() => !!(window.__game && typeof window.__game.entityOf === "function"), null, { timeout: 20000 }).then(() => true).catch(() => false);
  gcheck("TV page exposes window.__game.entityOf", hasGame, hasGame ? "" : "space.html has no window.__game (renamed?)");
  if (hasGame) {
    await tv.waitForFunction((ns) => ns.every((n) => { const x = window.__game.entityOf(n); return !!(x && (x.entity || x).image); }), names, { timeout: 10000 }).catch(() => {});
    const got = await tv.evaluate((ns) => Object.fromEntries(ns.map((n) => { const x = window.__game.entityOf(n); const e = x && (x.entity || x); return [n, e ? { type: e.type || null, image: e.image || null, card: e.card || null } : null]; })), names);
    for (const x of built) {
      const g = got[x.name];
      const ok = !!g && g.image === x.image && g.type === x.serverType;
      report.late.browser.push({ id: x.id, player: x.name, ok, got: g });
      gcheck(`late TV (space.html) has ${x.id}`, ok, g ? `type ${g.type}, image ${g.image}` : "no entity");
    }
  }
  await sleep(1500);
  for (const [page, file] of [[tv, "tv-game.png"], [phone, "phone-join.png"]]) {
    await page.screenshot({ path: path.join(SHOTS, file), timeout: 10000, scale: "css" }).then(() => b.shots.push(`dev/v13-entity/shots/${file}`)).catch((e) => log(`screenshot ${file} failed: ${e.message.split("\n")[0]}`));
  }

  for (const x of built) {
    const rec = report.drawings.find((r) => r.id === x.id);
    const check = checker(rec.checks);
    rec.numbers = {};
    const caption = `${x.id} · ${x.type} · ${x.card || ""}`;
    const runs = [
      ["tv", tv, { quality: "big", previewQuality: "big" }],
      ["phone", phone, { quality: "lite", previewQuality: "phone" }],
    ];
    await Promise.all(runs.map(async ([screen, page, q]) => {
      const arg = { url: x.image, kind: x.type, color: x.color, ...q, title: x.type.toUpperCase(), caption, settleMs: 900 };
      let r;
      try { r = await page.evaluate(pageBuild, arg); } catch (err) { r = { ok: false, error: `evaluate failed: ${String(err.message).split("\n")[0]}` }; }
      const n = r || {};
      const m = n.size ? measuredM(x.type, n.size) : null;
      rec.numbers[screen] = {
        quality: q.quality, triangles: n.triangles ?? null, drawCalls: n.drawCalls ?? null, meshes: n.meshes ?? null, buildMs: round(n.buildMs), inflateMs: round(n.inflateMs), loadMs: round(n.loadMs),
        sizeM: n.size ? { x: round(n.size.x, 2), y: round(n.size.y, 2), z: round(n.size.z, 2) } : null, scaleM: round(m, 2), expectedM: EXPECTED_M[x.type], axis: measuredAxis(x.type),
        wheels: n.wheels ?? null, preview: n.preview || null, error: n.error || null,
      };
      check(`${screen}: built by inflate.js`, n.ok === true && Number.isFinite(n.triangles), n.error || "");
      check(`${screen}: preview card shows it as a ${x.type}`, !!n.preview && n.preview.ok === true && n.preview.kind === x.type, n.preview ? `ok ${n.preview.ok} kind ${n.preview.kind} ${n.preview.error || ""}` : "no preview");
      const budget = TRI_BUDGET[q.quality] + TRI_SLACK;
      check(`${screen}: triangles within the ${q.quality} budget`, Number.isFinite(n.triangles) && n.triangles <= budget, `${n.triangles} ≤ ${budget}`);
      check(`${screen}: draw calls`, Number.isFinite(n.drawCalls) ? n.drawCalls <= DRAW_CALLS.hard : null, `${n.drawCalls} (hard ≤ ${DRAW_CALLS.hard})`);
      check(`${screen}: draw calls (target)`, Number.isFinite(n.drawCalls) ? n.drawCalls <= DRAW_CALLS.soft : null, `${n.drawCalls} (target ≤ ${DRAW_CALLS.soft})`, "soft");
      const tol = SIZE_TOL[x.type] || 0.25, want = EXPECTED_M[x.type];
      check(`${screen}: scale`, Number.isFinite(m) && want ? Math.abs(m - want) <= want * tol : false, `${round(m, 2)} m ${measuredAxis(x.type)} vs ${want} m ± ${Math.round(tol * 100)}%`);
      check(`${screen}: build time`, Number.isFinite(n.buildMs) ? n.buildMs <= BUILD_MS_TARGET[screen] : null, `${round(n.buildMs)} ms (target ≤ ${BUILD_MS_TARGET[screen]} ms)`, "soft");
      const file = `${x.id}-${screen}.png`;
      await page.screenshot({ path: path.join(SHOTS, file), timeout: 10000, scale: "css" }).then(() => { rec.shots.push(`dev/v13-entity/shots/${file}`); b.shots.push(`dev/v13-entity/shots/${file}`); })
        .catch((e) => check(`${screen}: screenshot`, false, e.message.split("\n")[0], "soft"));
    }));
    const tvN = rec.numbers.tv || {}, phN = rec.numbers.phone || {};
    log(`  ${x.id.padEnd(22)} ${x.type.padEnd(9)} TV ${String(tvN.triangles).padStart(5)} tris ${String(tvN.drawCalls).padStart(2)} calls ${String(tvN.buildMs).padStart(6)} ms ${String(tvN.scaleM).padStart(5)} m | phone ${String(phN.triangles).padStart(5)} tris ${String(phN.drawCalls).padStart(2)} calls ${String(phN.buildMs).padStart(6)} ms ${String(phN.scaleM).padStart(5)} m`);
  }
  const pageErrors = consoleErrors.filter((c) => c.kind === "pageerror");
  gcheck("no page errors (TV, phone)", pageErrors.length === 0, pageErrors.map((c) => `${c.screen}: ${c.text}`).join(" | "));
  gcheck("no console errors (TV, phone)", consoleErrors.filter((c) => c.kind === "console").length === 0, consoleErrors.filter((c) => c.kind === "console").slice(0, 4).map((c) => `${c.screen}: ${c.text}`).join(" | "), "soft");
}

// ---- Main -----------------------------------------------------------------------------------------------------------------

function summarise() {
  const all = [...globalChecks, ...report.drawings.flatMap((r) => r.checks)];
  const hardFailed = all.filter((c) => c.level === "hard" && c.ok === false);
  const softFailed = all.filter((c) => c.level === "soft" && c.ok === false);
  for (const r of report.drawings) {
    const hf = r.checks.filter((c) => c.level === "hard" && c.ok === false);
    r.pass = hf.length === 0;
    r.failed = hf.map((c) => `${c.name}: ${c.detail}`);
  }
  report.summary = {
    pass: hardFailed.length === 0 && !report.setupError, checks: all.length, passed: all.filter((c) => c.ok === true).length,
    hardFailed: hardFailed.length, softFailed: softFailed.length, notApplicable: all.filter((c) => c.ok === null).length,
    seconds: round((Date.now() - t0) / 1000, 1), drawings: report.drawings.length, drawingsPassed: report.drawings.filter((r) => r.pass).length,
  };
  return { hardFailed, softFailed };
}

function writeReport() {
  report.finishedAt = new Date().toISOString();
  const { hardFailed, softFailed } = summarise();
  fs.writeFileSync(REPORT, JSON.stringify(report, (k, v) => (v instanceof RegExp ? String(v) : v), 2));
  return { hardFailed, softFailed };
}

async function main() {
  // The drawings, as the phone sends them.
  for (const d of SET) {
    d.png = loadDrawing(d);
    d.dataUrl = dataUrlOf(d.png);
    d.sha = imageSha(d.dataUrl);
    const meta = corpusMeta(d);
    report.drawings.push({
      id: d.id, kind: d.kind, world: d.world, player: d.player, desc: d.desc, source: d.source || "draw",
      file: d.gen ? `generated: ${d.gen}` : path.relative(ROOT, corpusFile(d)), png: { ...pngSize(d.png), bytes: d.png.length }, sha: d.sha,
      corpus: meta ? { must: meta.entity && meta.entity.must, ok: meta.entity && meta.entity.ok, wrong: meta.wrong || null } : null,
      expect: d.expect, model: null, speculative: null, http: null, anyway: null, answers: [], checks: [], numbers: null, shots: [],
    });
  }
  fs.mkdirSync(path.join(OUT, "drawings"), { recursive: true });
  for (const d of SET) fs.writeFileSync(path.join(OUT, "drawings", `${d.id}.png`), d.png);

  const info = await startServer();
  report.server = { pid: info.pid, mode: info.mode, recorded: info.calls && info.calls.recorded, round: info.round };
  gcheck("server runs in the requested mode", info.mode === MODE, `${info.mode}`);
  const scripts = Object.fromEntries(SET.filter((d) => d.script).map((d) => [d.sha, d.script]));
  if (Object.keys(scripts).length) await post("/__test/script", { answers: scripts });

  // The TV's stream, then every player joins like a phone (POST /join with a device token) and opens its own stream.
  const tvStream = openStream("screen=big", "tv");
  await tvStream.ready;
  report.timeline.serverUp = +since();
  for (const d of SET) {
    const dev = device();
    const r = await post("/join", { player: d.player, device: dev });
    gcheck(`join ${d.player}`, r.status === 200 && r.json && r.json.player, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
    players[d.id] = { name: (r.json && r.json.player) || d.player, device: dev, color: r.json && Number.isFinite(r.json.color) ? r.json.color : 0x22d3ee };
    players[d.id].stream = openStream(`player=${encodeURIComponent(players[d.id].name)}`, players[d.id].name);
  }
  await Promise.all(SET.map((d) => players[d.id].stream.ready));
  report.timeline.joined = +since();

  // Ships: posted in the lobby, like a phone before START.
  for (const d of SET.filter((x) => x.world === "space")) {
    log(`ship ${d.id} (${d.player})`);
    await postDrawing(d, tvStream);
  }
  report.timeline.ships = +since();

  // Explorers: the players land on the planet first (START, the boss's last hit, LAND: the server's test hook). A
  // lander ship (drawn landing legs) lands in the same call with its own LAND skill.
  const planetSet = SET.filter((x) => x.world === "planet");
  const landers = SET.filter((x) => x.lands && report.drawings.find((r) => r.id === x.id).built);
  if (planetSet.length || landers.length) {
    const names = [...planetSet, ...landers].map((d) => players[d.id].name);
    log(`landing ${names.length} player(s) on the planet`);
    const hookAt = Date.now();
    const pl = await post("/__test/planet", { players: names, timeoutMs: 9000 }, { timeout: 20000 });
    report.planet = pl.json || { status: pl.status, error: pl.error };
    gcheck("players landed on the planet (test hook)", pl.status === 200 && pl.json && pl.json.ok, JSON.stringify(pl.json || pl.error).slice(0, 300));
    for (const d of landers) {
      const rec = report.drawings.find((r) => r.id === d.id);
      const check = checker(rec.checks);
      const name = players[d.id].name;
      const granted = (pl.json && pl.json.granted) || [];
      const me = pl.json && pl.json.players && pl.json.players[name];
      check("drawn landing legs land the ship (LAND, no help)", !!me && me.ok === true && !granted.includes(name), `${JSON.stringify(me)}; granted a kit ship: [${granted.join(" ")}]`);
      const url = rec.built.image;
      await sleep(300);
      const hit = tvStream.world.find((r) => r.t >= hookAt && r.m.island && Array.isArray(r.m.island.parked) && r.m.island.parked.some((c) => c && c.player === name && c.image === url));
      check("parked ship shows its drawing (TV stream)", !!hit, hit ? `world message ${hit.t - hookAt} ms after the landing started` : `no island.parked[] entry for ${name} with ${url}`);
    }
    for (const d of planetSet) {
      log(`explorer ${d.id} (${d.player})`);
      await postDrawing(d, tvStream);
    }
  }
  report.timeline.explorers = +since();

  // Every drawn entity for the late-joiner and browser checks (the "Use it anyway" ones are covered over HTTP).
  const built = [];
  for (const d of SET) {
    const rec = report.drawings.find((r) => r.id === d.id);
    if (rec.built && imageOk(rec.built.image, players[d.id].name, d.kind)) {
      const serverType = rec.answers.length ? rec.answers[rec.answers.length - 1].type : rec.built.type;
      built.push({ id: d.id, name: players[d.id].name, kind: d.kind, type: rec.built.type, serverType, image: rec.built.image, card: rec.built.card, color: rec.built.color, lands: !!d.lands });
    }
  }

  // A TV that connects now gets every entity with its drawing in the world message (late joiner). A landed ship's
  // player drives their (plain) explorer now: their ship drawing reaches the late TV on the parked ship instead.
  const late = openStream("screen=big", "late-tv");
  try {
    await late.ready;
    const w = (late.firstWorld && late.firstWorld.m) || {};
    const ents = w.entities || {};
    for (const x of built) {
      const e = ents[x.name];
      if (x.lands) {
        const car = w.island && Array.isArray(w.island.parked) ? w.island.parked.find((c) => c && c.player === x.name) : null;
        const ok = !!car && car.image === x.image && !!e && Verbs.PLANET_TYPES.includes(e.type);
        report.late.stream.push({ id: x.id, player: x.name, ok, type: e && e.type, parkedImage: car && car.image });
        gcheck(`late TV stream has ${x.id} (parked on the pad)`, ok, `parked ${car ? car.image : "none"}, drives ${e && e.type}`);
        continue;
      }
      const ok = !!e && e.image === x.image && e.type === x.serverType;
      report.late.stream.push({ id: x.id, player: x.name, ok, type: e && e.type, image: e && e.image });
      gcheck(`late TV stream has ${x.id}`, ok, e ? `type ${e.type}, image ${e.image}` : "not in world.entities");
    }
  } catch (err) {
    gcheck("late TV stream", false, err.message);
  }
  late.close();
  report.timeline.late = +since();

  // Where each drawing's answer came from (replayed, scripted, real, missing).
  const calls = await get("/__test/calls");
  if (calls.json && calls.json.ok) {
    const { log: callLog, ...counts } = calls.json;
    report.calls = { ...counts, log: callLog };
    for (const d of SET) {
      const rec = report.drawings.find((r) => r.id === d.id);
      const mine = (callLog || []).filter((c) => c.sha === d.sha);
      rec.model = MODE === "mock" ? "mock (dev kit)" : mine.length ? [...new Set(mine.map((c) => c.source))].join("+") : "cache";
      // A failed real request that Astra retried successfully is fine; no successful answer at all is not.
      if (MODE !== "mock") checker(rec.checks)("model answer available", mine.length === 0 || mine.some((c) => c.status === 200), mine.map((c) => `${c.source} ${c.status} ${c.ms} ms`).join(", ") || "no call (cached)");
    }
    if (MODE === "real") {
      gcheck(`at most ${REAL} real requests`, counts.real <= REAL, `${counts.real} real`);
      gcheck("the real model was called", counts.real > 0, `${counts.real} real request(s) (none: no key?)`);
    }
    if (MODE === "mock") gcheck("no model calls in --mock", counts.real === 0 && counts.replayed === 0 && counts.scripted === 0, JSON.stringify(counts));
  } else gcheck("model call log", false, `HTTP ${calls.status}`, "soft");

  const toBuild = built.filter((x) => !x.lands); // the lander repeats ship-landing-legs' drawing
  if (BROWSER && toBuild.length) {
    log(`browsers: building ${toBuild.length} drawn entities on the TV (Chromium) and the phone (WebKit)`);
    try { await browserPhase(toBuild); } catch (err) { gcheck("browsers", false, err.message); report.setupError = report.setupError || `browsers: ${err.message}`; }
  } else if (!BROWSER) gcheck("browsers", null, "--no-browser");
  report.timeline.browsers = +since();

  const st = await get("/__test/state");
  report.finalState = st.json && st.json.ok ? { phase: st.json.phase, round: st.json.round, boss: st.json.boss, planet: !!st.json.planet } : null;
}

const WATCHDOG_MS = 6 * 60 * 1000;
const watchdog = setTimeout(async () => {
  report.setupError = `watchdog: the run took longer than ${WATCHDOG_MS / 60000} min`;
  log(report.setupError);
  writeReport();
  await cleanup();
  process.exit(1);
}, WATCHDOG_MS);

let code = 0;
try {
  await main();
} catch (err) {
  report.setupError = err.message;
  log(`setup failed: ${err.message}`);
  code = 3;
}
clearTimeout(watchdog);
await cleanup();
const { hardFailed, softFailed } = writeReport();
const S = report.summary;
console.log("");
for (const r of report.drawings) {
  const a = r.answers[0] || {};
  const tv = (r.numbers && r.numbers.tv) || {}, ph = (r.numbers && r.numbers.phone) || {};
  const what = r.http && r.http.ok === false ? `refused: "${r.http.message}"` : `${a.type || "-"} [${(a.unlocked || []).map((u) => u.verb).join(" ")}]`;
  console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id.padEnd(26)} ${String(r.model || "").padEnd(9)} ${what}${tv.triangles ? ` · TV ${tv.triangles} tris ${tv.scaleM} m · phone ${ph.triangles} tris ${ph.buildMs} ms` : ""}`);
  for (const f of r.failed) console.log(`     ✗ ${f}`);
}
for (const c of globalChecks.filter((c) => c.ok === false)) console.log(`${c.level === "hard" ? "FAIL" : "warn"} ${c.name}: ${c.detail}`);
if (softFailed.length) console.log(`(${softFailed.length} soft check(s) below target; see report.json)`);
console.log(`\n${S.pass ? "PASS" : "FAIL"}: ${S.passed}/${S.checks} checks passed, ${S.hardFailed} hard failed, ${S.softFailed} soft, ${S.notApplicable} n/a · ${S.drawingsPassed}/${S.drawings} drawings · ${MODE} · ${S.seconds} s`);
console.log(`report: ${path.relative(ROOT, REPORT)}${report.browser ? ` · shots: ${path.relative(ROOT, SHOTS)}/` : ""}`);
if (!code && report.setupError) code = 3;
if (!code && hardFailed.length) code = 1;
process.exit(code);
