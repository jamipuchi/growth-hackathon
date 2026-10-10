# Space Party v1.3 — QA findings

Tested 10 October 2026, approximately 08:18–08:54 UTC (10:18–10:54 Madrid). Frozen tag **v1.3**, commit `21d329197f22ffe1f6bcfa55716c151e9728d9c9`. Source references below are **at that tag**, not the concurrently changing main checkout. Acceptance source: current `PLAN.md` section 0, including the 10:00 decisions.

**Verdict: the requested gates do not all pass.** Crowded island effects exceed both draw-call budgets. There are also confirmed drawing-fallback, countdown, pacing, and generated-controller delivery problems. No game files were changed. The known inflated “cookie” ships were excluded from this review.

## Prioritized fixes

### B1 · Blocker — simultaneous island effects exceed the rendering budgets

**Observed:** with 25 planet actors, 25 parked ships, 16 mines, 8 decoys, and EMP/ink/tractor flags on 8 actors, phone draw calls are **89 in all 1,500 samples** (limit 80). TV peaks at **139**, with **2,199/3,000 samples above 120**. Phone triangles peak at 104,695 and its 1% low is 55.6 FPS; those two gates pass. High desktop FPS does not excuse the draw-call violation.

This is a **staged population/effect stress scene**, rendered by the unmodified game. Bots normally remain in space; QA moves them onto the island and holds effects long enough to measure. Effect lifetimes and positions are synthetic, not a claim that this exact pile-up occurred naturally. Baseline crowd without effects passes at 72 phone / 103 TV calls.

- Evidence: [phone screenshot](shots/phone-planet-crowded-effects.png), [TV screenshot](shots/tv-planet-crowded-effects.png), [phone measurements](data/crowd-phone-effects.json), [TV measurements](data/crowd-tv-effects.json). The TV screenshot is the final frame, not its 139-call peak; the raw measurements establish the peak.
- Likely locations: `render.js:2026` (`DecoyView`), `render.js:2216` (separate 3/8 decoy mesh cap), `render.js:5022` (8/14 explorer cap), `render.js:5030` (parked-ship budget). These caps accumulate without a shared frame budget.
- Suggested fix: reserve headroom for effects across explorers, parked ships and decoys; batch/instance compatible decoy parts or reduce distant model counts when effects appear. Recheck **every frame**, not averages, with this same stress harness.

### M1 · Major — a real generation timeout grants undrawn skills and spends a drawing

**Observed:** I drew a rough rocket with cannon, flames and landing feet. A real request timed out at about 4 seconds; the game returned `ok:true`, `source:"devkit"`, with SHOOT, BOOST, SHIELD, LAND, SCAN, FLARE, MINE and EMP. The drawing budget fell from 5 to 4. Nothing on screen disclosed the timeout or explained why undrawn shield/scan/etc. were granted. This breaks section 0's “skills unlock only from what is drawn.”

- Evidence: [actual input drawing](shots/real-ship-drawn.png), [actual response and state](data/real-generation.json), [server timing log](logs/real-server.log), [readable result-card replay](shots/replay-real-timeout-card.png). The last screenshot replays the **recorded real response** against the same strokes, with mocks; it is not another model call. JSON contains the full skill list; the card shows only its first visible skills.
- Likely locations: `astra.js:584` (failure becomes successful dev kit), `astra.js:677` (`devKitEntity`), `astra.js:707` (exception fallback), `server.js:505` (successful answer spends a drawing).
- Suggested fix: keep entity creation available with a plain, no-extra-skill fallback, explain the failed read, and offer a retry without another charge. Restrict the generous kit to mock/development operation. Do not make a slow API response a gameplay advantage.

### M2 · Major — phones miss the TV's countdown

**Observed:** during the TV's 3-2-1, both the server and phone remain in `lobby`. The phone still says “Wait for the host to press START.” The TV subsequently posts `{}` to `/start`; the phone goes directly `lobby → playing`. This is a paired live check, beyond the supplied phone tour.

- Evidence: [TV countdown](shots/phone-tour/sync-tv-countdown.png), [phone at the same countdown](shots/phone-tour/sync-phone-during-tv-countdown.png), [sync state and request body](tour-report.json).
- Likely locations: `space.html:724`–`758` (local countdown, then empty POST), `server.js:465`–`469` (server countdown requires an explicit option), `controller.html:2740` (phase presentation/GO handling).
- Suggested fix: START immediately requests `{countdown:true}`; both screens display the authoritative countdown and handle `countdown → playing`. Reduced motion should change animation, not shared timing.

