# A-007 — Cockpit

A chunky, open flight deck with bevelled ivory/blue window framing, a navy dashboard, three recessed gauge bays, cyan indicator lights and padded seat edges. The GLB has no labels or game values: the three sockets are attachment points for code-drawn displays.

The eye is **at the origin, looking along −Z, with +Y up**. The authored camera uses vertical FOV **70°**, aspect **16:9**, zoom 1. The cockpit is a camera-attached foreground asset; its dimensions do not describe the exterior hull of a playable ship.

The exported `cockpit.glb` is **112,492 bytes**, with **1,366 triangles / 3 draw calls / 3 PBR materials / zero textures**. Hull, trim and emissive signals are merged into separate meshes. All geometry is embedded, with no decoder, animation, skin or external resource. Mesh depths range from **1.183 to 1.79 m** in front of the eye. Editable `cockpit_source.blend`, original `generate.py` and `geometry-manifest.json` are included.

## Integrate

Use the game's existing three.js **0.160.0** import map:

```js
import {createCockpit} from './assets/A-007-cockpit/cockpit.js';

const cockpit = await createCockpit({camera});
camera.add(cockpit.object3d);
scene.add(camera); // a camera must be in the scene for its children to render

// Resize, orientation changes, boost FOV and camera zoom changes:
camera.aspect = width / height;
camera.updateProjectionMatrix();
cockpit.fitToCamera(camera);

// Existing cockpit toggle:
cockpit.object3d.visible = cockpitEnabled;

// Permanent teardown:
cockpit.dispose();
```

Replace the existing clip-space `cockpitFrame()` when integrating this model. Hide the player's exterior ship in first-person mode as appropriate. Keep the cockpit root's position and rotation at identity relative to its active camera. On a camera switch, reparent and refit it. Do not share one root across simultaneous cameras.

`fitToCamera(camera)` scales X and Y to preserve the same screen-space opening at different aspect ratios, FOV and zoom. Z stays unchanged, so this intentionally stretches the cockpit on a narrow screen. It does not move the eye, change the camera, add lights, install a frame callback or alter renderer settings. No per-frame update is needed unless the camera's projection changes.

Use a perspective camera with a near plane below the nearest cockpit geometry (the preview uses **0.1 m**) and a far plane beyond it. Camera view offsets, film offsets, orthographic cameras and unusual projection matrices are not supported. The helper rejects invalid FOV/aspect/zoom and view/film offsets instead of silently fitting the wrong view. The game owns FOV, lighting, tone mapping and postprocessing.

## Gauge sockets

`cockpit.sockets.socket_gauge_1`, `socket_gauge_2` and `socket_gauge_3` run left to right. Their local XY planes face the eye, with local +Z pointing toward it. Use a small positive local-Z offset for the display. The source manifest records exact coordinates and display sizes.

```js
const material = new THREE.MeshBasicMaterial({
  map: yourCanvasTexture, // use SRGBColorSpace for colour content
  depthTest: true,
  depthWrite: true,
  toneMapped: false,
});
const display = new THREE.Mesh(
  new THREE.PlaneGeometry(0.47054, 0.11343), material,
);
display.position.z = 0.002;
cockpit.sockets.socket_gauge_1.add(display);
```

Each separate display adds one draw call and its texture; those are additional to the delivered empty cockpit. The preview uses three sample displays, redraws their text to suit the aspect ratio, and explicitly labels their values as samples. The game can batch its values or keep them in its existing HUD. The fitting transform preserves the gauge bay's screen fractions, so redraw text for the resulting width/height rather than stretching the same text bitmap between portrait and landscape.

## Rendering and lifecycle

The cockpit uses the GLB's normal opaque, single-sided PBR materials with depth testing and writing enabled. This preserves correct occlusion between its bevels, dashboard and insets. World geometry or depth-tested particles behind it stay behind it. It is not a depth-independent HUD: objects closer than the cockpit can cover parts of it, so hide the player's exterior ship and avoid intersecting camera geometry in first-person mode. Depth-test-disabled game effects can also paint over it and need integration ordering.

The model uses real PBR scene lighting, so provide the game's existing directional/ambient lighting. Cyan strips emit visually but add no real light sources. Do not disable the cockpit's depth testing: several solid parts overlap, and their internal depth is necessary for clean bevels. No depth-buffer clears or shader depth overrides are installed.

Return values: `object3d`, `sockets`, `meshes`, `materials`, `fitToCamera`, `getStats`, `dispose`. Each creation loads independent geometry and materials. `dispose()` removes the root and releases only the resources loaded by this instance; it is idempotent. Caller-attached gauge textures/materials/geometries remain caller-owned and must be disposed separately. Mutators throw after disposal. Failed loads reject; a GLB missing required sockets is cleaned up before rejection. Custom loaders must supply independent resources per creation.

No shadow maps, reflections, render targets, textures, lights, collision, motion or input handling are installed by the runtime helper. Validation uses temporary render targets to measure coverage; those are not part of the shipped cockpit runtime.

## Rebuild and review

`validate.py` passes **28 structural checks** against the actual GLB, including embedded resources, finite geometry/normals, face culling, material/binary budgets, exact socket names/transforms and manifest consistency. The conservative geometric projection leaves **81.06%** of the reference view clear.

`validate-browser.js` passes **35 checks in Chromium and 35 in emulated iPhone WebKit**, using actual r160 GLTFLoader/WebGL rendering. Tests cover projection fitting, visible draw/triangle counts, all sockets, camera parenting, normal depth occlusion, input validation and independent disposal. Five aspect/FOV/zoom cases leave **80.90–81.25%** of sampled pixels clear; the central 50%-width × 40%-height rectangle is completely unobstructed. These are rendered occupancy masks with the longest side sampled at 480 pixels, not a claim about every phone or game HUD layout.

Desktop **1440×900**, WebKit landscape **844×390** and portrait **390×844** views were visually inspected, including live rotation and 90° FOV. Final browser consoles contain **0 errors / 0 warnings**, with no shader or WebGL errors in the check reports. Preview sample gauge textures are recreated when their dimensions change so rotating does not reuse an incorrectly sized GPU texture. Their dimensions/costs are excluded from the empty cockpit's zero-texture budget.

Physical-phone FPS/GPU timing, live game-controller overlap and integrated first-person visibility remain unmeasured. A clear cockpit aperture does not account for buttons or HUD panels that the game adds on top. Final GLB SHA-256: `dce0ac26524567870d0e3d64d75026e2e1d2d9daf7e95c93e42fc096bdec2199`.

```sh
blender --background --python assets/A-007-cockpit/generate.py
python3 assets/A-007-cockpit/validate.py
python3 -m http.server 8766 --bind 127.0.0.1
```

Reuse the existing port 8766 server when it is running. Open `http://127.0.0.1:8766/assets/A-007-cockpit/preview.html`. Pilot, model inspection and occupancy-mask views are provided, with field-of-view and sample-label controls. Existing A-004 planet and A-011 environment assets supply preview scenery only and are excluded from cockpit cost.

Original geometry, palette, source, helper and preview are CC0-1.0. No external artwork was used. Blender and three.js/add-ons retain their upstream licenses. No game integration files were edited. Physical iPhone 12/XR frame rate and live game/controller composition remain unverified.
