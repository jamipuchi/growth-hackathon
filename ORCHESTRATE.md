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

**v1 queue, in this order** (v1 = one full round on an iPhone; players use the default ship and explorer). **The owner simplified the world (2026-10-09 22:15): three gates only (DRILL the boss, LAND on the planet, DIG up the chest), one boss and no decoys, no dark-nebula mechanic, two rock types in play (stone, crystal).** Queue: **A-009 (ship and explorer only; car later) → A-006 → A-005 → A-004 → A-001 change 1 (now boss only: it is the centrepiece and must read as the big red enemy from far away, like the mothership in the reference) → A-010 → A-011 → A-003 (now only a decorative violet/magenta nebula cloud around the boss, no darkness) → A-007.** A-008 (rigs and clips) starts after v1. Decoys and the other four rock types are not used in v1; nothing to redo. Deliver each one as soon as it is done; integration happens in parallel.

### A-001 Boss rock and 4 decoys
`Status: delivered` · P0 · build step 7 · lane: World & render

- **What:** the "super final boss", an armoured asteroid about 30 across that hides in the dark nebula, plus 4 decoys that look identical from outside.
- **States:** `armour_intact`, `armour_cracked`, `armour_broken` (separate child nodes, the code toggles visibility), and a glowing `core` that shows once broken. Decoys share the shell; when cracked they are hollow and empty.
- **Sockets:** `socket_core`.
- **Accept when:** on a phone at 100 away it reads as armoured next to normal rocks; each armour state is clearly different; the core blooms.
- **Deliver:** `assets/A-001-boss-rock/boss.glb`, `assets/A-001-boss-rock/decoy.glb`.

#### Delivery (asset model, 2026-10-09)

- **Files:** `assets/A-001-boss-rock/boss.glb` (313,516 bytes), `decoy.glb` (238,100 bytes), `boss.js` loader/state helper, editable `boss_source.blend`, reproducible `generate.py`, `validate.py`, `validation.json`, `browser-validation.json`, `README.md`, `LICENSE.txt`, `preview.html`, `preview-desktop.png`, and `preview-phone-{intact,cracked,broken}.png`, all in the same request directory.
- **Design:** irregular segmented basalt armour with weathered alloy bevels; intact, cracked, and broken group nodes; glowing geode core on the boss only. The intact body is approximately 27.6 × 27.4 × 29.7 m, Y up, with the exposed cavity facing -Z. Both GLBs contain `socket_core` at the centre. Four decoys can clone the one decoy file; the helper does this with independent states and shared geometry/materials.
- **Load:** `import { createBossEncounter, setArmourState } from './assets/A-001-boss-rock/boss.js'; const { boss, decoys } = await createBossEncounter(); scene.add(boss, ...decoys);` Assign gameplay positions after loading. `setArmourState(boss, 'armour_broken')` reveals the core; the same function changes decoys without adding a core. **When using GLTFLoader directly, call `setArmourState(gltf.scene)` before adding it:** glTF has no standard visibility field and otherwise all states render together. Keep the helper's default intact state.
- **Visible cost:** boss intact 1,440 triangles / 2 calls; cracked 1,236 / 2; broken including core 1,620 / 4. Decoy intact 1,440 / 2; cracked 1,236 / 2; broken 654 / 2. Zero textures. All geometry is embedded; no decoders. Four PBR materials in the boss, two in the decoy. `KHR_materials_emissive_strength` loads successfully in r160 and drives the existing bloom pass. All stored states together: boss 4,296 triangles; decoy 3,330.
- **Verification:** structural validation passes with SHA-256 hashes in `validation.json`. Real GLTFLoader/three.js 0.160.0 browser checks pass for identical shell geometry/materials across both files, four independent decoys, no decoy core, sockets, MeshStandardMaterial, initial visibility, emissive strength and draw/triangle budgets. No browser console errors/warnings. Visually checked all six combinations at 1440 × 1000 and the three boss states at 390 × 844 with the camera 100 m away; screenshots attached in the directory. Core bloom is visible, and cracked/broken cavities are clearly distinct.
- **License and sources:** original procedural work, CC0-1.0; no external meshes, textures or images. Blender 5.2.2 authoring/export, three.js/add-ons retain upstream MIT. No game integration files were changed.
- **Known gaps:** desktop browser at phone dimensions is not physical-phone FPS measurement. Final nebula visibility, comparison beside A-002 normal rocks, and full game integration need orchestrator verification. Orient -Z toward the approach if the cavity reveal must be seen immediately. Preview is available at `http://127.0.0.1:8766/assets/A-001-boss-rock/preview.html` while the local preview server is running; README includes restart instructions.


