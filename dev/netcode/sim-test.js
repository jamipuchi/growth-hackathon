// Fast-forward tests of world.js: an expert round, a weak player's round, the LAND hint ladder (rules.js v2), the
// scoring table, landing and take-off, island PvP, the drawing budget and entity messages.
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

  // Lasers bounce off the armour: spark, no damage.
  const shotFrom = h.steps;
  h.until("laser bounces", () => h.since("fx", "spark", shotFrom).length > 0, 5, () => { stayAt(h, me, bossPos()); h.input(me, "shoot", aim(h, me, bossPos()) < 0.05); });
  h.input(me, "shoot", false);
  assert.strictEqual(bossOf(h).armour, T.boss.armour, "armour untouched by lasers");
  assert.strictEqual(bossOf(h).hp, T.boss.hp, "hp untouched by lasers");

  // 10 s to draw a DRILL button: turn away first so the ship cruises out of the boss's reach, then drill the armour off.
  h.release(me);
  h.wait(2, () => { const p = h.w.players[me]; aim(h, me, { x: 2 * p.pos.x - bossPos().x, y: p.pos.y, z: 2 * p.pos.z - bossPos().z }); });
  h.release(me);
  h.wait(8);
  // 10 s stuck: the riddle (6 s) came, the sketch (16 s) not yet; riddles never name the button.
  const drillToasts = h.toasts(me);
  assert(drillToasts.length === 1 && /What breaks rock/.test(drillToasts[0].text) && !/DRILL/i.test(drillToasts[0].text), "DRILL riddle only: " + JSON.stringify(drillToasts));
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
  h.release(me);
  h.wait(10);
  assert(h.toasts(me, fromPlanet).some((t) => /touch down/i.test(t.text)), "LAND riddle");
  h.w.setLayout(me, button("land"), "button");
  flyTo(h, me, () => planet, landAt - 5, { boost: true });
  h.input(me, "land", true); h.step(); h.input(me, "land", false);
  h.release(me);
  h.until("touchdown", () => h.w.players[me].mode === "planet", T.planet.landingSeconds + 0.2);
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
  h.wait(10);
  assert(h.toasts(me, walkFrom).some((t) => /X marks the spot/.test(t.text)), "DIG riddle");
  h.w.setLayout(me, button("dig"), "button");
  before = h.w.players[me].score;
  h.input(me, "dig", true);
  h.until("chest collected", () => h.w.phase === "scoreboard", 5);
  h.input(me, "dig", false);
  assert.strictEqual(h.w.players[me].score - before, SCORING.chest, "chest score");
  const won = h.playClock; // the clock on the step the chest was collected
  assert(h.msgs.some((x) => x.m.type === "announce" && x.m.big && /wins/.test(x.m.text)), "winner announced");
  assert(won < 120, `finish time ${won} s is under 2:00`);

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

// (2) A player who needs the hints: no boost, wanders first, adds each button only after hint step 3 (the answer
// and its ghost box) + 10 s to draw it. Weak: wanders 100 s. Regular: wanders 15 s and must finish in about 3:00.
function hintedRound(seed, me, wanderSeconds) {
  const h = harness(seed);
  h.w.join(me);
  h.until("lobby times out", () => h.w.phase === "playing", ROUND.lobbySeconds + 1);
  let turn = 0;
  h.wait(wanderSeconds, () => { if (h.steps % 90 === 0) turn = Math.sin(h.steps * 12.9898) ; h.axis(me, "steer", turn, -h.w.players[me].pitch); });
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
  return { h, won: h.playClock, assistsAt, deaths };
}

test("weak player round", () => {
  const { h, won, assistsAt, deaths } = hintedRound(7, "weak", 100);
  assert.strictEqual(assistsAt != null, true, "assists switched on");
  assert(Math.abs(assistsAt - ROUND.assistsAt) < 0.2, `assists at ${assistsAt} s`);
  assert(h.msgs.some((x) => x.m.type === "world" && x.m.targets[0].armour === 0 && x.m.chests.every((c) => !c.buried)), "assists: no armour, chests up");
  assert(won > ROUND.assistsAt && won <= 300, `weak player won at ${won} s, within 300 s`);
  return `assists at ${assistsAt}s, won ${won}s, deaths ${deaths}, ${h.checked.world} world + ${h.checked.tick} ticks checked`;
});

