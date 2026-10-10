# A-009 default car · Trail buggy

An original chunky expedition buggy for players who have not drawn a car. Warm ivory panels, a slate chassis and roll cage, cyan piping, two tan bucket seats, knobby tyres and amber lamps give the neutral stand-in a readable silhouette. It has an open cabin, a real steering rim and utility cargo rather than a flat outline.

The car is **4.019 m long × 2.676 m wide × 2.094 m high**, with **Y up / −Z forward** and a base-centred origin. Rest geometry touches Y=0. The bumper-to-bumper body is 4 m; front tow hooks add 19 mm. Existing ship/explorer assets, `defaults.js`, `generate.py` and their README are unchanged.

| Authored mesh | Triangles | Raw GLB draws | Helper draws |
| --- | ---: | ---: | ---: |
| `car_body` | 1,864 | 1 | 1 |
| `car_lights` | 112 | 1 | 1 |
| `car_wheels` / four wheel instances | 2,800 (700 each) | 1 | 1 |
| **Total** | **4,776** | **3** | **3** |

Three opaque, single-sided PBR materials use vertex colour. **Zero textures**, no skins, no animation clips, no decoders, no embedded lights, no shadow maps and no reflection passes. The common lamp material has a fixed warm amber emission at strength 1.8; it remains visible without bloom. Materials retain ordinary directional/ambient lighting support.

`car.glb` is **420,120 bytes**, SHA-256 `e0775cab48a7d73cc165567c206ec7cdede4f186b0d8517f8e06aa805ff99a7c`. `car-manifest.json` records source parts, dimensions, sockets, pivots and exact counts; `car-validation.json` contains the independent binary audit.

**Static GLB versus animated helper**

The raw GLB contains the entire car in three mesh drawables. Its four wheels are merged into `car_wheels`; `wheel_fl`, `wheel_fr`, `wheel_bl` and `wheel_br` are separate **empty control pivots**. This keeps a normal GLTFLoader preview within the three-call budget. Rotating those empty nodes alone does not deform the merged raw wheel mesh.

`car.js` reads the wheel-ID UV attribute, extracts one local wheel prototype, verifies all four authored copies, then replaces the merged wheel mesh with one four-instance `InstancedMesh`. The named pivots drive its instance matrices. This preserves three calls while enabling independent spin and front steering. There is no GPU-instancing glTF extension and no custom shader. The helper validates expanded positions/colours within 1e-5 and normals within 1e-4; the export's measured maximum normal-component difference is 5.50e-5 from translated-copy normal rounding. Positions agree within 5.96e-8.

```js
import { createDefaultCar } from './assets/A-009-defaults/car.js';

const car = await createDefaultCar();
scene.add(car.object3d);
car.object3d.position.set(0, groundHeight, 0);
car.setMotion({ speed: 5, steer: 0.20 });

// Once each frame, seconds. Game code moves/tilts the vehicle root separately.
car.update(dt);

// Independently pose the front-left wheel. Other wheel phases are retained.
car.setWheel('fl', { spin: Math.PI / 2, steer: 0.15 });

// Attach a roof accessory using the authored socket.
car.sockets.roof.add(accessory);

// Remove this instance and release only the helper's owned GPU resources.
car.dispose();
```

**API**

`await createDefaultCar({color, loader, url} = {})` uses the application's existing **three.js 0.160.0** instance and GLTFLoader. The default URL is `car.glb` beside the module. Every factory call owns an independent loaded scene and its geometry/materials; it does not change the existing default-entity cache. A custom loader must expose `loadAsync(url)` and return an exclusively owned fresh GLTF scene, with no resources shared with other users. Invalid options fail before loading; invalid assets release the resources loaded so far.

Optional `color` is a THREE.Color, a 24-bit integer or `#RGB`/`#RRGGBB`. It multiplies the **whole body material**, including its trim/seat vertex colours; lamps and wheels retain their own materials. The neutral default is white. This is a simple fallback tint, not separate body-panel recolouring.

The result exposes:

- `object3d`: the scene root to position, rotate, scale or attach.
- `wheels`: `{fl,fr,bl,br}` references to the original named empty control nodes.
- `sockets`: `{seat,roof,front,back}` references to authored socket nodes.
- `wheelMesh`: the four-instance batch, for inspection.
- `setMotion({speed?,steer?})`: speed in m/s (−100…100); front steering in radians (−0.65…0.65). Omitted values retain the previous setting. Positive speed produces negative local-X spin for travel toward −Z. Positive steering turns the front wheels toward −X. Both front wheels use the same angle; there is no Ackermann steering calculation.
- `setWheel(name,{spin?,steer?})`: independently sets an absolute wheel phase/front-steer angle. Names accept `fl` or `wheel_fl`, and equivalent forms for the other corners. Spin is finite, bounded ±1e9 on input and wrapped to one turn. Rear wheels reject nonzero steering. Phase offsets remain while `update` advances travel.
- `syncWheels()`: copies all current pivot transforms into the batch and updates its culling bounds. Use after manually editing public pivots. Subsequent automatic motion poses replace manual rotations; for externally driven wheel physics, use manual pivots + `syncWheels()` without `update()`.
- `update(dt)`: nonnegative finite seconds, at most 3,600 per call. Advances wheel phases and synchronizes the batch. It does not move the root, create physics, animate passengers or measure speed from position. A stopped car needs no per-frame matrix uploads.
- `getStats()`: mesh budget, wheel radius, speed/steer, individual phases and disposal state. The counts describe this complete asset, excluding attached caller objects, scenery and extra render passes.
- `dispose()`: idempotent; removes the root and releases the owned batch, geometries and materials. Later motion/update/sync calls safely return false. Attached caller resources are not disposed; detach accessories first if they must stay in the scene.

