# A-005 — Tropical island kit

Original warm, low-poly island decoration for three.js **0.160.0**. Terrain samples the caller's authoritative `heightAt(x,z)` function; this module adds sand/grass/rock shading, seeded instanced props, palm LOD and breeze, turquoise water with shoreline foam, and late-afternoon sky/light. Units are metres, Y up, sea level 0. Prop origins are at the base.

## Larger island revision

The owner's requested larger island is now previewed at **840 m across, twice the width and four times the area**. Props retain their original metre sizes and heights. Use `size:840` and `createScaledHeightAt(baseHeightAt,2)` together. The base factory default remains 420 for existing integrations; a wider geometry alone does not enlarge the dry land.

**Authoritative gameplay must use the same height remapping and 840 m boundaries**, including landing/chest placement, movement, projectiles and grounding. The orchestrator has been asked through ORCHESTRATE.md to make that game-code change. The asset revision alone does not change server physics. If `Terrain.height` is itself updated to the 840 m convention, pass it directly instead of scaling it twice.

The approach preview uses a 2 m camera near plane for depth precision at long distance, and 0.1 m on foot. With a very small near plane from kilometre-range cameras, water can incorrectly overlap low shoreline terrain. Preserve appropriate camera depth precision in integration.

## Integration

Use the game's `three` / `three/addons/` import map and an HTTP server:

```js
import { createIsland, createScaledHeightAt } from './assets/A-005-island/island.js';

const island = await createIsland({
  seed,
  size: 840,
  heightAt: createScaledHeightAt((x,z) => Terrain.height(x,z,seed), 2),
  // Pass the actual gameplay landing pad and dig locations here.
  clearings: [{x: landing.x, z: landing.z, radius: 14}],
});
scene.add(island.object3d);

// In the existing frame loop, dt is seconds:
island.update(dt, camera);

// At island teardown:
scene.remove(island.object3d);
island.dispose();
```

Use the supplied island root with unit scale and no rotation; translating it is supported, but terrain/clearing/placement coordinates remain local. `heightAt` is required, finite and deterministic, and should accept the complete square including its shoreline. Sea level stays 0 in island coordinates. Physics and collision remain the game's responsibility. Avoid rendering the old terrain/water/sky or duplicate lighting alongside this kit. The returned `sunlight`, `ambient`, `water` and `sky` can be hidden when the integration supplies equivalents.

`createIsland` is asynchronous. It returns `object3d`, `terrain`, `water`, `sky`, `sunlight`, `ambient`, `batches` (Map), `placements`, `heightAt`, `clearings`, `update(dt,camera)`, `setLodMode(mode,camera)`, `getStats()` and `dispose()`. `placements` contains kind, variant, local position, uniform scale, yaw and sampled slope. Pass the active camera each frame. LOD selection runs every 0.25 s, selecting the closest palms first. `auto` upgrades palms within 85 m; `low` keeps all coarse; `high` still respects the triangle cap.

Standalone exports are `loadIslandProps()` (cached GLTF result), `createTerrainGeometry({heightAt,size,resolution})`, `createTerrainMaterial()`, `createScaledHeightAt(baseHeightAt,scale=2)` and `ISLAND_LIGHTING`. Treat loaded templates as read-only. All GLB meshes are intentionally superimposed at the origin; use named templates, not the entire GLB scene.

| Option | Default | Behaviour |
| --- | --- | --- |
| `seed` | 1 | Integer, deterministic decoration |
| `size` | 420 | Terrain square width; water spans 30× this |
| `resolution` | 160 | Segments per axis, supported 16–192 |
| `palmCount` / `bushCount` | 300 / 160 | Maximum placements, each integer 0–1000 |
| `rockCount` / `cliffCount` | 80 / 20 | Maximum placements, each integer 0–1000 |
| `clearings` | `[{x:0,z:0,radius:12}]` | Circular exclusions, plus spacing margin |
| `triangleBudget` | 150000 | Hard cap for this module; lower it to reserve room for other assets |
| `palmDetailDistance` | 85 | Local metres, nearest-first upgrades within cap |

Placement filters use elevation, slope, spacing and clearings. A seed or heightmap without enough eligible area returns fewer props; inspect `getStats().counts`. Density/resolution that already exceeds the cap at low LOD throws, rather than silently violating the budget. Clearings remove decoration only: they do not flatten terrain. Supply landing/dig exclusions before building. Rebuild when seed/heightmap/clearings change.

## Geometry and visible cost

`island_props.glb`: **258,468 bytes**, 13 named meshes, one shared opaque double-sided PBR material with vertex colours, no textures, no animation, no external buffers or decoders. Total catalogue geometry is 2,410 triangles.

| Names | Triangles each | Calls per populated instanced batch |
| --- | --- | --- |
| `palm_1`, `palm_2`, `palm_3` | 482 | 1 |
| `palm_1_lod`, `palm_2_lod`, `palm_3_lod` | 140 | 1 |
| `bush_1`, `bush_2` | 100 | 1 |
| `beach_rock_1`, `beach_rock_2`, `beach_rock_3` | 80 | 1 |
| `cliff_1`, `cliff_2` | 52 | 1 |

