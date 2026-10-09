# Space Party: multiplayer game plan

**Goal:** a multiplayer 3D game where every player **draws their own phone controller**, their own ship and their own explorer. Drawings turn into real gameplay. Everyone plays together on a big screen and on their own phone. **A round is winnable in about 2 minutes and never lasts more than 3.**

**How to use this doc:** it is the spec for **four lanes, each one person plus one agent**, building the game from this repo. Steps 0 and 1 are done together; after that the lanes work in parallel against the contract. Follow the build order in section 9. Each step ends with a check that must pass before you go on.

**Generation and wiring:** **Astra**, a server module, turns each drawing or photo into a button layout (controller) or a rigged 3D entity with abilities, and wires the two together. It calls a fast **OpenAI vision model** in parallel; everything after the model answers is plain code. The key is read from the `OPENAI_API_KEY` environment variable and is never committed.

---

## 1. Components

Everything runs from one Node server, `node server.js`, on port 8000. Phones join over the LAN at `http://<laptop-ip>:8000`.

| File | Responsibility |
| --- | --- |
| `server.js` | Serves an allowlist of public files. Runs the live event stream to all screens (`GET /events`), receives phone input (`POST /input`), and receives drawings and photos for generation (`POST /generate`) |
| `world.js` | The authoritative game simulation at 30 Hz: round clock, flight physics, rocks, boss, planet, island, combat and scoring |
| `verbs.js` | The ability vocabulary: every verb with its settings ranges, requirements and animation slot, shared by the server and the browser |
| `rigs.js` | The 10 entity rig templates (section 6), shared by the server (checks, capsules) and the browser (rigging, animation) |
| `terrain.js` | The island heightmap, shared by the server (physics) and the browser (rendering) |
| `astra.js` | OpenAI calls plus wiring: drawing or photo in, checked and wired controller or entity JSON out |
| `render.js` | Shared three.js renderer used by the phone and the big screen, including the drawing inflater and the rig builder |
| `controller.html` | Phone: join, draw or photograph a controller or entity, play with your own 3D view |
| `space.html` | Big screen: spectator view, HUD, round clock, minimap, scoreboard |
| `controllers/<player>-<kind>.png/.json` | Each player's drawings and their generated layouts and entities. Never served |
| `perf.log` | Performance samples posted by every screen (section 4, Performance). Never served |
| `ORCHESTRATE.md`, `assets/` | The channel with the 3D asset model: requests, deliveries and the asset contract. Delivered assets live in `assets/<id>-<slug>/` |

**Flow:** the player draws on the phone. Astra sends the image to the model, checks and wires the answer, writes the `.json` and broadcasts it. The phone and the game pick it up right away.

---

## 2. Decisions taken

- three.js for all 3D rendering. Plain Node 20+, no dependencies; three.js comes from a CDN.
- **Generation uses the OpenAI API** through Astra: a fast vision model, called in parallel, with JSON-only output checked against `verbs.js` and `rigs.js`.
- The game goal is a treasure chain: **nebula boss rock → planet landing → island treasure**, inside a **2 to 3 minute round** (section 4).
- **Entities look like the drawing:** the drawing itself is inflated into 3D on the device. No model call for looks (section 6).
- **Rigs are generic:** 10 entity types, one template each. Verbs say what they require, never which entity owns them.
- **Controllers are generic:** binding a drawn control to a verb is code, and re-runs on every entity switch.
- **Phone view:** third-person chase by default, cockpit as a toggle.
- **Rounds** end when the first chest is collected, or at 3:00.

---

## 3. Architecture

```
 phones (controller.html)            big screen (space.html)
  ├─ drawn controller overlay          └─ spectator camera + HUD + clock + minimap
  ├─ own 3D view (chase / cockpit)
  └─ input: buttons, sticks, tilt
            │  POST /input, POST /generate        ▲ live event stream
            ▼                                     │
        server.js ── world.js (authoritative simulation, 30 Hz)
                     verbs.js, rigs.js, terrain.js
                     astra.js ── OpenAI (3 calls in parallel)
```

