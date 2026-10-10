# v18-docs: documentation for v1.6, v1.6.1, v1.6.2 and v1.7 (Oct 10, 12:52-13:08)

Docs only: no game file changed, no server, browser or OpenAI call.

## What was written
- `VERSIONS.md`, append-only (0 lines removed): table rows for v1.6, v1.6.1 / v1.6.2 and v1.7; a note per version (what
  changed, the recorded checks with their numbers and how honest they are, what is still open, where it runs); the
  owner's decisions from 11:52 to 12:54 appended to the morning table. The v1.5 row ("in progress") and the 11:31 row
  ("to do") are older text and stay as they were; the v1.6 note opens with what v1.5 shipped (tag on 21f2082, 11:44).
- `README.md`, everything except "Restart everything" (the v18-restart track's section, left as it wrote it): what's
  new in v1.6 and v1.7 (the v1.3-v1.5 list kept below it, trimmed), how to run (ports, HTTPS on and off, bots 0 by
  default, `--endless` / `ENDLESS=1`, Sol's effort), the play servers' keep-alive loop (`EFFORT`, `BOTS`,
  `KEEPALIVE=1`), the round flow from a phone (ready-only start, automatic landing, the explorer only after landing,
  fresh rounds, ENDLESS), the host's controls, the Hall of Fame and the Decisions API (`gpt-6-luna`), ENDLESS, every
  environment variable with its default, the file map (adds `endless.js`, `hall.js`, `hall-of-fame.html`, `hall/`), and
  the newer node checks.

## Sources
- `git log --oneline v1.5..HEAD` and `git show --stat` of every commit (d12950f, eb77f96, 717e26e, abebbfd, 7b306bb,
  cac0a06, c45390b, 4dbe138, 0622fdf and the PLAN.md commits); the hotfix commits 07ef7af (tag v1.6.1) and 298f60a
  (tag v1.6.2) on the branch `v1.6.1-work`, which is not in v1's history.
- `PLAN.md` section 0 (owner decisions 11:31, 11:53, 12:07, 12:26); `.orch/integration-notes.md` (v15-v17 and
  sol-effort); `.orch/ORCHESTRATOR.md` "Morning run" (tag times, ports, live servers, owner calls);
  `.orch/progress/` of v15-fresh, v16-render, v16-hall, v16-endless, v16-sim, v17-island-look, v17-island-size,
  v17-ready; `dev/v17-island-size/README.md`.
- The code itself for every default and flag: `server.js` (ports, `--bots` 0 to 25 default 0, `--endless`,
  `CTRL_HTML_TIMEOUT_MS` 20000), `astra.js` and `astra-html.js` (effort `medium`, the timeouts and their env names),
  `hall.js` (60 calls, 3 at a time, 20 s, 14 comments, `HALL_*`), `endless.js` (60 s, 10 s, 90 s, 5 s, 60 s, 180 s),
  `world.js` (ready = ship drawing + controller; auto-landing margin 2 m; take-off 15 m out), `space.html` (host keys,
  the HALL OF FAME tab), `controller.html` (waiting copy).
- Live ports read with `lsof` at 12:58 (8103/8546, 8104/8547 and 8105/8548 listening; 8106/8549 free).

## Checks (13:05)
- Every Markdown table row has its header's cell count: VERSIONS.md 4 tables, 63 rows; README.md 4 tables, 75 rows;
  0 mismatches; code fences balanced in both.
- Every file path the new text cites exists (21 checked), except the two the Codex v1.7 round is still writing
  (`dev/v17-test/FINDINGS.md`, `videos/v1.7/`), which are named as coming.
- `git diff -U0 VERSIONS.md`: 0 removed lines (append-only).
