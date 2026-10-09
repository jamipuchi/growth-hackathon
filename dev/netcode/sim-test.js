// Fast-forward tests of world.js, v1.1 rules (PLAN.md section 0): the START button, the 4:00 cap and the all-chests
// end, most points wins plus stars, unlockable skills (refusals, dev kit, redraws, assists), the boss (any weapon, HP
// scaling, shooting back), chest kinds and counts, planet movement per type, ruthless steals and wrecks, the hint ladder
// (parts, then buttons), and tick size with 25 players. v1.1 balance: bots count 0.25 (boss HP, chests), flight times
// (cruise ~60 s, full boost ~40 s), bots' fire discipline and revenge, human shots through bots, the +1000 for humans,
// wreck +150, dry chest walks and bays, the shore slide. The whole route with 24 bots: dev/netcode/balance-sim.mjs.
// Run: node dev/netcode/sim-test.js
const assert = require("assert");
const Contract = require("../../contract");
const Verbs = require("../../verbs");
const { createWorld, chestCount, bossHp, DEFAULT_LAYOUT } = require("../../world");

const { TUNING: T, SCORING, ROUND } = Contract;
const DT = 1 / Contract.SIM_HZ;

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A world plus the bookkeeping every test needs: all messages checked against Contract.CHECKS, ticks at 15 Hz.
function harness(seed, opts = {}) {
  const h = { msgs: [], checked: { world: 0, tick: 0 }, steps: 0, maxTick: 0 };
  h.w = createWorld({
    random: mulberry32(seed),
    ...opts,
    broadcast: (m) => {
      h.msgs.push({ at: h.steps, m });
      if (m.type === "world") { const e = Contract.CHECKS.world(m); assert.deepStrictEqual(e, [], "world message: " + e.join("; ")); h.checked.world++; }
    },
  });
  h.step = () => {
    h.w.step(DT); h.steps++;
    if (h.steps % (Contract.SIM_HZ / Contract.TICK_HZ) === 0) {
      const tick = h.w.tickMessage();
      const e = Contract.CHECKS.tick(tick);
      assert.deepStrictEqual(e, [], "tick message: " + e.join("; "));
      h.checked.tick++;
      h.maxTick = Math.max(h.maxTick, Buffer.byteLength(JSON.stringify(tick)));
      h.lastTick = tick;
    }
  };
  h.until = (label, cond, maxSeconds, each) => {
    for (let i = 0; i < maxSeconds * Contract.SIM_HZ; i++) {
      if (cond()) return;
      if (each) each();
      h.step();
    }
    const who = Object.values(h.w.players).filter((p) => !p.bot).map((p) => `${p.name} ${p.mode} at ${Math.round(p.pos.x)},${Math.round(p.pos.y)},${Math.round(p.pos.z)} hp ${Math.round(p.hp)}${p.dead ? " dead" : ""}`).join(", ");
    throw new Error(`timeout after ${maxSeconds} s: ${label} (phase ${h.w.phase}, clock ${h.w.tickMessage().clock}, boss hp ${h.dbg().boss.hp}, ${who})`);
  };
  h.wait = (seconds, each) => { for (let i = 0; i < seconds * Contract.SIM_HZ; i++) { if (each) each(); h.step(); } };
  h.clock = () => h.w.tickMessage().clock;
  h.dbg = () => h.w.debug();
  h.input = (player, action, down) => h.w.handleInput({ type: "input", player, action, down });
  h.axis = (player, axis, x, y) => h.w.handleInput({ type: "axis", player, axis, x, y });
  h.toasts = (player, from = 0) => h.msgs.filter((x) => x.at >= from && x.m.type === "toast" && x.m.player === player).map((x) => ({ ...x.m, at: x.at }));
  h.entities = (player, from = 0) => h.msgs.filter((x) => x.at >= from && x.m.type === "entity" && x.m.player === player).map((x) => x.m.entity);
  h.announces = (from = 0) => h.msgs.filter((x) => x.at >= from && x.m.type === "announce").map((x) => x.m.text);
  h.p = (name) => h.w.players[name];
  return h;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v) => Math.max(-1, Math.min(1, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// Point the ship (or the walker) at a target using the steer stick; returns the remaining angle error.
function aim(h, name, target) {
  const p = h.p(name);
  const v = { x: target.x - p.pos.x, y: target.y - p.pos.y, z: target.z - p.pos.z };
  const yawErr = wrap(Math.atan2(-v.x, -v.z) - p.yaw);
  const pitchErr = p.mode === "space" ? Math.atan2(v.y, Math.hypot(v.x, v.z)) - p.pitch : 0;
  h.axis(name, "steer", clamp(-yawErr * 3), clamp(pitchErr * 3));
  return Math.hypot(yawErr, pitchErr);
}

function flyTo(h, name, target, within, { boost = true, max = 150 } = {}) {
  h.until(`${name} reaches target`, () => dist(h.p(name).pos, target()) <= within, max, () => {
    const d = dist(h.p(name).pos, target());
    aim(h, name, target());
    h.input(name, "boost", boost && d > within + 60);
    h.input(name, "forward", d > within + 3);
    h.input(name, "back", d <= within + 3);
  });
  h.input(name, "boost", false); h.input(name, "forward", false);
}

function walkTo(h, name, target, within, run = true) {
  h.until(`${name} walks to target`, () => dist2(h.p(name).pos, target) <= within, 90, () => {
    const err = aim(h, name, { ...target, y: 0 });
    h.axis(name, "move", 0, err < 0.5 ? 1 : 0);
    h.input(name, "boost", !!run);
  });
  h.axis(name, "move", 0, 0); h.axis(name, "steer", 0, 0); h.input(name, "boost", false);
}

const devKit = (kind) => {
  const world = kind === "ship" ? "space" : "planet";
  return { type: kind === "ship" ? "ship" : "person", unlocked: Verbs.DEV_KIT[world], parts: [], source: "devkit" };
};
const LAYOUT = { buttons: [
  { type: "stick", action: "steer", label: "", x: 0.04, y: 0.4, w: 0.3, h: 0.55 },
  ...["shoot", "boost", "land", "dig", "drill"].map((a, i) => ({ type: "button", action: a, label: a.toUpperCase(), x: 0.4 + (i % 3) * 0.19, y: 0.4 + Math.floor(i / 3) * 0.3, w: 0.17, h: 0.25 })),
], source: "model" };

// Put a player on the island next to their parked ship: kill the boss, park the ship near the planet, LAND.
function killBoss(h, by) { const b = h.dbg().boss; b.hp = 1; h.w.handleInput({ type: "input", player: by, action: "noop", down: false }); hitBossVia(h, by); }
function hitBossVia(h, by) {
  // A drill pressed against the boss's surface: the cheapest way to land the last hit from a test.
  const p = h.p(by), b = h.dbg().boss;
  const drawn = p.drawn.space;
  h.w.setEntity(by, "ship", devKit("ship"));
  p.pos = { x: b.pos.x + b.radius + 3, y: b.pos.y, z: b.pos.z };
  h.input(by, "drill", true);
  h.until("boss dies", () => h.dbg().boss.dead, 5);
  h.input(by, "drill", false);
  if (drawn) h.w.setEntity(by, "ship", drawn);
}
function landNow(h, name) {
  const pl = h.dbg().planet, p = h.p(name);
  p.pos = { x: pl.x + pl.radius + 10, y: pl.y, z: pl.z };
  const had = p.entity.verbs.includes("land");
  if (!had) h.w.setEntity(name, "ship", devKit("ship"));
  h.input(name, "land", true); h.input(name, "land", false);
  h.until(`${name} lands`, () => p.mode === "planet" && !p.landingFor, 6);
}

const results = [];
function test(name, fn) {
  const t0 = Date.now();
  try { const info = fn(); results.push({ name, ok: true, ms: Date.now() - t0, info }); console.log(`PASS ${name} (${Date.now() - t0} ms) ${info || ""}`); }
  catch (err) { results.push({ name, ok: false }); console.log(`FAIL ${name}\n${err.stack}`); }
}

// ---- Round flow ------------------------------------------------------------------------------------------------------

test("lobby waits for START; autostart; START only from the lobby", () => {
  const h = harness(1);
  h.w.join("ana");
  h.input("ana", "ready", true);
  h.wait(90);
  assert.strictEqual(h.w.phase, "lobby", "no auto-start timer: still the lobby after 90 s and a ready");
  assert.strictEqual(h.clock(), 0);
  assert.strictEqual(h.w.start(), true);
  assert.strictEqual(h.w.phase, "playing");
  assert.strictEqual(h.w.start(), false, "START during play is a no-op");
  const a = harness(2, { autostartSeconds: 5 });
  a.w.join("ana");
  a.wait(4.9); assert.strictEqual(a.w.phase, "lobby");
  a.wait(0.2); assert.strictEqual(a.w.phase, "playing");
  return `lobby held 90 s; autostart after 5 s`;
});

test("4:00 cap, assists at 3:00, most points wins, stars, scoreboard 10 s → lobby keeps drawings", () => {
  const h = harness(3);
  h.w.join("ana"); h.w.join("bob");
  h.w.setEntity("ana", "ship", devKit("ship"));
  h.w.setLayout("ana", LAYOUT);
  h.w.start();
  const entFrom = h.steps;
  h.until("assists", () => h.w.phase === "assists", 181);
  const assistsAt = h.dbg().playT;
  assert(Math.abs(assistsAt - ROUND.assistsAt) < 0.1, `assists at ${assistsAt}`);
  const bobEnt = h.entities("bob", entFrom).pop();
  assert(bobEnt && bobEnt.verbs.includes("shoot") && bobEnt.verbs.includes("land"), "assists: bob's plain ship gets the gate skills");
  assert.deepStrictEqual(bobEnt.assisted, ["shoot", "land"]);
  assert.strictEqual(h.w.worldMessage().assists, true, "chests glow (world.assists)");
  h.until("3:59", () => h.dbg().playT >= ROUND.maxSeconds - 0.5, 60);
  h.p("ana").score = 300; h.p("bob").score = 120;
  h.until("time cap", () => h.w.phase === "scoreboard", 2);
  const endAt = h.dbg().playT;
  assert(Math.abs(endAt - ROUND.maxSeconds) < 0.1, `ended at ${endAt}`);
  const wm = h.w.worldMessage();
  assert.strictEqual(wm.result.winner, "ana"); assert.strictEqual(wm.result.reason, "time");
  assert.deepStrictEqual(wm.leaderboard[0], { name: "ana", stars: 1, total: 300 });
  assert.deepStrictEqual(wm.leaderboard[1], { name: "bob", stars: 0, total: 120 });
  h.wait(ROUND.scoreboardSeconds - 0.1); assert.strictEqual(h.w.phase, "scoreboard");
  h.wait(0.2); assert.strictEqual(h.w.phase, "lobby");
  assert.strictEqual(h.p("ana").entity.source, "devkit", "drawings kept into the next lobby");
  assert(h.p("ana").layout.buttons.some((b) => b.action === "dig"), "layout kept");
  assert(!h.p("bob").entity.verbs.includes("shoot"), "assists are gone in the next round");
  h.w.start();
  assert.strictEqual(h.p("ana").score, 0, "scores reset each round");
  assert.strictEqual(h.w.worldMessage().leaderboard[0].stars, 1, "stars persist for the session");
  return `assists ${assistsAt.toFixed(2)} s, end ${endAt.toFixed(2)} s, winner ana ★1`;
});

// ---- The whole route, solo, dev kit (as with ASTRA_MOCK=1) ----------------------------------------------------------

test("solo expert round: fly ~1 min, shoot the boss ~30 s, land, open all 3 chests → round ends early", () => {
  const h = harness(42);
  const me = "jaume";
  h.w.join(me);
  h.w.setEntity(me, "ship", devKit("ship"));
  h.w.setEntity(me, "explorer", devKit("explorer"));
  h.w.setLayout(me, LAYOUT);
  h.w.start();
  const boss = () => h.dbg().boss.pos;
  const spawnDist = dist(h.p(me).pos, boss());
  const cruise = spawnDist / T.cruiseSpeed;
  flyTo(h, me, boss, T.boss.radius + 60);
  const atBoss = h.dbg().playT;
  // Steady fire from 60 m (the boss shoots back: keep the shield for when hp is low).
  h.input(me, "shoot", true);
  h.until("boss dead", () => h.dbg().boss.dead, 90, () => {
    aim(h, me, boss());
    const p = h.p(me);
    h.input(me, "back", dist(p.pos, boss()) < T.boss.radius + 40);
    h.input(me, "forward", dist(p.pos, boss()) > T.boss.radius + 70);
    if (p.dead) h.input(me, "shoot", true);
  });
  h.input(me, "shoot", false);
  const bossDown = h.dbg().playT;
  const deaths = h.announces().filter((t) => t === `${me} was destroyed`).length;
  assert.strictEqual(h.p(me).score, SCORING.bossLastHit + deaths * SCORING.killed + h.dbg().rocks.length * 0, "last hit +1000, -50 per death");
  const pl = () => h.dbg().planet;
  flyTo(h, me, pl, T.planet.radius + T.planet.landRange - 5);
  h.input(me, "land", true); h.input(me, "land", false);
  h.until("landed", () => h.p(me).mode === "planet" && !h.p(me).landingFor, 6);
  const landed = h.dbg().playT;
  assert.strictEqual(h.p(me).entity.type, "person");
  for (const c of h.dbg().chests) {
    walkTo(h, me, c, 2);
    const verb = c.kind === "buried" ? "dig" : "drill";
    h.input(me, verb, true);
    h.until(`chest ${c.id} opened`, () => c.open, 10);
    h.input(me, verb, false);
  }
  const won = h.dbg().playT;
  assert.strictEqual(h.w.phase, "scoreboard");
  const wm = h.w.worldMessage();
  assert.strictEqual(wm.result.reason, "chests"); assert.strictEqual(wm.result.winner, me);
  assert.strictEqual(wm.chests.length, 3); assert.deepStrictEqual(wm.chests.map((c) => c.kind), ["buried", "rock", "buried"]);
  assert(h.maxTick < 8192);
  return `boss ${Math.round(spawnDist)} m (${cruise.toFixed(0)} s at cruise), reached ${fmt(atBoss)}, boss down ${fmt(bossDown)} (${(bossDown - atBoss).toFixed(1)} s of fire, ${bossHp(1)} hp), landed ${fmt(landed)}, all 3 chests ${fmt(won)}, score ${h.p(me).score}`;
});

// ---- Unlockable skills -----------------------------------------------------------------------------------------------

test("a plain entity only moves; refused verbs toast what to draw, at most once per 8 s per verb", () => {
  const h = harness(5);
  h.w.join("ana");
  h.w.start();
  const p = h.p("ana");
  assert.deepStrictEqual(p.entity.verbs, [], "plain ship: no skills");
  assert.strictEqual(p.entity.source, "plain");
  const from = h.steps;
  h.input("ana", "shoot", true); h.wait(1);
  assert.strictEqual(h.dbg().bullets.length, 0, "no bullets from a plain ship");
  h.input("ana", "shoot", false); h.input("ana", "shoot", true); h.input("ana", "boost", true);
  let t = h.toasts("ana", from).filter((x) => x.kind === "refused");
  assert.deepStrictEqual(t.map((x) => x.text), ["SHOOT · draw a gun, cannon or laser on your ship", "BOOST · draw an exhaust with fire on your ship"]);
  h.wait(T.refusalToastSeconds);
  h.input("ana", "shoot", true);
  t = h.toasts("ana", from).filter((x) => x.kind === "refused");
  assert.strictEqual(t.length, 3, "again after 8 s");
  // Moving still works.
  const z0 = { ...p.pos }; h.input("ana", "forward", true); h.wait(1);
  assert(dist(z0, p.pos) > 20, "flies");
  // Plain explorer: walks and jumps, cannot dig.
  killBoss(h, "bob");
  landNow(h, "ana");
  assert.deepStrictEqual(p.entity.verbs, ["jump", "takeoff"]);
  const f2 = h.steps;
  h.input("ana", "dig", true);
  assert.strictEqual(h.toasts("ana", f2)[0].text, "DIG · draw a shovel or claws on your explorer");
  h.input("ana", "jump", true); h.input("ana", "jump", false); h.wait(0.1);
  assert(p.vy > 0, "jumps");
  return `${t.length} refusal toasts in ${T.refusalToastSeconds} s for 2 verbs`;
});

test("full redraws replace the entity; land needs legs, dig a shovel, drill a drill", () => {
  const h = harness(6);
  h.w.join("ana");
  h.w.start();
  const from = h.steps;
  h.w.setEntity("ana", "ship", { type: "ship", unlocked: [{ verb: "shoot", part: "cannon" }, { verb: "land", part: "legs" }], parts: [{ name: "cannon", x: 0.5, y: 0.5 }], source: "model" });
  let e = h.entities("ana", from).pop();
  assert.deepStrictEqual(e.verbs, ["shoot", "land"]);
  assert.deepStrictEqual(e.unlocked, [{ verb: "shoot", part: "cannon" }, { verb: "land", part: "legs" }]);
  h.w.setEntity("ana", "ship", { type: "ship", unlocked: [{ verb: "boost", part: "flames" }, { verb: "dig", part: "shovel" }], parts: [], source: "model" });
  e = h.entities("ana", from).pop();
  assert.deepStrictEqual(e.verbs, ["boost"], "a redraw replaces (no shoot any more); planet skills never stick to a ship");
  h.w.setEntity("ana", "explorer", { type: "car", unlocked: [{ verb: "drill", part: "drill" }, { verb: "jump", part: "springs" }], parts: [], source: "model" });
  assert.strictEqual(h.p("ana").entity.type, "ship", "an explorer drawn in space waits for the landing");
  killBoss(h, "bob");
  landNow(h, "ana");
  e = h.p("ana").entity;
  assert.strictEqual(e.type, "car"); assert.strictEqual(e.rig, "car");
  assert.deepStrictEqual(e.verbs, ["drill", "drive", "takeoff"], "cars can't jump even with springs");
  return `entity verbs: ship [shoot land] → [boost]; car [${e.verbs.join(" ")}]`;
});

// ---- Boss --------------------------------------------------------------------------------------------------------------

test("boss: any weapon hurts it, HP scales with players, it shoots back", () => {
  assert.strictEqual(bossHp(1), 2400); assert.strictEqual(bossHp(25), 31200);
  const h = harness(7);
  h.w.join("ana");
  h.w.start();
  const b = h.dbg().boss;
  assert.strictEqual(h.w.worldMessage().targets[0].armour, 0);
  h.w.setEntity("ana", "ship", { type: "ship", unlocked: [{ verb: "shoot", part: "gun" }, { verb: "shield", part: "bubble" }], parts: [], source: "model" });
  const p = h.p("ana");
  p.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z + b.radius + 50 }; p.yaw = 0; p.pitch = 0;
  const hp0 = b.hp;
  h.input("ana", "shoot", true);
  h.wait(1, () => { aim(h, "ana", b.pos); h.input("ana", "back", true); });
  const dps = hp0 - b.hp;
  assert(dps > 60, `bullets hurt the boss with no drill (${dps} in 1 s)`);
  const hp1 = p.hp;
  h.input("ana", "shoot", false);
  h.wait(3, () => { aim(h, "ana", b.pos); h.input("ana", "back", true); });
  assert(p.hp < hp1 || p.dead, "the boss shot back");
  // 25 humans at START: 13× the HP.
  const big = harness(8);
  for (let i = 1; i <= 25; i++) big.w.join(`p${i}`);
  big.w.start();
  assert.strictEqual(big.dbg().boss.maxHp, 31200); assert.strictEqual(big.w.worldMessage().playerCount, 25);
  return `${dps.toFixed(0)} dps from one gun → solo ${(2400 / dps).toFixed(0)} s of steady fire; 25 players ${(31200 / dps / 25).toFixed(0)} s all firing`;
});

test("bigger space: boss ~1100 m, planet 600 m beyond, rocks dense around the boss, 25 spawn slots", () => {
  const h = harness(9);
  h.w.join("ana"); for (let i = 1; i <= 24; i++) h.w.addBot(`bot${i}`);
  h.w.start();
  const d = h.dbg();
  const bossD = Math.hypot(d.boss.pos.x, d.boss.pos.y, d.boss.pos.z);
  h.until("planet", () => true, 1);
  const planetAt = d.boss.pos; // planet appears on death; check via killing
  killBoss(h, "ana");
  const pl = h.dbg().planet;
  const beyond = dist(pl, d.boss.pos), planetD = Math.hypot(pl.x, pl.y, pl.z);
  assert(Math.abs(bossD - 1100) < 2 && Math.abs(beyond - 600) < 2 && planetD > bossD + 500, `boss ${bossD}, beyond ${beyond}`);
  const near = d.rocks.filter((r) => dist(r.pos, planetAt) < 360).length;
  const nearVol = (4 / 3) * Math.PI * 360 ** 3, allVol = (4 / 3) * Math.PI * T.worldRadius ** 3;
  const density = (near / nearVol) / ((d.rocks.length - near) / (allVol - nearVol));
  assert(density > 20, `rocks ${density.toFixed(0)}× denser near the boss`);
  const spawns = Object.values(h.w.players).map((p) => `${p.pos.x},${p.pos.y},${p.pos.z}`);
  return `boss ${bossD.toFixed(0)} m, planet ${beyond.toFixed(0)} m beyond, ${d.rocks.length} rocks, ${near} within 360 m of the boss (${density.toFixed(0)}× denser), ${new Set(spawns).size} distinct spawns`;
});

// ---- Planet --------------------------------------------------------------------------------------------------------

test("chests: two kinds, count scales with players, each a dry straight walk from the pad", () => {
  assert.deepStrictEqual([1, 2, 5, 7, 10, 25, 40].map(chestCount), [3, 4, 6, 7, 9, 20, 20]);
  const h = harness(10);
  for (let i = 1; i <= 25; i++) h.w.join(`p${i}`);
  h.w.start();
  const cs = h.w.worldMessage().chests;
  assert.strictEqual(cs.length, 20);
  assert.strictEqual(cs.filter((c) => c.kind === "rock").length, 10);
  const L = h.dbg().landing;
  const far = Math.max(...cs.map((c) => Math.hypot(c.x - L.x, c.z - L.z)));
  // No lagoon between the pad and any chest, over many islands.
  const Terrain = require("../../terrain");
  let checked = 0;
  for (let seed = 100; seed < 130; seed++) {
    const w = harness(seed); w.w.join("ana"); for (let i = 1; i <= 24; i++) w.w.addBot(`bot${i}`); w.w.start();
    const d = w.dbg();
    for (const c of d.chests) {
      const n = Math.ceil(Math.hypot(c.x - d.landing.x, c.z - d.landing.z) / 2);
      for (let i = 0; i <= n; i++) {
        const x = d.landing.x + ((c.x - d.landing.x) * i) / n, z = d.landing.z + ((c.z - d.landing.z) * i) / n;
        assert(Terrain.height(x, z, d.island.seed) > 0.3, `seed ${seed}: chest ${c.id} has water on the way from the pad`);
      }
      checked++;
    }
    for (let i = 0; i < 25; i++) {
      const bx = d.landing.x + (i % 5) * 5 - 10, bz = d.landing.z + Math.floor(i / 5) * 5;
      for (const x of [bx, bx + 2.5]) assert(Terrain.height(x, bz, d.island.seed) > 0.3, `seed ${seed}: bay ${i} in the water`);
    }
  }
  return `25 players → ${cs.length} chests (10 buried, 10 in rocks), farthest ${far.toFixed(0)} m from the pad; ${checked} chests on 30 islands all a dry walk from the pad, all 25 bays dry`;
});

// ---- Balance with bots (PLAN.md section 0; orchestrator decisions for v1.1) -----------------------------------------

test("bots are fillers: boss HP and chests scale with humans + 0.25 × bots", () => {
  const counts = [];
  for (const [humans, bots, hp, nChests] of [[1, 24, 9600, 7], [3, 22, 11400, 8], [25, 0, 31200, 20], [1, 0, 2400, 3]]) {
    const h = harness(20 + humans);
    for (let i = 1; i <= humans; i++) h.w.join(`p${i}`);
    for (let i = 1; i <= bots; i++) h.w.addBot(`bot${i}`);
    h.w.start();
    const wm = h.w.worldMessage();
    assert.strictEqual(wm.playerCount, humans + bots * T.botWeight, `${humans}+${bots} counted`);
    assert.strictEqual(h.dbg().boss.maxHp, hp, `${humans}+${bots} boss hp`);
    assert.strictEqual(wm.chests.length, nChests, `${humans}+${bots} chests`);
    counts.push(`${humans}+${bots} bots → ${wm.playerCount}: ${hp} hp, ${nChests} chests`);
  }
  // A human who types a bot's name never takes over that bot.
  const h = harness(29);
  h.w.addBot("bot3");
  const j = h.w.join("Bot 3");
  assert.deepStrictEqual([j.player, h.p("bot3").bot, h.p(j.player).bot], ["bot3b", true, false]);
  assert.strictEqual(h.w.join("bot3").player, "bot3b", "a rejoin finds the same human");
  return counts.join("; ") + `; "Bot 3" joins as ${j.player}`;
});

test("speed: cruise ~60 s to the boss, a full-boost run ~40 s, the planet ~30 s further at cruise", () => {
  const T0 = (opts) => {
    const h = harness(31);
    h.w.join("ana"); h.w.setEntity("ana", "ship", devKit("ship"));
    h.w.start();
    const b = h.dbg().boss, p = h.p("ana");
    p.pos = { x: 0, y: b.pos.y, z: 0 }; p.yaw = Math.atan2(-b.pos.x, -b.pos.z); p.pitch = 0;
    h.dbg().rocks.length = 0; // a clear line: rocks only add stuns
    if (opts.boost) h.input("ana", "boost", true);
    if (opts.forward) h.input("ana", "forward", true);
    const t0 = h.dbg().playT;
    h.until("at the boss", () => dist(p.pos, b.pos) - b.radius <= 0.5 + T.boss.radius * 0 + 1, 120, () => { aim(h, "ana", b.pos); p.spawnShield = 1; p.hp = 100; });
    return h.dbg().playT - t0;
  };
  const cruise = T0({}), boost = T0({ boost: true }), full = T0({ boost: true, forward: true });
  const planetCruise = (T.planet.offset - T.planet.radius - T.planet.landRange) / T.cruiseSpeed;
  assert(cruise > 55 && cruise < 65, `cruise ${cruise}`);
  assert(boost > 38 && boost < 48, `boost only ${boost}`);
  assert(full > 34 && full < 45, `forward + boost ${full}`);
  assert(planetCruise > 25 && planetCruise < 35, `planet ${planetCruise}`);
  return `to the boss: cruise ${cruise.toFixed(1)} s, holding BOOST ${boost.toFixed(1)} s, FORWARD + BOOST ${full.toFixed(1)} s; boss → landing range at cruise ${planetCruise.toFixed(1)} s`;
});

test("bots never start a fight: their bullets pass through humans and bots; they shoot back for 10 s at a human who hit them", () => {
  const h = harness(32);
  h.w.join("ana"); h.w.setEntity("ana", "ship", devKit("ship"));
  h.w.addBot("bot1"); h.w.addBot("bot2");
  h.w.start();
  const ana = h.p("ana"), b1 = h.p("bot1"), b2 = h.p("bot2");
  const far = { x: -600, y: 0, z: 0 }; // well away from the boss and its shots
  const place = () => {
    for (const p of [ana, b1, b2]) { p.spawnShield = 0; p.dead = false; }
    ana.pos = { ...far }; b1.pos = { x: far.x, y: far.y, z: far.z + 40 }; b2.pos = { x: far.x + 40, y: far.y, z: far.z };
  };
  const shot = (owner, from, to) => {
    const dir = { x: to.pos.x - from.pos.x, y: to.pos.y - from.pos.y, z: to.pos.z - from.pos.z };
    const l = Math.hypot(dir.x, dir.y, dir.z);
    h.dbg().bullets.push({ id: 1e6 + h.steps, mode: "space", pos: { x: from.pos.x + dir.x / l * 3, y: from.pos.y + dir.y / l * 3, z: from.pos.z + dir.z / l * 3 }, dir: { x: dir.x / l, y: dir.y / l, z: dir.z / l }, owner, color: 0, life: 1, damage: 12 });
    const hp0 = to.hp;
    for (let i = 0; i < 12; i++) { place(); h.step(); }
    return hp0 - to.hp;
  };
  for (const p of [ana, b1, b2]) p.hp = 100;
  assert.strictEqual(shot("bot1", b1, ana), 0, "a bot's bullet passes through a human it has no grudge against");
  assert.strictEqual(shot("bot1", b1, b2), 0, "and through another bot");
  assert.strictEqual(shot("ana", ana, b1), 12, "a human's bullet hurts a bot");
  assert.strictEqual(shot("bot1", b1, ana), 12, "the bot that was hit can hurt that human");
  assert.strictEqual(shot("bot2", b2, ana), 0, "a bot that was not hit still cannot");
  // Revenge: bot1 turns on ana and shoots her within a few seconds (she sits still 70 m away).
  ana.hp = 100; b1.hp = 100;
  shot("ana", ana, b1);
  b1.pos = { x: far.x, y: far.y, z: far.z + 70 }; b1.yaw = 0; // facing away (-z is its nose... it must turn)
  let back = null;
  for (let i = 0; i < 6 * Contract.SIM_HZ && back === null; i++) { ana.pos = { ...far }; ana.spawnShield = 0; h.step(); if (ana.hp < 100) back = i / Contract.SIM_HZ; }
  assert(back !== null, "bot1 shot back within 6 s");
  // 10 s after the last hit the grudge is over.
  for (let i = 0; i < 10.5 * Contract.SIM_HZ; i++) { place(); ana.hp = 100; h.step(); }
  assert.strictEqual(shot("bot1", b1, ana), 0, "grudge over after 10 s");
  // Killing a bot pays nothing (no farming the fillers); the bot still pays its -50.
  const s0 = ana.score, b2s = b2.score;
  b2.hp = 5; b2.spawnShield = 0;
  h.dbg().bullets.push({ id: 2e6, mode: "space", pos: { x: b2.pos.x - 6, y: b2.pos.y, z: b2.pos.z }, dir: { x: 1, y: 0, z: 0 }, owner: "ana", color: 0, life: 1, damage: 12 });
  h.until("b2 dies", () => b2.dead, 1, () => { ana.pos = { ...far }; b2.pos = { x: far.x + 40, y: far.y, z: far.z }; });
  assert.strictEqual(ana.score, s0, "no kill points for a bot"); assert.strictEqual(b2.score, b2s + SCORING.killed);
  assert(h.announces().includes("ana ✕ bot2"), "still in the kill feed");
  return `pass-through ok; bot1 shot back after ${back.toFixed(1)} s; grudge ends after ${10} s; a bot kill pays 0`;
});

test("bots fly to the boss and shoot it whenever it is in range and in front; they never land", () => {
  const h = harness(33);
  h.w.join("ana");
  for (let i = 1; i <= 24; i++) h.w.addBot(`bot${i}`);
  h.w.start();
  const b = h.dbg().boss;
  let firstHit = null;
  h.until("bots kill the boss", () => b.dead, 200, () => { const p = h.p("ana"); p.pos = { x: -300, y: 0, z: 0 }; p.spawnShield = 1; if (firstHit === null && b.hp < b.maxHp) firstHit = h.dbg().playT; });
  const by = Object.entries(b.damageBy);
  const killedAt = h.dbg().playT;
  assert(by.length >= 20, `${by.length} bots damaged the boss`);
  assert(by.every(([n]) => n.startsWith("bot")));
  h.wait(60, () => { const p = h.p("ana"); p.pos = { x: -300, y: 0, z: 0 }; p.spawnShield = 1; });
  assert(Object.values(h.w.players).filter((p) => p.bot).every((p) => p.mode === "space"), "no bot landed");
  assert.strictEqual(h.dbg().chests.filter((c) => c.open).length, 0, "no bot opened a chest");
  const ana = h.p("ana");
  assert.strictEqual(ana.score, 0, "an idle human was never shot by bots (no -50)");
  assert(Object.values(h.w.players).every((p) => p.score < SCORING.bossLastHit), "no human hurt the boss: nobody gets the +1000 (bots never do)");
  return `first bot hit at ${fmt(firstHit)}, 24 bots alone killed the ${b.maxHp} hp boss at ${fmt(killedAt)} (${by.length} bots dealt damage), none landed`;
});

test("a human's shots at the boss fly through the bots in the way; a bot's final blow pays the top human +1000", () => {
  const h = harness(34);
  h.w.join("ana"); h.w.setEntity("ana", "ship", devKit("ship"));
  h.w.join("cy"); h.w.setEntity("cy", "ship", devKit("ship"));
  h.w.addBot("bot1");
  h.w.start();
  const b = h.dbg().boss, ana = h.p("ana"), bot = h.p("bot1"), cy = h.p("cy");
  const hold = () => {
    ana.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z + b.radius + 90 }; ana.yaw = 0; ana.pitch = 0; ana.spawnShield = 0; ana.hp = 100;
    bot.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z + b.radius + 45 }; bot.spawnShield = 0; bot.hp = 100;
    cy.pos = { x: 600, y: 0, z: 600 };
  };
  const hp0 = b.hp;
  h.input("ana", "shoot", true);
  let botHurt = 0;
  h.wait(2, () => { hold(); botHurt = Math.max(botHurt, 100 - bot.hp); });
  h.input("ana", "shoot", false);
  assert(hp0 - b.hp > 100, `the boss took ${hp0 - b.hp}`);
  assert.strictEqual(botHurt, 0, "the bot in the way was not hit");
  assert.deepStrictEqual(Object.keys(bot.hitBy), [], "so it holds no grudge");
  // Aimed at the bot itself (the boss not behind it), the shot hurts it.
  ana.yaw = Math.PI / 2;
  const hit = () => { ana.pos = { x: 300, y: 0, z: 0 }; ana.yaw = Math.PI / 2; ana.pitch = 0; bot.pos = { x: 260, y: 0, z: 0 }; bot.spawnShield = 0; };
  hit(); h.input("ana", "shoot", true); h.wait(0.5, hit); h.input("ana", "shoot", false);
  assert(bot.hp < 100 && bot.hitBy.ana != null, "a deliberate shot hurts the bot and starts its grudge");
  // The bot lands the final blow: ana (the human with the most damage) takes the +1000, not the bot.
  const a0 = ana.score;
  b.damageBy.cy = 10; b.hp = 1;
  const f = h.steps;
  bot.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z + b.radius + 30 };
  h.until("the bot finishes the boss", () => b.dead, 20, () => { bot.hitBy = {}; ana.pos = { x: 500, y: 0, z: 500 }; cy.pos = { x: 600, y: 0, z: 600 }; });
  assert.strictEqual(b.damageBy.bot1 > 0, true);
  assert.strictEqual(ana.score - a0, SCORING.bossLastHit, "+1000 to the top human");
  assert(bot.score < SCORING.bossLastHit, "never to the bot");
  const text = h.announces(f).find((t) => t.startsWith("💥"));
  assert.strictEqual(text, `💥 The swarm brought the boss down! ana did the most damage: +${SCORING.bossLastHit}. ${Contract.OBJECTIVES.planet}`);
  return `2 s of fire through a bot in the way: boss -${Math.round(hp0 - 1)}+ hp, bot unhurt, no grudge; ${text}`;
});