**The server owns the game.** Every screen, the big one and each phone, only renders what the server sends. That's what lets each phone show its own view.

### Messages (contract, written in step 1)

Phone to server, `POST /input`:
- `{type:"input", player, action, down}`: buttons. `action` is a movement name or an ability verb.
- `{type:"axis", player, axis:"steer"|"move", x, y}`: analog sticks and tilt, each from -1 to 1, sent at most 20 times a second.

Server to every screen, over the event stream:
- `world`: rocks (id, position, size, type, health), nebula, boss and decoys, planet, island seed, chests. Sent on connect and whenever any of it changes.
- `tick`: 15 times a second. Round `phase` (`lobby`, `playing`, `sudden`, `scoreboard`) and `clock` (seconds left). Players (position, yaw, pitch, roll, health, mode `space`/`planet`, status flags, score, current `action` + `slot` + `startedAt` for animation), bullets, boss shots, flares.
- `fx`: explosions, sparks, blasts. `announce`: kill feed, treasure found, win. `toast`: a message to one player ("Draw a LAND button!").
- `generated`: `{player, kind}` once a layout or entity is ready. `entity`: a player's wired entity (type, rig joints, parts on sockets, verbs, bindings).

### Generation (`POST /generate`, handled by Astra)
- The phone sends `{player, kind: "controller"|"ship"|"explorer"|"button", image, speculative?}`. The image is a drawing or a photo, scaled to 512 px.
- **Speculative:** the phone posts 1.2 s after the last stroke with `speculative: true`. If drawing resumes, Astra aborts that call (`AbortController`). Most of the time the answer is ready before the player taps **Done**.
- **Three calls in parallel:** entity (type, joints, parts with sockets, verbs), controller (controls), flavour (name, palette, taunt). Low-detail images, one warm keep-alive connection, a 4 s timeout that falls back to defaults.
- **Cache by drawing hash:** the same drawing, or a rejoin, is instant.
- **Add a button:** `kind:"button"` sends only the new strokes. Astra reads just that region and adds one control, so drawing LAND, FLARE, SCAN, DRILL or DIG mid-round costs seconds, not a full redraw.
- Only verbs from `verbs.js` and types from `rigs.js` are accepted, values are clamped to their ranges, and the number of parts is capped.
- Astra then wires the result in code (under 5 ms), writes `controllers/<player>-<kind>.json` and broadcasts `generated` and `entity`.
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
   - **The first chest collected wins the round.**

### Round clock: winnable in 2:00, over by 3:00
Before the clock: a **20 s lobby** to draw your ship and controller (defaults if you skip).

| Clock | Stage | Budget |
| --- | --- | --- |
| 0:00–0:25 | Fly to the nebula | 25 s |
| 0:25–0:45 | Find the boss with FLARE and SCAN | 20 s |
| 0:45–1:10 | Crack it with DRILL, then shoot it down | 25 s |
| 1:10–1:25 | Reach the planet and LAND | 15 s |
| 1:25–1:40 | Draw your explorer (15 s timer, default explorer if skipped) | 15 s |
| 1:40–2:00 | Dig up a chest | 20 s |
| 2:30 | **Sudden death:** decoys reveal themselves, the boss loses its armour, buried chests glow | |
| 3:00 | Hard cap: the top score wins | |

- After a win or the cap: an 8 s scoreboard, then a new round. Everyone keeps their drawings.
- **Tuning targets, to verify in playtests:** nebula about 350 units from spawn; the planet appears within about 150 units of the boss; the landing spot is within 40 units of the nearest chest; each round twist (section 8) is solvable in 20 s or less.

### Scoring
| Event | Points |
| --- | --- |
| Rock destroyed | +10 |
| Crystal rock | +50 |
| Boss destroyed (last hit) | +1000 |
| Chest found | +300, and the round ends |
| Kill another player (PvP) | +200, victim −50 |
| Hit by a rock | −30 |

