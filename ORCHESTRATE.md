# ORCHESTRATE.md: 3D asset channel

This file is the only channel between two models working on Space Party:

- **Orchestrator**: the Claude Code session that owns the plan, the game code and integration.
- **Asset model**: a model that is better at generating 3D assets. It owns everything listed under Requests.

Both read and write this file. Nothing else is needed to collaborate.

**The game in one paragraph.** Multiplayer, phones are hand-drawn controllers, the big screen is the spectator. three.js 0.160.0 from a CDN, no build step, no npm dependencies. A round is winnable in about 2:00 and capped at 3:00: a dark nebula hides an armoured boss rock among 4 decoys, players crack it, a planet appears, they land on its island and dig up a chest. Full spec: `PLAN.md`.

**Not your job:** the players' own ships and explorers. Those are the player's drawing, inflated to 3D on the device and rigged in code. Your assets are everything around them: the boss, rocks, nebula, planet, island, chest, cockpit, effects, default stand-in entities, and the template skeletons and animation clips that the drawn entities borrow.

---

## 1. How we talk

1. The orchestrator adds a request under **Requests** with an id `A-###` and `Status: open`.
2. The asset model claims it: `Status: in progress (asset model, <date>)`.
3. The asset model writes files only under `assets/<id>-<slug>/`, then appends a **Delivery** block under the request: files, how to load them, triangle and texture counts, license and sources, known gaps.
4. The orchestrator integrates it, then sets `Status: accepted` or `Status: changes requested`, followed by a numbered list of changes.
5. Questions go under the request as `Q (asset model):` lines; answers as `A (orchestrator):`. Append only; never rewrite the other side's lines.
6. One request is one deliverable. New ideas go under **Proposals**; the orchestrator turns the good ones into requests.
7. The asset model does not edit game code (`server.js`, `world.js`, `render.js`, `*.html`). If integration needs a snippet, put it in the Delivery block.
8. Never put secrets (API keys, tokens) in this file or in any asset.

Statuses: `open` → `in progress` → `delivered` → `accepted` or `changes requested` → `delivered` again.

Priorities: **P0** is needed for the first full round (build steps 7 and 8 in `PLAN.md`). **P1** is polish.

---

## 2. Technical contract (every asset)

| Rule | Value |
| --- | --- |
| Engine | three.js 0.160.0 through the import map in `space.html`; load with `three/addons/loaders/GLTFLoader.js` |
| Format | glTF 2.0 binary (`.glb`) with embedded textures. No Draco, meshopt or KTX2: the page loads no decoders |
| Code deliveries | ES modules, no dependencies beyond `three` and `three/addons`, an exported `create…(options)` that returns an `Object3D` (or an object holding one), deterministic for a given `seed` |
| Units and axes | 1 unit = 1 m, Y up, the front of the asset faces **−Z** (matches `world.js`: the nose points to −Z) |
| Origin | Centre of mass for ships and rocks, between the feet for characters, centre of the base for props |
| Materials | `MeshStandardMaterial`-compatible PBR (metallic-roughness). Only parts that should glow get emissive (engines, cores, crystals, gold); the bloom pass picks those up |
| Textures | Power of two, 1024 px max (2048 for the boss and the island terrain). sRGB for colour, linear for normal, roughness and metalness |
| Node and bone names | Lowercase with underscores: `hand_l`, `socket_seat`. No dots, colons or slashes, because three.js strips them from animation track names and the clips stop binding |
| Sockets | Empty nodes named `socket_<name>` (`socket_nose`, `socket_hand_r`, `socket_seat`). The code attaches items and effects to them |
| Skeletons | Bone names exactly as in section 4. One skinned mesh per character, at most 4 influences per vertex |
| Animation | Clip names exactly as in section 4. Rotation-only keyframes, except `hips` (or `body`) position. 30 fps. Looping clips loop without a pop |
| License | Your own work or CC0. List any source in the Delivery block |

### Budgets

**iPhone Safari is the target device:** 60 fps on iPhone 12 and newer, never under 30 fps on iPhone XR. The game measures this on real phones (`perf.log`), and the orchestrator will reject an asset that pushes a phone over budget. No shadow maps or reflection passes on phones.

| Asset | Triangles | Draw calls | Textures |
| --- | --- | --- | --- |
| Rock, per type (about 200 instances in total) | 300 | 1 per type | one shared 512 px set |
| Boss rock, per armour state | 15k | 4 | one 2048 set |
| Planet seen from space | 20k plus shader | 3 | 2048 |
| Island, everything visible at once | 150k | 60 | four 2048 sets |
| Chest | 3k | 2 | 1024 |
| Default ship, explorer, car | 5k each | 3 | 1024 |
| Cockpit | 8k | 4 | 1024 |
| Any code-driven effect or volume | under 2 ms per frame on a phone | | |

### Art direction

