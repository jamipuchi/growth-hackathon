// Fast-forward tests of world.js, v1.1 rules (PLAN.md section 0): the START button, the 4:00 cap and the all-chests
// end, most points wins plus stars, unlockable skills (refusals, dev kit, redraws, assists), the boss (any weapon, HP
// scaling, shooting back), chest kinds and counts, planet movement per type, ruthless steals and wrecks, the hint ladder
// (parts, then buttons), and tick size with 25 players. v1.4 balance: bots count 0.5 for the boss's HP and 0 for the
// chests, flight times (cruise ~20 s, holding BOOST ~15 s), bots' fire discipline and revenge, human shots through
// bots, the +1000 for humans, wreck +150, dry chest walks and bays, the shore slide. The whole route with 24 bots:
// dev/netcode/balance-sim.mjs; a room of 25 humans: dev/v14-pacing/crowd-sim.mjs.
// Run: node dev/netcode/sim-test.js
const assert = require("assert");
const Contract = require("../../contract");
const Verbs = require("../../verbs");
const { createWorld, chestCount, bossHp, DEFAULT_LAYOUT, withSteer } = require("../../world");

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
// v1.3: only join() and addBot() create players (finding #18), so the test joins `by` first.
function killBoss(h, by) { const b = h.dbg().boss; b.hp = 1; h.w.join(by); hitBossVia(h, by); }
function hitBossVia(h, by) {
  // A shot from 20 m off the boss's surface (rocks keep 25 m clear of it): the cheapest way to land the last hit from a
  // test. Ships have no drill since v1.2 (PLAN.md section 0: the drill is a planet skill).
  const p = h.p(by), b = h.dbg().boss;
  const drawn = p.drawn.space;
  h.w.setEntity(by, "ship", devKit("ship"));
  p.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z + b.radius + 20 }; p.yaw = 0; p.pitch = 0;
  h.input(by, "shoot", true);
  h.until("boss dies", () => h.dbg().boss.dead, 5, () => aim(h, by, b.pos));
  h.input(by, "shoot", false);
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

test("4:00 cap, assists at 3:00, most points wins, stars, scoreboard 10 s → a fresh lobby (owner 11:31)", () => {
  const h = harness(3);
  h.w.join("ana"); h.w.join("bob");
  h.w.setEntity("ana", "ship", devKit("ship"));
  h.w.setLayout("ana", LAYOUT);
  assert.strictEqual(h.w.spendDrawing("ana", "space"), true);
  assert.strictEqual(h.w.drawingsLeft("ana").space, T.drawings.space - 1);
  h.w.start();
  const entFrom = h.steps;
  h.until("assists", () => h.w.phase === "assists", 181);
  const assistsAt = h.dbg().playT;
  assert(Math.abs(assistsAt - ROUND.assistsAt) < 0.1, `assists at ${assistsAt}`);
  // v1.3 (owner, 10 Oct 09:05): no free skills at 3:00: bob's plain ship still cannot shoot or land.
  assert(!h.p("bob").entity.verbs.includes("shoot") && !h.p("bob").entity.verbs.includes("land"), "assists: no gate skill is given");
  assert.strictEqual(h.p("bob").entity.assisted, undefined);
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
  // v1.5 (owner, 10 Oct 11:31): every round starts from scratch: a plain ship, no layout, a full drawing budget.
  const ana = h.p("ana");
  assert.strictEqual(ana.entity.source, "plain", "no drawing carries into the next lobby");
  assert.strictEqual(ana.entity.type, "ship"); assert.deepStrictEqual(ana.entity.unlocked, [], "a plain ship only flies");
  assert(!ana.entity.verbs.includes("shoot") && !ana.entity.verbs.includes("dig"), "no skill carries over");
  assert.strictEqual(ana.layout, null, "no layout carries over");
  assert.deepStrictEqual(ana.drawn, { space: null, planet: null });
  assert.deepStrictEqual(h.w.drawingsLeft("ana"), T.drawings, "a full drawing budget again");
  assert(!h.p("bob").entity.verbs.includes("shoot"), "assists are gone in the next round");
  h.w.start();
  assert.strictEqual(h.p("ana").score, 0, "scores reset each round");
  assert.strictEqual(h.w.worldMessage().leaderboard[0].stars, 1, "stars persist for the session");
  return `assists ${assistsAt.toFixed(2)} s, end ${endAt.toFixed(2)} s, winner ana ★1`;
});

// ---- The whole route, solo, dev kit (as with ASTRA_MOCK=1) ----------------------------------------------------------

