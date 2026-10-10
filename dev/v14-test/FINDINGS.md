# Space Party v1.4 — QA findings

Tested **10 October 2026, approximately 08:53–09:30 UTC** (10:53–11:30 Madrid). Frozen tag **v1.4**, commit **a 1 bf 42970488 c 7 dcaab 60963 b 99 c 3001 e 3 d 36 ff 8**, including the v1.4 server commit. All source locations below refer to this tag, not the newer shared checkout. Acceptance: `PLAN.md` section 0, including its latest owner decisions. No game files were edited.

**Verdict: the requested gates do not all pass.** Crowded effects exceed render budgets; generation failures still grant undrawn skills; first-drawing phones miss the countdown; completed controller HTML can be lost; and planet gunfire cannot aim down a slope. Pacing is substantially improved. All ten previous findings were rechecked below. Fresh generation quality is a coverage gap: the isolated build made **0 actual API requests**, because it had no usable credential and the task prohibited reading/copying secrets.

## Prior v1.3 findings: every recheck

| Prior ID | v1.4 status | Current evidence / interpretation |
|---|---|---|
| B1 crowded effects | **Still present** | Default crowd: phone 91 calls / TV 142. New 3D-spec crowd: phone 75 / TV 133. See B1. |
| M1 failure grants skills | **Still present** | Current Astra with locally injected HTTP 503 returns successful eight-skill dev kit; current UI/server replay charges one drawing. No new live timeout claimed. |
| M2 phone countdown | **Partly fixed** | Play phone and TV now share authoritative 3–2–1. A phone still on its first drawing has no stream, phase or digits. |
| M3 space pacing | **Fixed in both tested routes** | Expert lands 35.63 s, ends 181.33 s; regular lands 80.00 s, ends 239.97 s. Most time is on planet. |
| M4 missed Sol HTML | **Still present** | Server model HTML ready before Play; phone stays on template after Play, without sandbox error. |
| N1 displaced steering | **Still present for recorded recognition answer** | Current `withSteer` again adds the same displaced auto stick. Fresh vision interpretation is unverified. |
| N2 rank 7 disappears | **Still present** | TV renders 1–6, 20 instead of 1–7 plus 20. |
| N3 stale DRILLING | **Still present** | “DRILLING 62%” persists after releasing input through later wreck capture. |
| P1 island style | **Still present, subjective** | Muted olive terrain/grey-beige horizon, thin palms and glowing distant dots remain. |
| P2 dark player names | **Still present** | Dark blue names remain difficult to read against purple UI. |

## Blocker

### B1 — crowded island effects exceed draw-call budgets

With 25 planet actors, 25 parked ships, 16 mines, eight decoys and EMP/ink/tractor flags on eight actors, default-model phone rendering uses **91 calls in all 1,500 samples** (limit 80). TV peaks at **142**, with **2,408/3,000 samples over 120**. This is a staged stress scene using the unchanged renderer: QA moves bots onto the island and extends effect lifetimes. It is not a claim that this exact pile-up occurred naturally.

A separate corrected test attaches v1.4 procedural specs and an actual served drawing to the entities/parked ships. Eight phone and 14 TV visible explorers confirm `entity3d:true`; LOD hides the remaining full models. Phone passes at 75 calls, but TV still peaks at 133 with 1,983/3,000 samples over 120. Thus the new models improve some budgets but do not resolve the scene-level issue. Both populations matter because players can skip drawing and retain default models.

- Evidence: [default phone data](data/crowd-phone-effects.json), [default TV data](data/crowd-tv-effects.json), [phone screenshot](shots/phone-planet-crowded-effects.png), [TV screenshot](shots/tv-planet-crowded-effects.png), [new-model phone](data/crowd-phone-drawn-effects.json), [new-model TV](data/crowd-tv-drawn-effects.json), [new-model TV screenshot](shots/tv-planet-crowded-drawn-effects.png). Raw per-frame values are in matching `data/raw-*.json` files.
- Likely locations: `render.js:2236` (`DecoyView`), `render.js:2426` (separate decoy cap), `render.js:5232` (explorer cap) and adjacent parked-ship allocation. Independent caps accumulate.
- Suggested fix: share a frame budget among explorers, parked ships and decoys, reserving effect headroom; batch compatible decoys and reduce distant full models when effects appear. Recheck every frame, not averages.