test("walkers slide along the shore (most head-on walks into the sea keep moving) and never end up in the water", () => {
  const Terrain = require("../../terrain");
  let tried = 0, slid = 0, wet = 0, total = 0;
  for (const seed of [41, 42, 43]) {
    const h = harness(seed);
    h.w.join("ana"); h.w.setEntity("ana", "explorer", devKit("explorer"));
    h.w.start();
    killBoss(h, "bob");
    landNow(h, "ana");
    const p = h.p("ana"), isl = h.dbg().island;
    const dryAt = (x, z) => Terrain.height(x, z, isl.seed) > 0.3 && Math.hypot(x, z) < isl.size / 2 - 5;
    // Shore points: march out from the pad along 60 rays to the first water; stand 1 m inside it and walk straight at
    // the sea (up to 30° off the ray) for 2 s.
    const L = h.dbg().landing;
    for (let i = 0; i < 60; i++) {
      const ang = (i / 60) * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang);
      let r = 0;
      while (r < 220 && dryAt(L.x + dx * r, L.z + dz * r)) r += 0.5;
      if (r >= 220 || r < 3) continue;
      const x = L.x + dx * (r - 1), z = L.z + dz * (r - 1);
      const yaw = Math.atan2(-dx, -dz) + ((i % 7) - 3) * 0.17;
      tried++;
      p.pos = { x, y: Terrain.height(x, z, isl.seed), z }; p.yaw = yaw; p.vy = 0; p.dead = false;
      h.axis("ana", "move", 0, 1);
      h.wait(2, () => { total++; if (!dryAt(p.pos.x, p.pos.z)) wet++; });
      h.axis("ana", "move", 0, 0);
      if (Math.hypot(p.pos.x - x, p.pos.z - z) > 2) slid++;
    }
  }
  assert.strictEqual(wet, 0, "never on the water");
  // The old axis-only slide kept 27% of these walks moving (measured on 20 islands); the shore slide keeps 83%. The rest
  // end in a corner of the coastline, where stopping is fair.
  assert(tried > 100 && slid / tried > 0.75, `slid ${slid}/${tried}`);
  return `${slid}/${tried} head-on walks into the sea slid along the shore (> 2 m in 2 s), 0 of ${total} steps on the water`;
});

