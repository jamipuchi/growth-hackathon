# v15 tests: the phone tour and the entity kit, brought up to v1.4

10 Oct, 10:49 to 11:06. Harnesses edited in the main tree, then copied to and run in the frozen worktree
`/private/tmp/claude-501/v15-tests` (detached at a1bf429 = v1.4 + ship3d + entity3d). ASTRA_MOCK=1, no OpenAI calls.
Ports 8496 (tour) and 8497 (kit). One browser job at a time. HOLD was off and memory pressure was 1 before every run.
Every server and browser was stopped by its own harness (ports 8496 and 8497 were free afterwards).

## Commands (run from the repo root, or the worktree root: each harness uses the server.js of its own tree)

```
node dev/v13-phone/tour.mjs --port 8496 --bots 2      # WebKit iPhone, ~91 s
node dev/v13-entity/run.mjs --mock --port 8497        # Chromium TV + WebKit phone, ~25 s
```
The default ports are 8364 (tour) and 8274 (kit), so pass `--port`. The kit refuses a port that is already in use.

Exit codes:
- tour.mjs: 0 = every check passed and every step ran; 1 = a check missed or a step failed; 3 = fatal (the server or
  browser did not start). The old tour exited 0 even when checks missed. It now prints `MISSED: <name>` and
  `STEP FAILED: <name>` lines.
- run.mjs: unchanged. 0 = every hard check passed; 1 = a hard check failed; 2 = bad arguments; 3 = setup failed.

## Results

| run | clock | result | wall |
| --- | --- | --- | --- |
| tour #1 | 10:56:40-10:58:11 | 80/80 checks, 0 steps failed, exit 0 | 91 s |
| tour #2 (stability) | 11:02:20-11:03:49 | 80/80 checks, 0 steps failed, exit 0 | 89 s |
| kit #1 | 10:59:31-10:59:58 | 669/699 checks, 13 hard failed: 12 = my person-scale bound (a test bug, fixed), 1 = ship3d lite budget | 27 s |
| kit #2 | 11:01:21-11:01:45 | 681/699 checks, 1 hard failed (the ship3d lite budget, a real finding), 0 soft failed, 17 n/a, 13/14 drawings, exit 1 | 23.4 s |

Outputs (in the worktree): `dev/v13-phone/tour-report.json`, `dev/v13-phone/shots/*.png` (58 shots),
`dev/v13-phone/tour-run.log`, `tour-run2.log`; `dev/v13-entity/report.json`, `dev/v13-entity/shots/*.png` (22),
`dev/v13-entity/kit-run.log`.

Numbers measured at 10:57 (tour) and 11:01 (kit):
- Paper share at 844x390 and at 390x844 (WebKit headless, safe-area insets 0): #drawPad is 772x376 and 376x772, which is
  **88.2%** of the safe area. #stage is 778x382, which is **90.3%**. The rail is 52 px. The gate is 75% on #drawPad. The
  lane's target is 90%: the stage meets it, and the paper inside the stage's 3 px border reaches 88.2%.
- SKIP (#useDefault) with the example card open: 69x42 px, on top at its centre (elementFromPoint), and Playwright's
  trial tap passes in both orientations. A real tap over the open card goes to play.
- Countdown hook: the "3" is 226 px (58vmin at 390). The server's countdown (POST /start {} → `phase: "countdown"`,
  `countdown: 3`) showed `["3","2","1","GO!"]` on the phone, then phase `playing`.
- Kit, 3D builds from the server's spec (mock: `source "entity"`, from astra.js `fromEntity`):
  - ship3d.js: TV (big) 3740 to 4626 triangles, 3 draw calls, 4 to 6 ms. Phone (lite) 2660 to 3020 triangles, 3 draw calls,
    3 to 27 ms. The phone's result card (preview, quality phone) is 3380 to 3740 triangles with `ship3d: true`.
  - entity3d.js (every explorer is the dev kit's person in mock): TV (big) 4973 triangles, 3 draw calls, 2 to 7 ms. Phone
    (lite) 2667 triangles, 2 draw calls, 3 to 18 ms. The preview has `entity3d: true` for both astronauts (3969 triangles
    on the phone). The TV game's own DrawnCache built all 6 explorers with `entity3d: true`. It built no ship (0 entries,
    reported as n/a): its camera was on the planet.
  - inflate.js (the fallback; checks unchanged): TV 10992 to 11396 triangles, 1 draw call. Phone 2340 to 2640 triangles,
    7 to 30 ms.

## What changed and why

### dev/v13-phone/tour.mjs
- Draw screens (ship, controller, explorerDraw, planetController) now also need #stage, #drawRail and #drawHeader.
  #draw now holds the stage and the rail.
- #example: the card opens by itself only the first time per step (localStorage `sp.guideSeen`). The old check passed
  only on a first visit. The tour now clears `sp.guideSeen` before each draw screen, so every visit is a first one, and
  also needs #guide visible.
- New step "guide + paper", in both orientations:
  - the card opens by itself on a first visit and stays closed on a second;
  - tapping #drawHeader reopens it, and #guideOk closes it;
  - #useDefault stays tappable with the card open (elementFromPoint plus a Playwright trial tap; landscape also taps it
    for real and expects play);
  - DRAW on the rail (#modeDraw) works under the open card;
  - #drawPad covers at least 75% of the safe area (insets read from env() through a probe), with the share reported.
- Join screen:
  - #fsBtn is visible, and `__spTest.fullscreen()` gives iosSafari true, supported false (an iPhone has no element full
    screen), active false.
  - The iPhone "Add to Home Screen" hint opens by itself on a first visit and closes with ✕ (`sp.a2hsSeen` remembered).
  - #fsBtn shows the hint, and `__spTest.installHint()` shows it.
  - After JOIN under automation the viewport is still 844x390 and full screen is not active.
  - The hint is closed before JOIN.