## Major

### M1 — failed drawing recognition still grants undrawn skills and costs a drawing

Current Astra was given a plain-fighter fixture with all external requests replaced by local HTTP 503 responses. It returns `ok:true`, `source:devkit`, and SHOOT, BOOST, SHIELD, LAND, SCAN, FLARE, MINE and EMP. The card asserts drawn parts that were never recognized. A separate replay of the prior real response through the current server/UI leaves 4 of 5 drawings. This contradicts section 0's drawn-part-only rule.

- Evidence: [fault injection](data/fallback.json), [log lines 1–3](logs/fallback.log), [current server/UI state](data/pad-repro.json), [current card](shots/replay-real-timeout-card.png). The three fake requests are local and count as zero actual API calls.
- Likely locations: `astra.js:614` (error becomes successful dev kit), `astra.js:707` (`devKitEntity`), `astra.js:849` (second exception fallback), `server.js:584` (successful response spends drawing).
- Suggested fix: keep an entity usable with a plain no-extra-skill fallback, explain the failed recognition and allow a free retry. Reserve dev-kit grants for explicit mock/development use.

### M2 — phones still drawing miss the authoritative countdown

A phone already in Play shows the same 3, 2, 1 as the TV. A newly joined phone left on its first drawing has `phase:null`, no game/event stream and no countdown digit throughout. It receives no indication that the round has begun while it is drawing.

- Evidence: [paired timeline](data/features.json), [drawing phone](shots/phone-drawing-during-countdown.png), [simultaneous Play phone](shots/phone-play-countdown.png), [TV](shots/tv-countdown.png).
- Likely locations: `controller.html:2750` (`enterPlay`), `controller.html:2769` (`startRenderer`), `controller.html:2782` (`startGame`, which opens the stream); countdown presentation at`controller.html:2961`.
- Suggested fix: subscribe to authoritative round phase immediately after joining, including drawing/result screens. Avoid duplicate streams when the renderer starts.

### M4 — controller HTML completed before Play remains a template

In the deterministic current-build reproduction, the server reports `source:model,pending:false` while the phone reads the result card. Before Play, the phone has no renderer/stream and caches the template. After Play its mounted/live pad is still `source:template`, `usingFallback:false`, with no validation/mount error. Only `/events` is requested; the cached latest HTML is not fetched.

- Evidence: [state and requests](data/pad-repro.json), [screenshot](shots/pad-missed-model-event.png). The injected model HTML is delayed 1.2 s and uses valid template geometry; this isolates delivery, not fresh Sol quality.
- Likely locations: `controller.html:2589` (`ensureCtl` only fetches when `S.pad` is absent), `controller.html:2769` (late subscription), `server.js:263–297` (background completion, single broadcast and cached page).
- Suggested fix: refresh/reconcile the latest version on entering Play and reconnecting, or subscribe earlier; guard against stale completions and preserve held-touch safety.

### M5 — planet gunfire cannot aim at a nearby player downhill

The original simulation scoring suite fails its kill/steal assertion. A focused stationary seed 13 reproduction places the target 6 m away and 1.922 m lower. Three seconds of firing, even with the correct negative pitch, leaves the 1 HP target alive and score 0. At the same 6 m radius on nearly level terrain, the same target dies and the shooter gets 950 points (kill 200 + stolen 750). Planet fire forces pitch 0; its narrow hit volume makes ordinary height differences unshootable from that position. Moving to another contour can work, but there is no vertical aiming path.

- Evidence: [original failure at log line 17](logs/unit-5-sim-test.log), [stationary two-case reproduction](data/slope.json), [diagnostic script](scripts/slope.cjs).
- Likely locations: `world.js:780` (`basis(p.yaw, space ? p.pitch : 0)`), `world.js:924` (planet segment hit test). Planet stick-Y currently moves the player rather than aiming vertically.
- Suggested fix: define terrain-aware aiming/aim assistance or a usable vertical aim input, and cover uphill/downhill hit and scoring cases. Do not merely weaken the scoring test. The earlier moving diagnostic is retained separately and excluded from this conclusion.

## Minor

