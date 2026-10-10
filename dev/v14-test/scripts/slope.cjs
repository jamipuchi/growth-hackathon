// Fast-forward tests of world.js, v1.1 rules (PLAN.md section 0): the START button, the 4:00 cap and the all-chests
// end, most points wins plus stars, unlockable skills (refusals, dev kit, redraws, assists), the boss (any weapon, HP
// scaling, shooting back), chest kinds and counts, planet movement per type, ruthless steals and wrecks, the hint ladder
// (parts, then buttons), and tick size with 25 players. v1.4 balance: bots count 0.5 for the boss's HP and 0 for the
// chests, flight times (cruise ~20 s, holding BOOST ~15 s), bots' fire discipline and revenge, human shots through
// bots, the +1000 for humans, wreck +150, dry chest walks and bays, the shore slide. The whole route with 24 bots:
// dev/netcode/balance-sim.mjs; a room of 25 humans: dev/v14-pacing/crowd-sim.mjs.
// Run: node dev/netcode/sim-test.js
const assert = require("assert");
const Contract = require("/private/tmp/claude-501/v14-test/contract.js");
const Verbs = require("/private/tmp/claude-501/v14-test/verbs.js");
const { createWorld, chestCount, bossHp, DEFAULT_LAYOUT, withSteer } = require("/private/tmp/claude-501/v14-test/world.js");

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


const Terrain=require('/private/tmp/claude-501/v14-test/terrain.js');
const result={at:new Date().toISOString(),cases:[]};
for(const variant of ['original slope','nearby level approach']){
const h=harness(13);
for(const n of ['ana','bob','cy']){h.w.join(n);h.w.setEntity(n,'ship',devKit('ship'));h.w.setEntity(n,'explorer',devKit('explorer'));}
h.w.start();const b=h.dbg().boss;b.damageBy.bob=2900;b.hp=1;hitBossVia(h,'cy');for(const n of ['ana','bob','cy'])landNow(h,n);
const v=h.p('ana'),k=h.p('bob'),c=h.dbg().chests.find(x=>x.kind==='buried');v.pos={x:c.x,y:v.pos.y,z:c.z};h.input('ana','dig',true);h.until('chest opens',()=>c.open,5);h.input('ana','dig',false);h.wait(5);
v.spawnShield=0;v.hp=1;
let angle=0;
if(variant!=='original slope'){
 let best=Infinity;
 for(let i=0;i<360;i++){const a=i*Math.PI/180,x=v.pos.x+Math.sin(a)*6,z=v.pos.z+Math.cos(a)*6,d=Math.abs(Terrain.height(x,z,h.dbg().island.seed)-Terrain.height(v.pos.x,v.pos.z,h.dbg().island.seed));if(d<best){best=d;angle=a;}}
}
k.pos={x:v.pos.x+Math.sin(angle)*6,y:v.pos.y,z:v.pos.z+Math.cos(angle)*6};k.yaw=angle;h.wait(.1);k.pitch=Math.atan2(v.pos.y-k.pos.y,6);// Manual pitch attempts vertical aiming; no steer-Y input because that moves walkers.
const before={victim:{...v.pos},shooter:{...k.pos},hp:v.hp,pitch:k.pitch};h.input('bob','shoot',true);h.wait(3);h.input('bob','shoot',false);
result.cases.push({variant,before,after:{hp:v.hp,dead:v.dead,victim:{...v.pos},shooter:{...k.pos}},score:k.score,announces:h.announces().slice(-4)});
}
console.log(JSON.stringify(result,null,2));
require('fs').writeFileSync('/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test/data/slope.json',JSON.stringify(result,null,2));
