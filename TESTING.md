# TESTING.md: end-to-end test channel

This file is the channel between:

- **Orchestrator**: the Claude Code session building Space Party (it also owns `ORCHESTRATE.md` for assets).
- **Tester**: Codex, the owner's chosen end-to-end tester ("better than you at testing").

Both read and write this file. The owner reads it in the morning together with `VERSIONS.md`.

## How a test cycle works

1. When a version is built and passes the orchestrator's own checks (unit suites + `dev/e2e/run.mjs`), the
   orchestrator appends a **Test request** under **Requests**: version, git commit on branch `v1`, how to run it,
   what changed, where to focus. `Status: ready for testing`.
2. The tester claims it (`Status: testing (tester, <time>)`), runs the version end to end like real players would,
   and **records a video of the whole session**: save it as `videos/<version>.mp4` (or `.webm`) in this repo folder
   (the folder is git-ignored; it stays on this laptop for the owner). Screenshots go to `videos/<version>/`.
3. The tester appends a **Report** under the request: a verdict (PASS / PASS WITH ISSUES / FAIL), the video path, and
   numbered **findings**, each with: severity (blocker / major / minor / polish), what happened, steps to reproduce,
   expected vs actual, device/browser, and a screenshot path. Ideas and fun-factor feedback are welcome in a separate
   **Suggestions** list.
4. The orchestrator answers each finding in place (`→ fixed in v1.x`, `→ won't fix: reason`, `→ question: …`) and
   ships the fixes in the next version, which gets its own request.
5. Append only; never rewrite the other side's lines. Never put secrets in this file.

## How to run any version

```
cd ~/Documents/growth-hackathon
git fetch fork && git checkout <commit from the request>     # or stay on v1 at that commit
node server.js --bots 24          # 25 players with you; reads OPENAI_API_KEY from .env (never print it)
big screen: http://localhost:8000/space.html      phones: https://<laptop-ip>:8443/controller.html
```

Useful: `node dev/e2e/run.mjs --route expert|regular [--video]` (the orchestrator's own harness), `?perf` on any page
(fps overlay), `node perf-report.js --since 10m`. The spec is `PLAN.md` (section 0 has the latest decisions).

What to test every time: the full player journey on a phone-sized WebKit (iPhone 13, landscape) and the big screen:
join → draw the ship (photo and finger) → unlock card → draw the controller → START from the big screen → fly to
the boss → fight → planet → land → draw the explorer → open chests → round end → leaderboard → next round. Then:
generation quality (do drawn buttons and drawn parts come out right?), PvP and mischief between two or more phones,
hints, edge cases (refresh mid-round, rotate, background the app, bad drawings, no drawings left), performance
(`?perf`), and anything that feels confusing or not fun.

## Requests

_(the first request, v1.0, is posted as soon as client integration lands)_

## Tester log

- 2026-10-09 tester: Owner explicitly authorized full-game testing and recorded videos in this chat. The five-minute monitor now watches this channel alongside asset requests. Ready versions will be tested at their specified commit in an isolated checkout, preserving the orchestrator’s dirty workspace, with video/screenshots and numbered findings here. No ready version request is present yet. Emulated WebKit results will be distinguished from physical-phone performance.
