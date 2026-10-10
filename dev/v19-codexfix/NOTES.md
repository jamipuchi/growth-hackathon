# v19-codexfix: Codex v1.7 performance findings B1 (TV draw calls) and M6 (phone smoothness, regular route)

Measured Oct 10 2026 on a frozen worktree of HEAD 2640c2d (`/private/tmp/claude-501/v19-codexfix`), ASTRA_MOCK=1, one browser at a
time, ports 8620-8622, shared laptop (load ~10). Harness: `scripts/` = Codex's v1.7 crowd stress scripts retargeted to the worktree
plus a per-draw attribution probe (`lib2.mjs` installAttrib / readAttrib / fixedBreakdown) and an M6 probe (`probe-init.js`).

## B1: crowded TV island over 120 draw calls

Reproduction (Codex's): 25 human records on the island, 25 parked ships, 16 mines, 8 decoys, EMP / ink / tractor on 8 actors, the
TV spectator camera (Chromium 1440x900), 25 s window, every frame sampled.

Cause (worst frame of HEAD, 144 calls): 14 default explorers 42 (3 each), 8 decoy stand-ins 32 (the placeholder explorer is 4
meshes), 10 parked ships 30 (3 each), bloom post 14, island kit 15, everything else 11. The three per-type caps (explorers 14,
parked 10, decoys 8) each fit on their own; together with the effects they did not.

Fix (`patch_b1.py`, render.js only, 19 edits, re-appliable on main once "v1.9 assets" lands):
1. ONE draw-call budget per frame for the island's actors: `IslandWorld.actorBudget()` = limit (TV 120, phone 80) - 2 margin -
   the bloom passes (14 on bloom tiers) - `countFixed()` (every non-actor draw of the island scene, counted as if all of it were in
   view, A-010's pooled system in full: an upper bound, so a camera cut cannot overshoot; recounted every frame, ~100 nodes).
2. Explorers first (the TV's humans nearest first, `lodHumans` stops when the next mesh does not fit), then decoys, then parked
   ships, each nearest first while its mesh fits (`entPlanLod(..., budget)`, `meshCost()` = the model's draws, 3 before it is
   built). Forced views (my explorer, the followed one, a shot's subject) always keep their mesh. The rest are the usual glow
   impostors. Up close nothing changes.
3. A decoy's stand-in is ONE merged vertex-coloured mesh (`holoStandIn`; was 4 draws for a person, 2 for a ship; a car decoy keeps
   the A-009 car when v19-assets' `defaultCarMake` is there). The hologram look is unchanged (holoLook tints it).

| TV crowd + effects | render.js | max calls | p95 | frames > 120 | fps / 1% low |
|---|---|---:|---:|---:|---|
| default models, run 1 | HEAD | 136 | 130 | 183 / 1499 | 60 / 52.4 |
| default models, run 2 | HEAD | 142 (144 attributed) | 141 | 929 / 1499 | 60 / 53.8 |
| drawn models (14 entity3d + ship3d) | HEAD | 134 (136 attributed) | 132 | 1068 / 1499 | 60 / 47.2 |
| default models, run 1 | patched | 100 (102) | 97 | 0 / 1499 | 60 / 52.9 |
| default models, run 2 | patched | 103 (105) | 102 | 0 / 2999 | 120 / 107.5 |
| drawn models | patched | 113 (115) | 113 | 0 / 2999 | 120 / 106.4 |
| default models, FINAL (14bf2f3 + both patches = the landed render.js) | landed | 102 (104) | 99 | 0 / 2999 | 120 / 106.4 |
| drawn models, FINAL | landed | 109 (111) | 109 | 0 / 2999 | 120 / 105.3 |
| PHONE default crowd (WebKit 844x390 DPR 3), HEAD + B1 | patched | 63 (68) of 80 | 63 | 0 / 1499 | 60 / 55.6, 107.7k tris (0 over 120k) |

(Codex v1.7: phone 74 calls, 108,346 triangles.) The FINAL runs set the round to 4 minutes first (`POST /mode {minutes:4}`; v1.9
defaults to 1 minute) so the 25 s window stays inside the round.

(The "attributed" max counts the probe's own frame boundaries; the sampler's max reads renderer.info.) After the fix the worst
frame holds all 14 nearest explorers as meshes (42 calls), the decoys (8 stand-ins or the drawn holograms), and 3-7 parked ships.
`countFixed` = 29 (kit 15, other meshes 11, A-010 3) against 26 actually drawn: 3 calls of slack plus the 2 margin.

## M6: regular route, phone smoothness

What Codex's failing capture-free run shows (`dev/v17-test/data/regular-webkit-no-video/perf.log`): at ~2 s after the first chest
both WebKit pages (TV and phone, two contexts of ONE WebKit browser) drop to exactly 15.0 fps (p90 67 ms = 4 vsyncs) in the same
5 s window and stay there for the remaining 140 s, at every quality tier: the governor walks both from tier 0/1 to tier 5 (pixel ratio
1, no bloom, near rocks only, 20-29 calls) and nothing changes. Codex's host snapshot inside that stretch
(`regular-host-load.json`, 11:29:03Z): an unrelated node process at 117 % CPU, Spotlight `mds_stores` 90 %, Adobe services ~110 %,
several Chrome GPU helpers. A cost that no tier changes and that hits two separate pages at once is not the game's rendering load:
the pages were starved (CPU / the shared WebKit UI and GPU processes).

My reproduction (HEAD 2640c2d, the same capture-free regular route: Codex's adapter `dev/v17-test/scripts/e2e-adapter` in the frozen
worktree as `dev/v17-e2e`, both pages in WebKit, bots 0, no shots, port 8622, 14:07-14:12, load ~10, plus `scripts/probe-init.js`
sampling both pages every 5 s: `data/m6-base-probe.jsonl`, table: `node scripts/probe-table.cjs data/m6-base-probe.jsonl`):

| | fps avg (worst window) | 1% low avg (worst window) | p90 | calls max | tier |
|---|---|---|---|---|---|
| phone | 60 (59.8) | 51.8 (26.3) | 17.3 ms | 42 | 0 |
| TV | 60 (59.2) | 52.1 (23.6) | 17.3 ms | 43 | 0 |

Gates all PASS (13 chests, 0 console errors). Through the first chest (round 102.5 s) and to the end, both pages hold 16.67 ms frames;
the game's own JS per frame is ~1-2 ms (WebKit's timer is 1 ms coarse), main-thread timer lag ~2 ms, shader programs stay at 172 and
textures flat after landing (no compiles, uploads or model swaps mid-round). The only lows are one-off: page load, the space -> island
switch (both pages: one 51-52 ms frame inside the rAF callback, +6 shader programs, +31 geometries uploaded; windows' 1% low 23.6-27.3)
and the explorer's model build (25-26 ms frames). So M6's sustained drop did not reproduce on this host; its cause is external.

The game-side defect it exposed, fixed (`patch_m6.py`, class Perf): under an outside cap the governor cascaded to tier 5 and stayed
there (the lowest quality for the rest of the round, for nothing). Now a descent is followed from its first step; if it reaches the
last tier while the frames stay steady (p10 >= 0.8 p90), long (>= 45 ms) and CPU-idle (work p90 < 8 ms), and no step shortened them
by 10 %, the governor goes back to the tier it started from (no 20 s blocks) and holds it (`capped`, like the 30 Hz Low Power Mode
rule) while the frames stay at that cap; a mixed window as the cap lifts does not trigger a new step. Any step that helps (a GPU-bound
phone, a vertex-bound one that only bloom-off fixes) makes it a normal descent exactly as before.

`node dev/v19-codexfix/gov-test.mjs <old render.js> <new render.js>`: 8/8 traces OK. Codex's trace (60 fps, then 15 fps at 1 ms JS):
old ends at tier 5, new returns to tier 0 (phone start tier 2: back to 2) and holds; the cap lifting after 60 s: old climbs 5 -> 0 over
10 changes, new is already at 0 (6 changes); GPU-bound, last-tiers-only, CPU-heavy, uneven and steady-40 ms traces: identical to old.
`dev/v12-client/render/unit.mjs`: 88/88 on HEAD, on HEAD + both patches, and on 14bf2f3 + both patches.

Not fixed here (nextTask): the space -> island switch compiles 6 programs and uploads 31 geometries in one frame (51-52 ms on both
pages); pre-compiling the A-008 skinned explorer variant was avoided on purpose in v1.5 (a WebKit crash building / disposing a
retargeted explorer early), so it needs its own careful task. The e2e gate still averages windows (Codex: gate steady-state windows).

## Found on the way (not my lane): v1.9 runtime assets are not in git

The frozen worktree of 14bf2f3 logs `404 /assets/A-009-defaults/car.js` on every TV session (render.js's warm-up prefetches the car)
and `404 /assets/A-008-rigs/creatures.js` when entity3d.js wants the quadruped clips: the "v1.9 assets" commit (515b928) wired them
in, but these files are untracked in the main tree: `assets/A-009-defaults/car.js`, `car.glb`, `car-manifest.json`,
`assets/A-008-rigs/creatures.js`, `quadruped.glb`, `quadruped-clips.json`. A release worktree made from git gets console errors
(the e2e `noConsoleErrors` gate fails) and toy cars / procedural quadruped clips. They exist on disk in the main tree.

## Reproduce

1. `git worktree add --detach /private/tmp/claude-501/v19-codexfix <commit>`; the scripts' ROOT is that path (`scripts/lib.mjs`,
   `scripts/lib2.mjs`, `scripts/server.cjs`, `scripts/crowd-drawn-server.cjs`); PW_CORE / browsers as in Codex's lib.mjs.
2. B1: `cd dev/v19-codexfix && OUT=$PWD/runs/<name> PORT_RUN=8620 node scripts/crowd.mjs tv --effects` (default models),
   `... PORT_RUN=8621 node scripts/crowd-drawn.mjs tv --effects` (drawn), `... node scripts/crowd.mjs phone --effects`,
   `... node scripts/crowd-space.mjs tv` (25 ships in space). Result: `runs/<name>/data/*.json` (`perf`, `violations`, `attrib.worst`
   = the worst frame by owner, `fixed` = what countFixed counts).
3. M6: copy `scripts/e2e-probed/{run,driver}.mjs` to `<worktree>/dev/v17-e2e/`, then from the worktree root
   `PROBE_OUT=<abs path>.jsonl node dev/v17-e2e/run.mjs --port 8622 --bots 0 --route regular --no-shots --engine webkit`;
   `node dev/v19-codexfix/scripts/probe-table.cjs <probe>.jsonl`.
4. Governor: `git show 515b928:render.js > /tmp/old.js && node dev/v19-codexfix/gov-test.mjs /tmp/old.js render.js`;
   `node dev/v12-client/render/unit.mjs`.
5. The patches: `python3 -I dev/v19-codexfix/patch_b1.py render.js && python3 -I dev/v19-codexfix/patch_m6.py render.js` (already
   applied to the main tree's render.js; every anchor is asserted, so a second run stops without writing).
