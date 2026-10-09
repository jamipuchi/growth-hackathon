# Space Party: multiplayer game plan

**Goal:** a multiplayer 3D game where every player **draws their own phone controller**, and later their own ship and character. Drawings turn into real gameplay. Everyone plays together on a big screen and on their own phone.

**How to use this doc:** it is the full spec for **one agent building the whole game from an empty folder**. Follow the build order in section 7. Each step ends with a check that must pass before you go on.

**Generation:** a fast **OpenAI vision model**, called from the server. It turns each drawing or photo into a button layout (controller) or a 3D model plus abilities (entity). Calls run in parallel. The key is read from the `OPENAI_API_KEY` environment variable and is never committed.

---

## 1. Components

Everything runs from one Node server, `node server.js`, on port 8000. Phones join over the LAN at `http://<laptop-ip>:8000`.

| File | Responsibility |
| --- | --- |
| `server.js` | Serves static files. Runs the live event stream to all screens (`GET /events`), receives phone input (`POST /input`), and receives drawings and photos for generation (`POST /generate`) |
| `world.js` | The authoritative game simulation at 30 Hz: flight physics, rocks, boss, planet, island, combat and scoring |
| `verbs.js` | The ability vocabulary: every verb with its settings ranges, shared by the server and the browser |
| `terrain.js` | The island heightmap, shared by the server (physics) and the browser (rendering) |
| `generate.js` | OpenAI calls: drawing or photo in, checked controller or entity JSON out |
| `render.js` | Shared three.js renderer used by the phone and the big screen |
| `controller.html` | Phone: join, draw or photograph a controller or entity, play with your own 3D view |
| `space.html` | Big screen: spectator view, HUD, minimap, scoreboard |
| `controllers/<player>-<kind>.png/.json` | Each player's drawings and their generated layouts and entities |

**Flow:** the player draws on the phone. The server sends the image to the OpenAI model and writes the resulting `.json`. The phone and the game pick it up right away.

---

## 2. Decisions taken

- three.js for all 3D rendering.
- **Generation uses the OpenAI API**: a fast vision model, called in parallel, with JSON-only output checked against our own format. One request per drawing.
- The game goal is a treasure chain: **nebula boss rock → planet landing → island treasure**. See section 4.

---

## 3. Architecture

```
 phones (controller.html)            big screen (space.html)
  ├─ drawn controller overlay          └─ spectator camera + HUD + minimap
  ├─ own 3D view (chase / cockpit)
  └─ input: buttons, sticks, tilt
            │  POST /input                   ▲ live event stream
            ▼                                │
        server.js ── world.js (authoritative simulation, 30 Hz)
                     verbs.js (ability engine), terrain.js (island)
```

**The server owns the game.** Every screen, the big one and each phone, only renders what the server sends. That's what lets each phone show its own view.

### Messages (contract, written in step 1)

Phone to server, `POST /input`:
- `{type:"input", player, action, down}`: buttons. `action` is a movement name or an ability verb.
- `{type:"axis", player, axis:"steer"|"move", x, y}`: analog sticks and tilt, each from -1 to 1, sent at most 20 times a second.

Server to every screen, over the event stream:
- `world`: rocks (id, position, size, type, health), nebula, boss and decoys, planet, island seed, chests. Sent on connect and whenever any of it changes.
- `tick`: 15 times a second. Players (position, yaw, pitch, roll, health, mode `space`/`planet`, status flags, score), bullets, boss shots, flares.
- `fx`: explosions, sparks, blasts. `announce`: kill feed, treasure found, win. `toast`: a message to one player ("Draw a LAND button!").
- `entity`: a player's generated ship or person (step 9).

### Generation (`POST /generate`)
- The phone sends `{player, kind: "controller"|"ship"|"person", image}`. The image is a drawing or a photo.
- The server saves the image, calls the model and checks the result. Then it writes `controllers/<player>-<kind>.json` and broadcasts `{type:"generated", player, kind}`.
- An entity and its controller can be generated **at the same time**.
- Only verbs from `verbs.js` are accepted, values are clamped to their ranges, and the number of shapes is capped.
- If generation fails, the phone keeps its old layout and shows "try again".

### Controller layout v2 (returned by the model)
```json
{ "buttons": [
  { "action": "fire", "x": 0.6, "y": 0.3, "w": 0.2, "h": 0.15 },
  { "type": "stick", "action": "steer", "x": 0.05, "y": 0.4, "w": 0.3, "h": 0.4 }
] }
```
- A `type:"stick"` entry is a real analog joystick: it sends `axis` messages while dragged.
- Tilt steering is a phone toggle that sends `steer` axes from the motion sensors. It needs HTTPS.

---

## 4. Game design

### World
- **Open world, with no fixed direction of travel.**
- The space sphere is about 700 units across, with about 200 rocks.
- Every rock has a **random type with its own health and ability**:

