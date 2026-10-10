# Space Party

A party game for up to 25 players: a big screen everyone watches, and each player's own phone.
Every player draws a spaceship (later an astronaut, car, bike or animal) that becomes a 3D object whose skills come
only from what is drawn on it, and a controller whose drawn buttons become the phone's controls. Rounds last at most
4:00 and most points wins; an optional ENDLESS mode runs with no clock until the host ends it.

- The spec: [PLAN.md](PLAN.md). Section 0 holds the owner's decisions and wins over everything else.
- Every playable version, its checks and videos: [VERSIONS.md](VERSIONS.md). The demo build is v1.7 (tag `v1.7`).

## What's new (v1.6 and v1.7)

- **Landing is automatic** (v1.6, the owner's 12:07 call). Once the boss is down, fly into the planet and your ship
  lands by itself. No landing legs to draw, no LAND button.
- **START whenever, and only READY players play** (v1.7, the owner's 12:26 call). You are ready once your ship
  drawing and your controller are accepted. The host can press START at any time ("START · 3 READY"); whoever is
  still drawing finishes in peace and plays the next round with their drawings kept. No bots unless asked for.
- **A big, bright island** (v1.7). The planet's island is 840 m across (twice as wide, 4× the area), with a blue sky,
  vivid greens, warm sand, turquoise water and soft shadows. Explorers run 1.5× faster and the chests are spread
  across it: an expert alone opens all 16 at about 3:00-3:20.
- **ENDLESS free-for-all** (v1.6, optional, off by default). No clock: the boss and the chests come back, drawings
  recharge, you can take off and land again, and points add up until the host presses END GAME. The normal round
  stays the demo.
- **Hall of Fame** (v1.6). Every drawing of the evening (ships, explorers, controllers) ranked by AI and shown beside
  the 3D model or the controller it became. The judge is OpenAI's Decisions API with `gpt-6-luna`.
- **Sol thinks harder** (v1.7, the owner's 12:41 call: "it's ok if it takes 2-3 seconds more"). Drawing reads, ship
  and body specs and the controller page use reasoning effort `medium`, with longer timeouts to match.
- **Polish** (v1.6): the GO sound after the 3-2-1, one winner jingle, a higher chase camera so your ship is not hidden
  by its own flame, drilling animates, shots on the planet reach rivals uphill and downhill, closed car and bike
  tyres, and hints stay visible when the HUD is hidden. Round 2 no longer asks for the explorer before landing
  (v1.6.2, v1.7).
- **RESTART** (v1.6.1; on the main line from v1.8): a button on the big screen restarts the server and everyone
  rejoins from scratch. See "Restart everything" below.

### Earlier (v1.3 to v1.5)

- **Your drawing becomes a real 3D model** (v1.4). A drawn ship is read into its parts (hull, cockpit, wings, fins,
  engines and flames, weapons, colours) and built as a chunky 3D ship by `ship3d.js`, with your drawing as a hull
  sticker. A drawn astronaut, animal, car, bike or blob becomes a rigged 3D character by `entity3d.js` (a person
  walks, digs and drills with the skeleton's clips; wheels spin; blobs squash). Black-ink drawings take your player
  colour. `inflate.js` (the plush body) is the fallback and what shows while the model loads.
- **Every finished drawing ends as something usable** (v1.3, v1.5): a 3D entity with an unlock card ("Your ship can:
  fly, shoot (cannon), boost (exhaust flames)") and what to draw for each locked skill, or a plain refusal ("looks like
  a controller"). If the drawing cannot be read in time you get a plain entity that only flies or walks, and the
  drawing is not spent.
- **Full screen** (v1.4). A FULLSCREEN button; the first JOIN asks for full screen on Android and iPad. iPhone Safari
  has no full screen for web pages, so it shows a one-time "Add to Home Screen" hint: the home-screen app opens full
  screen in landscape (`controller.webmanifest`, `icons/`).
- **A real countdown** (v1.4). START on the big screen plays a 3 s countdown phase on the server: 3, 2, 1 on every
  phone and the TV, nothing moves until GO.
- **Pacing** (v1.4, the owner's 10:00 call: "most of the time on the planet"). The boss is close (400 m, about 20 s of
  cruising, 15 s with BOOST) with less life, the planet sits close behind it, and there are more chests (15 + 0.65 per
  human, at most 32). An expert lands at about 0:35, a regular player at about 1:20.
- **No free skills** (v1.4). At 3:00 nobody is handed a missing skill: a big card says what to draw ("DRAW A SHOVEL")
  and the chests glow.
- **Ruthless PvP** (v1.3): steal chest points and the boss's last hit, wreck parked ships; a spawn shield and a
  score floor keep it fair. At most 25 players, humans and bots together (bots leave first when a human joins).
- **v1.5:** first-time coach marks, the 3-2-1 and the results on the phone, a HUD show/hide button so only your
  controls show, a TV lobby hangar with every player's ship drawing, a podium, and every round starts from scratch
  (only your name, colour and stars carry over).

## Run it

Node 20+, no dependencies, no build step. three.js loads from a CDN.

```
PORT=8000 HTTPS_PORT=8443 node server.js [--bots N] [--endless]
```

- **Big screen:** open `http://<laptop-ip>:8000/space.html` on the TV or laptop (the server prints the address).
- **Phones:** scan the QR code on the big screen. It opens the HTTPS page when HTTPS is up, else the plain one.
- **OpenAI key:** put `OPENAI_API_KEY=...` in a `.env` file next to `server.js` (git-ignored), or set it in the
  environment. Never commit or print it. The same key reads the drawings (`gpt-6.1-sol`) and judges the Hall of Fame
  (`gpt-6-luna`).
- **Offline:** `ASTRA_MOCK=1 node server.js` needs no key: drawings get fixed answers and every gate skill, and the
  Hall of Fame gives mock scores marked as such.
- **Bots:** none by default (the owner, 12:26: no bots). `--bots N` adds N scripted ships, fillers for tests and
  small groups: they are always ready, a round holds at most 25 players in total, and bots leave first when a human
  joins a full room.
- **ENDLESS:** `--endless` or `ENDLESS=1` starts the server in the endless free-for-all. The ENDLESS switch in the big
  screen's lobby (or key E) turns it on and off between games. See "ENDLESS" below.
- **Sol's effort:** `OPENAI_REASONING_EFFORT` defaults to `medium` (`low` answers sooner but reads less well). Every
  timeout and switch is in "Environment variables" below.
- `--autostart S` starts every lobby after S seconds. It is for tests only; a party always starts from the big screen.
- `?perf` on any page shows fps and draw calls; `node perf-report.js --since 10m` checks every device against the budgets.

### The play servers on the host laptop

Each version the owner plays runs on its own ports from its own worktree, inside a keep-alive loop that starts the
server again whenever it exits (a crash, or RESTART on the big screen):

```
export KEEPALIVE=1                 # the server knows a loop restarts it (see "Restart everything")
cd <the version's worktree>
while true; do
  PORT=8105 HTTPS_PORT=8548 OPENAI_REASONING_EFFORT=${EFFORT:-medium} PERF_LOG=play.log.perf \
    node server.js --bots ${BOTS:-0} >> play.log 2>&1
  sleep 2
done
```

- `EFFORT` is that server's Sol effort: `medium` for v1.7 and later. Keep `low` for v1.6 and older: their drawing
  reads give up after 4 s. (The orchestrator's own loop defaults to `low` and starts v1.7 with `EFFORT=medium`.)
- `BOTS` stays 0 for a party.
- Which version runs on which ports is in each version's note in [VERSIONS.md](VERSIONS.md). On Oct 10 at 13:00:
  v1.7, the demo build, on 8105/8548; v1.6 on 8104/8547; v1.5 on 8103/8546. Never restart the demo server without the
  owner's go.

### HTTPS on or off

| | HTTPS on (default, `HTTPS_PORT=8443`) | HTTPS off (`HTTPS_PORT=0`) |
| --- | --- | --- |
| The QR opens | `https://<laptop-ip>:8443/controller.html` | `http://<laptop-ip>:8000/controller.html` |
| First visit | A certificate warning, once per phone (self-signed, made once in `.orch-certs/`). On an iPhone: "Show Details" → "visit this website" → "Visit Website" | No warning |
| Tilt to steer | Works (iPhone asks for motion access) | Not available: Safari only gives motion to HTTPS pages. The phone says "Tilt is not available on this page. Use the stick" |
| Photo of a paper drawing | Works | Works (the photo is a file picker, not a live camera) |
| Full screen / Add to Home Screen | Works | Works |

```
HTTPS_PORT=0 PORT=8000 node server.js          # quickest for a living-room game: no certificate step
```

Turn HTTPS off when the certificate step gets in the way (many phones, guests); keep it on when players want tilt.
Plain `http://<laptop-ip>:8000/controller.html` always works too, even while HTTPS is on.

## How a round plays (on your phone)

1. Scan the QR on the big screen and type your name. Tap FULLSCREEN (or, on an iPhone, add the game to your home
   screen when the hint asks).
2. **Draw your spaceship** on paper and take a photo (or draw it with your finger). It becomes your 3D ship, built
   from what you drew, and a card says what it can do: a cannon means SHOOT, flames mean BOOST.
3. **Draw your controller:** a circle to steer and a box with a word for each button (FIRE, BOOST).
4. **You're ready** once both are accepted: the phone shows READY ✓ and the big screen counts you in "START · n READY".
   The host presses **START** whenever they like: 3, 2, 1… GO on every phone and the TV. Still drawing when it starts?
   Your phone says "ROUND IN PROGRESS · FINISH YOUR DRAWINGS, YOU'RE IN THE NEXT ROUND", and your drawings wait for
   the next round.
5. Fly about 20 seconds to the boss and shoot it down with everyone else. Watch out: rivals can shoot you too.
6. When the boss dies the planet opens, close behind it. **Fly into it: your ship lands by itself.**
7. **Draw your explorer** (astronaut, car, bike, animal…) once you have landed. It becomes a 3D character. A new
   controller is optional.
8. Open chests across the island: **DIG** the buried ones (draw a shovel), **DRILL** the ones locked in rocks (draw a
   drill). +1500 each. Most of the round happens here, and the island is big: keep moving. Missing a tool at 3:00? A
   card tells you what to draw.
9. At 4:00, or when every chest is open, most points wins and gets a star on the big screen's leaderboard. After 10 s
   of results everyone is back in the lobby, and the next round starts from scratch: draw a new ship and controller.

You have 5 drawings in space and 5 on the planet each round. Draw a lightning bolt, an octopus, a magnet, spikes or a
small copy of your ship to EMP, ink, pull, mine or fool your rivals. Ink stays on your screen until you wipe it off.

**In ENDLESS** there is no clock and no last chest. The boss comes back a minute after it dies, opened chests are
replaced, and you get a drawing back every minute. On the planet the TAKE OFF button (the rocket) flies you back to
space; fly into the planet to land again. Join at any time: once your ship and controller are ready, you jump straight
in.

## For the host (the big screen)

| To | Do |
| --- | --- |
| Start a round | **START · n READY** (or ENTER). It is greyed while nobody is ready; only the ready players get in |
| Skip the podium | ENTER |
| Switch ENDLESS on or off | The **ENDLESS** switch next to START, in the lobby (or E) |
| End an ENDLESS game | **END GAME** under the timer (or ENTER twice): the results, then the lobby |
| Open the Hall of Fame | **★ HALL OF FAME**, bottom right in the lobby and the results: it opens in its own tab and starts the judging |
| Restart everything | **↻ RESTART**, tapped twice (v1.6.1; the main line from v1.8): see "Restart everything" |
| Sound on or off | M |
| Hide the host-key help | H |
| Play from the keyboard (tests) | Open `space.html?kb` |

### Hall of Fame (v1.6)

- Open `http://<laptop-ip>:8000/hall-of-fame.html`; the TV's button adds `?judge=1`, which starts the judging. The top
  3 stand on a podium, then the ranked list, in tabs for ships, explorers and controllers. Each drawing sits beside
  what it became: a 3D turntable built from its spec by `ship3d.js` or `entity3d.js`, or the controller Sol made.
- **The judge** is OpenAI's Decisions API (public beta since 6 Oct 2026,
  [guide](https://developers.openai.com/api/docs/guides/decisions)): `POST https://api.openai.com/v1/decisions` with
  `gpt-6-luna`, the only model it serves, and the drawing as an inline image. One call per drawing scores creativity,
  effort, readability and fun from 0 to 100 (the overall score is their mean) and picks a playful one-liner from 14
  fixed comments: the API chooses among given answers and writes no prose.
- **Limits:** at most 60 calls per server session (`HALL_MAX_CALLS` can only lower it), 3 at a time, 20 s each, cached
  by the drawing's hash. A drawing that cannot be judged stays in the list, unscored; "Judge the rest" tries it once
  more.
- **What it keeps:** every drawing the server accepted this session, with its spec, layout or controller page, even
  though every round starts from scratch. It lives in memory and in `hall/` (git-ignored), and is cleared when the
  server starts (so also by RESTART) or by `POST /hall/reset {"confirm": true}`.
- **Endpoints:** `GET /hall` (the ranked list and the judging progress), `POST /hall/judge` (judge every drawing not
  judged yet; safe to repeat), `GET /hall/img/<id>.png`, `GET /hall/ctrl/<id>.html`.

### ENDLESS (v1.6)

- Off by default: the round flow above is the demo. On with `node server.js --endless`, `ENDLESS=1`, or the lobby's
  ENDLESS switch (`POST /mode {"endless": true}`, lobby only); it holds for every game until it is switched off.
- While a game runs: no 4:00 clock, no 3:00 assists and no end when every chest is open. The boss comes back 60 s after
  it dies, with a 10 s warning and fresh HP for the players there now. Opened chests are replaced in new places when
  all are open (after 5 s) or every 90 s. Each world gives back 1 drawing every 60 s, up to its maximum. A LEADER
  banner shows every 3 min. Every world and tick message carries `mode: "endless"`.
- END GAME (`POST /end`) shows the usual results, then the lobby, where everyone starts from scratch.

### Restart everything (v1.6.1; the main line from v1.8)

The big screen has a small **↻ RESTART** button in the bottom left corner (lobby, play and results). Tap it, then tap
again within 4 s: "RESTART EVERYTHING? EVERYONE REJOINS · CLEARS PLAYERS AND THE HALL OF FAME". The host key is **R**
twice within 3 s (with `?kb`, where R drills, SHIFT+R). It is a server restart: every phone forgets its player and shows
JOIN ("The host restarted the game. Join again."), the big screen reloads, and the world, the session leaderboard and
the Hall of Fame start empty. ENDLESS is back to how the server was started (`--endless` or not).

How the server restarts (`POST /restart {"confirm": true}`):

- **Under a supervisor** that runs `node server.js` again whenever it exits (the keep-alive loop above, pm2,
  nodemon...), the server exits with code 0 and the supervisor starts a fresh one. Tell the server it is supervised
  with `export KEEPALIVE=1` in the loop's script, before the loop (the loop above does). Without `KEEPALIVE`, a parent
  process whose command line names keepalive / pm2 / nodemon / forever / supervisor / runsv / systemd counts too.
- **Otherwise (the default)** the server first starts a detached copy of itself with the same arguments and
  environment and waits until it has loaded (at most 10 s; a copy that cannot start, a broken file say, is a 500: the
  big screen says RESTART FAILED and nothing changes). Then it releases its ports and exits; the copy waits for it to be
  gone and retries listen until the ports are free (up to 30 s). `KEEPALIVE=0` forces this path. Ctrl-C in the old
  terminal does not reach the copy: stop it with `kill <pid>` (the server logs `RESTART: new server pid <pid>`).

The new server has a new session id (in every world message and in `GET /info`): a phone that comes back to a server
with another id forgets its player too, and a big screen reloads. The answers: 200 `{ ok, restarting, how:
"supervisor" | "respawn", session }`, 400 without `confirm: true`, 409 while a restart is under way, 500 when the copy
could not start. Every screen hears `{ "type": "restart", "session": <the old id> }` just before the streams close.

## Environment variables

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | 8000 | The HTTP port: the big screen, and the phones when HTTPS is off |
| `HTTPS_PORT` | 8443 | The HTTPS port for the phones (tilt needs it); `0` turns HTTPS off |
| `OPENAI_API_KEY` | – | The OpenAI key; else read from `.env` next to `server.js`. Set but empty means no key |
| `ASTRA_MOCK` | off | `1`: no OpenAI calls. Drawings get fixed answers, the controller is the template, the Hall of Fame scores are mock |
| `OPENAI_REASONING_EFFORT` | `medium` | Sol's effort for drawing reads and ship and body specs (`low` is quicker); `none` or empty sends none |
| `ASTRA_HTML_EFFORT` | `medium` | Sol's effort for the controller page |
| `OPENAI_SERVICE_TIER` | `ultrafast` | The service tier; `none` or empty sends none |
| `OPENAI_MODEL` | `gpt-6.1-sol` | The model is pinned: only `gpt-6.1-sol` or a dated snapshot of it is taken, anything else is ignored |
| `ASTRA_TIMEOUT_MS` | 9000 | A whole drawing read, retry included; at most 13000, so the phone (15 s) never gives up first |
| `ASTRA_HEDGE_MS` | 5000 | A read with no answer by then starts an identical second request; the first answer wins |
| `ASTRA_RETRY_BEFORE_MS` | 4000 | A failed read is retried only if it failed sooner than this |
| `ASTRA_SPEC_TIMEOUT_MS` | 14000 | The ship or body spec call (the 3D model). A late spec still reaches every screen |
| `ASTRA_SPEC_HEDGE_MS` | 8000 | The spec call's second request |
| `ASTRA_HTML_TIMEOUT_MS` | 45000 | Sol's controller page when `astra-html.js` runs on its own. The server gives each page 20 s (`CTRL_HTML_TIMEOUT_MS` in `server.js`) |
| `ASTRA_HTML_CALL_LOG` | – | A file that gets one JSON line per controller-page request |
| `ENDLESS` | off | `1` starts in ENDLESS, like `--endless` |
| `HALL_MOCK` | off | `1`: mock Hall of Fame scores, while drawings are still read for real |
| `HALL_MAX_CALLS` | 60 | Lowers the Hall of Fame's call cap per session |
| `HALL_DIR` | `hall/` | Where the Hall of Fame keeps its copy of the archive |
| `PERF_LOG` | `perf.log` | Where the phones' and the big screen's perf samples go |
| `KEEPALIVE` | – | `1`: a keep-alive loop restarts the server, so RESTART only has to exit (v1.6.1; the main line from v1.8) |

Flags: `--bots N` (0 to 25, default 0), `--endless`, `--autostart S` (tests only). Tests also read `LIVE_PORT`.

## Files

| File | What it is |
| --- | --- |
| `server.js` | The server: public files, the live event stream, join, START (ready players only) and the countdown, input, generation, the ENDLESS switch and END, the Hall of Fame archive and endpoints, perf samples |
| `https.js` | HTTPS next to HTTP with a self-signed certificate for the LAN |
| `contract.js` | The shared contract: round timings, tuning, scoring, message shapes and their checks |
| `world.js` | The authoritative game simulation at 30 Hz: the ready gate, automatic landing, the ENDLESS hooks |
| `endless.js` | ENDLESS rules (v1.6): the timers for the boss's return, the chest refresh, the drawing recharge and the LEADER banner |
| `rules.js` | The hint ladder and the drawing budget |
| `verbs.js` | Every skill, what to draw to unlock it, the button words that mean it, and the unlock card's words |
| `rigs.js` | The entity rig templates |
| `terrain.js` | The island heightmap (840 m across since v1.7) |
| `astra.js` | Reads drawings with OpenAI: controller layouts, entity types and unlocked skills |
| `astra-ship.js` | Reads a ship drawing into a ship spec (hull, wings, engines, weapons, colours per part) |
| `astra-body.js` | Reads an explorer drawing into a body spec (type, head, limbs or wheels, tools, colours) |
| `astra-html.js` | Sol writes the controller as an HTML page (with a template fallback) |
| `hall.js` | The Hall of Fame (v1.6): the archive of every drawing and the Decisions API judge (`gpt-6-luna`) |
| `anims.js` | The shared animation table |
| `render.js` | The shared three.js renderer for the phone and the big screen |
| `ship3d.js` | Builds a 3D ship from a ship spec (3 draw calls, at most about 5k triangles; lighter on the phone) |
| `entity3d.js` | Builds a rigged 3D character, animal, car, bike or blob from a body spec |
| `inflate.js` | Turns a drawing into a plush 3D body on the device (the fallback while a spec loads or when there is none) |
| `anim.js` | Procedural animation for any entity |
| `transition.js` | Landing and take-off as one continuous shot |
| `sfx.js` | Synthesized sound effects |
| `controller.html` | The phone |
| `controller.webmanifest`, `icons/` | The home-screen app (full screen, landscape) |
| `ctrl-sandbox.js` | Runs Sol's controller page in a sandboxed frame |
| `mischief-fx.js` | Mischief effects on the phone (EMP, ink, tractor, mine, decoy) |
| `phone-extras.js` | Phone HUD pieces: bars, radar, drawings counter, hint sketches |
| `space.html` | The big screen (spectator TV) |
| `bigscreen-extras.js` | Big-screen pieces: join QR, kill feed, name tags, the lobby hangar (✔ IN / ⏳ NEXT ROUND) |
| `hall-of-fame.html` | The Hall of Fame page (v1.6): podium, ranked list, each drawing beside its 3D model or controller |
| `perf-report.js` | Checks `perf.log` against the performance budgets |
| `samples/` | One sample of each message, checked against the contract |
| `controllers/` | Git-ignored: each player's last finished drawing per kind and Astra's reading of it (`<player>-<kind>.png` and `.json`), deleted at the next round for everyone who played |
| `hall/` | Git-ignored: the Hall of Fame's archive (`<id>.png`, `<id>.html` and `archive.json`), emptied when the server starts |
| `assets/` | Delivered 3D assets (`assets/<id>-<slug>/`) and reference images |
| `dev/` | Tests, harnesses and notes per track |

## Tests

Everything in one run, with one summary table (every harness that starts a server uses `ASTRA_MOCK=1`):

```
dev/v15-tests/all.sh                      # groups: unit, client, e2e, kit, tour
dev/v15-tests/all.sh --only unit,client   # the node-only groups
```

Unit suites (no browser):

```
node dev/astra/astra-test.js
node dev/astra/gen-regression-test.js
node dev/astra/vocab-test.js
node dev/astra/anim-wire-test.js
node dev/netcode/sim-test.js
LIVE_PORT=8222 node dev/netcode/live-test.js
node dev/rules/rules-test.js
node dev/inflate/astra-entity-test.js
node dev/https/test.js
```

A whole round end to end (a WebKit phone and the big screen against the real server, mock generation):

```
node dev/e2e/run.mjs --route expert --bots 24
node dev/e2e/run.mjs --route regular --bots 24
```

Add `--video` to record it. Reports go to `dev/e2e/report-<route>.json`. Since v1.7 a round starts only with a READY
player (a ship and a controller accepted), so a harness written before v1.7 must post both before START.

Newer node checks (no browser, no key):

```
node dev/v17-ready/gate-test.js                                       # v1.7: START with ready players only
ASTRA_MOCK=1 node dev/v15-fresh/fresh-test.js                         # v1.5: every round starts from scratch
node dev/netcode/balance-sim.mjs --route both --bots 24 --seeds 1-6   # pacing on the 840 m island, about 20 s
node dev/v14-pacing/crowd-sim.mjs --seeds 1-4 [--spread]              # 25 humans on the island
```

`dev/v17-island-size/README.md` has the island's before and after numbers and how to re-run them.
`dev/v16-hall/probe.js` makes 3 real Decisions API calls: run it only on purpose (`ASTRA_MOCK=1` runs its mock path).

Entity creation (every drawing type through `/generate` like a phone, then built on the TV and the phone):
`dev/v13-entity/README.md` (`--mock` needs no key).

## Where things live

- **Versions:** `VERSIONS.md` (what each version added, its checks, the owner's decisions). Git tags `v1.0` to `v1.7`;
  `v1.6.1` and `v1.6.2` are hotfixes on v1.6, on the branch `v1.6.1-work`.
- **Videos:** `videos/<version>/` on the host laptop (git-ignored).
- **QA reports (Codex):** `dev/v14-qa/FINDINGS.md` (v1.3), `dev/v14-test/FINDINGS.md` (v1.4),
  `dev/v17-test/FINDINGS.md` (v1.7, from 12:53 on Oct 10).
- **Testing channel:** `TESTING.md`, shared with the end-to-end tester.
- **3D assets:** `ORCHESTRATE.md` is the channel with the asset model (requests, deliveries, the asset contract);
  deliveries land in `assets/`.
