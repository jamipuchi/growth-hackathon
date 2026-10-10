// The e2e route driver (PLAN.md section 0, v1.1): reads the server's messages and plays one player along the route
// with POST /input and POST /generate. Shared by dev/e2e/run.mjs (real server, real time) and
// dev/netcode/balance-sim.mjs (world.js fast-forward, simulated time), so both play exactly the same way.
//   expert:  draws the ship and explorer in the lobby (lobbyDraws) and every button as the route needs it; boosts.
//   regular: draws nothing up front; waits at each gate for the hint (part first, then button), then drawSeconds
//            drawing. v1.6 (owner 12:07): nothing to draw for landing: every ship flies into the planet and lands.
// createDriver({ route, me, drawSeconds, now, post, onStage, log, Contract }) → { D, onMessage, lobbyDraws }
//   now() → ms; post(pathname, body) → Promise<{ status, json }>; onStage(name) e.g. takes screenshots.
import zlib from "zlib";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const Terrain = createRequire(import.meta.url)(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../terrain.js"));

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// Below the phone HUD band (the top ~30%, astra-html.js --hud): where a player adds a button without a ghost box.
const GATE_REGION = { drill: { x: 0.38, y: 0.32, w: 0.18, h: 0.2 }, dig: { x: 0.38, y: 0.56, w: 0.18, h: 0.2 } };
// Which hint (rules.js gate + need) a drawing answers: the ship and explorer are "part" hints, buttons "button" hints.
// v1.6: no LAND gate (no legs drawing, no LAND button): the ship lands by flying into the planet.
const GATE_HINT = { ship: ["weapon", "part"], explorer: [null, "part"], dig: ["dig", "button"], drill: ["drill", "button"] };
const ENTITY_OF = { ship: "ship", explorer: "explorer" };

// Walking on the island: A* over a 2 m grid of dry land (the same terrain.js the server uses, with a margin off the
// waterline), smoothed to the farthest waypoint in a dry straight line. Returns waypoints to `to`, or null.
const CELL = 2;
function planPath(island, from, to) {
  const dry = (x, z) => Terrain.height(x, z, island.seed) > 0.45 && Math.hypot(x, z) < island.size / 2 - 7;
  const x0 = Math.min(from.x, to.x) - 50, z0 = Math.min(from.z, to.z) - 50;
  const nx = Math.ceil((Math.max(from.x, to.x) + 50 - x0) / CELL) + 1, nz = Math.ceil((Math.max(from.z, to.z) + 50 - z0) / CELL) + 1;
  const at = (i) => ({ x: x0 + (i % nx) * CELL, z: z0 + Math.floor(i / nx) * CELL });
  const cellOf = (p) => Math.round((p.z - z0) / CELL) * nx + Math.round((p.x - x0) / CELL);
  const start = cellOf(from), goal = cellOf(to);
  const ok = new Map();
  const free = (i) => { if (i === start || i === goal) return true; if (!ok.has(i)) { const c = at(i); ok.set(i, dry(c.x, c.z)); } return ok.get(i); };
  const g = new Map([[start, 0]]), came = new Map(), open = [[0, start]], done = new Set();
  const h = (i) => { const a = at(i), b = at(goal); return Math.hypot(a.x - b.x, a.z - b.z); };
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
    const [, cur] = open.splice(bi, 1)[0];
    if (cur === goal) break;
    if (done.has(cur)) continue;
    done.add(cur);
    const cx = cur % nx, cz = Math.floor(cur / nx);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
      const n = z * nx + x;
      if (done.has(n) || !free(n) || (dx && dz && (!free(cz * nx + x) || !free(z * nx + cx)))) continue;
      const cost = g.get(cur) + (dx && dz ? Math.SQRT2 : 1) * CELL;
      if (cost < (g.get(n) ?? Infinity)) { g.set(n, cost); came.set(n, cur); open.push([cost + h(n), n]); }
    }
  }
  if (!came.has(goal) && goal !== start) return null;
  const cells = [goal];
  while (cells[0] !== start) cells.unshift(came.get(cells[0]));
  const pts = cells.map(at);
  pts[pts.length - 1] = { x: to.x, z: to.z };
  const clear = (a, b) => { const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)); for (let i = 1; i < n; i++) if (!dry(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n)) return false; return true; };
  const out = [];
  for (let i = 0; i < pts.length - 1;) {
    let j = pts.length - 1;
    while (j > i + 1 && !clear(i ? pts[i] : from, pts[j])) j--;
    out.push(pts[j]); i = j;
  }
  return out.length ? out : [{ x: to.x, z: to.z }];
}

