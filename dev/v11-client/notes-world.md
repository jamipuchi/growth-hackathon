# world agent: notes (v1.1 client track)

Owner of: render.js "world look" regions (backdrop, stars, space lights/fog, nebula, decorative rocks, boss look, planet look,
boss shots, trail emission lines, fx(), chests, island lights/sky, bloom/exposure lines in frame()) and the sound synth.
Can be cut off any time: read this first. The entities agent edits other regions of render.js at the same time: re-read before
every Edit, keep edits surgical.

## Status (update as I go)
- [x] 0. read SPEC, CONTRACT, PLAN, contract.js, world.js, render.js, assets A-001/2/4/6/10/11
- [x] 1. sound synth: `export { sfx }` + `game.sfx` (startGame hook line), WorldSound (fx, boost, bullets, boss shots, landing,
      take-off, phases, last-10-s countdown, volume by distance from the camera's subject)
- [x] 2. StreakBatch (laser streaks, 1 draw call): player bullets brighter, boss shots long red lasers + glow; trails longer/brighter
- [x] 3. backdrop: procedural noise nebula (fallback) + A-011 sky when it loads (phone: shrunk to 1024x512) + its light probe;
      more stars (2 Points layers), saturated lights, lighter fog, exposure/bloom retuned
- [x] 4. planet in view from the start (A-004, locked), visual radius = max(40, 0.12 x distance) (>= 6.9 deg), landing region
      turned to face the spawn, sun matched to the key light, phone maps shrunk to 1024x512, unlock burst + range ring,
      procedural fallback + shimmer shell. `game.space.planet` = unlocked planet data only (unchanged meaning)
- [x] 5. decorative asteroid field (600 big / 250 phone small rocks near the boss) + 14 / 8 huge rocks beside the route,
      tumble + bob in the vertex shader, dissolve when the camera is inside them
- [x] 6. mothership boss: hull 1.25 x hit radius (A-001 scale 25/13), ring + spokes + spires (2 merged meshes), 24 running ring
      beacons + 10 spire-tip beacons (glow batch), pulsing core, red halo, red point light, armour state follows hp
      (intact > 66%, cracked > 33%, broken)
- [x] 7. chests: ONE instanced mesh for all chests (buried: mound + X + patch; rock: gold-seamed boulder of loose plates;
      chest body + lid), drill sparks / shake / shatter, assist beams (StreakBatch)
- [x] 8. island: stronger sky/ground fill, warm key, cool rim, bluer sky, exposure 0.74 big / 1.02 phone
- [ ] 9. (optional) A-010 fx (not done: own particle pool already covers it within the budget)
- [ ] 10. final report; things only a browser can verify (see below)

## Verification done (no browser)
- `node dev/v11-client/check-syntax.mjs render.js` OK after every edit.
- CPU-only smoke tests in /tmp/world-draft/harness (Node, stubs for the DOM, no WebGL): SpaceWorld + IslandWorld constructed,
  setWorld / update / fx run for big and phone, A-004 + A-001 load paths, fallbacks, planet scale math, boss states, chest
  state machine, sound hooks. Shader code (GLSL) is NOT compiled by any of this: first browser run must check the console.

## Design decisions (so a successor does not re-derive them)
- New top-level code lives just above the dashed rule preceding `// Island scene (mode "planet")` (search "World look").
- Planet visual is separate from `game.space.planet` (that one stays "unlocked planet data only").
- Chests: not the A-006 asset any more (20 chests x 2-3 draw calls and 3k triangles each would blow the phone budget): one
  instanced procedural mesh, ~540 triangles per instance (all parts, collapsed ones are degenerate).
- Sun direction per round: from the left-up-behind of the spawn->planet route (`SpaceWorld.setLook`).

## How to resume
Search render.js for "World look". Pieces: sfx + WorldSound, StreakBatch, decor (chunkyRockGeometry, planDecoRocks, DecoField),
makeBossStructures, PlanetLook (+ makeRangeRing, makeShieldShell, shrinkPlanetMaps, loadShrunkTexture), ChestField
(buildChestGeometry, chestMaterial), SpaceWorld.{setLook,setBoss,applyBossState,setPlanet,updateShots,updateBoss,updatePlanet}.
