# v13-tv notes: the big screen as a spectator TV (v1.3)

Owner of `space.html`, `bigscreen-extras.js`, `dev/v13-tv/**`. Morning round = implement only (syntax checks only); nothing here was run in a
browser yet. Previous notes: `dev/v12-client/notes-tv.md`.

## Layout (1 rem = 16 px at 1440x900, the page scales with min(width/90, height/56.25))
- PLAY: scoreboard top left (7 big rows + the followed player, name 1.85 rem = 30 px, score 1.95 rem, session stars per row);
  objective + TIME LEFT top centre (title 2.7 rem, status 1.75 rem = 28 px condensed caps, timer 4.4 rem); RIGHT COLUMN (`#side`): the
  live map (MAP tile, then the PLANET tile once the planet is open or someone is on it) and the chest counter; followed player's meters
  bottom right; KILL FEED bottom left (newest at the bottom, 1.79 rem = 29 px lines, max 5). The banner sits in the centre band
  (top 27 %, max 44 rem wide): it can never cover the feed (bottom left), the map (right) or the scoreboard (left).
- Stings (`#sting`, z 32, under the feed z 35): 3-2-1 before START, GO! (ROUND n · objective), BOSS DOWN! (who landed / stole the last
  hit), the last 5 seconds as big see-through red digits, ROUND n when results → lobby.
- LOBBY: join card left (QR 20.2 rem = 36 % of the height), roster centre (one chip per human: name in colour, ✔ READY / DRAWING…,
  stars; 2/3/4 columns for ≤8/≤15/25), session leaderboard right, START bottom. No name tags over the ships in lobby or results.
- RESULTS unchanged except bigger podium (winner 4 rem, points 2 rem).

## Flow
START (button or Enter) → TV counts 3-2-1 (2.4 s, `?nocountdown` or reduced motion skips) → POST /start → GO! sting → play
→ BOSS DOWN! sting (announce line, or the world message's boss.dead flip as a fallback) → first landing = gold banner
→ chests = gold banners + the PLANET map → last 5 s digits → results (one winner = world.result.winner) → ROUND n sting in the lobby.

## Kill feed (bigscreen-extras parseFeedLine(raw, lines) → .fun)
Known server sentences become "NAME [chip] NAME  PUNCHLINE": EMP (BUTTONS SCRAMBLED!), ink (SPLAT!), tractor (YOINK!), mine
(X HIT Y'S [MINE] BOOM! −30), decoy (X FELL FOR Y'S [DECOY]), steal (+750 STOLEN!), last hit / stolen last hit, swarm, wrecked ship,
chest, landing, rebuilt, round won. Unknown lines fall back to text + emoji chips (old behaviour). Punchlines: COPY.feedLines.
Unit check for the testing round: `node dev/v13-tv/unit-feed.mjs`.

## Map (bigscreen-extras createMiniMap)
SPACE tile: route bottom → top (spawn ring, dashed route, boss = red plate + gold HP arc, nebula glow, planet beyond the boss: dim +
dashed shield while locked = boss + norm(boss) × TUNING.planet.offset, the same formula as world.js planetAt; bright + pulsing landing
ring once open, ×N = explorers on it). Ships: humans 8 px-radius dots with a white rim, bots 4 px at 80 %, dead = cross, invisible =
hidden, followed = pulsing ring + name. PLANET tile: fitted to the landing pad + chests; closed buried chest = glowing gold X, closed
rock chest = grey rock with a gold heart, dig/drill progress ring, open = dim with a tick in the opener's colour; parked ships (wrecked =
red cross); explorers like ships. Drawn at ~20 Hz from the last two ticks (interpolated) only in the play view.

## Leftovers fixed
- Debug keyboard player only with `?kb` (a stray key never joins "keyboard"); S no longer starts (Enter only); the H legend shows the test
  keys only with ?kb.
- `game.followed` does not exist on the render API: the tags' focus and the map's followed player now come from `hud.followed`.

## Hooks (kept + new)
`__bigscreen.mock(kind, {…, planet})`, `unmock()`, `feed(text, big)`, `joinUrl()`, `COPY`; new: `sting(text, opts)`, `countdown()`,
`followed()`. URL: `space.html?mock=play&players=25&planet` shows both map tiles. `#startBtn` unchanged.

## To check in the testing round
1. `node dev/v13-tv/unit-feed.mjs`.
2. `space.html?mock=play&players=25` and `&planet` at 1440x900, 1920x1080, 1280x720: nothing overlaps (scoreboard 7 rows vs feed 5 lines
   bottom left; right column map + planet + chests vs the meters panel, measured gap ~1.4 rem at 16:10).
3. `__bigscreen.feed(...)` with the 14 lines of unit-feed: chips, colours, punchlines readable; the banner never on the feed.
4. Live: START → 3-2-1 → GO!; boss down sting; last-5 digits; results → ROUND n sting; lobby roster with 25 players.