#### Review (orchestrator, 2026-10-09)
`Status: accepted for v1 · changes requested (P1, after your P0 queue)`

Good work: inside budget (1,440 triangles, 2 calls), states read clearly at phone size, the `boss.js` helper is exactly the integration shape we want. Use that pattern (a small `create…()` helper next to the files) for every delivery.

1. Add the hostile cue from the art direction (`assets/reference/ui-inspiration.png`): thin red emissive seams between the armour plates, and red emissive rims on the cracked edges, so the boss reads as an enemy at 100 m in the dark nebula. Decoys must get the identical seams (they must stay indistinguishable until SCAN).
2. Keep the same node names, `socket_core`, files and helper API, so integration does not change.
3. No action needed: `.playwright-cli/` folders are git-ignored now.

### A-002 Rock set, 6 types
`Status: delivered` · P0 · step 7 · World & render

- **Types, each recognisable at 50 away on a phone:** stone (plain grey), iron (dark and metallic, with veins), volatile (cracked, glowing orange seams), crystal (violet-white, translucent), magnet (banded dark red and grey), splitter (a visible seam down the middle).
- **3 shape variants per type**, built for `InstancedMesh`: one material per type, no per-instance materials.
- **Accept when:** 200 mixed instances hold 30 fps on a mid-range phone.
- **Deliver:** `assets/A-002-rocks/rocks.glb` with nodes `<type>_<1..3>`.

#### Delivery (asset model, 2026-10-09)

- **Files:** `assets/A-002-rocks/rocks.glb` (175,020 bytes); `rocks.js` with `loadRocks()` and `createRockField()`; editable `rocks_source.blend`, deterministic `generate.py`, two atlas PNGs, `validate.py`, `validation.json`, `browser-validation.json`, `README.md`, `LICENSE.txt`, `preview.html`, desktop/200-instance screenshots and six phone-size screenshots, all in this request directory.
- **Design:** 18 named meshes (`stone_1..3`, `iron_1..3`, `volatile_1..3`, `crystal_1..3`, `magnet_1..3`, `splitter_1..3`), each with one primitive. Warm grey stone, veined dark iron, orange emissive volatile seams, translucent violet-white crystal clusters, dark red/grey magnetic bands, and a physically open seam between the splitter's two closed halves. Y up; meshes normalised to maximum radius 1 m from their centre-of-mass origin. Scale by gameplay radius, not diameter.
- **Load:** `import { loadRocks, createRockField } from './assets/A-002-rocks/rocks.js'; const templates = await loadRocks(); const field = createRockField({ templates, seed: 2026, rocks: [{ id: 1, type: 'stone', variant: 2, position: [0,0,-30], radius: 3 }] }); scene.add(field.object3d);`. `variant` is 1–3; omit for seeded selection. Optional quaternion is `[x,y,z,w]`. `field.hide(id)` removes destroyed rocks without reallocating. The helper exposes `batches`, `handles` and `dispose()`; resource ownership and the wire-format mapping boundary are documented in README.
- **Instancing:** six shared materials, one draw call per populated type including all three variants. The helper merges the three shapes per type and selects the active one via instance attributes in the standard material's vertex shader; unused variants collapse to degenerate triangles. All submitted vertices are included in the budget. Direct instancing of separate GLB nodes also works but would use up to 18 calls. Keep the helper's shader hook for the six-call path; use game collision spheres rather than exact raycasts against the merged geometry. No shadow maps or reflection passes.
- **Budgets:** stone/iron/volatile/magnet = 80 triangles per shape, 240 submitted per batched instance; crystal = 72 / 216; splitter = 44 / 132. Six materials and two shared embedded 512 × 512 maps (sRGB colour and emission). No normal maps, external buffers or decoders. The actual 200-instance r160 preview renders **6 calls and 43,644 submitted triangles**.
- **Validation:** nine structural checks and twelve browser checks pass. This includes final texture pixel content and correct type-specific UV palettes, shared materials, names, radius, budgets, deterministic variant selection, alpha, emission and hiding. No browser console errors or warnings. Visually checked all eighteen shapes at 1440 × 960 and all six first variants at 390 × 844 with a camera 50 m away. Desktop frame-interval sample (180 frames, Chrome on Mac, DPR 1): median 8.3 ms, p90 8.5 ms. This is **not GPU timing or physical iPhone Safari FPS proof**; target-device `perf.log` testing remains for integration.
- **Known gaps:** crystal uses single-pass front-face alpha blending (0.82 opacity), with no per-instance transparent sorting; check overlapping crystals in the game. Final nebula lighting and iPhone 12/XR performance remain unverified. Templates are at the origin; instantiate them with the helper rather than adding the entire loaded GLB scene. Preview: `http://127.0.0.1:8766/assets/A-002-rocks/preview.html` while the local preview server runs.
- **License and sources:** all geometry, textures and custom source are original CC0-1.0; no external artwork. Blender 5.2.2 authoring/export; three.js and add-ons retain upstream MIT. No game code changed.

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
`Status: in progress (asset model, 2026-10-09)` · P0 · step 8 · World & render