### M3 · Major — the opening still consumes the time intended for the planet

**Observed:** the frozen build has a 1,100 m boss approach, 18 m/s cruise, base 3,000 HP with scaling, and another 800 m to the planet. Earlier retained natural expert evidence reaches the boss at **37.9 s** and kills it at **77.9 s**, before any landing. That already misses section 0's roughly 45-second expert landing target, and the roughly 20-second cruise target. The newer scripted tour skips travel and must not be used as pacing evidence.

- Evidence: [early flight](shots/tv-space-flight.png), [retained expert log](logs/e2e-expert.log). That older log stops after boss death: it does **not** establish a final landing/completion time. The tour's 14:57 timer is a QA-only extended cap, not a product bug.
- Likely locations: `contract.js:41`, `contract.js:51`, `contract.js:78`, `contract.js:83`; old intended timing is explicitly described at `contract.js:28`–`38`.
- Suggested fix: shorten approach and post-boss travel and retune scaled HP together. Validate natural expert and regular paths against 45/80-second landing targets and the four-minute round cap; put the saved time into planet play.

### M4 · Major — completed Sol controller HTML is lost while the player reads the result card

**Observed:** controller recognition completed in about 1.5 seconds; the Sol HTML job then succeeded in about 4.9 seconds. I waited on the result card, tapped Play, and the mounted pad remained `source:"template"`, with no sandbox fallback/validation failure. A deterministic mock-only reproduction confirms: server `source:model, pending:false`; phone has no game/event stream yet; after Play it still uses the cached template.

- Evidence: [actual controller result](shots/real-controller-final.png), [actual Play screen](shots/real-controller-live.png), [actual state](data/real-generation.json), [deterministic reproduction](data/pad-repro.json), [reproduction screenshot](shots/pad-missed-model-event.png). The screenshot alone cannot distinguish template from model; the state captures do.
- Likely locations: `controller.html:2412` (`ensureCtl` fetches only when `S.pad` is absent), `controller.html:2564` (renderer/event stream starts on Play), `server.js:239` (one-time HTML broadcast), `server.js:264` (cached result already available).
- Suggested fix: refresh the cached controller on entering Play / reconnecting, or subscribe before drawing completes. Reconcile only the latest pad version so a stale completion cannot replace a redraw. Preserve held-touch safety during the swap.

### N1 · Minor — the drawn steering circle is ignored and replaced somewhere else

**Observed:** the first-timer controller has a rough unlabelled circle on the left and FIRE/LAND boxes on the right. Both real controller reads recognized FIRE and LAND, but the server added an `auto:true` stick lower and farther left. The preview visibly separates the cyan hit area from the drawn circle. Steering remains available; the drawing-to-control promise is weakened. A bare circle is ambiguous, so this is a usability finding rather than a claim that every circle must be classified as a joystick.

- Evidence: [input](shots/real-controller-drawn.png), [misaligned result](shots/real-controller-final.png), [layout including auto stick](data/real-generation.json).
- Likely locations: `astra.js:142` (stick recognition asks for a knob/arrows), `world.js:131` (`withSteer` chooses empty space), `server.js:510` (applies fallback).
- Suggested fix: show a very clear circle-with-knob example; when adding fallback steering, prefer a plausible unused round ink region and label it as an added control. Do not silently imply that the displaced hit area is the user's circle.

### N2 · Minor — the followed player replaces rank 7

**Observed:** TV combat scoreboard shows ranks 1–6 and followed rank 20. Rank 7 disappears. Section 0 requests **7 rows plus the followed player**.

- Evidence: [TV boss scoreboard](shots/tv-boss.png).
- Likely location: `space.html:843`–`847`, especially `vis[cap - 1] = ...`.
- Suggested fix: append a distinct followed-player row when outside the top seven; keep ranks 1–7 intact and reposition the feed accordingly.

### N3 · Minor — “DRILLING 78%” stays after the player stops

**Observed:** the scenario releases DRILL after a partial rock opening; the HUD continues to say “DRILLING 78%” through the following mischief and wreck shots, about 40 seconds later. It looks like ongoing work that has stalled, rather than saved partial progress. DIG uses the same predicate.