| Type | Health | Ability |
| --- | --- | --- |
| Stone | 1 | none |
| Iron | 4 | tough |
| Volatile | 1 | explodes and damages ships nearby |
| Crystal | 2 | +50 points and heals the player |
| Magnet | 3 | pulls ships in |
| Splitter | 2 | breaks into 2 stones |

### Treasure chain
1. **Dark nebula.** It hides the **boss rock** among 4 identical decoys. Inside, you can barely see and the radar is jammed.
   - Draw **FLARE** to light it up.
   - Draw **SCAN** to reveal which rock is the real boss.
2. **Boss rock** (the "super final boss"). It is armoured, and lasers bounce off.
   - Draw **DRILL** and hold it close to crack the armour. Several players can drill at once.
   - Then shoot it down. The boss fires back at the nearest ship.
   - Decoys also need drilling, but they turn out empty, which wastes your time.
3. **Planet appears.** Fly close and press **LAND**, which you must have drawn.
   - On landing, the phone asks you to **draw your explorer**, the second entity.
4. **Island.** A hyper-realistic island: sky, ocean and terrain.
   - Chests sit on the surface, and some are buried, which needs **DIG**.
   - First to collect wins the round, and the treasures respawn.

### Scoring
| Event | Points |
| --- | --- |
| Rock destroyed | +10 |
| Crystal rock | +50 |
| Boss destroyed (last hit) | +1000 |
| Chest found | +300 |
| Kill another player (PvP) | +200, victim −50 |
| Hit by a rock | −30 |

### Views
- **Phone:** your own ship, with a toggle between third-person chase and a first-person cockpit with a big window and gauges.
  - The drawn controller sits on top, semi-transparent.
  - The **radar** sits bottom-right and points at the current objective.
- **Big screen:** a cinematic spectator camera following the action, with a minimap, scoreboard, kill feed and objective.

### Graphics target: hyper-realistic
- Bloom and film-style tone mapping, image-based lighting for reflections.
- Rocks with displaced shapes, a planet with an atmosphere, nebula volumes.
- Island: three.js Sky and Water add-ons, shadows, height-coloured terrain, many trees.

---

## 5. Abilities: one list of verbs that scales

Every button maps to a **verb**, and the engine implements each verb once with settings. A drawn **entity** gets abilities from what is drawn on it: gun → shoot, shovel → dig, car → drive, wings → fly. Pressing a verb your entity lacks shows "Draw it!".

| Verb | Where | From drawings like |
| --- | --- | --- |
| shoot | both | guns, lasers, bows |
| boost | both | engines, rockets, wheels |
| shield | both | shields, bubbles |
| blast | both | bombs, the word WIN |
| invisible | both | cloaks, ghosts |
| shapeshift | both | masks, chameleons (disguise) |
| teleport | both | portals, wands |
| heal | both | red crosses, potions |
| jump | planet (dash in space) | legs, springs |
| land / takeoff | space / planet | landing gear / rockets |
| scan | both | radars, antennas, eyes |
| flare | both | lights, torches |
| drill | space | drills, saws |
| dig | planet | shovels, claws |
| drive | planet | cars, bikes |
| fly | planet | wings, jetpacks |
| swim | planet | fins, boats |
| grapple | both | hooks, ropes, magnets |

Movement is always available: arrows, sticks and tilt mean turn, pitch, thrust, strafe and rise.
- Default ship abilities: shoot and boost.
- Default person abilities: jump and takeoff.

`verbs.js` holds this list, with settings ranges.

---

## 6. Obstacles you solve by drawing (pick from these 20)

Chosen for v1: **1, 2, 5, 6**. Pick more later.

| # | Obstacle | Draw |
| --- | --- | --- |
| 1 | Planet you can only reach by landing | LAND |
| 2 | Dark nebula, radar blind | FLARE / LIGHT |
| 3 | Gate locked with a symbol (△ ○ ☆) | that symbol |
| 4 | Black hole pulling you in | REVERSE / ANCHOR |
| 5 | Rock too hard for lasers | DRILL |
| 6 | Treasure among identical decoys | SCAN |
| 7 | Asteroid storm too dense | TELEPORT / WARP |
| 8 | Space pirate wants a password | the password |
| 9 | Fuel runs out | REFUEL / SOLAR SAIL |
| 10 | Frozen comet in the way | HEAT / FIRE |
| 11 | Mirror maze reflects shots | CLOAK |
| 12 | Gap only a tiny ship fits | SHRINK |
| 13 | Crate too heavy alone | TOW / CABLE (two players) |
| 14 | Alien that only reacts to music | HORN / MUSIC |
| 15 | Treasure under water | DIVE / SUBMARINE |
| 16 | Space whale blocks the way | FEED |
| 17 | Gravity flips | FLIP |
| 18 | Door with two locks | KEY ×2, pressed together |
| 19 | Team can't coordinate | PING / SIGNAL |
| 20 | Boss immune until it's "sad" | JOKE / HUG 😄 |