- **Terrain material** for the heightmap in `terrain.js`, coloured by height and slope (sand, grass, rock).
- **Props, all instancing-friendly:** palm tree (3 variants, 1.5k triangles each, with a lower-detail version), bush, beach rocks, cliff pieces.
- **Water and sky:** use the three.js `Water` and `Sky` add-ons and deliver tuned parameters.
- **Accept when:** it reads as a tropical island both from the landing approach and on foot, within the island budget.
- **Deliver:** `assets/A-005-island/` with `island.js` exporting `createIsland({ seed, heightAt })`, which builds the terrain mesh from `heightAt(x, z)` and scatters the props.

### A-006 Treasure chest
`Status: delivered` · P0 · step 8 · World & render

- **States:** closed; an `open` clip (1 s); open with a gold glow.
- **Buried variant:** only a glinting corner and a sand mound. Also a dig-hole decal.
- **Deliver:** `assets/A-006-chest/chest.glb`, `buried.glb`, `dig_hole.png`.

#### Delivery (asset model, 2026-10-09)

- **Files:** `assets/A-006-chest/chest.glb` (299,044 bytes), `buried.glb` (33,884 bytes), `dig_hole.png` (282,112 bytes), `chest.js`, editable `chest_source.blend`, original `generate.py`, `chest_surface.png`, `chest_emission.png`, `validate.py`, `validation.json`, `browser-validation.json`, `README.md`, `LICENSE.txt`, `preview.html`, and desktop/phone-size review screenshots, all in this request directory.
- **Design:** chunky warm teak and worn brass, curved hinged lid, lock, side handles, coins and ingots. Closed size approximately 1.74 × 1.00 × 1.14 m, Y up, front -Z, origin at the centre of the base. Buried variant shows only a small glinting corner over a low sand mound. The separate RGBA dig-hole decal has a soft disturbed-sand rim and dark centre.
- **States and animation:** default closed GLB; one `open` clip, exactly 1.0 s with 31 samples at 30 fps. Rotation-only `chest_lid` channel, opening to 106° before settling at 100°. Gold emission feeds the existing bloom pass; no dynamic lights are added. Sockets: `socket_treasure`, moving `socket_lid`, and buried `socket_glint`.
- **Load:** `import { createChest, createDigHole } from './assets/A-006-chest/chest.js'; const treasure = await createChest({state:'buried'}); scene.add(treasure.object3d);` Position the root on the terrain. Call `treasure.open()` after digging, then `treasure.update(dt)` each frame in seconds. `setState('closed'|'open'|'buried')` switches immediately; `.state` also exposes `opening`. Repeated `open()` calls do not restart; `open({restart:true})` does. `setGlow(strength)` adjusts instance emission (default 2.4). Cached geometry/maps are shared, cloned materials and animation state are independent; `.dispose()` releases instance resources.
- **Verified visible cost:** chest closed/open **2,964 triangles / 2 calls**, buried **252 / 1**. One PBR material per GLB, two embedded **128 × 128** palette maps for roughness/metalness and emission; vertex colours supply the wood/brass/sand palette. No external resources or decoders. Gold-only emission is checked from the actual embedded PNG pixels. **Optional `createDigHole()` adds 2 triangles / 1 call / one 512 × 512 alpha map**: chest plus hole totals 3 calls, so omit/hide the decal while the chest is visible if enforcing a strict two-call encounter budget.
- **Verification:** structural/binary validation passes. **16 browser checks pass in r160**, including renderer-reported calls/triangles for closed/open/buried, all 31 animation samples, exact duration/final angle, replay, repeated calls, state resets, sockets, independent materials and shared resources after disposal. Final browser console has 0 errors / 0 warnings. Visually inspected desktop gallery, interior, mid-opening and rear hinge, plus closed/open/buried/decal at 390 × 844. Evidence and current SHA-256 hashes are in the validation files.
- **Known gaps:** physical iPhone 12/XR FPS and live terrain/game integration remain unverified. The decal is flat and needs alignment/projection on slopes; it does not excavate terrain or provide collision/gameplay. The supplied preview uses illustrative bloom without shadow maps or reflection passes. Preview: `http://127.0.0.1:8766/assets/A-006-chest/preview.html` while the local server runs; README includes restart instructions.
- **License and sources:** original CC0-1.0 geometry, textures, animation and custom source; no external artwork. Blender 5.2.2 authoring/export; three.js/add-ons retain upstream MIT. No game integration code changed.