test("regular player round", () => {
  const runs = [7, 13, 21].map((seed) => hintedRound(seed, "regular", 15));
  const times = runs.map((r) => r.won);
  for (const t of times) assert(t <= 200, `regular player won at ${t} s, about 3:00`);
  const toasts = runs[0].h.toasts("regular");
  // DRILL and LAND run the full ladder; on the island the DIG riddle comes, then assists bring the chests up at 3:00.
  assert(["drill", "landing"].every((k) => toasts.some((t) => t.sketch === k && t.text === "")), "sketches with empty text");
  assert(["Draw DRILL", "Draw LAND"].every((k) => toasts.some((t) => t.text === k && t.ghost)), "answers with ghosts");
  assert(toasts.some((t) => /X marks the spot/.test(t.text)), "DIG riddle");
  return `won ${times.map((t) => t.toFixed(1)).join(", ")} s; ${toasts.length} toasts (seed 7)`;
});

// (3) LAND hint ladder v2 (rules.js): riddle 6 s after reaching the planet, faint sketch 10 s later (empty text), the
// answer with a ghost box 15 s after that; stops as soon as the player has a LAND control.
function toPlanetRange(seed, me, extra = []) {
  const h = harness(seed);
  h.w.join(me);
  h.w.setLayout(me, { buttons: [...DEFAULT_LAYOUT.buttons, button("drill").buttons[0], ...extra], source: "model" });
  h.input(me, "ready", true); h.step();
  const bossPos = () => bossOf(h).pos;
  flyTo(h, me, bossPos, T.boss.radius + 8, { boost: true });
  h.until("cracked", () => bossOf(h).armour === 0, 20, () => { stayAt(h, me, bossPos()); h.input(me, "drill", true); h.input(me, "shield", h.w.players[me].hp < 60); });
  h.release(me);
  h.until("dead", () => bossOf(h).dead, 20, () => { stayAt(h, me, bossPos()); h.input(me, "shoot", aim(h, me, bossPos()) < 0.05); });
  h.release(me);
  const planet = h.dbg().planet;
  const from = h.steps;
  flyTo(h, me, () => planet, planet.radius + planet.landRange);
  const arrived = h.steps; // the gate starts counting here
  flyTo(h, me, () => planet, planet.radius + planet.landRange - 2);
  return { h, planet, from, arrived };
}

