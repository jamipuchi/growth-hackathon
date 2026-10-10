# A-001: hostile armoured boss

Original CC0 geometry for Space Party's single-boss v1. The boss has red seams,
small sensor ports and mechanical housings across three shell states, plus a
red exposed core. Dark armour and bevels share one vertex-colour material.
The intact boss measures **29.287 × 27.602 × 29.658 m**. Y is up, the opening
faces **-Z**, and the origin and empty `socket_core` sit at the radial centre.

`decoy.glb` is the unchanged legacy asset. It has no core or red seams and
no longer matches the revised boss. It is retained for compatibility and is
not part of the current v1 game.

## Integration

```js
import {
  createBossEncounter,
  setArmourState,
} from './assets/A-001-boss-rock/boss.js';

const encounter = await createBossEncounter({ decoyCount: 0 }); // v1: one boss
scene.add(encounter.boss);

setArmourState(encounter.boss, 'armour_cracked');
setArmourState(encounter.boss, 'armour_broken'); // reveals the red core
const socket = encounter.boss.getObjectByName('socket_core');

// Call once per frame; dt is finite, nonnegative seconds.
encounter.update(dt);

// When permanently removing this encounter:
scene.remove(encounter.boss, ...encounter.decoys);
encounter.dispose();
```

The helper returns `{ boss, decoys, setArmourState, update, dispose }`.
It does not position entities. The legacy default is still four decoys;
explicitly pass `decoyCount: 0` for v1. A nonnegative integer selects the
legacy decoy count. With zero, the decoy file is not requested.

Direct GLTFLoader loading also works. Call `setArmourState(gltf.scene)`
before adding it to the scene: glTF does not encode runtime visibility, so an
unconfigured load shows all three shells and the core together.
`initially_visible` extras are metadata only. The stable group names are
`armour_intact`, `armour_cracked`, `armour_broken` and `core`.
GLTFLoader may place separate primitive meshes beneath each shell node.

## Pulse and ownership

`updateBoss(object3d, dt)` drives a **0.8 Hz** sine pulse on the core group:
local scale ranges from **96.5–103.5%** of its rest scale, and core emissive
intensity ranges from **60–110%** of the authored value. The core light's
authored intensity is 5.5, so the pulsed range is 3.3–6.05. Seams retain their
authored intensity of 3.6. The pulse is implemented in JavaScript, not a GLB
animation clip, and its clock continues while the core is hidden.

On first update the helper clones the emitting core material so each
independently loaded boss can pulse without changing another's material.
`disposeBossPulse(object3d)` releases those pulse clones and restores source
materials and rest scale. Use it when managing a directly loaded GLB yourself.

`encounter.dispose()` also disposes the encounter's geometries and materials,
deduplicating resources shared by legacy decoy clones. Remove the objects from
the scene and stop updating them first. The method is idempotent; subsequent
encounter updates are ignored. Decoys share
geometry and materials but have independent transforms and shell visibility;
clone a material before tinting one decoy individually.

For independent bosses, create separate encounters. A raw `Object3D.clone(true)`
still shares geometry/material resources and is not a separately owned
encounter; do not dispose the original while such copies remain in use.
Custom loaders passed as `{ loader }` must return resources owned by this
encounter, rather than resources cached and shared with another live encounter.

## Cost

| Visible state | Boss triangles / draw calls | Legacy decoy triangles / draw calls |
| --- | --- | --- |
| Intact | 3,234 / 2 | 1,440 / 2 |
| Cracked | 2,692 / 2 | 1,236 / 2 |
| Broken | 2,612 / 4, including core | 654 / 2 |

All boss states are within **15,000 triangles / 4 draw calls**. Each shell uses
one non-emissive vertex-colour armour primitive and one red seam primitive.
The broken state's core adds two primitives. The complete boss stores **8,538
triangles** across all states; the complete decoy stores 3,330. Hidden state
geometry still occupies memory.

- `boss.glb`: **884,640 bytes**. `decoy.glb`: **238,100 bytes**.
- Zero textures, embedded buffers only, no Draco, meshopt or KTX2 decoder.
- PBR metallic-roughness materials with `KHR_materials_emissive_strength`.
- No point lights, shadow maps or postprocessing baked into the asset.
- Bloom, if desired, is supplied by the game; it adds costs beyond this table.

Legacy decoy SHA-256:
`603de7f5577c8c58375492c570e153bae5901755aaaa1bff411ffaa52920ab54`.

## Rebuild and verification

From the repository root:

```sh
blender -b --python assets/A-001-boss-rock/generate.py
python3 assets/A-001-boss-rock/validate.py
python3 -m http.server 8766 --bind 127.0.0.1
```

The generator rebuilds `boss.glb` and `boss_source.blend` with seed 240109.
It deliberately does not overwrite the legacy decoy. The source Blender file
opens with the intact state visible.

`validation.json` records successful structural verification of the current
revision: decoded finite accessor values, unit normals, valid indices,
nondegenerate triangles, accessor and transformed bounds, stable names and
central socket, PBR materials, red emission in every shell and core, per-state
budgets, and the exact preserved decoy hash. These are file-level checks.

Review the current revision at
[the local preview](http://127.0.0.1:8766/assets/A-001-boss-rock/preview.html).
`browser-validation.json` records **17 passing checks** using the actual GLBs
and three.js r160: boss-only loading, visibility, authored node names, PBR,
socket, red seams, measured render calls/triangles, pulse ranges and independent
materials, live-clone source restoration, idempotent disposal, legacy decoy
behaviour, disabled shadows and shader compilation. `browser-console.txt` has
zero errors and warnings. The anonymous export scene wrapper is not an authored
node name. The preview uses no environment capture or reflection render.

The current `preview-desktop*.png`, `preview-phone*.png` and
`preview-landscape*.png` captures were reviewed at **1440 × 1000**, **390 × 844**
and **844 × 390**. All three states were checked with the camera **100 m** from
the centre; the reactor close-up is 48 m away. Rear seams, sensor ports, the
broken core and bloom-off fallback were also checked. ACES maps the brightest
emissive centres toward warm white; the bloom halo carries the strong red cue.
The bright core remains visible with bloom disabled. These are desktop Chromium
viewport checks, not WebKit or physical-phone frame-rate evidence.

Physical iPhone performance, visibility against the final nebula and end-to-end
game integration remain unverified. Orient the exposed -Z cavity toward the
gameplay approach when the reveal matters. Call `encounter.update(dt)` or
`updateBoss(clonedBoss, dt)` to animate the core; direct GLB loading alone does
not pulse it. Release each raw clone's pulse materials with `disposeBossPulse`
before disposing the encounter resources it shares.

## License

All geometry and custom source in this directory are original work dedicated
to CC0-1.0. No third-party textures, scans, models or generated images were used.
Three.js and its add-ons retain their upstream MIT license. Blender was used
for authoring and export.