### Views
- **Phone:** your own ship, third-person chase by default, with a toggle to a first-person cockpit with a big window and gauges.
  - The drawn controller sits on top, semi-transparent.
  - The **radar** sits top right and points at the current objective; the round clock and objective sit top centre (section 4, Look and HUD).
- **Big screen:** a cinematic spectator camera following the action, with a minimap, scoreboard, kill feed, objective and round clock.

### Look and HUD (reference: `assets/reference/ui-inspiration.png`)
- **Style:** stylized and saturated, not photoreal. Deep blue to violet and magenta nebula clouds, chunky flat-shaded low-poly rocks in warm grey-brown, bloom on everything that glows.
- **Colour meaning:** red glow means hostile (boss, boss shots, decoy traps); cyan means yours (shield, meters, your arrow on the radar); each player keeps their own colour on their ship, trail and bullets.
- **Effects:** long additive engine trails, a translucent cyan hex shield bubble, thin bright laser streaks, a planet with clouds and night-side city lights.
- **Big screen HUD:** objective title top centre in spaced capitals ("FIND THE BOSS", "LAND ON THE PLANET", "DIG UP A CHEST") with a red-to-orange bar under it (boss health, or progress) and a small status line under that; the round clock next to it; a ring radar bottom left (red = boss and hostiles, blue = other players, cyan arrow = you, a red diamond = the objective); SHIELD and BOOST meters bottom right with icons; scoreboard top left.
- **Phone HUD:** the bottom of the screen belongs to the drawn controller, so the phone keeps its HUD at the top: objective and clock top centre, a small radar top right, SHIELD and BOOST as thin bars top left. Thin lines and glow, no heavy panels.

### Graphics target
- Bloom and film-style tone mapping, image-based lighting for reflections.
- Rocks with displaced shapes, a planet with an atmosphere, nebula volumes.
- Island: three.js Sky and Water add-ons, shadows, height-coloured terrain, many trees.
- Drawn entities stay hand-drawn: the contrast with the realistic world is the look.

### Performance: iPhone first
The game must run perfectly on an iPhone in Safari. That is the target device, and it is measured, not assumed.

- **Targets:** 60 fps on iPhone 12 and newer; never below 30 fps on iPhone XR or 11. The big screen holds 60 fps on the host laptop. Phone frame budget: 12 ms of CPU.
- **Phone render budget:** at most 80 draw calls and 120k triangles, pixel ratio capped at 2, textures at most 1024 px and 48 MB in total. No shadow maps and no reflection passes on phones: cheap shader water on the phone, the `Water` add-on only on the big screen. Bloom runs at half resolution, or is replaced by additive glow sprites. Rocks are instanced with one material per type; static geometry is merged; fog cuts the far draw distance.
- **Adaptive quality:** a governor watches the last 60 frames. If the 90th-percentile frame time goes over 18 ms it drops one step (pixel ratio 2 → 1.5 → 1.25 → 1, then bloom off, then far rocks off). Under 12 ms for 5 s, it steps back up.
- **iOS specifics:** `viewport-fit=cover` with safe-area insets; `touch-action: none` and no double-tap or pinch zoom; `apple-mobile-web-app-capable` for full screen from the home screen; a "rotate to landscape" prompt; motion permission through `DeviceMotionEvent.requestPermission()` on a tap (needs HTTPS); `navigator.vibrate` does nothing on iOS, so never rely on it; handle `webglcontextlost` and restore; stop rendering while the page is hidden.
- **Measurement is built in:** `?perf` shows an overlay on any screen (fps, 1% low, frame ms, draw calls, triangles, textures, quality step). Every phone also posts a sample to `POST /perf` every 5 s (device from the user agent, average fps, 1% low, 90th-percentile frame ms, draw calls, triangles, quality step). The server appends it to `perf.log`, which is never served, and prints one line per device. `node server.js --bots 8` adds 8 scripted ships to load-test.
- **Network:** ticks at 15 Hz with compact arrays, under 4 KB per tick for 8 players, one event stream per screen.

