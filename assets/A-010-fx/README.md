# A-010 · Space Party effects

Original procedural effects for three.js r160: laser bolt, three explosion
sizes, drill sparks, flare with a light, scan ring, cyan hex shield, boost trail,
landing dust, dig dirt and chest gold. No image textures or asset downloads.

## Integration

```js
import {
  createFxSystem, spawnFx, updateFx, disposeFx,
} from './assets/A-010-fx/fx.js';

// Simple scene-owned path. Position is copied, so scratch vectors are safe.
spawnFx(scene, 'explosion', hitPosition, { color: 0xff7838, size: 2 });
spawnFx(scene, 'laser', muzzlePosition, { direction: forward, color: playerColor });
updateFx(scene, dt); // seconds, exactly once per frame for this scene
// Remove the effects and free their buffers/materials when tearing down the scene.
disposeFx(scene);
```

For explicit capacity control:

```js
const effects = createFxSystem({ scene, seed: 73 });
const shield = effects.spawn('shield', playerPosition, { duration: Infinity });
const boost = effects.spawn('boost', exhaustPosition, {
  duration: Infinity, direction: forward, color: 0x41dfff,
});
// On each update, follow the actual rendered/interpolated positions.
shield.setPosition(playerPosition);
boost.setPosition(exhaustPosition);
boost.setDirection(forward);
effects.update(dt);
// When flags turn off:
shield.stop();
boost.stop();
// At the next round, retain GPU pools but retire all prior effects:
effects.clear();
// Final teardown:
effects.dispose();
```

`createFxSystem({scene})` and the convenience functions use one shared registry.
Do not create a second system for the same scene, or update through both APIs
in the same frame. A standalone `createFxSystem({seed})` returns an `object3d`
you can add yourself. Positions and directions are local to that identity root;
when using a transformed parent, convert gameplay coordinates first.

The effect handle exposes `active`, `stop()`, `setPosition()` and `setDirection()`.
The new direction affects future trail emissions, preserving old particles. Position input
is copied. Retired or recycled handles cannot change a newer effect. A shield or
boost can remain active with `duration: Infinity`; remember to stop it when its
flag turns off. One-shot effects have finite lifetimes. The laser is a visual
streak: collision and damage remain the game's responsibility.

## Kinds

| Canonical kind | Use | Alias |
| --- | --- | --- |
| `laser` | Forward moving bolt | `laser_bolt` |
| `explosion` | Flash, debris, smoke and shock ring | `explode`, `blast`; `explosion_small`, `explosion_medium`, `explosion_large` select sizes 1, 2, 4 |
| `drill` | Directional warm sparks | `drill_sparks`, `spark`, `hit` |
| `flare` | Signal burst with pooled point light | `flare_burst` |
| `scan` | Expanding signal rings | `scan_ping`, `respawn` |
| `shield` | Translucent cyan hex sphere | `shield_bubble` |
| `boost` | Moving emitter and trailing streaks | `boost_trail` |
| `landing` | Low dust plume | `landing_dust`, `land` |
| `dig` | Brown ballistic flecks | `dig_dirt` |
| `gold` | Upward chest glitter | `chest_gold`, `treasure` |

Game event payloads use `pos`; pass that as the third argument, for example
`effects.spawn(event.kind, event.pos, {color:event.color, size:event.size})`.
Use a separate scene-owned system for space and the island. Update both clocks
every frame, or clear the hidden scene when switching; otherwise paused effects
resume on returning to that scene. Clear both at round transitions. These helpers do not mutate world
state, listen to the network, choose which player deserves an effect or edit any
game integration code.

## Review and limits

