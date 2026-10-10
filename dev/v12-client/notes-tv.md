# tv agent: notes (v1.2 client track)

Owner of: `space.html`, `bigscreen-extras.js`, `dev/v12-client/tv/`, this file, `dev/v12-client/shots/tv/` (nothing else).
Can be cut off any time: read this first. Spec: `dev/v12-client/SPEC.md` ("Agent: tv"). Previous notes: `dev/v11-client/notes-bigscreen.md`.

## Status (02:22)
The whole tv list is implemented. Browser-verified at 02:10-02:12 (Chromium, server :8266, `tv/run-mock.mjs`): results fit, lobby join code
from /info, kill feed chips, name tags declutter, death panel (mock). Node-only tests pass (jsdom: extras + the page script with a fake game).
NOT browser-verified yet: the live round with real data (real emp / mine lines, status chips on real tags, a real death, the real results
screen) and three small edits made after the 02:12 run (long join address shrinks to fit; kill feed 0.6 rem lower; `bots` also synced from hud.scores).
Why: at ~02:13 Chromium started aborting at launch (SIGABRT, no output) for every browser run: the shell lost the user-directory lookup
(`getpwuid(501)` fails, `dscl` eServerError) and external DNS (curl example.com = 000). The lead confirmed at 02:17 that it is the machine/session.

### Pending live check (run when `id jaumepuig` works again, .orch/status/HOLD absent, lock free)
    cd /Users/jaumepuig/Documents/growth-hackathon
    mkdir dev/v12-client/.browser-lock && echo "tv $(date +%T)" > dev/v12-client/.browser-lock/owner
    node dev/v12-client/tv/run-mock.mjs            # ~55 s: results x3 sizes (measured), lobby QR, mock play; re-checks the 3 late edits
    node dev/v12-client/tv/run-play.mjs            # ~2 min: 23 bots + ana + bob live; shots in dev/v12-client/shots/tv/play-live-*.png, results-live-*.png
    rm -rf dev/v12-client/.browser-lock