test("25 explorers open all 20 chests in about a minute after landing", () => {
  const h = harness(11);
  const names = Array.from({ length: 25 }, (_, i) => `p${i + 1}`);
  for (const n of names) { h.w.join(n); h.w.setEntity(n, "ship", devKit("ship")); h.w.setEntity(n, "explorer", devKit("explorer")); h.w.setLayout(n, LAYOUT); }
  h.w.start();
  killBoss(h, "p1");
  for (const n of names) landNow(h, n);
  const t0 = h.dbg().playT;
  const chests = h.dbg().chests;
  // Each one heads to the nearest chest still closed (or open but not collected) and works it.
  h.until("all chests open", () => h.w.phase === "scoreboard", 120, () => {
    for (const n of names) {
      const p = h.p(n);
      const left = chests.filter((c) => !c.open);
      if (!left.length) return;
      const c = left.reduce((a, b) => (dist2(a, p.pos) < dist2(b, p.pos) ? a : b));
      const d = dist2(c, p.pos);
      const err = aim(h, n, { ...c, y: 0 });
      h.axis(n, "move", 0, d > 1.5 && err < 0.6 ? 1 : 0);
      h.input(n, "boost", true);
      h.input(n, "dig", d < 2.5 && c.kind === "buried");
      h.input(n, "drill", d < 2.5 && c.kind === "rock");
    }
  });
  const took = h.dbg().playT - t0;
  assert(took < 90, `took ${took}`);
  assert.strictEqual(h.w.worldMessage().result.reason, "chests");
  return `20 chests in ${took.toFixed(1)} s from touchdown (scripted, no fighting)`;
});

