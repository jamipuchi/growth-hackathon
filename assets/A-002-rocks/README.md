# A-002: six rock types, eighteen shapes

Original CC0 assets for three.js 0.160.0. `rocks.glb` contains the mesh nodes
`stone_1..3`, `iron_1..3`, `volatile_1..3`, `crystal_1..3`, `magnet_1..3`, and
`splitter_1..3`. Every node has one primitive and shares its material with the
other two variants of its type. All meshes have a maximum radius of **1 metre
from the origin**; use uniform scale for the desired gameplay radius. Y is up.
Geometry is centred by signed-volume centre of mass before normalisation.

- Stone: chunky warm grey facets.
- Iron: dark metal with pale mineral veins.
- Volatile: dark stone with emissive orange fracture edges.
- Crystal: violet-white translucent pointed clusters.
- Magnet: a dark red equatorial band between grey caps.
- Splitter: two closed halves separated by a visible open seam.

## Integration

```js
import { loadRocks, createRockField } from './assets/A-002-rocks/rocks.js';

const templates = await loadRocks();
const rocks = [
  { id: 'r0', type: 'stone', variant: 1, position: [5, 3, -30], radius: 2 },
  { id: 'r1', type: 'volatile', variant: 3, position: [-4, 0, -25], radius: 4 },
];
const field = createRockField({ templates, rocks, seed: 2026 });
scene.add(field.object3d);
field.hide('r0'); // destroy/hide without reallocating a batch
// When unloading:
field.object3d.removeFromParent();
field.dispose();
```

`variant` is 1–3; omit it for a deterministic seeded choice. `quaternion` is
optional `[x,y,z,w]`, default identity. `radius` is a radius, not a diameter.
The caller maps the game's wire format and decides radius semantics.
`handles` maps IDs to `{type,index}`; `batches[type]` exposes the InstancedMesh
for integration that needs `setMatrixAt`. Recompute its bounding sphere after
moving instances. Gameplay owns collisions and damage.

**Six draw calls for all eighteen shapes:** each type batches its three geometries
into one buffer. An instance attribute selects its shape, collapsing unused
variants to degenerate triangles in the standard material's vertex shader.
The unused triangles still incur vertex work and are included in the budgets
below. There are no per-instance materials or reflection/shadow passes.

The helper's `onBeforeCompile` hook is part of the six-call path; retain it if
adding other shader customisations. The GLB itself is ordinary glTF, without
custom shader requirements. Direct instancing of each named geometry works too,
but three meshes per type take up to eighteen calls. Do not add the loaded GLB
scene directly: all eighteen template meshes are intentionally at the origin.

Built-in raycasting on the batched buffer sees all three source variants.
Use the game's logical sphere collisions/IDs, or the individually loaded
templates if exact shape raycasting is needed. Shadow rendering is disabled;
there is no matching custom shadow shader for variant selection.

## Resource ownership

`loadRocks` returns caller-owned template geometries and shared source materials
and maps. Reuse them across fields. `field.dispose()` releases its merged buffers
and cloned materials, preserving templates and shared textures. When all fields
are gone, dispose template geometries and deduplicate materials/maps before
disposing those. Dispose is intended for scene teardown; don't call `hide` after it.

## Measured budgets

| Type | Triangles per shape | Submitted triangles per instance in six-call helper |
| --- | ---: | ---: |
| Stone | 80 | 240 |
| Iron | 80 | 240 |
| Volatile | 80 | 240 |
| Crystal | 72 | 216 |
| Magnet | 80 | 240 |
| Splitter | 44 | 132 |

`rocks.glb` is **175,020 bytes**, with **six materials** and two shared embedded
**512 × 512** PNG maps (colour and emission). No normals map, external resources,
Draco, meshopt, KTX2, transmission, or refraction passes. Colours/emission use sRGB.
Roughness and metalness are scalar PBR factors. Only volatile seams are emissive.

The 200-instance preview renders **six draw calls / 43,644 submitted triangles**.
Chrome on this Mac captured 180 requestAnimationFrame intervals: median 8.3 ms,
p90 8.5 ms at 1440 × 960, DPR 1. These are desktop presentation intervals, not
GPU timings and **not evidence of iPhone Safari frame rate**. Physical iPhone 12/XR
validation with the game's `perf.log` remains for integration.

Crystal uses front-face alpha blending at 0.82 opacity, with depth writes disabled
in the helper. Overlapping transparent instances are not individually sorted;
this deliberately avoids a second geometry/reflection pass. Check this in gameplay.

## Validation and previews

```sh
blender -b --python assets/A-002-rocks/generate.py
python3 assets/A-002-rocks/validate.py
python3 -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8766/assets/A-002-rocks/preview.html`.
The page can show all variants, a 200-instance field, and a single type at 50 m.
`rocks_source.blend`, the generator and both atlas PNGs are editable originals.
The textures are also embedded in the GLB; shipping the standalone PNGs is optional.

`validation.json` records the final GLB hash, all mesh budgets, embedded image
dimensions, nonblack pixel counts, correct palette UVs, names, and unit radii.
`browser-validation.json` records twelve passing load/batching checks on r160,
including deterministic selection, alpha, emission, material sharing and hiding.
The browser console had zero errors or warnings.

Visually inspected all eighteen variants at 1440 × 960, all six first variants
at a 390 × 844 viewport / 50 m distance, and the 200-instance field. Actual captures
are `preview-desktop.png`, `preview-200.png`, and `preview-phone-<type>.png`.
Lighting in the final nebula and physical-phone performance still need verification.

## License and sources

All geometry, textures and custom source here are original procedural work,
dedicated to CC0-1.0. No external textures, scans or models were used. Blender
5.2.2 was the authoring/export tool. Three.js/add-ons are loaded from the game's
existing CDN and retain their upstream MIT license.
