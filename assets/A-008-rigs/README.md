# A-008 · Person rig and 33 clips

This delivers the **person** portion of A-008: an original neutral reference mesh and the complete 31-action person list, plus the requested `step_out` and `climb_in`. Quadruped, flyer, swimmer, crawler and serpent are still pending P1 work.

`person.glb` contains one skinned mesh, one standard PBR material, **4,068 triangles / 1 draw call**, no textures, 19 bones and at most one bone influence per vertex. Rest pose is T-pose, 1.80 m tall, feet-centred, Y up, front -Z. The segmented neutral mannequin deliberately exposes joint motion. Exact bone rest transforms match the A-009 explorer; sockets are `socket_head`, `socket_hand_l/r`, `socket_back`, `socket_feet`.

All **33 clips are rotation-only**, including hips. There are no animated translation, scale or morph channels. Every action has 19 quaternion tracks and is sampled at 30 fps; durations are in `person-clips.json`. Loop endpoints match. Limb lengths, root travel, gravity, ground contact, seated height and procedural squash/stretch remain under game control.

| Group | Clips |
| --- | --- |
| Locomotion | idle, walk, run, sprint, jump, fall, land, crouch, roll |
| Actions | aim, shoot, swing, throw, block, dig, climb, swim, glide, push, pick_up, cast |
| Poses and reactions | sit, kneel, drink, look, read, flip, hit, die, celebrate, wave |
| Ship transitions | step_out, climb_in |

The 1.6-second ship clips are inverse seated/standing gestures with a leg lift and bracing arm. **They do not move the actor out of or into a ship.** Attach/position the root relative to the ship's seat/exit path in integration. Dig has a deliberate lift and quicker downward stroke; shoot has short recoil; hit and land settle after impact; gait knee recovery is phase-offset from the hip swing.

## Reference factory

```js
import { createPerson } from './assets/A-008-rigs/person.js';
const person = await createPerson({ animation: 'idle' });
scene.add(person.object3d);
person.play('run');                 // 0.12-second fade by default
person.update(dt);                  // each frame, seconds
person.play('land', { fade: 0.08 }); // one-shot, holds its final pose
person.play('dig', { restart: true });
```

`createPerson({animation:null})` retains the reference T-pose. Returned values include `object3d`, `bones` (Map), `sockets`, `clips`, `mixer`, current `action`, `play`, `update`, and `dispose`. Loop defaults come from the manifest; override with `{loop:true|false}`. Repeating `play()` on a running action does not restart it. Finished one-shots can replay; trigger those from state changes, not unconditionally every frame. Switch back to idle/movement when a one-shot finishes.

For proportion review, `createPerson({limbScale:0.7})` or `1.4` changes upper/lower arm and leg lengths. `limbScales` optionally overrides individual `upper_arm_l/r`, `fore_arm_l/r`, `thigh_l/r`, `shin_l/r` factors within that range. The helper changes both the neutral bind mesh and joint offsets at setup time. Each instance owns its bind matrices and resized geometry; no scale animation is introduced. Uniform-limb rest heights are 1.587, 1.800 and 2.084 m: head/torso sizes stay fixed.

Unresized instances share cached geometry. All instances have independent skeletons/materials/mixers. Remove the root from the scene, then `.dispose()` to release its mixer/materials and any resized geometry. Source geometry remains cached. Frustum culling is disabled for the skinned reference to avoid rest-pose bounding-box clipping.

## Retarget to the delivered explorer or another person

```js
import { createDefaultExplorer } from './assets/A-009-defaults/defaults.js';
import { createPersonAnimator } from './assets/A-008-rigs/person.js';

// Target MUST be in its bind/rest pose when the animator is created.
const explorer = await createDefaultExplorer({ animation: null });
const motion = await createPersonAnimator(explorer.object3d, { animation: 'idle' });
scene.add(explorer.object3d);
motion.play('step_out', { fade: 0, loop: false });
motion.update(dt); // use this mixer while the new library is active

// During teardown:
motion.dispose();
explorer.dispose();
```

Do not update two mixers on the same skeleton. To replace an active old animator, stop its actions so it restores the bind pose before constructing the new one. `createPersonAnimator()` converts source quaternion deltas to the target's rest bone bases, preserves target lengths, validates required bone names/parents, and ignores the actor root's world-facing rotation. `retargetPersonClips(target)` returns just the converted clips for an existing mixer; `loadPersonRig()` returns the cached source GLTF. Treat that cached source as read-only.

Apply game-owned procedural offsets **after** the animation mixer update. These clips provide articulated poses only: jump/flip/roll need root motion from physics; crouch/kneel/die need root-height/contact handling; sit/entry/exit need a seat anchor. There is no foot IK, ground normalization, collision, weapon/tool mesh or hit/reward timing logic in this asset. Hand-held attachments can use the sockets. Socket `feet` follows hips; use the actor root for ground anchoring.

## Evidence and limits

- `validate.py` inspects the binary GLB for all 33 names, exact 19-bone hierarchy, sockets, budgets, normalized weights/quaternions, rotation-only tracks, 30 fps timing, loop endpoint closure, finite geometry and embedded resources. `validation.json` contains the current SHA-256 and per-clip details.
- `browser-validation.json` contains **13 passing r160 browser checks**. All 33 clips were tested on 0.7×, 1.0×, 1.4× and an asymmetric mix of 0.7×/1.4× limbs: **5,724 full-skeleton frame samples** and **1,188 complete skinned-vertex poses**. The asymmetric case is numerically checked; the nine visual pose sheets show the three uniform cases.
- All 33 clips also ran on the actual A-009 explorer at five phases each (165 complete skinned-vertex poses). Tests cover finite bounds, reference height, rest-basis retargeting with a rotated actor root, actual resized joint lengths, independent bones, one-shot replay, and actual renderer cost. No nonfinite or exploded geometry appeared. These checks do not prove arbitrary user-generated skin weights or collision-free hand/prop contact.
- Visually reviewed all 33 poses at each uniform proportion in nine front-view sheets, plus side-view sequences at 15%, 50% and 85% for walk, run, jump, land, dig, shoot, hit, die, celebrate, wave, step_out and climb_in. Actual-explorer phone-viewport views include run, dig, wave and step_out. Final browser console: **0 errors / 0 warnings**.
- **Physical iPhone Safari frame rates and live game physics/procedural-layer integration are unverified.** Pose sheets and screenshots use desktop Chrome at 1440 × 1000 and 390 × 844. Foot sliding and pose-height changes need integration handling; no phone-performance claim is made.

## Rebuild / preview

Original source: `generate.py` and `person_source.blend`, authored/exported with Blender 5.2.2. One action per clip; `person-clips.json` records durations and loop defaults.

```sh
/opt/homebrew/bin/blender -b --python assets/A-008-rigs/generate.py
python3 assets/A-008-rigs/validate.py
python3 -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8766/assets/A-008-rigs/preview.html`. Animation/phase controls, front/side views, proportion selector, nine pose sheets and an explorer switch are provided. The preview loads r160 from CDN and the existing A-009 explorer for compatibility review. Runtime `person.js` needs only its own `person.glb` and three.js/add-ons.

All custom geometry, motion, colours, helper and source are original **CC0-1.0**, with no external artwork or motion capture. Blender and three.js/add-ons retain their upstream licenses.
