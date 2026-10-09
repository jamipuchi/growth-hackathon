# A-004 — Earth-like planet

Code-generated planet for **three.js 0.160.0**: original stylized continent/ocean maps, flowing cloud bands, warm city lights masked to the night side, a blue atmosphere rim, a seeded tropical island landmark and a pulsing landing ring. Radius defaults to **200 m**, Y up, origin at planet centre. Three visible meshes / **13,760 triangles / 3 draw calls** when unlocked. No GLB or decoder is needed.

## Load and update

```js
import {createPlanet, PLANET_SUN_DIRECTION} from './assets/A-004-planet/planet.js';

const planet = await createPlanet({seed, radius:200, unlocked:false});
scene.add(planet.object3d);
planet.object3d.position.set(planetX, planetY, planetZ);

// Update through the existing frame loop, dt in seconds:
planet.setUnlocked(bossIsDead);
planet.setProximity(approachAmount); // clamped 0..1, increases ring pulse
planet.update(dt);

// World-space point for the approach/descent animation:
const destination = planet.getLandingPoint();

// Teardown:
scene.remove(planet.object3d);
planet.dispose();
```

This is asynchronous because it loads two PNG maps. It depends only on `three`, resolved by the existing import map. Serve this directory over HTTP. `group` is an alias for `object3d` for convenient integration; **`update(dt)` is not the old placeholder's `update(dt,t,inRange)` API**. Set proximity explicitly. The module adds no lights, global fog, background, postprocessing or game state.

The PBR surface needs scene lighting. Set a directional light along the same **world-space** direction used by `planet.setSunDirection([x,y,z])`; the default is normalized `PLANET_SUN_DIRECTION = [-.8,.35,-.65]`. Preview uses directional intensity 3.4, warm white, plus low blue ambient intensity 0.32, ACES exposure 1.1. Night masking and atmosphere lighting use this direction. If the game's existing sun points elsewhere, pass its direction when creating the planet. An overwhelmingly bright ambient/environment light will weaken the night-side contrast.

The planet does not rotate automatically, so its island and landing socket remain stable. Clouds move independently. To face the island toward spawn/approach, rotate the whole root once:

```js
planet.object3d.quaternion.setFromUnitVectors(
  planet.landingDirection,
  approachDirection.clone().normalize(), // direction away from planet centre
);
planet.update(0); // refresh sun direction in the rotated local frame
```

Translation, rotation and uniform scaling are supported. The socket follows parent transforms. `getLandingPoint(targetVector)` writes into an optional supplied vector to avoid frame allocations. LAND eligibility, collision, boss state and the transition to the island scene remain authoritative game logic. The ring marks a local descent region; it is not a billboard around the whole planet or a distance-range volume.

## API and states

`createPlanet({seed=1,radius=200,unlocked=true,sunDirection=PLANET_SUN_DIRECTION})` returns:

- `object3d` / `group`, `surface`, `atmosphere`, `landingRing`, `sockets.landing`.
- `landingDirection`: normalized local direction to the region; `sunDirection` getter returns a copy of the current normalized world direction.
- `update(dt)`: advances cloud motion, ring pulse and shield shimmer; refreshes lighting after root rotation.
- `setUnlocked(boolean)`: false hides the ring and shows faint moving blue shield bands; true reveals the landing ring and removes the bands. Defaults to true for the original reveal-after-boss contract; use false for the updated visible-from-start world.
- `setProximity(amount)`: 0..1 (clamped), adjusts ring pulse speed/intensity and colour. It does not move ships or check range.
- `setSunDirection([x,y,z])`, `getLandingPoint(target?)`, `getStats()` and idempotent `dispose()`.

`loadPlanetMaps()` caches the shared source textures. `LANDING_REGION` exports the original approximate coordinates: longitude 74°, latitude −8°, texture patch width 28°. Names are `planet`, `planet_surface`, `planet_atmosphere`, `socket_landing`, `landing_ring`. At radius 200 and identity transform, the socket is **[55.5190, −28.3078, −193.6178]**, at distance **203.4 m** from centre. Its local +Z points outward. The seed-dependent island map guarantees dry land at this socket. Orient a ship independently for descent.

## Cost and textures

| Part | Geometry | Triangles | Calls |
| --- | --- | ---: | ---: |
| Surface, clouds, night lights, locked shimmer | Sphere, 96×48 | 9,024 | 1 |
| Atmosphere rim | Sphere, 64×32, 1.045× radius | 3,968 | 1 |
| Landing ring | Annulus, 96×4 | 768 | 1 |
| **Unlocked total** | | **13,760** | **3** |
| **Locked total** | Ring hidden | **12,992** | **2** |

