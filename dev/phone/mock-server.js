// Mock server for the phone lane (port 8103, no dependencies).
// Serves the static files, accepts /join, logs /input and /perf, answers /generate after 800 ms with a canned
// contract-valid layout, streams a minimal contract-valid world + tick, and sends each player a ghost toast 10 s
// after joining. Test hooks: POST /mock { phase, mode, toast } changes the fake state.
//   node dev/phone/mock-server.js            log lines go to stdout and dev/phone/mock.log
const http = require("http");
const fs = require("fs");
const path = require("path");
const Contract = require("../../contract.js");

const PORT = Number(process.env.PORT || 8103);
const ROOT = path.join(__dirname, "..", "..");
const LOG = path.join(__dirname, "mock.log");
fs.writeFileSync(LOG, "");
const log = (line) => { const s = `${new Date().toISOString().slice(11, 23)} ${line}`; console.log(s); fs.appendFileSync(LOG, s + "\n"); };

const STATIC = { "/controller.html": "text/html", "/contract.js": "text/javascript", "/verbs.js": "text/javascript", "/render.js": "text/javascript", "/terrain.js": "text/javascript", "/dev/phone/sample.html": "text/html" };
const players = new Map();     // name -> { color, joinedAt, mode, x, z, yaw, score, ready }
const clients = new Set();
const state = { phase: "lobby", clock: 20, round: 1, mode: null, landing: false };
const t0 = Date.now();

const world = {
  type: "world", round: 1, seed: 7, radius: 600,
  rocks: Array.from({ length: 20 }, (_, i) => [i, Math.cos(i) * 80, Math.sin(i * 2) * 20, Math.sin(i) * 80, 2 + (i % 4), i % 6, 1]),
  nebula: { x: 0, y: 0, z: -380, radius: 60 },
  targets: [{ id: 1, kind: "boss", x: 10, y: 0, z: -380, radius: 9, armour: 100, hp: 300, maxHp: 300, cracked: false, dead: false },
          ],
  revealedTo: [], planet: null, island: { seed: 3, size: 200 },
  chests: [{ id: 1, x: 10, z: 10, buried: true, dug: 0, open: false }],
};
const worldErrors = Contract.CHECKS.world(world);
if (worldErrors.length) throw new Error("mock world invalid: " + worldErrors.join("; "));

function tick() {
  const t = (Date.now() - t0) / 1000;
  return {
    type: "tick", t: Date.now(), round: state.round, phase: state.phase, clock: state.clock,
    players: [...players.entries()].map(([name, p], i) => ({
      name, color: p.color, mode: state.mode || p.mode,
      x: Math.cos(t * 0.3 + i) * 50, y: 0, z: Math.sin(t * 0.3 + i) * 50 - 100, yaw: t * 0.3, pitch: 0, roll: 0,
      hp: 100, score: p.score, shieldEnergy: 0.5 + 0.5 * Math.sin(t), boostEnergy: 0.5 + 0.5 * Math.cos(t * 0.7),
      drawingsLeft: { ...p.left },
      flags: { boost: false, shield: false, stun: false, dead: false, invisible: false, drilling: false, digging: false, ready: p.ready, bot: false, landing: state.landing, takingOff: false },
      action: null, slot: null, startedAt: 0,
    })),
    bullets: [], bossShots: [], flares: [],
  };
}
function send(res, m) { res.write(`data: ${JSON.stringify(m)}\n\n`); }
function broadcast(m) { for (const res of clients) send(res, m); }

let tickErrors = 0, ticks = 0;
setInterval(() => {
  // lobby and scoreboard count down; playing and assists count up (no time cap)
  const up = state.phase === "playing" || state.phase === "assists";
  state.clock = up ? state.clock + 1 / Contract.TICK_HZ : Math.max(0, state.clock - 1 / Contract.TICK_HZ);
  if (state.phase === "playing" && state.clock >= Contract.ROUND.assistsAt) { state.phase = "assists"; log("PHASE assists"); }
  if (!up && state.clock === 0) setPhase(state.phase === "lobby" ? "playing" : "lobby");
  const m = tick();
  const errs = Contract.CHECKS.tick(m);
  if (errs.length && tickErrors++ < 3) log("TICK INVALID " + errs.join("; "));
  ticks++;
  broadcast(m);
  for (const [name, p] of players) {
    if (!p.toasted && Date.now() - p.joinedAt > 10000) {
      p.toasted = true;
      broadcast({ type: "toast", player: name, text: "Draw a LAND button", ghost: { action: "land", x: 0.4, y: 0.3, w: 0.2, h: 0.3 } });
      log(`TOAST ${name} ghost land`);
    }
  }
}, 1000 / Contract.TICK_HZ);

function setPhase(phase) {
  state.phase = phase;
  state.clock = { lobby: Contract.ROUND.lobbySeconds, playing: 0, assists: Contract.ROUND.assistsAt, scoreboard: Contract.ROUND.scoreboardSeconds }[phase];
  if (phase === "lobby") for (const p of players.values()) p.left = { ...Contract.TUNING.drawings };
  log(`PHASE ${phase}`);
}