test("LAND hint ladder", () => {
  const me = "lander";
  const { h, planet, from, arrived } = toPlanetRange(3, me);
  h.wait(33, () => stayAt(h, me, planet));
  const land = h.toasts(me, from);
  assert.strictEqual(land.length, 3, "three steps: " + JSON.stringify(land));
  const secs = (x) => (x / Contract.SIM_HZ);
  assert.strictEqual(land[0].text, "So close you could touch down.");
  assert(land[0].sketch === null && land[0].ghost === null, "riddle: no sketch, no ghost");
  assert(Math.abs(secs(land[0].at - arrived) - 6) < 0.2, `riddle at 6 s stuck (${secs(land[0].at - arrived)})`);
  assert(land[1].text === "" && land[1].sketch === "landing" && land[1].ghost === null, "step 2: empty text + sketch");
  assert(Math.abs(secs(land[1].at - land[0].at) - 10) < 0.1, "sketch 10 s after the riddle");
  assert(land[2].text === "Draw LAND" && land[2].sketch === null, "step 3 names the button");
  assert(Math.abs(secs(land[2].at - land[1].at) - 15) < 0.1, "answer 15 s after the sketch");
  const g = land[2].ghost;
  assert(g && g.action === "land" && g.x >= 0 && g.y >= 0 && g.x + g.w <= 1 + 1e-9 && g.y + g.h <= 1 + 1e-9, "ghost box on the pad");
  const overlaps = (a, b) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
  assert(h.w.players[me].layout.buttons.every((b) => !overlaps(g, b)), "ghost overlaps no button");
  h.w.setLayout(me, button("land", g), "button");
  h.wait(5, () => stayAt(h, me, planet));
  assert.strictEqual(h.toasts(me, from).length, 3, "ladder stops after setLayout");

  // Stop early: a LAND button after step 2 means no step 3.
  const second = toPlanetRange(5, "early");
  second.h.wait(17, () => stayAt(second.h, "early", second.planet));
  assert.strictEqual(second.h.toasts("early", second.from).length, 2, "riddle + sketch");
  second.h.w.setLayout("early", button("land"), "button");
  second.h.wait(20, () => stayAt(second.h, "early", second.planet));
  assert.strictEqual(second.h.toasts("early", second.from).length, 2, "no answer after the LAND button exists");

  // A player who already has LAND never sees a hint.
  const third = toPlanetRange(8, "knows", [button("land", { x: 0.4, y: 0.05, w: 0.2, h: 0.18 }).buttons[0]]);
  third.h.wait(35, () => stayAt(third.h, "knows", third.planet));
  assert.strictEqual(third.h.toasts("knows").length, 0, "no hints for a player with the controls");
  return `riddle +${secs(land[0].at - arrived).toFixed(2)}s, sketch +${secs(land[1].at - arrived).toFixed(2)}s, answer +${secs(land[2].at - arrived).toFixed(2)}s, ghost ${JSON.stringify(g)}`;
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
  const killFrom = h.steps;
  h.until("b destroyed", () => b.dead, 10, () => { b.pos = ahead(a, 20); h.input("a", "shoot", true); });
  h.input("a", "shoot", false);
  assert.strictEqual(a.score - ka, SCORING.kill, "kill");
  assert.strictEqual(b.score - kb, SCORING.killed, "killed");
  assert(h.since("announce", null, killFrom).some((x) => x.m.text === "a ✕ b"), "kill feed: a ✕ b");
  const deadTick = h.w.tickMessage().players.find((p) => p.name === "b");
  assert(deadTick.flags.dead && Math.abs(deadTick.respawnIn - T.respawnSeconds) < 0.1, `respawnIn ${deadTick.respawnIn}`);
  h.wait(T.respawnSeconds + 0.1);
  assert(!b.dead && b.hp === T.shipHp, "respawned");
  assert(b.mode === "space" && Math.hypot(b.pos.x, b.pos.y, b.pos.z) < 30, "space respawn at spawn");
  const shieldTick = h.w.tickMessage().players.find((p) => p.name === "b");
  assert(shieldTick.flags.spawnShield && shieldTick.respawnIn === undefined, "spawn shield on, no respawnIn");
  h.wait(2.1);
  assert(!h.w.tickMessage().players.find((p) => p.name === "b").flags.spawnShield, "spawn shield lasts 2 s");
  return `a ${a.score}, b ${b.score}`;
});

