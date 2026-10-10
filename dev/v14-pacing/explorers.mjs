// "25 explorers open all the chests" exactly as dev/netcode/sim-test.js scripts it (v1.4 pacing): 25 humans land at
// once and each walks straight to the nearest closed chest and works it (one blob, digs add up). Prints the seconds
// from touchdown to the last chest per seed, to size that test's bound. Instant: world.js only.
//   node dev/v14-pacing/explorers.mjs [--seeds 11-11] [--together] [--via-pad] [--root <repo>]
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
const [S0, S1] = String(opt("seeds", "11-11")).split("-").map(Number);
const DT = 1 / Contract.SIM_HZ;
const TOGETHER = argv.includes("--together");
const VIA_PAD = argv.includes("--via-pad");
const Terrain = require(path.join(ROOT, "terrain.js"));

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
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const devKit = (kind) => ({ type: kind === "ship" ? "ship" : "person", unlocked: Verbs.DEV_KIT[kind === "ship" ? "space" : "planet"], parts: [], source: "devkit" });
const LAYOUT = { buttons: [
  { type: "stick", action: "steer", label: "", x: 0.04, y: 0.4, w: 0.3, h: 0.55 },
  ...["shoot", "boost", "land", "dig", "drill"].map((a, i) => ({ type: "button", action: a, label: a.toUpperCase(), x: 0.4 + (i % 3) * 0.19, y: 0.4 + Math.floor(i / 3) * 0.3, w: 0.17, h: 0.25 })),
], source: "model" };

function run(seed) {
  const w = createWorld({ random: mulberry32(seed) });
  const input = (player, action, down) => w.handleInput({ type: "input", player, action, down });
  const until = (cond, max, each) => { for (let i = 0; i < max * Contract.SIM_HZ; i++) { if (cond()) return true; if (each) each(); w.step(DT); } return cond(); };
  const aim = (name, t) => {
    const p = w.players[name], v = { x: t.x - p.pos.x, y: t.y - p.pos.y, z: t.z - p.pos.z };
    const yawErr = wrap(Math.atan2(-v.x, -v.z) - p.yaw), pitchErr = p.mode === "space" ? Math.atan2(v.y, Math.hypot(v.x, v.z)) - p.pitch : 0;
    w.handleInput({ type: "axis", player: name, axis: "steer", x: clamp(-yawErr * 3), y: clamp(pitchErr * 3) });
    return Math.hypot(yawErr, pitchErr);
  };
  const names = Array.from({ length: 25 }, (_, i) => `p${i + 1}`);
  for (const n of names) { w.join(n); w.setEntity(n, "ship", devKit("ship")); w.setEntity(n, "explorer", devKit("explorer")); w.setLayout(n, LAYOUT); }
  w.start();
  // killBoss(h, "p1"), as sim-test.js
  const b = w.debug().boss; b.hp = 1;
  const p1 = w.players.p1; p1.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z + b.radius + 20 }; p1.yaw = 0; p1.pitch = 0;
  input("p1", "shoot", true); until(() => w.debug().boss.dead, 5, () => aim("p1", b.pos)); input("p1", "shoot", false);
  // landNow one after another, as the test did up to v1.3 (touchdown ≈ 76 s), or --together: all 25 press LAND at once.
  for (const n of names) {
    const pl = w.debug().planet, p = w.players[n];
    p.pos = { x: pl.x + pl.radius + 10, y: pl.y, z: pl.z };
    input(n, "land", true); input(n, "land", false);
    if (!TOGETHER) until(() => p.mode === "planet" && !p.landingFor, 6);
  }
  until(() => names.every((n) => w.players[n].mode === "planet" && !w.players[n].landingFor), 6);
  const t0 = w.debug().playT, chests = w.debug().chests, landing = w.debug().landing, iseed = w.debug().island.seed;
  const wet = (a, b) => { const k = Math.ceil(dist2(a, b) / 2); for (let i = 1; i < k; i++) if (Terrain.height(a.x + ((b.x - a.x) * i) / k, a.z + ((b.z - a.z) * i) / k, iseed) <= 0.3) return true; return false; };
  const done = until(() => w.phase === "scoreboard", 240, () => {
    for (const n of names) {
      const p = w.players[n];
      const left = chests.filter((c) => !c.open);
      if (!left.length) return;
      const c = left.reduce((a, bb) => (dist2(a, p.pos) < dist2(bb, p.pos) ? a : bb));
      const d = dist2(c, p.pos);
      // --via-pad: a lagoon on the straight line → walk to the pad first (every chest is a dry straight walk from it).
      const goal = VIA_PAD && d > 1.5 && wet(p.pos, c) ? landing : c;
      const err = aim(n, { ...goal, y: 0 });
      w.handleInput({ type: "axis", player: n, axis: "move", x: 0, y: d > 1.5 && err < 0.6 ? 1 : 0 });
      input(n, "boost", true);
      input(n, "dig", d < 2.5 && c.kind === "buried");
      input(n, "drill", d < 2.5 && c.kind === "rock");
    }
  });
  const far = Math.max(...chests.map((c) => dist2(c, landing)));
  return { seed, n: chests.length, opened: chests.filter((c) => c.open).length, took: w.debug().playT - t0, done, reason: w.worldMessage().result && w.worldMessage().result.reason, far, startedAt: t0 };
}

for (let seed = S0; seed <= S1; seed++) {
  const r = run(seed);
  console.log(`seed ${seed}: ${r.opened}/${r.n} chests (farthest ${r.far.toFixed(0)} m from the pad) in ${r.took.toFixed(1)} s from touchdown at ${r.startedAt.toFixed(1)} s, ${r.done ? `ended (${r.reason})` : "NOT done in 240 s"}`);
}
