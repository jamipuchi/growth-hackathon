# Space Party

A party game for up to 25 players: a big screen everyone watches, and each player's own phone.
Every player draws a spaceship (later an astronaut, car, bike or animal) that becomes a 3D object whose skills come
only from what is drawn on it, and a controller whose drawn buttons become the phone's controls. Rounds last at most 4:00; most points wins.

- The spec: [PLAN.md](PLAN.md). Section 0 holds the owner's decisions and wins over everything else.
- Every playable version, its checks and videos: [VERSIONS.md](VERSIONS.md).

## What's new (v1.3 to v1.5)

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
  cruising, 15 s with BOOST) with less life, the planet sits close behind it, and there are more chests, spread wider
  (15 + 0.65 per human, at most 32). An expert lands at about 0:35-0:45, a regular player at about 1:20.
- **No free skills** (v1.4). At 3:00 nobody is handed a missing skill: a big card says what to draw ("DRAW A SHOVEL")
  and the chests glow.
- **Ruthless PvP** (v1.3): steal chest points and the boss's last hit, wreck parked ships; a spawn shield and a
  score floor keep it fair. At most 25 players, humans and bots together (bots leave first when a human joins).
- **v1.5 (in progress):** first-time coach marks, results and the 3-2-1 on the phone, a TV lobby hangar with every
  player's ship drawing, a podium. See [VERSIONS.md](VERSIONS.md).

## Run it

Node 20+, no dependencies, no build step. three.js loads from a CDN.

```
PORT=8000 HTTPS_PORT=8443 node server.js [--bots N]
```

- **Big screen:** open `http://<laptop-ip>:8000/space.html` on the TV or laptop (the server prints the address).
- **Phones:** scan the QR code on the big screen. It opens the HTTPS page when HTTPS is up, else the plain one.
- **OpenAI key:** put `OPENAI_API_KEY=...` in a `.env` file next to `server.js` (git-ignored), or set it in the
  environment. Never commit or print it.
- **Offline:** `ASTRA_MOCK=1 node server.js` needs no key: drawings get fixed answers and every gate skill.
- `--bots N` adds N scripted ships (fillers for tests and small groups; a round holds at most 25 players in total).
- `?perf` on any page shows fps and draw calls; `node perf-report.js --since 10m` checks every device against the budgets.

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
   from what you drew, and a card says what it can do: a cannon means SHOOT, flames mean BOOST, landing legs mean LAND.
3. **Draw your controller:** a circle to steer and a box with a word for each button (FIRE, BOOST, LAND).
4. Wait for the host to press **START** on the big screen. 3, 2, 1… GO on every phone and the TV.
5. Fly about 20 seconds to the boss and shoot it down with everyone else. Watch out: rivals can shoot you too.
6. When the boss dies the planet opens, close behind it. Fly close and press **LAND**.
7. **Draw your explorer** (astronaut, car, bike, animal…). It becomes a 3D character. A new controller is optional.
8. Open chests: **DIG** the buried ones (draw a shovel), **DRILL** the ones locked in rocks (draw a drill). +1500 each.
   Most of the round happens here. Missing a tool at 3:00? A card tells you what to draw.
9. At 4:00, or when every chest is open, most points wins and gets a star on the big screen's leaderboard.

You have 5 drawings in space and 5 on the planet each round. Draw a lightning bolt, an octopus, a magnet, spikes or a
small copy of your ship to EMP, ink, pull, mine or fool your rivals. Ink stays on your screen until you wipe it off.

## Files

| File | What it is |
| --- | --- |
| `server.js` | The server: public files, the live event stream, join, START and the countdown, input, generation, perf samples |
| `https.js` | HTTPS next to HTTP with a self-signed certificate for the LAN |
| `contract.js` | The shared contract: round timings, tuning, scoring, message shapes and their checks |
| `world.js` | The authoritative game simulation at 30 Hz |
| `rules.js` | The hint ladder and the drawing budget |
| `verbs.js` | Every skill, what to draw to unlock it, the button words that mean it, and the unlock card's words |
| `rigs.js` | The entity rig templates |
| `terrain.js` | The island heightmap |
| `astra.js` | Reads drawings with OpenAI: controller layouts, entity types and unlocked skills |
| `astra-ship.js` | Reads a ship drawing into a ship spec (hull, wings, engines, weapons, colours per part) |
| `astra-body.js` | Reads an explorer drawing into a body spec (type, head, limbs or wheels, tools, colours) |
| `astra-html.js` | Sol writes the controller as an HTML page (with a template fallback) |
| `anims.js` | The shared animation table |
| `render.js` | The shared three.js renderer for the phone and the big screen |
| `ship3d.js` | Builds a 3D ship from a ship spec (3 draw calls, at most about 5k triangles) |
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
| `bigscreen-extras.js` | Big-screen pieces: join QR, kill feed, name tags |
| `perf-report.js` | Checks `perf.log` against the performance budgets |
| `samples/` | One sample of each message, checked against the contract |
| `controllers/` | Git-ignored: each player's last finished drawing per kind and Astra's reading of it (`<player>-<kind>.png` and `.json`) |
| `assets/` | Delivered 3D assets (`assets/<id>-<slug>/`) and reference images |
| `dev/` | Tests, harnesses and notes per track |

## Tests

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

Add `--video` to record it. Reports go to `dev/e2e/report-<route>.json`.

Entity creation (every drawing type through `/generate` like a phone, then built on the TV and the phone):
`dev/v13-entity/README.md` (`--mock` needs no key).

## Where things live

- **Versions:** `VERSIONS.md` (what each version added, its checks, the owner's decisions). Git tags `v1.0` to `v1.4`.
- **Videos:** `videos/<version>/` on the host laptop (git-ignored).
- **Testing channel:** `TESTING.md`, shared with the end-to-end tester.
- **3D assets:** `ORCHESTRATE.md` is the channel with the asset model (requests, deliveries, the asset contract);
  deliveries land in `assets/`.
