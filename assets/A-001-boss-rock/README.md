# A-001: armoured boss and decoys

Original CC0 procedural geometry, authored for Space Party. Three watertight-block
shell states share the same design in both files. The decoy has no core mesh.
The fractured front faces **-Z**. Y is up; the origin is the asteroid's radial centre.
The intact asteroid measures approximately **27.6 × 27.4 × 29.7 m**.

## Integration

```js
import { createBossEncounter, setArmourState } from './assets/A-001-boss-rock/boss.js';

const { boss, decoys } = await createBossEncounter(); // 4 independent decoys
scene.add(boss, ...decoys);
// Set positions using gameplay coordinates; the loader leaves each at the origin.
setArmourState(boss, 'armour_cracked');
setArmourState(boss, 'armour_broken'); // also shows the boss core
setArmourState(decoys[0], 'armour_cracked'); // hollow, no core
const socket = boss.getObjectByName('socket_core');
```

Direct GLTFLoader loading also works. **Call `setArmourState(gltf.scene)` before
adding it to the scene.** glTF does not encode runtime visibility; otherwise all
three shell states and the core render together. `initially_visible` extras are
metadata only. `armour_intact`, `armour_cracked`, `armour_broken` and `core` are
named group nodes. `socket_core` is an empty node at the centre.

Decoy clones share geometry and materials, but not visibility or transforms.
Treat the material objects as shared; clone a material before individual tinting.
The helper intentionally does not dispose shared resources or position entities.
An application disposing this encounter should deduplicate geometry/materials.

## Cost

| Visible state | Boss triangles / draw calls | Decoy triangles / draw calls |
| --- | --- | --- |
| Intact | 1,440 / 2 | 1,440 / 2 |
| Cracked | 1,236 / 2 | 1,236 / 2 |
| Broken | 1,620 / 4 (including core) | 654 / 2 |

- `boss.glb`: 313,516 bytes. `decoy.glb`: 238,100 bytes.
- Zero textures, no external buffer files, no compression/decoder requirements.
- MeshStandardMaterial-compatible metallic-roughness materials.
- `KHR_materials_emissive_strength` is used for the core and loads in r160.
- Inactive states stay in GPU memory, even though they do not draw: the complete
  boss stores 4,296 triangles; the complete decoy stores 3,330 triangles.
- Bloom is supplied by the game's existing postprocessing. A surrounding point
  light is optional and is not baked into the asset.

## Rebuild and review

From the repository root:

```sh
blender -b --python assets/A-001-boss-rock/generate.py
python3 assets/A-001-boss-rock/validate.py
python3 -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8766/assets/A-001-boss-rock/preview.html`.
The preview uses the repository's exact three.js **0.160.0** CDN and real GLBs,
with bloom and state switching. The 100 m button uses a perspective camera
100 world units from the selected asset's origin. It does not resize the asset.

`boss_source.blend` is editable. `generate.py` rebuilds it with seed 240109.
`validation.json` records structural checks, budgets and SHA-256 checksums.
The browser checks exact shell equality, four independent decoys, initial
visibility, material types, sockets, emissive strength and budgets.
`preview-desktop.png` and `preview-phone-*.png` are actual browser captures.

Desktop and **390 × 844** viewport visual checks passed. The three states are
distinct, the decoys are hollow, and the broken boss core blooms. This is desktop
browser verification at phone dimensions, **not physical-phone FPS evidence**.
Visibility against the final nebula, comparison with normal rocks, and end-to-end
game integration still need orchestrator verification. The exposed cavity faces
-Z, so orient that face toward the gameplay approach when the reveal matters.

## License and sources

All delivered geometry and custom source in this directory are original work
dedicated to CC0-1.0. No third-party textures, scans, models or generated images
were used. Three.js and its add-ons are referenced from the existing CDN and
retain their upstream MIT license. Blender was used as the authoring/export tool.
