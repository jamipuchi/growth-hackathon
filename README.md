# Space Party

A party game for up to 25 players: a big screen everyone watches, and each player's own phone.
Every player draws a spaceship (later an astronaut, car, bike or animal) that becomes a 3D object whose skills come
only from what is drawn on it, and a controller whose drawn buttons become the phone's controls. Rounds last at most 4:00; most points wins.

- The spec: [PLAN.md](PLAN.md). Section 0 holds the owner's decisions and wins over everything else.
- Every playable version, its checks and videos: [VERSIONS.md](VERSIONS.md).

## Run it

Node 20+, no dependencies, no build step. three.js loads from a CDN.

```
PORT=8000 HTTPS_PORT=8443 node server.js [--bots N]
```

- **Big screen:** open `http://<laptop-ip>:8000/space.html` on the TV or laptop (the server prints the address).
- **Phones:** scan the QR code on the big screen, or open `https://<laptop-ip>:8443/controller.html`.
  - HTTPS uses a self-signed certificate (made once in `.orch-certs/`; tilt and the camera need HTTPS). On an
    iPhone, tap "Show Details" → "visit this website" → "Visit Website" once.
  - Plain `http://<laptop-ip>:8000/controller.html` also works, without tilt or the camera.
- **OpenAI key:** put `OPENAI_API_KEY=...` in a `.env` file next to `server.js` (git-ignored), or set it in the
  environment. Never commit or print it.
- **Offline:** `ASTRA_MOCK=1 node server.js` needs no key: drawings get fixed answers and every gate skill.
- `--bots N` adds N scripted ships (fillers for tests and small groups). `HTTPS_PORT=0` turns HTTPS off.
- `?perf` on any page shows fps and draw calls; `node perf-report.js --since 10m` checks every device against the budgets.

## How a round plays (on your phone)

1. Scan the QR on the big screen and type your name.
2. **Draw your spaceship** on paper and take a photo (or draw it with your finger). It becomes your 3D ship, and a
   card says what it can do: a cannon means SHOOT, flames mean BOOST, landing legs mean LAND.
3. **Draw your controller:** a circle to steer and a box with a word for each button (FIRE, BOOST, LAND).
4. Wait for the host to press **START** on the big screen.
5. Fly about a minute to the boss and shoot it down with everyone else. Watch out: rivals can shoot you too.
6. When the boss dies the planet opens. Fly close and press **LAND**.
7. **Draw your explorer** (astronaut, car, bike, animal…). A new controller is optional.
8. Open chests: **DIG** the buried ones (draw a shovel), **DRILL** the ones locked in rocks (draw a drill). +1500 each.
9. At 4:00, or when every chest is open, most points wins and gets a star on the big screen's leaderboard.

You have 5 drawings in space and 5 on the planet each round. Draw a lightning bolt, an octopus, a magnet, spikes or a
small copy of your ship to EMP, ink, pull, mine or fool your rivals.

## Files

| File | What it is |
| --- | --- |
| `server.js` | The server: public files, the live event stream, join, START, input, generation, perf samples |
| `https.js` | HTTPS next to HTTP with a self-signed certificate for the LAN |
| `contract.js` | The shared contract: round timings, tuning, scoring, message shapes and their checks |
| `world.js` | The authoritative game simulation at 30 Hz |
| `rules.js` | The hint ladder and the drawing budget |
| `verbs.js` | Every skill, what to draw to unlock it, and the button words that mean it |
| `rigs.js` | The entity rig templates |
| `terrain.js` | The island heightmap |
| `astra.js` | Reads drawings with OpenAI: controller layouts, entity types and unlocked skills |
| `astra-html.js` | Sol writes the controller as an HTML page (with a template fallback) |
| `anims.js` | The shared animation table |
| `render.js` | The shared three.js renderer for the phone and the big screen |
| `inflate.js` | Turns a drawing into a plush 3D body on the device |
| `anim.js` | Procedural animation for any entity |
| `transition.js` | Landing and take-off as one continuous shot |
| `sfx.js` | Synthesized sound effects |
| `controller.html` | The phone |
| `ctrl-sandbox.js` | Runs Sol's controller page in a sandboxed frame |
| `mischief-fx.js` | Mischief effects on the phone (EMP, ink, tractor, mine, decoy) |
| `phone-extras.js` | Phone HUD pieces: bars, radar, drawings counter, hint sketches |
| `space.html` | The big screen (spectator TV) |
| `bigscreen-extras.js` | Big-screen pieces: join QR, kill feed, name tags |
| `perf-report.js` | Checks `perf.log` against the performance budgets |
| `samples/` | One sample of each message, checked against the contract |
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

## Where things live

- **Versions:** `VERSIONS.md` (what each version added, its checks, decisions taken overnight). Git tags `v1.0`, `v1.2`.
- **Videos:** `videos/<version>/` on the host laptop (git-ignored).
- **Testing channel:** `TESTING.md`, shared with the end-to-end tester.
- **3D assets:** `ORCHESTRATE.md` is the channel with the asset model (requests, deliveries, the asset contract);
  deliveries land in `assets/`.
