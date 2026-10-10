// v1.7 island size: ENDLESS mode's chest refresh (endless.js freshChests via world.js refreshChests) on the 840 m island.
// For many seeds: open every chest, let the refresh run, and check the new chests are all on dry land, a straight dry walk
// from the pad, and spread like a fresh round's (TUNING.island chestSpread + chestSpreadPerChest × count).
//   node dev/v17-island-size/endless-chests.js [seeds=40]
const Terrain = require("../../terrain");
const { TUNING, SIM_HZ } = require("../../contract");
const { createWorld, chestCount } = require("../../world");

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEEDS = Number(process.argv[2] || 40);
let fresh = 0, wet = 0, blocked = 0, short = 0;
const far = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const w = createWorld({ random: mulberry32(seed) });
  w.join("ana");
  w.setEndless(true);
  w.start();
  const d0 = w.debug();
  const want = chestCount(d0.playerCount), spread = TUNING.island.chestSpread + TUNING.island.chestSpreadPerChest * want;
  const before = new Set(d0.chests.map((c) => c.id));
  for (const c of d0.chests) { c.buried = false; c.open = true; c.by = "ana"; }
  for (let i = 0; i < 20 * SIM_HZ && w.debug().chests.some((c) => before.has(c.id)); i++) w.step(1 / SIM_HZ);
  const d = w.debug(), L = d.landing, isl = d.island;
  const now = d.chests.filter((c) => !before.has(c.id));
  if (now.length < want) short++;
  for (const c of now) {
    fresh++;
    if (!(Terrain.height(c.x, c.z, isl.seed) > 0.3)) wet++;
    const n = Math.ceil(Math.hypot(c.x - L.x, c.z - L.z) / 2);
    for (let i = 0; i <= n; i++) if (!(Terrain.height(L.x + ((c.x - L.x) * i) / n, L.z + ((c.z - L.z) * i) / n, isl.seed) > 0.3)) { blocked++; break; }
    far.push(Math.hypot(c.x - L.x, c.z - L.z) / spread);
  }
}
far.sort((a, b) => a - b);
console.log(`island ${Terrain.ISLAND_SIZE} m, ${SEEDS} endless refreshes: ${fresh} new chests, ${short} refreshes short of the count, ${wet} in water, ${blocked} with water on the way from the pad; distance from the pad / spread: median ${far[far.length >> 1].toFixed(2)}, max ${far[far.length - 1].toFixed(2)} (spread ${TUNING.island.chestSpread} + ${TUNING.island.chestSpreadPerChest} per chest)`);
process.exit(wet || blocked || short ? 1 : 0);