test("planet movement per type: person walks, car/bike fast and no jump, quadruped runs, blob bounces", () => {
  const out = {};
  for (const type of ["person", "car", "bike", "quadruped", "blob"]) {
    const h = harness(12);
    h.w.join("ana");
    h.w.setEntity("ana", "explorer", { type, unlocked: [], parts: [], source: "model" });
    h.w.start();
    killBoss(h, "bob");
    landNow(h, "ana");
    const p = h.p("ana");
    const L = h.dbg().landing;
    p.pos = { x: L.x, y: p.pos.y, z: L.z };
    const x0 = { ...p.pos };
    let maxVy = 0;
    h.axis("ana", "move", 0, 1);
    h.wait(1, () => { maxVy = Math.max(maxVy, p.vy); });
    h.axis("ana", "move", 0, 0);
    const moved = dist2(x0, p.pos);
    h.wait(1);
    h.input("ana", "jump", true); h.input("ana", "jump", false); h.wait(0.05);
    out[type] = { moved: +moved.toFixed(1), jumped: p.vy > 1, bounced: maxVy > 1 };
  }
  assert(out.car.moved > out.person.moved * 1.8 && out.bike.moved > out.person.moved * 1.6, JSON.stringify(out));
  assert(out.quadruped.moved > out.person.moved * 1.3);
  assert(out.person.jumped && out.quadruped.jumped && !out.car.jumped && !out.bike.jumped);
  assert(out.blob.bounced && !out.person.bounced);
  return Object.entries(out).map(([k, v]) => `${k} ${v.moved} m/s${v.jumped ? " jump" : ""}${v.bounced ? " bounce" : ""}`).join(", ");
});