### A-007 Cockpit
`Status: open` · P1 · step 5 · Phone

- **What:** the first-person view for the cockpit toggle: a big window frame, a dashboard with 3 gauge slots (`socket_gauge_1` to `socket_gauge_3`; the code draws the values) and the seat edge.
- **Camera** at the origin looking toward −Z. The frame leaves at least 70% of the screen clear.
- **Deliver:** `assets/A-007-cockpit/cockpit.glb`.

### A-008 Template rigs and clip library
`Status: delivered (person; other creature rigs pending P1)` · P0 for person, P1 for the others · step 9 · Astra

- **What:** one reference `.glb` per skinned type in section 4: the skeleton, a neutral placeholder mesh and every listed clip. Person first, then quadruped.
- **Person:** T-pose rest, 1.8 tall.
- **Accept when:** every clip plays on skeletons from 0.7× to 1.4× limb lengths without visible breakage.
- **Deliver:** `assets/A-008-rigs/person.glb`, then `quadruped.glb`, `flyer.glb`, `swimmer.glb`, `crawler.glb`, `serpent.glb`.

#### Delivery (asset model, 2026-10-09; person library)

- **Files:** `assets/A-008-rigs/person.glb` (1,179,940 bytes), `person.js`, editable `person_source.blend`, original `generate.py`, `person-clips.json`, `validate.py`, `validation.json`, `browser-validation.json`, `README.md`, `LICENSE.txt`, `preview.html`, nine proportion pose sheets, side-view sequence frames/contact sheets and actual-explorer phone-size screenshots. All in this request directory. **This completes the person library; the five creature rigs remain P1 work.**
- **Reference:** neutral segmented mannequin, 1.80 m T-pose, feet-centred origin, Y up / front -Z, exact section-4 person hierarchy with 19 bones. Same rest transforms as A-009 explorer. One skinned mesh / one PBR material / **4,068 triangles / 1 draw call / zero textures**, at most one influence per vertex. Required head/hand_l/hand_r/back/feet sockets included; feet socket follows hips.
- **Clips:** all **31** section-4 person actions, plus **`step_out` and `climb_in`** (1.6 s each): 33 total. Every clip has 19 quaternion tracks sampled at 30 fps, **rotation only including hips**, with no translation/scale/morph channels. Loop endpoints match; durations/default looping are recorded in `person-clips.json`. Includes phase-offset gait recovery, jump preparation, landing compression, dig lift/strike, shooting recoil, hit/death reactions and inverse seated/standing ship gestures.
- **Reference load:** `import { createPerson } from './assets/A-008-rigs/person.js'; const person = await createPerson(); scene.add(person.object3d); person.play('run'); person.update(dt);` Update every frame in seconds. `play(name,{fade:.12,loop,restart})` supports crossfade and one-shot replay. `createPerson({animation:null})` keeps T-pose. Return values also include bones, sockets, clips, mixer/action and dispose. Instances share cached source geometry but own skeletons, bind matrices, materials and animation state.
- **Use on the existing explorer:** create it with `createDefaultExplorer({animation:null})`, then `const motion = await createPersonAnimator(explorer.object3d);` from `person.js`. Call `motion.play(...)` and `motion.update(dt)` while this library is active. **Construct on the target bind/rest pose, and use only one active mixer per skeleton.** `retargetPersonClips(target)` is available for an existing mixer; it converts rest-basis quaternion deltas by bone name and preserves target lengths. Apply the game's procedural offsets after mixer updates. No A-009 files were changed.
- **Proportions:** `createPerson({limbScale:.7})` / `1.4` rebinds the neutral mesh and joint offsets together at setup time. Optional `limbScales` overrides individual upper/lower arms/legs. All 33 clips tested numerically at 0.7×, 1.0×, 1.4× and an asymmetric mix of range endpoints: **5,724 skeleton-frame samples and 1,188 complete skinned-vertex poses**. Uniform rest heights are 1.587 / 1.800 / 2.084 m because torso/head stay fixed. A discovered shared-bind-matrix bug was fixed before delivery; instances now retain separate inverse-bind matrices.
- **Verification:** structural/binary contract validation passes; **13 r160 browser checks pass**, covering the reference height, 33 rotation-only clips, proportions/joint lengths, independent bones, root-orientation-independent retargeting, one-shot replay, actual renderer budget and all 33 clips on A-009 explorer at five phases each. Nine front-view sheets show every clip at all three uniform proportions; twelve v1 actions additionally reviewed in side view at 15%/50%/85%. Actual explorer run/dig/wave/step_out inspected at 390 × 844. No nonfinite/exploded poses observed; final console **0 errors / 0 warnings**. Hash and evidence files are included.
- **Integration limits:** root travel, gravity, ground contact/IK and seated height remain with game code. In particular, step_out/climb_in animate the body but need the ship seat/exit root path; jump/roll/flip/die need root/ground handling. Foot sliding and hand/prop alignment still need gameplay review. Physical iPhone Safari FPS, arbitrary generated skin weights and the new procedural motion layer are unverified. The asymmetric case has numerical checks; visual sheets cover the three uniform cases.
- **License/source:** original CC0-1.0 geometry, colours, animations and source; no external artwork or motion capture. Blender 5.2.2 and three.js/add-ons retain upstream licenses. No game integration files changed. Preview: `http://127.0.0.1:8766/assets/A-008-rigs/preview.html` (animation/phase controls, proportions, side view, sheets and explorer switch); README has integration and server instructions.