// A small grey PNG "drawing": a box with a few strokes, different per label so the hash differs.
export function pngDataUrl(label, w = 96, h = 48) {
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

export function createDriver({ route = "expert", me = "e2e", drawSeconds = 3, now = Date.now, post, onStage = () => {}, log = () => {}, Contract }) {
  const T = Contract.TUNING;
  const expert = route === "expert";
  const D = {
    world: null, tick: null, me: null, playingAt: null, wonAt: null, wonClock: null, winner: null, lastPhase: null,
    stages: {}, toasts: [], announces: [], generates: [], issues: [], ticks: 0, invalid: { world: 0, tick: 0 },
    held: {}, queue: [], axes: {}, pressedAt: {}, gates: {}, deaths: 0, wasDead: false, myEntity: null,
    endedAt: null, result: null, entities: [], refused: 0, chestsOpened: 0, release: [],
  };

  const playT = () => (D.playingAt ? +((now() - D.playingAt) / 1000).toFixed(2) : 0);
  function stage(name, extra = {}) {
    if (D.stages[name]) return;
    D.stages[name] = { t: playT(), clock: D.tick ? D.tick.clock : null, ...extra };
    log(`stage ${name.padEnd(12)} at ${D.stages[name].t.toFixed(1)} s (clock ${D.stages[name].clock})${Object.keys(extra).length ? " " + JSON.stringify(extra) : ""}`);
    onStage(name);
  }

  // Inputs: held keys are sent only when they change, axes once per tick, all in one POST /input per tick.
  const key = (action, down) => { down = !!down; if (!!D.held[action] === down) return; D.held[action] = down; D.queue.push({ type: "input", player: me, action, down }); };
  const axis = (name, x, y) => { D.axes[name] = { type: "axis", player: me, axis: name, x: +clamp(x).toFixed(3), y: +clamp(y).toFixed(3) }; };
  const press = (action) => { D.queue.push({ type: "input", player: me, action, down: true }); D.pressedAt[action] = now(); D.release.push(action); };
  function releaseAll() {
    for (const a of Object.keys(D.held)) key(a, false);
    axis("steer", 0, 0); axis("move", 0, 0);
  }
  function flush() {
    const batch = [...D.queue, ...Object.values(D.axes)];
    D.queue = []; D.axes = {};
    for (const a of D.release) D.queue.push({ type: "input", player: me, action: a, down: false });
    D.release = [];
    if (batch.length) post("/input", batch);
  }
  const can = (verb) => !!(D.myEntity && D.myEntity.verbs.includes(verb));

  // Point the ship (or the explorer) at a target with the steer stick; returns the remaining angle error.
  function aim(target) {
    const p = D.me;
    const v = { x: target.x - p.x, y: (target.y || 0) - p.y, z: target.z - p.z };
    const yawErr = wrap(Math.atan2(-v.x, -v.z) - p.yaw);
    const pitchErr = p.mode === "space" ? Math.atan2(v.y, Math.hypot(v.x, v.z)) - p.pitch : 0;
    axis("steer", -yawErr * 3, pitchErr * 3);
    return Math.hypot(yawErr, pitchErr);
  }

  // A full redraw of the ship / explorer: Astra reads its parts (the mock answers the dev kit).
  function drawEntity(name, g) {
    const kind = ENTITY_OF[name], sent = now();
    return post("/generate", { player: me, kind, image: pngDataUrl(`${name}-${sent}`, 128, 96), source: "draw", speculative: false, requestId: `e2e-${name}-${sent}` }).then((r) => {
      const ms = now() - sent;
      const ok = !!(r.json && r.json.ok && r.json.entity);
      const verbs = ok ? r.json.entity.verbs : [];
      D.generates.push({ gate: name, ok, ms, status: r.status, actions: verbs, error: r.json && r.json.error, drawingsLeft: r.json && r.json.drawingsLeft, source: ok ? r.json.entity.source : null });
      if (!ok) D.issues.push(`POST /generate ${kind} failed: ${r.status} ${r.json && r.json.error}`);
      if (g) { g.state = "done"; stage(`drew-${name}`, { ms, verbs: verbs.join(" ") }); }
    });
  }

  // The gates. expert: draws each one as soon as the route needs it (while flying); regular: waits at the gate for a
  // hint toast, then spends drawSeconds drawing it.
  function gate(name, here) {
    const g = (D.gates[name] = D.gates[name] || { state: "idle" });
    const t = now();
    if (g.state === "idle") {
      if (expert) { g.state = "drawing"; g.from = t; }
      // A hint seen earlier counts too (the ladder keeps running while walking between chests; a player remembers).
      else if (here) { g.state = "waiting"; g.armedAt = t; g.toastsBefore = 0; }
    }
    if (g.state === "waiting") {
      const [hg, need] = GATE_HINT[name];
      const hint = D.toasts.slice(g.toastsBefore).find((x) => x.kind === "hint" && x.need === need && (!hg || x.gate === hg) && (hg || ["dig", "drill"].includes(x.gate)));
      if (hint) { g.state = "drawing"; g.from = t; g.hint = hint; stage(`hint-${name}`, { text: hint.text || "", sketch: hint.sketch || null }); }
      else if (t - g.armedAt > 40000) { g.state = "drawing"; g.from = t; D.issues.push(`no hint toast for ${name} within 40 s at the gate`); }
    }
    if (g.state === "drawing" && t - g.from >= drawSeconds * 1000) {
      g.state = "requested";
      if (ENTITY_OF[name]) drawEntity(name, g);
      else {
        const ghost = (D.toasts.slice().reverse().find((x) => x.ghost && x.ghost.action === name) || {}).ghost;
        const region = ghost ? { x: ghost.x, y: ghost.y, w: ghost.w, h: ghost.h } : GATE_REGION[name];
        const sent = now();
        // expect: the word the player wrote in the box (the real model reads it from the drawing; the mock cannot, so
        // the driver says it, as the phone does for a ghost box).
        post("/generate", { player: me, kind: "button", image: pngDataUrl(name.toUpperCase()), region, expect: name, source: "draw", speculative: false, requestId: `e2e-${name}-${sent}` }).then((r) => {
          const ms = now() - sent;
          const ok = !!(r.json && r.json.ok);
          const actions = ok ? r.json.layout.buttons.map((b) => b.action) : [];
          D.generates.push({ gate: name, ok, ms, status: r.status, actions, error: r.json && r.json.error, drawingsLeft: r.json && r.json.drawingsLeft });
          if (!ok) D.issues.push(`POST /generate button for ${name} failed: ${r.status} ${r.json && r.json.error}`);
          else if (!actions.includes(name)) D.issues.push(`/generate button for ${name} returned ${actions.join(",")}; inputs still sent`);
          g.state = "done";
          stage(`button-${name}`, { ms, actions });
        });
      }
    }
    return g.state === "done";
  }

  function think() {
    const p = D.me, w = D.world, ph = D.tick.phase;
    if (!p || !w || (ph !== "playing" && ph !== "assists")) return;
    if (p.flags.dead) { if (!D.wasDead) { D.deaths++; log(`died (${D.deaths})`); } D.wasDead = true; releaseAll(); return; }
    D.wasDead = false;
    if (p.flags.landing || p.flags.takingOff) { releaseAll(); return; }
    const boss = (w.targets || []).find((x) => x.kind === "boss");

    if (p.mode === "space" && boss && !boss.dead) {
      key("shoot", false);
      if (w.nebula && dist(p, w.nebula) < w.nebula.radius) {
        stage("nebula");
        if (can("flare") && !D.pressedAt.flare) { press("flare"); stage("flare"); }
        else if (can("scan") && D.pressedAt.flare && !D.pressedAt.scan && now() - D.pressedAt.flare > 1000) { press("scan"); stage("scan"); }
      }
      const d = dist(p, boss) - boss.radius;
      if (d < 60) stage("boss");
      const err = aim(boss);
      key("boost", can("boost") && expert && d > 120 && err < 0.3);
      key("forward", d > 55);
      key("back", d < 40);
      // No armour any more: any weapon hurts it. A plain ship has none: draw one (the part hint for regular).
      const armed = gate("ship", d < 150);
      key("shoot", armed && can("shoot") && err < 0.06 && d < 150);
      key("shield", can("shield") && p.hp < 40);
      if (armed && D.held.shoot) stage("shooting");
    } else if (p.mode === "space") {
      stage("bossDown");
      key("shoot", false); key("shield", false); key("drill", false);
      const planet = w.planet;
      if (!planet) { releaseAll(); return; }
      const d = dist(p, planet), within = planet.radius + planet.landRange;
      const err = aim(planet);
      // v1.6 (owner 12:07): fly straight into the planet; touching it lands (world.js AUTO_LAND_MARGIN). No LAND press.
      key("boost", can("boost") && expert && d > within + 40 && err < 0.3);
      key("forward", err < 0.5);
      key("back", false);
      if (d < within) stage("planet");
      if (d < within && !D.flewIn) { D.flewIn = true; stage("land-pressed"); } // the stage name the e2e reports know
    } else {
      stage("landed");
      for (const k of ["forward", "back", "shoot", "shield"]) key(k, false);
      const chests = (w.chests || []).filter((c) => !c.open);
      if (!chests.length) { releaseAll(); return; }
      // The nearest chest, skipping one that took 30 s without opening (try it again 20 s later).
      const t = now(), avoid = (D.avoid = D.avoid || {});
      const pool = chests.filter((c) => !(avoid[c.id] > t));
      const chest = (pool.length ? pool : chests).slice().sort((a, b) => dist2(a, p) - dist2(b, p))[0];
      const dd = dist2(chest, p);
      const near = dd <= 1.5;
      // Follow a planned path around the lagoons; replan when the target changes or after 2 s without progress.
      let W = D.walk;
      if (!W || W.id !== chest.id) W = D.walk = { id: chest.id, best: dd, bestAt: t, since: t, path: null };
      if (dd < W.best - 0.5) { W.best = dd; W.bestAt = t; }
      if (!near && (!W.path || t - W.bestAt > 2000)) {
        W.path = (w.island && planPath(w.island, p, chest)) || [{ x: chest.x, z: chest.z }];
        W.bestAt = t; W.best = dd; D.replans = (D.replans || 0) + 1;
      }
      while (W.path && W.path.length > 1 && dist2(W.path[0], p) < 2.5) W.path.shift();
      if (!near && t - W.since > 30000 && chests.length > 1) { avoid[chest.id] = t + 20000; D.walk = null; D.issues.push(`chest ${chest.id} not reached in 30 s: trying another`); }
      const goal = near || !W.path ? chest : W.path[0];
      const err = aim({ x: goal.x, y: 0, z: goal.z });
      axis("move", 0, !near && err < 0.5 ? 1 : 0);
      if (near) axis("steer", 0, 0);
      key("boost", can("boost") && expert && dd > 6);
      const here = dd < T.island.pickupRange + 2;
      if (here) stage("chest", { id: chest.id, kind: chest.kind });
      // The explorer first (the default one can't dig or drill), then the button for this chest's kind.
      const verb = chest.kind === "rock" ? "drill" : "dig";
      const tool = gate("explorer", here) && gate(verb, here);
      key("dig", near && chest.buried && verb === "dig" && tool);
      key("drill", near && chest.buried && verb === "drill" && tool);
      if (D.held.dig) stage("digging");
      if (D.held.drill) stage("drilling");
      if (!chest.buried) stage(`dug-${chest.kind}`, { id: chest.id });
    }
  }

  function onMessage(m) {
    if (m.type === "world") {
      D.world = m;
      if (Contract.CHECKS.world(m).length) D.invalid.world++;
      if (m.entities && m.entities[me]) D.myEntity = m.entities[me];
      const opened = (m.chests || []).filter((c) => c.open && c.by === me).length;
      if (opened > D.chestsOpened) { D.chestsOpened = opened; stage(`chest-${opened}`); }
      const boss = (m.targets || []).find((x) => x.kind === "boss");
      if (D.playingAt && boss && boss.dead) stage("bossDead", { hp: boss.maxHp });
      if (D.playingAt && !D.endedAt && m.result) {
        D.endedAt = now(); D.wonAt = D.endedAt; D.wonClock = D.tick && D.tick.clock;
        D.result = m.result; D.winner = m.result.winner; D.leaderboard = m.leaderboard;
        stage("ended", { reason: m.result.reason, winner: m.result.winner, top: m.result.scores.slice(0, 3) });
        releaseAll(); flush();
      }
    } else if (m.type === "entity") {
      if (Contract.cleanName(m.player) !== me) return;
      D.myEntity = m.entity;
      D.entities.push({ t: playT(), type: m.entity.type, verbs: m.entity.verbs, source: m.entity.source, assisted: m.entity.assisted || [] });
      log(`entity ${m.entity.type} [${m.entity.verbs.join(" ")}] (${m.entity.source})`);
    } else if (m.type === "tick") {
      D.tick = m; D.ticks++;
      if (Contract.CHECKS.tick(m).length) D.invalid.tick++;
      D.me = (m.players || []).find((p) => p.name === me) || null;
      if (m.phase !== D.lastPhase) { log(`phase ${m.phase} (clock ${m.clock})`); D.lastPhase = m.phase; }
      if ((m.phase === "playing" || m.phase === "assists") && !D.playingAt && !D.wonAt) { D.playingAt = now(); stage("playing"); }
      if (m.phase === "assists") stage("assists");
      if (!D.wonAt) { think(); flush(); }
    } else if (m.type === "toast") {
      if (Contract.cleanName(m.player) !== me) return;
      if (m.kind === "refused") D.refused++;
      D.toasts.push({ t: playT(), text: m.text || "", sketch: m.sketch || null, ghost: m.ghost || null, kind: m.kind || null, need: m.need || null, gate: m.gate || null });
      log(`toast "${m.text || ""}"${m.sketch ? ` sketch ${m.sketch}` : ""}${m.ghost ? ` ghost ${m.ghost.action}` : ""}`);
    } else if (m.type === "announce") {
      D.announces.push({ t: playT(), text: m.text, big: !!m.big });
    }
  }

  // expert: draws the ship and the explorer in the lobby (two of the space five) before the host presses START.
  async function lobbyDraws() {

    for (const k of ["ship"]) {
      D.gates[k] = { state: "requested" };
      const r = await post("/generate", { player: me, kind: k, image: pngDataUrl(`${k}-lobby`, 128, 96), source: "draw", speculative: false, requestId: `e2e-${k}-lobby` });
      D.generates.push({ gate: k, ok: !!(r.json && r.json.ok), ms: 0, status: r.status, actions: (r.json && r.json.entity && r.json.entity.verbs) || [], source: r.json && r.json.entity && r.json.entity.source });
      D.gates[k].state = "done";
    }
    log(`lobby: drew ship and explorer → ${D.generates.map((g) => `${g.gate} [${g.actions.join(" ")}]`).join(", ")}`);
  }

  return { D, onMessage, lobbyDraws };
}

// The route's verdict. expert: wins the round, opens a chest and the boss is down well before 3:00 (bossBy).
// regular: the round ends with at least one chest opened before the 4:00 cap.
export function judge(D, { route, me = "e2e", maxSeconds, bossBy = 150 }) {
  const clockOf = (name) => (D.stages[name] ? D.stages[name].clock : null);
  const bossDown = clockOf("bossDead") ?? clockOf("bossDown");
  const firstChest = clockOf("chest-1");
  const gates = {
    ended: !!D.endedAt && D.wonClock <= maxSeconds + 1,
    openedAChest: D.chestsOpened > 0 && firstChest != null && firstChest < maxSeconds,
    unlockedByDrawing: D.entities.some((e) => e.source === "devkit" && e.verbs.includes("shoot")),
    validMessages: D.invalid.world + D.invalid.tick === 0,
  };
  if (route === "expert") Object.assign(gates, { won: !!D.endedAt && D.winner === me, bossDownEarly: bossDown != null && bossDown <= bossBy });
  return { gates, bossDown, firstChest };
}