| ID | Observation and evidence | Likely tagged location; suggested fix |
|---|---|---|
| N1, prior | Recorded rough circle is still replaced by an `auto:true` stick at x.03, y.51, w.26, h.46. [Current replay](data/steering-replay.json). Fresh recognition untested. | `world.js:131–153`, `astra.js:142`. Show a knob/arrows example; prefer plausible unused round ink for fallback and identify it as added. |
| N2, prior | Followed rank 20 replaces rank 7. [1920 screenshot](shots/tv-followed-rank20-assists.png). | `space.html:867`, `vis[cap-1]=…`. Append followed player after all seven leaders; reflow the feed. |
| N3, prior | “DRILLING 62%” remains after release, through later wreck view. [Phone](shots/phone-wreck.png), [TV](shots/tv-wreck.png); input release is explicit in [scenario](scripts/scenario.mjs). | `render.js:6090`. Use action flags for active wording; label stored partial progress as paused. DIG shares the predicate. |
| N4, new | UI says **ALL POWERS ON** / **EVERY SKILL IS UNLOCKED**, although the server correctly grants nothing at 3:00. [Badge](shots/tv-followed-rank20-assists.png), [server assertions](data/decisions.json). | `space.html:486,534`, `render.js:39`, `controller.html:1034,1078`. Say chests glow / draw the missing part; remove claims of free powers. |
| N5, new | At 1440×900, two-digit **10 /16** wraps and overlaps CHESTS; counter bottom meets follow panel. [Natural-round capture](shots/e2e-expert/chest-10-big.png). | `space.html:138–143`, especially `.ct` and oversized `#chestVal`. Reserve width, prevent wrapping and size for up to 32 chests. |
| N6, new | Both screens request three countdown beeps but **no GO/start sound** on the new path. [Intercepted sound events](data/remaining-ui.json). This is call-level proof, not a subjective recording. | `render.js:3852` only plays start for `lobby → playing`; now it is `lobby → countdown → playing`. Include the countdown transition once and avoid duplicate cues. |
| N7, new 3D | Vehicle tires have open sidewall gaps around floating hubs in both quality modes. The monster truck geometry also extends below its ground origin: **−0.079 m lite / −0.121 m big** despite wheel centers and advertised radius both 0.95 m. [Side view](shots/wheel-side-big.png), [oblique lite](shots/builder-phone-monster-truck.png), [bounds](data/wheel-probe.json). Double-sided material diagnostic leaves the holes unchanged. | `entity3d.js:990–998` builds only the outer tire profile, ending at about 0.81 r while the hub ends at 0.6076 r; the profile also exceeds r. Add a closed sidewall/inner profile and normalize actual tire radius/ground placement. Recheck car/bike wheels and ground contact in both LODs. |
| P1, prior polish | Island remains muted olive with grey/beige horizon, thin palms, weak ground contact and glowing distant dots. [Island](shots/tv-planet.png), [crowd](shots/phone-planet-crowded-effects.png). Subjective section 0 style assessment. | `render.js:4931` (`islandSky`), `render.js:4987` (fog/lights), `assets/A-005-island/island.js` materials. Coordinate brighter palette, chunkier silhouettes and smaller distant markers with asset owner; respect B1. |
| P2, prior polish | Dark blue player names have weak contrast against purple panels and world labels. [Natural TV capture](shots/e2e-expert/chest-10-big.png). | `space.html:885` (`setColor(r.nm,hex(s.color))`) and follow/name-tag styling. White names with dark outline plus a separate player-colour chip. |

**Canvas target near miss:** actual paper area is 88.1857% of viewport:772×376 at 844×390 and 376×772 at 390×844. Real strokes survive rotation (centroid drift 0.00063). This is close to the requested “~90%”, but fails a strict 90% assertion. [Measurements](data/rotate-wipe.json), [landscape](shots/canvas-actual-landscape.png), [portrait](shots/canvas-actual-portrait.png). `controller.html:134–141` reserves rail, gap, border and padding; trim these if 90% is a hard acceptance line. Controller drawings intentionally require landscape (`controller.html:1305`); the portrait paper result is for entity drawing, not portrait gameplay.

## Performance and round numbers

Phone: WebKit, 844×390 CSS pixels, iPhone UA/touch, emulated DPR 3; renderer internally uses 1.5–2. TV scene tests: Chromium 1440×900. These are shared-laptop measurements, **not physical-iPhone certification**. All runs use 24 bots + one human. Normal planet scenes have one landed human; bots normally stay in space. Crowds are explicitly staged. No screenshots occur inside the timed windows below.