### A-009 Default stand-in entities
`Status: delivered (v1 ship and explorer; car deferred P1)` · **P0 for v1 (ship and explorer)**, car P1 · step 9 · Astra

Used when a player skips drawing or generation times out. A hand-drawn look is welcome, because they stand in for drawings.

- **Ship:** sockets `nose`, `wing_l`, `wing_r`, `back`, `belly`, `seat`; emissive engine.
- **Explorer astronaut:** the person rig from A-008, with a helmet visor material named `visor` whose map the code replaces with the player's selfie.
- **Car:** wheels as separate nodes `wheel_fl`, `wheel_fr`, `wheel_bl`, `wheel_br` so the code can spin them; sockets `seat`, `roof`, `front`, `back`.
- **Deliver:** `assets/A-009-defaults/ship.glb`, `explorer.glb`, `car.glb`.

#### Delivery (asset model, 2026-10-09; v1 ship and explorer)

- **Files:** `assets/A-009-defaults/ship.glb` (142,856 bytes), `explorer.glb` (813,868 bytes), `defaults.js` create helpers, editable `defaults_source.blend`, `generate.py`, `visor_default.png`, `validate.py`, `validation.json`, `browser-validation.json`, `README.md`, `LICENSE.txt`, `preview.html` and actual front/rear/pose/dig/selfie/phone-size screenshots. All are in the request directory. **Car is still deferred P1; this is the requested v1 delivery.**
- **Ship:** about 2.9 m long, -Z forward / Y up, swept wings, cyan markings, two emissive engines, origin adjusted to the authored geometry's signed-volume centre. Required `socket_nose`, `socket_wing_l`, `socket_wing_r`, `socket_back`, `socket_belly`, `socket_seat` are present, plus `socket_engine_l/r` for trails. 1,328 triangles / 3 calls / no textures. `setEnginePower(0..3)` controls engine emission for the existing bloom pass.
- **Explorer:** 1.80 m high in T-pose, feet-centred origin, exact section-4 19-bone person hierarchy. One authored/glTF skinned mesh with three material primitives (GLTFLoader creates three SkinnedMesh drawables), at most two influences per vertex. Required `socket_head`, `socket_hand_l/r`, `socket_back`, `socket_feet` follow the bones. 4,552 triangles / 3 calls / one embedded 512 × 512 visor map. Material `visor` has a neutral white base tint so selfie replacement remains visible.
- **V1 clips:** `idle` 2 s, `walk` 1.2 s, `run` 0.8 s, `jump` 0.9 s, `fall` 1 s, `land` 0.3 s, `dig` 1.2 s, `celebrate` 2 s. All at 30 fps; rotation channels only except hips translation. Loop endpoints match. Locomotion is in place; gameplay moves the root. Jump/land default to one-shot with a held final pose. The full A-008 library and 0.7×–1.4× retarget validation remain deferred.
- **Load:** `import { createDefaultShip, createDefaultExplorer } from './assets/A-009-defaults/defaults.js'; const ship = await createDefaultShip(); const explorer = await createDefaultExplorer(); scene.add(ship.object3d, explorer.object3d);`. Call `explorer.update(dt)` every frame (seconds), `explorer.play('walk')` or `explorer.play('dig')` on state changes. Repeated `play` calls preserve a running clip; `{restart:true}` forces a restart. Finished one-shots can replay. `createDefaultExplorer({animation:null})` keeps the rest pose. Both factories cache source GLBs and create independent materials and skeletons; `.dispose()` releases instance resources, retaining shared cached geometry/maps.
- **Selfie:** `explorer.setVisorTexture(texture)` configures sRGB and `flipY=false`, assigns the visor map, and keeps the material tint white. `explorer.resetVisor()` restores the original graphic. Supply a cropped square THREE.Texture; camera capture/cropping remains with game code. Visually verified a left/right/top-labelled texture is correctly oriented at desktop and 390 × 844 viewport sizes.
- **Verification:** structural checks pass for actual GLB budgets, names, sockets, exact bone hierarchy, normalized weights, clip timestamps/durations, legal channels, loop closure, embedded resources and vertex paint. Fifteen r160 browser checks pass, including independent clones, finite skinned geometry at five samples per clip, 1.8 m reference height, socket parenting, one-shot replay and selfie replacement. Visually inspected all eight poses, front/rear ship and explorer, engine glow, dig, visor replacement and phone-size explorer views. The final browser session has zero console errors or warnings; hashes and evidence are in the request directory.
- **Known gaps:** physical iPhone 12/XR frame rates, terrain foot contact and live game attachment/physics integration are unverified. Skin frustum culling is disabled to avoid rest-pose bounds clipping the limbs. The feet socket follows hips bob; use root origin for the grounded collision anchor. `car.glb` and the rest of A-008 are not part of this v1 delivery.
- **License and sources:** original CC0-1.0 meshes, textures, animations and source; no external artwork. Blender 5.2.2 export, three.js/add-ons retain upstream MIT. No game integration code changed. Preview: `http://127.0.0.1:8766/assets/A-009-defaults/preview.html` while the preview server runs; README includes restart instructions.

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
- 2026-10-09 asset model: A-001 delivered with GLBs, source, loader, contract checks and desktop/phone-size previews. Awaiting integration review; the active monitor will handle feedback and continue the P0 queue.
- 2026-10-09 asset model: Claimed A-002. Noted the updated iPhone Safari budget and art direction. Will deliver 18 named variants with six shared materials and a six-draw-call instancing path. Physical iPhone verification remains with the orchestrator. A-001's delivered core is gold; noted the new hostile-red direction for a future revision if requested.
- 2026-10-09 orchestrator: A-001 accepted for v1 with one P1 change. v1 queue set at the top of section 5: A-009 (ship, explorer) first. Code lanes for v1 start now; integration reads `assets/` as deliveries land.
- 2026-10-09 asset model: A-002 delivered after finishing the already-claimed work; 18 shapes, six calls for 200 instances, structural and browser checks passed. Acknowledged A-001 acceptance and deferred red-seam revision. The updated v1 queue is authoritative: A-009 ship/explorer next, then A-006; full A-008 clip library waits until after v1.
- 2026-10-09 asset model: Claimed A-009 ship/explorer for v1. Explorer will use the exact person bone hierarchy now, with a small v1 animation set; the complete A-008 clip library and A-009 car remain deferred according to the queue. Will provide create helpers and a replaceable UV-mapped visor.
- 2026-10-09 orchestrator: A-002 received, thanks. The world is simplified (see the v1 queue note in section 5): one boss, no decoys, no dark nebula, stone and crystal only. Queue reordered: A-009 → A-006 → A-005 → A-004 → A-001 change 1 (boss only) → A-010 → A-011 → A-003 (decorative) → A-007.
- 2026-10-09 asset model: A-009 v1 ship and explorer delivered with create helpers, eight starter clips and tested selfie replacement; car/full A-008 remain deferred. Acknowledged the simplified world and updated queue. A-006 treasure chest is next.
- 2026-10-09 asset model: Claimed A-006. Building the closed/open chest, one-second lid animation, buried mound with glint and dig-hole decal, with a create helper and verified two-call chest budget.
- 2026-10-09 orchestrator: the owner wants every animation to feel great. **A-008 person rig and clip library (person first: idle, walk, run, jump, fall, land, dig, shoot, hit, die, celebrate, wave, plus step_out and climb_in for the ship) moves into v1, right after A-006.** Code side, `anim.js` adds procedural motion profiles (anticipation, overshoot, squash and stretch) on top of your clips; keep clips rotation-only on the section 4 bone names so both layer cleanly.
- 2026-10-09 asset model: A-006 delivered: two-call chest, exact one-second opening, gold reveal, buried glint and separate dig-hole decal; structural and 16 browser checks passed. Acknowledged the latest priority change: A-008 person rig/clips, including step_out and climb_in, is next before A-005. Will preserve section-4 bone names and the rotation-only layering contract.
- 2026-10-09 asset model: Claimed A-008 person rig and clip library. Building the named T-pose reference and person actions, including step_out/climb_in, with rotation-only tracks and 0.7×–1.4× limb-length review. Other creature rigs remain P1; game integration stays with the orchestrator.
- 2026-10-09 asset model: A-008 person library delivered with all 33 clips (including step_out/climb_in), retarget helper, uniform/asymmetric proportion checks and actual A-009 explorer review. Creature rigs remain P1. Returning to the v1 queue: A-005 island kit is next, then A-004 planet and the boss red-enemy revision.
- 2026-10-09 asset model: Claimed A-005. Building terrain from the supplied heightAt function, seeded instanced island props with palm LODs, and tuned Water/Sky add-ons. The mobile water path will disable reflection rendering to honor the no-reflection-pass contract.
- 2026-10-09 orchestrator: **world look reference: `assets/reference/world-look.png`** (PLAN.md "World look"). Implications for the queue: A-004 planet must be Earth-like with clouds and night-side city lights and read big from far away; A-002 rocks need a few HUGE foreground variants (60 to 120 m) besides the field rocks; A-001 change 1 should move the boss toward the mothership feel of the reference (red lights, seams, pulsing core) while keeping its node names; A-011 should be the saturated blue/violet/magenta nebula backdrop of the reference.
