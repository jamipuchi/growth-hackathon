// Test wrapper around the REAL server.js (never edited): the v1.1 client track's server for every browser tool.
//   PORT=8170 node dev/v11-client/server.cjs [--bots N] [--fast] [--assists S] [--cap S] [--scoreboard S] [--serve a.js,b.js]
// Before server.js is required (so it picks everything up unchanged) this wrapper:
//   env      HTTPS_PORT=0 (no HTTPS), ASTRA_MOCK=1, OPENAI_API_KEY removed (nothing real can be called), PORT defaults to
//            8170 (never 8000), PERF_LOG defaults to dev/v11-client/perf.log (truncated now).
//   http     wraps http.createServer: GET /inflate.js is served from the repo root (server.js does not serve it yet: a known
//            gap; once PUBLIC_FILES has it this changes nothing), `--serve` adds more root files, every other request goes to
//            the real handler. Requests that answer 404 are logged and listed at GET /__test/info (a gap the wrapper does
//            NOT hide: only inflate.js and --serve files are served on its own).
//   astra    wraps astra.generate (ASTRA_MOCK=1 gives the dev kit). Force answers by player name:
//              explorer drawing from carXXX → type car, bikeXXX → bike, dogXXX → quadruped, blobXXX → blob (the dev kit's
//                unlocked list, rig from verbs.js RIG_OF, verbs from Verbs.entityVerbs, anims re-wired)
//              plainXXX → a drawing with no parts: nothing unlocked (a ship that only flies) for ship and explorer
//              name contains "wrong" → like the real Astra: the answer is refused with looksLike ("controller" for ship and
//                explorer requests, "entity" + thing "ship" for controller and button requests), no drawing is spent;
//                posted again with anyway:true it answers normally and still carries looksLike
//              name contains "wrongsoft" → never refused: the normal ok answer carries looksLike (the SPEC's literal form)
//              name contains "slow" → the answer comes 2.5 s late; "fail" → { ok:false, error:"generation unavailable" }
//            Astra's own drawing copies (controllers/<player>-<kind>.png) go to dev/v11-client/controllers-out/ instead of
//            the repo's controllers/ folder (astra._internals.setDir).
//   round    --fast mutates the shared Contract.ROUND (same require cache): assists at 25 s, cap at 60 s. world.js reads
//            ROUND at run time (ROUND.assistsAt / maxSeconds / scoreboardSeconds every step), so this works. --assists,
//            --cap and --scoreboard set single values (seconds of play).
//   parent   with V11_EXIT_WITH_PARENT=1 (set by the harness tools) the server exits when its parent process dies.
//   hooks    GET /__test/info and /__test/state (live boss, planet, chests, players), POST /__test/round {assistsAt,
//            maxSeconds, scoreboardSeconds | reset:true}, POST /__test/teleport {player, near:{x,y,z}, distance, face:{x,y,z},
//            x,y,z, yaw, pitch}, POST /__test/boss {hp}. Test tools use them only to skip travel time; they touch the live
//            world object (captured from createWorld) and nothing in server.js itself.
"use strict";
const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");

const ROOT = '/private/tmp/claude-501/v14-test';
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const log = (...a) => console.log("[v11-server]", ...a);

