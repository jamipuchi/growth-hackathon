// Mock server for the render lane (port 8102, no dependencies).
// Serves the repo's static files and streams contract-valid world/tick/fx messages from a fake sim that walks the
// v1 stages: lobby → fly → flare → boss (drill, crack, shoot) → planet → island (dig) → assists, then loops.
//   node dev/render/mock-server.js [--port 8102] [--bots 8] [--stage auto]
//   GET /mock?stage=lobby|fly|flare|boss|broken|planet|island|assists|auto&bots=N   pin a stage / change bot count
//   GET /mock/perf   last POST /perf samples (also appended to dev/render/perf.log)
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const Contract = require(path.join(ROOT, "contract.js"));
const Terrain = require(path.join(ROOT, "terrain.js"));
const { TUNING, COLORS, ROCK_TYPE_NAMES, CHECKS, TICK_HZ } = Contract;

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const PORT = Number(arg("port", 8102));
let bots = Number(arg("bots", 2));
let pinned = arg("stage", "auto");

const STAGES = ["lobby", "fly", "flare", "boss", "broken", "planet", "island", "assists"];
const STAGE_SECONDS = 8;

// ---- deterministic world ----
let seed = 4242;
function rng(s) {
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const NEB = { x: 0, y: 20, z: -TUNING.nebula.distance, radius: TUNING.nebula.radius };
const BOSS = { x: NEB.x, y: NEB.y, z: NEB.z };
const PLANET = { x: 110, y: 10, z: NEB.z - 110, radius: TUNING.planet.radius, landRange: TUNING.planet.landRange };

function makeRocks() {
  const r = rng(seed);
  const rocks = [];
  const inPlay = TUNING.rockTypesInPlay.map((t) => ROCK_TYPE_NAMES.indexOf(t));
  for (let id = 1; id <= TUNING.rockCount; id++) {
    let x, y, z;
    do {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, rad = 30 + Math.cbrt(r()) * (TUNING.worldRadius - 60);
      const s = Math.sqrt(1 - u * u);
      x = Math.cos(th) * s * rad; y = u * rad * 0.5; z = Math.sin(th) * s * rad;
    } while (Math.hypot(x - BOSS.x, y - BOSS.y, z - BOSS.z) < 30 || Math.hypot(x - PLANET.x, y - PLANET.y, z - PLANET.z) < PLANET.radius + 20);
    const type = r() < 0.08 ? inPlay[1] : inPlay[0];
    rocks.push([id, +x.toFixed(1), +y.toFixed(1), +z.toFixed(1), +(2 + r() * 9).toFixed(2), type, Contract.ROCK_TYPES[ROCK_TYPE_NAMES[type]].health]);
  }
  return rocks;
}

// Chests on land near a landing spot (island coordinates).
function makeChests() {
  const r = rng(seed + 7);
  let land = { x: 40, z: 30 };
  for (let i = 0; i < 400; i++) {
    const x = (r() - 0.5) * 260, z = (r() - 0.5) * 260, h = Terrain.height(x, z, seed);
    if (h > 2 && h < 9) { land = { x, z }; break; }
  }
  const chests = [];
  for (let i = 0; i < TUNING.island.chests && chests.length < TUNING.island.chests; i++) {
    for (let k = 0; k < 200; k++) {
      const x = land.x + (r() - 0.5) * TUNING.island.chestSpread * 2, z = land.z + (r() - 0.5) * TUNING.island.chestSpread * 2;
      const h = Terrain.height(x, z, seed);
      if (h > 0.8) { chests.push({ id: `c${i}`, x: +x.toFixed(1), z: +z.toFixed(1), buried: i < TUNING.island.buried, dug: 0, open: false }); break; }
    }
  }
  return { land, chests };
}

const rocks = makeRocks();
const { land: LAND, chests: CHESTS } = makeChests();

const NAMES = ["keyboard", "ana", "ben", "cleo", "dev", "eli", "fay", "gus", "hal", "ivy"];
const keyboard = { keys: {}, pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, joined: false };

// ---- stage model ----
function stageAt(t) {
  if (pinned !== "auto") return { stage: pinned, u: (t % STAGE_SECONDS) / STAGE_SECONDS, st: t % STAGE_SECONDS };
  const i = Math.floor(t / STAGE_SECONDS) % STAGES.length;
  return { stage: STAGES[i], u: (t % STAGE_SECONDS) / STAGE_SECONDS, st: t % STAGE_SECONDS };
}

function lerp(a, b, u) { return a + (b - a) * u; }
function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }
function pitchTo(dx, dy, dz) { return Math.atan2(dy, Math.hypot(dx, dz)); }

