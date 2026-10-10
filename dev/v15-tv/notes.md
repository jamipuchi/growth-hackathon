# v15-tv notes: the big screen as a show (v1.5)

Owner of `space.html`, `bigscreen-extras.js`, `sfx.js`, `dev/v15-tv/**`. Morning round = implement only: only syntax checks were run
(`node dev/v11-client/check-syntax.mjs space.html`, `node --check bigscreen-extras.js sfx.js`). Nothing here has run in a browser yet.
Previous notes: `dev/v13-tv/notes.md`, `dev/v14-fix-client/notes-tv.md`.

## 1. Lobby hangar (bigscreen-extras `createHangar`, space.html `renderRoster`)
- One card per human, in join order (space.html `joinOrder`: a card never moves; newcomers go last). Bots are not shown (only the
  "+N BOTS" count under START).
- Card: the ship drawing on a paper tile (ruled lines, tilted ±2°), the name in the player's colour, a colour bar along the bottom,
  ✔ READY (green, top right; just ✔ when the cards are small), ★ n session stars (gold sticker, top left). Until the drawing exists:
  a scribbling pencil and DRAWING….
- Drawing URL: `entity.image` (server.js adds `/drawings/<player>-ship.png?v=<hash>` to every entity message and to the connect
  message's `entities`; parked ships carry it too). space.html keeps `shipImg` / `otherImg` maps from `game.on("entity")` and the world
  message. A new URL is preloaded off screen and only swapped in once it has loaded (a 404 never shows a broken image).
- Grid: `fit()` tries every column count and keeps the one with the biggest cards in #roster's box (card ≈ 1.26 × as tall as wide,
  at most 15 rem wide); a ResizeObserver refits. Every size inside a card is in em of the card (font-size = width / 10), so the same
  card works from 2 big ones to 25 small ones. At 1440x900 with 25 players: 7 columns × 4 rows, cards ≈ 75 px (4.7 rem) wide.
  Below 8.5 rem wide the card goes "compact" (bigger name, ✔ instead of ✔ READY, no DRAWING… word).
- Motion + sound: a join pops the card in (drop, overshoot, a colour ring) and plays "card-pop"; a drawing that arrives pops the
  paper tile and plays "card-pop" at rate 1.22 (volume .7). At most one pop per 120 ms (a burst of joins is one sound). The first
  fill (page opened mid-lobby, back from the results, a mock) cascades in quietly. The "+ NAME JOINED" toast is gone when the hangar
  is there (the card is the announcement); the old chips + toast stay as the fallback without bigscreen-extras.

## 2. Results ceremony (space.html, RESULTS section)
Timeline with 3 places (render.js plays "win" at 0 s, as before):
| s | what |
| --- | --- |
| 0 | title = the reason (TIME'S UP! / EVERY CHEST IS OPEN!), "AND THE WINNER IS…" under it |
| 0.75 | 3rd rises: the block grows, their drawing drops onto it, name + points pop; "podium" at rate .85 |
| 1.65 | 2nd rises; "podium" at rate 1 |
| 2.65 | the winner rises with a gold burst; title → "X WINS!" (pop), reason under it; confetti; "fanfare" |
| 4.0 | the ★ flies on an arc from the winner's "★ +1 STAR" tag into their row of the session leaderboard (5 sparks trail it); "star" |
| 5.0 | it lands: the row (which showed one star fewer until now) gets the new count, flashes gold, a ring bursts |
| 5.25 | the rest of the list cascades in (30 ms apart): all in by ~6.4 s of the 10 s scoreboard |
- Fewer places: the missing steps are skipped (1 player: the winner at 0.75 s). Nobody scored: no podium, the list at 0.3 s.
- Enter (host) skips to the end (`cerFinish`: everything shown, the star in the board, confetti if the winner had not risen yet).
- Instant (the end at once, confetti for a winner, no star flash): no result yet ("ROUND OVER"), `?noceremony`, reduced motion, a
  page opened during the results (`resultsLate`: its first view was the results), and the mock (unless `mock("results", { ceremony:
  true })` / `?mock=results&ceremony`).
- Podium places: `.pc.up` = rising now (animated), `.pc.shown` = already up (static). Drawing per place: `drawingOf(name)` = the ship
  drawing, else the latest planet drawing, else a chunky ship in their colour (also the fallback when the image fails).
- Board during the flight: `cerBoard` = the server's leaderboard (its order kept, so the row never moves under the star) with the
  winner's stars − 1. `renderBoard(el, lb, max, hi)`: `hi` = the row that flashes (only after a real landing or the host's skip:
  `cer.flash`); `#resLb.calm` stops the other rows re-popping.
- Hooks: `__bigscreen.skip()`, `__bigscreen.ceremony()` (replay, results only).

## 3. "Someone destroyed the boss"
bigscreen-extras FUN `bossLine`: world.js's no-killer line ("💥 Someone destroyed the boss! …", capital S; player names are always
lowercase) renders as [BOSS] BOSS DOWN! with no name piece. Real names render as before ("ANA [BOSS] LAST HIT! BOSS DOWN!").
The sting already ignored "Someone" (`bossDownSting`).

