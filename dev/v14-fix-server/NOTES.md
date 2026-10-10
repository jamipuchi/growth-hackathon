# v14-fix-server: the owner's 09:05 decisions on the server (Oct 10)

Implement-only round: `node --check` only, nothing run. Tests for the test round are in the existing suites:
`node dev/netcode/sim-test.js` (3 new tests: countdown, late hints, seats), `node dev/rules/rules-test.js` (lateHint),
`node dev/netcode/live-test.js` (countdown START, manifest and icons routes, private paths).

## Wire contract (all additive)

### Countdown (decision 5)
- `POST /start` → `{ ok, round, phase: "countdown", countdown: 3 }`. The world plays phase `"countdown"` for
  `ROUND.countdownSeconds` (3 s), then `"playing"` as before (GO = phase change countdown → playing; the big
  `Round N: REACH THE BOSS` announce comes at GO as before).
- `{ countdown: false }` (or `0`, `"0"`, `"false"`, or `?countdown=0`) starts at once: tests, tools, the TV's `?nocountdown`.
  `world.start()` without options and `--autostart` also start at once (unit tests rely on it).
- `tick.countdown` and `world.countdown`: whole seconds left, 3 then 2 then 1, ONLY in phase countdown (absent otherwise).
  `tick.clock` keeps the exact seconds left. Every world message now carries `phase` too (a screen that connects
  mid-countdown counts down at once).
- During the countdown nothing moves, fires or thinks (bots included); presses are dropped; held keys and sticks count
  from GO. A player who joins during the countdown is counted at GO (boss HP and chest count rescaled; the island keeps
  its seed, only the chests are placed again).
- The `Round N starts in 3…` announce is no longer `big` (the feed only): the screens draw their own 3-2-1 from the phase.

### Late hints (decision 1: no free skills at 3:00)
From 3:00 (phase `assists`) every human still missing what the gate ahead needs gets ONE card per gate and need:

```
{ type: "toast", player, kind: "hint", need: "part" | "button", gate: "weapon" | "land" | "dig" | "drill", step: 3,
  late: true, title: "DRAW A SHOVEL", text: "Draw a shovel or claws on your explorer",
  part: "shovel", parts: ["shovel"], on: "ship" | "explorer" | "controller", sketch: null, ghost: null | { action, x, y, w, h } }
```
- Gate ahead = the open gate of the player's world: space → weapon while the boss lives, else land; island → dig / drill
  while such a chest is closed. Part before button; both explorer parts missing → one card
  (`DRAW A SHOVEL AND A DRILL`, parts `["shovel", "drill"]`).
- Titles: `DRAW A GUN`, `DRAW LANDING LEGS`, `DRAW A SHOVEL`, `DRAW A DRILL`, `DRAW A <WORD> BUTTON` (button need, with
  the ghost box like the ladder's last step).
- Never while the draw sheet is open (input `drawing`), never with no drawing left in that world, at most one card per
  6 s per player, never two messages to one player in one step (a ladder toast wins). Bots never get one. The card and
  the hint ladder never give the same answer twice: a gate and need the ladder already answered (step 3) gets no card,
  and after a card the ladder stays quiet about every gate on it (rules.js `hints.gaveAnswer` / `hints.answered`).
- If the 3-2-1 joiner's extra chests do not fit around the landing spot, the START chests stay (the island is never
  rebuilt at GO).
- Nothing is granted: `entity.assisted` is never set. The 3:00 announce stays `3:00! The chests glow. Missing a skill? Draw it now!`.
- `step` (1 riddle, 2 sketch, 3 answer) is now on every hint toast, so the phone's big card can key on `step === 3`.

### Ink (decision 2)
Already in from v13-server: `mischief` inkbomb `seconds: 10` (= the safety fade), `checkMischief` allows ≤ 10 s.

### 25 players (decision 7)
`MAX_PLAYERS = 25`, humans and bots together (MAX_HUMANS 32 is gone). A new human takes the newest bot's seat;
`--bots` is capped at 25; a 26th human gets `/join` 400 `the game is full`. v1.4: a human idle for 10+ minutes who comes
back to a room of 25 active humans gets no seat either (`world.seat(name)` false → `/input` 409, `/join` and `/generate`
400 `the game is full`).

### Objectives
`OBJECTIVES.crackBoss` and `OBJECTIVES.chest` are gone (no client read them). The landing announce is now
`ana landed on the planet. OPEN THE CHESTS` (was `… DIG UP A CHEST`; the TV parses the prefix only).

### Static files
`/controller.webmanifest` (application/manifest+json, `no-cache`), `/icons/<name>.png` (one level, no dot files, PNG
only), `/apple-touch-icon[-WxH][-precomposed].png` → the icons/ file whose name contains `apple`, else `180`.

### /generate abort
`res.on("close")` before `res.end()` = the phone gave up: the server stops waiting and spends no drawing, sets no
layout or entity, broadcasts nothing. astra.js takes `generate(body, { signal })` (its `opts.signal`, added by the astra
lane this round): the request lets go of the model call, aborted when nobody else waits for that drawing, so tapping
Done again reads it afresh (no cache hit). One event-loop turn remains after the spend (`await controllerHtml`) where a
close is not noticed: the drawing then counts, as if the answer had arrived.

## Announce wordings (unchanged unless listed)
`Round N starts in 3…` (now not big) · `Round N: REACH THE BOSS` (big) · `3:00! The chests glow. Missing a skill? Draw it now!` (big) ·
`🏆 <why>! X wins round N with P points` / `<why>! Nobody scored this round` (big) · `X ✕ Y` (+ ` 💣` / ` 🧲` …) ·
`💰 X stole N points from Y!` · `Y was destroyed` · `💥 The swarm brought the boss down! X did the most damage: +1000. LAND ON THE PLANET` ·
`💥 X stole the boss from Y! +1000. LAND ON THE PLANET` · `💥 X destroyed the boss! +1000. LAND ON THE PLANET` ·
`🔧 X wrecked Y's ship (+150)` / `🔧 Y's ship was wrecked` · `🔧 X rebuilt their ship` · `X landed on the planet. OPEN THE CHESTS` (changed) ·
`💎 X opened a chest (+1500)` · `⚡ X scrambled Y's buttons` · `🦑 X inked Y's screen` · `🧲 X pulled Y in` ·
`💣 Y hit X's mine (-30)` · `💣 X dropped a mine` · `🎭 X sent out a decoy` · `🎭 X shot Y's decoy`.