function world(stageInfo) {
  const { stage, u } = stageInfo;
  const idx = STAGES.indexOf(stage);
  const bossIdx = STAGES.indexOf("boss");
  let armour = TUNING.boss.armour, hp = TUNING.boss.hp, cracked = false, dead = false;
  if (stage === "boss") { armour = Math.max(0, Math.round(TUNING.boss.armour * (1 - u * 1.6))); cracked = armour < TUNING.boss.armour; }
  if (stage === "broken") { armour = 0; cracked = true; hp = Math.round(TUNING.boss.hp * (1 - u * 0.9)); }
  if (idx > STAGES.indexOf("broken")) { armour = 0; cracked = true; hp = 0; dead = true; }
  const planet = idx >= STAGES.indexOf("planet") ? PLANET : null;
  const chests = CHESTS.map((c, i) => ({ ...c, dug: stage === "island" && i === 0 ? +Math.min(1, u * 1.2).toFixed(2) : stage === "assists" && c.buried ? 1 : 0, open: false }));
  if (stage === "assists") chests.forEach((c) => (c.buried = false));
  return {
    type: "world", round: 1, seed, radius: TUNING.worldRadius, rocks,
    nebula: NEB,
    targets: [{ id: "boss", kind: "boss", x: BOSS.x, y: BOSS.y, z: BOSS.z, radius: TUNING.boss.radius, armour, hp, maxHp: TUNING.boss.hp, cracked, dead }],
    revealedTo: stage === "assists" ? players(stageInfo, 0).map((p) => p.name) : idx >= bossIdx ? ["ana"] : [],
    planet, island: { seed, size: Terrain.ISLAND_SIZE, landing: { x: +LAND.x.toFixed(1), z: +LAND.z.toFixed(1) } }, chests,
  };
}

function shipAt(i, n, stageInfo, t) {
  const { stage, u } = stageInfo;
  const ang = (i / Math.max(1, n)) * Math.PI * 2;
  const spawn = { x: Math.cos(ang) * TUNING.spawnSpacing * 1.5, y: 0, z: Math.sin(ang) * TUNING.spawnSpacing * 1.5 };
  let pos = { ...spawn };
  const around = (c, rad, speed, phase) => {
    const a = t * speed + phase;
    return { x: c.x + Math.cos(a) * rad, y: c.y + Math.sin(a * 0.7) * 6 + (i % 3) * 4, z: c.z + Math.sin(a) * rad };
  };
  if (stage === "lobby") pos = { ...spawn, y: Math.sin(t + i) * 0.5 };
  else if (stage === "fly") {
    const k = Math.min(1, u * 1.1 * (1 - i * 0.04));
    const lane = { x: Math.cos(ang) * 14, y: Math.sin(ang) * 8, z: 0 };
    pos = { x: lerp(spawn.x, BOSS.x + lane.x, k) + Math.sin(t * 0.8 + i) * 4, y: lerp(spawn.y, BOSS.y + lane.y, k), z: lerp(spawn.z, BOSS.z + 70 + lane.z, k) };
  } else if (stage === "flare" || stage === "boss" || stage === "broken") pos = around(BOSS, 24 + (i % 4) * 5, 0.35, ang);
  else if (stage === "planet") {
    const from = around(BOSS, 30, 0.35, ang);
    const to = around(PLANET, PLANET.radius + 18 + i * 2, 0.25, ang);
    pos = { x: lerp(from.x, to.x, Math.min(1, u * 1.4)), y: lerp(from.y, to.y, Math.min(1, u * 1.4)), z: lerp(from.z, to.z, Math.min(1, u * 1.4)) };
  } else pos = around(PLANET, PLANET.radius + 18 + i * 2, 0.25, ang);
  return pos;
}

