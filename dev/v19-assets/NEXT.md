# NEXT: flyer, swimmer, crawler and serpent as planet types

Plan only, nothing here is built: the owner's demo build adds no entity types; this is the work list for after it.
Line numbers: working tree of branch v1 at 339cc6e, 10 Oct ~14:10. While this was written other lanes had uncommitted edits in contract.js, controller.html, entity3d.js (A-008 quadruped clips), render.js (A-009 default car), world.js (v1.9 round length) and hall-of-fame.html, so numbers there drift: every reference names its anchor (const or function) to grep. verbs.js, astra.js, astra-body.js, anims.js, anim.js, inflate.js and rigs.js had no local edits.

## 1. Summary and recommendation

The delivery (ORCHESTRATE.md "A-008 Template rigs and clip library", block "Delivery (asset model, 2026-10-10; five creature libraries)"; assets/A-008-rigs/CREATURES.md) adds four reference rigs next to the quadruped. Each: Y up, forward -Z, metres; one skinned mesh, one vertex-colour material, 1 draw call; no image texture (three.js adds a bone-palette texture per instance: 1 KiB, 4 KiB for the crawler); rotation-only clips at 30 fps with seamless loops; CC0. In assets/A-008-rigs/creatures.js, `createCreature({ type, animation })` (:97, async, GLB and clips json cached per type) returns `{ object3d, bones, sockets, clips, play, update, dispose }` (no `materials`), and `retargetCreatureClips(type, target)` (:24) converts the clips to any skeleton with the same bone names and parents (it throws on a missing bone or a different parent, :30-31).

| Rig | Bones (root first) | Clips (s; L = loop) | Sockets → bone | Tris / GLB | Origin; size x·y·z (m) |
|---|---|---|---|---|---|
| flyer | 8: body; neck → head; wing_l_1 → wing_l_2; wing_r_1 → wing_r_2; tail | flap 0.8 L, glide 2.4 L, dive 1.2, land 1.2, hit 0.5, die 1.4 | seat, claws → body; nose → head | 3,088 / 443 KB | body centre; 3.13·0.91·2.18 |
| swimmer | 6: chain spine_1 (head end, -Z) → spine_6 | swim 1.4 L, dart 0.8, hit 0.5, die 1.4 | mouth → spine_1; seat → spine_3 | 2,356 / 375 KB | body centre; 1.66·1.34·2.90 |
| crawler | 17: body; leg_N_upper → leg_N_lower, N = 1-8 | idle 2.4 L, hit 0.5, die 1.4; **no walk** ("procedural IK") | mouth, back, front → body | 4,956 / 684 KB | between the feet; 2.22·1.17·2.25 |
| serpent | 8: chain spine_1 (head) → spine_8 (tail) | slither 1.8 L, strike 0.9, coil 2.4 L, hit 0.5, die 1.4 | mouth → spine_1; tail → spine_8 | 2,340 / 381 KB | body centre; 0.56·0.49·2.98 |

- rigs.js:78-113 already has templates with exactly these bones. Its extra sockets (flyer wing_l / wing_r, swimmer back) are not in the GLBs: align rigs.js or create them in code.
- The manifests differ: swimmer, crawler and serpent use the keys `hierarchy` / `socketParents`; flyer and quadruped use `parents` / `sockets`. Read both.
- Crawler legs 1-4 sit at +X, front to back (GLB z -0.48, -0.17, 0.18, 0.48); legs 5-8 mirror them at -X.