// ---- Scoring and ruthless rules ----------------------------------------------------------------------------------------

test("scoring: chest +1500, boss last hit +1000 (stealable), kill +200, killed -50, steal half a chest within 15 s", () => {
  assert.strictEqual(SCORING.chest, 1500); assert.strictEqual(SCORING.bossLastHit, 1000); assert.strictEqual(SCORING.kill, 200); assert.strictEqual(SCORING.killed, -50);
  const h = harness(13);
  for (const n of ["ana", "bob", "cy"]) { h.w.join(n); h.w.setEntity(n, "ship", devKit("ship")); h.w.setEntity(n, "explorer", devKit("explorer")); }
  h.w.start();
  // Bob does most of the damage, Cy steals the last hit.
  const b = h.dbg().boss;
  b.damageBy.bob = 2900; b.hp = 1;
  const from = h.steps;
  hitBossVia(h, "cy");
  assert.strictEqual(h.p("cy").score, SCORING.bossLastHit);
  assert(h.announces(from).some((t) => t.includes("stolen from bob")), "last-hit steal announced");
  for (const n of ["ana", "bob", "cy"]) landNow(h, n);
  const ana = h.p("ana"), bob = h.p("bob");
  // Ana opens a chest; Bob kills her 5 s later → steals 750.
  const c = h.dbg().chests.find((x) => x.kind === "buried");
  ana.pos = { x: c.x, y: ana.pos.y, z: c.z };
  h.input("ana", "dig", true);
  h.until("ana opens", () => c.open, 5);
  h.input("ana", "dig", false);
  assert.strictEqual(ana.score, 1500);
  h.wait(5);
  const kill = (killer, victim) => {
    const v = h.p(victim), k = h.p(killer);
    v.spawnShield = 0; v.hp = 1;
    k.pos = { x: v.pos.x, y: v.pos.y, z: v.pos.z + 6 }; k.yaw = 0;
    h.input(killer, "shoot", true);
    h.until(`${killer} kills ${victim}`, () => v.dead, 3);
    h.input(killer, "shoot", false);
  };
  const bob0 = bob.score;
  kill("bob", "ana");
  assert.strictEqual(bob.score - bob0, SCORING.kill + 750);
  assert.strictEqual(ana.score, 1500 + SCORING.killed - 750);
  // A second chest, killed 16 s later: no steal.
  h.wait(4);
  const c2 = h.dbg().chests.find((x) => x.kind === "rock");
  ana.pos = { x: c2.x, y: ana.pos.y, z: c2.z };
  h.input("ana", "drill", true);
  h.until("ana opens the rock", () => c2.open, 5);
  h.input("ana", "drill", false);
  h.wait(16);
  const a0 = ana.score, b0 = bob.score;
  kill("bob", "ana");
  assert.strictEqual(bob.score - b0, SCORING.kill); assert.strictEqual(ana.score - a0, SCORING.killed);
  return `cy last hit +1000 (stolen from bob), ana chest +1500 → killed at 5 s: bob +950, ana -800; at 16 s: +200 / -50`;
});