function players(stageInfo, t) {
  const n = Math.max(1, bots);
  const out = [];
  const { stage, u } = stageInfo;
  for (let i = 0; i < n; i++) {
    const name = NAMES[i + 1];
    let pos = shipAt(i, n, stageInfo, t);
    const look = stage === "lobby" ? { x: pos.x, y: pos.y, z: pos.z - 10 } : shipAt(i, n, { ...stageInfo, u: Math.min(1, u + 0.1 / STAGE_SECONDS) }, t + 0.1);
    let mode = "space";
    let yaw = 0, pitch = 0, roll = 0;
    if (look) {
      const dx = look.x - pos.x, dy = look.y - pos.y, dz = look.z - pos.z;
      if (Math.hypot(dx, dz) > 1e-3) { yaw = yawTo(dx, dz); pitch = pitchTo(dx, dy, dz); }
      roll = Math.sin(t * 0.7 + i) * 0.3;
    }
    const flags = { boost: stage === "fly" && i % 2 === 0, shield: stage === "boss" && i === 1, stun: stage === "boss" && i === 2 && u > 0.5, dead: false, invisible: stage === "flare" && i === 3, drilling: stage === "boss" && i === 0, digging: false, ready: stage === "lobby" ? i < 1 + Math.floor(u * n) : true, bot: true };
    // Player 0 lands on the island in the island/assists stages and digs the first chest.
    if ((stage === "island" || stage === "assists") && i === 0) {
      mode = "planet";
      const c = CHESTS[0];
      const k = Math.min(1, u * 3);
      const x = lerp(LAND.x, c.x + 1.2, k), z = lerp(LAND.z, c.z + 1.2, k);
      pos = { x, y: Math.max(0, Terrain.height(x, z, seed)), z };
      yaw = yawTo(c.x - LAND.x, c.z - LAND.z);
      pitch = 0; roll = 0;
      flags.digging = k >= 1;
    }
    out.push({
      name, color: COLORS[i % COLORS.length], mode,
      x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2), yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3), roll: +roll.toFixed(3),
      hp: stage === "boss" && i === 1 ? 62 : 100, score: Math.round(t * 3 + (n - i) * 40) % 1600,
      shieldEnergy: flags.shield ? 0.4 + 0.5 * (1 - u) : 1, boostEnergy: flags.boost ? 1 - u * 0.8 : 0.8,
      flags, action: flags.drilling ? "drill" : flags.digging ? "dig" : "shoot", slot: "primary", startedAt: Date.now() - 200,
    });
  }
  if (keyboard.joined) {
    out.unshift({
      name: "keyboard", color: COLORS[(n) % COLORS.length], mode: "space",
      x: +keyboard.pos.x.toFixed(2), y: +keyboard.pos.y.toFixed(2), z: +keyboard.pos.z.toFixed(2), yaw: +keyboard.yaw.toFixed(3), pitch: +keyboard.pitch.toFixed(3), roll: 0,
      hp: 100, score: 0, shieldEnergy: keyboard.keys.shield ? 0.5 : 1, boostEnergy: keyboard.keys.boost ? 0.5 : 1,
      flags: { boost: !!keyboard.keys.boost, shield: !!keyboard.keys.shield, stun: false, dead: false, invisible: false, drilling: !!keyboard.keys.drill, digging: false, ready: !!keyboard.ready, bot: false },
      action: "", slot: "", startedAt: Date.now(),
    });
  }
  return out;
}

// Keyboard player: same flight convention as world.js (nose −Z, yaw around Y then pitch).
function stepKeyboard(dt) {
  if (!keyboard.joined) return;
  const k = keyboard.keys;
  keyboard.yaw -= ((k.right ? 1 : 0) - (k.left ? 1 : 0)) * TUNING.turnRate * dt;
  keyboard.pitch = Math.max(-TUNING.maxPitch, Math.min(TUNING.maxPitch, keyboard.pitch + ((k.up ? 1 : 0) - (k.down ? 1 : 0)) * TUNING.turnRate * dt));
  const cp = Math.cos(keyboard.pitch);
  const f = { x: -Math.sin(keyboard.yaw) * cp, y: Math.sin(keyboard.pitch), z: -Math.cos(keyboard.yaw) * cp };
  const speed = (TUNING.cruiseSpeed + ((k.forward ? 1 : 0) - (k.back ? 1 : 0)) * TUNING.thrustSpeed) * (k.boost ? TUNING.boostMultiplier : 1);
  keyboard.pos.x += f.x * speed * dt; keyboard.pos.y += f.y * speed * dt; keyboard.pos.z += f.z * speed * dt;
  const right = { x: Math.cos(keyboard.yaw), z: -Math.sin(keyboard.yaw) };
  const strafe = ((k.straferight ? 1 : 0) - (k.strafeleft ? 1 : 0)) * TUNING.strafeSpeed * dt;
  keyboard.pos.x += right.x * strafe; keyboard.pos.z += right.z * strafe;
  keyboard.pos.y += ((k.rise ? 1 : 0) - (k.sink ? 1 : 0)) * TUNING.strafeSpeed * dt;
}