**Reference image: `assets/reference/ui-inspiration.png`.** Match its feel: stylized and saturated, chunky flat-shaded low-poly rocks in warm grey-brown, blue-to-violet-to-magenta nebula clouds, red emissive accents on everything hostile (the boss especially), bright engine glows with long trails, a cyan hex-pattern shield bubble, a planet with clouds and night-side city lights.

- Cinematic, not photoreal. Silhouettes must read at phone size; strong rim light; colour carries meaning: red = hostile, cyan = the player's own things.
- Player colours are cyan, pink, lime, yellow, orange, purple, blue and red (`world.js` `COLORS`). Keep world assets out of those hues so players stand out.
- Players' entities are hand drawings puffed into plush-like 3D with a paper texture. Light the world so they look deliberate inside it, not pasted on.
- Space: blue-black, the nebula violet and magenta. The current prototype (bloom, glow sprites, engine trails) is the baseline.
- Island: tropical, warm late-afternoon sun, turquoise water, white sand, green interior, rocky cliffs.

---

## 3. Scale reference

| Thing | Size |
| --- | --- |
| World sphere | radius 600 |
| Normal rocks | 2 to 11 across |
| Player ship | about 3 long |
| Person | 1.8 tall |
| Car | about 4 long |
| Island | 420 across, peaks up to 38, sea level at 0 (`terrain.js` `Terrain.height(x, z, seed)`) |
| Ship speed | 18 per second cruising, 45 boosting |

---

## 4. Rig templates (the contract with `rigs.js`)

Drawn entities are rigged in code with these skeletons, and play your clips. Clips must survive limb lengths from 0.7× to 1.4× of the reference without visible breakage (some foot sliding is fine).

| Type | Bones (parent > child) | Sockets | Clips |
| --- | --- | --- | --- |
| person | `hips > spine > chest > neck > head`; `chest > shoulder_l > upper_arm_l > fore_arm_l > hand_l`; `hips > thigh_l > shin_l > foot_l`; mirrored `_r` | head, hand_l, hand_r, back, feet | idle, walk, run, sprint, jump, fall, land, crouch, roll, aim, shoot, swing, throw, block, dig, climb, swim, glide, sit, push, pick_up, kneel, drink, cast, look, read, flip, hit, die, celebrate, wave |
| quadruped | `hips > spine_1 > spine_2 > neck > head`; `hips > tail_1 > tail_2`; per leg `<leg>_upper > <leg>_lower > <leg>_foot` for `front_l`, `front_r`, `back_l`, `back_r` | mouth, seat, tail | idle, walk, gallop, jump, sit, bite, dig, roar, hit, die |
| flyer (animal) | `body > neck > head`; `body > wing_l_1 > wing_l_2`; mirrored `_r`; `body > tail` | seat, nose, claws | flap, glide, dive, land, hit, die |
| swimmer | `spine_1 > … > spine_6` | mouth, seat | swim, dart, hit, die |
| crawler | `body`; per leg `leg_<n>_upper > leg_<n>_lower`, n = 1 to 8 | mouth, back, front | idle, hit, die (walking is procedural IK) |
| serpent | `spine_1 > … > spine_8` | mouth, tail | slither, strike, coil, hit, die |
| ship, car, boat, blob | no skeleton | see A-009 | effects only |

---

## 5. Requests

### A-001 Boss rock and 4 decoys
`Status: in progress (asset model, 2026-10-09)` · P0 · build step 7 · lane: World & render

- **What:** the "super final boss", an armoured asteroid about 30 across that hides in the dark nebula, plus 4 decoys that look identical from outside.
- **States:** `armour_intact`, `armour_cracked`, `armour_broken` (separate child nodes, the code toggles visibility), and a glowing `core` that shows once broken. Decoys share the shell; when cracked they are hollow and empty.
- **Sockets:** `socket_core`.
- **Accept when:** on a phone at 100 away it reads as armoured next to normal rocks; each armour state is clearly different; the core blooms.
- **Deliver:** `assets/A-001-boss-rock/boss.glb`, `assets/A-001-boss-rock/decoy.glb`.

### A-002 Rock set, 6 types
`Status: open` · P0 · step 7 · World & render

- **Types, each recognisable at 50 away on a phone:** stone (plain grey), iron (dark and metallic, with veins), volatile (cracked, glowing orange seams), crystal (violet-white, translucent), magnet (banded dark red and grey), splitter (a visible seam down the middle).
- **3 shape variants per type**, built for `InstancedMesh`: one material per type, no per-instance materials.
- **Accept when:** 200 mixed instances hold 30 fps on a mid-range phone.
- **Deliver:** `assets/A-002-rocks/rocks.glb` with nodes `<type>_<1..3>`.

### A-003 Dark nebula (code)
`Status: open` · P0 · step 7 · World & render

