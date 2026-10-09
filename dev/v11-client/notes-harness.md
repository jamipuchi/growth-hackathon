# harness agent: notes (v1.1 client track)

Owner of: everything under dev/v11-client/ except SPEC.md and the other agents' notes. Only agent that runs browsers/servers.
Can be cut off any time: read this first.

## Status (2026-10-10, 00:55): phase 1 DONE, everything validated
- [x] check-syntax.mjs (used by the other agents)
- [x] server.cjs (wrapper around the real server.js) + selftest.mjs (no browser, 38 checks, all pass, ~18 s)
- [x] samples.cjs + samples/ (6 drawings, ship variants, contact sheet), seed.mjs, lib.mjs, sheet.mjs (contact sheets)
- [x] shots.mjs: smoke (phone-join, big-lobby) 9 s; FULL TOUR 00:52 against the new phone page: 22/22 steps, 32 screenshots, 80.8 s,
      no missing ids / hooks / copy strings, 0 console errors on big, phone, phone2. (An earlier tour at 00:43 against the v1.0
      phone page listed every new id as MISSING and stopped itself on purpose when HOLD came back at 00:46.)
- [x] perf25.mjs: PASS at 00:53 (24 bots + 12 seeded + phone = 37 ships): window A 59.5 fps, 1% low 52.6, calls 29 (max 32), tris 67k;
      window C (burst of 37 entity messages + assists at 45 s + boss arrival) 60 fps, 1% low 52.6, worst frame 19 ms, calls 30 (max 38),
      tris 64k; no crash, 0 console errors. Both windows ended at tier 5 / pixel ratio 1 (the adaptive governor, laptop under load).
- [x] run-e2e.mjs + driver.mjs written and syntax-checked, NOT run (lead said not now). dev/e2e/run.mjs/driver.mjs were unchanged at 00:55.
- [x] static checks: node --check on everything, ESLint no-undef over every tool (0 errors), `shots.mjs --dry` plans verified.
- Server.js now lists inflate.js in PUBLIC_FILES itself (info: serverJsServesInflate); the wrapper still serves it (harmless).

## How to run (always: `ls .orch/status/HOLD` must say "No such file", and `tail -2 .orch/status/vitals.log`)
    node dev/v11-client/check-syntax.mjs <files…>            # any time, no browser
    node dev/v11-client/selftest.mjs [--timing]              # no browser: wrapper, overrides, hooks (~18 s; --timing +75 s)
    node dev/v11-client/samples.cjs                          # regenerates dev/v11-client/samples/*.png
    PORT=8170 node dev/v11-client/server.cjs [--bots N] [--fast] [--assists S] [--cap S] [--scoreboard S] [--serve a.js,b.js]
    node dev/v11-client/seed.mjs --port 8170 --players 8 [--explorers] [--ready]      # into a running wrapper
    node dev/v11-client/seed.mjs --serve --port 8171 --players 8 --explorers          # starts its own server, stays up (Ctrl-C)
    node dev/v11-client/shots.mjs --dry                      # the plan, nothing launched
    node dev/v11-client/shots.mjs --only phone-join,big-lobby --no-deps    # smoke: 2 steps, ~40 s
    node dev/v11-client/shots.mjs                            # the full tour (port 8171) → shots/*.png + shots/report.json
    node dev/v11-client/perf25.mjs [--bots 12 for the nominal 25]          # → perf25.json
    node dev/v11-client/run-e2e.mjs --route expert [--video]   # copy of dev/e2e/run.mjs → e2e-out/ (port 8172)
Ports: server.cjs 8170, shots 8171, run-e2e 8172, perf25 8173, selftest 8174 (8175 spare). The tools wait (log every 60 s)
while HOLD exists or memory pressure >= 2; `--no-wait` fails fast (exit 4), `--ignore-hold` skips the check (lead override).

## Files
- check-syntax.mjs  .js/.mjs as ES modules (falls back to classic script when there is no import/export), inline <script> blocks
  of .html with real line numbers. OK/FAIL per file, exit 1 on failure.