test("parked ships can be wrecked (+150, kill feed); the owner must redraw a ship (one drawing) to take off", () => {
  const h = harness(14);
  for (const n of ["ana", "bob"]) { h.w.join(n); h.w.setEntity(n, "explorer", devKit("explorer")); }
  h.w.start();
  killBoss(h, "ana");
  landNow(h, "ana"); landNow(h, "bob");
  const car = h.dbg().parked.find((x) => x.player === "ana");
  assert.strictEqual(car.hp, T.planet.parkedShipHp);
  const bob = h.p("bob");
  bob.pos = { x: car.x, y: bob.pos.y, z: car.z + 8 }; bob.yaw = 0;
  const t0 = h.dbg().playT;
  h.input("bob", "shoot", true);
  h.until("wrecked", () => car.wrecked, 10, () => aim(h, "bob", { x: car.x, y: 0, z: car.z }));
  h.input("bob", "shoot", false);
  const took = h.dbg().playT - t0;
  assert.deepStrictEqual(h.w.worldMessage().island.parked.find((x) => x.player === "ana").wrecked, true);
  assert.strictEqual(bob.score, SCORING.wreck, "wrecking a rival's parked ship scores +150");
  assert(h.announces().includes(`🔧 bob wrecked ana's ship (+${SCORING.wreck})`), "announced in the kill feed");
  assert(h.toasts("ana").some((t) => t.text === "bob wrecked your parked ship! Draw a new ship to take off"), "the owner is told");
  const from = h.steps;
  h.input("ana", "takeoff", true); h.input("ana", "takeoff", false); h.wait(0.5);
  assert.strictEqual(h.p("ana").takeoffFor, 0, "no take-off with a wreck");
  assert.strictEqual(h.toasts("ana", from)[0].text, "Your ship is wrecked. Draw a new ship to take off");
  h.w.setEntity("ana", "ship", devKit("ship"));
  assert.strictEqual(car.wrecked, false); assert.strictEqual(car.hp, car.maxHp);
  // A ship taking off can't be shot down any more: no wreck, no +150, she flies.
  car.hp = 5;
  h.input("ana", "takeoff", true); h.input("ana", "takeoff", false);
  h.input("bob", "shoot", true);
  h.until("ana is back in space", () => h.p("ana").mode === "space", 4, () => { bob.pos = { x: car.x, y: bob.pos.y, z: car.z + 8 }; aim(h, "bob", { x: car.x, y: 0, z: car.z }); });
  h.input("bob", "shoot", false);
  assert.strictEqual(car.wrecked, false); assert.strictEqual(bob.score, SCORING.wreck, "no second +150");
  return `${T.planet.parkedShipHp} hp parked ship wrecked in ${took.toFixed(1)} s of fire (+${SCORING.wreck} to bob, kill feed + toast); redraw repairs it`;
});