- **What:** a volume about 250 in radius, near black with faint violet, that hides the boss and decoys. Inside, visibility drops to about 25.
- **FLARE:** `setFlare(position, strength)` lights it up to about 120 visibility for 14 s around that point.
- **Deliver:** `assets/A-003-nebula/nebula.js` exporting `createNebula({ radius, seed })` that returns `{ object3d, setFlare(position, strength), update(dt, camera) }`. Under 2 ms per frame on a phone.

### A-004 Planet seen from space
`Status: open` · P0 · step 8 · World & render

- **What:** a planet about 200 in radius that appears near the boss when it dies, with an atmosphere rim, the island visible as a landmass, and a soft glowing ring marking where LAND works.
- **Deliver:** `assets/A-004-planet/planet.js` exporting `createPlanet({ seed })`, or a `.glb` plus a shader module.

### A-005 Island kit
`Status: open` · P0 · step 8 · World & render

- **Terrain material** for the heightmap in `terrain.js`, coloured by height and slope (sand, grass, rock).
- **Props, all instancing-friendly:** palm tree (3 variants, 1.5k triangles each, with a lower-detail version), bush, beach rocks, cliff pieces.
- **Water and sky:** use the three.js `Water` and `Sky` add-ons and deliver tuned parameters.
- **Accept when:** it reads as a tropical island both from the landing approach and on foot, within the island budget.
- **Deliver:** `assets/A-005-island/` with `island.js` exporting `createIsland({ seed, heightAt })`, which builds the terrain mesh from `heightAt(x, z)` and scatters the props.

### A-006 Treasure chest
`Status: open` · P0 · step 8 · World & render

- **States:** closed; an `open` clip (1 s); open with a gold glow.
- **Buried variant:** only a glinting corner and a sand mound. Also a dig-hole decal.
- **Deliver:** `assets/A-006-chest/chest.glb`, `buried.glb`, `dig_hole.png`.

### A-007 Cockpit
`Status: open` · P1 · step 5 · Phone

- **What:** the first-person view for the cockpit toggle: a big window frame, a dashboard with 3 gauge slots (`socket_gauge_1` to `socket_gauge_3`; the code draws the values) and the seat edge.
- **Camera** at the origin looking toward −Z. The frame leaves at least 70% of the screen clear.
- **Deliver:** `assets/A-007-cockpit/cockpit.glb`.

### A-008 Template rigs and clip library
`Status: open` · P0 for person, P1 for the others · step 9 · Astra

- **What:** one reference `.glb` per skinned type in section 4: the skeleton, a neutral placeholder mesh and every listed clip. Person first, then quadruped.
- **Person:** T-pose rest, 1.8 tall.
- **Accept when:** every clip plays on skeletons from 0.7× to 1.4× limb lengths without visible breakage.
- **Deliver:** `assets/A-008-rigs/person.glb`, then `quadruped.glb`, `flyer.glb`, `swimmer.glb`, `crawler.glb`, `serpent.glb`.

### A-009 Default stand-in entities
`Status: open` · P1 · step 9 · Astra

Used when a player skips drawing or generation times out. A hand-drawn look is welcome, because they stand in for drawings.

- **Ship:** sockets `nose`, `wing_l`, `wing_r`, `back`, `belly`, `seat`; emissive engine.
- **Explorer astronaut:** the person rig from A-008, with a helmet visor material named `visor` whose map the code replaces with the player's selfie.
- **Car:** wheels as separate nodes `wheel_fl`, `wheel_fr`, `wheel_bl`, `wheel_br` so the code can spin them; sockets `seat`, `roof`, `front`, `back`.
- **Deliver:** `assets/A-009-defaults/ship.glb`, `explorer.glb`, `car.glb`.

### A-010 Effects (code)
`Status: open` · P1 · steps 4 and 7 · World & render

- **Kinds:** laser bolt, explosion (3 sizes), drill sparks, FLARE burst with light, SCAN ping ring, shield bubble, boost trail, landing dust, dig dirt burst, chest gold burst.
- **Deliver:** `assets/A-010-fx/fx.js` exporting `spawnFx(scene, kind, position, { color, size })`. Pooled, sprite or shader based, works with the existing bloom pass.

### A-011 Space environment map
`Status: open` · P1 · step 4 · World & render

- **What:** an equirectangular starfield and nebula backdrop for the background and image-based lighting, 2048 × 1024, plus a dimmer variant for inside the nebula.
- **Deliver:** `assets/A-011-space-env/space.jpg`, `space_nebula.jpg`.

---

## 6. Proposals (asset model → orchestrator)

Open invitation: if you can turn a 2D drawing into a better plush-like 3D mesh than our plan (distance-transform inflation, the drawing as the front texture, skin weights to the rig templates) under 100 ms on a phone, propose it here.

_(none yet)_

---

## 7. Log

- 2026-10-09 orchestrator: file created; A-001 to A-011 open.
- 2026-10-09 asset model: Connected to this channel. Claimed A-001 first; will deliver the boss and shared decoy shell with named damage states and reproducible source. Future requests and feedback will be checked every five minutes. Files will stay within their request asset directories; integration remains with the orchestrator.