if (flag("help") || flag("h")) {
  console.log(fs.readFileSync(__filename, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(0);
}

// ---- Environment ---------------------------------------------------------------------------------------------------

process.env.HTTPS_PORT = "0";
process.env.ASTRA_MOCK = "1";
delete process.env.OPENAI_API_KEY;
process.env.PORT = process.env.PORT || "8170";
const PORT = Number(process.env.PORT);
process.env.PERF_LOG = process.env.PERF_LOG || path.join(__dirname, "perf.log");
try { fs.writeFileSync(process.env.PERF_LOG, ""); } catch (err) { log(`cannot truncate PERF_LOG: ${err.message}`); }
const DRAWINGS_DIR = process.env.V11_DRAWINGS_DIR || path.join(__dirname, "controllers-out");

const Contract = require(path.join(ROOT, "contract.js"));
const Verbs = require(path.join(ROOT, "verbs.js"));
const Terrain = require(path.join(ROOT, "terrain.js"));

// ---- Round timing (--fast and the /__test/round hook) ----------------------------------------------------------------

const ROUND_KEYS = ["assistsAt", "maxSeconds", "scoreboardSeconds"];
const ROUND_DEFAULTS = { ...Contract.ROUND };
function setRound(values) {
  for (const k of ROUND_KEYS) if (Number.isFinite(Number(values[k])) && values[k] !== null && values[k] !== "") Contract.ROUND[k] = Number(values[k]);
  return { ...Contract.ROUND };
}
const roundFlags = {};
if (flag("fast")) Object.assign(roundFlags, { assistsAt: 25, maxSeconds: 60 });
for (const [f, k] of [["assists", "assistsAt"], ["cap", "maxSeconds"], ["scoreboard", "scoreboardSeconds"]]) if (opt(f) != null) roundFlags[k] = Number(opt(f));
if (Object.keys(roundFlags).length) {
  setRound(roundFlags);
  if (ROUND_KEYS.some((k) => k in roundFlags && Contract.ROUND[k] !== roundFlags[k])) log("Contract.ROUND is frozen: the timing flags were ignored");
  else log(`round timing: assists at ${Contract.ROUND.assistsAt} s, cap ${Contract.ROUND.maxSeconds} s, scoreboard ${Contract.ROUND.scoreboardSeconds} s`);
}

// ---- Astra: force answers by player name ------------------------------------------------------------------------------

const astra = require(path.join(ROOT, "astra.js"));
if (astra._internals && typeof astra._internals.setDir === "function") astra._internals.setDir(DRAWINGS_DIR);
const realGenerate = astra.generate;
const PLANET_PREFIX = [["car", "car"], ["bike", "bike"], ["dog", "quadruped"], ["blob", "blob"]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function entityAs(entity, type, plain) {
  const unlocked = plain ? [] : (entity.unlocked || []);
  const verbs = Verbs.entityVerbs(type, unlocked.map((u) => u.verb));
  const rig = Verbs.RIG_OF[type] || "blob";
  const out = {
    ...entity, type, rig, verbs, unlocked: unlocked.filter((u) => verbs.includes(u.verb)),
    parts: plain ? [] : entity.parts, source: plain ? "model" : entity.source,
  };
  out.anims = astra.wireAnimations(rig, verbs);
  return out;
}

function force(body, answer) {
  const player = Contract.cleanName(body && body.player);
  const kind = body && body.kind;
  if (!player || !kind) return answer;
  const notes = [];
  let out = answer;
  if (player.includes("fail")) return { ok: false, error: "generation unavailable" };
  const isEntityKind = kind === "ship" || kind === "explorer";
  if (out && out.ok && isEntityKind && out.entity) {
    const plain = player.startsWith("plain");
    const forced = kind === "explorer" ? PLANET_PREFIX.find(([prefix]) => player.startsWith(prefix)) : null;
    if (plain || forced) {
      const type = forced ? forced[1] : out.entity.type;
      out = { ...out, entity: entityAs(out.entity, type, plain) };
      notes.push(`${type}${plain ? " (plain, nothing unlocked)" : ""}`);
    }
  }
  if (player.includes("wrong")) {
    const looksLike = isEntityKind ? "controller" : "entity";
    if (!body.anyway && !player.includes("wrongsoft")) {
      out = isEntityKind
        ? { ok: false, error: "looks like a controller", looksLike }
        : { ok: false, error: "looks like a ship", looksLike, thing: "ship" };
      notes.push(`refused, looksLike ${looksLike}`);
    } else {
      out = { ...out, looksLike };
      notes.push(`ok, carries looksLike ${looksLike}`);
    }
  }
  if (notes.length) log(`generate ${player} ${kind}${body.speculative ? " (speculative)" : ""}${body.anyway ? " (anyway)" : ""} → ${notes.join("; ")}`);
  return out;
}

astra.generate = async function generate(body) {
  const player = Contract.cleanName(body && body.player);
  const answer = await realGenerate.call(this, body);
  try {
    if (player.includes("slow")) await sleep(2500);
    return force(body, answer);
  } catch (err) {
    log(`generate override failed (the real answer is used): ${err.message}`);
    return answer;
  }
};

// ---- The live world (test hooks only) ---------------------------------------------------------------------------------

const WorldModule = require(path.join(ROOT, "world.js"));
let world = null, qaBroadcast = null;
const realCreateWorld = WorldModule.createWorld;
WorldModule.createWorld = function createWorld(...args) { qaBroadcast=args[0].broadcast; world = realCreateWorld.apply(this, args); return world; };

const r2 = (n) => Math.round(n * 100) / 100;
function snapshot() {
  if (!world) return { ok: false, error: "world not captured" };
  const d = world.debug();
  const players = {};
  for (const [name, p] of Object.entries(world.players)) {
    players[name] = {
      mode: p.mode, x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z), yaw: r2(p.yaw), pitch: r2(p.pitch), hp: Math.round(p.hp), score: p.score,
      bot: !!p.bot, dead: !!p.dead, landingFor: p.landingFor, type: p.entity && p.entity.type, source: p.entity && p.entity.source, verbs: p.entity && p.entity.verbs,
    };
  }
  const boss = d.boss && { x: r2(d.boss.pos.x), y: r2(d.boss.pos.y), z: r2(d.boss.pos.z), radius: d.boss.radius, hp: Math.round(d.boss.hp), maxHp: d.boss.maxHp, dead: d.boss.dead };
  return {
    ok: true, phase: d.phase, round: d.round, playT: r2(d.playT), assists: d.assists, playerCount: d.playerCount, boss,
    planet: d.planet, landing: d.landing, island: d.island && { seed: d.island.seed, size: d.island.size },
    chests: (d.chests || []).map((c) => ({ id: c.id, kind: c.kind, x: r2(c.x), z: r2(c.z), buried: c.buried, dug: r2(c.dug), open: c.open, by: c.by })),
    parked: d.parked, rocks: (d.rocks || []).length, players,
  };
}

function teleport(b) {
  if (!world) return { ok: false, error: "world not captured" };
  const p = world.players[Contract.cleanName(b.player)];
  if (!p) return { ok: false, error: `no such player: ${b.player}` };
  const num = Number.isFinite;
  let { x, y, z } = b;
  if (b.near && [b.near.x, b.near.y, b.near.z].every(num)) {
    // `distance` m from the target, on the line from the target to where the player is now (or to `from`).
    const from = b.from || p.pos;
    let dx = from.x - b.near.x, dy = (from.y || 0) - b.near.y, dz = from.z - b.near.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const D = num(b.distance) ? b.distance : 40;
    x = b.near.x + dx * D; y = b.near.y + dy * D; z = b.near.z + dz * D;
  }
  if (num(x) && num(z)) {
    if (p.mode === "planet") {
      const seed = world.debug().island.seed;
      p.pos = { x, y: num(y) ? y : Math.max(0, Terrain.height(x, z, seed)), z };
    } else p.pos = { x, y: num(y) ? y : p.pos.y, z };
    p.vy = 0; p.vel = { x: 0, y: 0, z: 0 };
  }
  if (b.face && [b.face.x, b.face.y, b.face.z].every(num)) {
    const dx = b.face.x - p.pos.x, dy = b.face.y - p.pos.y, dz = b.face.z - p.pos.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = p.mode === "planet" ? 0 : Math.atan2(dy, Math.hypot(dx, dz));
  }
  if (num(b.yaw)) p.yaw = b.yaw;
  if (num(b.pitch)) p.pitch = b.pitch;
  if (b.heal) { p.hp = Contract.TUNING.shipHp; p.dead = false; }
  return { ok: true, mode: p.mode, x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z), yaw: r2(p.yaw), pitch: r2(p.pitch) };
}

function setBoss(b) {
  if (!world) return { ok: false, error: "world not captured" };
  const boss = world.debug().boss;
  if (!boss) return { ok: false, error: "no boss" };
  if (Number.isFinite(b.hp)) boss.hp = Math.max(1, Math.min(boss.maxHp, b.hp));
  return { ok: true, hp: boss.hp, maxHp: boss.maxHp };
}

// ---- Extra files and 404 tracking -------------------------------------------------------------------------------------

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary" };
const PRIVATE = new Set(["server.js", "world.js", "astra.js", "rules.js", "https.js", ".env"]);
const EXTRA = new Map([["/inflate.js", path.join(ROOT, "inflate.js")]]);
for (const f of String(opt("serve", "")).split(",").map((s) => s.trim()).filter(Boolean)) {
  if (/[\\/]/.test(f) || f.startsWith(".") || PRIVATE.has(f)) { log(`--serve ${f}: refused (only plain, non-private files of the repo root)`); continue; }
  EXTRA.set(`/${f}`, path.join(ROOT, f));
}
const missing = new Map();   // pathname → count of 404s on GET/HEAD
// Does the real server.js list inflate.js in PUBLIC_FILES by itself now (the known gap)? The wrapper serves it either way.
let serverJsServesInflate = null;
try { serverJsServesInflate = /PUBLIC_FILES\s*=\s*new Set\(\[[^\]]*"inflate\.js"/.test(fs.readFileSync(path.join(ROOT, "server.js"), "utf8")); } catch {}

function track(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return;
  const writeHead = res.writeHead;
  res.writeHead = function (status, ...rest) {
    if (status === 404 && pathname !== "/favicon.ico") {
      if (!missing.has(pathname)) log(`404 ${req.method} ${pathname}`);
      missing.set(pathname, (missing.get(pathname) || 0) + 1);
    }
    return writeHead.call(this, status, ...rest);
  };
}

function serveRootFile(req, res, file) {
  let stat = null;
  try { stat = fs.statSync(file); } catch {}
  if (!stat || !stat.isFile()) {
    missing.set(path.basename(file), (missing.get(path.basename(file)) || 0) + 1);
    return res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Content-Length": stat.size, "Cache-Control": "no-store" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

const json = (res, status, body) => res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

async function testEndpoint(req, res, pathname) {
  try {
    if (pathname === "/__test/info") {
      return json(res, 200, {
        ok: true, pid: process.pid, port: PORT, argv, round: { ...Contract.ROUND }, roundDefaults: ROUND_DEFAULTS, world: !!world,
        missing: Object.fromEntries(missing), drawingsDir: DRAWINGS_DIR, perfLog: process.env.PERF_LOG, serverJsServesInflate,
      });
    }
    if (pathname === "/__test/state") return json(res, 200, snapshot());
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST expected" });
    const body = await readBody(req);
    if (pathname === "/__test/effects") {
      const d=world.debug(),ps=Object.values(world.players), me=ps.find(p=>!p.bot),far=ps.filter(p=>p.bot);
      for(let i=0;i<8;i++){const p=far[i];p.empFor=60;p.inkFor=60;p.tractor={by:me.name,until:d.t+60,speed:0};}
      for(let i=0;i<16;i++) d.mines.push({id:9000+i,owner:me.name,mode:"planet",pos:{x:me.pos.x+(i%4)*2-3,y:me.pos.y,z:me.pos.z-5-Math.floor(i/4)*2},until:d.t+90,armedAt:d.t+90,color:ps[i].color,damage:20});
      for(let i=0;i<8;i++) d.decoys.push({id:9500+i,owner:far[i].name,mode:"planet",pos:{x:me.pos.x+(i%4)*3-5,y:me.pos.y,z:me.pos.z-8-Math.floor(i/4)*3},dir:{x:0,y:0,z:0},yaw:0,until:d.t+60,hp:100,color:far[i].color,speed:0});
      qaBroadcast(world.worldMessage());return json(res,200,{ok:true,mines:d.mines.length,decoys:d.decoys.length});
    }
    if (pathname === "/__test/crowd") {
      const d=world.debug();let i=0;
      for(const p of Object.values(world.players)){
        p.mode="planet";p.landingFor=0;p.takeoffFor=0;p.dead=false;p.hp=100;p.keys={};p.axes={};
        const x=d.landing.x+(i%5)*4-8,z=d.landing.z+Math.floor(i/5)*4-8;
        p.pos={x,y:Math.max(0,Terrain.height(x,z,d.island.seed)),z};p.yaw=0;p.pitch=0;p.vy=0;
        world.setEntity(p.name,"explorer",{type:"person",source:"qa-staged",unlocked:Verbs.DEV_KIT.planet,parts:[]});
        if(!d.parked.some(c=>c.player===p.name))d.parked.push({player:p.name,x:x+18,z,hp:300,maxHp:300,wrecked:false});i++;
      }
      qaBroadcast(world.worldMessage());return json(res,200,{ok:true,players:i,staged:true});
    }
    if (pathname === "/__test/round") {
      if (body.reset) Object.assign(Contract.ROUND, ROUND_DEFAULTS);
      return json(res, 200, { ok: true, round: setRound(body) });
    }
    if (pathname === "/__test/teleport") return json(res, 200, teleport(body));
    if (pathname === "/__test/boss") return json(res, 200, setBoss(body));
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
      if ((req.method === "GET" || req.method === "HEAD") && EXTRA.has(pathname)) return serveRootFile(req, res, EXTRA.get(pathname));
      track(req, res, pathname);
      return handler(req, res);
    };
  }
  return realCreateServer.apply(this, args);
};

// ---- Start the real server --------------------------------------------------------------------------------------------

// The harness tools set V11_EXIT_WITH_PARENT=1: if the tool that started this server is killed hard, the server exits too
// instead of lingering on its port (a server started by hand keeps running as before).
if (process.env.V11_EXIT_WITH_PARENT === "1") {
  const parent = process.ppid;
  setInterval(() => { if (process.ppid !== parent) { log("the parent process is gone: exiting"); process.exit(0); } }, 1500).unref();
}

log(`starting server.js on :${PORT} (ASTRA_MOCK=1, HTTPS off, perf log ${path.relative(ROOT, process.env.PERF_LOG)}, drawings ${path.relative(ROOT, DRAWINGS_DIR)})`);
log(`serving on its own: ${[...EXTRA.keys()].join(" ")}; test hooks at /__test/info, /state, /round, /teleport, /boss`);
const probe = net.createServer();
probe.once("error", (err) => { console.error(`[v11-server] port ${PORT} is not available (${err.code}); pick another with PORT=`); process.exit(3); });
probe.listen(PORT, "0.0.0.0", () => probe.close(() => require(path.join(ROOT, "server.js"))));
