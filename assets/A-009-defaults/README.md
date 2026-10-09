# A-009 v1: default ship and explorer

Original CC0 stylized models for three.js 0.160.0. The ship has swept wings,
an opaque canopy, cyan markings and two emissive engines. The explorer is a
1.8 m astronaut with a 19-bone person rig and a replaceable, UV-mapped visor.
Both face **-Z**, with **Y up**, and need no decoder or external texture files.

This delivery completes the **v1 ship and explorer**. The car and the full A-008
animation library remain deferred according to the orchestration queue.

## Integration

```js
import {
  createDefaultShip,
  createDefaultExplorer,
} from './assets/A-009-defaults/defaults.js';

const ship = await createDefaultShip();
const explorer = await createDefaultExplorer(); // idle plays automatically
scene.add(ship.object3d, explorer.object3d);
ship.setEnginePower(1); // 0..3; clamped, emissive intensity = 5 * power

// In the game's animation loop, dt is seconds:
explorer.update(dt);
explorer.play('walk'); // repeated calls do not restart a running clip
explorer.play('dig', { fade: 0.15 });
explorer.play('jump', { restart: true });

// Use an existing THREE.Texture, e.g. a CanvasTexture from the selfie image.
explorer.setVisorTexture(selfieTexture);
explorer.resetVisor();

// Sockets are Object3Ds and can provide world positions / parent attachments.
ship.sockets.engine_l.getWorldPosition(effectPosition);
explorer.sockets.hand_r.add(heldItem);

// Teardown releases this instance's materials and skeleton GPU resources.
ship.dispose();
explorer.dispose();
```

Factories cache the source GLBs, clone skeletons with `SkeletonUtils.clone`, and
give each instance independent material objects. Geometry, clips and source maps
remain shared in the module cache. `dispose()` removes the instance from its
parent; it does not destroy cached geometry/maps or caller-owned selfie textures.
Do not use an instance after disposal. The factories take an optional `{color}`
to multiply the painted suit/hull tint; a ship colour also tints engine emission.

`createDefaultExplorer({animation: null})` keeps the T-pose rest state.
`play(name, {fade, loop, restart})` returns the AnimationAction. Jump and land
default to `LoopOnce` and hold their last pose; other clips loop. Switch back to
idle or walk when gameplay changes state. A finished one-shot can be replayed;
`restart: true` also restarts a clip that is still running. AnimationMixer is
available as `explorer.mixer` for completion events or more control.

## Nodes and sockets

The ship is about 2.9 m long, with its origin adjusted to the authored geometry's
signed-volume centre. Its empty sockets are `socket_nose`, `socket_wing_l`,
`socket_wing_r`, `socket_back`, `socket_belly`, `socket_seat`, plus
`socket_engine_l` and `socket_engine_r`. The returned `sockets` map omits the prefix.

The explorer origin is between its feet. The rest bounds are approximately
1.65 m wide × **1.80 m tall** × 0.60 m deep. Its bones match section 4 exactly:

- `hips > spine > chest > neck > head`
- `chest > shoulder_l > upper_arm_l > fore_arm_l > hand_l`, mirrored `_r`
- `hips > thigh_l > shin_l > foot_l`, mirrored `_r`

Empty `socket_head`, `socket_hand_l`, `socket_hand_r`, `socket_back`, and
`socket_feet` nodes follow their associated bones. The feet socket is parented
to hips and follows its bob; use the root origin for a ground collision anchor.

The authoring mesh and glTF mesh are each **one skinned mesh with three material
primitives**. GLTFLoader represents those as three SkinnedMesh drawables sharing
the bone hierarchy. At most **two influences per vertex** are used.

## Visor replacement

Material name is exactly `visor`; its base tint is white. The default reflection
graphic is a **512 × 512 embedded PNG**. `setVisorTexture` sets sRGB and
`flipY = false` for glTF UV conventions, then assigns the map. A test card was
visually verified with **L on the left, R on the right, and TOP upright**.

Use a square/cropped selfie texture. The curved visor wraps the photo around the
helmet; the helper does not crop a camera frame or manage camera permissions.
The default visor and all source artwork are original procedural graphics.

## V1 animations

| Clip | Seconds | Loop |
| --- | ---: | --- |
| idle | 2.0 | yes |
| walk | 1.2 | yes |
| run | 0.8 | yes |
| jump | 0.9 | no |
| fall | 1.0 | yes |
| land | 0.3 | no |
| dig | 1.2 | yes |
| celebrate | 2.0 | yes |

Keys are at 30 fps, with rotations only except hips translation. Loop endpoints
match. Locomotion is in place: gameplay moves the root. These are starter clips
for this explorer's proportions. Retargeting over 0.7×–1.4× limb lengths and the
remaining A-008 clips have **not** been delivered or validated yet.

## Budgets and validation

| File | Triangles | Draw calls | Textures | Bytes |
| --- | ---: | ---: | ---: | ---: |
| ship.glb | 1,328 | 3 | 0 | 142,856 |
| explorer.glb | 4,552 | 3 | 1 × 512² | 813,868 |

PBR materials are standard metallic-roughness. Only the engines emit light,
through `KHR_materials_emissive_strength`; the game's bloom pass supplies bloom
and A-010 can attach trails to the engine sockets. No shadow maps, reflection
passes, normal maps, transmission or decoder dependencies are added.

`validate.py` checks the actual binary exports, budgets, sockets, names, exact
bone hierarchy, normalized weights, clip names/durations, 30 fps timestamps,
permitted animation channels, loop closure, embedded maps and vertex paint.
SHA-256 hashes and counts are in `validation.json`.

The r160 preview passed **15 browser checks**, including independent skeletons
and materials, finite skinned bounds at five samples per clip, reference height,
socket parenting, one-shot replay, and visor replacement. The final browser
session had zero console errors or warnings. Results are in
`browser-validation.json`; previews include front/rear crew, eight poses, dig,
selfie, and 390 × 844 phone-size explorer/selfie captures.

This is desktop browser and phone-size viewport evidence. Physical iPhone 12/XR
frame rates, gameplay attachment placement, foot contact on terrain and the full
draw-your-avatar rigging path still require integration checks. Skinned drawables
have frustum culling disabled to avoid stale rest-pose bounds clipping animations.

## Rebuild and preview

```sh
blender -b --python assets/A-009-defaults/generate.py
python3 assets/A-009-defaults/validate.py
python3 -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8766/assets/A-009-defaults/preview.html`.
`defaults_source.blend` contains both editable models and the explorer actions.
The saved Blender scene prefixes ship object names with `source_` to avoid
colliding with explorer socket names; the ship GLB has the contractual names.

All custom source, meshes, animations and textures here are original CC0-1.0.
No third-party artwork was used. Blender 5.2.2 was the authoring/export tool;
three.js and its add-ons are loaded from the existing CDN under upstream MIT.