// ---- bullets, boss shots, flares ----
let bulletId = 1;
function bullets(ps, stageInfo, t) {
  const out = [];
  if (!["boss", "broken", "fly"].includes(stageInfo.stage)) return out;
  ps.forEach((p, i) => {
    if (p.mode !== "space" || p.flags.drilling) return;
    for (let k = 0; k < 3; k++) {
      const age = ((t * 4 + k / 3 + i * 0.13) % 1) * TUNING.bulletLife * 0.6;
      const born = shipAt(i, ps.length, stageInfo, t - age);
      const tgt = stageInfo.stage === "fly" ? { x: born.x, y: born.y, z: born.z - 50 } : BOSS;
      const d = Math.hypot(tgt.x - born.x, tgt.y - born.y, tgt.z - born.z) || 1;
      const s = Math.min(d, TUNING.bulletSpeed * age);
      out.push([1000 + i * 10 + k + Math.floor(t * 4 + k / 3 + i * 0.13) * 100, +(born.x + (tgt.x - born.x) / d * s).toFixed(2), +(born.y + (tgt.y - born.y) / d * s).toFixed(2), +(born.z + (tgt.z - born.z) / d * s).toFixed(2), p.color]);
    }
  });
  return out;
}
function bossShots(ps, stageInfo, t) {
  if (!["boss", "broken"].includes(stageInfo.stage) || !ps.length) return [];
  const out = [];
  for (let k = 0; k < 2; k++) {
    const age = ((t / TUNING.boss.shotEverySeconds + k / 2) % 1) * TUNING.boss.shotEverySeconds;
    const tgt = ps[k % ps.length];
    const d = Math.hypot(tgt.x - BOSS.x, tgt.y - BOSS.y, tgt.z - BOSS.z) || 1;
    const s = Math.min(d, TUNING.boss.shotSpeed * age);
    out.push([Math.floor(t / TUNING.boss.shotEverySeconds + k / 2) * 2 + k, +(BOSS.x + (tgt.x - BOSS.x) / d * s).toFixed(2), +(BOSS.y + (tgt.y - BOSS.y) / d * s).toFixed(2), +(BOSS.z + (tgt.z - BOSS.z) / d * s).toFixed(2)]);
  }
  return out;
}

// ---- SSE ----
const clients = new Set();
function send(res, msg) { res.write(`data: ${JSON.stringify(msg)}\n\n`); }
function broadcast(msg) { for (const c of clients) send(c, msg); }

const START = Date.now();
let lastWorldKey = "";
let lastStage = "";
let lastWorld = null;
let stats = { ticks: 0, worlds: 0, invalid: 0, bytes: 0 };
let lastStep = Date.now();

function validate(kind, msg) {
  const errs = CHECKS[kind](msg);
  if (errs.length) { stats.invalid++; console.error(`[mock] invalid ${kind}:`, errs.join("; ")); }
}

