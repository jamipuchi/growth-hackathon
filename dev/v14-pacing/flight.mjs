// Flight times to the boss (v1.4 pacing, owner 10 Oct 10:00: "about 20 s cruising, about 15 s with BOOST"), measured
// the way dev/netcode/sim-test.js "speed" measures them: one ship at the spawn centre aimed at the boss, no rocks, held
// inputs, until it touches the boss (within 2 m of its surface: the ship stops at boss radius + SHIP_RADIUS). Instant.
//   node dev/v14-pacing/flight.mjs [--root <repo>]
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const ROOT = path.resolve(opt("root", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")));
const require = createRequire(import.meta.url);
const Contract = require(path.join(ROOT, "contract.js"));
const Verbs = require(path.join(ROOT, "verbs.js"));
const { createWorld } = require(path.join(ROOT, "world.js"));
const T = Contract.TUNING, DT = 1 / Contract.SIM_HZ;

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v) => Math.max(-1, Math.min(1, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function toBoss({ boost = false, forward = false }) {
  const w = createWorld({ random: mulberry32(31) });
  w.join("ana");
  w.setEntity("ana", "ship", { type: "ship", unlocked: Verbs.DEV_KIT.space, parts: [], source: "devkit" });
  w.start();
  const b = w.debug().boss, p = w.players.ana;
  p.pos = { x: 0, y: b.pos.y, z: 0 }; p.yaw = Math.atan2(-b.pos.x, -b.pos.z); p.pitch = 0;
  w.debug().rocks.length = 0;
  if (boost) w.handleInput({ type: "input", player: "ana", action: "boost", down: true });
  if (forward) w.handleInput({ type: "input", player: "ana", action: "forward", down: true });
  const t0 = w.debug().playT;
  for (let i = 0; i < 120 * Contract.SIM_HZ && dist(p.pos, b.pos) - b.radius > 2; i++) {
    const v = { x: b.pos.x - p.pos.x, y: b.pos.y - p.pos.y, z: b.pos.z - p.pos.z };
    const yawErr = wrap(Math.atan2(-v.x, -v.z) - p.yaw), pitchErr = Math.atan2(v.y, Math.hypot(v.x, v.z)) - p.pitch;
    w.handleInput({ type: "axis", player: "ana", axis: "steer", x: clamp(-yawErr * 3), y: clamp(pitchErr * 3) });
    p.spawnShield = 1; p.hp = 100;
    w.step(DT);
  }
  return w.debug().playT - t0;
}

const cruise = toBoss({}), boost = toBoss({ boost: true }), full = toBoss({ boost: true, forward: true });
const planetCruise = (T.planet.offset - T.planet.radius - T.planet.landRange) / T.cruiseSpeed;
console.log(`bossDistance ${T.bossDistance}, planet.offset ${T.planet.offset}: to the boss cruise ${cruise.toFixed(1)} s, holding BOOST ${boost.toFixed(1)} s, FORWARD + BOOST ${full.toFixed(1)} s; boss → landing range at cruise ${planetCruise.toFixed(1)} s`);