function body(req) {
  return new Promise((ok) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { ok({}); } }); });
}
function json(res, code, m) { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(m)); }

const CANNED = { source: "model", buttons: [
  { type: "stick", action: "steer", label: "STEER", x: 0.05, y: 0.35, w: 0.32, h: 0.6 },
  { type: "button", action: "fire", label: "FIRE", x: 0.72, y: 0.45, w: 0.24, h: 0.45 },
  { type: "button", action: "boost", label: "BOOST", x: 0.5, y: 0.6, w: 0.18, h: 0.32 },
] };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    clients.add(res);
    send(res, world);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (req.method === "POST" && url.pathname === "/join") {
    const m = await body(req);
    const name = Contract.cleanName(m.player);
    if (!name) return json(res, 400, { error: "name" });
    if (!players.has(name)) players.set(name, { color: Contract.COLORS[players.size % Contract.COLORS.length], joinedAt: Date.now(), mode: "space", score: 0, ready: false, left: { ...Contract.TUNING.drawings } });
    log(`JOIN ${name}`);
    return json(res, 200, { player: name, color: players.get(name).color });
  }
  if (req.method === "POST" && url.pathname === "/input") {
    const m = await body(req);
    const errs = Contract.CHECKS.input(m);
    log(`INPUT ${JSON.stringify(m)}${errs.length ? " INVALID " + errs.join("; ") : ""}`);
    if (m.type === "input" && m.action === "ready" && m.down && players.has(m.player)) players.get(m.player).ready = true;
    res.writeHead(204); return res.end();
  }
  if (req.method === "POST" && url.pathname === "/perf") {
    const m = await body(req);
    log(`PERF ${JSON.stringify(m)}`);
    res.writeHead(204); return res.end();
  }
  if (req.method === "POST" && url.pathname === "/generate") {
    const m = await body(req);
    const img = String(m.image || "");
    const size = pngSize(img);
    log(`GENERATE kind=${m.kind} source=${m.source} speculative=${m.speculative} requestId=${m.requestId} region=${JSON.stringify(m.region || null)} png=${size ? size.w + "x" + size.h : "bad"} bytes=${img.length}`);
    await new Promise((ok) => setTimeout(ok, 800));
    const p = players.get(m.player);
    const where = state.mode || (p && p.mode) || "space";
    if (p && !m.speculative && p.left[where] <= 0) return json(res, 200, { ok: false, error: "no drawings left" });
    if (!size || Math.max(size.w, size.h) > 512) return json(res, 200, { ok: false, error: "image must be a PNG, max 512 px" });
    let layout;
    if (m.kind === "button") {
      const r = m.region || { x: 0.4, y: 0.3, w: 0.2, h: 0.3 };
      layout = { source: "model", buttons: [{ type: "button", action: "land", label: "LAND", x: r.x, y: r.y, w: r.w, h: r.h }] };
    } else layout = CANNED;
    const errs = Contract.CHECKS.layout(layout);
    if (errs.length) log("LAYOUT INVALID " + errs.join("; "));
    broadcast({ type: "generated", player: m.player, kind: m.kind, layout });
    if (p && !m.speculative) p.left[where]--;      // only finished drawings count
    return json(res, 200, { ok: true, layout, drawingsLeft: p ? { ...p.left } : undefined });
  }
  if (req.method === "POST" && url.pathname === "/mock") {
    const m = await body(req);
    if (m.phase) setPhase(m.phase);
    if (m.mode) { state.mode = m.mode; log(`MODE ${m.mode}`); }
    if (m.left) for (const p of players.values()) Object.assign(p.left, m.left);
    if ("landing" in m) { state.landing = !!m.landing; log(`LANDING ${state.landing}`); }
    if (m.toast) { broadcast({ type: "toast", ...m.toast }); log(`TOAST ${JSON.stringify(m.toast)}`); }
    if (m.save && m.dataUrl) fs.writeFileSync(path.join(__dirname, m.save.replace(/[^a-z0-9.-]/gi, "")), Buffer.from(m.dataUrl.split(",")[1], "base64"));
    return json(res, 200, { ok: true, state, ticks });
  }
  const file = url.pathname === "/" ? "/controller.html" : url.pathname;
  if (req.method === "GET" && (STATIC[file] || file.startsWith("/dev/phone/") || file.startsWith("/assets/"))) {
    const full = path.join(ROOT, file);
    if (!full.startsWith(ROOT) || !fs.existsSync(full)) { res.writeHead(404); return res.end("not found"); }
    const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".html": "text/html", ".js": "text/javascript", ".glb": "model/gltf-binary", ".json": "application/json" };
    const type = STATIC[file] || TYPES[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    return fs.createReadStream(full).pipe(res);
  }
  res.writeHead(404); res.end("not found");
}).listen(PORT, () => log(`mock phone server on http://localhost:${PORT}/controller.html`));

function pngSize(dataUrl) {
  if (!dataUrl.startsWith("data:image/png;base64,")) return null;
  const buf = Buffer.from(dataUrl.slice(22, 22 + 64), "base64");
  if (buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