| Scene | Run start UTC | Window | FPS | 1% low | Max calls | Max triangles | Calls over / samples |
|---|---|---:|---:|---:|---:|---:|---:|
| Phone boss | 09:07:24 | 20 s | 60 | 55.6 | 45 | 62,278 | 0/1,200 |
| Phone cockpit | 09:07:24 | 8 s | 60 | 55.6 | 41 | 54,522 | 0/480 |
| Phone normal planet | 09:07:24 | 25 s | 60 | 55.6 | 37 | 64,669 | 0/1,500 |
| TV boss | 09:09:38 | 20 s | 119.7 | 107.5 | 59 | 192,314 | 0/2,394 |
| TV normal planet | 09:09:38 | 25 s | 120 | 106.4 | 39 | 154,377 | 0/3,000 |
| **Phone default crowd + effects** | **09:11:43** | **25 s** | **60** | **55.6** | **91 FAIL** | **109,172** | **1,500/1,500** |
| **TV default crowd + effects** | **09:12:21** | **25 s** | **120** | **105.3** | **142 FAIL** | **237,598** | **2,408/3,000** |
| Phone v1.4-spec crowd + effects | 09:20:43 | 25 s | 60 | 55.6 | 75 | 107,309 | 0/1,501 |
| **TV v1.4-spec crowd + effects** | **09:21:56** | **25 s** | **120** | **105.3** | **133 FAIL** | **307,280** | **1,983/3,000** |
| Phone boss death | 09:22:54 | ~8.2 s | 60 | 55.6 | 59 | 68,706 | 0/492 |
| Phone landing | 09:22:54 | ~8.3 s | 59.9 | 43.5 | 57 | 68,636 | 0/495 |

Phone limits:80 calls, 120,000 triangles, 1% low≥30 FPS. TV call limit 120. No phone triangle overruns in these windows. Frame intervals are one fewer than render samples. Sources: [phone](data/scenario-phone.json), [TV](data/scenario-tv.json), [transitions](data/transition-perf.json), crowd data linked under B1, matching raw arrays.

**Full-round sampled performance:** regular E2E with captures disabled passes the harness's aggregate gate: phone 59.9 FPS, aggregate 1% low 51.3, max 48 calls/65,875 triangles. However individual five-second windows fall below 30 FPS low:28.8, 15.5 and 19.4 ([perf log lines 10, 28, 36](logs/e2e-regular-perf.log)); the initial loading sample is 8.5 at line 2. The harness averages the low values and drops startup, hiding these dips. They are an unresolved smoothness concern, not an all-window pass. A focused single-phone no-capture boss-death/landing check passes above; it does not prove all model swaps/cold loads are hitch-free. Shared host load and two active page contexts in E2E also limit attribution.

Expert E2E took 74 screenshots; its aggregate phone low 28.5 and minimum 6.6 are contaminated by captures. It reports `phonePerf:false`, so the overall report remains **FAIL**, with all gameplay gates passing. That is not treated as standalone evidence of a game FPS regression. Do not erase it or substitute the regular report's pass.

| Natural route, 24 bots | Boss reached | Boss dead | Landed | Round clock at end | Wall round | Planet share | Chests / ending |
|---|---:|---:|---:|---:|---:|---:|---|
| Expert | 11.60 s | 19.70 s | 35.63 s | 181.33 s | 183.5 s | 80.4% | 16/16, all chests, winner e 2 e 25,010 |
| Regular | 15.37 s | 28.43 s | 80.00 s | 239.97 s | 243.0 s | 66.7% | 12/16, four-minute cap, winner e 2 e 18,000 |

These are the natural route drivers, not teleported visual scenarios. [Expert report](data/e2e/report-expert.json), [regular report](data/e2e/report-regular.json). Server countdown works with the route harness; **no countdown-specific harness fix was necessary**. These rounds do not establish how 25 independently controlled human players pace the island.

Live server: **15.21 ticks/s**, max 5,508 bytes, average 5,423 bytes across 46 ticks/2.96 s, 25 players; [live log line 2](logs/unit-6-live-test.log). Longer simulation: max 6,046 bytes over 3,000 ticks/200 simulated seconds, mean step 0.369 ms. Server/world connect messages containing specs are larger than ticks (68,156 bytes in this live test); the under 8 KB gate applies to ticks.