---

## 5. Abilities: one list of verbs that scales

Every button maps to a **verb**, and the engine implements each verb once with settings. A drawn **entity** gets abilities from what is drawn on it: gun → shoot, shovel → dig, car → drive, wings → fly. Pressing a verb your entity lacks shows "Draw it!".

**A verb never names an entity type.** It says what it **requires** (a way of moving, or a socket where the drawn part sits), so any entity that meets it gets the verb. It names a **slot**, the generic animation intent; each rig turns the slot into its own clip.

| Verb | Where | Slot | Requires | From drawings like |
| --- | --- | --- | --- | --- |
| shoot | both | primary | any socket | guns, lasers, bows |
| boost | both | move | anything that moves | engines, rockets, wheels |
| shield | both | defend | nothing | shields, bubbles |
| blast | both | primary | any socket | bombs, the word WIN |
| invisible | both | defend | nothing | cloaks, ghosts |
| shapeshift | both | none | nothing | masks, chameleons (disguise) |
| teleport | both | move | nothing | portals, wands |
| heal | both | use | nothing | red crosses, potions |
| jump | planet (dash in space) | jump | walks, crawls, drives | legs, springs |
| land / takeoff | space / planet | mount | nothing | landing gear / rockets |
| scan | both | use | nothing | radars, antennas, eyes |
| flare | both | use | any socket | lights, torches |
| drill | space | primary | nose or front socket | drills, saws |
| dig | planet | use | hand, mouth or front socket | shovels, claws |
| drive | planet | move | drives, or mounted on a car | cars, bikes |
| fly | planet | move | flies, or a jetpack | wings, jetpacks |
| swim | planet | move | swims, floats, walks | fins, boats |
| grapple | both | use | any socket | hooks, ropes, magnets |

Movement is always available: arrows, sticks and tilt mean turn, pitch, thrust, strafe and rise.
- Default ship abilities: shoot and boost.
- Default explorer abilities: jump and takeoff.

### `verbs.js` format
Keep `modes`, `hold`, `params` (`[min, max, default]`, clamped) and `hint`. Add:
- `requires: {moves, sockets}`: who can use it.
- `slot`: one of move, look, jump, primary, secondary, use, defend, interact, mount, emote, hit, die.
- `synonyms`: controller labels that bind to it.
- `tags`: what obstacles check (`light`, `dig`, `drill`, `heat-proof`, …).
- `cost`: spent from the entity's power budget of 10 points, so nobody draws an instant win.

```js
dig: {
  modes: ["planet"], hold: true,
  params: { speed: [0.5, 2, 1] },
  hint: "shovels, spades, claws",
  requires: { sockets: ["hand_r", "hand_l", "mouth", "front"] },
  slot: "use",
  synonyms: ["DIG", "SHOVEL", "SPADE"],
  tags: ["dig"],
  cost: 2,
},
```

### More verbs, same format, added after v1
- **Movement:** brake, hover, roll, sprint, crouch, dodge, climb, glide, jetpack, sail.
- **Attack:** mine, missile, scatter, melee, throw.
- **Defence:** block, decoy, flares, smoke, heat shield, armour.
- **Tools:** cut, build, tow, tractor, bait, fish, plant, freeze, fire.
- **Sensing:** radar ping, binoculars, map, companion.
- **Interaction:** pick up, push, revive, repair, horn, eject.
- **Meta:** emote, ping.

Same idea, existing names: invisible = cloak, teleport = blink, flare = light, blast = charged beam (the WIN button).

---

## 6. Entities: drawn look and generic rigs

### Look
- The drawing itself becomes the 3D body, on the device, in about 100 ms: a distance transform inside the silhouette gives each pixel a height, so living things are round like plush toys. Machines are extruded with a bevel instead.
- The drawing is the front texture; the back is mirrored and darker. No model call for looks.
- While drawing, the phone re-inflates on every stroke and shows the result rotating.

