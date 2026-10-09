// Fast-forward tests of world.js: an expert round, a weak player's round, the LAND hint ladder and the scoring table.
// Run: node dev/netcode/sim-test.js
const assert = require("assert");
const Contract = require("../../contract");
const { createWorld, ghostBox, DEFAULT_LAYOUT } = require("../../world");

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
function harness(seed) {
  const h = { msgs: [], checked: { world: 0, tick: 0 }, steps: 0 };
  h.w = createWorld({
    random: mulberry32(seed),
    broadcast: (m) => {
      h.msgs.push({ at: h.steps, m });
      if (m.type === "world") { const e = Contract.CHECKS.world(m); assert.deepStrictEqual(e, [], "world message: " + e.join("; ")); h.checked.world++; }
    },
  });
  h.step = () => {
    if (h.w.phase === "playing" || h.w.phase === "assists") h.playClock = h.w.tickMessage().clock;
    h.w.step(DT); h.steps++;
    if (h.steps % (Contract.SIM_HZ / Contract.TICK_HZ) === 0) {
      const tick = h.w.tickMessage();
      const e = Contract.CHECKS.tick(tick);
      assert.deepStrictEqual(e, [], "tick message: " + e.join("; "));
      h.checked.tick++;
      h.lastTick = tick;
    }
  };
  h.until = (label, cond, maxSeconds, each) => {
    for (let i = 0; i < maxSeconds * Contract.SIM_HZ; i++) {
      if (cond()) return;
      if (each) each();
      h.step();
    }
    const who = Object.values(h.w.players).map((p) => `${p.name} ${p.mode} at ${Math.round(p.pos.x)},${Math.round(p.pos.y)},${Math.round(p.pos.z)} hp ${Math.round(p.hp)}${p.dead ? " dead" : ""} boss ${Math.round(dist(p.pos, h.dbg().boss.pos))} m`).join(", ");
    throw new Error(`timeout after ${maxSeconds} s: ${label} (phase ${h.w.phase}, clock ${h.w.tickMessage().clock}, armour ${h.dbg().boss.armour}, boss hp ${h.dbg().boss.hp}, ${who}, chests ${JSON.stringify(h.w.worldMessage().chests)})`);
  };
  h.wait = (seconds, each) => { for (let i = 0; i < seconds * Contract.SIM_HZ; i++) { if (each) each(); h.step(); } };
  h.clock = () => h.w.tickMessage().clock;
  h.dbg = () => h.w.debug();
  h.input = (player, action, down) => h.w.handleInput({ type: "input", player, action, down });
  h.axis = (player, axis, x, y) => h.w.handleInput({ type: "axis", player, axis, x, y });
  h.release = (player) => {
    for (const a of ["boost", "shoot", "shield", "drill", "dig", "forward", "back"]) h.input(player, a, false);
    h.axis(player, "steer", 0, 0); h.axis(player, "move", 0, 0);
  };
  h.toasts = (player, from = 0) => h.msgs.filter((x) => x.at >= from && x.m.type === "toast" && x.m.player === player).map((x) => ({ ...x.m, at: x.at }));
  h.since = (type, kind, from) => h.msgs.filter((x) => x.at >= from && x.m.type === type && (!kind || x.m.kind === kind));
  return h;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v) => Math.max(-1, Math.min(1, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Point the ship (or the walker) at a target using the steer stick; returns the remaining angle error.
function aim(h, name, target) {
  const p = h.w.players[name];
  const v = { x: target.x - p.pos.x, y: target.y - p.pos.y, z: target.z - p.pos.z };
  const yawErr = wrap(Math.atan2(-v.x, -v.z) - p.yaw);
  const pitchErr = p.mode === "space" ? Math.atan2(v.y, Math.hypot(v.x, v.z)) - p.pitch : 0;
  h.axis(name, "steer", clamp(-yawErr * 3), clamp(pitchErr * 3));
  return Math.hypot(yawErr, pitchErr);
}

const button = (action, box) => ({ buttons: [{ type: "button", action, label: action.toUpperCase(), ...(box || { x: 0.4, y: 0.05, w: 0.2, h: 0.18 }) }], source: "model" });
const bossOf = (h) => h.dbg().boss;
const surface = (h, name) => dist(h.w.players[name].pos, bossOf(h).pos) - bossOf(h).radius;

// Fly to the boss; hover close with "back" held (2 m/s) against its surface.
function flyTo(h, name, target, within, { boost = false, thrust = true } = {}) {
  h.until(`${name} reaches target`, () => dist(h.w.players[name].pos, target()) <= within, 120, () => {
    const d = dist(h.w.players[name].pos, target());
    aim(h, name, target());
    h.input(name, "boost", boost && d > within + 20);
    h.input(name, "forward", thrust && d > within + 3);
    h.input(name, "back", d <= within + 3);
  });
}

function stayAt(h, name, target) {
  aim(h, name, target);
  h.input(name, "forward", false);
  h.input(name, "back", true);
}

function walkTo(h, name, target, within, run) {
  h.until(`${name} walks to target`, () => dist2(h.w.players[name].pos, target) <= within, 60, () => {
    const err = aim(h, name, { ...target, y: 0 });
    h.axis(name, "move", 0, err < 0.5 ? 1 : 0);
    h.input(name, "boost", !!run);
  });
  h.axis(name, "move", 0, 0); h.axis(name, "steer", 0, 0); h.input(name, "boost", false);
}

const results = [];
function test(name, fn) {
  const t0 = Date.now();
  try { const info = fn(); results.push({ name, ok: true, ms: Date.now() - t0, info }); console.log(`PASS ${name} (${Date.now() - t0} ms) ${info || ""}`); }
  catch (err) { results.push({ name, ok: false }); console.log(`FAIL ${name}\n${err.stack}`); }
}

// (1) Expert: knows the route, boosts, adds DRILL, LAND and DIG in 10 s each, 15 s explorer prompt.
test("expert round", () => {
  const h = harness(42);
  const me = "jaume";
  const { color } = h.w.join(me);
  assert.strictEqual(h.w.phase, "lobby");
  h.wait(2);
  h.input(me, "ready", true);
  h.step();
  assert.strictEqual(h.w.phase, "playing", "all humans ready ends the lobby early");
  const lobbyEndedAt = h.steps;

  // Fly to the boss with boost.
  const bossPos = () => bossOf(h).pos;
  assert(Math.abs(Math.hypot(bossPos().x, bossPos().z) - T.nebula.distance) < 1, "boss sits at nebula.distance from spawn");
  flyTo(h, me, bossPos, T.boss.radius + 8, { boost: true });
  const reachedBoss = h.clock();

  // Lasers bounce off the armour: spark, no damage, DRILL nudge.
  const shotFrom = h.steps;
  h.until("laser bounces", () => h.since("fx", "spark", shotFrom).length > 0 && h.toasts(me).some((t) => /bounce/i.test(t.text)), 5, () => { stayAt(h, me, bossPos()); h.input(me, "shoot", aim(h, me, bossPos()) < 0.05); });
  h.input(me, "shoot", false);
  assert.strictEqual(bossOf(h).armour, T.boss.armour, "armour untouched by lasers");
  assert.strictEqual(bossOf(h).hp, T.boss.hp, "hp untouched by lasers");

  // 10 s to draw a DRILL button: turn away first so the ship cruises out of the boss's reach, then drill the armour off.
  h.release(me);
  h.wait(2, () => { const p = h.w.players[me]; aim(h, me, { x: 2 * p.pos.x - bossPos().x, y: p.pos.y, z: 2 * p.pos.z - bossPos().z }); });
  h.release(me);
  h.wait(8);
  h.w.setLayout(me, button("drill"), "button");
  flyTo(h, me, bossPos, T.boss.radius + 8, { boost: true });
  h.until("armour cracked", () => bossOf(h).armour === 0, 20, () => {
    stayAt(h, me, bossPos());
    h.input(me, "drill", true);
    h.input(me, "shield", h.w.players[me].hp < 60);
  });
  h.release(me);
  assert(h.msgs.some((x) => x.m.type === "world" && x.m.targets[0].cracked), "world says cracked");

  // Shoot it down; the last hit is worth bossLastHit.
  let before = h.w.players[me].score, delta = 0;
  h.until("boss destroyed", () => bossOf(h).dead, 20, () => {
    before = h.w.players[me].score;
    stayAt(h, me, bossPos());
    h.input(me, "shoot", aim(h, me, bossPos()) < 0.05);
  });
  delta = h.w.players[me].score - before;
  assert.strictEqual(delta, SCORING.bossLastHit, "boss last hit score");
  h.release(me);
  const bossDown = h.clock();

  // The planet appears at the boss position + planet.offset toward spawn.
  const planet = h.w.worldMessage().planet;
  assert(planet, "planet appears");
  const b = bossOf(h).pos;
  assert(Math.abs(dist(planet, b) - T.planet.offset) < 0.5 && Math.abs(Math.hypot(planet.x, planet.y, planet.z) - (T.nebula.distance ** 2 + b.y ** 2) ** 0.5 + T.planet.offset) < 1, "planet offset toward spawn");
  const landAt = planet.radius + planet.landRange;
  const fromPlanet = h.steps;
  flyTo(h, me, () => planet, landAt - 5, { boost: true });
  assert(h.toasts(me, fromPlanet).some((t) => /land/i.test(t.text)), "LAND nudge");
  h.release(me);
  h.wait(10);
  h.w.setLayout(me, button("land"), "button");
  flyTo(h, me, () => planet, landAt - 5, { boost: true });
  h.input(me, "land", true); h.step(); h.input(me, "land", false);
  h.release(me);
  assert.strictEqual(h.w.players[me].mode, "planet", "landed");
  const landed = h.clock();
  const dbg = h.dbg();
  assert(dist2(h.w.players[me].pos, dbg.landing) < 6, "at the landing spot");
  const chests = h.w.worldMessage().chests;
  assert.strictEqual(chests.length, 3);
  assert(chests.every((c) => c.buried && dist2(c, dbg.landing) <= T.island.chestSpread + 0.01), "3 buried chests within chestSpread");

  // 15 s explorer prompt, walk to the nearest chest, 10 s to draw DIG, dig, collect.
  h.wait(T.island.explorerDrawSeconds);
  const chest = chests.slice().sort((a, c) => dist2(a, h.w.players[me].pos) - dist2(c, h.w.players[me].pos))[0];
  const walkFrom = h.steps;
  walkTo(h, me, chest, 1.5, true);
  assert(h.toasts(me, walkFrom).some((t) => /buried/i.test(t.text)), "DIG nudge");
  h.wait(10);
  h.w.setLayout(me, button("dig"), "button");
  before = h.w.players[me].score;
  h.input(me, "dig", true);
  h.until("chest collected", () => h.w.phase === "scoreboard", 5);
  h.input(me, "dig", false);
  assert.strictEqual(h.w.players[me].score - before, SCORING.chest, "chest score");
  const won = h.playClock; // the clock on the step the chest was collected
  assert(h.msgs.some((x) => x.m.type === "announce" && x.m.big && /wins/.test(x.m.text)), "winner announced");
  assert(won <= 125, `finish time ${won} s is about 2:00 or less`);

  // Scoreboard 8 s, then the next lobby keeps players, colours and layouts.
  h.wait(ROUND.scoreboardSeconds + 0.1);
  assert.strictEqual(h.w.phase, "lobby");
  assert.strictEqual(h.w.round, 2);
  assert.strictEqual(h.w.players[me].color, color);
  assert(h.w.players[me].layout.buttons.some((x) => x.action === "dig"), "layout kept");
  assert.strictEqual(h.w.players[me].mode, "space");
  assert(h.checked.world > 3 && h.checked.tick > 100);
  return `reached boss ${reachedBoss}s, boss down ${bossDown}s, landed ${landed}s, won ${won}s, score ${h.w.players[me].score}, ${h.checked.world} world + ${h.checked.tick} ticks checked`;
});

// (2) Weak player: no boost, wanders for 100 s, adds each button only after hint step 3 (+10 s to draw it).
test("weak player round", () => {
  const h = harness(7);
  const me = "weak";
  h.w.join(me);
  h.until("lobby times out", () => h.w.phase === "playing", ROUND.lobbySeconds + 1);
  let turn = 0;
  h.wait(100, () => { if (h.steps % 90 === 0) turn = Math.sin(h.steps * 12.9898) ; h.axis(me, "steer", turn, -h.w.players[me].pitch); });
  h.release(me);

  const pending = {}; // gate -> step count when the drawn button lands
  let assistsAt = null, landedAt = null, deaths = 0, wasDead = false;
  const addAfterGhost = (gate) => {
    const has = h.w.players[me].layout && h.w.players[me].layout.buttons.some((x) => x.action === gate);
    if (has) return true;
    const ghost = h.toasts(me).find((t) => t.ghost && t.ghost.action === gate);
    if (ghost && pending[gate] == null) pending[gate] = h.steps + 10 * Contract.SIM_HZ;
    if (pending[gate] != null && h.steps >= pending[gate]) h.w.setLayout(me, button(gate, ghost.ghost), "button");
    return false;
  };
  h.until("weak player wins", () => h.w.phase === "scoreboard", 300, () => {
    if (h.w.phase === "assists" && assistsAt == null) assistsAt = h.lastTick ? h.clock() : null;
    const p = h.w.players[me];
    if (p.dead) { if (!wasDead) deaths++; wasDead = true; return; }
    wasDead = false;
    const boss = bossOf(h);
    h.input(me, "boost", false); h.input(me, "forward", false);
    if (p.mode === "space" && !boss.dead) {
      const d = surface(h, me);
      if (boss.armour > 0 && !addAfterGhost("drill")) {
        // Waiting for the hint: shoot at it from 30 m, then circle out of reach.
        const err = aim(h, me, boss.pos);
        h.input(me, "back", d < 30);
        h.input(me, "shoot", err < 0.05 && d < 60);
        if (d < 25) h.axis(me, "steer", 1, 0);
      } else if (boss.armour > 0) {
        aim(h, me, boss.pos);
        h.input(me, "back", d < 15);
        h.input(me, "drill", d < 12);
        h.input(me, "shield", p.hp < 50);
      } else {
        h.input(me, "drill", false);
        const err = aim(h, me, boss.pos);
        h.input(me, "back", d < 40);
        h.input(me, "shoot", err < 0.05);
      }
    } else if (p.mode === "space") {
      h.input(me, "shoot", false); h.input(me, "shield", false);
      const planet = h.dbg().planet;
      const d = dist(p.pos, planet);
      aim(h, me, planet);
      h.input(me, "back", d < planet.radius + planet.landRange);
      if (addAfterGhost("land") && d < planet.radius + planet.landRange) { h.input(me, "land", true); h.step(); h.input(me, "land", false); }
    } else {
      if (landedAt == null) landedAt = h.steps;
      const idle = (h.steps - landedAt) / Contract.SIM_HZ;
      if (idle < T.island.explorerDrawSeconds) { h.axis(me, "steer", 0, 0); h.axis(me, "move", 0, 0); return; }
      if (idle < T.island.explorerDrawSeconds + 15) { h.axis(me, "steer", 0.8, 0); h.axis(me, "move", 0, 0.6); return; } // walks in circles
      const chest = h.dbg().chests.slice().sort((a, c) => dist2(a, p.pos) - dist2(c, p.pos))[0];
      const err = aim(h, me, { x: chest.x, y: 0, z: chest.z });
      const near = dist2(chest, p.pos) <= 1.5;
      h.axis(me, "move", 0, !near && err < 0.5 ? 1 : 0);
      if (near && chest.buried) h.input(me, "dig", addAfterGhost("dig"));
    }
  });
  const won = h.playClock;
  assert.strictEqual(assistsAt != null, true, "assists switched on");
  assert(Math.abs(assistsAt - ROUND.assistsAt) < 0.2, `assists at ${assistsAt} s`);
  assert(h.msgs.some((x) => x.m.type === "world" && x.m.targets[0].armour === 0 && x.m.chests.every((c) => !c.buried)), "assists: no armour, chests up");
  assert(won > ROUND.assistsAt && won <= 300, `weak player won at ${won} s, within 300 s`);
  return `assists at ${assistsAt}s, won ${won}s, deaths ${deaths}, ${h.checked.world} world + ${h.checked.tick} ticks checked`;
});

// (3) LAND hint ladder: nudge, name it 8 s later, ghost box 8 s after that; stops after setLayout with a LAND button.
function toPlanetRange(seed, me) {
  const h = harness(seed);
  h.w.join(me);
  h.w.setLayout(me, { buttons: [...DEFAULT_LAYOUT.buttons, button("drill").buttons[0]], source: "model" });
  h.input(me, "ready", true); h.step();
  const bossPos = () => bossOf(h).pos;
  flyTo(h, me, bossPos, T.boss.radius + 8, { boost: true });
  h.until("cracked", () => bossOf(h).armour === 0, 20, () => { stayAt(h, me, bossPos()); h.input(me, "drill", true); h.input(me, "shield", h.w.players[me].hp < 60); });
  h.release(me);
  h.until("dead", () => bossOf(h).dead, 20, () => { stayAt(h, me, bossPos()); h.input(me, "shoot", aim(h, me, bossPos()) < 0.05); });
  h.release(me);
  const planet = h.dbg().planet;
  const from = h.steps;
  flyTo(h, me, () => planet, planet.radius + planet.landRange - 2);
  return { h, planet, from };
}

test("LAND hint ladder", () => {
  const me = "lander";
  const { h, planet, from } = toPlanetRange(3, me);
  h.wait(18, () => stayAt(h, me, planet));
  const land = h.toasts(me, from).filter((t) => /LAND|land/.test(t.text));
  assert.strictEqual(land.length, 3, "three steps: " + land.map((t) => t.text).join(" | "));
  assert.strictEqual(land[0].ghost, null);
  assert.strictEqual(land[1].text, "Draw a LAND button");
  assert(Math.abs((land[1].at - land[0].at) / Contract.SIM_HZ - 8) < 0.1 && Math.abs((land[2].at - land[1].at) / Contract.SIM_HZ - 8) < 0.1, "8 s apart");
  const g = land[2].ghost;
  assert(g && g.action === "land" && g.x >= 0 && g.y >= 0 && g.x + g.w <= 1 && g.y + g.h <= 1, "ghost box on the pad");
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  assert(h.w.players[me].layout.buttons.every((b) => !overlaps(g, b)), "ghost overlaps no button");
  h.w.setLayout(me, button("land", g), "button");
  assert(h.w.players[me].hints.land.done, "ladder stops after setLayout");

  // Stop early: a LAND button after step 2 means no step 3.
  const second = toPlanetRange(5, "early");
  second.h.wait(9, () => stayAt(second.h, "early", second.planet));
  assert.strictEqual(second.h.toasts("early", second.from).filter((t) => /land/i.test(t.text)).length, 2);
  second.h.w.setLayout("early", button("land"), "button");
  second.h.wait(12, () => stayAt(second.h, "early", second.planet));
  const after = second.h.toasts("early", second.from).filter((t) => /land/i.test(t.text));
  assert.strictEqual(after.length, 2, "no ghost after the LAND button exists");
  return `ghost ${JSON.stringify(g)}`;
});

// (4) Scoring table: rock, crystal (+heal), hit by rock, PvP kill.
test("scoring table", () => {
  const h = harness(11);
  h.w.join("a"); h.w.join("b");
  h.input("a", "ready", true); h.input("b", "ready", true); h.step();
  const a = h.w.players.a, b = h.w.players.b;
  const { rocks } = h.dbg();
  const ahead = (p, d) => ({ x: p.pos.x - Math.sin(p.yaw) * d, y: p.pos.y, z: p.pos.z - Math.cos(p.yaw) * d });
  for (const [type, points] of [["stone", SCORING.rock], ["crystal", SCORING.crystal]]) {
    const rock = h.dbg().rocks.find((r) => r.type === type);
    assert(rock, `a ${type} rock exists`);
    rock.pos = ahead(a, 40); rock.size = 3;
    a.hp = 50;
    const before = a.score;
    h.until(`${type} destroyed`, () => !h.dbg().rocks.includes(rock), 5, () => h.input("a", "shoot", true));
    h.input("a", "shoot", false);
    h.wait(1.5);
    assert.strictEqual(a.score - before, points, `${type} points`);
    if (type === "crystal") assert.strictEqual(a.hp, 50 + Contract.ROCK_TYPES.crystal.heal, "crystal heals");
  }
  assert(rocks.every((r) => ["stone", "crystal"].includes(r.type)), "only rockTypesInPlay");
  const rock = h.dbg().rocks[0];
  rock.pos = ahead(b, 3); rock.size = 3;
  let before = b.score;
  h.step();
  assert.strictEqual(b.score - before, SCORING.hitByRock, "hit by rock");
  assert(b.stun > 0, "stunned");
  h.wait(T.stunSeconds + 0.2);
  // PvP: park b in front of a and shoot until it dies.
  const ka = a.score, kb = b.score;
  h.until("b destroyed", () => b.dead, 10, () => { b.pos = ahead(a, 20); h.input("a", "shoot", true); });
  h.input("a", "shoot", false);
  assert.strictEqual(a.score - ka, SCORING.kill, "kill");
  assert.strictEqual(b.score - kb, SCORING.killed, "killed");
  h.wait(T.respawnSeconds + 0.1);
  assert(!b.dead && b.hp === T.shipHp, "respawned");
  return `a ${a.score}, b ${b.score}`;
});

// (5) Tick size: 8 bots plus one human holding fire for 120 s of play stay under 4 KB per tick.
test("tick size with 8 bots", () => {
  const h = harness(99);
  for (let i = 1; i <= 8; i++) h.w.addBot(`bot${i}`);
  h.w.join("gunner");
  h.input("gunner", "ready", true); h.step();
  let max = 0, bullets = 0, sum = 0, n = 0;
  h.wait(120, () => {
    h.input("gunner", "shoot", true);
    if (h.steps % 2) return;
    const tick = h.w.tickMessage();
    const bytes = Buffer.byteLength(JSON.stringify(tick));
    max = Math.max(max, bytes); sum += bytes; n++;
    bullets = Math.max(bullets, tick.bullets.length);
  });
  assert(max < 4096, `max tick ${max} B`);
  return `max ${max} B, avg ${Math.round(sum / n)} B, max ${bullets} bullets, ${n} ticks`;
});

// (6) Ghost box helper on the default pad and on a full pad.
test("ghost box", () => {
  const g = ghostBox(null, "dig");
  assert(g.w >= 0.22 && g.h >= 0.18, "big box on the default pad");
  const full = { buttons: [{ x: 0, y: 0, w: 1, h: 0.8 }] };
  const g2 = ghostBox(full, "dig");
  assert(g2.y >= 0.8, "fits in the empty strip");
  return `${JSON.stringify(g)} ${JSON.stringify(g2)}`;
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed at ${new Date().toISOString()}`);
process.exit(failed.length ? 1 : 0);
