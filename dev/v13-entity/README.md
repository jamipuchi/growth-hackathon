# v1.3 entity kit: does drawing an entity work?

Owner, 10 Oct 08:55: "make sure the character / entity creation works asap". This kit proves it end to end, for every
entity type, the way a phone does it, against the real server, then builds every drawn entity on the TV and the phone.
Built in the implement-only round; brought up to v1.4 (ship3d.js / entity3d.js) and run in the v15 test round
(`--mock`, 10 Oct 11:01: 681/699 checks, 1 hard failure = a real ship3d.js lite budget overshoot, 23 s; see
dev/v15-tests/notes-tours.md).

## v1.4: drawn ships and explorers become 3D models built from their parts

Since v1.4 a ship entity carries `entity.spec` (astra-ship.js: hull, wings, engines...) and an explorer entity a body spec
(astra-body.js: type, head, limbs, items...). render.js builds a ship with a spec with ship3d.js and an explorer whose body
spec has its type with entity3d.js (DrawnCache and `createEntityPreview(...).show()` → `{ ok, triangles, ms, ship3d, entity3d }`);
inflate.js stays the fallback. Under `ASTRA_MOCK=1` there is no model spec, so astra.js makes one from the entity's own parts
(`fromEntity`, `source: "entity"`). The kit now checks, per drawing:
- HTTP: **ship / body spec on the answer** (a body spec of the answer's type), **spec served at /ship-spec?v=<hash>**,
  **entity message on the phone / TV stream carries the spec**, the lander's **parked ship carries its ship spec**
  (`island.parked[].spec`), **late TV stream has <id>'s spec** (`world.entities[].spec`).
- Browsers (TV quality big, phone lite): the spec **built by ship3d.js / entity3d.js** directly (the same module instances as
  render.js), its **triangles within the budget** (their own Q: lite 2.6k, phone 4k, big 5k, + 400 slack), **draw calls**
  (hard ≤ 12, soft ≤ 3 = their contract), **scale** (ship 3.2 m ± 20% longest horizontal side; person 1.8 m ± 10% tall plus up to
  0.5 m of head gear: entity3d.js puts the scan antenna on the head; car 4.0 ± 15%; bike 2.0 ± 20%; animal 1.3-2.3 m ± 10%;
  blob 1.4 ± 25%), soft **build time**; and **preview card builds it with ship3d.js / entity3d.js** (the phone's result card:
  `show({ image, kind, color })` with no spec, so render.js finds it by the drawing's hash: entity messages, else GET
  /ship-spec). For an explorer shown as another type than its body spec (in `--mock` every explorer is the dev kit's person,
  but the browsers build each drawing as its expected car / bike / animal / blob) that check is n/a: inflate.js is the
  acceptable fallback there. Soft: **tv game (DrawnCache) built it with ship3d.js / entity3d.js** (`game._internals.drawn`;
  n/a when the TV game has not built that model).
- The inflate.js checks are unchanged (it is still the fallback and what shows while a spec loads).
- Replay mode caveat: server.cjs answers OpenAI by image only, so the v1.4 spec calls (`text.format.name` ship_spec /
  body_spec) get the recorded ENTITY answer of that image, normalised into a spec labelled `source: "model"`. Use `--mock` for
  the v1.4 spec path until server.cjs answers spec requests on their own (e.g. 599, which makes astra.js fall back to
  `fromEntity`).
- WebKit is pinned to webkit-2311 when it exists (as dev/v11-client/lib.mjs: webkit-2368 hangs playwright-core 1.58.2).

## Run

```
node dev/v13-entity/run.mjs --mock --port 8497   # the v15 test round's run: ASTRA_MOCK=1, about 25 s
node dev/v13-entity/run.mjs                      # replay (default): no network, no key, about 1 min
node dev/v13-entity/run.mjs --mock               # ASTRA_MOCK=1: Astra's offline dev kit for every drawing
node dev/v13-entity/run.mjs --real 20            # the real gpt-6.1-sol for at most 20 HTTP requests, the rest replayed
node dev/v13-entity/run.mjs --no-browser         # the HTTP checks only, about 15 s
node dev/v13-entity/run.mjs --only ship-gun-flames,car-cannon --port 8275 --headed
```

- `--port P` (default 8274): the kit starts and stops its own server on that port; it refuses a busy port.
- Exit code: 0 = every hard check passed; 1 = a hard check failed; 2 = bad arguments; 3 = the setup failed (port busy,
  server or browsers did not start).
- Expected runtime on the laptop: replay or mock about 1 minute (HTTP phase about 15 s, of which 3 s is the landing
  shot; browsers about 45 s), well under 3 minutes. `--real` adds about 2 to 4 s per drawing (14 posts, 13 distinct images,
  one model call each: the finished post is answered from Astra's cache after the speculative one).
- Needs: Node 20+, playwright-core at `PW_CORE` (default `/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core`,
  as dev/e2e/run.mjs), Chromium and WebKit from `~/Library/Caches/ms-playwright` (or `E2E_CHROME` / `E2E_WEBKIT`), and
  network for three.js from cdn.jsdelivr.net (the pages load it). Nothing is installed.
- Laptop safety: one server (its own port, killed by PID at the end, and it exits by itself if run.mjs dies:
  `V13_EXIT_WITH_PARENT`), one Chromium, one WebKit, a 6-minute watchdog. Run it as the only browser job.

## Outputs

- `dev/v13-entity/report.json`: per drawing every check (`ok` true / false / null = not applicable in this mode,
  `level` hard / soft, `detail`), the answers (type, rig, source, verbs, unlocked, parts, card, image, ms), where the
  model answer came from (`model`: replayed / scripted / real / cache / mock), the numbers on each screen, the shots;
  plus the late-joiner results, the planet hook's answer, the model call log and a `summary`.
- `dev/v13-entity/shots/<id>-tv.png` (Chromium 1440x900) and `<id>-phone.png` (WebKit 844x390, rendered at DPR 3, saved at CSS size): each drawn
  entity built by inflate.js and turning in render.js `createEntityPreview` (the phone's result card), titled with its
  type and unlock card. Also `tv-game.png` (space.html after all the drawings) and `phone-join.png`.
- `dev/v13-entity/out/` (scratch): `server.log`, `perf.log`, Astra's drawing copies (`controllers/`), the posted PNGs
  (`drawings/`).

## Modes

| Mode | What answers the drawing | What it proves |
| --- | --- | --- |
| replay (default) | `server.cjs` replaces `fetch` for `https://api.openai.com/` with the **real gpt-6.1-sol answers recorded for these exact images** (dev/gen-corpus/fixtures, keyed by sha1 of the data URL, as dev/astra/fake-openai.cjs). The generated scribble gets a scripted answer ("nothing"). A dummy key is set, so Astra never reads the .env | Everything after the model is the real code: Astra's parsing and wiring, the card, server.js (budget, fallback, drawing URLs), world.js, the event stream, render.js and inflate.js. Deterministic, offline |
| `--mock` | `ASTRA_MOCK=1`: Astra's dev kit for every entity (ship or person, every gate skill) | The pipeline without any model reading. Type, refusal and "plain unlocks nothing" checks are `n/a`; the browsers still build each drawing as its expected type |
| `--real N` | the real API for at most N HTTP requests (hedges and retries count), then replay | The model reads our drawings today. Checks are "generous": the drawn gate skills must be unlocked, extra skills are fine; a plain drawing unlocking something and an accepted scribble are soft |

Why replay is the default and not `ASTRA_MOCK=1`: the mock answers every drawing with the dev kit, so it can never show
a car, a refusal or a wrong skill. Replay runs the same real code with no network and no key; `--mock` is still there.

## The drawings (`drawings.mjs`)

| id | kind | posted | expected |
| --- | --- | --- | --- |
| ship-gun-flames (corpus E04) | ship | lobby | ship; shoot (cannon), boost (flames) |
| ship-plain (E01) | ship | lobby | ship; nothing unlocked: "Your ship can: fly" |
| ship-landing-legs (E05) | ship | lobby | ship; land |
| ship-lands (E05 again, player `klander`) | ship | lobby, then lands | ship; land; it lands with its own drawn LAND (no help) and the parked ship on the pad shows its drawing |
| ship-photo (E13, a photo of paper) | ship | lobby | ship; shoot, boost |
| ship-wrong-controller (W09) | ship | lobby | refused "looks like a controller" in plain words; then "Use it anyway" gives a ship |
| ship-scribble (generated, seeded) | ship | lobby | refused "nothing to read" in plain words (real model: a plain entity is fine too) |
| astronaut-shovel (E17) | explorer | planet | person; dig |
| astronaut-drill (E18) | explorer | planet | person; drill |
| car-cannon (E23) | explorer | planet | car; shoot |
| bike-lamp (E26) | explorer | planet | bike; flare |
| dog-claws (E28) | explorer | planet | quadruped; dig |
| blob (E29) | explorer | planet | blob; nothing unlocked |
| explorer-wrong-controller (W11) | explorer | planet | refused "looks like a controller"; then "Use it anyway" gives a planet entity |

Every PNG but the scribble is reused from the committed generation corpus (dev/gen-corpus/entity, wrong). The recorded
answers for all 12 corpus images were read before shipping the kit: each one satisfies its row above. `node
dev/v13-entity/drawings.mjs --write` writes all 14 to `dev/v13-entity/drawings/` to look at them. Each drawing is posted by its own player (`kshipgun`,
`kcar`, ...), so every player has exactly one drawn entity.

## What each check means

Per drawing (HTTP, like a phone: `POST /join {player, device}`, its own `GET /events?player=<name>` stream, and a TV stream
`?screen=big`):

1. **speculative call answered / spends nothing / sends no entity message**: the phone's speculative `/generate`
   (`speculative: true`) answers, `drawingsLeft` does not move, no `entity` message goes out.
2. Finished `/generate` that should give an entity:
   - **answer is an entity**, **type** (one of the expected), **rig** (= `Verbs.RIG_OF[type]`), **moves by itself**
     (`Verbs.INNATE[type]` in `verbs`, no jump for car / bike), **unlocked skills are live skills of this world**
     (each `{verb, part}` is in `Verbs.SKILLS[world]` and in `verbs`), **parts** (names, x / y in 0..1).
   - **drawn skills unlocked (generous)**: the drawing's gate skills (the table above) are all in `unlocked`; extras are
     fine. **a plain drawing unlocks nothing** (hard in replay, soft with a real model, n/a in mock).
   - **unlock card in plain words**: a string of at most 200 characters, `Your <ship|explorer|car|bike|animal> can: ...`,
     starting with the type's plain card (`Verbs.cardOf(type, [])`, e.g. "Your ship can: fly"), no internal names or code;
     **card names every drawn skill** (each gate skill's word); soft: **card = Verbs.cardOf(type, unlocked)**.
   - **answered by the model, not a fallback**: `source: "model"` and no `fallback: true` (mock: `source: "devkit"`);
     **model answer available**: the server's call log has a successful answer for this image (replay: recorded or
     scripted, never "missing").
   - **one drawing spent**: `drawingsLeft[space]` for a ship, `[planet]` for an explorer, down by exactly 1.
   - **image URL on the answer**: `/drawings/<player>-<ship|explorer>.png?v=<hash>`; **image served**: that URL
     answers `image/png` with exactly the posted bytes.
   - **entity message on the phone stream / on the TV stream**: an `entity` message for the player with that image,
     the same type, card and verbs, within 3 s of the post.
   - soft: **animations wired** (`entity.anims` has slots).
3. Finished `/generate` that should be refused (a controller in the ship or explorer step; the scribble):
   **refused** (`ok: false`), **refusal reason** (`error` / `looksLike`), **refusal in plain words** (`message`: a
   sentence of at most 140 characters, no internal names, matching "looks like a controller" or "bigger / darker"),
   **a refusal spends nothing**, **a refusal sends no entity message**; then **use it anyway** (`anyway: true`): every
   entity check above, labelled "use it anyway".
4. **players landed on the planet (test hook)**: before the explorers, `POST /__test/planet` puts their players on the
   planet (see below); explorers are posted there, so `where` is planet and they spend planet drawings. In the same call
   the `ship-lands` player lands: **drawn landing legs land the ship (LAND, no help)** (it was not given a kit ship) and
   **parked ship shows its drawing (TV stream)** (a world message whose `island.parked[]` entry for it carries its ship
   drawing URL).
5. **late TV stream has <id>**: a TV stream opened after all the drawings gets every entity, with its image and type, in
   `world.entities` (for `ship-lands`: its parked ship with the drawing, and a planet entity). **late TV (space.html) has
   <id>**: the same through the real big screen in Chromium (`window.__game.entityOf(name)`; `ship-lands` is not rebuilt
   in the browsers: same drawing as ship-landing-legs).

Per drawn entity, on each screen (TV = Chromium, quality "big"; phone = WebKit iPhone, quality "lite" = the phone's game
view, render.js DrawnCache):
- **built by inflate.js**: `inflateDrawing(loadDrawing(<served URL>), { kind: <server type>, quality })` works.
- **preview card shows it as a <type>**: render.js `createEntityPreview(...).show({ image, kind, color })` answers
  `ok: true` with that kind (inflate.js silently falls back to a ship for an unknown kind).
- **triangles within the budget** (inflate.js: lite 2.6k, phone 4k, big 12k, + 400 for wheels), **draw calls** (one
  render of the body alone: hard at most 12, soft target at most 4).
- **scale**: the bounding box in metres vs what the game expects (inflate.js KIND = render.js entSize): ship 3.2 m
  (longest of x, z: it lies flat), person 1.8 m tall (y), car 4.0, bike 2.0, quadruped 2.0, blob 1.4 (longest of
  z, y: side views), within 10 % (person) to 25 % (blob).
- soft: **build time** at most 150 ms on the TV, 250 ms on the phone (PLAN.md section 6: about 100 ms on the device);
  reported with the load ms and inflate.js's own ms.

Global: **server runs in the requested mode**, **join <player>**, **drawing budget readable** (per drawing: `/__test/state`
has the player's `drawingsLeft`), **TV page exposes window.__game.entityOf**, **no page errors** (hard) and **no console
errors** (soft) on both pages, `--real`: **at most N real requests** and **the real model was called**; `--mock`: **no model
calls**.

## The test server (`server.cjs`)

`node dev/v13-entity/server.cjs` (run.mjs starts it with `PORT`, `V13_MODE`, `V13_REAL_MAX`, `V13_EXIT_WITH_PARENT=1`)
requires the real `server.js` in-process, unchanged, with `HTTPS_PORT=0`, after: the fetch replay above, Astra's drawing
copies redirected to `out/controllers`, `Contract.ROUND` stretched (assists at 25:00, cap at 30:00: the 3:00 assists would
add gate skills to every entity, the 4:00 cap would send the explorers back to space), and the world captured from
`world.createWorld`. Hooks:

- `GET /__test/info`, `GET /__test/state` (phase, boss, planet, each player's mode, drawingsLeft and live entity),
  `GET /__test/calls` (the model call log: real / replayed / scripted / missing, by image sha1).
- `POST /__test/script { answers: { <sha1 of the data URL>: <model answer> } }`: scripted answers for generated drawings.
- `POST /__test/planet { players, timeoutMs }`: START (if in the lobby); the boss's last hit by a helper ship
  `kithelper` (dev kit, boss left with 1 HP, re-aimed every 100 ms); for each player a LAND-capable ship if theirs cannot
  land (the dev kit through `world.setEntity`: the reason ship drawings use other players), a spot 10 m off the planet
  and LAND pressed through `world.handleInput`; it answers when all of them touched down (`mode: "planet"`).

## Hooks and fields the in-flight v1.3 tracks might rename (reconcile in the test round)

- **render.js**: `createEntityPreview({ canvas, quality })` and `show()` → `{ ok, triangles, ms, kind, wheels }`;
  `game.entityOf(name)` (an entity, or a message with `.entity`: both handled); render.js, inflate.js and three are loaded in the pages by an injected `<script type="module">` (`/render.js`, `/inflate.js`, `three` through the page import map: the same module instances as the page).
- **space.html**: `window.__game` (the TV's game). controller.html is only loaded (its import map and `/render.js`); no
  `__spTest` hook is used.
- **inflate.js**: `inflateDrawing(img, { kind, quality, color })` → `{ object3d, triangles, ms, wheels, sockets, size,
  dispose }`, `loadDrawing(url, { fresh })`, the quality names `big` / `phone` / `lite` and the KIND sizes (EXPECTED_M in
  run.mjs mirrors them).
- **world.js** (hooks only): `createWorld` (wrapped to capture the world), `world.debug()` (`boss.pos/hp/radius/dead`,
  `planet`), `world.players[name]` (`pos`, `vel`, `vy`, `yaw`, `pitch`, `hp`, `dead`, `mode`, `landingFor`,
  `entity.verbs`), `start()`, `join()`, `setEntity()`, `handleInput()`, `drawingsLeft()`, `phase`, `round`; LAND within
  `planet.radius + landRange`; touchdown after `TUNING.planet.landingSeconds`.
- **astra.js**: `_internals.setDir`; the request carries the image as `input[].content[] { type: "input_image",
  image_url }`; the answer is read from `output[].content[] { type: "output_text" }` (the recordings follow both). If the
  entity schema changes (new required fields), the recordings still parse as long as `looksLike / type / parts / verbs /
  unlocked` keep their meaning.
- **server.js**: `/generate` answers (`ok`, `entity`, `drawingsLeft`, `message`, `looksLike`, `fallback`), the plain
  refusal texts ("This looks like a controller. ...", "We couldn't see a drawing. Draw your ship bigger and darker."),
  `/drawings/<player>-<kind>.png?v=<hash>`, `entity.card`, world `entities` on connect.
- **verbs.js**: `cardOf`, `labelOf`, `RIG_OF`, `INNATE`, `SKILLS`, `PLANET_TYPES`.