- server.cjs  starts the REAL server.js (never edited). Before requiring it: HTTPS off, ASTRA_MOCK=1, no API key, PORT default
  8170, PERF_LOG default dev/v11-client/perf.log (truncated); wraps http.createServer (serves /inflate.js and `--serve` files,
  logs/records every other 404 so server.js gaps are NOT hidden: GET /__test/info → missing); wraps astra.generate (name rules
  below); astra._internals.setDir → dev/v11-client/controllers-out/ (nothing is written to the repo's controllers/); mutates
  Contract.ROUND for --fast (assists 25 s, cap 60 s) and --assists/--cap/--scoreboard (world.js reads ROUND at run time in
  step(): assistsAt, maxSeconds, scoreboardSeconds; verified live). Captures the world object (patched createWorld) for hooks.
- Name rules (player name → /generate answer): explorer: car… car, bike… bike (rig car), dog… quadruped, blob… blob (dev-kit
  unlocked list kept, verbs via Verbs.entityVerbs, anims re-wired; a car cannot jump, can drive). plain… → drawn but nothing
  unlocked (ship/explorer, source "model"). name contains "wrong" → like the real Astra: refused `{ok:false, error:"looks like a
  controller", looksLike:"controller"}` (ship/explorer; "looks like a ship", looksLike "entity", thing "ship" for
  controller/button), costs no drawing; with `anyway:true` ok + looksLike. "wrongsoft" → never refused, ok answer carries
  looksLike. "slow" → +2.5 s. "fail" → {ok:false, error:"generation unavailable"}. Any other name: the plain mock (dev kit).
- Test hooks (server.cjs, only for tools; they touch the live world object): GET /__test/info, GET /__test/state (phase, boss,
  planet, chests, players with mode/pos/verbs/type), POST /__test/round {assistsAt, maxSeconds, scoreboardSeconds | reset:true},
  POST /__test/teleport {player, near:{x,y,z}, distance, face:{x,y,z}, x,y,z, yaw, pitch, heal}, POST /__test/boss {hp}.
  lib.mjs: killBoss, pressLand, waitForMode, landParty, standByRockChest use them (boss kill 1.2 s, LAND 3 s).
- samples.cjs  pure Node PNG (zlib + CRC + anti-aliased thick-line rasteriser + stroke font). ship (rocket from the side, nose
  right, flames, cannon on top), controller (2.2:1: stick circle left, BOOST and FIRE boxes), car, bike, astronaut, dog.
  variant n > 0 changes proportions/parts/wobble. strokesForPad() gives the strokes for a pad (used when a page has no
  __spTest.drawSample: real mouse strokes over #drawPad).
- seed.mjs / lib.seedPlayers  joins are sequential (stable lobby slots), drawings 4 at a time, a different rocket per player.
- lib.mjs  server start/stop (own child, never orphaned: the orchestrator watchdog kills ppid-1 node servers on ports
  8101-8199 at memory pressure >= 2), vitals gate, browsers (Chromium 1440x900 @1; WebKit pinned to webkit-2311 when it exists,
  E2E_WEBKIT overrides, newest otherwise; iPhone UA, 844x390 @3, touch), watchPage (console errors, http >= 400, failed requests,
  crash, POST /perf samples), phone helpers (`sp`), drawSample, seeding, hooks, scenario helpers.
- shots.mjs  see its header. Steps: phone-join (+portrait) · phone-do-join · phone-step1-ship (photo, draw, portrait) ·
  phone-wrong-drawing · phone-ship-result · phone-step2-controller · phone-wrong-drawing-controller · phone-controller-result ·
  phone-wait · big-lobby · big-lobby-25 · big-start-click · big-play-hud · phone-play-hud · phone-locked-tooltip (second phone
  context, plain ship) · phone-landing (+big-landing-shot) · phone-explorer-result (+phone-ctrl-prompt) · island-party ·
  island-car (+spectator) · island-rock-chest (+phone-drilling, island-chest-open) · assists · results. The phone player is
  "carol". Each step: own try/catch + timeout, "MISSING #id" logged and listed in report.json (missingIds), page problems
  per step, perf (big: game.perf(); phone: the page's own POST /perf sample). Also checks the mandatory copy strings of SPEC
  section 6 against the page text (report: steps[].copy). --only expands to dependencies (no screenshots for them), --no-deps
  runs exactly the listed steps; exact names beat prefixes (--only big-lobby ≠ big-lobby-25).
- perf25.mjs  phone only (no big screen): 24 bots + 6 dev-kit + 6 plain drawn humans + the phone; window A (30 s cruising),
  burst (same drawings re-posted twice = same image URL, then new drawings), assists at 44 s, window C. rAF sampler in the page
  (fps, 1% low, p90, worst frame) + the page's POST /perf (calls, tris, tier, dpr) + entity messages seen on /events.
- run-e2e.mjs / driver.mjs  copies of dev/e2e/run.mjs / driver.mjs; outputs in e2e-out/, port 8172, uses server.cjs (also serves
  /inflate.js; `--real-server` = unchanged server.js, which writes drawings to the repo's controllers/), HTTPS off, WebKit pinned.
  Keep in sync by hand if dev/e2e changes (diff them).

## Facts learned
- The watchdog (.orch/watchdog.sh) raises .orch/status/HOLD at memory pressure >= 2 (or load > 1.6 x cores, thermal, battery) and
  clears it after 3 calm minutes; at pressure >= 2 it also kills node servers on 8101-8199 whose parent is PID 1 (that is what
  killed my first hand-started server). Our tools start the server as a child, so they are safe.
- world.js entity re-sends: setMode(force) only sends when the entity changed (sameEntity), so at the assists moment only ships
  that gain shoot/land are re-sent (plain ships). A re-posted drawing always broadcasts one `entity` (same image URL if the same
  image). That is why perf25 seeds half the humans "plain" and re-posts drawings.
- A final /generate creates the player in the world (even without /join) and costs one of 5 drawings per world (space).
- Seeded humans never move: they fly straight at cruise speed toward the boss (everybody ends up near the boss around 60 s).
- 10 minutes without input drops a human from the round (INACTIVE_MS): tools send a harmless `view` input every 30-60 s.
- The current pages are the v1.0 ones plus whatever the agents have merged: most SPEC section 9 ids will show as MISSING until
  the phone/bigscreen agents land them. That is expected and listed in report.json.

## Left / how to resume
1. Re-run after every merge of the client agents: selftest (20 s), shots (80 s), perf25 (70 s) when HOLD is off. Look at
   shots/contact-*.png first, then shots/report.json (steps[].missing, steps[].copy, pages, perf) and perf25.json (gates).
2. Not done: run-e2e.mjs has not been run (lead's call); photo-mode upload (#camInput with a sample on paper); --video for the
   tour; a render.js hook to count mesh rebuilds so perf25 can prove that same-URL entity re-sends rebuild nothing (today it only
   proves the page survives them); a real-device pass (everything here is WebKit on a desktop Mac, a proxy).
3. If dev/e2e/run.mjs or driver.mjs change, re-derive run-e2e.mjs/driver.mjs (changes are small, listed in the header; `diff` them).
4. Observations from the screenshots for the other lanes (not harness bugs): lobby ships are tiny glow sprites at the lobby camera
   distance; `window.__sp.entity` is null at step shipResult (set at explorerResult); every POST /perf of the big page shows up as
   net::ERR_ABORTED in Playwright's requestfailed although the server logs it (tools count these as abortedRequests, not errors).