The local preview is
[preview.html](http://127.0.0.1:8766/assets/A-010-fx/preview.html).
Select an effect, pause or scrub its lifetime, toggle bloom, or view the gallery.
The preview ground and shield reference object are review props and are excluded
from isolated effect counters. Preview bloom adds passes beyond the effect mesh
cost. The module creates no shadow maps or reflection render passes.

The **30,832-byte** module uses three instanced batches: billboard particles,
planar rings and 720-triangle shield spheres. Default pools hold **1,024
particles, 24 rings, 32 shields, 32 continuous emitters and one flare light**.
GPU geometry attribute/index data totals **103,192 bytes** before driver
bookkeeping. No textures, shadow maps or reflection passes are allocated.

At most **three effect mesh draw calls** are submitted, regardless of overlapping
effect count. With every default slot occupied the triangle ceiling is **25,136**;
expired holes can remain inside a submitted batch until its highest live slot
retires. Exhaustion recycles the oldest occupied slots and increments the
`getStats().overwritten` counters. Old handles cannot control replacements.
Point lights do not submit mesh calls but add lighting work to scene materials.

| Effect, sampled just after spawn | Submitted triangles | Calls |
| --- | ---: | ---: |
| Laser | 4 | 1 |
| Explosion, any of the three sizes | 154 | 2 |
| Drill | 62 | 1 |
| Flare | 68 | 2 |
| Scan | 6 | 2 |
| Shield | 720 | 1 |
| Boost, first 1/30 second | 12 | 1 |
| Landing | 78 | 2 |
| Dig | 76 | 1 |
| Gold | 98 | 1 |

`validate-browser.js` drives isolated scenes through real WebGL. The saved
`browser-validation-chromium.json` and `browser-validation-webkit.json` each
record **59 passing checks**, with **zero console warnings/errors and zero
shader/GL errors**. Checks cover deterministic buffers, all kinds, renderer
counts, bounds on tiny/full/zero pools, 25 simultaneous shield/boost handles,
expiry, stale handles, direction changes, copied inputs, invalid data, scene
isolation and idempotent disposal. A ten-second simulated pressure test retained
fixed buffers with no nonfinite values. Default 25-player stress peaked at
**20,060 triangles / 3 calls**; particles were recycled under pressure while all
25 shields and emitters remained active.

Timing is **desktop CPU evidence only**: 150 measured iterations after 30
warmups gave Chromium p95 **0.10 ms update / 0.20 ms render submission**.
WebKit's coarser timer gave **0 ms / 1 ms p95**; zero means below that timer's
resolution. `renderer.render` submission timings do not wait for GPU completion
and exclude the game's scene, bloom passes and real-time pacing. They are not
FPS measurements. The contract's **under-2-ms physical-phone effect budget is
unverified**; neither engine's desktop result can establish it.

Current captures show every kind and all three explosion sizes in Chromium
1440 × 1000 and emulated iPhone 13 WebKit **844 × 390, device scale factor 3**
(the preview caps renderer pixel ratio at 1.5), plus a 390 × 844 rotation check.
Shield and gold were also reviewed without bloom. Full-game compositing,
physical iPhone 12/XR frame rates and large overlapping transparent effects
remain integration checks.

The small laser and dark dirt fragments need contrast checks against the final
world. With bloom off, the shield remains visible but its cyan is less saturated.
Place chest gold at the loot/socket height above terrain: the particles are
depth-tested, so a glow centred on the ground is naturally cut by that surface.

Transparency is one unsorted particle batch: intersecting smoke can blend in
spawn order. Keep dust quantities modest. Continuous boost emission creates
small temporary objects; this is a fixed GPU pool, not an allocation-free CPU
loop. Use `getStats()` for occasional diagnostics; its deterministic signature
is deliberately more expensive than a counter read. A flare toggles one pooled
point light and can introduce a new PBR light-count shader variant in the game;
prewarm that case or choose `maxLights:0` on a constrained quality tier (the
visible flare remains, but its scene light is disabled).

Run the preview from the repository root with a static server, for example
`python3 -m http.server 8766 --bind 127.0.0.1`. No build step or npm installation
is required by the delivered module.

## License

Custom code, shaders and review artifacts are original CC0-1.0 work. No external
meshes, textures or images are used. Three.js and its add-ons retain their
upstream MIT license.
