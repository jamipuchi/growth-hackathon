# bigscreen agent: notes (v1.1 client track)

Owner of: `space.html`, `bigscreen-extras.js` (nothing else). Can be cut off any time: read this first.
Never ran a browser (rule). Everything below marked "checked" was checked without one (see "Unverified" for how).

## Status (2026-10-10, ~01:10)
- [x] Fortnite-like restyle of the whole big screen (SPEC 5): Barlow Condensed 800/900 italic headings, Barlow body, white text with
      a dark outline + hard drop shadow, blue / purple / gold, slanted plates with 3 to 4 px borders and hard bottom shadows,
      pop-in / bounce / slide-in motion, `prefers-reduced-motion` respected, transform/opacity only (no per-frame layout).
- [x] LOBBY, PLAY, RESULTS views (below), all strings in ONE `const COPY` at the top of the module script (`<script type="module">`).
- [x] `bigscreen-extras.js` restyled (QR, kill feed, name tags) with the same exported APIs; new optional APIs listed below.
- [x] e2e ids: `#startBtn` (visible, clickable, no scale animation: Playwright waits for a stable box), `#lobby`, `#qr`,
      `#leaderboard`, `#timer` (textContent is exactly hud.leftText, e.g. "3:48"), `#results`, `window.__game`.
- [ ] NOT DONE / UNVERIFIED: any real rendering (see "Unverified"). The harness must screenshot it (see "Preview without a round").

## Structure of space.html
`#hud[data-view="none|lobby|play|results"]` (set from hud.phase: lobby → lobby, playing/assists → play, scoreboard → results;
"none" until the first tick). Elements with class `play` show only in the play view; `#lobby` only in the lobby; `#results` only in
the results. Everything is sized in rem: `html{font-size:min(100vw/90,100vh/56.25)}` = 16 px at 1440x900, 19.2 px at 1920x1080.
- PLAY: `#scores` (top left: rank badges 1 gold / 2 silver / 3 bronze, followed player gold-highlighted, max 10 rows, the followed
  player is shown as the 10th row when ranked lower, "+n MORE"; rows move with transform when the order changes), `#top` =
  `#objective` (`#objTitle`, `#bar` red → orange `#barFill`, `#status`) + `#timerBox` (`#timer` gold, red + pulsing under 0:30,
  full-screen red edge pulse under 0:10, `#assist` chip "ASSISTS ON"), `#chests` (top
  right, "CHESTS 2 / 7" + one pip per chest, hidden while there are no chests), kill feed (`.bse-feed`, under the chest counter),
  `#radarWrap > #radar` (bottom left, thick ring, rotating sweep, red boss / blue players / cyan you / red diamond objective),
  `#meters` (bottom right: FOLLOWING name, HP, SHIELD, BOOST; hidden when nobody is followed; "BACK IN n" while dead), `#banner`
  (announcement ribbons), name tags (12 nearest).
- LOBBY: `#logoBar` (logo "SPACE PARTY" + `#roundChip` "ROUND n"), `#join` card (left: ribbon "SCAN TO JOIN", `#qr`, `#joinUrl`,
  `#steps` 1 · SCAN THE CODE, 2 · DRAW YOUR SPACESHIP, 3 · DRAW YOUR CONTROLLER), `#leaderboard` card (right: ribbon "SESSION
  LEADERBOARD", `#lbList` rows with rank badge, name, "★ n", total points; empty state "No rounds yet · win one to earn a ★"),
  `#startZone` (`#startBtn` giant gold slanted START, `#lobbyCount` "n PLAYERS IN · n READY" (+ "+n BOTS"), `#startNote` "or press
  ENTER"), name cards over each ship (extras, lobby mode), "+ NAME JOINED" toasts (`#pops`).
- RESULTS: `#resTitle` ("TIME'S UP!" / "EVERY CHEST IS OPEN!" from result.reason), `#podium` (2nd, 1st, 3rd; 1st has crown, "WINNER",
  "★ +1 STAR"), `#resRest` (everyone else by points, 1 to 3 columns so 25 players fit), `#resBoard > #resLb` (session
  leaderboard, top 10), `#resNext` "NEXT ROUND IN n" (hud.clock), rotating rays + 44 CSS confetti pieces.
- `#keys`: keyboard debug help, hidden; H toggles it. M mutes / unmutes (toast "SOUND ON/OFF").

## COPY
One `const COPY = {…}` at the top of the module script: title, brand, lobby.*, cards.*, play.*, results.*, sound.*, help. HTML text
is filled from it through `data-copy="a.b"` attributes; templates use `{n}`, `{r}`, `{name}`, `{open}`, `{total}`, `{port}`. The
status lines under the objective come from render.js (its own COPY), the kill feed lines from the server. The extras have no
player-facing strings (the page passes them; the QR title default "SCAN TO JOIN" only keeps old callers working).

## Decisions (overrule me if needed)
- START click: `sfx.unlock()` + "click" sound inside the gesture, POST /start, busy label "STARTING…", 409 → "ALREADY STARTED"
  (then START again), network error → "TRY AGAIN".
- Sound: render.js (WorldSound) already plays "start" (lobby → playing), "win" (→ scoreboard) and the last-10-seconds "countdown" from
  the tick phase, so the page does NOT play them (it would double them). The page only unlocks audio on the first click / key, plays
  its UI sounds ("click" on START, "pop" when someone joins) and handles M (mute, via sfx.muted / setMuted).
- Enter and S start the round in the lobby (and do NOT join the debug keyboard player). Outside the lobby the debug keyboard
  player is unchanged (it still joins as "keyboard" on its first mapped key: a host who taps arrow keys during a round adds a
  ghost ship; consider gating it behind `?debug`).
- Banners (`#banner`) only for `announce.big` plus chest openings and steals (gold for wins / chests / last hit / steals); every
  other line (kills, landings, wrecks) is kill-feed only. The round-end announcement is not shown as a banner (the results screen
  says it); it still goes to the feed. Emoji are stripped from banners and the feed.
- Kill feed: every player name inside a line is painted in that player's colour (was: only the first name's colour for the whole
  line); the accent stripe uses the first name's colour. Hint toasts (`kind:"hint"`, with words) go to the feed as a small purple
  line; "refused" and "info" toasts are not shown on the TV (they are for one phone and would flood it with 25 players).
- Session leaderboard shows the empty state while every row is 0 stars and 0 points (the server lists every active player).
- QR: not shown on localhost / 127.x / ::1 unless `?join=<url>` is given: a dashed tile says "Open this page at your laptop's
  network address (not localhost) to show the join code" and the URL line shows `http://<laptop-ip>:PORT/controller.html`.
  With a LAN host or `?join=` the QR is exact-pixel (module edges rounded to whole device pixels), >= 278 px wide at 1440x900,
  redrawn by a ResizeObserver when its width changes.
- Name tags in play: capped at 12 (nearest first) by the page; the pool is 25 (lobby shows every ship). A player keeps the same
  tag while in view; cards pop in when they first show.
- `#startBtn` has no transform animation (a glow on its plate instead): Playwright's click waits for an unchanging bounding box.

## Extras API (bigscreen-extras.js), old callers keep working
- `createJoinQR(container, url, { size: number | "fit", title: string | false, showUrl: bool })` ("fit" = as wide as the container).
- `createKillFeed(container, { max, life }) → { el, push(text, colour, names?, kind?), destroy }` (names = [[name, colour]] or a Map; kind "hint").
- `createNameTags(container, { max, offset }) → { el, update(list, { limit }?), setMode("lobby"|"play"), setInfo({ [name]: { sub, short, tone: "ok"|"wait"|"bot", badge } }), destroy }`.
  controller.html's `createNameTags($("play"), { max: 8, offset: 4 })` + `update(list)` is unchanged (play mode, 10 px base font; the page
  sets `--bse-fs: 1rem` on `#hud`). CSS classes are all `bse-` prefixed (no collisions with a page).