Inputs are validated before changing motion state. No `onBeforeRender`, scene-global callbacks, timers or renderer state changes are installed by the helper.

**Pivots and sockets**

All coordinates below are car-local metres. At rest, every pivot/socket has identity rotation and scale. Wheels use local X for spin, with local Y steering applied before spin. All four wheels share the same two-sided hub design and geometry orientation; no mirrored negative scale is used.

| Node | X | Y | Z |
| --- | ---: | ---: | ---: |
| `wheel_fl` | −1.02 | 0.552 | −1.25 |
| `wheel_fr` | +1.02 | 0.552 | −1.25 |
| `wheel_bl` | −1.02 | 0.552 | +1.20 |
| `wheel_br` | +1.02 | 0.552 | +1.20 |
| `socket_seat` | −0.38 | 1.005 | +0.36 |
| `socket_roof` | 0 | 2.14 | +0.44 |
| `socket_front` | 0 | 0.85 | −2.04 |
| `socket_back` | 0 | 0.85 | +2.04 |

The seat socket is a **seated hip anchor** over the left bucket, not the feet/root of a standing explorer. Apply a seated pose and an avatar-specific root offset. The two axle positions intentionally differ about the root; do not assume a symmetric ±wheelbase/2 layout.

The nominal rolling radius is 0.552 m. The polygonal tread's exact radial envelope varies slightly as it spins; ground contact, suspension travel, steering clearances and terrain collision belong to integration. Arbitrary terrain and physical iPhone frame rates are unverified. Uniformly scaling the car changes its physical wheel radius; either adjust the speed passed to this visual helper or drive wheel angles directly. Nonuniform root scale distorts the tyres and is not a vehicle-physics model.

The helper batches wheels **within one car**, not across a fleet. Twenty-five fully visible cars would submit 75 car draw calls and 119,400 car triangles before the world/UI; the game's total phone budget still needs distance culling or a fleet-level instancing strategy. The 5k/three-call individual-asset contract is not a claim that an uncapped fleet meets full-game performance limits.

**Preview, source and evidence**

Open `assets/A-009-defaults/car-preview.html` on the existing local asset server. It offers hero/front/rear/side/top views, speed and steering, independent front-left phase, multiplicative tint and raw/helper modes. Its floor/contact patch and lighting are preview fixtures; the two ground draws are excluded from the car's three-call figure. The shadow-like contact patch is a static graphic, not a shadow-map pass or asset component.

Rebuild only the car using the installed Blender:

```sh
/opt/homebrew/bin/blender -b --python assets/A-009-defaults/generate_car.py
/opt/homebrew/anaconda3/bin/python3 assets/A-009-defaults/car-validate.py
node --check assets/A-009-defaults/car.js
node dev/v11-client/check-syntax.mjs assets/A-009-defaults/car-preview.html
```

`generate_car.py` writes `car.glb`, `car_source.blend` and `car-manifest.json`. The source is deterministic geometry/vertex paint, with the wheel prototype triangulated before duplication. The Blender source retains all three editable mesh objects and required empty pivots/sockets. The validator uses NumPy only as an offline inspection dependency; the runtime needs only three.js and its GLTFLoader add-on.

**46 structural checks pass** for the actual exported GLB, including node names/orientations, socket positions, normal lengths/winding, finite attributes, triangle/index budgets, opacity, matching wheel prototype data, dimensions, hashes and embedded resources. `car.js` and the preview inline module pass syntax checks.

The coordinating reviewer also recorded **19/19 runtime checks in Chromium and 19/19 in emulated iPhone WebKit**, saved in `car-browser-chrome.json` and `car-browser-webkit.json`. Both measured three draws, 4,776 triangles and no image textures. Raw-vs-batched render pixels matched exactly in the comparison view. Checks cover speed-to-spin conversion, front-only steering, independent phases, external pivot synchronization, transformed parents, independent instances, invalid inputs and idempotent resource disposal. Maximum checked instance-matrix error was 2.84e-8. This is standalone desktop/browser-emulation evidence; **physical iPhone timing/FPS, full-game performance, physics and terrain contact remain unverified**.

Final visual evidence: `car-{hero,front,rear,roof,steering}.png` at 1440 × 1000, and emulated WebKit `car-phone-{portrait,landscape}.png` at 390 × 844 / 844 × 390. The final phone verification report uses 390 × 844 with DPR 3. The preview caps drawing DPR at 1.5 and fits the vehicle into the area clear of its controls. Front/rear/roof, tyre steering and independent wheel phase were visually inspected.

Original geometry, vertex colours, generator and helper code are dedicated **CC0-1.0** to the extent applicable rights exist. No external meshes, textures, images, fonts or motion capture were used. Blender and three.js retain their respective upstream licenses. No game integration code was modified.
