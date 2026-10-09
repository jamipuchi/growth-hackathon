# A-006 · Treasure chest

Original low-poly teak chest with worn brass straps, lock, handles, gold coins and ingots. Front faces **-Z**, Y is up, metres; origin is the centre of its base. The closed chest is approximately **1.74 × 1.00 × 1.14 m**. The open lid settles at 100° after a small 106° overshoot.

| File/state | Triangles | Asset draw calls | Embedded maps |
| --- | ---: | ---: | --- |
| `chest.glb`, closed or open | 2,964 | 2 | Two 128 × 128 PNGs |
| `buried.glb` | 252 | 1 | Two 128 × 128 PNGs |
| `dig_hole.png` with helper | 2 | 1 additional | One 512 × 512 RGBA PNG |

Both GLBs use one standard PBR material with vertex colours, a roughness/metalness palette, and an emission palette. Only selected gold pieces and the buried glint emit; wood, brass straps and sand do not. No lights, shadow maps, reflection passes, Draco or texture decoders are required. The chest's two calls are its rigid body and animated lid. **Adding the optional hole beneath the chest makes three total calls**; omit or hide it when the chest is visible if a strict two-call encounter budget is required. The buried mound replaces the chest, rather than rendering over it.

```js
import { createChest, createDigHole } from './assets/A-006-chest/chest.js';

const treasure = await createChest({ state: 'buried' });
treasure.object3d.position.set(x, groundHeight, z);
scene.add(treasure.object3d);

// After gameplay digging has finished, reveal and open over exactly one second.
treasure.open();
// Each render frame, with elapsed seconds:
treasure.update(dt);

// Immediate state changes, without an opening animation:
treasure.setState('closed');
treasure.setState('open');
treasure.setState('buried');

// Optional excavation mark. This does not deform the ground.
const hole = await createDigHole({ width: 2.7, depth: 2.15 });
hole.object3d.position.set(x, groundHeight + 0.012, z);
scene.add(hole.object3d);
```

`treasure.state` is `closed`, `opening`, `open` or `buried`. Repeated `open()` calls preserve the running/finished opening; `open({restart:true})` replays from closed. `setGlow(strength)` changes instance emission (default 2.4), for the game's bloom pass. It does not add dynamic lighting. `sockets.treasure` marks the centre of the gold, `sockets.lid` moves with the lid, and `sockets.glint` marks the buried corner. Visibility/state management does not remove sockets from the scene; use the current state to choose an attachment.

`chest.glb` is closed when loaded directly with GLTFLoader. It has one `open` clip: exactly 1.0 s, 31 samples at 30 fps, a single `chest_lid` quaternion track. Set it to `THREE.LoopOnce`, enable `clampWhenFinished`, and update an AnimationMixer in seconds. It has no translation/scale animation, bones or morphs. Embedded material extension `KHR_materials_emissive_strength` is supported by r160.

`createChest()` caches the two source GLBs and clones scene nodes/materials for each instance. Geometry and textures remain shared; lid/state/glow changes are independent. Remove an instance from its scene and call `.dispose()` to release its mixer/materials; cached source resources remain available. The optional decal owns its own geometry/material/texture and releases them via `hole.dispose()`.

## Verification

- `python3 assets/A-006-chest/validate.py` inspects exported GLB binary data, budgets, legal names, indices, finite coordinates, palette UVs, embedded PNG pixel colours, gold-only emission, exact animation timing/quaternions and decal alpha. Requires Pillow.
- `browser-validation.json` captures 16 passing checks in actual **three.js 0.160.0 / GLTFLoader**, including renderer-reported calls/triangles in all three states, 31 animation samples, final angle, replay, repeat calls, state resets, independent material settings, resources after disposal and decal settings.
- Visually checked closed/open/buried/decal at 390 × 844; desktop gallery, open interior, mid-opening frame and rear hinge at 1440 × 960. Final browser console: 0 errors / 0 warnings. PNGs are included here.
- **Physical iPhone 12/XR Safari FPS and live game integration remain unverified.** These are desktop browser screenshots at phone viewport dimensions. No phone frame-time claim is made. Preview bloom is illustrative; use the game's existing bloom configuration.
- The hole is a flat transparent decal suited to locally level sand. On slopes, align it to the ground normal or use the game's terrain projection. It creates no collision, hole geometry, digging particles or treasure rewards. The decorative mound has no collision contract.
- Standard opaque materials are double-sided so thin corner/mound surfaces remain readable. There are no runtime shaders beyond standard PBR.

## Source and preview

`chest_source.blend` is editable source for both variants. `generate.py` generates all meshes, colours, maps, animation and the alpha decal, using seed 6006. Rebuild with:

```sh
/opt/homebrew/bin/blender -b --python assets/A-006-chest/generate.py
python3 assets/A-006-chest/validate.py
```

Serve the repo root with `python3 -m http.server 8766 --bind 127.0.0.1`, then open `http://127.0.0.1:8766/assets/A-006-chest/preview.html`. The preview requires the r160 CDN modules. Its gallery contains multiple assets and optional bloom passes, so total preview renderer cost is not the per-asset cost in the table.

All custom art, animation, textures and source are original **CC0-1.0**. No external artwork. Blender and three.js/add-ons retain their own upstream licenses. Export warning about shared texture samplers is benign: both palette maps deliberately use the same UVs/sampler and their decoded content was verified.