- Evidence: [initial drilling](shots/tv-drill.png), [later unchanged label](shots/tv-wreck.png), [phone equivalent](shots/phone-wreck.png); release is explicit in [scenario script](scripts/scenario.mjs).
- Likely location: `render.js:5880`: proximity plus `near.dug > 0` marks the player as working even with the action flag off.
- Suggested fix: use the action flag for “DIGGING/DRILLING”; show a paused/progress label and a clear resume hint when partially complete but idle.

### P1 · Polish — island lighting and silhouettes fall short of the bright, chunky style

**Observed:** space has strong blue/purple saturation, depth and an obvious boss focal point. The island shifts to olive hills, a beige/grey horizon, thin palms and weak contact with the ground. Crowded distant players become large glowing dots. This is a visual judgment against section 0, not a rendering crash. The two supplied reference PNGs depict the same space composition; neither provides an island layout to copy literally.

- Evidence: [TV island](shots/tv-planet.png), [phone island](shots/phone-planet.png), [crowded island](shots/phone-planet-crowded.png). Compare frozen `assets/reference/world-look.png` and `ui-inspiration.png`.
- Likely locations: `render.js:4718` (`islandSky`), `render.js:4769` (`IslandWorld` fog/lights), `assets/A-005-island/island.js` materials, `render.js:1236` (glow impostors).
- Suggested fix: a cleaner blue horizon, richer grass separation, stronger contact shadows, chunkier nearby foliage, and smaller/clearer distant player markers. Coordinate with the asset owner; do not spend the already-failing effects budget on extra unbatched meshes.

### P2 · Polish — dark blue player names are hard to read from the sofa

**Observed:** NOVA's dark blue text on purple TV panels is much less legible than the white score/objective, especially at reduced viewing size. A host should not need to lean forward to identify the followed player.

- Evidence: [boss scoreboard/follow card](shots/tv-boss.png), [island name tag](shots/tv-planet.png).
- Likely location: `space.html:865` (uses player colour for the entire name); apply the same treatment to follow-card/name-tag styling.
- Suggested fix: white names with a strong outline and a separate player-colour chip/stripe. Retain colour identity without using low-contrast colour as body text.

## Performance numbers

TV: Chromium, **1440×900**. Phone: WebKit, **844×390 CSS px, emulated DPR 3, iPhone UA/touch**. The game's adaptive renderer selected internal pixel ratios about 1.5–2 on phone; it was not forced to render at full device DPR. These are laptop WebKit measurements, **not physical-iPhone certification**.

Each run has 24 bots + 1 human (25 total). Normal planet play has one landed human; bots remain in space. Separate crowd runs stage all 25 onto the island with 25 parked ships, using A-008 person models and the actual assets. Stress measurements use the renderer host; normal boss/planet measurements include the production phone/TV UI. No screenshots were taken inside the timed windows.

| Device / scene | Run start UTC | Window | FPS | 1% low | Max calls | Max triangles | Call overruns / samples | Result |
|---|---|---:|---:|---:|---:|---:|---:|---|
| TV boss combat | 08:24:41 | 20 s | 120 | 95.2 | 69 | 204,446 | 0 / 2,400 | Pass |
| TV normal planet | 08:24:41 | 25 s | 120 | 97.1 | 35 | 168,183 | 0 / 3,000 | Pass |
| Phone boss combat | 08:27:54 | 20 s | 60 | 50.0 | 47 | 64,354 | 0 / 1,200 | Pass |
| Phone cockpit | 08:27:54 | 8 s | 60.1 | 50.0 | 37 | 52,816 | 0 / 481 | Pass |
| Phone normal planet | 08:27:54 | 25 s | 60 | 52.6 | 34 | 58,599 | 0 / 1,501 | Pass |
| Phone 25-actor island | 08:30:40 | 25 s | 60 | 52.6 | 72 | 100,381 | 0 / 1,499 | Pass |
| TV 25-actor island | 08:31:17 | 25 s | 120 | 94.3 | 103 | 232,257 | 0 / 3,000 | Pass |
| **Phone island + effects** | **08:42:14** | **25 s** | **60** | **55.6** | **89** | **104,695** | **1,500 / 1,500** | **FAIL calls** |
| **TV island + effects** | **08:43:16** | **25 s** | **120** | **104.2** | **139** | **239,461** | **2,199 / 3,000** | **FAIL calls** |
| Phone boss death, no captures | 08:46:49 | ~8.4 s | 60 | 55.6 | 60 | 69,850 | 0 / 504 | Pass |
| Phone landing, no captures | 08:46:49 | ~8.3 s | 59.6 | 43.5 | 58 | 63,929 | 0 / 493 | Pass |

