# v15-tests: the test harnesses brought up to date with v1.4 (for the tester, Codex)

## One command
    dev/v15-tests/all.sh --port-base 8490                 # everything: unit, client, e2e x2, entity kit, phone tour
    dev/v15-tests/all.sh --only unit,client               # node only, about 45 s, no browser
    dev/v15-tests/all.sh --skip e2e --port-base 8490      # all but the two real-time e2e routes (they take ~8 min)
    dev/v15-tests/all.sh --skip live,https                # any group or single suite can be skipped
Run it from the tree under test (main repo or a frozen worktree: `git worktree add --detach <dir> HEAD`, copy `.env` and
`.orch-certs` in). It prints one table and writes `dev/v15-tests/out/<stamp>/{summary.txt,summary.json,<suite>.log}`.
Exit 0 only when every suite that ran passed. Ports: e2e base, base+1; live-test base+2 (+3 HTTPS); selftest base+4;
phone tour base+5; entity kit base+6..9. dev/https/test.js always uses 8444 (hard-coded there): SKIP when busy.
Browser groups run one at a time and wait while `.orch/status/HOLD` is up (`--no-wait` skips that).

## What changed in the harnesses (v1.4)
- Countdown is a server phase: POST /start {} plays phase "countdown" (tick.countdown 3, 2, 1) for 3 s before "playing";
  {countdown:false} starts at once. The TV's START posts {countdown:true}.
  - dev/e2e/run.mjs: clicks START, waits for GO (phase playing, up to countdownSeconds + 8 s), screenshots the 3-2-1
    (`shots/<route>/countdown-{big,phone}.png`), records what each screen showed. New gates: `countdown` (server counted
    3,2,1 and went to playing 2-4.5 s later) and `phoneCountdown` (the phone showed at least two of 3, 2, 1 in order:
    phone-extras.js overlay `.pe-cd.pe-on .pe-cd-n`, or any element named countdown). The TV's digits (`#sting.on
    #stingBig`) are recorded as `countdown.big` (informational). No START button: POST /start {countdown:false}.
    `report.specs` counts my entity messages that carried a ship / body spec (ship3d.js / entity3d.js builds). Every old
    gate is kept.
  - dev/v11-client/lib.mjs: `startRound(base, {countdown=false})` (POST + wait for playing), `waitForPlay(base)`;
    killBoss / pressLand wait out a running 3-2-1 (it pins every ship to its spawn slot). `ensureShipSkills` drew on the
    3:00 assists to give a plain ship SHOOT/LAND; v1.4 never grants a skill, so it now draws a dev-kit ship instead.
  - dev/v11-client/server.cjs: the astra.generate wrapper passes `generate(body, { signal })` through (v1.4 abort).
  - selftest.mjs (startRound; 2 new checks: POST /start {} answers phase countdown 3, the ticks count 3,2,1 then
    playing ~3 s later; the "fail…" override check predated v1.3's never-fail finished drawings (server.js:579 answers the
    dev kit with fallback: true): now a speculative read must say "generation unavailable" and a finished ship must come
    back as server.js's fallback: v1.4's dev kit or v1.5's plain free entity (v15-fix, Codex M1: source "fallback",
    free: true, failed: "error"); 41/41 on a1bf429 and on the main tree with v15-fix's uncommitted server.js, 11:35), perf25.mjs (startRound; `config.shipsInWorld`: the 25-player cap seats at most 25), shots.mjs,
    run-e2e.mjs, dev/v12-client phone/tour, tour, tv/run-play, render/diag, render/perf: {countdown:false} or wait.
- Render suites: nothing was outdated (unit 85/85, node-smoke 65/65, node-game 66/66 on a1bf429, as Codex found). Added:
  unit.mjs `v1.4 lobby → countdown: nothing` + `v1.4 countdown → playing (GO!): one start`; node-game.mjs a countdown
  block (phone + TV: frames over countdown ticks, hud().phase, GO).
- dev/v12-client/tv/test-extras-jsdom.mjs: 2 outdated regexes (the v1.3 fun feed lines say "BUTTONS SCRAMBLED!" and
  "YOINK!", the test grepped "scrambled" / "pulled"): now ALL OK.
- dev/v12-client/phone/smoke (controller.html in a fake DOM, node only, now in all.sh's client group):
  dom.mjs got replaceChild / insertBefore / removeChild (v1.4's countdown overlay swaps its number node: t3-mischief
  crashed with "root.replaceChild is not a function"); t2-sandbox's hold-tip check encoded v1.2 (v1.3 made the very first
  touch of a control a sticky 2.2 s tip that a release does not hide): now checks both. t1 13/13, t2 53/53, t3 78/78.
