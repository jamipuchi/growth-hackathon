// Chest layouts at START (v1.4 pacing): for many seeds, how many chests, how far from the landing pad, whether any is
// in the water (the forced fallback in world.js buildIsland), and the walk to visit them all (nearest first, straight
// lines). Instant: world.js only, no simulation.
//   node dev/v14-pacing/islands.mjs [--humans 1] [--bots 24] [--seeds 1-200] [--root <repo>]
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const ROOT = path.resolve(opt("root", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")));
const require = createRequire(import.meta.url);
const Terrain = require(path.join(ROOT, "terrain.js"));
const { createWorld } = require(path.join(ROOT, "world.js"));
const HUMANS = Number(opt("humans", 1)), BOTS = Number(opt("bots", 24));
const [S0, S1] = String(opt("seeds", "1-200")).split("-").map(Number);

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rows = [];
for (let seed = S0; seed <= S1; seed++) {
  const w = createWorld({ random: mulberry32(seed) });
  for (let i = 1; i <= HUMANS; i++) w.join(`p${i}`);
  for (let i = 1; i <= BOTS; i++) w.addBot(`bot${i}`);
  w.start();
  const m = w.worldMessage();
  const { landing, seed: iseed, size } = m.island;
  const wet = m.chests.filter((c) => Terrain.height(c.x, c.z, iseed) <= 0.3 || Math.hypot(c.x, c.z) >= size / 2 - 5).length;
  const d = m.chests.map((c) => Math.hypot(c.x - landing.x, c.z - landing.z));
  let at = landing, left = m.chests.slice(), tour = 0;
  while (left.length) {
    left.sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
    tour += Math.hypot(left[0].x - at.x, left[0].z - at.z); at = left.shift();
  }
  rows.push({ n: m.chests.length, fallback: landing.x === 0 && landing.z === 0, wet, far: Math.max(...d), mean: d.reduce((a, b) => a + b, 0) / d.length, tour, pad: Math.hypot(landing.x, landing.z), hp: w.debug().boss.maxHp, count: m.playerCount });
}
const q = (xs, f) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const col = (k) => rows.map((r) => r[k]);
const f0 = (x) => x.toFixed(0);
console.log(`${HUMANS} humans + ${BOTS} bots (count ${rows[0].count}, boss ${rows[0].hp} hp), ${rows.length} islands: ${rows[0].n} chests (min ${Math.min(...col("n"))})`);
console.log(`  fallback pads ${rows.filter((r) => r.fallback).length}, chests in water ${rows.reduce((n, r) => n + r.wet, 0)}`);
console.log(`  farthest chest from the pad: median ${f0(q(col("far"), 0.5))} m, max ${f0(Math.max(...col("far")))} m; mean distance median ${f0(q(col("mean"), 0.5))} m; pad ${f0(q(col("pad"), 0.5))} m from the island centre (max ${f0(Math.max(...col("pad")))})`);
console.log(`  nearest-first tour of every chest: p10 ${f0(q(col("tour"), 0.1))} m, median ${f0(q(col("tour"), 0.5))} m, p90 ${f0(q(col("tour"), 0.9))} m`);