## 4. Sound (sfx.js is the one synth; render.js plays the game sounds)
- render.js already plays, on the TV: "win" when the results open, "start" (countdown-go) at GO, the last-10-s beeps, every world
  sound. The page plays ONLY new names render.js never plays: "card-pop", "podium", "fanfare", "star", loop "ambience" (plus its old
  "click" and the 3-2-1 "countdown" beeps). render.js's facade passes names it does not map straight to sfx.js (its SFX_MAP maps
  "pop" → hint, so the new pop is "card-pop").
- They are NOT in sfx.js's idle pre-render ORDER (phones never build them); `warm()` plays them at volume 0 a moment early
  (results open → podium/fanfare/star; ambience start → card-pop) so the first real play has no build hitch.
- Ambience: `sfx.loop("ambience", { volume: .01, maxSeconds: 3600 })` once audio is unlocked (the first click / key on the TV),
  volume ramps to .55 over ~2 s at the hud rate, `stop(1.2)` at START (startRound) or whenever the view is not the lobby / the phase
  is the countdown; renewed every 50 min (sfx.js stops a loop after maxSeconds).

## 5. Attract mode
Lobby with no human for 60 s (`?attract=<s>` to test; `__bigscreen.attract(true)` forces it) → the join card's code glows and a gold
"TIP" sticker hangs from the bottom of the join card (the code stays clear) cycling COPY.lobby.tips every 6 s with a flip. The first
human in, START or leaving the lobby ends it.

## Hooks and selectors kept
`#startBtn`, `__bigscreen.mock/unmock/feed/joinUrl/sting/countdown/followed/COPY`, `#podium .pc`, `#podium .p1 .nm` (the name only),
`#resRest .rr .nm`, `#resTitle`, `#resLb .lrow` (now with `data-name`). New: `__bigscreen.skip/ceremony/attract/mockJoin`.
Mock lobby / results now have doodled drawings (`mockDrawing(i)`, one in four "still drawing").

## sfx.js (done 10:46 by a sub-agent; syntax OK, not heard yet)
card-pop 0.36 s (sweep 280→880 Hz + a 1760 Hz ping), podium 0.60 s (noise riser 300→2700 Hz, saturated thump, clack), fanfare
1.90 s (cymbal swell → D5 pickup → held G chord, timpani G2, rising bells), star 1.45 s (rising glitter + pentatonic bells, ding at
0.96 s), ambience 8.0 s seamless loop (Cmaj9 ↔ Am9 pad, 12 voices 130-590 Hz, low-pass 1150-1950 Hz, folded twinkles) plus a faded
8 s one-shot. LEVEL card-pop .16, podium .2, fanfare .3, star .2, ambience / loop:ambience .06; VARY card-pop .04. ORDER keeps
"loop:ambience" out (phones never render it).

## Review fixes (11:06, after a read-only review of space.html + bigscreen-extras.js)
mock()/unmock() reset the ceremony (a 2nd mock("results") could leave the podium invisible) and unmock() refills the hangar quietly;
a first-fill card whose first drawing arrives after 2.5 s pops with its sound; a failed drawing load is retried after 4 s; no board
re-sort while the star flies; the ambience fades in on its own 100 ms timer (mocks send no hud) and stops when the tab hides;
a star from a replaced ceremony never lands on the new one; the star tag ends at the angle its pop-in ends (no snap); attract(true)
sticks in a live lobby; every podium place shows once the list does; instant screens get confetti and no early flash.

## Known test impact
- `dev/v12-modules/test-sfx-node.mjs` (not this lane's file) will fail: every SOUNDS/LOOPS name pre-rendered (l.199: expects 40
  buffers, gets 34), a duration for every name (l.62), loops 0.6-2.2 s (l.98: ambience is 8 s), total render <= 400 ms (l.86).
`dev/v12-client/tv/test-page-jsdom.mjs` lines ~97-99 expect "ana WINS!" and the reason chip 30 ms into the results: the ceremony shows
them at ~2.65 s. Load the page with `?noceremony` in that test, or call `__bigscreen.skip()` before the checks.

## To check in the testing round
1. `space.html?mock=lobby&players=25` and `&players=3` at 1440x900, 1920x1080, 1280x720: cards fit between the join card and the
   session board, names readable, drawings on paper; `__bigscreen.mockJoin("zed")`, then `mockJoin("zed", { drawn: true, ready: true })`.
2. `space.html?mock=results&players=25&ceremony` (and players=2, 1, &nobody): the timeline above, the star lands on the right row,
   Enter mid-way, no overlap of the podium (18.6 rem) with the 3-column list at 25 players.
3. Live: join 3 phones one by one (pop + sound each), draw a ship (the card's drawing pops in), START (ambience fades), a round to the
   results (win jingle, then podium thumps, fanfare, star), back to the lobby (cards cascade in, ambience back).
4. Empty lobby for a minute: tips cycle; a phone joins: they stop.
5. Kill feed: `__bigscreen.feed("💥 Someone destroyed the boss! The planet is open")` → [BOSS] BOSS DOWN! with no name.