---

## 7. Build order (from an empty folder)

Do the steps in order. Don't start a step until the previous step's **Done when** check passes.

| Step | Build | Files | Done when |
| --- | --- | --- | --- |
| **0. Setup** | `git init`. `.gitignore` covering `.env`, `node_modules` and `controllers/`. A `README` with the run command. Plain Node 20+ with no dependencies; three.js comes from a CDN through an import map | repo root | `node server.js` serves a hello page on port 8000 from a phone on the LAN |
| **1. Contract** | Write the message formats (section 3), controller layout v2 and the verbs list (section 5) as code and sample JSON files | `verbs.js`, `samples/*.json` | Every sample file passes the same checks the server will run |
| **2. Server and live stream** | Static files, `GET /events` live event stream, `POST /input`. Broadcast to every connected screen | `server.js` | Two browser tabs: input from one appears on the other within 100 ms |
| **3. Core simulation** | `world.js` at 30 Hz: players, flight physics (turn, pitch, thrust, strafe), rocks, bullets, collisions, shoot, boost and shield. Ticks sent to screens 15 times a second | `world.js` | A scripted test player moves, shoots a rock and gets points; the tick data shows it |
| **4. Renderer and big screen** | Shared three.js scene: ships, rocks, bullets, effects, bloom. The big screen shows a spectator camera, scoreboard and minimap. Movement between ticks is smoothed | `render.js`, `space.html` | The big screen shows a keyboard-controlled ship flying and shooting smoothly |
| **5. Phone controller** | Join with a name, draw on a canvas, **Done** → upload. Dashed tap areas, real analog sticks, a tilt toggle. The phone renders its own ship in chase and cockpit views, with the drawing semi-transparent on top and the radar bottom-right | `controller.html` | Using a hand-written layout JSON, a phone flies its ship and sees its own view |
| **6. Generation** | `POST /generate`: image to OpenAI vision model to checked JSON to file to broadcast. Controller first. Results cached per player. "Generating…" and "try again" states on the phone | `generate.js`, `server.js` | Draw arrows plus FIRE on a phone, and working buttons appear in under 3 s. Bad model output is rejected cleanly |
| **7. Open world and boss** | Rock types, PvP with health and respawn, the scoring table. Nebula with FLARE and SCAN, decoys, the armoured boss with DRILL, boss attacks | `world.js`, `render.js` | Four players can find the boss, crack it and destroy it; points match the scoring table |
| **8. Planet and island** | Planet with LAND, a phone prompt to draw your explorer, the island scene (terrain, water, sky), chests and DIG, takeoff | `terrain.js`, `world.js`, `render.js` | A player lands, explores, digs up a chest and scores |
| **9. Drawn entities** | `ship` and `person` generation: a 3D model built from simple shapes plus abilities from the verbs list. Photo upload as an alternative to drawing. Selfie astronaut helmet | `generate.js`, `render.js`, `controller.html` | A drawn ship with wings and a drill gets `fly` and `drill` abilities and looks like the drawing |
| **10. Polish** | Hyper-realistic pass (section 4), more obstacles from section 6, sound, HTTPS for tilt and camera | all | Runs smoothly with 8 players: 60 fps on the big screen, 30 fps or better on a mid-range phone |

**Rule:** get one player working end to end before adding more verbs or content.

---

## 8. Open decisions

- **Phone view:** first person or third person by default? Both are planned, with a toggle.
- **Island:** full 3D (assumed), or a simpler 2D top-down version?
- **Entity model:** the model returns simple shapes (boxes, spheres, cones), or a flat card textured with the drawing? The flat card is faster and needs no model call for looks.
- **Which OpenAI model:** pick the fastest vision model that still reads hand-drawn labels reliably. Measure latency in step 6.
- **Rounds:** does a round end after the island treasure, or does the hunt loop forever?

## 9. Risks and notes

- **API key:** read `OPENAI_API_KEY` from the environment or from `.env`, which is git-ignored. Never hard-code it, log it or send it to the browser.
- Tilt and camera on phones need **HTTPS**, using a self-signed certificate that players accept once.
- Phone GPU: rendering 3D on the phone needs a lighter setting (less bloom, pixel ratio 1).
- Generation speed and cost: aim for under 3 s per drawing. Cache results per player, and show a "generating…" state on the phone.
- No login: anyone on the LAN can join. That's fine for a party game, not for anything public.

## 10. Run it

```
OPENAI_API_KEY=... node server.js
big screen: http://<laptop-ip>:8000/space.html
phones:     http://<laptop-ip>:8000/controller.html
```