Palms are approximately 9.11 / 10.91 / 7.41 m tall before scatter scaling (0.72–1.28). LOD pairs preserve height. Bushes are about 1.45 m, beach rocks 1.60 m, and cliff pieces 5.2 m before scaling. Palms have curved ringed trunks, swept fronds, separate high-detail leaflets and coconuts. Cliffs are modular low-poly pieces, not a continuous cliff wall.

**Verified seed 73, 840 m footprint, default density/resolution, 14 m centre clearing:** 300 palms, 160 bushes, 80 rocks, 20 cliffs. All low = **117,774 triangles / 14 calls**. Maximum-detail mode upgrades 94 nearest palms = **149,922 / 17**. Counts include the 51,200-triangle terrain, water, Sky cube, and 1,120-triangle ground-contact decal batch. Real renderer counters match both cases. `getStats()` reports currently visible module meshes; hiding the root returns zero visible triangles/calls. Its counts exclude external ships, explorers, chests and effects.

Terrain/props use PBR; Water and Sky use their upstream shader materials. The module allocates one **512×512 linear water-normal map** (238,462 bytes), one generated **256×256 shoreline-height map**, and one **64×64 contact-alpha map**. Terrain and prop colours need no colour textures. The Water constructor has a **1×1 unused mirror texture**; its reflection callback is replaced and the shader does not sample it. No shadow maps, mirror passes, environment capture or postprocessing is created.

## Lighting and water

`ISLAND_LIGHTING`: sun elevation 18°, azimuth −115°, directional intensity 3.0, hemisphere intensity 2.1; Sky turbidity 5.5, Rayleigh 1.65, Mie coefficient 0.004, directional G 0.82. Water distortion 1.2, warm sun `#ffe3bd`, water base `#1ba697`; custom depth tint moves from turquoise shallows to teal deep water, with animated foam. Preview uses ACES exposure 0.85 and optional exponential fog `#afd5cf`, density 0.00035. The module itself does not change renderer tone mapping, fog, pixel ratio or global background.

The mobile water path uses the actual [r160 Water add-on](https://github.com/mrdoob/three.js/blob/r160/examples/jsm/objects/Water.js) and [Sky add-on](https://github.com/mrdoob/three.js/blob/r160/examples/jsm/objects/Sky.js). Water's default reflected-camera callback is replaced by an eye-uniform update; a constant sky tint substitutes the reflection sample. This modification is version-specific and guards the expected shader source. One scene render produced exactly one renderer invocation, verifying no nested reflection render. Do not restore the upstream callback on phones.

## Verification and limits

- `python3 assets/A-005-island/validate.py`: nine structural checks on the exported binary, every index/normal/colour, names/origins, shared PBR, LOD heights, budgets and PNG dimensions. `validation.json` records SHA-256 hashes.
- `preview.html` / `browser-validation.json`: **16 real r160 browser checks**, including doubled terrain width/unchanged height convention, seeded determinism, clearings, placement heights, actual high/low GPU submission counts, shader compilation, reflection render count, safe independent disposal and terrain sampling.
- Visually inspected all 13 prop meshes, both palm LODs, landing approach, beach and island interior at 1440×1000, plus the three island views at 390×844. Saved `preview-*.png` files are the evidence. Final Chrome session: **0 console errors / 0 warnings**.
- Grid vertices match `Terrain.height` to less than 0.000001 m for seed 73. Across **961 off-grid ray samples**, the rendered interpolation differed from the analytic height function by **0.0458 m mean / 0.3665 m maximum**. Keep gameplay grounded by its authoritative height function; occasional visual foot/prop gaps on sharp terrain changes may need integration adjustment. These samples do not bound every seed.
- Water's 256 px depth field encodes −16..64 m with about 0.314 m height quantization; sea/shore foam is visual, not physics. Root-level sea height, shoreline mapping and lights assume the terrain convention above.
- Contact shading is a cheap flat alpha decal per prop. It may clip or float on steep slopes; it is not a projected or terrain-conforming shadow. No collision meshes, landing-pad terrain flattening, dynamic ocean geometry, underwater view or navigation is supplied.
- LOD switches are discrete. Whole-island instancing uses conservative visibility (no per-instance frustum culling), so budget figures include every placed prop. Resource disposal releases instance buffers and owned terrain/shader textures while retaining cached shared prop geometry/water normals for subsequent islands.
- **Physical iPhone 12/XR FPS, Safari shader behaviour and full multiplayer integration are unverified.** Phone-size screenshots are desktop Chrome at a narrow viewport. The integration's real-phone `perf.log` remains the acceptance evidence.

## Rebuild and preview

```sh
/opt/homebrew/bin/blender --background --python assets/A-005-island/generate.py
python3 assets/A-005-island/validate.py
python3 -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8766/assets/A-005-island/preview.html`. `island_source.blend` contains editable original meshes. `generate.py` rebuilds the GLB, normal map and `prop-manifest.json`; `island.js` builds terrain and decoration at runtime. Blender 5.2.2 was used for export. All custom geometry, texture, source and screenshots are original CC0-1.0. three.js/add-ons retain their upstream MIT license. No game integration files were changed.