**Recommendation**
- **Flyer and serpent first, together.** Today the reading sends "snakes, worms, birds, fish" to blob (astra.js:319), so a drawn dragon or snake bounces like a slime: the most visible letdown left. Players draw flyers most, they look unlike anything else on the island, and they need one new movement rule (hover, 2d). The serpent walks on the ground, has a complete clip set and the lightest rig: mostly table entries, so it tests every layer end to end.
- **Crawler next:** walks and jumps (spiders, bugs, crabs) under the serpent's rules, but the delivery has no walk clip (a gait must be written), and at 4,956 triangles it is the heaviest stand-in.
- **Swimmer last, only if Jaume wants water play.** Every chest is on dry land walkable from the pad (world.js:919 places chests with `dry` + `dryLine`), so a water-only fish could never open one. An amphibious swimmer works, but it is the weakest party type on the 840 m island and needs the water rules.
- **Rules that stay:** skills come only from drawn parts; DIG and DRILL gates unchanged. **New innate movement** (PLAN.md:331): a flyer flies and JUMP flaps it up; a snake slithers and cannot jump (like a car); a crawler crawls and jumps; a swimmer swims fast in water, flops on land, and jumps.
- **Ship it switched off:** the client layers can safely know the new types; only astra.js lets the model answer them, behind `ASTRA_CREATURES=1` (2c). The demo is unchanged until Jaume turns the flag on.

## 2. Changes per layer

### (a) verbs.js (shared by the server and both pages)
- :88 `ENTITY_TYPES`, :89 `PLANET_TYPES`: append "flyer", "swimmer", "crawler", "serpent". Every type check reads PLANET_TYPES, so these need no edit: schema enum (astra.js:276), `entityFromModel` (astra.js:700), `setEntity` (world.js:683).
- :90 `RIG_OF`: `flyer: "flyer", swimmer: "swimmer", crawler: "crawler", serpent: "serpent"` (rigs.js names; they pick the anims.js row via astra.js:743 `wireAnimations(entity.rig, …)` and world.js:412).
- :92 `INNATE`: `flyer: ["fly", "jump", "takeoff"], swimmer: ["swim", "jump", "takeoff"], crawler: ["jump", "takeoff"], serpent: ["takeoff"]`. fly and swim exist (:48-51) but not in SKILLS (:96-99), so no drawing unlocks them. Like the car's "drive", they only keep a drawn FLY or SWIM button unlocked; world.js needs no handler (optionally FLY = JUMP).
- :128 `entityVerbs`: `if (type === "car" || type === "bike") set.delete("jump")` → `if (!jumps(type))`, with a new export `jumps = (t) => (INNATE[t] || []).includes("jump")`, also used by world.js:667 and controller.html:2496 / :2540.
- :135 `CARD_WHAT`: `flyer: "flyer", swimmer: "swimmer", crawler: "crawler", serpent: "snake"` (wording needs Jaume, section 3). :136 `CARD_MOVE`: `flyer: ["fly", "jump"], swimmer: ["swim", "jump"], crawler: ["crawl", "jump"], serpent: ["slither"]`.
- No change to PARTS (:100-107), GATE_SKILLS (:111) or DEV_KIT (:117-120).

### (b) contract.js: a CONTRACT CHANGE (lanes cannot edit it; the orchestrator applies it)
- :105-107 `TUNING.island`, all first guesses (re-run the balance script after, section 3):
  - `speeds`: add `flyer: 1.5, swimmer: 0.6, crawler: 1.3, serpent: 1.2` (× walkSpeed 12 m/s = 18, 7.2, 15.6, 14.4; quadruped is 1.6). `jumpers`: add "flyer", "swimmer", "crawler".
  - New `hover: { flyer: 2.5 }` (m above ground or sea); `waterSpeeds: { swimmer: 2.2 }` (instead of speeds[type] while `Terrain.height` ≤ 0.3, the `dry` test); `overWater: ["flyer", "swimmer"]` (may cross water inside the island circle). Update the comment at :100-104.