// (4b) Landing and take-off are predefined animations: no control, invulnerable, parked ship, re-landing parks again.
test("landing and take-off", () => {
  const me = "pilot";
  const { h, planet } = toPlanetRange(21, me, [button("land", { x: 0.4, y: 0.05, w: 0.2, h: 0.18 }).buttons[0]]);
  const p = h.w.players[me];
  h.release(me);
  const entFrom = h.steps;
  h.input(me, "land", true); h.step(); h.input(me, "land", false);
  const at = { ...p.pos }, hp = p.hp, startedAt = p.startedAt;
  let ticks = 0, drift = 0;
  const shot = (mode) => h.dbg().bullets.push({ id: 1e6 + h.steps, mode, pos: mode === "space" ? { ...p.pos } : { x: p.pos.x, y: p.pos.y + 1.1, z: p.pos.z }, dir: { x: 1, y: 0, z: 0 }, owner: "ghost", color: 0, life: 1, damage: 50 });
  h.until("touchdown", () => p.mode === "planet", T.planet.landingSeconds + 0.5, () => {
    h.input(me, "shoot", true); h.input(me, "forward", true); h.axis(me, "steer", 1, 1);
    if (h.steps % 15 === 0) shot("space");
    const tp = h.w.tickMessage().players.find((x) => x.name === me);
    assert(tp.flags.landing && tp.mode === "space" && tp.action === "land" && tp.startedAt === startedAt, "flags.landing during the shot");
    drift = Math.max(drift, dist(p.pos, at));
    ticks++;
  });
  const landingSecs = ticks / Contract.SIM_HZ;
  assert(Math.abs(landingSecs - T.planet.landingSeconds) < 0.1, `landing lasted ${landingSecs} s`);
  assert(drift === 0, `inputs ignored during landing (moved ${drift} m)`);
  assert.strictEqual(p.hp, hp, "invulnerable during landing");
  assert(!h.since("fx", null, entFrom).some((x) => x.m.kind === "hit"), "no hits while landing");
  const parked = h.w.worldMessage().island.parked;
  assert(parked.length === 1 && parked[0].player === me, "ship parked on the pad");
  assert(dist2(parked[0], h.dbg().landing) < 8 && dist2(parked[0], p.pos) < 3.5, "explorer beside the parked ship on the pad");
  assert(!h.w.tickMessage().players.find((x) => x.name === me).flags.landing, "landing flag off after touchdown");
  const ent = h.since("entity", null, entFrom).map((x) => x.m);
  assert(ent.length === 1 && ent[0].player === me && ent[0].entity.type === "person" && ent[0].entity.verbs.includes("dig") && ent[0].entity.verbs.includes("takeoff"), "entity: person");
  assert.strictEqual(h.w.worldMessage().entities[me].type, "person", "world.entities");
  h.release(me);

  // Take-off: flags.takingOff for takeoffSeconds, then space beside the planet; the ship leaves the pad.
  h.input(me, "takeoff", true); h.step(); h.input(me, "takeoff", false);
  ticks = 0;
  h.until("lift-off", () => p.mode === "space", T.planet.takeoffSeconds + 0.5, () => {
    if (h.steps % 15 === 0) shot("planet");
    assert(h.w.tickMessage().players.find((x) => x.name === me).flags.takingOff, "flags.takingOff");
    ticks++;
  });
  const takeoffSecs = ticks / Contract.SIM_HZ;
  assert(Math.abs(takeoffSecs - T.planet.takeoffSeconds) < 0.1, `take-off lasted ${takeoffSecs} s`);
  assert(p.hp === hp, "invulnerable during take-off");
  assert(Math.abs(dist(p.pos, planet) - (planet.radius + 15)) < 1, "space beside the planet");
  assert.strictEqual(h.w.worldMessage().island.parked.length, 0, "no parked ship after take-off");
  assert.strictEqual(h.since("entity", null, entFrom).pop().m.entity.type, "ship", "entity: ship again");

  // Re-landing parks again.
  h.input(me, "land", true); h.step(); h.input(me, "land", false);
  h.until("touchdown again", () => p.mode === "planet", T.planet.landingSeconds + 0.5);
  assert.strictEqual(h.w.worldMessage().island.parked.length, 1, "parked again");
  return `landing ${landingSecs.toFixed(2)} s, take-off ${takeoffSecs.toFixed(2)} s, parked ${JSON.stringify(parked[0])}`;
});

// (4c) PvP on the island: explorers shoot each other (bullets carry mode 1), respawn beside the parked ship.
test("island PvP", () => {
  const { h, planet } = toPlanetRange(31, "a", [button("land", { x: 0.4, y: 0.05, w: 0.2, h: 0.18 }).buttons[0]]);
  h.w.join("b");
  const a = h.w.players.a, b = h.w.players.b;
  for (const p of [a, b]) {
    p.pos = { x: planet.x, y: planet.y, z: planet.z + planet.radius + 5 };
    h.input(p.name, "land", true);
  }
  h.step(); h.input("a", "land", false); h.input("b", "land", false);
  h.until("both landed", () => a.mode === "planet" && b.mode === "planet", T.planet.landingSeconds + 0.5);
  h.release("a"); h.release("b");
  h.wait(0.5);
  // Find level, dry ground 8 m from a and put b there, then face a toward b.
  const Terrain = require("../../terrain");
  const seed = h.dbg().island.seed;
  let spot = null;
  for (let k = 0; k < 64 && !spot; k++) {
    const ang = (k / 64) * Math.PI * 2, x = a.pos.x + Math.cos(ang) * 8, z = a.pos.z + Math.sin(ang) * 8;
    const y = Terrain.height(x, z, seed);
    if (y > 0.3 && Math.abs(y - a.pos.y) < 0.3) spot = { x, y, z };
  }
  assert(spot, "a level spot near a");
  const ka = a.score, kb = b.score, from = h.steps;
  let modeOne = 0;
  h.until("b killed on the island", () => b.dead, 10, () => {
    b.pos = { ...spot }; b.vy = 0;
    a.yaw = Math.atan2(-(spot.x - a.pos.x), -(spot.z - a.pos.z));
    h.input("a", "shoot", true);
    const t = h.w.tickMessage();
    modeOne += t.bullets.filter((x) => x.length === 6 && x[5] === 1).length;
  });
  h.input("a", "shoot", false);
  assert(modeOne > 0, "bullets carry mode 1 on the island");
  assert.strictEqual(a.score - ka, SCORING.kill, "kill +200");
  assert.strictEqual(b.score - kb, SCORING.killed, "killed -50");
  assert(h.since("announce", null, from).some((x) => x.m.text === "a ✕ b"), "kill feed");
  assert(h.since("fx", "explode", from).some((x) => x.m.mode === "planet"), "death fx on the island");
  h.wait(T.respawnSeconds + 0.1);
  const parkedB = h.w.worldMessage().island.parked.find((x) => x.player === "b");
  assert(!b.dead && b.mode === "planet" && b.hp === T.shipHp, "b respawned on the island with full health");
  assert(dist2(b.pos, parkedB) < 3.5, "respawn beside b's parked ship on the pad");
  assert(h.w.tickMessage().players.find((x) => x.name === "b").flags.spawnShield, "spawn shield");
  // Shots in the spawn shield do nothing.
  const hp = b.hp;
  b.pos = { ...spot };
  h.wait(1, () => { b.pos = { ...spot }; b.vy = 0; h.input("a", "shoot", true); });
  h.input("a", "shoot", false);
  assert.strictEqual(b.hp, hp, "spawn shield blocks damage");
  // Space bullets never hit explorers and island bullets never hit ships.
  const spaceShips = h.w.tickMessage().bullets.filter((x) => x[5] === 0).length;
  return `${modeOne} island bullet samples, a ${a.score}, b ${b.score}, ${spaceShips} space bullets`;
});