- New step "late hints":
  - `lateHint('dig','part',['shovel','drill'])` shows the card ("DRAW A SHOVEL AND A DRILL"), and its one action
    "REDRAW MY EXPLORER" opens the explorer drawing.
  - `lateHint('weapon','button')` shows "DRAW A SHOOT BUTTON" with "DRAW THE BUTTON", which opens the add-a-button sheet;
    CANCEL closes it.
  - The step waits for the death card to go first, because it would take the taps.
- New step "countdown (hook)": `countdown(3)` shows `.pe-cd.pe-on` with a "3" of at least 40vmin, read in the same task,
  because the lobby's live ticks hide it within a tick. The screenshot keeps calling the hook. `countdown(0)` pops "GO!".
- New last step "server countdown": POST /start {} answers `phase: "countdown"`. The phone shows 3, 2, 1 and GO! in
  order, then reaches phase playing. This step starts the round on the tour's own server, which is why it runs last.
- Exit code and summary as described above. Imports `post` and `waitFor` from lib.mjs, which both versions export. The main
  tree's lib.mjs changed during this work (startRound and waitForPlay were added).

### dev/v13-entity/run.mjs (+ README.md)
- HTTP checks:
  - a ship spec, or a body spec of the answer's type, is on the answer;
  - the same spec is served at `/ship-spec?v=<hash>`;
  - the entity messages on the phone and TV streams carry it;
  - the lander's parked ship carries it (`island.parked[].spec`);
  - the late TV stream has it (`world.entities[].spec`).
- Browsers:
  - the kit imports `/ship3d.js` and `/entity3d.js` (the same module instances as render.js) and builds each server spec
    directly;
  - its checks are: triangles within the builders' own Q budget + 400 (hard), draw calls (hard ≤ 12, soft ≤ 3), scale
    (hard), build ms (soft);
  - `preview card builds it with ship3d.js / entity3d.js`: hard where the spec matches the shown type. Otherwise it is
    n/a, because in mock every explorer's body spec is a person while the kit shows the drawing as a car, bike and so on,
    so the inflate.js fallback is acceptable there;
  - soft: what the TV game's DrawnCache (`game._internals.drawn`) built.
- The person's 3D height range is 1.62 to 2.48 m: the body is 1.8 m ± 10%, plus up to 0.5 m of head gear. Run #1 measured
  2.09 m because the dev-kit person wears an antenna and a lamp on its head (astra-body.js fromEntity: `antenna@head`,
  `lamp@head`; entity3d.js:820; see shots/astronaut-shovel-tv.png). That was a test bug, not a game bug.
- WebKit is pinned to webkit-2311, as lib.mjs does, because webkit-2368 hangs playwright-core 1.58.2. The kit used to take
  the newest WebKit.
- The inflate.js checks are unchanged. The README has a v1.4 section.
- Not changed: server.cjs and drawings.mjs. **Replay caveat (not run, by the ASTRA_MOCK=1 rule):** server.cjs answers OpenAI
  by image only. The v1.4 spec requests (`text.format.name` ship_spec / body_spec) would get the recorded ENTITY answer of
  that image, normalised into a spec labelled `source: "model"`. Use `--mock` for the v1.4 path, or make server.cjs answer
  spec requests with 599 (astra.js then falls back to fromEntity).

## Real game findings

1. **ship3d.js returns "lite" ships over its own triangle budget** (minor, phone performance). It built the
   ship-landing-legs drawing (the E05 landing legs, as the dev-kit ship with every space skill) at quality lite with
   **3020 triangles**. Its Q.lite budget is 2600, and the kit allows 3000 with the slack. ship-gun-flames, ship-plain and
   ship-photo came out at 2660.
   - The phone's game view builds drawn models at lite (render.js:654, `configure(phone)` → `"lite"`).
   - ship3d.js:1290-1295 shrinks the detail 5 times and then returns over budget without saying so (budget at ship3d.js:23).
   - entity3d.js lite persons are 2667 triangles, also over 2600 but within the slack.
   - Evidence: worktree `dev/v13-entity/report.json` → drawings[ship-landing-legs].numbers.phone.b3, and
     `dev/v13-entity/kit-run.log`.
   - The kit stays at exit 1 until this is fixed or the owner raises the lite budget.
2. Observation, not a failure: on the demo result screens (`__spTest.go("shipResult")`, a data-URL image) the phone polls
   `GET /ship-spec?v=<hash>` and gets 404 several times per card (render.js watchSpec, about 10 tries 800 ms apart). This is
   harmless and by design. No console errors.

## For the runner (all.sh)
- Pass `--port` (8496 / 8497 here), and `--mock` to the kit. Run one at a time: each opens its own browsers.
- Treat the kit's exit 1 as the known ship3d lite finding until it is fixed (`report.json` summary.hardFailed = 1, check
  "phone: ship3d.js triangles within the lite budget").
- Both harnesses use the PW_CORE playwright-core at /Users/jaumepuig/Documents/linkedin/node_modules/playwright-core and
  the cached Chromium and WebKit 2311. three.js comes from cdn.jsdelivr.net, so network is needed.