## Requested suites and feature coverage

| Check | Result | Evidence |
|---|---|---|
| Astra unit | **27/29**, exit 1; two outdated single-call assumptions | [log](logs/unit-1-astra-test.log) |
| Generation regression replay | **85 failures /103 cases**, obsolete fixture dispatch | [log](logs/unit-2-gen-regression-test.log) |
| Vocabulary | **415 checks PASS** | [log](logs/unit-3-vocab-test.log) |
| Animation wiring | **9 PASS** | [log](logs/unit-4-anim-wire-test.log) |
| Simulation | **31/32**, scoring slope failure M5 | [log](logs/unit-5-sim-test.log) |
| Live server, LIVE_PORT 8452 | **PASS**, HTTP 8452 / HTTPS 8453 | [log](logs/unit-6-live-test.log) |
| Rules | **17 PASS** | [log](logs/unit-7-rules-test.log) |
| Astra entity | **4/4 PASS** | [log](logs/unit-8-astra-entity-test.log) |
| HTTPS | **ALL PASS**, 430 ms | [log](logs/unit-9-test.log) |
| Expert / regular E2E | Gameplay pass both; expert overall FAIL(perf capture interference), regular aggregate PASS | Reports above |
| Entity mock kit | **477/482 passed, 0 hard failures, 5 n/a;14/14 drawings** | [mock](data/entity-mock.json) |
| Entity real 6 attempt | **No usable credential, 0 real calls; not a live-quality result**. Fallbacks cause 26 hard/2 soft failures | [attempt](data/entity-real6.json), [log](logs/entity-real6.log) |
| Actual ship3d/entity3d builders | **44/44 finite builds**, 22 recorded-spec fixtures × two quality modes, no page errors | [phone](data/builders-phone.json), [TV](data/builders-tv.json) |
| Original phone tour | **42/46 checks**; four old inline-example assertions fail; exits 0 regardless | [report](data/phone-tour/tour-report.json), [log](logs/phone-tour.log) |
| TV feed | **18/18 PASS** | [log](logs/tv-feed.log) |
| Server decisions | **5/5 PASS**: cap 25, frozen countdown, 3–2–1, no bullets, no free skills | [live assertions](data/decisions.json); real 3:00 covered by original simulation |

The old entity kit measures the inflate builder. The added 44-case direct tests exercise **ship3d/entity3d**, using recorded Sol specs without new API calls. Phone ships:1,307–2,235 triangles, 2 calls, 0–22 ms build; phone bodies 792–2,586 triangles, 1–2 calls, 1–6 ms. TV ships 3,127–4,656 triangles, 2 calls, 1.3–15.2 ms; TV bodies 1,604–4,816 triangles, 1–2 calls, 1.5–7.6 ms. All ships' longest horizontal side is 3.2 m. Builders loaded body clips and produced skinned meshes. This checks finite geometry and rendering, not fresh model interpretation or every animation state. Visual wheel defect N7 remains despite these numeric checks passing. Screenshots are `shots/builder-phone-*.png` and `shots/builder-tv-*.png`.

Phone checks:
- Android Chromium fullscreen button enters fullscreen; iPad UA under Chromium does too. Native cached WebKit with iPad UA exposes no fullscreen API and follows the iOS install fallback. Hardware iPad fullscreen is therefore **not certified**. [Feature states](data/features.json), [WebKit state](data/remaining-ui.json), [iPad capture](shots/ipad-webkit-fullscreen.png).
- WebKit iPhone shows the Share → Add to Home Screen hint. [Screenshot](shots/iphone-install-hint.png). Physical installation/standalone launch is untested.
- Manifest HTTP 200 with`application/manifest+json`;180,192,512 and maskable 512 icons all HTTP 200`image/png`. Exact responses in [features](data/features.json).
- Real stroke preservation passes; paper size caveat above. The guide must be dismissed before drawing.
- Ink remains opaque at 5 seconds and disappears at 10 seconds with`wiped:false,ms:10000`. A genuine continuous pointer sweep clears it with`wiped:true,ms:350`, coverage<.12, overlay removed. [Timeout](data/features.json), [sweep](data/ink-sweep.json), [cleared view](shots/ink-continuous-wiped.png).
- DRAW A SHOVEL AND A DRILL hint renders; live assertions and simulation confirm no skills are granted. [Hint](shots/late-draw-hint.png).

