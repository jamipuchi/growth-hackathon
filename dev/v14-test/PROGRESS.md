# v14-test — QA complete

Updated 2026-10-10 09:30 UTC. Tested frozen tag v1.4, commit a1bf42970488c7dcaab60963b99c3001e3d36ff8. No game files edited. The temporary worktree has been removed. Never substitute the newer shared HEAD for this result.

## Done
- All nine requested unit suites executed: six pass; Astra 27/29 and corpus replay have outdated harness assumptions; simulation 31/32 has the confirmed planet slope gunfire issue.
- Both 24-bot natural E2E routes executed. Pacing fixed: expert lands35.63s/ends181.33s; regular lands80s/ends239.97s. Expert gameplay passes but capture-contaminated performance gate fails; regular aggregate passes with individual low-FPS windows documented.
- Entity mock kit complete; capped real6 attempt made0 actual calls(no available credential, no secret files accessed/copied).44 direct recorded-spec ship3d/entity3d builds inspected plus corrected actual-spec crowds.
- Phone tour/features, real stroke rotation, ink wipe and10s timeout, fullscreen/install hints, manifest/icons, DRAW-X, countdown. TV feed18/18 and live1440/1920 flows complete.
- Live server25-player cap,3-2-1 movement/fire blocking, no-free-skills checks pass; real3:00 simulation assertions pass.
- Every one of10 prior findings rechecked. New tire sidewall/ground-bound defect confirmed after visual review.
- FINDINGS.md final:1 blocker,4 major,9 minor/polish findings; screenshots, logs, source locations, fixes, performance and round-time tables, harness corrections and coverage limits.
- All evidence links validated. All recorded server PIDs exited; owned ports8450–8469 have no listeners; browser jobs closed/awaited; frozen tracked source clean before removal; own worktree removed. See data/cleanup.json and data/report-validation.json.

## Left / next round
No further authorized QA execution pending in this bounded round. Fixes belong to the next round; none were applied. Fresh generation quality, physical devices/home-screen installation/camera,25-device Wi-Fi, exhaustive animation/rare-action combinations and texture/CPU certification remain explicit coverage gaps. Real API calls used0/10. Do not claim those gaps passed.

## Resume
Read dev/v14-test/FINDINGS.md. All retained artifacts are in dev/v14-test; no jobs remain running. Do not redo completed steps. To reproduce later, recreate the exact v1.4 worktree path stated in the report and obey one browser/owned ports. Invalid staging and QA interaction artifacts are preserved and clearly excluded from product findings.

## Step history (new entries append below)



- 2026-10-10T09:10:52.719881+00:00: Phone scenario complete:32shots,no browser/page/asset errors; clean phone boss60fps/55.6low/max45calls62,278tris; cockpit60/55.6/41/54,522; planet60/55.6/37/64,669. TV scenario running. Adapted pending pad-repro only to dismiss the new GOT IT guide before strokes.

- 2026-10-10T09:11:43.592363+00:00: DONE scenario-tv; exit 0; elapsed 125.6s. Read log/report before interpreting.

- 2026-10-10T09:11:43.614001+00:00: START crowd-phone-effects; runner writes logs/crowd-phone-effects.log; own child cleanup handlers installed.

- 2026-10-10T09:12:14.567471+00:00: Followups collected in scripts/run-followups.py; run only after original runner/browser exits. It executes offline fallback, prior-control recognition replay, corrected guide/wipe interactions, and actual-spec crowd stress. No extra real API calls.

- 2026-10-10T09:12:21.857417+00:00: DONE crowd-phone-effects; exit 0; elapsed 38.2s. Read log/report before interpreting.

- 2026-10-10T09:12:21.876699+00:00: START crowd-tv-effects; runner writes logs/crowd-tv-effects.log; own child cleanup handlers installed.

- 2026-10-10T09:13:00.336692+00:00: DONE crowd-tv-effects; exit 0; elapsed 38.4s. Read log/report before interpreting.

- 2026-10-10T09:13:00.359850+00:00: START builders-phone; runner writes logs/builders-phone.log; own child cleanup handlers installed.

- 2026-10-10T09:13:03.181094+00:00: DONE builders-phone; exit 0; elapsed 2.8s. Read log/report before interpreting.

- 2026-10-10T09:13:03.202220+00:00: START builders-tv; runner writes logs/builders-tv.log; own child cleanup handlers installed.

- 2026-10-10T09:13:05.846797+00:00: DONE builders-tv; exit 0; elapsed 2.6s. Read log/report before interpreting.

- 2026-10-10T09:13:05.868722+00:00: START pad-repro; runner writes logs/pad-repro.log; own child cleanup handlers installed.

- 2026-10-10T09:13:16.151131+00:00: DONE pad-repro; exit 0; elapsed 10.3s. Read log/report before interpreting.

- 2026-10-10T09:13:16.170602+00:00: START server-decisions; runner writes logs/server-decisions.log; own child cleanup handlers installed.

- 2026-10-10T09:13:26.952008+00:00: DONE server-decisions; exit 0; elapsed 10.8s. Read log/report before interpreting.

- 2026-10-10T09:13:26.972177+00:00: START slope; runner writes logs/slope.log; own child cleanup handlers installed.

