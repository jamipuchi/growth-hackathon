# v18-restart: the big screen's RESTART on the main line (v1.8)

The v1.6.1 RESTART (commit 07ef7af, branch v1.6.1-work) re-applied to the main line, plus four changes it needed there:

- **server.js:** without a supervisor, the fresh copy now starts **before** anything else and reports "loaded" over IPC
  (capped at 10 s). If the copy cannot start (a broken file, say), `POST /restart` returns 500 `restart failed`, no
  screen hears anything and the old server keeps running. v1.6.1 exited first and spawned afterwards, so a copy that
  failed left nothing running. The copy does not hold stdin, and the failure log names the copy's pid.
- **controller.html:** the phone also forgets v1.7's `sp.waitedIn`. On a restart it closes everything that would cover
  JOIN: the sheets (z 8, above every screen), the add-a-button sheet, v1.7's ROUND IN PROGRESS strip, the 3-2-1 and
  any notice.
- **space.html:** armed and busy, the button shows a heading over a small line, at most 21rem wide and about 5rem tall.
  That keeps it left of v1.7's START note ("A PLAYER IS READY ONCE THEIR SHIP AND CONTROLLER ARE DRAWN", centred under
  START · n READY), clear of the join card's tip sticker and of the waiting strip in most cases. With `?kb` the help
  line and the confirm say SHIFT+R.
- **README.md:** the "Restart everything" section (the docs lane already links to it and lists `KEEPALIVE`).

## Proof (node only, no browser)

```
node dev/v18-restart/restart-proof.mjs        # port 8561 (V18R_PORT: 8560-8569), about 15 s
```

HTTPS is off, `ASTRA_MOCK=1` with no OpenAI key, and the Hall of Fame and perf log live in a temp dir: `hall.init()`
empties its directory at every start, so the proof must never run on the repo's `hall/`. Every server it starts is
stopped by its PID; the respawned copies are found by the port and checked to be `node … server.js`.
`copy-fails.cjs` (preloaded with `--require`) makes the respawned copy crash (C) or hang without loading (D).

Run on 10 Oct 13:07:35 (Node 24.14.0, laptop load about 15): **46/46 PASS in 15.3 s**, numbers in `results.json`,
server output in `logs/`.

| | ms |
| --- | --- |
| A respawn: `POST /restart` answers 200 (the copy has loaded) | 41 |
| A: both streams get `{type:"restart", session}` | 42 |
| A: both streams closed | 341 |
| A: old process exits with code 0 | 494 |
| A: first `/info` answer from the new session | 582 |
| A: gap between the last old answer and the first new one | 251 |
| A13: a second restart, from the respawned copy (new session / gap) | 583 / 253 |
| B supervisor (`KEEPALIVE=1`): 200 / exit 0 | 1 / 457 |
| C copy crashes: 500 | 26 |
| D copy never loads: 500, copy stopped | 10004 |

What has not been checked yet (the test round): the phone and TV pages in a browser. That means the JOIN screen with
"The host restarted the game. Join again.", the TV reloading once, the two-tap and R R confirm, the label layout at
1280x720 and 1920x1080, a JOIN tapped while the server restarts, and a phone that was asleep during the restart.