- :381 entity `type` enum and :398-400 (explorer list of the body spec): add the four types and the spec's new `creature` section.
- No message shape change: `tick.players[].y` stays the feet height (a flyer's is ground + hover); every screen tells water from `Terrain.height(x, z) ≤ 0.3`, so no new flag. No check reads entity.type.
- The uncommitted v1.9 pacing block (~contract.js:666-715, `pacing` / `applyPacing`) rewrites TUNING.island keys at runtime: keep the new keys out of it.

### (c) Reading the drawing: astra.js and astra-body.js
- **astra.js:314-319** (`entityPrompt` type list), new lines before blob:
  - `"flyer": a bird, bat, dragon, butterfly, bee or any creature that flies on its wings (a person with wings stays "person")`
  - `"swimmer": a fish, shark, whale, dolphin or octopus`; `"crawler": a spider, ant, beetle, crab, scorpion or anything on six or more legs`
  - `"serpent": a snake, worm, eel or caterpillar: a long body without legs`; :319 blob keeps "blobs, slimes, ghosts, balls, a spaceship or rocket without wheels".
- **Flag:** the schema (:276 `explorer: entitySchema("planet", Verbs.PLANET_TYPES)`) and the prompt lines read `READ_TYPES = process.env.ASTRA_CREATURES === "1" ? Verbs.PLANET_TYPES : Verbs.PLANET_TYPES.slice(0, 5)`; :700 keeps accepting all nine.
- **No-key testing:** in dev mode only (`devMode` :759), `devKitEntity` (:748) takes its type from `process.env.ASTRA_MOCK_EXPLORER` when it is a planet type, so ASTRA_MOCK and e2e runs can play each type. `plainEntity` (:755) stays the person. Update the comment at :783.
- **astra-body.js:37 `TYPES`:** add the four (`reconcile` :294 and `fromEntity` :339 follow TYPES).
- **SCHEMA :72-86:** add ONE object, answered for every type with zeros or "none" when it does not apply (as `vehicle` is): `creature: obj({ wings: int, wingShape: enumOf(["none", "feathered", "bat", "insect"]), wingSpan: num, fins: enumOf(["none", "fish", "shark", "whale"]), length: num, pattern: enumOf(["plain", "stripes", "spots", "rings"]) })`. Allow `legs.count` 6 or 8. Keep it this small: every field is output tokens on every explorer read (v1.9 promises reads within 10 s).
- **prompt :94-111:** :98 gets the same four type lines; one new `creature` line (wings drawn; wingSpan = tip to tip ÷ body length, ~1.5 for a bird; fins of a fish; length = a snake's length ÷ its thickness, ~10; pattern = stripes, spots or rings); :103 legs "6 or 8 (a spider or a bug)"; header comment :17-33.
- **`normalize` :169-239:**
  - :173 `const animal = type === "quadruped"` → also true for the four (head, snout and eyes defaults :177-181); view and facing defaults (:231-232) stay "side" / "right" for them.
  - Legs (:191-194): crawler 6 or 8 (default 8, length 0.7, feet "claws"); flyer 0 or 2; swimmer and serpent 0. Tail (:196): flyer "short", serpent "long", others "none".
  - Return a new clamped `creature` block at :228-238: wings 0/2/4 (flyer default 2), wingSpan 0.8-3 (1.6), fins (swimmer default "fish"), length 4-30 (10), pattern.
- **Also in astra-body.js:** `defaultWhere` :242-265: route the four through the quadruped branch (:252-257). `DEFAULT_ITEM` :277-283: dig → "claws" for crawler and flyer. `fromEntity` :336-355: a plausible body per type. Exports :357-358: the new enums.

### (d) world.js: movement (the server owns positions; render follows y)
- **:1297-1300 `moveWalker`:** `speed` uses `ISL.waterSpeeds[type]` instead of `ISL.speeds[type]` when `!dry(p.pos.x, p.pos.z)`; the blob bounce (:1300) also applies to a swimmer on dry land (a fish flops).
- **:1303 `walk(p, mx, mz)` (body :1314-1332):** pass the reach test. Walkers keep `dry` and the shore slide (:1316); `ISL.overWater` types use `(x, z) => Math.hypot(x, z) < island.size / 2 - 5` (bays, lakes, the coast, never off the island circle, where Terrain.height is a flat -6 m sea).
- **:1305-1308 gravity and ground, for `ISL.hover` types:** `floor = islandFeet(x, z) + (p.keys.dig || p.keys.drill ? 0 : hover)` (islandFeet is 0 over water: it hovers 2.5 m above the sea). Below the floor ease up (`y += (floor - y) * min(1, dt * 4)`); above it fall at gravity × 0.35, so a flap floats down.
- **:1391 jump:** for hover types, `p.pos.y <= islandFeet(...) + 0.05` → `<= floor + 0.3`: a flap only near hover height, so no climbing into the sky.
- **:1334-1336 `openChest` and :1350 pickup** test only the horizontal `dist2`: add `p.pos.y - islandFeet(p.pos.x, p.pos.z) < 1.2`, so a flyer must come down (it does while holding DIG or DRILL). The gates are unchanged.
- **:667 `refuse`:** build `JUMP · ${type}s can't jump` from `!Verbs.jumps(type)` and a word table `{ car: "cars", bike: "bikes", serpent: "snakes" }` (never "serpents"). Fix the comment at :677 ("exactly those six").
- **Optional:** :27 `EXPLORER_CHEST` 1.1 is one capsule height for all explorers (:985, :1004, :1014, :1169, :1557). A height per type (serpent 0.4, swimmer 0.4, flyer 0.5, crawler 0.6) makes hits match the low bodies.
- **Unchanged, all on dry land:** spawns and respawns (`nearestDry` :505), teleport (:1403), decoys (:1536, :1551; a flyer's decoy stands on the ground), the tractor (:1486).

### (e) render.js (copy the uncommitted v1.9 A-009 car stand-in: `ASSETS.car` :93, `defaultCarMake` :1005)
- **Type tables (sizes are first guesses; tune on screen):**
  - :821 `entPlanetTypes`: add the four. :840 `entRig`: `flyer: "flyer"` and so on (step one may map them to "quadruped" until (f) lands; anim.js:77 otherwise falls back to the hopping blob row).
  - :842 `entSize` (= inflate KIND size): flyer 2.0, swimmer 2.0, crawler 1.8, serpent 2.6. :845 `entMarkY`: 1.3, 1.3, 1.4, 0.9.
  - :844 `entShield` [centre y, sx, sy, sz] of the 1.25 m bubble: flyer [0.45, 0.9, 0.55, 0.75], swimmer [0.45, 0.6, 0.5, 0.95], crawler [0.5, 0.85, 0.55, 0.85], serpent [0.3, 0.45, 0.35, 1.15].
- **Stand-in:** `ASSETS` (:66) gets `creature: async (type, color) => …createCreature({ type, animation: null })`, wrapped to the explorer model shape:
  - `materials` collected by traversal (each instance owns its material, creatures.js:103), tinted `m.color.set(color).lerp(white, 0.3)` (the car uses 0.15, :1026).
  - The body-centred rigs (flyer, swimmer, serpent) lifted by `-Box3.min.y` so the origin is the lowest point like every explorer; scaled to `entSize[type]`.
  - `clips` = the real names plus the aliases below (name and duration); `play(n, o)` → `c.play(ALIAS[type][n] || n, o)`.
- **`ExplorerView.sync` :1393-1421:** the last branch (`else this.use(entToy(type, …), "toy", type)`, :1421) shows the toy, then the creature. Generalize `loadDefault` (:1434; today `loadAsset("explorer")`, guarded by `this.type !== "person"`) to `loadAsset(type === "person" ? "explorer" : "creature", …)`, guarded by `this.type !== type`. `entToy` (:913-985) needs a cheap branch per type (or the blob toy): it stays the synchronous stand-in for `DecoyView` (:2425), `warmPlain` (:7162) and a failed load.
- **Clip aliases** (one table shared with entity3d.js; ExplorerView :1489 asks for idle / walk / run / jump / dig, and anim.js:717 speeds up walk and run):
  - flyer `{ idle: flap, walk: flap, run: glide, jump: flap, dig: land }`; swimmer `{ idle: swim, walk: swim, run: swim, jump: dart, dig: dart }`
  - crawler `{ walk: walk*, run: walk*, jump: idle, dig: idle }`; serpent `{ idle: coil, walk: slither, run: slither, jump: strike, dig: strike }`
  - hit and die keep their names; `*` = the generated gait (g). Dead explorers are hidden on the island (:5671), so "die" never plays there.
- **`ExplorerView.step`:** :1480 `const ground = isl.groundAt(...)` → also `base = ground + (TUNING.island.hover?.[this.type] || 0)`, used at :1489 (`p.y > base + 0.4 ? "jump"`) and :1510 (`st.grounded`); otherwise a hovering flyer always plays "jump". :1468 `g.position.set(p.x, p.y, p.z)`: a swimmer in water (`isl.height(p.x, p.z) < 0.3`) sinks ~0.3 m so its back and fin show above the water plane (y 0.05, :5604).
- **Preview card:** :1685 `isBody = entPlanetTypes.has(kind)` (entity3d builds the new types); :1709 `useKind` falls back to "ship" for a kind inflate.js lacks (fixed by (h)). `warmModel` (:7132) can also build one default per new type.

### (f) anims.js and anim.js
- **anims.js:157 `ROWS = { ship, person, car, quadruped, blob }`:** add four rows (helpers E / withVerbs :20-27, shape of the quadruped row :119-136), with real clip names and existing sockets:
  - flyer: `idle: idleBob`, `move: bank` (boost: clip "dive"), `jump: jumpSquash "flap"`, `primary: recoil` (fx at "nose"), `use: digLoop "land"`, `hit "hit"`, `die: flop "die"`, `celebrate "dive"`.
  - swimmer: idle and move "swim"; jump and primary a lunge with "dart" at "mouth". crawler: the quadruped row, "idle" for idle and defend, the generated "walk" for move.
  - serpent: `idle "coil"`, `move "slither"`, jump and primary a lunge with "strike" at "mouth", `defend: shieldPop "coil"`.
  - First step allowed: `ROWS.flyer = quadruped` and so on (missing clips are skipped by hasClip, anim.js:407).
- **anim.js:** :445 `if (biped || kind === "quadruped")` (landing squash, "land" clip): add crawler. :492-498 tilt: add `else if (kind === "flyer") { tg[RZ] = -turnS * 0.35; tg[RX] = -accel * 0.08; }` (banks like a ship instead of a walker's lean). :593 celebrate hop: add the four.

### (g) entity3d.js: a drawn creature (copy the uncommitted `loadQuadLibrary` / `quadClipSet`, :433-464)
- **Type tables:** :32 `ENTITY_SIZES`, :33 `RIG_OF`: add the four. :554 `sane()` turns any other type into a person: add the four and copy `spec.creature`. :1542 `assemble`: add buildFlyer / buildSwimmer / buildCrawler / buildSerpent (models: `buildQuadruped` :1006, `buildBlob` :1431).
- **Bones:** exactly the delivered names and parents, with IDENTITY rest rotations like `QUAD_BONES` (:280). Retarget reads rest rotations only, so ONE `retargetCreatureClips(type, bareTree)` serves every build and instance. Extra bones ("root", "dust", props) are fine. `_l` is +X (buildQuadruped; the GLB's wing_l_1 sits at x +0.24).
  - Flyer: `[["body", null], ["neck", "body"], ["head", "neck"], ["wing_l_1", "body"], ["wing_l_2", "wing_l_1"], ["wing_r_1", "body"], ["wing_r_2", "wing_r_1"], ["tail", "body"]]`.
  - Swimmer spine_1…spine_6 and serpent spine_1…spine_8 as chains, spine_1 at the head (-Z). Crawler `["body", null]` plus `leg_N_upper` (parent body) → `leg_N_lower`.
- **Clips:**
  - Generalize `loadQuadLibrary` (:435) to `loadCreatureLibrary(type, BONES)`, called for the four from `loadEntityClips` (:325; render.js:558 waits for it, 5 s cap). Add alias clips as `new THREE.AnimationClip(alias, src.duration, src.tracks)` (as quadClipSet adds run from gallop).
  - Crawler walk: write it like `quadClips` (:341) as alternating tetrapods (legs 1, 3, 6, 8 against 2, 4, 5, 7): uppers swing ±0.35 rad about Y, lowers lift. For its stand-in, reuse the deltas (rest · delta) or use `buildEntity({ type: "crawler" })`.
  - :1594 `clipsOf`, :1629 instance `clips`: the four kinds. :1595 `loops`: add flap, glide, swim, slither, coil, idle, walk.
- **Sockets per build:** the GLB ones plus the full blob set (centre, top, front, back, roof, seat, mouth, tail, head; `buildBlob` :1455), so items and anims.js fx always find one. `rig.patch` (the drawing): the side of the body for flyer and crawler; spine_3 for swimmer and serpent.
- **Budgets:** `Q` (:30): lite 2,600, phone 4,000, big (TV) 5,000 triangles, enforced by the detail loop in `buildEntity` (:1551); at most 3 draw calls (body, glow, patch).
- **Shapes:** flyer = ellipsoid body and head, two 2-plate wings (`plate` :203), tail fan; swimmer = six tapering ellipsoids and fins; crawler = body, head, 16 capsules (keep segments low: with 16 limbs, lite breaks first here); serpent = eight tapering capsules and a head.

### (h) inflate.js (the build when there is no body spec)
- :42-49 `KIND`: `flyer: { thick: 0.7, grow: 0.03, closes: [0.03, 0.06], backShade: 0.62, size: 2.0, side: true, bevel: 1 }`; `swimmer` (thick 0.85, size 2.0, side, bevel 1); `crawler` (thick 0.6, size 1.8, side, bevel 0.8); `serpent` (thick 0.9, size 2.6, side, bevel 1).
- Side kinds get the side sockets automatically (:631). Without an entry `inflateDrawing` builds a flat SHIP (:465), so this must ship with (c). Comments :3, :16-18, :27.

### (i) Copy, docs and tests
- **controller.html:** :1126-1127 explorer step subtitle "an astronaut, a car, a bike, an animal…" → e.g. "an astronaut, a car, an animal, a bird…". :1182 `COPY.innate` = verbs.js CARD_MOVE for the four (:2478 reads it). :1191 `noJump` "cars and bikes can't jump" → per type ("snakes can't jump"). :2496 `lockedItems` and :2540 `lockInfo`: car/bike tests → `V.jumps(entity.type)`.
- **hall-of-fame.html:** :204 `TYPE_WORD` (Flyer, Swimmer, Crawler, Snake), :205 `PLANET_TYPES`.
- **Docs:** PLAN.md:230 (how each explorer moves), :331 (what each type does by itself), :354 (fly and swim), :403-417 (the types table: four more "in play"); VERSIONS.md; TESTING.md.
- **Tests:**
  - dev/v14-test/scripts/entity.mjs:80-81 `EXPECTED_M` / `SIZE_TOL` (inflate sizes). dev/gen-corpus/index.json E30 "snake" (:3200-3208) expects ["blob"] → ["serpent", "blob"]. Add 2 corpus drawings per type, finger and photo (bird, dragon, fish, spider, worm).
  - A node probe per type like dev/v19-assets/quad-probe.mjs (build, lite budget, every clip finite, lowest point on the ground).
  - A world sim per type: hover height, reach over water, swimmer water speed, no snake jump, a flyer digs only when low. `?perf` on a phone with 8 creatures.

## 3. Risks and open questions
- **Needs Jaume: may a flyer fly over the sea?** Recommended: across bays and lakes inside the island circle, never off it. The alternative (stays over land, slides along the shore like walkers) needs no `walk` change.
- **Needs Jaume: how high does a flyer fly?** Recommended: a fixed 2.5 m hover, JUMP flaps up (one button; aiming and hints unchanged). The alternative is free height with RISE / SINK.
- **Needs Jaume: the swimmer:** amphibious (flops at 0.6× on land, 2.2× in water), water-only (can never open a chest), or no swimmer.
- **Needs Jaume: can a snake jump?** Recommended no: "snakes can't jump", like cars.
- **Needs Jaume: words and borderline drawings.** Words on the card, HUD and hall (flyer / swimmer / crawler / snake). Borderline: a four-legged winged dragon or a winged horse (flyer or animal?), an angel (person), an octopus as the explorer (swimmer, plus a generous ink bomb?). New strings go through the first-timer persona.
- **Reading cost:** four more types and the creature object lengthen every explorer read. Before turning the flag on, re-measure type accuracy and the 10 s promise on the corpus.
- **Retargeting onto drawn bodies** is proven only on a synthetic rig (CREATURES.md "Limits"); a flyer drawn with raised wings or a snake drawn coiled may flap or slither oddly. Build every body in the reference pose (wings along ±X, spine along Z), whatever the drawing's pose.
- **The crawler has no walk clip;** the written gait may make its feet slide.
- **Triangles:** the flyer (3,088) and crawler (4,956) stand-ins exceed the 2.6k lite budget of a drawn body, as the person (4,068) and car (4,776) stand-ins already do. Check a phone stays ≤ 120k triangles and ≤ 80 draw calls with 8 explorer meshes.
- **Pacing:** v1.9 makes 1-minute rounds the default (contract.js `pacing`, uncommitted). The flyer's water shortcut and the new speeds change chest times: re-run dev/v19-demo/balance-1min.mjs.
- **Shipping order:** today entity3d `sane()` turns an unknown type into a person and inflate.js into a flat ship. Ship every client layer before setting `ASTRA_CREATURES=1`.

## 4. nextTasks (about 60 minutes each)
For flyer and serpent only, run the same tasks without the crawler and swimmer entries (every table is a list).
```yaml
- label: creatures-tables
  goal: verbs.js types, RIG_OF, INNATE, CARD_WHAT / CARD_MOVE, jumps(); contract.js TUNING.island speeds, jumpers, hover, waterSpeeds, overWater and the entity docs (a contract change); rigs.js socket names
  owns: [verbs.js, contract.js, rigs.js]
  after: [Jaume's answers to section 3]
- label: creatures-read
  goal: astra-body.js TYPES, the creature object, prompt, normalize / defaultWhere / DEFAULT_ITEM / fromEntity; astra.js type lines, ASTRA_CREATURES flag, ASTRA_MOCK_EXPLORER; corpus E30 and new drawings
  owns: [astra-body.js, astra.js, dev/gen-corpus]
  after: [creatures-tables]
- label: creatures-world
  goal: world.js hover, reach over water, water speed, jump rules, the dig / pickup height check, refusal words; a world sim per type
  owns: [world.js]
  after: [creatures-tables]
- label: creatures-standins
  goal: render.js tables, ASSETS.creature with clip aliases, ExplorerView clip choice and hover / swim offsets, toys, decoys, warm; inflate.js KIND; anims.js rows and anim.js kinds
  owns: [render.js, inflate.js, anims.js, anim.js]
  after: [creatures-tables]
- label: creatures-entity3d
  goal: buildFlyer / buildSwimmer / buildCrawler / buildSerpent on the delivered bones, loadCreatureLibrary with aliases, the crawler walk, lite / phone / big budgets, a node probe like quad-probe.mjs
  owns: [entity3d.js, dev/v19-assets]
  after: [creatures-read]
- label: creatures-copy-qa
  goal: controller.html and hall-of-fame.html copy, PLAN / VERSIONS / TESTING; e2e per type with ASTRA_MOCK_EXPLORER, perf on a phone and the TV; then turn on ASTRA_CREATURES with Jaume
  owns: [controller.html, hall-of-fame.html, PLAN.md, VERSIONS.md, TESTING.md]
  after: [creatures-world, creatures-standins, creatures-entity3d]
```