- dev/v13-phone/tour.mjs (80/80, ~90 s): v1.4 drawing screen (#stage, #drawRail, #drawHeader; sp.guideSeen cleared so the
  example card auto-opens; #useDefault tappable over the card; paper share >= 75% of the safe area: canvas 88.2%, stage
  90.3% at 844x390 and 390x844), full screen (#fsBtn, __spTest.fullscreen/installHint), late hints (both one-tap actions),
  __spTest.countdown and the server-driven 3-2-1 after POST /start (phone showed 3, 2, 1, GO!). Exit 1 on any miss now
  (it exited 0 before). dev/v13-entity/run.mjs --mock (~25 s): the spec on every message and GET /ship-spec, each spec
  built by the game's own ship3d.js / entity3d.js (triangles vs their own budgets + 400 slack, draw calls, scale), the
  result card reports ship3d / entity3d true; WebKit pinned to webkit-2311 like lib.mjs. Details: notes-tours.md.
- Not updated beyond the countdown: the older v1.2 browser tours (dev/v12-client/tour.mjs, phone/tour.mjs, tv/run-play.mjs,
  render/perf.mjs, diag.mjs) and dev/v11-client/shots.mjs: their selectors predate v1.4's drawing screen; the maintained
  phone tour is dev/v13-phone/tour.mjs.

## Failures: real game bugs vs outdated tests (worktree at a1bf429, 10 Oct 10:58-11:05)
| suite | result | verdict | evidence / fix |
|---|---|---|---|
| render unit.mjs | 86/87 | REAL BUG (render lane) | `render.js:3852` plays the start fanfare only on `lobby → playing`; with the v1.4 countdown it is `lobby → countdown → playing`, so GO! is silent on every screen. Fix: `(was === "lobby" \|\| was === "countdown") && phase === "playing"` (checked: 87/87 with it). |
| dev/astra/astra-test.js | 27/29 | outdated test (astra lane) | lines 324 and 424 assert one HTTP call per ship drawing; v1.4 makes a parallel `ship_spec` (and `body_spec`) call by design, and it fires first, so line 325's `calls[0]` is the spec call. Fix: count `calls.filter(c => !/_spec$/.test(c.req.text.format.name))` and pick `calls.find(c => c.req.text.format.name === "entity")`. |
| dev/astra/gen-regression-test.js | 63/103 | outdated harness (astra lane) | the fake fetch serves each image's recorded calls in order; the new spec call takes the entity call's fixture, so the entity call falls back to the dev kit. With spec calls answered 599 apart from the queue (2 lines in the fake fetch): 103/103, 0 failures. |
| dev/netcode/sim-test.js | 31/32 | test geometry (netcode lane) | "scoring": `kill()` puts bob 6 m from ana on +z; with v1.4's wider chest spread ana's chest is on a slope and bob stands 2 m higher (ana y 9, bob y 11); explorer shots are level from chest height (`world.js:780`), so every shot passes over her (timeout "bob kills ana"). Fix: put bob at ana's height on level ground (or pick the side with the smallest height difference). Gameplay note: level shots make island PvP miss on slopes. |
| dev/v12-client/tv/test-extras-jsdom.mjs | 2 FAIL | outdated test, FIXED here | see above. |
| dev/v12-client/phone/smoke t2 / t3 | 1 FAIL / crash | outdated test + shim gap, FIXED here | see above. |
| dev/v13-entity/run.mjs --mock | 681/699, 1 hard | REAL BUG (ship3d.js, perf lane) | the landing-legs ship builds at 3020 triangles in "lite" (the phone's game view, render.js:654) against ship3d.js's own budget Q.lite 2600 (ship3d.js:23): the loop at ship3d.js:1291-1295 lowers detail 5 times, then keeps the over-budget build silently. The kit allows budget + 400 and still fails. |
| node-game.mjs (computeHud) | not a gate | minor, invisible | `render.js:6059` counts the HUD clock UP during the countdown (tick.clock is seconds left); both pages hide the clock during the 3-2-1, so it is not asserted. |

## Proof runs (frozen worktree at a1bf429, ASTRA_MOCK=1, ports 8490-8499, 10 Oct 2026)
Full `all.sh --port-base 8490`, 11:05-11:16, 690 s: 25 suites, 18 pass, 7 fail, 0 timeout (evidence/summary-full-1105.txt).
Then `all.sh --only unit,client`, 11:17-11:19, 130 s: 17 pass, 4 fail (evidence/summary-node-1117.txt): the selftest
fix made harness-self 41/41. Every failure left is classified in the table above:
- REAL: render-unit 86/87 (render.js:3852 GO silent after the 3-2-1); entity-kit 681/699 (ship3d.js lite 3020 > 2600).
- Outdated tests in other lanes (fixes proven on scratch copies): astra-test 27/29, gen-regression 63/103 (103/103
  with the fix), sim 31/32 (test geometry).
- e2e-expert phonePerf (1% low 29.4, then 28.3 on a rerun; 58.7 fps) was the HARNESS: the same route with --no-shots
  passed all 10 gates with phone 60 fps / 1% low 52.5 (11:25-11:28). Each WebKit screenshot stalls the phone, and the
  run took a phone screenshot at every stage (~38, about one per 5 s perf window). Fixed in run.mjs: the phone is shot
  at the key stages only (--all-phone-shots for all), and the phonePerf gate reads the perf windows without a phone
  screenshot (perf.phoneWithoutShots; every window when fewer than 5 are clean). The owner's real iPhone measured 60 fps
  / 1% low 27 on v1.4 (ORCHESTRATOR.md 10:44): that is v15-perf's topic, not this proxy.

| e2e (24 bots) | gates | round | boss down | chests | 3-2-1 (server / phone / TV) | phone fps / 1% low | specs |
|---|---|---|---|---|---|---|---|
| expert 11:07 (first run.mjs) | 9/10 (phonePerf: screenshot stalls) | 181.7 s, every chest open, e2e won | 0:19.8 (5520 HP) | 16/16 | 3,2,1 in 3.0 s / 3,2,1,GO! / 3,2,1,GO! | 58.7 / 29.4 | ship 1, explorer 1 |
| expert 11:29 (final run.mjs) | 10/10 PASS | 179.7 s, every chest open, e2e won | 0:19.2 | 16/16 | 3,2,1 in 3.07 s / 3,2,1,GO! / 3,2,1,GO! | 59.5 / 45.9 (gate, 27 shot-free windows: 60 / 55.3; 17 phone shots) | ship 1, explorer 1 |
| expert 11:25 --no-shots | 10/10 PASS | 185.9 s, every chest open | 0:19.x | 16/16 | 3,2,1 in 3.11 s / 3,2,1,GO! / 3,2,1,GO! | 60 / 52.5 | ship 1, explorer 1 |
| regular 11:10 | 8/8 PASS | 4:00 cap (by design), e2e won | 0:28.3 | 12 | 3,2,1 in 3.01 s / 3,2,1,GO! / 3,2,1,GO! | 58.8 / 31.4 | ship 1, explorer 1 |

Phone tour 80/80 (89 s), entity kit 681/699 (22 s), harness selftest 41/41 (23 s), live-test PASS (17 s).
The first e2e countdown screenshots fired at the first countdown tick, before the phone had drawn it (the phone still
showed the lobby card): run.mjs now shoots 1.2 s into the count and counts a digit only when it is visible
(checkVisibility with opacity/visibility). Not a game bug: controller.html:2931 hides the lobby card as soon as the phone
sees phase countdown, and the overlay (z-index 30) sits above it (z-index 5).

Evidence (dev/v15-tests/evidence/): the run summaries, the e2e reports (11:07 full run, 11:25 no-shots, 11:29 final,
11:10 regular), the final expert log, the phone tour report, the entity kit report head, and the phone + TV screenshots
1.2 s into the server's 3-2-1, taken at the same moment: the TV shows "2 · GET READY!" over the lobby and the phone
"GET READY 2" over its controller (the phones count down together with the big screen).
The frozen worktree was removed at 11:34; raw logs stay in /private/tmp/claude-501/v15t-scratch/ (full1, run2).

## The main tree moved on during this run (HEAD 52981b6 + other lanes' work, 11:35, informational)
`all.sh --only unit,client` on an APFS clone of the main tree (124 s): 15 pass, 6 fail.
- FIXED by another lane meanwhile: astra-test 29/29 and gen-regression 103/103 (spec calls answered apart, as above).
- Still: sim 31/32 (test geometry, above), render-unit 86/87 (render.js:3852 GO sound, above).
- REAL BUG (phone lane): controller.html:3504 shows the 3:00 "THE CHESTS GLOW! / MISSING A SKILL? DRAW IT NOW" moment
  only for the v1.2 announce "Assists on…", but world.js:693 now says "3:00! The chests glow. Missing a skill? Draw it
  now!", so at 3:00 the phone shows nothing. t3-mischief now feeds world.js's real line (77/78 on HEAD until fixed; fix:
  `/^Assists on|^3:00!? The chests glow/i`).
- v1.5 drift to update next (committed v1.5 code, after this task's v1.4 scope): t2-sandbox crashes at line 63 after "no
  pad yet: asked the server (POST /controller-html) → 2" (v15-fix M4 refreshes the pad: 2 requests, then a missing
  element); tv/test-page-jsdom 3 FAILED ("assists line rewritten in plain words", "title names the winner (EVERY CHEST IS
  OPEN!)", "reason chip": the v1.5 TV copy); dev/inflate/astra-entity-test 1/4 ("ship has shoot", line 37: v15-fix M1
  changed what astra.js answers without a key: the dev kit only in dev mode, else the plain entity).