// ---- Hints -----------------------------------------------------------------------------------------------------------

test("hints point at the drawing first, then at the button", () => {
  const h = harness(15);
  h.w.join("ana");
  h.w.setLayout("ana", { buttons: [{ type: "stick", action: "steer", label: "", x: 0.04, y: 0.4, w: 0.3, h: 0.55 }], source: "model" });
  h.w.start();
  const b = h.dbg().boss, p = h.p("ana");
  const from = h.steps;
  h.wait(32, () => { p.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z + b.radius + 100 }; p.spawnShield = 1; p.hp = 100; });
  const part = h.toasts("ana", from).filter((t) => t.kind === "hint");
  assert.deepStrictEqual(part.map((t) => [t.need, t.text, t.sketch]), [
    ["part", "Your ship can't shoot. What would let it?", null],
    ["part", "", "gun"],
    ["part", "Draw a gun or a cannon on your ship", null],
  ]);
  assert.strictEqual(part[2].ghost, null, "no ghost box for a part");
  const at = part.map((t) => ((t.at - from) / Contract.SIM_HZ).toFixed(1));
  h.w.setEntity("ana", "ship", { type: "ship", unlocked: [{ verb: "shoot", part: "gun" }], parts: [], source: "model" });
  const f2 = h.steps;
  h.wait(32, () => { p.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z + b.radius + 100 }; p.spawnShield = 1; p.hp = 100; });
  const btn = h.toasts("ana", f2).filter((t) => t.kind === "hint");
  assert.deepStrictEqual(btn.map((t) => [t.need, t.text]), [["button", "Your ship has a gun. Where's the trigger?"], ["button", ""], ["button", "Draw SHOOT"]]);
  assert.strictEqual(btn[2].ghost.action, "shoot");
  h.w.setLayout("ana", LAYOUT);
  const f3 = h.steps;
  h.wait(40, () => { p.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z + b.radius + 100 }; });
  assert.strictEqual(h.toasts("ana", f3).filter((t) => t.kind === "hint").length, 0, "skill + button: no more hints");
  return `part ladder at ${at.join(", ")} s; then the button ladder with a ghost box`;
});

// ---- Network budget ------------------------------------------------------------------------------------------------

test("tick size with 25 players stays under 8 KB", () => {
  const h = harness(16);
  h.w.join("ana"); h.w.setEntity("ana", "ship", devKit("ship"));
  for (let i = 1; i <= 24; i++) h.w.addBot(`bot${i}`);
  h.w.start();
  h.input("ana", "shoot", true);
  const t0 = Date.now();
  h.wait(200);
  const ms = (Date.now() - t0) / (200 * Contract.SIM_HZ);
  const world = Buffer.byteLength(JSON.stringify(h.w.worldMessage({ entities: false })));
  assert(h.maxTick < 8192, `max tick ${h.maxTick} B`);
  return `max tick ${h.maxTick} B over ${h.checked.tick} ticks (25 players, 200 s), world ${world} B, step ${ms.toFixed(3)} ms`;
});

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed at ${new Date().toISOString()}`);
process.exit(passed === results.length ? 0 : 1);