- 2026-10-10T09:13:27.067857+00:00: DONE slope; exit 0; elapsed 0.1s. Read log/report before interpreting.

- 2026-10-10T09:13:49.866032+00:00: Original sequential runner complete. Blocker reproduced:phone crowd effects91calls all1500samples; TVmax142calls,2408/3000over120. Actual builders44cases across phone+TV no exceptions/nonfinite vertices. M4missed modelHTML persists. Server decisions/slope reports ready. Starting only prepared followups, never rerunning original jobs.

- 2026-10-10T09:13:49.904156+00:00: START fallback

- 2026-10-10T09:13:50.214525+00:00: DONE fallback; exit 0; 0.3s.

- 2026-10-10T09:13:50.234656+00:00: START steering-replay

- 2026-10-10T09:13:50.296534+00:00: DONE steering-replay; exit 0; 0.0s.

- 2026-10-10T09:13:50.317565+00:00: START rotate-wipe

- 2026-10-10T09:14:23.107038+00:00: DONE rotate-wipe; exit 1; 32.8s.

- 2026-10-10T09:14:23.129110+00:00: START crowd-phone-drawn-effects

- 2026-10-10T09:14:23.161635+00:00: Corrected supplemental slope diagnostic: initial attempt sent steer-Y, which moves walkers on planet; preserved as slope-moving-harness. Recheck now holds both actors stationary and tests manual pitch (ignored by planet fire). This is a QA correction, not a game modification.

- 2026-10-10T09:15:01.000612+00:00: DONE crowd-phone-drawn-effects; exit 0; 37.9s.

- 2026-10-10T09:15:01.019923+00:00: START crowd-tv-drawn-effects

- 2026-10-10T09:15:14.672415+00:00: Corrected canvas interaction PASS:landscape+portrait88.1857% area, strokes retained(centroid drift0.00063). Controller portrait intentionally shows rotate overlay and blocked the optional continuation; no rotation rerun needed. Remaining wipe, native WebKit iPad fullscreen, and GO sound event capture prepared in remaining-ui.mjs; launch after followup runner closes.

- 2026-10-10T09:15:39.354052+00:00: DONE crowd-tv-drawn-effects; exit 0; 38.3s.

- 2026-10-10T09:20:02.120560+00:00: START remaining UI checks: native WebKit iPad fullscreen, GO audio requests, direct ink-cell wiping, portrait controller constraint. Previous browser runner completed.

- 2026-10-10T09:20:43.178118+00:00: Remaining UI complete: WebKit iPad exposes no fullscreen API, presents iOS fallback; GO requests three countdown sounds but no start sting on either screen. Wipe short-stroke pass reduced coverage to17.6%, not yet cleared; will test one continuous sweep. Initial spec-crowd metadata was stripped by world.setEntity; archived invalid-staging evidence and corrected QA-only attachment. No game-source edit.

- 2026-10-10T09:21:34.460199+00:00: Corrected phone 3D-spec crowd completed; actual loaded-builder flags now checked. Continuous ink sweep next, then corrected TV stress, then final findings.

- 2026-10-10T09:21:56.019477+00:00: Continuous real-pointer ink sweep completed; read ink-sweep.json for wiped:true assertion. Start TV corrected 3D-spec crowd only after WebKit closed.

- 2026-10-10T09:22:54.239922+00:00: START screenshot-free transition diagnosis on port8467 after corrected TV 3D crowd browser closed.

- 2026-10-10T09:23:37.155146+00:00: Prepared remaining full 1920x1080 TV live lobby/START/3/2/1/GO/play/results sequence; 1440 and 1920 play/results already covered. Await current transition browser before launching.

- 2026-10-10T09:23:46.530982+00:00: Screenshot-free transition diagnosis completed; raw frame records retained. START final1920TV flow on8468.

- 2026-10-10T09:26:34.304332+00:00: Complete findings draft written: every prior finding status, one blocker/four major/eight minor findings, near90%canvas measurement, all suite results and explicit performance/model-quality limits. Final evidence/link validation and cleanup remain.

- 2026-10-10T09:27:53.620891+00:00: Evidence review found an additional visual defect in new 3D vehicle wheels: open sidewall gaps visible on both phone/TV recorded monster-truck fixtures. Investigating tire profile geometry before adding severity/fix. Report link validation repaired three paths; cleanup link pending.

- 2026-10-10T09:28:22.370212+00:00: START focused wheel diagnostic on8469(one WebKit process; previous TV job closed). New observation only: actual geometry ground bounds and side view, plus diagnostic double-sided materials; no game-source mutation.

- 2026-10-10T09:29:14.426475+00:00: Wheel diagnostic confirms N7: open sidewalls remain with double-sided diagnostic; actual geometry extends below ground(-0.079m lite/-0.121m big). Added evidence/source/fix. All browser runs completed; frozen tracked diff/status empty at exact v1.4 SHA. Begin cleanup.

- 2026-10-10T09:30:53.675064+00:00: FINAL: cleanup and 80 evidence links validated; frozen worktree removed; no owned listeners/recorded server PIDs remain.14 findings total(1blocker,4major,9minor/polish), all10prior findings rechecked. Coverage gaps explicit; no game fixes or real API calls.