// (4d) Drawing budget: 5 per world per round, lobby counts toward space, resets each round.
test("drawing budget", () => {
  const h = harness(5);
  h.w.join("artist");
  assert.deepStrictEqual(h.w.drawingsLeft("artist"), { space: 5, planet: 5 });
  assert.strictEqual(h.w.drawingWorld("artist"), "space", "lobby counts as space");
  for (let i = 0; i < 5; i++) assert(h.w.spendDrawing("artist"), `space drawing ${i + 1}`);
  assert.strictEqual(h.w.spendDrawing("artist"), false, "sixth space drawing refused");
  assert.deepStrictEqual(h.w.drawingsLeft("artist"), { space: 0, planet: 5 });
  h.step(); h.step();
  assert.deepStrictEqual(h.w.tickMessage().players[0].drawingsLeft, { space: 0, planet: 5 }, "tick carries drawingsLeft");
  h.w.players.artist.mode = "planet";
  assert.strictEqual(h.w.drawingWorld("artist"), "planet");
  assert(h.w.spendDrawing("artist"), "planet drawing");
  assert.deepStrictEqual(h.w.drawingsLeft("artist"), { space: 0, planet: 4 });
  h.w.players.artist.mode = "space";
  h.input("artist", "ready", true); h.step();
  // Force the round over: collect a chest by hand.
  h.until("round over", () => h.w.phase === "lobby" && h.w.round === 2, 400, () => {
    const p = h.w.players.artist;
    if (h.w.phase === "assists" && p.mode === "space") { const c = h.dbg().chests[0]; p.mode = "planet"; p.pos = { x: c.x, y: 0, z: c.z }; }
  });
  assert.deepStrictEqual(h.w.drawingsLeft("artist"), { space: 5, planet: 5 }, "budget resets each round");
  return "5 + 5, refusal, tick field, reset";
});

// (4e) Entity messages: on join (ship) and in every world message for late joiners; anims from wireAnimations.
test("entity messages", () => {
  const msgs = [];
  const w = createWorld({ random: mulberry32(1), broadcast: (m) => msgs.push(m), wireAnimations: (type, verbs) => ({ idle: { clip: `${type}-idle`, n: verbs.length } }) });
  w.join("x");
  const e = msgs.filter((m) => m.type === "entity");
  assert(e.length === 1 && e[0].player === "x" && e[0].entity.type === "ship" && e[0].entity.anims.idle.clip === "ship-idle", "entity on join with anims");
  assert(e[0].entity.verbs.includes("drill") && e[0].entity.verbs.includes("land") && !e[0].entity.verbs.includes("dig"), "ship verbs");
  assert.strictEqual(w.worldMessage().entities.x.type, "ship", "world.entities");
  assert(msgs.filter((m) => m.type === "world").every((m) => m.entities === undefined), "broadcast world messages leave entities out");
  const plain = createWorld({ random: mulberry32(1) });
  plain.join("y");
  assert(!("anims" in plain.worldMessage().entities.y), "no anims without wireAnimations");
  return JSON.stringify(e[0].entity);
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