### 10 entity types (`rigs.js`)
| Type | Zone | Moves | Skeleton | Sockets | Procedural motion |
| --- | --- | --- | --- | --- | --- |
| ship | space | fly6dof | none, rigid | nose, wing_l, wing_r, back, belly, seat | banking, engine flame |
| person | planet | walk | 19-bone biped | hand_l, hand_r, head, back, feet | foot planting |
| quadruped | planet | walk, rideable | spine, 4 legs, neck, head, tail | mouth, back (seat), tail | gait cycle |
| car | planet | drive | rigid; wheels from drawn circles | seat, roof, front, back | wheel spin, suspension, steer tilt |
| boat | planet water | float | rigid | seat, mast, bow, stern | buoyancy bob, wake |
| flyer | planet | fly | wing chains for animals, rigid for machines | seat, nose, wing_l, wing_r | flap or propeller spin |
| swimmer | planet water | swim | 6-bone spine | mouth, back (seat) | body wave |
| crawler | planet | crawl, walls too | body plus a 2-bone chain per leg | mouth, back, front | leg IK |
| serpent | planet | slither | 8-bone spine | mouth, tail | spine follows the path |
| blob | both | bounce | none | centre, top | squash and stretch (fallback) |

Drawn bridges, ladders and planks are props: no rig, no controls, only collision.

```js
// One template per type. Adding an 11th type is one entry.
{ type, zones, moves, joints /* 2D points Astra places */, bones /* [bone, parent] */,
  sockets /* socket -> bone */, body /* "inflate" | "extrude" */, skin /* "smooth" | "rigid-parts" | "none" */,
  procedural, slots /* slot -> this type's clip or effect */ }
```

Bone, socket and node names are lowercase with underscores (`hand_r`, `socket_seat`): three.js strips dots from animation track names, so `hand.R` would silently break clips. The full bone lists are in `ORCHESTRATE.md` section 4.

### Rigging, the same steps for every type
1. The entity call returns the type, the joints its template asks for, each drawn part with its socket, and the verbs.
2. Snap joints to the ink's medial axis. On a bad fit, place joints by bounding-box proportion, or fall back to blob.
3. Build the body (inflate or extrude), then the bones from the joints. Rigid types are cut into parts instead.
4. Skin weights: each vertex to its 2 nearest bones by distance to the bone segment.
5. Attach drawn items to their socket as `Object3D` children, so a gun in `hand_r` or a lamp on `nose` follows the animation and its effects spawn there.
6. One `AnimationMixer` per entity: a locomotion layer blended by speed, an upper-body action layer for one-shots, and the procedural motion on top.
7. Clips are rotation-only keyframes on template bone names, so any clip plays on any proportions. Procedural clips first, retargeted Mixamo clips later.

### Players and mounts
- **Mounting** parents the rider to the mount's `seat` socket. The mount's verbs take over the controller; the rider keeps `primary`.
- **The selfie** goes on the `head` socket, or on the cockpit glass of a ship.
- **The server never simulates bones:** one capsule per entity, sized from the ink. Clients animate from `action`, `slot` and `startedAt`.

---

## 7. Controllers: generic binding