The renderer reports these exact counts. Double-sided ring rendering is explicitly single-pass. Surface is `MeshStandardMaterial` with shader hooks; atmosphere/ring use small shader materials. Clouds are composited into the surface PBR colour and roughness; there is no separate cloud-shell call. The island is texture detail, not displaced geometry. Ring radii are 0.10–0.19× planet radius with strongest light at 0.145×.

- `planet_color.png`: **2048×1024**, RGB/sRGB, **591,434 bytes**; original simplified continents, green/brown terrain, ice and blue oceans.
- `planet_data.png`: **2048×1024**, RGB/linear, **792,191 bytes**; R = city light intensity, G = cloud coverage, B = land mask.
- Runtime seed-dependent island map: **256×256 RGBA/linear**, R = land, G = height tint, B = relief shading. Owned per instance. The two file textures are shared across instances, including after one instance is disposed.

Downloads total **1,383,625 bytes** for the two maps. Typical uncompressed RGBA GPU storage with mipmaps is approximately **21.6 MiB** including the island map; driver allocation can differ. File maps have matching first/last columns for longitude wrapping. No shadow maps, reflection rendering, environment capture, external texture service or postprocessing pass is created. Existing game bloom may enhance the city lights and ring; the supplied screenshots use no bloom.

## Verification

- `validate.py` checks actual PNG dimensions, channels, longitudinal seams, provenance hashes, clouds, land/ocean coverage and bright city pixels constrained to land. Six checks pass. Maps contain **9,158 city pixels above intensity 80** and **410,473 cloud pixels above 80**; these are texture counts, not visible framebuffer counts.
- `preview.html` runs **17 browser checks** against real r160/WebGL: map loading/colour space, PBR, names/radius, actual geometry/call budgets in both states, shader compilation, no shadow/reflection render, seed determinism, independent disposal, socket position/transforms, finite geometry, dry landing centre, city night masking and cloud motion.
- With lights temporarily disabled to isolate emission, the same camera produced **0 warm city pixels on the day-facing configuration and 1,339 on the night-facing configuration**. Advancing 120 s with the ring/atmosphere hidden changed **17,050 framebuffer pixels**; this confirms visible cloud motion. These counts are from the preview's initial test viewport, not phone performance measurements.
- Final browser console: **0 errors / 0 warnings**. `browser-validation.json`, `browser-console.txt`, `validation.json` and `map-manifest.json` hold the evidence and hashes.
- Visually inspected approach, day, night, landing, locked and cinematic-horizon views at **1440×1000** and **390×844**; twelve screenshots are saved in this directory. Thin blue rim, night lights and the local landing ring remain readable at the narrow viewport.

## Limits and integration notes

This is an **Earth-like fictional map**, not an accurate geographic dataset. Continent outlines and city locations are simplified original drawings/noise, not NASA or GIS imagery. The enlarged tropical island is a **symbolic landmark on the globe**; its outline/scale is not a one-to-one representation of the separately rendered 840 m A-005 gameplay level. Transition between the two representations in the game's descent animation.

Clouds have no physical altitude, parallax, volumetric scattering or shadow maps; a small offset texture sample supplies visual cloud shading. The globe is a smooth sphere; terrain relief is colour detail. The atmosphere is an inexpensive rim shell, designed for exterior views. The game should fade/transition before flying inside the planet. Surface appearance depends on the caller's directional/environment lighting and tone mapping.

The locked bands are a visual hint, not a physics barrier. The landing socket stays fixed unless the caller transforms the root. Do not auto-rotate the globe independently during a socket-targeted approach. Sun/night calculations support root rotations with uniform scale; nonuniform ellipsoids are outside this contract.

**Physical iPhone 12/XR FPS, Safari shader behaviour and live-game composition are unverified.** Narrow screenshots are desktop Chrome. The actual phone `perf.log` is still required for acceptance; no frame-time claim is made from triangle counts alone.

## Rebuild, preview and license

```sh
# Python with NumPy and Pillow:
python3 assets/A-004-planet/generate_maps.py
python3 assets/A-004-planet/validate.py
python3 -m http.server 8766 --bind 127.0.0.1
```

This workspace used `/opt/homebrew/anaconda3/bin/python3` for NumPy/Pillow. Open `http://127.0.0.1:8766/assets/A-004-planet/preview.html`. Geometry is generated by `planet.js`; there is no Blender/GLB build step. Sources and validation scripts are editable and reproducible.

All custom maps, continent outlines, geometry composition, shaders, helper code and preview images are original **CC0-1.0**. No external artwork was copied. three.js retains its upstream MIT license. The shader hooks target the official [r160 MeshStandard/physical shader](https://github.com/mrdoob/three.js/blob/r160/src/renderers/shaders/ShaderLib/meshphysical.glsl.js), with [SphereGeometry](https://github.com/mrdoob/three.js/blob/r160/src/geometries/SphereGeometry.js) for the two spheres. No game integration files were edited.
