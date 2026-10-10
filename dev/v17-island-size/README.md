# v17-island-size: the island doubles to 840 m (owner, 10 Oct 12:22)

## What changed
- `terrain.js`: `ISLAND_SIZE` 420 → 840 and `height()` in the larger convention: `height(x, z)` = the old island's
  `height(x / 2, z / 2)` (noise cell `FEATURE` 60 → 120 m). Same hills and heights, twice as wide, 4× the area. Checked
  identical to the old function at scaled coordinates over 20,000 random samples (max difference 0).
  This is ORCHESTRATE.md A-005's second option ("update Terrain.height to the larger convention and pass it directly"),
  so world.js, render.js (the A-005 kit gets `size: Terrain.ISLAND_SIZE` + `Terrain.height`; the procedural fallback,
  its water and props use `ISLAND_SIZE`) and the e2e driver all follow with no second scale. Never wrap it in the kit's
  `createScaledHeightAt` (that would scale twice).
- `world.js` `buildIsland`: the landing-pad search rings scale with `island.size / 420` (40 to 320 m out every 20 m).
- `contract.js` `TUNING.island`: `walkSpeed` 8 → 12 (run 24 m/s; car 28.8 / 57.6 m/s, bike 26.4, quadruped 19.2, blob
  13.2: the type multipliers are unchanged, so every vehicle gets the same +50%), `chestSpread` 34 → 60,
  `chestSpreadPerChest` 4 → 7. digSeconds / drillSeconds / chest counts unchanged.
- `dev/netcode/sim-test.js`: the shore-slide test's rays scale with the island (220 → 440 m); comments only otherwise.
- `render.js`: no edit needed (every island-scale use already reads `Terrain.ISLAND_SIZE` / `Terrain.height`).
- `endless.js`: no edit needed: world.js `refreshChests` passes the same spread formula and dry-walk test
  (`endless-chests.js`: 40 refreshes, 640 new chests, 0 in water, 0 blocked from the pad, max 1.00 × spread).

## Before / after (Node fast-forward sims, 10 Oct 12:22 → 12:41)
| | before (420 m) | after (840 m) |
| --- | --- | --- |
| chests, 1 human (16) | up to 98 m from the pad, nearest-first tour 576 m | up to 172 m, tour 967 m |
| chests, 10 humans (22) | up to 122 m, tour 845 m | up to 214 m, tour 1440 m |
| chests, 25 humans (32) | up to 162 m, tour 1329 m | up to 284 m, tour 2301 m |
| expert, every chest open (balance-sim, 6 seeds) | 2:54-3:12 | 3:00-3:19 |
| regular at the 4:00 cap (6 seeds) | 14-16 of 16 | 13-15 of 16 |
| regular first chest | 1:29-1:31 | 1:28-1:31 |
| 25 humans, spread out (crowd-sim --spread, 4 seeds) | 1:28-1:46 | 1:39-2:05 |
| 25 humans, bunched (crowd-sim, 4 seeds) | 2:09-3:23 | 3:05-4:00 (one seed 30/32 at the cap) |
| sim-test 25-explorer blob, seed 11 (bound < 210 s) | 87.8 s | 190.6 s |
| 10 humans + 15 bots, spread out / bunched (3 seeds) | 1:28-1:42 / - | 1:29-1:53 / 2:52-3:30 |

Files: `sim-before.txt` / `sim-after.txt` (balance-sim), `crowd-{before,after}-{spread,blob}.txt`,
`layout-{before,after}.txt` (dev/v14-pacing/islands.mjs, 200 islands), `sim-test-after.txt` (33/33),
`rules-test-after.txt` (17/17), `crowd-{before,after}-10h-*.txt`. Rejected candidates: `sim-A-60-7-w11.txt` (walk 11: expert 3:05-3:27),
`sim-C-28-9-w12.txt` + `crowd-C-*.txt` (32 chests to 316 m: the sim-test blob took 210.0 s, on its bound),
`sim-D-16-9-w12.txt`.

## Re-run
    node dev/netcode/balance-sim.mjs --route both --bots 24 --seeds 1-6        # ~20 s
    node dev/v14-pacing/crowd-sim.mjs --seeds 1-4 [--spread]                   # ~10 s
    node dev/netcode/sim-test.js && node dev/rules/rules-test.js               # ~15 s
    node dev/v17-island-size/endless-chests.js 40
    bash dev/v17-island-size/sweep-layout.sh "60 7" "28 9"                     # layouts for spread pairs, instant
    bash dev/v17-island-size/blob.sh 60 7 8-13                                 # the sim-test blob for a spread pair
    # any TUNING override without editing files (dev/v14-pacing/tune.cjs):
    PACING='{"island":{"walkSpeed":13}}' node --require ./dev/v14-pacing/tune.cjs dev/netcode/balance-sim.mjs
    # the old island: git archive HEAD~N -- '*.js' dev/e2e/driver.mjs | tar -x -C /tmp/base; then --root /tmp/base