function tickLoop() {
  const now = Date.now();
  stepKeyboard((now - lastStep) / 1000);
  lastStep = now;
  const t = (now - START) / 1000;
  const si = stageAt(t);
  const w = world(si);
  const key = JSON.stringify([w.targets, w.planet, w.chests, w.revealedTo]);
  if (key !== lastWorldKey) {
    lastWorldKey = key; lastWorld = w; validate("world", w); stats.worlds++; broadcast(w);
  }
  const ps = players(si, t);
  if (si.stage !== lastStage) {
    lastStage = si.stage;
    const msgs = {
      flare: [{ type: "fx", kind: "flare", mode: "space", pos: { x: BOSS.x + 20, y: BOSS.y + 5, z: BOSS.z + 25 }, color: COLORS[0], size: TUNING.flare.radius }, { type: "fx", kind: "scan", mode: "space", pos: { x: BOSS.x + 25, y: BOSS.y, z: BOSS.z + 30 }, color: 0x22d3ee, size: TUNING.scan.range }],
      broken: [{ type: "announce", text: "BOSS ARMOUR BROKEN", big: false }, { type: "fx", kind: "crack", mode: "space", pos: BOSS, color: 0xf97316, size: 12 }],
      planet: [{ type: "fx", kind: "explode", mode: "space", pos: BOSS, color: 0xef4444, size: 30 }, { type: "announce", text: "ANA DESTROYED THE BOSS! +1000", big: true }],
      island: [{ type: "fx", kind: "land", mode: "planet", pos: { x: LAND.x, y: Terrain.height(LAND.x, LAND.z, seed), z: LAND.z }, color: COLORS[0], size: 4 }, { type: "toast", player: "ana", text: "Something is buried here.", ghost: null }],
      assists: [{ type: "announce", text: "ASSISTS ON", big: false }, { type: "fx", kind: "treasure", mode: "planet", pos: { x: CHESTS[0].x, y: Terrain.height(CHESTS[0].x, CHESTS[0].z, seed), z: CHESTS[0].z }, color: 0xfacc15, size: 6 }],
      lobby: [{ type: "announce", text: "ROUND 1: GET READY", big: true }],
    }[si.stage] || [];
    msgs.forEach(broadcast);
  }
  // Periodic effects so the fx path is exercised continuously.
  if (["boss", "broken"].includes(si.stage) && Math.random() < 0.4) {
    const p = ps.find((q) => q.flags.drilling) || ps[0];
    broadcast({ type: "fx", kind: si.stage === "boss" ? "drill" : "hit", mode: "space", pos: { x: lerp(p.x, BOSS.x, 0.6), y: lerp(p.y, BOSS.y, 0.6), z: lerp(p.z, BOSS.z, 0.6) }, color: 0xfacc15, size: 2 });
  }
  if (si.stage === "fly" && Math.random() < 0.05) {
    const r = rocks[Math.floor(Math.random() * rocks.length)];
    broadcast({ type: "fx", kind: "explode", mode: "space", pos: { x: r[1], y: r[2], z: r[3] }, color: 0xa8a29e, size: r[4] });
  }
  if (si.stage === "island" && ps[0] && ps[0].flags.digging && Math.random() < 0.3) {
    broadcast({ type: "fx", kind: "dig", mode: "planet", pos: { x: CHESTS[0].x, y: Terrain.height(CHESTS[0].x, CHESTS[0].z, seed), z: CHESTS[0].z }, color: 0xd6b37a, size: 1 });
  }
  const flareStages = { flare: 1, boss: 1 };
  const flares = flareStages[si.stage] ? [[BOSS.x + 20, BOSS.y + 5, BOSS.z + 25, TUNING.flare.radius, +Math.max(0, TUNING.flare.seconds - si.st - (si.stage === "boss" ? STAGE_SECONDS : 0)).toFixed(1)]].filter((f) => f[4] > 0) : [];
  const phase = si.stage === "lobby" ? "lobby" : si.stage === "assists" ? "assists" : "playing";
  const clock = phase === "lobby" ? +(Contract.ROUND.lobbySeconds - si.st * 2.5).toFixed(1) : phase === "assists" ? +(180 + si.st).toFixed(1) : +(STAGES.indexOf(si.stage) * 20 + si.st).toFixed(1);
  const tick = { type: "tick", t: now, round: 1, phase, clock, players: ps, bullets: bullets(ps, si, t), bossShots: bossShots(ps, si, t), flares };
  validate("tick", tick);
  stats.ticks++;
  const json = JSON.stringify(tick);
  stats.bytes = json.length;
  for (const c of clients) c.write(`data: ${json}\n\n`);
}
setInterval(tickLoop, 1000 / TICK_HZ);

// ---- HTTP ----
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary", ".css": "text/css", ".svg": "image/svg+xml" };
const perfSamples = [];
function body(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": hi\n\n");
    clients.add(res);
    if (lastWorld) send(res, lastWorld);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (url.pathname === "/mock") {
    if (url.searchParams.get("stage")) { pinned = url.searchParams.get("stage"); lastWorldKey = ""; lastStage = ""; }
    if (url.searchParams.get("bots")) bots = Number(url.searchParams.get("bots"));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ pinned, bots, stats, clients: clients.size }));
  }
  if (url.pathname === "/mock/perf") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(perfSamples.slice(-50)));
  }
  if (req.method === "POST") {
    const m = await body(req);
    if (url.pathname === "/perf") {
      const errs = CHECKS.perf(m);
      m.at = new Date().toISOString(); m.errors = errs;
      perfSamples.push(m);
      fs.appendFile(path.join(__dirname, "perf.log"), JSON.stringify(m) + "\n", () => {});
    } else if (url.pathname === "/join") {
      if (Contract.cleanName(m.player) === "keyboard") keyboard.joined = true;
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ player: Contract.cleanName(m.player), color: COLORS[0] }));
    } else if (url.pathname === "/input") {
      if (m.player === "keyboard") {
        keyboard.joined = true;
        if (m.type === "input") { if (m.action === "ready") keyboard.ready = m.down || keyboard.ready; keyboard.keys[m.action] = m.down; }
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end('{"ok":true}');
  }
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/space.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + path.sep) || /(^|\/)\.|\.env|server\.js$/.test(p)) { res.writeHead(404); return res.end("no"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
});
server.listen(PORT, () => console.log(`[mock] render mock on http://localhost:${PORT}/space.html  (stage ${pinned}, bots ${bots})`));