Then read `dev/v12-client/tv/report-mock.json` and `report-play.json` and LOOK at the screenshots. What to expect from run-play:
`steps.emp.lines` has a line with an `emp` chip; `steps.emp.tags.chips` lists `bob:emp` (needs render's `flags` on projectPlayers: it is there);
`steps.mine.hit` true + a `mine` chip + `bob:stun`; `steps.death.seen` shows `DESTROYED / BACK IN n` rows then `BACK IN THE FIGHT!`;
`steps.results.measured.problems` empty and `titleMatches` true (title + first row = the server's `world.result.winner`).

## Done (numbers measured 02:10-02:12, Chromium, ASTRA_MOCK server, 24 bots)
1. Join QR from GET /info: QR + address = `controllerUrl` (https shown as its own `https://` line), `?join=` wins, no /info = old logic (page host; hint on
   localhost). /info is re-read when the lobby opens (4 s throttle). TV opened on 127.0.0.1:8266: /info = `http://10.38.40.24:8266/controller.html`; the QR
   encodes exactly that (0 module mismatches vs encodeQR), 280 px at 1440x900, 336 px at 1920x1080; address 31.2 px / 37.4 px (1.95 rem), two lines
   ("10.38.40.24:8266" / "/controller.html"). `?join=https://192.168.1.77:8443/...` override works but the first version broke "8443" over two lines:
   fixed with `fitJoin()` (shrinks the host line to fit, scheme on its own line) AFTER the run: needs the re-check above.
2. Results, ONE winner: title "<NAME> WINS!" (or "NOBODY SCORED"), reason chip under it, podium + first row = `world.result.winner` (list lined up with it), banner hidden in the
   results view (CSS + code), "ROUND OVER" (no "nobody" flash) until `result` arrives. Measured with getBoundingClientRect, 25 players (3 podium + 22 rows, session board 10 rows):
   | size | lowest row bottom | board card bottom | board lowest row | "NEXT ROUND" top | min name font | problems |
   | 1440x900 | 781 / 900 | 785 | 721 | 811 | 22.4 px | 0 |
   | 1920x1080 | 937 / 1080 | 942 | 866 | 973 | 26.9 px | 0 |
   | 1280x720 | 625 / 720 | 628 | 577 | 649 | 17.9 px | 0 |
   Problems = row outside the viewport, two rows intersecting, row on the board card, clipped name, banner visible. Other variants at 1440x900 (all 0 problems): nobody scored
   (25 rows, lowest 667), 14 players (lowest 729), 8 players + chests reason (709), 3 players (445), 1 player (445).
3. Kill feed: inline-SVG icon chips with their word (EMP INK PULL MINE DECOY STEAL, red KO chip between killer and victim, "was destroyed" gets a KO chip), names in their colours,
   lines 25.6 px (chip words 22 px) at 1440x900, max 5, KO flash, kill between two bots = small dim `quiet` line dropped first. The page passes the RAW announce text (the feed turns the emoji
   into chips); the banner and the colour lookup get it without emoji; assists rewrite kept. Mock run: 5 lines, 6 chips, 2 KO.
4. Name tags: every visible player (max 25, no 12 limit); order = followed player, humans, bots, nearest; a tag that would overlap a placed one shrinks to its name (m1), then to a
   coloured dot (m2), with hysteresis; far ships and bots get smaller tags; status chips EMP / INK / PULL / STUN from `projectPlayers()` items' `flags` (render.js provides `bot` + `flags` already).
   Mock crowd (25 ships in a small cluster): 9 full + 9 name-only + 7 dots. Sparse screen: 25 full. Lobby cards unchanged (no overlap with the lobby text in the 24-bot and 25-mock lobby shots).
   API unchanged for the phone: `createNameTags(el, {max, offset, labels?})`, `update(list, {limit?, focus?}?)`.
5. Death / respawn: the followed player's panel turns red, "DESTROYED" 3.5 rem + "BACK IN n" 3.2 rem (pulsing), then green "BACK IN THE FIGHT!" for 1.6 s. Mock `?mock=play&dead` and the jsdom page
   test pass; real death pending. Hints: the TV no longer listens to `toast` (private hints never show, old servers too).
6. Copy (COPY table): "NOBODY SCORED" + "NO WINNER · NO STAR THIS ROUND"; localhost hint reworded; H legend starts with "HOST KEYS · ENTER start · M sound · H hide this"; FOLLOWING label 1.3 rem + name 2.6 rem;
   no internal words on the TV. Steps stay "SCAN THE CODE / DRAW YOUR SPACESHIP / DRAW YOUR CONTROLLER" (same words as the phone). Keyboard legend hidden unless H (checked in every screenshot).
7. Hooks: `__bigscreen.feed(text, big?)` (same function as the server's announce), `__bigscreen.joinUrl()`, mock flags `&dead` `&crowd` (plus the old ones).

## Node-only tests (any time, no browser)
    node dev/v11-client/check-syntax.mjs space.html bigscreen-extras.js
    node dev/v12-client/tv/unit-parse.mjs            # feed line parser, QR size for the /info urls
    node dev/v12-client/tv/test-extras-jsdom.mjs     # feed + tags logic (needs jsdom from /Users/jaumepuig/Documents/linkedin/node_modules)
    node dev/v12-client/tv/test-page-jsdom.mjs       # space.html's script with a fake game: join code, dead panel, quiet bot kills, chips, results, hints
(the "Not implemented: HTMLCanvasElement.getContext" lines from jsdom are expected noise)

## Files and scratch
- `tv/part-*.js`: the snippets that were spliced into bigscreen-extras.js (history only; the extras file is the truth).
- `tv/measure.mjs` the results measurement (runs in the page); `tv/run-mock.mjs [results,lobby,play]` browser run 1; `tv/run-play.mjs` browser run 2. Both start
  `PORT=8266 node dev/v12-client/server.cjs` as their child (V11_EXIT_WITH_PARENT=1) and write `tv/report-*.json` + `shots/tv/*.png`.
- Screenshots (1440x900 unless named): results-25-{1440x900,1920x1080,1280x720}, results-{nobody,players-14,players-8-chests,players-3,players-1}, lobby-info-{1440x900,1920x1080},
  lobby-join-override, lobby-mock-25, play-mock-25-feed, play-mock-crowd, play-mock-dead (all in `dev/v12-client/shots/tv/`).

## Open / suggestions
- The debug keyboard player (any of W A S D Q E arrows space... on the TV page) still joins a ship called "keyboard" by itself: a stray key on the party laptop adds a fake player
  (and takes one of the 25 slots). Suggest gating it behind `?kb` (not done: not in my list).
- The big banner (gold, centre) can overlap the left end of long kill-feed lines for ~2.6 s.