Phone limits: <=80 calls and <=120,000 triangles in every sample; 1% low >=30 FPS. TV limit: <=120 calls. **Zero phone triangle overruns in all listed windows.** Render samples count the initial frame; frame-time interval count is one lower. Source summaries: [TV](data/scenario-tv.json), [phone](data/scenario-phone.json), [transition recheck](data/transition-perf.json), `data/crowd-*.json`; individual frame values are in `data/raw-*.json`.

The older retained space run, [perf-space.json](data/perf-space.json), had phone max 56 calls / 69,650 triangles / 55.6 FPS low and TV max 57 calls. It was reused as earlier evidence, not substituted for the new planet/effects measurements.

All **A-001 through A-011** asset families loaded successfully across the tours (HTTP 200 manifests in scenario JSON), including the foreground rocks, cockpit, person rig, defaults, chest and FX assets. No failed asset requests or page crashes were recorded. Chromium emitted startup `GL_INVALID_VALUE ... glGetProgramiv: Program object expected` warnings in renderer-host runs; WebKit emitted none. These did not correspond to a demonstrated broken asset, so they are recorded as diagnostics, not an additional defect.

## Tests and interpretation

| Check on frozen source | Result | Evidence |
|---|---:|---|
| `dev/v12-client/render/unit.mjs` | 85/85 | [log](logs/render-unit-current.log) |
| `node-smoke.mjs` | 65/65 | [log](logs/render-node-smoke-current.log) |
| `node-game.mjs` | 66/66 | [log](logs/render-node-game-current.log) |
| `dev/v13-tv/unit-feed.mjs` | 18/18 | [log](logs/tv-unit-feed-current.log) |
| Original `dev/v13-phone/tour.mjs`, WebKit landscape + portrait | 46/46 | [report](tour-report.json) |
| Added paired TV/phone countdown assertion | **0/1** | same report, `sync` |

The render tests were copied into the owned QA lane solely to redirect imports/output paths; their assertions were not waived or changed. The v13 world notes about CameraRig moments and pooled `Snapshots.sample()` were read. **No failing obsolete expectation appeared in these frozen-source runs.** Passing old suites does not cover the new synchronization path, all cinematic behavior, or the crowded effects budget; the live failures above remain real failures.

QA-only errors were kept separate: an initial mixed-case player lookup; two real-generation waits that mistook hidden text/main-screen state for result-overlay completion. Their artifacts contain `harness-...-error` in the name. They are not product defects and their UI timings were discarded. All outbound calls from those attempts still count toward the cap.

## Visual tour and first-timer assessment

Quick visual indexes: [TV contact sheet](shots/contact-tv.jpg), [phone contact sheet](shots/contact-phone.jpg). Full-resolution originals are authoritative.