TV checks: live lobby → START →3→2→1→GO→play→results covered at 1440×900 and 1920×1080. [1920 state trace](data/tv-1920-flow.json), [1920 GO](shots/tv-1920-go.png), [1440 GO](shots/tv-go.png), [1920 results](shots/tv-1920-live-results.png), [1440 results](shots/tv-1440-results.png). Map and feed remain visible through the inspected views; the chest overlap and scoreboard row defect above prevent a blanket “no overlaps” pass. Live timer/results transitions were shortened only for bounded visual tours, not the natural pacing rounds. Tour 13-minute timers are QA-only settings.

Visual scenarios cover approach, boss battle/death, landing, island, DIG/DRILL, mischief, steal/wreck presentation and results. [Phone scenario](data/scenario-phone.json), [TV scenario](data/scenario-tv.json). A-001 through A-012 asset families loaded; no failed asset requests or page crashes. Chromium emitted WebGL program warnings and aborted `/perf` posts (recorded in scenario/crowd JSON); no corresponding asset failure was demonstrated. Rare mischief/steal/wreck presentation is injected: it does not independently certify every end-to-end damage/ownership trigger.

## Harness corrections and invalid attempts

Game source and assertions were not silently fixed. All adaptations live under this lane's `scripts/`:

1. Frozen imports/output roots and owned ports only. HTTPS suite's non-owned 8444 changed to 8454 in its owned copy.
2. Original E2E/entity harnesses open Chromium and WebKit together. Owned copies use **one WebKit process**, separate TV/phone contexts. Separate TV Chromium jobs run sequentially. E2E countdown needed no fix.
3. Astra's assertions at`dev/astra/astra-test.js:324,424` expect one entity call; v1.4 intentionally adds a spec call. Update expected task counts. Corpus fake calls need keys including task/schema as well as image; a spec request currently consumes the entity fixture. Re-record fixtures after fixing dispatch; current 85 failures do not measure model accuracy.
4. Phone tour assumes inline`#example` visibility at four screens after the guide moved into a dialog. Assert guide-button/dialog behavior and make failed checks produce nonzero exit.
5. E2E performance collection must disable screenshots during measurements and evaluate low-FPS windows explicitly; average-of-lows can conceal the regular-run dips.
6. Initial canvas strokes hit the guide, so zero-ink rotation failures were QA interaction errors. Corrected real strokes pass. Initial wipe strokes began outside covered cells or stopped at partial coverage; continuous sweep passes. A controller-portrait continuation hit the intentional rotate overlay. These are preserved, not counted as product bugs.
7. Initial spec-crowd staging put metadata into `world.setEntity`, which intentionally strips it. Artifacts suffixed`invalid-staging` are excluded. Corrected QA staging attaches image/spec after wiring and checks loaded`entity3d` flags. Initial slope diagnostic accidentally moved the shooter through stick-Y; only stationary`data/slope.json` supports M5.

## Reproduction, limits and cleanup

Recreate detached tag`v1.4` at`/private/tmp/claude-501/v14-test` to reuse the owned scripts. Never use the newer main HEAD. Test helpers load actual frozen modules, with explicit QA-only staging hooks. Use installed/cached browsers, one browser job at a time. Raw logs, reports and screenshots remain in`dev/v14-test/`; nothing was sent or published.

Coverage gaps: fresh real generation (0/10 API calls used), physical iPhone/iPad GPU/fullscreen/installation/camera, 25 independent devices over Wi-Fi, texture-memory/CPU-budget certification, all animation states and exhaustive rare-action damage/scoring combinations. Do not translate laptop emulation or recorded-spec successes into those claims. The remaining performance dips also preclude an all-smoothness pass.

Cleanup verified: no listeners on owned ports 8450–8469, all recorded server PIDs exited, browser jobs closed and awaited, and the frozen worktree removed. Its tracked diff was empty before removal. See [cleanup.json](data/cleanup.json). Both progress files contain final done/left state. No bug fixes were made in this QA round.
