# A-003 — Decorative nebula

A seeded violet/magenta cloud volume that frames the boss with soft, slowly moving puffs. The current queue's decorative-cloud direction supersedes the old black-nebula request: this module adds no darkness, fog, visibility restriction, collision or gameplay gate. The original flare API remains a temporary visual accent.

## Use

```js
import { createNebula } from './assets/A-003-nebula/nebula.js';

const nebula = createNebula({ radius: 250, seed: 303, quality: 'medium' });
scene.add(nebula.object3d);
nebula.object3d.position.set(boss.x, boss.y, boss.z);

// Once per rendered frame, with seconds and the active camera:
nebula.update(dt, camera);

// A position in the nebula root's local coordinate system:
nebula.setFlare([120, 30, 90], 1);
nebula.setOpacity(0.12);

// Permanent scene teardown:
nebula.dispose();
```

The synchronous factory accepts `radius` (default 250 metres), `seed` (default 1), `quality` (`low`, `medium`, `high`), `opacity` (default 0.22), and optional `color`. It returns `object3d`, `setFlare`, `update`, `setOpacity`, `getStats` and `dispose`. Use the same three.js 0.160.0 instance as the game; there are no dependencies beyond `three` and no fetched image/mesh assets.

Opacity accepts 0–1; zero skips the mesh draw entirely. `getStats()` reports quality, puff/triangle/call counts, texture cost, bounds, open-centre radius, flare lifetime, camera-local position and a deterministic signature. Call it occasionally for diagnostics. Each instance owns its geometry, material and texture. Disposal removes the root, releases those resources once, and makes subsequent updates safe no-ops. Seeds are normalized to unsigned 32-bit values; use an integer seed for a reproducible layout.

The root is centred on the cloud. Keep the boss at its centre to use the open inner region. Billboards remain camera-facing, with a fade when the camera approaches a puff. The volume is an arrangement of translucent planes, not a ray-marched density field; changing viewpoint gives parallax, but it does not simulate light transport.

## Flare and integration

`setFlare(position, strength)` copies a root-local `THREE.Vector3`, `[x,y,z]` array or `{x,y,z}` object. Strength must be finite and nonnegative and is capped at 4. The flare lasts 14 seconds and adds a cyan/pink accent to nearby cloud puffs; it neither creates a real light nor changes visibility distances. Strength zero clears it. A new flare replaces the previous one. If an event uses world coordinates, convert a copy with `nebula.object3d.worldToLocal(...)` after updating the root's world matrix.

Call `update(dt, camera)` with the active camera each rendered frame, including when the camera or a parent transform moves. Translation, rotation and uniform positive scale are supported; avoid nonuniform or singular root scales. Fade the cloud through `setOpacity` during the space-to-island transition. Remove the game's older decorative puff batch when adding this one to avoid duplicate clouds. Existing scene fog is owned by game integration; this helper does not alter it. Clear or dispose the volume during round/scene teardown as appropriate.

Additive blending avoids transparent-instance sorting and keeps the effect luminous. It can brighten foreground objects where a puff lies in front of them; opacity and placement still need final-game contrast review. The depth test respects opaque geometry, but there is no scene-depth soft-particle pass. Bloom is optional and adds its own cost.

## Budgets and validation

| Quality | Puffs | Triangles | Draws | Texture |
| --- | ---: | ---: | ---: | --- |
| low | 24 | 48 | 1 | one 128 × 128 RGBA8 |
| medium | 48 | 96 | 1 | one 128 × 128 RGBA8 |
| high | 80 | 160 | 1 | one 128 × 128 RGBA8 |

The noise texture is linear data with mipmaps, approximately **87,380 bytes (85.3 KiB)** on the GPU. There are no asset downloads, additional render targets, shadow maps or reflection passes. Instance buffers remain fixed; frame updates change time/camera/flare uniforms. Animation has a continuous 120-second cycle. Billboards still create overdraw: cost depends on camera position, resolution and the game's other transparent effects, not just triangle count.

**41 checks pass in Chromium and 41 in emulated iPhone WebKit**, both with zero console errors/warnings and no shader/GL errors. The audit covers actual quality budgets and texture residency, seeded geometry and texture bytes, finite bounds and an open centre, visible animation inside/outside, copied flare coordinates and 14-second decay, transformed parents, input rejection/recovery, opacity-zero work removal, independent instances and GPU cleanup. JSON reports and console logs are included.

A 150-sample tight-loop after 30 warmups measured p95 CPU render submission of about **0.20 ms Chromium / 1 ms WebKit**, with update timing below each browser timer's useful resolution. These include `gl.getError`, exclude GPU completion, and are **not FPS or physical-phone performance**. The requested **under-2-ms physical-phone effect-cost target remains unmeasured**. Final gameplay visibility and combined transparent overdraw also need integration testing.

The preview and saved screenshots cover 1440 × 1000 Chromium and 844 × 390 emulated iPhone 13 WebKit, with a 390 × 844 portrait check. Device DPR3 is capped at renderer DPR1.5. Browser results are WebGL2; no physical iPhone 12/XR or thermal testing was performed.

`preview-flythrough.webm` is a 1280 × 888 recorded browser fly-through (about 28 seconds), with a flare accent during the pass. FFmpeg full decode passed; extracted review frames at 7/14/21 seconds are included. This is asset review footage, not a full-game test or a phone-performance recording.

The review preview adds the previously delivered boss and sky as context. Their geometry, materials and textures are separate from the nebula's reported budget. It supports full-volume, 100-metre approach, inside-cloud and fly-through views, three quality settings, bright/dim/plain backgrounds, opacity and flare-age controls.

From the repository root, reuse the existing server at port 8766, or start:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 \
  --directory /Users/jaumepuig/Documents/growth-hackathon
```

Open `http://127.0.0.1:8766/assets/A-003-nebula/preview.html`. `validate-browser.js` exports the isolated browser checks used by the preview.

## Source

Original procedural geometry, noise texture, shader and custom code; no external artwork or generated bitmap input. The deterministic source is `nebula.js` itself. Original material is dedicated under CC0-1.0; three.js retains its upstream MIT license. See `LICENSE.txt`.