| Beat | TV evidence | Phone evidence | How exercised |
|---|---|---|---|
| Lobby | [TV](shots/tv-lobby.png) | [phone](shots/phone-lobby.png) | Live join/lobby |
| Countdown / GO | [3](shots/tv-countdown.png), [GO](shots/tv-go.png) | [during TV count](shots/phone-tour/sync-phone-during-tv-countdown.png), [GO](shots/phone-countdown.png) | Actual TV START; sync defect above. The phone file named `countdown` contains GO, not a countdown. |
| Space approach / boss | [flight](shots/tv-space-flight.png), [boss](shots/tv-boss.png) | [flight](shots/phone-space-flight.png), [boss](shots/phone-boss.png), [cockpit](shots/phone-cockpit.png) | Live combat; travel teleported for bounded tour |
| Boss kill / planet reveal | [kill](shots/tv-boss-kill-04.png), [reveal](shots/tv-planet-reveal.png) | [kill](shots/phone-boss-kill-04.png), [reveal](shots/phone-planet-reveal.png) | Real final shot after QA lowers boss HP; 12-frame screenshot burst per device |
| Landing / island | [landing](shots/tv-landing-shot.png), [island](shots/tv-planet.png) | [landing](shots/phone-landing-shot.png), [island](shots/phone-planet.png) | Real LAND and transition, approach teleported |
| Dig / drill | [dig](shots/tv-dig.png), [drill](shots/tv-drill.png) | [dig](shots/phone-dig.png), [drill](shots/phone-drill.png) | Real action inputs near each chest kind; partial opening |
| EMP / ink / tractor | [EMP](shots/tv-mischief-emp.png), [ink](shots/tv-mischief-inkbomb.png), [tractor](shots/tv-mischief-tractor.png) | [EMP](shots/phone-mischief-emp.png), [ink](shots/phone-mischief-inkbomb.png), [tractor](shots/phone-mischief-tractor.png) | Render/message injection; crowd stress separately exercises persistent scene flags |
| Mine / decoy | [mine](shots/tv-mischief-mine.png), [decoy](shots/tv-mischief-decoy.png) | [mine](shots/phone-mischief-mine.png), [decoy](shots/phone-mischief-decoy.png) | Render/message injection plus staged persistent mines/decoys |
| Steal / wreck | [steal](shots/tv-steal.png), [wreck](shots/tv-wreck.png) | [steal](shots/phone-steal.png), [wreck](shots/phone-wreck.png) | Presentation messages injected; not an end-to-end scoring/wreck-trigger test |
| Results | [TV](shots/tv-results.png) | [phone](shots/phone-results.png) | Real result transition after QA shortens remaining cap |

**Boss kill did not white out in the captured bursts.** TV maximum mean RGB was 110.83/255 with at most 0.34% near-white area; phone 145.09/255 and 4.807%, including bright UI. See [per-frame brightness analysis](data/boss-brightness.json). The scene remains readable. Screenshot bursts depressed the rolling perf overlay (sometimes to single digits); the separate no-capture boss-death/landing measurements above pass. Those overlay dips are not used as performance findings.

As a first-time player, the numbered drawing steps, example, clear yellow next action, unlock card and explicit ink-wipe message are helpful. The circle mismatch and undisclosed timeout rewards undermine trust. As a host judging the 1440×900 captures at sofa-like viewing size, START, GO, boss death and the winner are clear; small feed details and dark blue names are weaker. Space is much closer to the reference's saturated composition than the island. Rare-event rendering was inspected, but injected announcements do not prove the corresponding damage, ownership or scoring rules.

## Real-generation checks and call budget

Two drawing types were tested with ordinary pointer strokes in WebKit: a simple rocket and a left stick with FIRE/LAND boxes. The photo-first UI was inspected; a physical camera/paper workflow was not tested.

- Successful ship reads in the earlier attempts took roughly 2.1 seconds at the request level; the fully completed flow's ship read timed out and displayed its fallback in 4,042 ms.
- Controller Done → result state took 1,531 ms (real recognition request 1,436 ms). FIRE and LAND were readable; the plain circle was missed in both controller answers.
- Sol HTML completed in about 4.9 seconds, but the finished page was missed as described in M4.
- **8 outbound requests total, including the hedge and QA-retry attempts; cap 10. No further real calls were made.** [Complete call ledger](data/real-call-count.json). This small sample is not a reliability-rate estimate.

## Reproduction and limits

Owned scripts are in `scripts/`; all outputs are in this QA lane. To rerun, recreate the detached v1.3 worktree at the original path and use the installed/cached tools, one browser job at a time. `scenario.mjs tv|phone`, `crowd.mjs phone|tv [--effects]`, `pad-repro.mjs`, and `transition-perf.mjs` use only ports 8420–8425 and mock generation except the separately named real-generation harness. **Do not rerun the real harness under this task's remaining call budget without checking the ledger.**

Coverage limits: no physical iPhone/GPU certification, no 25-device network fan-out run, no complete new natural four-minute expert/regular round, no real photo capture, and no independent end-to-end rare-mischief/steal/wreck trigger certification. These are explicit limits of this bounded QA pass, not passes. The supplied render suites, phone tour, TV feed checks, live TV round presentation, requested visual beats, asset/per-frame performance, and real drawing checks were completed with the staging distinctions above.

Cleanup verified: all owned browser/server jobs closed, no listener on ports 8420–8439, and the frozen QA worktree was removed. Prior generated worktree artifacts were retained under `data/retained-prior-worktree/`; game source and other workers' changes were left untouched. See [cleanup record](data/cleanup.json).