test("solo expert round: fly ~15 s, shoot the boss ~15 s, land, open the chests → round ends early", () => {
  const h = harness(42);
  const me = "jaume";
  h.w.join(me);
  h.w.setEntity(me, "ship", devKit("ship"));
  h.w.setEntity(me, "explorer", devKit("explorer"));
  h.w.setLayout(me, LAYOUT);
  h.w.start();
  // v1.4: a solo round has chestCount(1) chests (balance-sim.mjs plays the pacing with all of them); this route
  // keeps 3.
  assert.strictEqual(h.dbg().chests.length, chestCount(1));
  h.dbg().chests.length = 3;
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
  // v1.3 score floor: a death before the +1000 costs nothing below 0.
  assert(h.p(me).score <= SCORING.bossLastHit && h.p(me).score >= SCORING.bossLastHit + deaths * SCORING.killed, `last hit +1000, -50 per death (floored at 0): ${h.p(me).score}`);
  const pl = () => h.dbg().planet;
  flyTo(h, me, pl, T.planet.radius + T.planet.landRange - 5);
  h.input(me, "land", true); h.input(me, "land", false);
  h.until("landed", () => h.p(me).mode === "planet" && !h.p(me).landingFor, 6);
  const landed = h.dbg().playT;
  assert.strictEqual(h.p(me).entity.type, "person");
  for (const c of h.dbg().chests) {
    walkTo(h, me, h.dbg().landing, 3); // every chest is a dry straight walk from the pad (v1.7: up to 172 m out)
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
  assert.strictEqual(bossHp(1), T.boss.hp); assert.strictEqual(bossHp(25), Math.round(T.boss.hp * 8.2)); // v1.4: hp 1200, +0.3 per player
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
  // 25 humans at START: 8.2× the HP.
  const big = harness(8);
  for (let i = 1; i <= 25; i++) big.w.join(`p${i}`);
  big.w.start();
  assert.strictEqual(big.dbg().boss.maxHp, Math.round(T.boss.hp * 8.2)); assert.strictEqual(big.w.worldMessage().playerCount, 25);
  return `${dps.toFixed(0)} dps from one gun → solo ${(T.boss.hp / dps).toFixed(0)} s of steady fire; 25 players ${(T.boss.hp * 8.2 / dps / 25).toFixed(0)} s all firing`;
});

test("space (v1.4): boss ~400 m, planet 350 m beyond, rocks dense around the boss, 25 spawn slots ≥ 35 m apart", () => {
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
  assert(Math.abs(bossD - T.bossDistance) < 41 && Math.abs(beyond - T.planet.offset) < 2 && planetD > bossD + T.planet.offset - 100 && planetD < T.worldRadius - 150, `boss ${bossD}, beyond ${beyond}`);
  const near = d.rocks.filter((r) => dist(r.pos, planetAt) < 360).length;
  const nearVol = (4 / 3) * Math.PI * 360 ** 3, allVol = (4 / 3) * Math.PI * T.worldRadius ** 3;
  const density = (near / nearVol) / ((d.rocks.length - near) / (allVol - nearVol));
  assert(density > 20, `rocks ${density.toFixed(0)}× denser near the boss`);
  const spawns = Object.values(h.w.players).map((p) => `${p.pos.x},${p.pos.y},${p.pos.z}`);
  const ships = Object.values(h.w.players).map((p) => p.pos);
  let closest = Infinity;
  for (let i = 0; i < ships.length; i++) for (let j = i + 1; j < ships.length; j++) closest = Math.min(closest, dist(ships[i], ships[j]));
  assert(closest >= 35, `spawns ${closest.toFixed(1)} m apart at the closest`);
  return `boss ${bossD.toFixed(0)} m, planet ${beyond.toFixed(0)} m beyond, ${d.rocks.length} rocks, ${near} within 360 m of the boss (${density.toFixed(0)}× denser), ${new Set(spawns).size} distinct spawns`;
});

// ---- Planet --------------------------------------------------------------------------------------------------------

test("chests: two kinds, count scales with players, each a dry straight walk from the pad", () => {
  assert.deepStrictEqual([1, 2, 5, 7, 10, 25, 40].map(chestCount), [16, 17, 19, 20, 22, 32, 32]); // v1.4
  const h = harness(10);
  for (let i = 1; i <= 25; i++) h.w.join(`p${i}`);
  h.w.start();
  const cs = h.w.worldMessage().chests;
  assert.strictEqual(cs.length, 32);
  assert.strictEqual(cs.filter((c) => c.kind === "rock").length, 16);
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
  return `25 players → ${cs.length} chests (16 buried, 16 in rocks), farthest ${far.toFixed(0)} m from the pad; ${checked} chests on 30 islands all a dry walk from the pad, all 25 bays dry`;
});

// ---- Balance with bots (PLAN.md section 0; orchestrator decisions for v1.1) -----------------------------------------

test("bots are fillers: the boss's HP counts a bot as half a player, the chests count humans only (v1.4)", () => {
  const counts = [];
  for (const [humans, bots, hp, nChests] of [[1, 24, Math.round(T.boss.hp * 4.6), 16], [3, 22, Math.round(T.boss.hp * 4.9), 17], [25, 0, Math.round(T.boss.hp * 8.2), 32], [1, 0, T.boss.hp, 16]]) {
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

test("speed (owner, 10 Oct 10:00): cruise ~20 s to the boss, holding BOOST ~15 s, the planet ~16 s further at cruise", () => {
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
    // The ship stops at boss radius + SHIP_RADIUS (1.5 m): "at the boss" is within 2 m of its surface.
    h.until("at the boss", () => dist(p.pos, b.pos) - b.radius <= 2, 120, () => { aim(h, "ana", b.pos); p.spawnShield = 1; p.hp = 100; });
    return h.dbg().playT - t0;
  };
  const cruise = T0({}), boost = T0({ boost: true }), full = T0({ boost: true, forward: true });
  const planetCruise = (T.planet.offset - T.planet.radius - T.planet.landRange) / T.cruiseSpeed;
  assert(cruise > 18 && cruise < 24, `cruise ${cruise}`);
  assert(boost > 13 && boost < 18, `boost only ${boost}`);
  assert(full > 11 && full < 16, `forward + boost ${full}`);
  assert(planetCruise > 13 && planetCruise < 19, `planet ${planetCruise}`);
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
  assert.strictEqual(ana.score, s0, "no kill points for a bot"); assert.strictEqual(b2.score, Math.max(0, b2s + SCORING.killed)); // v1.3: scores never go below 0
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
    // v1.7: the rays scale with the island (440 m on the 840 m island; 220 on the old 420 m one).
    const L = h.dbg().landing, far = (isl.size / 420) * 220;
    for (let i = 0; i < 60; i++) {
      const ang = (i / 60) * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang);
      let r = 0;
      while (r < far && dryAt(L.x + dx * r, L.z + dz * r)) r += 0.5;
      if (r >= far || r < 3) continue;
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

test("25 explorers open all 32 chests in 1-3 minutes after landing (v1.4: most of the round is on the planet)", () => {
  const h = harness(11);
  const names = Array.from({ length: 25 }, (_, i) => `p${i + 1}`);
  for (const n of names) { h.w.join(n); h.w.setEntity(n, "ship", devKit("ship")); h.w.setEntity(n, "explorer", devKit("explorer")); h.w.setLayout(n, LAYOUT); }
  h.w.start();
  killBoss(h, "p1");
  // All 25 press LAND together (landNow one after another would use up 75 s of the round).
  const pl = h.dbg().planet;
  for (const n of names) { h.p(n).pos = { x: pl.x + pl.radius + 10, y: pl.y, z: pl.z }; h.input(n, "land", true); h.input(n, "land", false); }
  h.until("all landed", () => names.every((n) => h.p(n).mode === "planet" && !h.p(n).landingFor), 6);
  const t0 = h.dbg().playT;
  const chests = h.dbg().chests, pad = h.dbg().landing, seed = h.dbg().island.seed;
  assert.strictEqual(chests.length, chestCount(25));
  // Every chest is a dry straight walk from the pad, not always from another chest (v1.7: up to 284 m out on the 840 m
  // island): with a lagoon on the straight line, walk back to the pad first.
  const Terrain = require("../../terrain");
  const wet = (a, b) => { const k = Math.ceil(dist2(a, b) / 2); for (let i = 1; i < k; i++) if (Terrain.height(a.x + ((b.x - a.x) * i) / k, a.z + ((b.z - a.z) * i) / k, seed) <= 0.3) return true; return false; };
  // Each one heads to the nearest chest still closed (or open but not collected) and works it.
  h.until("all chests open", () => h.w.phase === "scoreboard", 230, () => {
    for (const n of names) {
      const p = h.p(n);
      const left = chests.filter((c) => !c.open);
      if (!left.length) return;
      const c = left.reduce((a, b) => (dist2(a, p.pos) < dist2(b, p.pos) ? a : b));
      const d = dist2(c, p.pos);
      const err = aim(h, n, { ...(d > 1.5 && wet(p.pos, c) ? pad : c), y: 0 });
      h.axis(n, "move", 0, d > 1.5 && err < 0.6 ? 1 : 0);
      h.input(n, "boost", true);
      h.input(n, "dig", d < 2.5 && c.kind === "buried");
      h.input(n, "drill", d < 2.5 && c.kind === "rock");
    }
  });
  const took = h.dbg().playT - t0;
  assert(took > 45 && took < 210, `took ${took}`);
  assert.strictEqual(h.w.worldMessage().result.reason, "chests");
  return `${chests.length} chests in ${took.toFixed(1)} s from touchdown (scripted, one crowd, no fighting)`;
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
  assert(h.announces(from).some((t) => t.includes("cy stole the boss from bob")), "last-hit steal announced");
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

test("v1.6 island aim (M5): a rival 6 m away dies downhill, uphill and on the flat; with nobody in the narrow cone a shot follows the ground", () => {
  const Terrain = require("../../terrain");
  const h = harness(13);
  for (const n of ["ana", "bob"]) { h.w.join(n); h.w.setEntity(n, "ship", devKit("ship")); h.w.setEntity(n, "explorer", devKit("explorer")); }
  h.w.start();
  killBoss(h, "bob");
  landNow(h, "ana"); landNow(h, "bob");
  const ana = h.p("ana"), bob = h.p("bob"), isl = h.dbg().island;
  const ground = (x, z) => Terrain.height(x, z, isl.seed);
  const pads = h.dbg().parked;
  // A shooter spot and a rival 6 m ahead whose chest is dy higher, both dry, far from the parked ships, with nothing
  // but air on the line between their chests.
  const site = (lo, hi) => {
    for (let x = -isl.size / 2; x < isl.size / 2; x += 1.5) for (let z = -isl.size / 2; z < isl.size / 2; z += 1.5) for (let k = 0; k < 8; k++) {
      const yaw = (k * Math.PI) / 4, tx = x - Math.sin(yaw) * 6, tz = z - Math.cos(yaw) * 6;
      const g0 = ground(x, z), g1 = ground(tx, tz), dy = g1 - g0;
      if (dy < lo || dy > hi || g0 < 0.5 || g1 < 0.5 || Math.hypot(x, z) > isl.size / 2 - 15) continue;
      if (pads.some((c) => Math.hypot(c.x - x, c.z - z) < 20 || Math.hypot(c.x - tx, c.z - tz) < 20)) continue;
      let clear = true;
      for (let i = 1; i < 20 && clear; i++) { const s = i / 20; clear = g0 + 1.1 + dy * s > ground(x + (tx - x) * s, z + (tz - z) * s) + 0.3; }
      if (clear) return { x, z, yaw, tx, tz, dy };
    }
    throw new Error(`no site with a rival ${lo}..${hi} m higher`);
  };
  const place = (p, x, z, yaw = p.yaw) => { p.pos = { x, y: ground(x, z), z }; p.vy = 0; p.yaw = yaw; };
  // At 140 m/s a shot covers 4.7 m a step, so it can meet a rival 6 m away in the step it is fired: read it from the
  // list it was pushed to (fire() runs before the bullets move and the list is filtered into a new one).
  const shootStep = () => { const was = h.dbg().bullets; h.step(); return [...was, ...h.dbg().bullets].filter((b) => b.owner === "bob").sort((a, b) => a.id - b.id).at(-1); };
  const pitchOf = (b) => Math.asin(b.dir.y);
  const EXPLORER_HIT = 0.9 + 0.3; // world.js: EXPLORER_RADIUS + 0.3 around the chest
  // A rival in the cone: the shot climbs or dips to their chest; a level shot (the old rule) would pass 1.2 m+ away.
  const kills = {};
  for (const [label, lo, hi] of [["downhill", -2.6, -1.8], ["uphill", 1.8, 2.6], ["flat", -0.15, 0.15]]) {
    if (ana.dead) h.until("ana respawns", () => !ana.dead, T.respawnSeconds + 2);
    const s = site(lo, hi);
    place(bob, s.x, s.z, s.yaw); place(ana, s.tx, s.tz); ana.hp = 1; ana.spawnShield = 0;
    const b0 = bob.score, from = h.steps;
    bob.fireCd = 0;
    h.input("bob", "shoot", true);
    const pitch = pitchOf(shootStep());
    assert(Math.abs(pitch - Math.atan2(s.dy, 6)) < 0.02, `${label}: the shot aims at ana's chest (pitch ${pitch.toFixed(3)} vs ${Math.atan2(s.dy, 6).toFixed(3)})`);
    h.until(`bob kills ana ${label}`, () => ana.dead, 3);
    h.input("bob", "shoot", false);
    assert.strictEqual(bob.score - b0, SCORING.kill, `${label}: a kill pays +200`);
    if (label !== "flat") assert(Math.abs(s.dy) > EXPLORER_HIT, `${label}: a level shot would have missed`);
    kills[label] = `${label} dy ${s.dy.toFixed(2)} m pitch ${(pitch * 57.3).toFixed(1)}° in ${((h.steps - from) * DT).toFixed(2)} s`;
  }
  h.until("ana respawns", () => !ana.dead, T.respawnSeconds + 2);
  // Nobody in the cone (ana behind bob, then 3 m to his side 6 m ahead): the shot follows the ground 8 m ahead, so it
  // climbs a hill instead of flying into it and dips down a slope.
  const follow = {};
  for (const [label, lo, hi] of [["uphill", 1.8, 2.6], ["downhill", -2.6, -1.8]]) {
    const s = site(lo, hi);
    place(bob, s.x, s.z, s.yaw);
    for (const [where, ax, az] of [["behind", s.x + Math.sin(s.yaw) * 6, s.z + Math.cos(s.yaw) * 6], ["aside", s.tx + Math.cos(s.yaw) * 3, s.tz - Math.sin(s.yaw) * 3]]) {
      place(ana, ax, az); ana.hp = 100; ana.spawnShield = 0;
      bob.fireCd = 0;
      h.input("bob", "shoot", true);
      const shot = shootStep(), pitch = pitchOf(shot);
      h.input("bob", "shoot", false);
      const fx_ = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      const slope = Math.atan2(Math.max(0, ground(s.x + fx_ * 8, s.z + fz * 8)) - Math.max(0, ground(s.x, s.z)), 8);
      assert(Math.abs(pitch - Math.max(-0.6, Math.min(0.6, slope))) < 0.01, `${label}, ana ${where}: the shot follows the ground (${pitch.toFixed(3)} vs ${slope.toFixed(3)})`);
      assert(label === "uphill" ? pitch > 0.1 : pitch < -0.1, `${label}: the shot ${label === "uphill" ? "climbs" : "dips"}`);
      h.wait(0.5);
      assert.strictEqual(ana.hp, 100, `ana ${where} of the cone is not hit`);
      follow[`${label} ${where}`] = (pitch * 57.3).toFixed(1) + "°";
    }
  }
  return `${Object.values(kills).join("; ")}; no rival in the cone: ${Object.entries(follow).map(([k, v]) => `${k} ${v}`).join(", ")}`;
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
  assert(h.toasts("ana").some((t) => t.text === "bob wrecked your ship: draw a new ship to take off"), "the owner is told");
  const from = h.steps;
  h.input("ana", "takeoff", true); h.input("ana", "takeoff", false); h.wait(0.5);
  assert.strictEqual(h.p("ana").takeoffFor, 0, "no take-off with a wreck");
  assert.strictEqual(h.toasts("ana", from)[0].text, "Your ship is wrecked: draw a new ship to take off");
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

// ---- v1.2 / v1.3: the drill on the planet only, mischief, the LAND ladder, names and caps ---------------------------

const mischiefKit = { type: "ship", unlocked: Verbs.MISCHIEF.map((v) => ({ verb: v, part: Verbs.VERBS[v].grantedBy[0] })).concat([{ verb: "shoot", part: "gun" }, { verb: "shield", part: "bubble" }]), parts: [], source: "model" };
const mischiefOf = (h, from) => h.msgs.filter((x) => x.at >= from && x.m.type === "mischief").map((x) => x.m);
const tickOf = (h, name) => h.w.tickMessage().players.find((p) => p.name === name);
const press = (h, name, verb) => { h.input(name, verb, true); h.input(name, verb, false); };
// Level ships facing -z, far from the rocks (cleared), 400 m out from spawn.
function lineUp(h, at) { for (const [name, x] of Object.entries(at)) Object.assign(h.p(name), { pos: { x, y: 0, z: -400 }, yaw: 0, pitch: 0, spawnShield: 0 }); }

test("v1.2: the drill is a planet skill: no ship gets it, a ship never drills the boss, pressing it says where it works", () => {
  assert(!Verbs.SKILLS.space.includes("drill") && !Verbs.DEV_KIT.space.some((u) => u.verb === "drill") && Verbs.SKILLS.planet.includes("drill"), "drill: planet skills only");
  const h = harness(21);
  h.w.join("ana");
  h.w.start();
  h.w.setEntity("ana", "ship", { type: "ship", unlocked: [{ verb: "drill", part: "nose drill" }, { verb: "shoot", part: "gun" }], parts: [], source: "model" });
  h.w.setLayout("ana", LAYOUT);
  const p = h.p("ana"), b = h.dbg().boss;
  assert.deepStrictEqual(p.entity.verbs, ["shoot"], "a drawn nose drill unlocks nothing in space");
  const from = h.steps, hp0 = b.hp;
  h.input("ana", "drill", true);
  h.wait(2, () => { p.pos = { x: b.pos.x + b.radius + 3, y: b.pos.y, z: b.pos.z }; p.spawnShield = 1; });
  h.input("ana", "drill", false);
  assert.strictEqual(b.hp, hp0, "the boss takes nothing from a ship's drill");
  assert(!h.lastTick.players.find((q) => q.name === "ana").flags.drilling, "no drilling flag in space");
  const t = h.toasts("ana", from).filter((x) => x.kind === "refused" && x.verb === "drill");
  assert.strictEqual(t[0] && t[0].text, "DRILL · not here: only on the planet");
  return `ship verbs [${p.entity.verbs}], boss hp ${b.hp}/${hp0} after 2 s pressed on it, "${t[0].text}"`;
});

test("v1.3 mischief: EMP, ink bomb and tractor hit the nearest human rival in reach (never a bot, never one landing or spawn-shielded), with cooldowns", () => {
  const h = harness(22);
  for (const n of ["ana", "bob", "cy", "dan"]) h.w.join(n);
  for (let i = 1; i <= 3; i++) h.w.addBot(`bot${i}`);
  h.w.start();
  h.dbg().rocks.splice(0);
  h.w.setEntity("ana", "ship", mischiefKit); h.w.setEntity("dan", "ship", mischiefKit);
  lineUp(h, { ana: 0, bob: 60, cy: 100, dan: 1000, bot1: 6, bot2: 12, bot3: 1006 });
  let from = h.steps;
  press(h, "ana", "emp"); h.step();
  assert.deepStrictEqual(mischiefOf(h, from), [{ type: "mischief", kind: "emp", player: "bob", from: "ana", seconds: 5 }], "EMP: the nearest human (bots at 6 and 12 m are skipped)");
  assert(h.announces(from).includes("⚡ ana scrambled bob's buttons"), "kill feed");
  const cools = h.msgs.filter((x) => x.at >= from && x.m.type === "cooldown").map((x) => x.m);
  assert(tickOf(h, "bob").flags.emp, "bob's tick flags emp");
  assert.deepStrictEqual(cools, [{ type: "cooldown", player: "ana", verb: "emp", seconds: 20 }], "ana's phone hears the EMP cools down 20 s");
  from = h.steps;
  press(h, "ana", "emp"); h.step();
  assert.strictEqual(mischiefOf(h, from).length, 0, "a second EMP inside the cooldown does nothing");
  press(h, "ana", "inkbomb"); h.step();
  assert.deepStrictEqual(mischiefOf(h, from), [{ type: "mischief", kind: "inkbomb", player: "bob", from: "ana", seconds: 10 }], "ink: until wiped, 10 s safety fade (owner, 10 Oct 09:05)");
  // bob is landing (the predefined shot): immune, so the tractor reaches past him to cy at 100 m.
  h.p("bob").landingFor = 3;
  from = h.steps;
  press(h, "ana", "tractor"); h.step();
  const pullMsg = mischiefOf(h, from)[0];
  assert.deepStrictEqual([pullMsg.kind, pullMsg.player, pullMsg.from, pullMsg.seconds, pullMsg.dir], ["tractor", "cy", "ana", 1.5, 3.14], "tractor: cy, pulled to the left of their screen");
  const x0 = h.p("cy").pos.x;
  h.wait(1.6);
  const pulled = x0 - h.p("cy").pos.x;
  assert(pulled > 30 && pulled < 45, `cy pulled ${pulled.toFixed(1)} m toward ana`);
  // Nobody human in reach (only a bot next to dan): told so, no cooldown spent, nothing sent.
  from = h.steps;
  press(h, "dan", "emp"); h.step();
  assert.strictEqual(mischiefOf(h, from).length, 0);
  assert.deepStrictEqual(h.toasts("dan", from).map((t) => t.text), ["EMP · no rival close enough"]);
  assert(!h.msgs.some((x) => x.at >= from && x.m.type === "cooldown" && x.m.player === "dan") && !(h.p("dan").cd.emp > 0), "no cooldown spent on a miss");
  // A spawn shield protects too.
  lineUp(h, { dan: 2000, cy: 2050 }); h.p("cy").spawnShield = 2;
  from = h.steps;
  press(h, "dan", "inkbomb"); h.step();
  assert.strictEqual(mischiefOf(h, from).length, 0, "spawn-shielded cy is immune");
  return `EMP → bob (5 s), ink → bob (4 s), tractor past landing bob → cy (pulled ${pulled.toFixed(1)} m in 1.6 s); bots, shields and misses respected`;
});

test("v1.3 mischief: a mine stuns, costs 30 and hurts; a mine kill is a kill (+200 / -50, kill feed); a shield eats it", () => {
  const h = harness(23);
  h.w.join("ana"); h.w.join("bob");
  h.w.start();
  h.dbg().rocks.splice(0);
  h.w.setEntity("ana", "ship", mischiefKit); h.w.setEntity("bob", "ship", mischiefKit);
  lineUp(h, { ana: 0, bob: 300 });
  const ana = h.p("ana"), bob = h.p("bob");
  press(h, "ana", "mine"); h.step();
  const mine = h.dbg().mines[0];
  assert(mine && Math.abs(mine.pos.z - -396) < 1 && h.w.tickMessage().mines.length === 1, "a mine 4 m behind the ship, in the tick");
  h.wait(1);
  let from = h.steps;
  bob.score = 100; // v1.3 score floor: give bob points to lose
  bob.pos = { ...mine.pos }; h.step();
  assert.deepStrictEqual(mischiefOf(h, from), [{ type: "mischief", kind: "mine", player: "bob", from: "ana", seconds: T.stunSeconds, points: 30 }]);
  assert.deepStrictEqual([bob.score, bob.hp, bob.stun > 0, h.dbg().mines.length], [70, 70, true, 0], "-30, 30 damage, stunned, the mine is gone");
  assert(h.announces(from).includes("💣 bob hit ana's mine (-30)"));
  // A mine kill (bob waits off ana's line, or he would fly into the new mine while it arms).
  ana.cd.mine = 0; bob.hp = 20; bob.stun = 0; bob.pos = { x: 300, y: 0, z: -400 };
  press(h, "ana", "mine"); h.step();
  h.wait(1);
  from = h.steps;
  bob.pos = { ...h.dbg().mines[0].pos }; h.step();
  assert(bob.dead, "bob dies on the mine");
  assert.deepStrictEqual([ana.score, bob.score], [SCORING.kill, 0], "a mine kill scores as a kill (bob floored at 0, v1.3)");
  assert(h.announces(from).includes("ana ✕ bob 💣"), "the kill feed says how");
  // A shield eats a mine whole.
  h.wait(T.respawnSeconds + 0.5);
  ana.cd.mine = 0; bob.pos = { x: 300, y: 0, z: -400 };
  press(h, "ana", "mine"); h.step();
  h.wait(1);
  const before = bob.score;
  bob.spawnShield = 0; bob.shieldEnergy = 1;
  h.input("bob", "shield", true); h.step();
  from = h.steps;
  bob.pos = { ...h.dbg().mines[0].pos }; h.step();
  h.input("bob", "shield", false);
  assert.deepStrictEqual([mischiefOf(h, from).length, bob.score, h.dbg().mines.length], [0, before, 0], "shielded: the mine pops, nothing lost");
  return `mine: -30, 30 damage, ${T.stunSeconds} s stun; mine kill → ana ${ana.score}, bob ${bob.score}; shield eats it`;
});

test("v1.3 mischief: a decoy soaks a rival's shots and the boss's fire; the shooter learns they were fooled", () => {
  const h = harness(26);
  h.w.join("ana"); h.w.join("bob");
  h.w.start();
  h.dbg().rocks.splice(0);
  h.w.setEntity("ana", "ship", mischiefKit); h.w.setEntity("bob", "ship", mischiefKit);
  lineUp(h, { ana: 0, bob: 500 });
  press(h, "ana", "decoy"); h.step();
  const d = h.dbg().decoys[0];
  assert(d && Math.abs(d.pos.x - 6) < 0.5, "the decoy appears 6 m to the right");
  const td = h.w.tickMessage().decoys[0];
  assert.deepStrictEqual([td.length, td[6], td[7]], [8, "ana", 0], "tick decoys: [id, x, y, z, yaw, color, owner, mode]");
  // bob, 30 m behind the decoy on its line, shoots it (both fly -z at cruise speed).
  Object.assign(h.p("bob"), { pos: { x: d.pos.x, y: d.pos.y, z: d.pos.z + 30 }, yaw: 0, pitch: 0 });
  const from = h.steps;
  h.input("bob", "shoot", true);
  h.until("the decoy pops", () => !h.dbg().decoys.length, 3);
  const popped = (h.steps - from) / Contract.SIM_HZ;
  h.input("bob", "shoot", false);
  assert.deepStrictEqual(mischiefOf(h, from), [
    { type: "mischief", kind: "decoy", player: "bob", from: "ana", seconds: 0 },
    { type: "mischief", kind: "decoy", player: "ana", from: "ana", victim: "bob", seconds: 0 },
  ]);
  assert(h.announces(from).includes("🎭 bob shot ana's decoy") && h.p("ana").hp === 100, "kill feed; ana unhurt");
  // The boss fires at a decoy parked in its range when no ship is (it counts as one more target).
  const b = h.dbg().boss;
  h.p("ana").cd.decoy = 0;
  Object.assign(h.p("ana"), { pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z + 120 }, yaw: 0, pitch: 0 });
  press(h, "ana", "decoy"); h.step();
  const lure = h.dbg().decoys[0];
  lure.speed = 0;
  h.p("ana").pos = { x: 0, y: 0, z: -400 };
  const t1 = h.steps;
  h.until("the boss shoots the decoy down", () => !h.dbg().decoys.length, 8);
  return `bob popped ana's decoy in ${popped.toFixed(2)} s (bob told he was fooled, ana told who); the boss shot a parked decoy down in ${((h.steps - t1) / Contract.SIM_HZ).toFixed(1)} s`;
});

test("v1.3 mischief: a rock hit while being pulled hurts, credited to the puller; a pull kill is a kill", () => {
  const h = harness(27);
  h.w.join("ana"); h.w.join("cy");
  h.w.start();
  const rocks = h.dbg().rocks; rocks.splice(0);
  h.w.setEntity("ana", "ship", mischiefKit);
  lineUp(h, { ana: 0, cy: 100 });
  const cy = h.p("cy");
  cy.hp = 25;
  press(h, "ana", "tractor"); h.step();
  h.wait(0.3);
  const from = h.steps;
  rocks.push({ id: 99999, pos: { ...cy.pos }, size: 4, type: "stone", health: 1 });
  h.step();
  assert(cy.dead, "cy slammed into a rock while pulled");
  assert.deepStrictEqual([h.p("ana").score, cy.score], [SCORING.kill, Math.max(0, SCORING.hitByRock + SCORING.killed)]); // floored at 0 (v1.3)
  assert(h.announces(from).includes("ana ✕ cy 🧲"));
  return "pulled into a rock: 30 damage credited to ana, a kill (+200), kill feed 🧲";
});

test("v1.6 auto-land (owner 12:07): a plain ship flying into the open planet lands, no legs, no LAND button, no LAND hint", () => {
  const h = harness(24);
  for (const n of ["ana", "bob"]) h.w.join(n);
  h.w.start();
  h.until("GO", () => h.w.tickMessage().countdown === 0 || h.w.tickMessage().countdown == null, 5);
  const p = h.p("ana");
  assert.deepStrictEqual(p.entity.unlocked, [], "ana flies a plain ship: nothing drawn");
  assert(!p.entity.verbs.includes("land"), "no land skill");
  assert.strictEqual(h.dbg().planet, null, "no planet before the boss dies");
  killBoss(h, "cy");
  const pl = h.dbg().planet;
  const from = h.steps;
  // 90 m from the centre (50 m off the surface) for 32 s: the old LAND gate; no hint of any kind about landing now.
  h.wait(32, () => { const a = ((h.steps - from) / Contract.SIM_HZ) * 0.2; p.pos = { x: pl.x + Math.cos(a) * 90, y: pl.y, z: pl.z + Math.sin(a) * 90 }; });
  assert.strictEqual(p.mode, "space", "circling 50 m off the surface does not land");
  assert.deepStrictEqual(h.toasts("ana", from).filter((t) => t.gate === "land" || t.verb === "land").map((t) => t.text), [], "no LAND hint, card or refusal");
  // Nose at the planet from 30 m off the surface, no input: the cruise carries the ship in; touching it lands.
  p.pos = { x: pl.x + pl.radius + 30, y: pl.y, z: pl.z }; p.yaw = Math.PI / 2; p.pitch = 0;
  const t0 = h.steps;
  h.until("ana touches the planet", () => p.landingFor > 0, 10);
  const touch = ((h.steps - t0) * DT).toFixed(2), off = dist(p.pos, pl) - pl.radius;
  assert(off <= 1.5 + 2 + 1e-6, `the landing starts at the surface (${off.toFixed(2)} m off)`);
  h.step(); h.step();
  const bay = tickOf(h, "ana").bay;
  h.until("ana lands", () => p.mode === "planet" && !p.landingFor, T.planet.landingSeconds + 1);
  const car = h.dbg().parked.find((c) => c.player === "ana");
  assert(bay && Math.abs(bay[0] - car.x) < 0.1 && Math.abs(bay[1] - car.z) < 0.1, `tick bay ${bay} = parked ${car.x},${car.z}`);
  assert(h.announces(t0).some((a) => a.startsWith("ana landed on the planet")), "the landing is announced");
  // A LAND button drawn without legs still lands in landing range (never a refusal): bob, 10 m off the surface.
  const bob = h.p("bob");
  h.w.setLayout("bob", LAYOUT);
  bob.pos = { x: pl.x - pl.radius - 10, y: pl.y, z: pl.z }; bob.yaw = Math.PI / 2; bob.pitch = 0; // facing away
  const b0 = h.steps;
  press(h, "bob", "land"); h.step();
  assert(bob.landingFor > 0, "LAND in range lands a plain ship");
  assert.strictEqual(h.toasts("bob", b0).filter((t) => t.verb === "land").length, 0, "no refusal toast");
  // Take-off is unchanged: the explorer takes off, back in space 15 m off the surface, flying away (no instant re-land).
  h.until("bob lands", () => bob.mode === "planet" && !bob.landingFor, T.planet.landingSeconds + 1);
  press(h, "ana", "takeoff");
  h.until("ana takes off", () => p.mode === "space" && !p.takeoffFor, T.planet.takeoffSeconds + 1);
  h.wait(1);
  assert(p.mode === "space" && !p.landingFor, "ana flies away after take-off");
  return `circled 50 m off for 32 s: no hint, no landing; flew in from 30 m: touched down after ${touch} s (${off.toFixed(2)} m off the surface), bay ${bay}; bob's LAND button with no legs lands in range`;
});

test("names and caps: a second device gets name2, the same device its ship back; 'constructor' is a name; 25 players at most (v1.3); floods are cut", () => {
  const h = harness(25);
  const a = h.w.join("ana", "device-aaaa-1111"), b = h.w.join("Ana", "device-bbbb-2222");
  assert.deepStrictEqual([a, b], [{ player: "ana", color: a.color }, { player: "ana2", color: b.color, renamed: true }]);
  assert.strictEqual(h.w.join("ana", "device-aaaa-1111").player, "ana", "the same device gets its ship back");
  assert.strictEqual(h.w.join("ana").player, "ana", "no device token: the old behaviour (same name, same ship)");
  assert.strictEqual(h.w.join("constructor").player, "constructor");
  h.w.join("tostring"); // v1.3: input never creates a player (finding #18)
  h.input("constructor", "boost", true); h.input("tostring", "boost", true);
  assert(h.p("constructor").keys && h.p("tostring").name === "tostring", "prototype names are plain names");
  assert.strictEqual(h.w.handleInput({ type: "input", player: "neverjoined", action: "boost", down: true }), false, "unknown name: false (409 join first)");
  assert.strictEqual(h.p("neverjoined"), undefined, "input never creates a player");
  for (let i = 0; i < 40; i++) h.w.join(`g${i}`);
  const humans = Object.values(h.w.players).filter((p) => !p.bot).length;
  assert.strictEqual(humans, 25, "25 players at most, humans and bots together (owner, 10 Oct 09:05)");
  assert.strictEqual(h.w.join("late"), null, "no room for a 26th");
  h.input("ghost", "boost", true);
  assert.strictEqual(h.p("ghost"), undefined, "a POST /input with a new name makes no player");
  h.w.start();
  h.w.setEntity("ana", "ship", devKit("ship"));
  const from = h.steps;
  for (let i = 0; i < 20; i++) press(h, "ana", "flare");
  assert.strictEqual(h.p("ana").pressed.length, 6, "at most 6 queued presses");
  h.step();
  h.wait(1, () => press(h, "ana", "flare"));
  const flares = h.msgs.filter((x) => x.at >= from && x.m.type === "fx" && x.m.kind === "flare").length;
  assert.strictEqual(flares, 1, "flare has a cooldown");
  return `ana2 for a second device; ${humans} humans max; 20 flare presses → 6 queued → ${flares} flare`;
});

test("drawing: while the draw sheet is open the ship hovers and nothing can hurt it, for at most 30 s; never stuck: a pad with no way to turn gets a steer stick", () => {
  const h = harness(28);
  h.w.join("ana"); h.w.join("bob");
  h.w.start();
  h.dbg().rocks.splice(0);
  h.w.setEntity("ana", "ship", mischiefKit); h.w.setEntity("bob", "ship", mischiefKit);
  lineUp(h, { ana: 0, bob: 300 });
  const ana = h.p("ana");
  h.input("ana", "boost", true);
  h.input("ana", "drawing", true);
  const z0 = ana.pos.z;
  h.wait(1);
  const speed = Math.abs(ana.pos.z - z0);
  assert(speed < T.cruiseSpeed - T.brakeSpeed + 0.5, `hovering at ${speed.toFixed(1)} m/s`);
  assert(h.lastTick.players.find((p) => p.name === "ana").flags.drawing, "tick flags drawing");
  h.input("bob", "emp", true); h.input("bob", "emp", false); h.step();
  assert.strictEqual(mischiefOf(h, 0).filter((m) => m.player === "ana").length, 0, "no mischief on a drawing player");
  ana.hp = 100;
  Object.assign(h.p("bob"), { pos: { x: 0, y: 0, z: ana.pos.z + 30 }, yaw: 0, pitch: 0 });
  h.input("bob", "shoot", true); h.wait(1); h.input("bob", "shoot", false);
  assert.strictEqual(ana.hp, 100, "bullets do nothing while drawing");
  h.input("ana", "shoot", true); h.step();
  assert(!ana.keys.shoot, "no control while drawing");
  h.input("ana", "drawing", false); h.step();
  assert(!h.w.tickMessage().players.find((p) => p.name === "ana").flags.drawing, "drawing up ends it");
  h.input("ana", "drawing", true); h.wait(29);
  assert(h.w.tickMessage().players.find((p) => p.name === "ana").flags.drawing, "still drawing at 29 s");
  h.wait(2);
  assert(!h.w.tickMessage().players.find((p) => p.name === "ana").flags.drawing, "it ends by itself after 30 s");
  // Never stuck (PLAN.md section 7).
  const noTurn = { buttons: [{ type: "button", action: "shoot", label: "FIRE", x: 0.7, y: 0.5, w: 0.2, h: 0.3 }, { type: "stick", action: "move", label: "", x: 0.6, y: 0.1, w: 0.2, h: 0.3 }], source: "model" };
  const fixed = withSteer(noTurn);
  const auto = fixed.buttons.find((b) => b.auto);
  assert(auto && auto.type === "stick" && auto.action === "steer" && auto.x < 0.5, "a steer stick, left side");
  assert(noTurn.buttons.every((b) => Math.max(b.x - (auto.x + auto.w), auto.x - (b.x + b.w), b.y - (auto.y + auto.h), auto.y - (b.y + b.h)) > 0), "clear of the drawn controls");
  assert.strictEqual(withSteer(LAYOUT), LAYOUT, "a pad that can turn is left alone");
  return `hover ${speed.toFixed(1)} m/s, immune to shots and EMP, ends on release or after 30 s; auto steer stick at ${auto.x},${auto.y} ${auto.w}×${auto.h}`;
});

test("explorers never step out onto water: every bay on 300 islands leaves them on dry land", () => {
  let wet = 0, total = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const h = harness(1000 + seed);
    h.w.join("ana");
    h.w.start();
    killBoss(h, "ana");
    landNow(h, "ana");
    const p = h.p("ana"), isl = h.dbg().island;
    const Terrain = require("../../terrain");
    total++;
    if (!(Terrain.height(p.pos.x, p.pos.z, isl.seed) > 0.3)) wet++;
  }
  assert.strictEqual(wet, 0, `${wet} of ${total} explorers stood in the water`);
  return `${total} landings, 0 in the water`;
});

// ---- v1.4: the owner's 09:05 decisions on the server ------------------------------------------------------------------

test("v1.4 countdown: START plays a 3-2-1 (tick.countdown 3, 2, 1); nothing moves or fires, bots wait; a joiner counts at GO", () => {
  const h = harness(61);
  h.w.join("ana"); h.w.setEntity("ana", "ship", devKit("ship"));
  for (let i = 1; i <= 4; i++) h.w.addBot(`bot${i}`);
  const startAt = h.steps;
  assert.strictEqual(h.w.start({ countdown: true }), true);
  assert.strictEqual(h.w.phase, "countdown");
  assert.strictEqual(h.w.countdown, 3);
  assert.strictEqual(h.w.start({ countdown: true }), false, "START during the countdown is a no-op");
  const wm = h.w.worldMessage();
  assert.strictEqual(wm.phase, "countdown"); assert.strictEqual(wm.countdown, 3, "a screen connecting now counts down at once");
  const startLine = h.msgs.find((x) => x.at >= startAt && x.m.type === "announce");
  assert(startLine && /starts in 3/.test(startLine.m.text) && !startLine.m.big, "the countdown line is for the feed, not a banner");
  const before = Object.fromEntries(Object.values(h.w.players).map((p) => [p.name, { ...p.pos }]));
  h.input("ana", "forward", true); h.input("ana", "shoot", true);
  const seen = [];
  const note = () => { const c = h.w.tickMessage().countdown; if (c !== undefined && c !== seen[seen.length - 1]) seen.push(c); };
  h.wait(1.4, note);
  for (const p of Object.values(h.w.players)) assert.deepStrictEqual(p.pos, before[p.name], `${p.name} waits for GO`);
  assert.strictEqual(h.dbg().bullets.length, 0, "no shots before GO");
  const hp0 = h.dbg().boss.maxHp;
  h.w.join("bob"); // during the 3-2-1
  h.until("GO", () => h.w.phase === "playing", 2, note);
  const goAt = h.dbg().t - h.dbg().phaseT; // sim seconds at GO
  assert.deepStrictEqual(seen, [3, 2, 1], "whole seconds left");
  assert.strictEqual(h.w.tickMessage().countdown, undefined, "no countdown field in play");
  assert.strictEqual(h.dbg().playerCount, 2, "bob, joined during the countdown, counts at GO (2 humans; v1.4: bots add no chest)");
  assert.strictEqual(h.dbg().boss.maxHp, bossHp(2 + 4 * T.boss.botWeight)); assert.notStrictEqual(hp0, h.dbg().boss.maxHp);
  assert.strictEqual(h.dbg().chests.length, chestCount(2));
  const goWorld = h.msgs.filter((x) => x.m.type === "world").pop().m;
  assert.strictEqual(goWorld.phase, "playing"); assert.strictEqual(goWorld.countdown, undefined);
  const atGo = Object.fromEntries(Object.values(h.w.players).map((p) => [p.name, { ...p.pos }]));
  h.wait(0.5);
  assert(dist(h.p("ana").pos, atGo.ana) > 5, "the held FORWARD counts from GO");
  assert(h.dbg().bullets.length > 0, "the held SHOOT fires from GO");
  assert(Object.values(h.w.players).filter((p) => p.bot).every((p) => dist(p.pos, atGo[p.name]) > 1), "bots fly from GO");
  const plain = harness(62); plain.w.join("ana");
  assert.strictEqual(plain.w.start(), true); assert.strictEqual(plain.w.phase, "playing", "world.start() without the countdown: at once (tests, --autostart)");
  return `countdown ${seen.join("-")} then GO at ${goAt.toFixed(2)} s; boss ${hp0} → ${h.dbg().boss.maxHp} HP after bob joined mid-countdown`;
});

test("v1.4 late hints: from 3:00 every human missing a gate skill gets one big DRAW X card (part first, then button); nothing is granted", () => {
  const h = harness(63);
  for (const n of ["ana", "bob", "cy", "dee"]) h.w.join(n);
  h.w.setEntity("ana", "ship", devKit("ship")); h.w.setLayout("ana", LAYOUT); // ready for every gate in space
  // bob: a plain ship (no gun). cy: a gun but no SHOOT button. dee: a plain ship and no drawing left.
  h.w.setEntity("cy", "ship", devKit("ship"));
  h.w.setLayout("cy", { buttons: [{ type: "stick", action: "steer", label: "", x: 0.04, y: 0.4, w: 0.3, h: 0.55 }], source: "model" });
  h.w.start();
  for (let i = 0; i < 5; i++) h.w.spendDrawing("dee", "space");
  // Idle ships cruise into the boss fight and die there (a dead player gets no card until the respawn): keep every ship
  // where it is, at full health, while the test waits.
  const names = ["ana", "bob", "cy", "dee"];
  let home = {};
  const keep = () => { home = Object.fromEntries(names.map((n) => [n, { ...h.p(n).pos }])); };
  const pin = () => { for (const n of names) { const p = h.p(n); if (p.mode === "space" && !p.dead) { p.pos = { ...home[n] }; p.hp = T.shipHp; } } };
  keep();
  const from = h.steps;
  h.until("assists", () => h.w.phase === "assists", 181, pin);
  const assistsAt = h.steps;
  h.wait(0.5, pin);
  const late = (name) => h.toasts(name, from).filter((t) => t.late);
  assert.strictEqual(late("ana").length, 0, "ana has a gun and a SHOOT button");
  assert.strictEqual(late("dee").length, 0, "dee has no drawing left: no card to draw");
  const [b] = late("bob");
  assert(b && b.at - assistsAt <= 1, "bob's card comes at 3:00");
  assert.deepStrictEqual([b.kind, b.need, b.gate, b.title, b.part, b.on, b.ghost], ["hint", "part", "weapon", "DRAW A GUN", "gun", "ship", null]);
  const [c] = late("cy");
  assert.deepStrictEqual([c.need, c.title, c.on, c.ghost && c.ghost.action], ["button", "DRAW A SHOOT BUTTON", "controller", "shoot"]);
  assert(!h.p("bob").entity.verbs.includes("shoot") && h.p("bob").entity.assisted === undefined, "nothing is granted");
  h.wait(8, pin);
  assert.strictEqual(late("bob").length, 1, "one card per gate and need");
  killBoss(h, "ana");
  keep();
  h.wait(7, pin);
  // v1.6 (owner 12:07): no LAND gate: with the boss down a plain ship just flies into the planet, no card for legs.
  assert.strictEqual(late("bob").length, 1, "the boss is down: no DRAW LANDING LEGS card");
  landNow(h, "ana");
  h.wait(0.5, pin);
  const ana = late("ana");
  assert.strictEqual(ana.length, 1, "ana landed with a plain explorer");
  assert.deepStrictEqual([ana[0].title, ana[0].parts, ana[0].on], ["DRAW A SHOVEL AND A DRILL", ["shovel", "drill"], "explorer"], "both parts in one redraw");
  h.w.setEntity("ana", "explorer", devKit("explorer"));
  h.wait(7, pin);
  assert.strictEqual(late("ana").length, 1, "ana now digs and drills with DIG and DRILL buttons: no more cards");
  assert.strictEqual(h.toasts("ana", from).filter((t) => t.kind === "hint" && t.step === 3).length, 1, "the ladder does not repeat the card's answer");
  return `bob: ${late("bob").map((t) => t.title).join(" → ")}; cy: ${c.title}; ana on the island: ${ana[0].title}`;
});

test("v1.4 seats: humans and bots never exceed 25; a human takes the newest bot's seat; an idle human back in a room of 25 humans is refused", () => {
  const h = harness(64);
  for (let i = 1; i <= 25; i++) h.w.addBot(`bot${i}`);
  assert.strictEqual(h.w.addBot("bot26"), null, "no 26th bot");
  assert.strictEqual(h.w.join("ana").player, "ana");
  assert.strictEqual(h.p("bot25"), undefined, "the newest bot left for ana");
  assert.strictEqual(Object.keys(h.w.players).length, 25);
  for (let i = 0; i < 30; i++) h.w.join(`h${i}`);
  const all = Object.values(h.w.players);
  assert.strictEqual(all.length, 25); assert.strictEqual(all.filter((p) => p.bot).length, 0, "every bot gave its seat to a human");
  h.p("ana").lastSeen = Date.now() - 11 * 60 * 1000; // idle for 11 minutes: the seat is free
  assert.strictEqual(h.w.join("zed").player, "zed");
  assert.strictEqual(h.w.join("ana"), null, "ana is back but 25 humans are playing: the game is full");
  assert.strictEqual(h.w.seat("ana"), false);
  assert.strictEqual(h.w.handleInput({ type: "input", player: "ana", action: "boost", down: true }), false, "409 join first, then the full answer");
  assert.strictEqual(h.w.seat("zed"), true);
  return `25 bots → 1 human + 24 bots → 25 humans; a 26th refused`;
});

// ---- v1.8 loot (owner, 10 Oct 13:00 / 13:02; contract.js TUNING.loot) ---------------------------------------------------

const L = T.loot;
// A started round with ana (dev kit ship) hovering (BACK held) with nothing within `clear` m; bob plain, unless asked.
function lootRound(seed, { bob = false, clear = 90 } = {}) {
  const h = harness(seed);
  h.w.join("ana"); h.w.setEntity("ana", "ship", devKit("ship"));
  if (bob) h.w.join("bob");
  h.w.start();
  const ana = h.p("ana");
  ana.pos = { x: 0, y: 0, z: 0 }; ana.yaw = 0; ana.pitch = 0; ana.spawnShield = 0;
  h.input("ana", "back", true);
  const rocks = h.dbg().rocks;
  for (let i = rocks.length - 1; i >= 0; i--) if (Math.hypot(rocks[i].pos.x, rocks[i].pos.y, rocks[i].pos.z) < clear) rocks.splice(i, 1);
  if (bob) { const b = h.p("bob"); b.pos = { x: 30, y: 0, z: 0 }; b.yaw = 0; b.pitch = 0; b.spawnShield = 0; h.input("bob", "back", true); }
  return h;
}
const ownBullets = (h, name) => h.dbg().bullets.filter((b) => b.owner === name);
function grab(h, name, kind) {
  const from = h.steps, k = h.w.spawnPickup(kind, h.p(name).pos);
  h.step();
  assert(!h.dbg().pickups.includes(k), `${kind} collected at once`);
  const toast = h.toasts(name, from).find((t) => t.pickup === kind);
  assert(toast, `${name} got a ${kind} toast`);
  return toast;
}

test("v1.8 loot: a destroyed crystal drops a pickup; a ship flying through it collects it (toast, sparkle fx, quiet feed line)", () => {
  const h = lootRound(81);
  const was = L.dropChance.crystal;
  L.dropChance.crystal = 1;
  try {
    const ana = h.p("ana");
    const rock = { id: 99999, pos: { x: 0, y: 0, z: -40 }, size: 3, type: "crystal", health: 2 };
    h.dbg().rocks.push(rock);
    h.input("ana", "shoot", true);
    h.until("the crystal breaks", () => !h.dbg().rocks.includes(rock), 3);
    h.input("ana", "shoot", false);
    const [k] = h.dbg().pickups;
    assert(k && Contract.LOOT_KINDS.includes(k.kind), "one pickup where the crystal was");
    assert(dist(k.pos, rock.pos) < 3, "it floats where the rock was");
    assert.strictEqual(ana.score, SCORING.crystal);
    h.step(); h.step();
    const seen = h.lastTick.pickups.find((x) => x[0] === k.id);
    assert(seen && Contract.LOOT_KINDS[seen[1]] === k.kind && seen.length === 5, "tick.pickups carries [id, kind, x, y, z]");
    assert(h.w.worldMessage().pickups.some((x) => x[0] === k.id), "and so does the world message");
    const from = h.steps;
    h.input("ana", "back", false); // cruise into it
    h.until("ana collects it", () => !h.dbg().pickups.includes(k), 5);
    const fx = h.msgs.filter((x) => x.at >= from && x.m.type === "fx" && x.m.kind === "pickup").map((x) => x.m);
    assert(fx.length === 1 && fx[0].player === "ana" && fx[0].item === k.kind && fx[0].color === L.kinds[k.kind].color, "one sparkle fx for ana");
    const toast = h.toasts("ana", from).find((t) => t.pickup === k.kind);
    assert(toast && toast.kind === "info" && toast.text.startsWith(L.kinds[k.kind].icon), `ana's toast: ${toast && toast.text}`);
    const line = h.msgs.find((x) => x.at >= from && x.m.type === "announce" && x.m.quiet);
    assert(line && !line.m.big && line.m.text.includes("ana"), "a quiet feed line for the TV");
    return `crystal → ${k.kind}, collected after ${((h.steps - from) / Contract.SIM_HZ).toFixed(2)} s: "${toast.text}"`;
  } finally { L.dropChance.crystal = was; }
});

test("v1.8 loot: drop table (stone 25%, crystal 60%, crystals favour uncommon/rare), drift, 20 s life, 24 alive at most, magnet pull", () => {
  const { rollLoot } = require("../../world");
  const rnd = mulberry32(7), tiers = (type) => {
    const n = { common: 0, uncommon: 0, rare: 0 };
    for (let i = 0; i < 20000; i++) n[L.kinds[rollLoot(type, rnd)].tier]++;
    return n;
  };
  const s = tiers("stone"), c = tiers("crystal");
  assert(s.common > s.uncommon && s.uncommon > s.rare, `stone mostly common ${JSON.stringify(s)}`);
  assert(c.uncommon + c.rare > 3 * (s.uncommon + s.rare) / 2 && c.rare > 3 * s.rare, `crystals favour uncommon and rare ${JSON.stringify(c)}`);
  const h = lootRound(82);
  const far = { x: 300, y: 0, z: 300 };
  const k = h.w.spawnPickup("gems", far);
  h.wait(2);
  const drift = dist(k.pos, far);
  assert(drift > 1 && drift < 3, `drifts a little (${drift.toFixed(2)} m in 2 s)`);
  for (let i = 0; i < 30; i++) h.w.spawnPickup("gems", { x: 300 + i * 10, y: 0, z: 300 });
  assert.strictEqual(h.dbg().pickups.length, L.max, "at most 24 alive: the oldest make room");
  assert(!h.dbg().pickups.includes(k), "the oldest went first");
  h.wait(L.life + 0.1);
  assert.strictEqual(h.dbg().pickups.length, 0, "gone after 20 s");
  // magnet: 11 m off the side is pulled in; 20 m is not (12 m range)
  const ana = h.p("ana");
  const near = h.w.spawnPickup("gems", { x: ana.pos.x + 11, y: ana.pos.y, z: ana.pos.z });
  const out = h.w.spawnPickup("gems", { x: ana.pos.x - 20, y: ana.pos.y, z: ana.pos.z });
  h.wait(1);
  assert(!h.dbg().pickups.includes(near) && h.dbg().pickups.includes(out), "pulled from 11 m, not from 20 m");
  return `stone ${JSON.stringify(s)}, crystal ${JSON.stringify(c)} of 20000; drift ${drift.toFixed(1)} m / 2 s`;
});

test("v1.8 loot: REPAIR, SHIELD bubble (stacks to 12 s, rams and hits bounce), BOOST, GEMS, +1 DRAWING, WARP", () => {
  const h = lootRound(83, { bob: true });
  const ana = h.p("ana");
  ana.hp = 30; grab(h, "ana", "repair"); assert.strictEqual(ana.hp, 30 + L.kinds.repair.hp);
  ana.hp = 90; grab(h, "ana", "repair"); assert.strictEqual(ana.hp, T.shipHp, "never above full");
  ana.boostEnergy = 0.05; ana.boostLocked = true; grab(h, "ana", "boost");
  assert(ana.boostEnergy === 1 && !ana.boostLocked, "a full tank");
  const s0 = ana.score; const gems = grab(h, "ana", "gems");
  assert.strictEqual(ana.score - s0, L.kinds.gems.points); assert.strictEqual(gems.text, "💎 +75");
  const full = grab(h, "ana", "draw");
  assert(/FULL/.test(full.text) && ana.score - s0 === L.kinds.gems.points + L.kinds.draw.fullPoints, `a full budget pays points: ${full.text}`);
  h.w.spendDrawing("ana", "space"); h.w.spendDrawing("ana", "space");
  grab(h, "ana", "draw");
  assert.strictEqual(h.w.drawingsLeft("ana").space, T.drawings.space - 1, "+1 drawing in space");
  const sh = grab(h, "ana", "shield");
  assert.strictEqual(sh.text, "🛡️ +SHIELD · 6s"); assert.strictEqual(sh.seconds, 6);
  grab(h, "ana", "shield"); grab(h, "ana", "shield");
  h.step(); h.step();
  const f = h.lastTick.players.find((p) => p.name === "ana").flags;
  assert(f.shield && f.bubble > 11 && f.bubble <= 12, `stacks to 12 s (${f.bubble})`);
  assert(!ana.shielding, "not a held shield: it can still shoot");
  const rock = { id: 99998, pos: { ...ana.pos }, size: 2, type: "stone", health: 1 };
  const sc = ana.score; h.dbg().rocks.push(rock); h.step();
  assert(!h.dbg().rocks.includes(rock) && ana.stun <= 0 && ana.score === sc, "a ram bounces off the bubble");
  h.w.setEntity("bob", "ship", devKit("ship"));
  const bob = h.p("bob"); bob.pos = { x: 0, y: 0, z: 30 }; bob.yaw = 0;
  h.input("bob", "shoot", true); h.wait(1); h.input("bob", "shoot", false);
  assert.strictEqual(ana.hp, T.shipHp, "bob's shots bounce off the bubble");
  h.wait(12);
  assert(!h.lastTick.players.find((p) => p.name === "ana").flags.bubble, "the bubble ends");
  const at = { ...ana.pos };
  const w = grab(h, "ana", "warp");
  const moved = dist(at, ana.pos);
  assert(moved >= 10 && moved <= L.kinds.warp.distance + 1 && ana.pos.z < at.z, `warped ${moved.toFixed(1)} m ahead (${w.text})`);
  assert(h.dbg().rocks.every((r) => dist(r.pos, ana.pos) >= r.size + L.kinds.warp.clear), "clear of every rock");
  return `repair, boost, gems ${gems.text}, ${full.text}, shield ${f.bubble} s, warp ${moved.toFixed(0)} m`;
});

test("v1.8 loot: RAPID FIRE doubles a drawn gun's fire rate (a plain ship still cannot shoot); one timed slot; OVERDRIVE and MAGNET", () => {
  const h = lootRound(84, { bob: true });
  const ana = h.p("ana"), bob = h.p("bob");
  const fired = (name, seconds) => { const ids = new Set(); h.input(name, "shoot", true); h.wait(seconds, () => ownBullets(h, name).forEach((b) => ids.add(b.id))); h.input(name, "shoot", false); h.wait(T.bulletLife + 0.2); return ids.size; };
  const normal = fired("ana", 2);
  const toast = grab(h, "ana", "rapid");
  assert.strictEqual(toast.text, "🔥 RAPID FIRE · 8s");
  const rapid = fired("ana", 2);
  assert(rapid >= 1.8 * normal, `rapid fire ${rapid} shots in 2 s vs ${normal}`);
  grab(h, "bob", "rapid");
  assert.strictEqual(fired("bob", 1), 0, "no drawn gun: still no shots");
  // one timed slot: OVERDRIVE replaces RAPID FIRE; a plain ship boosts with a full tank, no exhaust drawn
  grab(h, "bob", "overdrive");
  h.input("bob", "back", false);
  h.step(); h.step();
  const fb = h.lastTick.players.find((p) => p.name === "bob").flags;
  assert(fb.powerup && fb.powerup.kind === "overdrive" && fb.powerup.left > 7.5 && fb.boost, `bob in OVERDRIVE ${JSON.stringify(fb)}`);
  const z0 = bob.pos.z; h.wait(1);
  const speed = z0 - bob.pos.z;
  assert(Math.abs(speed - T.cruiseSpeed * T.boostMultiplier) < 1.5 && bob.boostEnergy === 1, `boost speed ${speed.toFixed(1)} m/s, tank full`);
  h.wait(7.2);
  assert(!bob.power && !h.lastTick.players.find((p) => p.name === "bob").flags.powerup, "over after 8 s");
  // MAGNET ×4: a pickup 40 m away comes in
  grab(h, "ana", "magnet");
  assert(ana.power.kind === "magnet", "MAGNET replaced RAPID FIRE");
  const g = h.w.spawnPickup("gems", { x: ana.pos.x + 40, y: ana.pos.y, z: ana.pos.z });
  h.wait(1.5);
  assert(!h.dbg().pickups.includes(g), "MAGNET pulls from 40 m");
  return `${normal} → ${rapid} shots / 2 s; overdrive ${speed.toFixed(1)} m/s`;
});

test("v1.8 loot: MEGA BLAST's next shot hits the boss for 312 and blasts rivals nearby; HOMING curves a near miss in; GHOST lets rival shots through", () => {
  const h = lootRound(85, { bob: true });
  const ana = h.p("ana"), bob = h.p("bob"), b = h.dbg().boss;
  b.hp = b.maxHp = 5000;
  ana.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z + b.radius + 20 };
  bob.pos = { x: b.pos.x + 10, y: b.pos.y, z: b.pos.z + b.radius + 4 };
  const toast = grab(h, "ana", "mega");
  assert.strictEqual(toast.text, "💥 MEGA BLAST · next shot");
  const one = () => { h.input("ana", "shoot", true); h.step(); h.input("ana", "shoot", false); h.wait(0.4); };
  const d0 = b.damageBy.ana || 0, hp0 = bob.hp;
  one();
  const mega = (b.damageBy.ana || 0) - d0;
  assert.strictEqual(mega, T.bulletDamage + L.kinds.mega.bossDamage, `the mega shot dealt ${mega}`);
  assert(!ana.power, "spent");
  assert(hp0 - bob.hp >= L.kinds.mega.damage, `bob ${Math.round(Math.hypot(10, 4))} m from the impact lost ${hp0 - bob.hp}`);
  const d1 = b.damageBy.ana; one();
  assert.strictEqual(b.damageBy.ana - d1, T.bulletDamage, "the next shot is a normal one");
  // HOMING: bob 80 m ahead, 9 m to the side, far from the boss: a plain shot misses, a homing one hits
  const h2 = lootRound(86, { bob: true });
  const a2 = h2.p("ana"), b2 = h2.p("bob");
  b2.pos = { x: 9, y: 0, z: -80 };
  const shot = () => { h2.input("ana", "shoot", true); h2.step(); h2.input("ana", "shoot", false); h2.wait(1); };
  shot();
  assert.strictEqual(b2.hp, T.shipHp, "a plain shot misses");
  grab(h2, "ana", "homing");
  b2.pos = { x: 9, y: 0, z: -80 }; a2.pos = { x: 0, y: 0, z: 0 };
  shot();
  assert.strictEqual(b2.hp, T.shipHp - T.bulletDamage, "the homing shot curves into bob");
  // GHOST: bob's shots pass through ana (not used up), until it ends
  h2.w.setEntity("bob", "ship", devKit("ship"));
  grab(h2, "ana", "ghost");
  a2.pos = { x: 0, y: 0, z: 0 }; b2.pos = { x: 0, y: 0, z: 30 }; b2.yaw = 0; b2.pitch = 0; a2.hp = T.shipHp;
  h2.input("bob", "shoot", true); h2.wait(1.5);
  assert.strictEqual(a2.hp, T.shipHp, "rival shots pass through a ghost");
  assert(ownBullets(h2, "bob").some((x) => x.pos.z < a2.pos.z - 5), "and fly on past");
  h2.wait(4);
  assert(a2.hp < T.shipHp, "after 5 s they hit again");
  return `mega ${mega} to the boss, bob -${hp0 - bob.hp}; homing hit at 9 m off the line; ghost 5 s`;
});

test("v1.8 loot: a tick with 25 players, 24 pickups and 12 power-ups on stays under 8 KB", () => {
  const room = (powered) => {
    const h = harness(87);
    h.w.join("ana"); h.w.setEntity("ana", "ship", devKit("ship"));
    for (let i = 1; i <= 24; i++) h.w.addBot(`bot${i}`);
    h.w.start();
    h.input("ana", "shoot", true);
    let max = 0;
    h.wait(30, () => {
      const live = h.dbg().pickups.length;
      for (let i = live; i < L.max; i++) h.w.spawnPickup(Contract.LOOT_KINDS[i % 12], { x: 1500 + i * 9, y: 300, z: 1500 });
      Object.values(h.w.players).slice(0, powered).forEach((p) => { if (!p.power) p.power = { kind: "overdrive", until: h.dbg().t + 8, seconds: 8 }; });
      if (h.lastTick) max = Math.max(max, Buffer.byteLength(JSON.stringify(h.lastTick)));
    });
    return max;
  };
  const half = room(12), all = room(25);
  assert(half < 8192, `max tick ${half} B`);
  return `max tick ${half} B with ${L.max} pickups and 12 power-ups (${all} B if all 25 had one)`;
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

// ---- v1.9.1 FLIGHT (owner, 10 Oct 14:16; contract.js TUNING.flight) ----------------------------------------------------
const FLT = T.flight;
const feet = (h, x, z) => Math.max(0, require("../../terrain").height(x, z, h.dbg().island.seed));
const jetpack = { type: "person", unlocked: [{ verb: "boost", part: "jetpack" }, { verb: "dig", part: "shovel" }], parts: [{ name: "jetpack", x: 0.5, y: 0.4 }, { name: "shovel", x: 0.2, y: 0.6 }], source: "model" };
function flyer(seed, entity = jetpack) {
  const h = harness(seed);
  h.w.join("ana");
  h.w.setEntity("ana", "explorer", entity);
  h.w.start();
  killBoss(h, "bob");
  landNow(h, "ana");
  const p = h.p("ana"), L = h.dbg().landing;
  p.pos = { x: L.x, y: feet(h, L.x, L.z), z: L.z }; p.yaw = 0;
  return { h, p };
}

test("v1.9.1 flight: a drawn jetpack unlocks FLY on the planet; hold FLY lifts, 1.5x walk, ≤ 40 m over the ground, 6 s of fuel, a gentle fall, 4 s recharge", () => {
  const { h, p } = flyer(12);
  assert(p.entity.verbs.includes("fly"), `verbs ${p.entity.verbs}`);
  const ent = h.entities("ana").pop();
  assert(ent.unlocked.some((u) => u.verb === "fly" && u.part === "jetpack") && /fly \(jetpack\)/.test(ent.card), ent.card);
  assert.strictEqual(tickOf(h, "ana").fuel, 1);
  const hp0 = p.hp;
  h.input("ana", "fly", true);
  h.wait(1);
  const up1 = p.pos.y - feet(h, p.pos.x, p.pos.z);
  const t1 = tickOf(h, "ana");
  assert(up1 > 4 && t1.flags.thrust && !t1.flags.glide && t1.fuel < 0.9, `1 s of FLY: ${up1.toFixed(1)} m up, ${JSON.stringify(t1.flags)} fuel ${t1.fuel}`);
  // fly forward at 1.5x walk while the jets fire
  const x0 = { ...p.pos };
  h.axis("ana", "move", 0, 1); h.wait(1); h.axis("ana", "move", 0, 0);
  const speed = dist2(x0, p.pos);
  assert(Math.abs(speed - T.island.walkSpeed * FLT.speed) < 1, `flight speed ${speed.toFixed(1)} m/s`);
  // keep holding: the tank empties at ~6 s, never above 40 m over the ground or 60 m
  let maxUp = 0, maxY = 0, s = 2;
  h.until("fuel runs out", () => p.fuel <= 0, 8, () => { s += DT; maxUp = Math.max(maxUp, p.pos.y - feet(h, p.pos.x, p.pos.z)); maxY = Math.max(maxY, p.pos.y); });
  assert(Math.abs(s - FLT.fuelSeconds) < 0.25 && maxUp <= FLT.ceiling + 0.5 && maxY <= FLT.maxY, `empty at ${s.toFixed(2)} s, ${maxUp.toFixed(1)} m up, y ${maxY.toFixed(1)}`);
  // empty: the jets cut out (still holding FLY), a gentle fall (≤ 6 m/s), no damage, then the ground
  h.step(); // the step that emptied the tank still fired the jets
  assert(!p.thrust && tickOf(h, "ana").flags.glide, "no glide flag after the tank empties");
  let minVy = 0, fall = 0;
  h.until("lands after the tank empties", () => !p.airborne, 20, () => { fall += DT; minVy = Math.min(minVy, p.vy); assert(!p.thrust, "the jets fire on an empty tank"); });
  assert(minVy >= -FLT.fall - 1e-9 && p.hp === hp0 && !p.dead, `fall ${minVy.toFixed(2)} m/s, hp ${p.hp}`);
  // still holding FLY on the ground: locked until relock is back, then a short hop; let go: full in ~4 s
  h.input("ana", "fly", false);
  const f0 = p.fuel;
  h.wait(FLT.rechargeSeconds);
  assert(f0 < 0.05 && p.fuel > 0.97, `recharge ${f0} → ${p.fuel}`);
  return `up ${up1.toFixed(1)} m after 1 s, ${speed.toFixed(1)} m/s, tank ${s.toFixed(2)} s, peak ${maxUp.toFixed(1)} m over the ground (y ≤ ${maxY.toFixed(1)}), fell ${fall.toFixed(1)} s at ≤ ${(-minVy).toFixed(1)} m/s, recharged in ${FLT.rechargeSeconds} s`;
});

test("v1.9.1 flight: no DIG in the air (a toast says land first), DIG on the ground; no chest pickup from high up; a flyer passes over a mine; FLY refused without a flight part", () => {
  const { h, p } = flyer(13);
  const c = h.dbg().chests.find((x) => x.kind === "buried");
  p.pos = { x: c.x + 1, y: feet(h, c.x + 1, c.z), z: c.z };
  h.input("ana", "fly", true); h.wait(1.5); h.input("ana", "fly", false);
  const from = h.steps;
  h.input("ana", "dig", true); h.wait(0.5);
  assert(c.dug === 0 && !p.digging && p.airborne, `dug ${c.dug} in the air`);
  assert(h.toasts("ana", from).some((t) => /land next to the chest first/.test(t.text)), "no land-first toast");
  h.until("lands", () => !p.airborne, 6);
  h.until("digs the chest open", () => !c.buried, 10);
  assert(c.open && c.by === "ana", "the chest is collected on the ground");
  // an open chest is not collected from high above, only by a low swoop
  const c2 = h.dbg().chests.find((x) => x.buried && x !== c);
  c2.buried = false;
  p.pos = { x: c2.x, y: feet(h, c2.x, c2.z) + 12, z: c2.z }; p.airborne = true; p.vy = 0;
  h.input("ana", "fly", true); h.wait(0.3); h.input("ana", "fly", false);
  assert(!c2.open, "collected from 12 m up");
  h.until("swoops down onto it", () => c2.open, 8);
  // a planet mine: a flyer passes over it, the feet on the ground set it off
  const M = { x: p.pos.x + 30, z: p.pos.z };
  const mine = { id: 9999, owner: "bob", mode: "planet", pos: { x: M.x, y: feet(h, M.x, M.z), z: M.z }, until: Infinity, armedAt: 0, color: 0xff0000, damage: 10 };
  h.dbg().mines.push(mine);
  p.pos = { x: M.x, y: mine.pos.y + 10, z: M.z }; p.airborne = true; p.vy = 0;
  h.input("ana", "fly", true); h.wait(0.5); h.input("ana", "fly", false);
  assert(h.dbg().mines.includes(mine), "a flyer set off the mine");
  h.until("lands on the mine", () => !h.dbg().mines.includes(mine), 8);
  assert(p.stun > 0 || p.dead, "the mine did nothing on the ground");
  // without a flight part: refused with what to draw; a model-sent fly (wings) and a propeller part both fly
  const plain = flyer(14, { type: "person", unlocked: [{ verb: "dig", part: "shovel" }], parts: [{ name: "shovel", x: 0.2, y: 0.5 }], source: "model" });
  plain.h.input("ana", "fly", true); plain.h.wait(1);
  assert(!plain.p.airborne && plain.p.pos.y - feet(plain.h, plain.p.pos.x, plain.p.pos.z) < 0.1 && tickOf(plain.h, "ana").fuel === undefined, "a plain explorer flew");
  assert(plain.h.toasts("ana").some((t) => t.kind === "refused" && /FLY · draw a jetpack or wings/.test(t.text)), "no FLY refusal");
  for (const ent of [{ type: "car", unlocked: [{ verb: "fly", part: "wings" }], parts: [], source: "model" }, { type: "quadruped", unlocked: [], parts: [{ name: "propeller", x: 0.5, y: 0.2 }], source: "model" }]) {
    const f = flyer(15, ent);
    f.h.input("ana", "fly", true); f.h.wait(1);
    assert(f.p.entity.verbs.includes("fly") && f.p.pos.y - feet(f.h, f.p.pos.x, f.p.pos.z) > 4, `${ent.type} did not fly`);
  }
  // a ship pressing FLY hears it is a planet skill
  const sh = harness(16); sh.w.join("ana"); sh.w.start();
  sh.input("ana", "fly", true); sh.wait(0.2);
  assert(sh.toasts("ana").some((t) => /FLY · not here: only on the planet/.test(t.text)), "no space refusal");
  return `chest ${c.id} dug only on the ground, chest ${c2.id} taken by a low swoop, mine passed over at 10 m then set off on the ground`;
});

test("v1.9.1 flight: a tick with 25 explorers flying (fuel + flags) stays under 8 KB", () => {
  const h = harness(17);
  const names = Array.from({ length: 25 }, (_, i) => `flyer${i}`);
  for (const n of names) { h.w.join(n); h.w.setEntity(n, "explorer", jetpack); }
  h.w.start();
  killBoss(h, names[0]);
  const pl = h.dbg().planet;
  names.forEach((n, i) => { const p = h.p(n), a = (i / 25) * Math.PI * 2; p.pos = { x: pl.x + Math.cos(a) * (pl.radius + 10), y: pl.y, z: pl.z + Math.sin(a) * (pl.radius + 10) }; h.input(n, "land", true); h.input(n, "land", false); });
  h.until("25 explorers land", () => names.every((n) => h.p(n).mode === "planet" && !h.p(n).landingFor), 10);
  for (const n of names) h.input(n, "fly", true);
  h.maxTick = 0;
  h.wait(2);
  const t = h.w.tickMessage();
  assert(t.players.filter((q) => q.flags.thrust && q.fuel < 1).length === 25 && h.maxTick < 8192, `max tick ${h.maxTick} B`);
  return `max tick ${h.maxTick} B with 25 flying explorers`;
});

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed at ${new Date().toISOString()}`);
process.exit(passed === results.length ? 0 : 1);