Binding a drawn control to a verb is code, not a model call.
- A control binds to a verb by **label** (the verb's `synonyms`) and by **input kind**: a stick feeds move or look, tap / hold / toggle feed verbs of that kind, tilt steers whatever moves.
- **On every entity switch** (land, take off, mount, dismount) the same drawn controller re-binds in under 5 ms:
  - supported by this entity: live;
  - not supported: greyed, with the reason ("BOOST: horses cannot boost; draw rockets on it");
  - granted by the drawing but no control: a hint ("You drew a shovel; draw a DIG button").
- **Never stuck:** the left stick always moves and the right stick always looks, whatever their labels.

---

## 8. Obstacles you solve by drawing

**Always in, every round (the chain):** LAND, FLARE, SCAN, DRILL, DIG.

**Plus one random twist per round**, each solvable in 20 s or less:

| # | Twist | Draw |
| --- | --- | --- |
| 1 | Black hole pulling you in | REVERSE / ANCHOR / a hook |
| 2 | Asteroid storm too dense | TELEPORT / WARP |
| 3 | Space pirate wants a password | write the password |
| 4 | Fuel runs out | REFUEL / SOLAR SAIL / a tow from a teammate |
| 5 | Frozen comet in the way | HEAT / FIRE |
| 6 | Mirror maze reflects shots | CLOAK / a harpoon |
| 7 | Gap only a tiny ship fits | SHRINK / redraw a smaller ship |
| 8 | Crate too heavy alone | TOW / CABLE (two players) |
| 9 | Alien that only reacts to music | HORN / MUSIC |
| 10 | Treasure under water | DIVE / a boat |
| 11 | Space whale blocks the way | FEED / bait |
| 12 | Gravity flips | FLIP |
| 13 | Door with two locks | KEY ×2, pressed together |
| 14 | Gate locked with a symbol (△ ○ ☆) | that symbol |
| 15 | Turret field around the planet | CLOAK / DECOY |
| 16 | Re-entry burn | a heat shield under the hull |
| 17 | River gap on the island | a bridge or plank |
| 18 | Cliff | a ladder, rope or jetpack |
| 19 | Jungle wall | a machete or saw |
| 20 | Boss immune until it's "sad" | JOKE / HUG 😄 |

---

## 9. Build order

Four lanes, one person plus one agent each:

| Lane | Owns |
| --- | --- |
| Netcode & sim | `server.js`, `world.js` |
| Phone | `controller.html` |
| Astra | `astra.js`, `verbs.js`, `rigs.js` |
| World & render | `render.js`, `space.html`, `terrain.js` |

Steps 0 and 1 are done by everyone together. After that each lane works on its steps in parallel against the contract. Don't start a step until its dependencies' **Done when** checks pass.

| Step | Lane | Build | Files | Done when |
| --- | --- | --- | --- | --- |
| **0. Setup** | All | `.gitignore` covering `.env`, `node_modules` and `controllers/`. `serveStatic` serves only an allowlist of public files (html, js, assets) | repo root, `server.js` | `node server.js` serves a page on port 8000 to a phone on the LAN, and `/.env`, `/controllers/…` and `/server.js` return 404 |
| **1. Contract** | All | Message formats (section 3), controller layout v2, the extended `verbs.js` format (section 5), the `rigs.js` template shape (section 6), as code and sample JSON files | `verbs.js`, `rigs.js`, `samples/*.json` | Every sample file passes the same checks the server will run |
| **2. Server and live stream** | Netcode & sim | Static files, `GET /events`, `POST /input`. Broadcast to every connected screen | `server.js` | Two browser tabs: input from one appears on the other within 100 ms |
| **3. Core simulation** | Netcode & sim | `world.js` at 30 Hz: players, flight physics (turn, pitch, thrust, strafe), rocks, bullets, collisions, shoot, boost and shield. The round clock: lobby, playing, sudden death, scoreboard. Ticks 15 times a second | `world.js` | A scripted player moves, shoots a rock and gets points; a scripted round goes lobby → playing → 3:00 cap → scoreboard → new round |
| **4. Renderer and big screen** | World & render | Shared three.js scene: ships, rocks, bullets, effects, bloom. Spectator camera, scoreboard, minimap, round clock. Movement between ticks is smoothed | `render.js`, `space.html` | The big screen shows a keyboard-controlled ship flying and shooting smoothly, with the clock counting down. With `--bots 8`, `perf.log` shows the big screen at 60 fps |
| **5. Phone controller** | Phone | Join with a name, draw on a canvas, **Done** → upload. Dashed tap areas, real analog sticks, a tilt toggle. The phone renders its own ship (chase by default, cockpit toggle), with the drawing semi-transparent on top and the HUD along the top (section 4, Look and HUD) | `controller.html` | Using a hand-written layout JSON, a phone flies its ship and sees its own view. With `--bots 8`, an iPhone's samples in `perf.log` average 55 fps or more with a 1% low of 30 or more |
| **6. Astra: controllers** | Astra | `POST /generate` for controllers: speculative calls, abort, cache by hash, add-a-button mode, checks, "generating…" and "try again" states | `astra.js`, `server.js` | Draw arrows plus FIRE, and working buttons appear in under 3 s. Adding a LAND button mid-round takes under 5 s. Bad model output is rejected cleanly |
| **7. Open world and boss** | Netcode & sim, World & render | Rock types, PvP with health and respawn, the scoring table. Nebula with FLARE and SCAN, decoys, the armoured boss with DRILL, boss attacks | `world.js`, `render.js` | Four players find the boss, crack it and destroy it by about 1:10; points match the scoring table |
| **8. Planet and island** | Netcode & sim, World & render, Phone | Planet with LAND, a 15 s prompt to draw your explorer (default if skipped), the island scene, chests and DIG, takeoff, sudden death | `terrain.js`, `world.js`, `render.js`, `controller.html` | A player lands, digs up a chest and the round ends. 4 players finish a round in 1:45–2:30. The 3:00 cap and sudden death fire |
| **9. Drawn entities** | Astra, Phone, World & render | Entity call (type, joints, parts on sockets, verbs). Inflate or extrude on the device. Rigs for ship and person first, then car and quadruped. Generic binding with re-bind on every switch. Photo upload. Selfie on the head socket | `astra.js`, `rigs.js`, `render.js`, `controller.html` | A drawn ship with wings and a drill gets `fly` and `drill` and looks like the drawing. Landing re-binds the same controller in under 5 ms, with greyed controls and hints |
| **10. Polish** | All | The other 6 rig types, the graphics pass (section 4) within the iPhone budget, round twists from section 8, sound, HTTPS for tilt and camera | all | Runs smoothly with 8 players: 60 fps on the big screen and on an iPhone 12, 30 fps or better on an iPhone XR, all read from `perf.log`. Median round 2:00, none over 3:00 |

**Rule:** get one player through a whole round end to end before adding more verbs, types or twists.

---

## 10. Open decisions

- **Island:** full 3D (assumed), or a simpler 2D top-down version?
- **Which OpenAI model:** pick the fastest vision model that still reads hand-drawn labels reliably. Measure latency in step 6.
- **Boss tuning:** can one player crack the boss inside its 25 s budget, or is it tuned for two or more drillers?

## 11. Risks and notes

- **API key:** read `OPENAI_API_KEY` from the environment or from `.env`, which is git-ignored. Never hard-code it, log it or send it to the browser. Any key that has been pasted into a chat or channel must be rotated.
- **Static files:** today `serveStatic` serves the whole folder, so a `.env` next to `server.js` would be downloadable by anyone on the Wi-Fi. Step 0 replaces it with an allowlist; never serve `.env` or `controllers/`.
- **Round length:** if playtests run long, tighten the distances first, then move sudden death earlier. The 3:00 cap is fixed.
- Tilt and camera on phones need **HTTPS**, using a self-signed certificate that players accept once. Fallback: a tunnel with an HTTPS URL, and sticks instead of tilt.
- **Bad joints from the model:** snap to the ink, sanity-check limb lengths, fall back to proportional joints or the blob type.
- **iPhone performance** is the main technical risk: every render step is checked against `perf.log` from a real iPhone, not a desktop browser (section 4, Performance).
- Generation speed and cost: aim for under 3 s per drawing, most of it hidden by the speculative call. Cache by drawing hash, and show a "generating…" state on the phone.
- No login: anyone on the LAN can join. That's fine for a party game, not for anything public.

## 12. Run it

```
OPENAI_API_KEY=... node server.js
big screen: http://<laptop-ip>:8000/space.html
phones:     http://<laptop-ip>:8000/controller.html
```
