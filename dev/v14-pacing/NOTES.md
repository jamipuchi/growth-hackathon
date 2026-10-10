# v14-pacing: boss closer, boss weaker, most of the round on the planet

Owner, 10 Oct 10:00 (PLAN.md section 0): "make sure you are not that far away from the boss + it has less life so it
can be completed faster"; "we want most of the time to be spent on the planet". The numbers live in `contract.js`
TUNING (its comment keeps the old → new list and the sim tables); this folder holds the tools that chose them.

## What changed
- contract.js TUNING: bossDistance 1100 → 400 (nebula.distance too), boss.hp 3000 → 1200, boss.hpPerExtraPlayer
  0.5 → 0.3, **boss.botWeight 0.5 (new)**, **botWeight 0.25 → 0**, boss.respawnDistance 300 → 200,
  rockCluster.radius 320 → 220, planet.offset 800 → 350, island chestsBase 2 → 15, chestsPerPlayer 0.7 → 0.65,
  chestsMax 20 → 32, chestSpread 48 → 34, chestSpreadPerChest 2 → 4, digSeconds 3 → 4, drillSeconds 3.5 → 4.5.
- world.js: `hpCount(list)` = humans + TUNING.boss.botWeight × bots for the boss's HP (start() and the countdown
  rescale in go()); `scaledCount` (humans + TUNING.botWeight × bots, now humans only) still drives the chest count and
  `world.playerCount`.
- dev/netcode/sim-test.js: only the expectations that encoded the old pacing (HP ×13 → ×8.2, chest counts, the
  bots-as-fillers table, flight-time bounds, the 25-explorer crowd, the countdown rescale, test titles).

## Why bots got their own HP weight
At a close boss the bots arrive together and fire like humans: 24 bots ≈ 450 dps, 10 expert humans ≈ 900 dps. With
bots counted 0.25 for the HP, no single hp / hpPerExtraPlayer gave a 10-15 s fight for 1 human + 24 bots AND for 25
humans (1+24 needs ≈ 5500 HP, 25 humans ≈ 10000, solo ≈ 1200). Bots never land, so for the chests they count 0:
small bot-free rooms then get the same per-head chest load as the 1 + 24 test room (5 humans: 19 chests, was 14).

## Tools (all fast-forward world.js, no server, no browser)
- `tune.cjs`: `PACING='{"bossDistance":400,"boss":{"hp":1200}}' node --require ./dev/v14-pacing/tune.cjs <sim>`
  deep-merges numbers into TUNING in memory (PACING_ROOT for another checkout). Every sweep used it.
- `crowd-sim.mjs`: N humans (share of experts) + bots with the e2e route driver. Default: the driver walks to the
  nearest chest, so the crowd bunches (slow bound; diggers on one chest add up). `--spread`: each human sees only the
  chests it is the nearest landed human to (fast bound). Prints boss down, fight length (first hit → dead), landings,
  all-chests clock and the share of the round each human spent on the planet.
- `islands.mjs`: chest layouts at START per party size (fallback pads, chests in water, distances, tour length).
- `flight.mjs`: spawn → boss flight times the way sim-test "speed" measures them.
- `explorers.mjs`: sim-test's "25 explorers" crowd (`--together --via-pad` = the v1.4 test's script).

## Final numbers (10 Oct 10:32-10:36, main tree)
`node dev/netcode/balance-sim.mjs --route both --bots 24 --seeds 1-6`: ALL PASS (19.2 s).

| route | boss | boss down | planet | landed | chest 1 | end |
|---|---|---|---|---|---|---|
| expert | 0:11 | 0:19-0:20 | 0:31-0:35 | 0:35-0:39 | 0:42-0:46 | all 16 chests at 2:54-3:12 |
| regular | 0:15 | 0:27-0:28 | 0:43-0:45 | 1:19-1:22 | 2:02-2:05 | 4:00 cap, 11-13 of 16 open |

Crowd sim (seeds 1-4 unless noted): fight (first hit → boss dead) / all chests open / planet share.
- 1 expert + 24 bots (seeds 1-6): 11-12 s / 2:54-3:12 / 78-81%.
- 25 humans, 4 experts: 22 s (4 guns until the regulars draw theirs) / bunched 3:01-3:59, spread 2:09-2:20 /
  66-74% bunched, 52-56% spread.
- 25 humans, first-timers only, spread: 5 s (25 guns at once) / 2:43-3:14 / 59-65%.
- 25 humans, 10 experts: 10 s / bunched 2:12-3:09, spread 1:25-1:30 / 57-70% bunched, 33-36% spread.
- 5 humans (2 experts), no bots: 15-18 s / bunched 2:33-3:10, spread 2:03-2:16 / 58-68%, 47-53%.
- 5 humans + 20 bots: 13-14 s / bunched 2:13-2:47 / 55-64%.
Flight: cruise 21.0 s, holding BOOST 15.3 s, FORWARD + BOOST 13.2 s; boss → landing range 15.8 s at cruise.
Islands (150 each, 1 / 5 / 10 / 25 humans): 0 fallback pads, 0 chests in water; farthest chest 98 / 110 / 122 / 162 m.
25-explorer script (20 seeds, together, via the pad): every chest in 64-183 s (seed 11, the test's: 87.8 s).

## Known limits
- render.js ChestField draws at most 32 chests, so chestsMax stays 32. With 10 strong players who fan out perfectly,
  25 humans clear 32 chests by about 1:30. Raising that cap (e.g. 48) would let chestsMax grow for big rooms.
- The planet now sits 350 m from the boss: at the nebula's edge (cloud radius 220 × 1.15 = 253 m, sky switch-out
  1.6 × 220 = 352 m), so the whole boss → planet approach keeps the nebula sky. Not checked visually (no browser).
