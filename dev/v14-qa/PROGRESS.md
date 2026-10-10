# v14 QA progress — complete

Build tested: frozen v1.3, `21d329197f22ffe1f6bcfa55716c151e9728d9c9`.
Acceptance: current PLAN.md section 0, including 10 October 10:00 decisions.
Deliverable: [FINDINGS.md](FINDINGS.md).

## Done

- Read CONTRACT Never/Tools, PLAN section 0, earlier QA evidence, and v13 world/render notes. Kept game files read-only and all new outputs in this lane.
- Render suites on frozen source: unit 85/85, smoke 65/65, game 66/66. No failed obsolete assertions and none waived.
- TV feed: 18/18. WebKit phone tour landscape and portrait: original 46/46; added countdown synchronization assertion fails (46/47 total).
- TV and phone visual tour: lobby through results, boss-death burst, landing, both chest types, all five mischief effects, steal/wreck presentation. Contact sheets and originals saved. Staged events explicitly identified in report.
- Every A-001–A-011 asset family loaded. Per-frame boss/planet/cockpit/crowd/effects measurements saved. Baselines pass; crowded effects fail calls: phone 89 (1500/1500 over 80), TV max 139 (2199/3000 over 120). Phone triangle and FPS gates pass.
- No-capture phone boss-death and landing recheck passes: 1% lows 55.6/43.5 FPS. No boss-kill white-out in sampled images.
- Real ship and controller drawings complete. Eight outbound requests total, including hedge and harness retries; no more real calls. Confirmed timeout grants undrawn skills; controller circle is displaced. Confirmed missed generated-HTML event with a mock-only reproduction.
- Final report: 1 blocker, 4 major, 3 minor, 2 polish findings; each has evidence, frozen source location and suggested fix. All report links verified.
- All owned browsers and server processes closed. No listener on QA ports 8420–8439. Frozen QA worktree removed as requested. Prior generated artifacts retained under data/retained-prior-worktree/. No credentials inspected or copied during this pass.

## Left

No work remains in this bounded read-only QA pass. Fixes belong to the next implementation round. Explicit coverage limits in FINDINGS.md include physical iPhone/camera checks, 25-device network fan-out, complete natural-round pacing, and end-to-end rare-event trigger/scoring tests; these are not claimed as passes.

## Evidence / rerun

- FINDINGS.md: prioritized findings, perf table, test results, screenshot index and staging limits.
- data/cleanup.json: final cleanup verification.
- data/real-call-count.json: 8/10 request ledger. Do not reset it to rerun within this task.
- scripts/: QA harnesses. Recreate detached v1.3 at /private/tmp/claude-501/v14-qa before using them; they import frozen test helpers there.
- Earlier artifacts and QA-only harness errors are preserved, not presented as product failures.
