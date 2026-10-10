// v19-codexfix: the quality governor (render.js class Perf) on frame-time traces, OLD (a render.js without patch_m6) vs NEW (with it).
//   node dev/v19-codexfix/gov-test.mjs <old render.js> <new render.js>
// A trace is a function of the frame index and the governor's current tier (a GPU-bound phone gets faster on a lower tier; an outside
// cap does not). Prints both results and checks the NEW one.
import fs from "fs";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const load = (file) => {
  const src = fs.readFileSync(file, "utf8");
  const g0 = src.indexOf("const TIERS = ["), g1 = src.indexOf("// HUD model (game.hud()).");
  return new Function("clamp", `${src.slice(g0, g1)}; return { Perf, TIERS };`)(clamp);
};
const [OLD, NEW] = [load(process.argv[2]), load(process.argv[3])];
const run = (G, n, f, start = 0) => {
  const p = new G.Perf();
  p.tier = start;
  let t = 0, changes = 0, minTier = start, tiers = [];
  for (let i = 0; i < n; i++) {
    const [dt, w] = f(i, p.tier);
    t += dt / 1000;
    if (p.frame(dt, w, t)) { changes++; tiers.push(p.tier); }
    minTier = Math.max(minTier, p.tier);
  }
  return { tier: p.tier, worst: minTier, changes, capped: p.capped, path: tiers.join(">") };
};
let fails = 0;
const check = (label, cond, o, nw) => { if (!cond) fails++; console.log(`${cond ? "ok  " : "FAIL"} ${label}\n       old ${JSON.stringify(o)}\n       new ${JSON.stringify(nw)}`); };
const both = (n, f, start) => [run(OLD, n, f, start), run(NEW, n, f, start)];

// 1. Codex M6: 60 fps, then an outside cap at exactly 15 fps (66.7 ms) with ~1 ms of JS, whatever the tier (3000 frames = 200 s).
{ const [o, n] = both(3300, (i) => (i < 300 ? [16.7, 1] : [66.7, 1]));
  check("outside 15 fps cap from tier 0: back to tier 0 and held (old: stuck at tier 5)", n.tier === 0 && n.capped, o, n); }
// 2. The same on a phone that starts at tier 2 (v1.5: phones start there).
{ const [o, n] = both(3300, (i) => (i < 300 ? [16.7, 1] : [66.7, 1]), 2);
  check("outside 15 fps cap from tier 2: back to tier 2", n.tier === 2 && n.capped, o, n); }
// 3. The cap lifts after 60 s: the NEW governor is already back at full quality; the old one climbs from tier 5.
{ const [o, n] = both(4000, (i) => (i < 300 ? [16.7, 1] : i < 1200 ? [66.7, 1] : [16.7, 1]));
  check("cap lifts: NEW ends at tier 0", n.tier === 0, o, n); }
// 4. GPU-bound (fill rate): faster on every lower tier. Same descent as before.
{ const ms = [70, 52, 40, 30, 22, 16.7]; const [o, n] = both(3000, (i, tier) => [ms[tier], 3]);
  check("GPU-bound phone: same final tier as before", n.tier === o.tier, o, n); }
// 5. Only bloom off / near rocks help (tiers 4-5): the cascade finds them, as before.
{ const ms = [66.7, 66.7, 66.7, 66.7, 33.3, 16.7]; const [o, n] = both(3000, (i, tier) => [ms[tier], 3]);
  check("only the last tiers help: same final tier as before", n.tier === o.tier, o, n); }
// 6. Heavy CPU work (not idle): never treated as an outside cap.
{ const [o, n] = both(3000, () => [66.7, 30]);
  check("66.7 ms with 30 ms of CPU work: same as before (steps down)", n.tier === o.tier && n.tier > 0, o, n); }
// 7. Uneven frames (17 / 66 ms): not steady, same as before.
{ const [o, n] = both(3000, (i) => [i % 3 === 0 ? 66 : 17, 2]);
  check("uneven 17/66 ms: same as before", n.tier === o.tier, o, n); }
// 8. A steady 40 ms (under the 45 ms line): same as before (the unit.mjs case).
{ const [o, n] = both(1500, () => [40, 3]);
  check("steady 40 ms, idle CPU: same as before", n.tier === o.tier && n.tier > 0, o, n); }
console.log(fails ? `${fails} FAILED` : "all governor traces OK");
process.exit(fails ? 1 : 0);
