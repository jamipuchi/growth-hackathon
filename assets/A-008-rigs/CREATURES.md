# A-008 creature rig library

Original CC0 neutral reference creatures for Space Party: a toy hound, bird, fish, eight-legged crawler and serpent. They supplement the existing person library without changing it. Each export is Y up, forward −Z, metres, one skinned mesh and one vertex-colour MeshStandardMaterial-compatible primitive. No images, decoders, lights or shadow passes.

| File | Triangles / calls | Bones | Clips | GLB bytes |
| --- | --- | --- | --- | --- |
| quadruped.glb | 4,344 / 1 | 19 | 10 | 742,356 |
| flyer.glb | 3,088 / 1 | 8 | 6 | 443,184 |
| swimmer.glb | 2,356 / 1 | 6 | 4 | 374,704 |
| crawler.glb | 4,956 / 1 | 17 | 3 | 683,948 |
| serpent.glb | 2,340 / 1 | 8 | 5 | 380,660 |

All 28 clips contain rotation-only quaternion channels, sampled at 30 fps. Loop endpoints match. Exact names, seconds, loop flags, hierarchy and sockets are in `<type>-clips.json`; file hashes and independent binary checks are in `creatures-validation.json`. Skin weights have at most two influences (one on the hound, bird and crawler).

## Load and play

```js
import { createCreature } from './assets/A-008-rigs/creatures.js';
const pet = await createCreature({ type: 'quadruped', animation: 'walk' });
scene.add(pet.object3d);
pet.update(dt); // once per frame, seconds
pet.play('bite', { fade: 0.12 });
// At removal:
scene.remove(pet.object3d);
pet.dispose();
```

`type` is quadruped, flyer, swimmer, crawler or serpent. Default actions are idle, flap, swim, idle and slither respectively. `animation:null` retains the reference rest pose. `play(name,{fade,loop,restart})` supports blended transitions, held one-shot endings and replay. Repeated calls preserve an already running action. A disposed instance rejects play; update becomes a no-op. Negative/nonfinite delta time is rejected.

Returned fields include `object3d`, `bones` (Map), `sockets` (plain object without the `socket_` prefix), `clips`, `metadata`, `mixer`, `action` (current action), `play`, `update` and `dispose`.

The helper caches source GLBs and clip metadata per module realm; failures can retry. Each instance owns its bones, bind inverses, material and animation state. Resized instances also own their rebound geometry. Dispose releases those resources and the internal bone texture. Shared source geometry stays cached. Remove the instance from its scene before disposing it; do not dispose cached source geometry yourself.

**GPU texture accounting:** there are zero authored image textures, but three.js r160 allocates one RGBA32F bone palette per rendered instance. Measured palettes are 4 KiB for quadruped/crawler and 1 KiB for flyer/swimmer/serpent. The runtime tests verify that these are released on disposal. Do not call this zero GPU textures.

## Retarget to a drawn creature

```js
import { createCreatureAnimator, retargetCreatureClips } from './assets/A-008-rigs/creatures.js';
// target must be in its bind/rest pose, with the exact named hierarchy.
const motion = await createCreatureAnimator('quadruped', target, { animation: 'idle' });
motion.play('gallop');
motion.update(dt);
// Apply game procedural offsets after this update.
motion.dispose();
// Or obtain converted clips for an existing, sole mixer:
const clips = await retargetCreatureClips('quadruped', target);
```

Only one mixer should control a target skeleton. The conversion adjusts quaternion deltas for differing bone rest bases, preserving the target's own lengths. Missing bones or incorrect parents throw. These clips do not add root travel or reposition the whole entity; game movement remains authoritative.

## Proportion preview

`createCreature({type,limbScale:0.7})` and `1.4` stretch each authored bone segment on its local Y length axis and rebind a private mesh. `limbScales:{bone_name:factor}` overrides individual segments. Factors are restricted to 0.7–1.4. Transverse branch offsets and mesh thickness stay fixed; child and socket offsets along the segment move with its length.

This is setup-time authoring/QA support, not per-frame scaling. Quadruped and crawler instances are recentered to a feet-level rest origin after resizing. Flyer, swimmer and serpent retain their body-centred reference origins. Root height during jumps, sitting, dying or landing still needs game placement/ground handling.

## Clips and limits

- Quadruped: idle, walk, gallop, jump, sit, bite, dig, roar, hit, die.
- Flyer: flap, glide, dive, land, hit, die.
- Swimmer: swim, dart, hit, die.
- Crawler: idle, hit, die. Walking remains procedural leg IK; no fake walking clip is supplied.
- Serpent: slither, strike, coil, hit, die.

The reference meshes have deliberate toy joints, neutral ivory surfaces and muted ochre/slate accents. Fish and serpent bodies use connected ring meshes with blended weights. They are templates; arbitrary player drawing skinning, game animation layering, collision bounds, feet/IK, rider height and prop attachment still require integration review. A rotation-only death pose may need a root-height adjustment to settle on terrain.

## Verification

- Independent binary checks: exact hierarchy and clips, sockets, legal names, one mesh/material, budgets, embedded buffers, weights, 30 fps timestamps and seamless loops.
- **80 browser checks pass in both installed Chrome and emulated iPhone WebKit**, three.js r160. Each browser samples **4,444 skeleton frames and 1,008 complete vertex poses**, over 0.7, 1.0, 1.4 and asymmetric segment proportions.
- Differing-rest-basis regression: **3,530 bone comparisons per browser** across all clips and five phases on a synthetic identity-basis skeleton, also with transformed actor roots. Maximum position error 5.47e-7 m and rotation error 3.91e-7 radians. This proves the conversion on the synthetic rig, not arbitrary generated game skins.
- Actual render counters: one call per creature and triangle counts matching the table; owned bone palettes return GPU texture counts to zero after disposal.
- Both verification page console captures: zero errors and zero warnings. Numerical results: `creatures-browser-{chrome,webkit}.json`.
- Desktop gallery, all 28 clips at three uniform proportions, and phone-sized views are in `creatures-*.png`. The four proportion cases have numerical checks; asymmetric visual review is not claimed.

WebKit is running on a Mac with an iPhone user agent, touch and DPR 3. The preview caps rendering DPR at 1.5. These checks are not physical iPhone FPS, GPU timing, thermals or full-game performance evidence.

## Preview and source

Serve the repository's `assets` directory over localhost, then open `/A-008-rigs/creatures-preview.html`. The preview has type/action controls, scrubbing, uniform proportions, three-quarter/side views, five-clip sheets and a gallery. `creatures-verify.html` runs the standalone asset checks; no game server or API calls are involved.

Sources: `generate_quadruped_flyer.py`, `generate_aquatic_crawler.py`, and the five `<type>_source.blend` files (rest pose, no active action). Blender 5.2.2 authoring/export. `validate_creatures.py` uses Python's standard library. `creatures-retarget-check.js` is the independent rest-basis regression. All geometry, animation and colour work is original CC0-1.0; see LICENSE.txt. three.js/add-ons retain MIT.