## Preview without a round (use this for screenshots)
`window.__bigscreen.mock(kind, opts)` or the URL `space.html?mock=<lobby|play|results>&players=N[&bots=N][&left=S][&me=i][&assists][&norounds][&nobody][&reason=chests]`
shows that screen with made-up players (also name tags at fixed positions); `mock(null)` / `unmock()` returns to the live game.
Add `&join=http://192.168.1.20:8000/controller.html` to see the QR on localhost. Real hud events are ignored while a mock is on.
Useful set (all at 1440x900 and 1920x1080): lobby players=0, 1, 8, 25; lobby norounds; play players=8, 25 (&me=20 = followed player outside
the top 10), play left=25 (urgent), left=8 (alarm), assists; results players=8, 25, reason=chests, nobody, players=1, players=3.

## Unverified (no browser here)
- Every pixel. Checked only: syntax (`node --check` on the extracted module script and `--input-type=module --check` on the extras), a CSS
  parse with lightningcss (no errors, no warnings), a jsdom runtime run of the page script through lobby → START (click, Enter, S, 409) →
  play → results → lobby plus 10 mock variants (80 checks, no errors; scripts in /tmp/bse-build, volatile), QR painting rasterised at
  7 sizes / DPRs and every module centre compared with the encoder (the encoder code is byte-identical to the verified v1.0 one).
- Things to look at first: gradient text (`.gt`: logo, results title) alignment of the two layers; the skewed plates; text fit in the
  scoreboard / leaderboard rows with long names; that `paint-order: stroke fill` renders the outline outside the glyph (older Chrome
  paints the stroke over the glyph edge: still legible); the lobby cards vs the 3D ships at 25 players; the results layout at 25
  players (3 columns); the QR scan from a phone at 1440x900 and 1920x1080.
- Fonts come from Google Fonts (non-blocking `media=print onload` link); offline the Impact / Arial Narrow fallbacks are used.

## Needs from render.js / the lead
- Lobby camera: the UI leaves this centre free for the 3D showcase: x 26–74 %, y 15–70 % of the screen (left card x 2–26 %,
  right card 74–98 %, logo bar y 2–13 %, START + counters y 70–97 %).
- sfx used (all optional, nothing breaks if one is missing): game.sfx / exported sfx: unlock(), play("click" | "pop"), setMuted(), muted.
- Used from hud(): phase, clock, round, left, leftText, objective, objectiveText, bar, status, assists, chests, leaderboard, result,
  me, followed, radar, scores (incl. stars). Fallbacks if missing: tick.left, world.leaderboard / result / chests.
- projectPlayers(): in the lobby the page asks for every ship (limit 25), in play the 12 nearest; the lobby only shows cards for ships
  with `visible !== false` (render.js's own range check: dist < 260 in space).

## How to resume
1. Read this file; `node dev/v11-client/check-syntax.mjs space.html bigscreen-extras.js`.
2. Screenshots with the mock URLs above (harness), then fix what looks off. Most tuning knobs are rem numbers in the `<style>` of
   space.html (sections PLAY / LOBBY / RESULTS) and the `--bse-*` / `em` values in the extras' `injectStyles()`.
3. The jsdom smoke scripts were in /tmp/bse-build (test-page.mjs, test-extras.mjs, lint-lcss.mjs, extract.mjs); they need a jsdom install
   from another project on this machine (e.g. /Users/jaumepuig/Documents/linkedin/node_modules). Ask for a copy in dev/v11-client/ if wanted.
