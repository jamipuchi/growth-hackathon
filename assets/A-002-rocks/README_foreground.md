# A-002 foreground extension — giant stone rocks

Three original, chunky stone silhouettes for the requested **60–120 m foreground rocks**. This extension is separate from the existing six-type field-rock kit: `rocks.glb`, `rocks.js`, its maps, generator and existing documentation are unchanged.

The new files are `foreground.glb`, `foreground.js`, editable `foreground_source.blend`, `generate_foreground.py` and `foreground-manifest.json`. The GLB contains `foreground_stone_1`, `foreground_stone_2` and `foreground_stone_3`, all at the origin, with a shared opaque vertex-colour PBR material and no textures. Add instances or a selected template, not the whole overlapping template scene.

## Integrate

```js
import {createForegroundRocks} from './assets/A-002-rocks/foreground.js';

const field = await createForegroundRocks({
  seed: 73,
  rocks: [
    {id:'near_left', variant:1, diameter:120, position:[-105,-50,105]},
    {id:'near_right', variant:2, diameter:90, position:[108,-40,100]},
    {id:'distant', variant:3, diameter:60, position:[-95,40,-230]},
  ],
});
scene.add(field.object3d);

// No update callback is needed for static rocks.
field.hide('near_left');

// Permanent scene teardown:
field.dispose();
```

The example coordinates are preview placements, not a tested gameplay route. Supply the game's intended foreground positions and update authoritative collision/layout separately. No game integration files are changed by this delivery.

`diameter` means the **longest authored bounding-box dimension before rotation**, in metres. Each source shape has a longest span of 2 m, and is centred at its signed-volume centre of mass. This differs from the older field helper's `radius` convention. A requested diameter of 60, 90 or 120 therefore produces that exact longest local-axis span; a rotated world-axis AABB can have a different span. These are irregular objects, not spheres.

`variant` is 1–3; omit it for deterministic seeded selection. `quaternion` is optional `[x,y,z,w]`, default identity, normalized during setup. Inputs are copied before asynchronous loading. Records require unique IDs, finite positions and positive finite sizes; invalid inputs reject before loading. No placement, rotation or collision is updated automatically. Empty input produces an empty group and no asset download.

At most 65,535 records are accepted. IDs may be nonempty strings or finite numbers; omitted IDs use the record index. Diameter is capped at 1,000,000 m and vector components at an absolute 1,000,000,000. Arrays, typed arrays and Vector3/Quaternion-style objects are accepted for transforms. Custom loaders must return fresh, independently owned GLTF resources: the helper copies the required data and releases the loaded source in `finally`.

## Rendering and ownership

The three variants share the same **256-triangle topology**. A single `InstancedMesh` selects alternative position, normal and colour attributes in a small `MeshStandardMaterial` vertex-shader hook. Each visible rock submits **256 triangles**; three rocks submit **768 triangles in one draw**. There are no hidden copies of the other variants submitted as degenerate triangles. The exported GLB also works with ordinary GLTFLoader rendering without the batching helper.

The batching helper uses **14 vertex attribute locations**: nine position/normal/colour attributes across the three shapes, one instance variant selector, and four matrix columns. Both tested WebGL2 implementations expose 16 available locations; the linked shader uses locations through index 14. Use a 16-location-capable context for the verified path; lower-limit WebGL1 contexts are unverified. The runtime uses no textures, lights, animation, shadows, reflections, render targets or per-frame buffers. Existing scene lighting/tone mapping supplies the final look. The UV data in the export records topology IDs for validation; the helper removes it before upload.

Keep the helper's material shader hooks when composing other customizations. Built-in raycasting cannot see the variant-selected GPU shape: use authoritative logical collision bounds, or the original individual GLB templates for exact mesh raycasts. Shadow rendering is disabled because a separate variant-aware shadow shader is not supplied.

Each factory call owns independent GPU buffers and material state. `hide(id)` removes the record by compacting the existing instance buffers; hidden instances stop contributing submitted triangles. Other handles are updated. `dispose()` removes the group and releases loaded/created resources once. Do not reuse disposed instances. `getStats()` reports the active submission cost; `object3d`, `mesh` and `handles` are available for inspection. Treat handles/mesh buffers as read-only unless you also update all variant, index and bounding data consistently.

The geometry bounds enclose all three shader-selected shapes; instance bounds cover supplied transforms. This avoids culling a wider alternate shape based only on variant 1. The helper owns no gameplay hit points, destruction effect, navigation, automatic LOD or distance culling policy.

## Rebuild and preview

The GLB is **109,828 bytes**, storing three 256-triangle source meshes (768 triangles total), with one material and zero textures. SHA-256: `642e68d0b5680dbbb8244cd35c23718a5145b9d04eeffd39235d300519024095`.

`validate_foreground.py` passes **31 structural checks**: real binary/accessor data, finite positions/normals/colours, valid outward winding, closed connected manifolds, positive volume, centre of mass, 2 m longest extents, shared material/budgets and source-to-export vertex/triangle identities. The original field GLB/helper/colour/emission maps are checked against saved hashes and remain byte-identical. Browser submission and visual evidence are recorded separately.

`validate-foreground-browser.js` passes **24 checks in Chromium and 24 in emulated iPhone WebKit**. Three variants from three viewpoints each are **pixel-identical** to their separately loaded GLB counterparts under matching transforms and lighting: zero silhouette or RGB difference in nine comparisons per browser. Actual submissions are **768 triangles / one draw** for the three-rock scene; compiled shaders use 14 active attribute slots on the tested 16-location contexts. Tests also cover seeded selection, copied inputs during an awaited load, normalized rotations, transformed bounds/culling, compacting hide, zero-draw empty/all-hidden states and independent disposal. Final consoles and shader/GL reports have zero errors or warnings.

Bright-space approach, plain studio gallery, all three close views, sampled fly-past positions and live rotation were visually reviewed at desktop **1440×900**, WebKit landscape **844×390** and portrait **390×844**. An independent review found no asset blocker. Camera-relative comparison-ship framing was corrected in the preview so camera bob does not crop it. Fly-past screenshots sample the motion; they are not exhaustive every-frame or physical-phone performance evidence.

```sh
blender --background --python assets/A-002-rocks/generate_foreground.py
python3 assets/A-002-rocks/validate_foreground.py
python3 -m http.server 8766 --bind 127.0.0.1
```

Reuse the existing preview server if port 8766 is occupied. Open `http://127.0.0.1:8766/assets/A-002-rocks/preview-foreground.html` for the flight approach, size gallery, three close inspections, plain studio view and fly-past. The A-004 planet, A-009 ship and A-011 sky are existing review props; their cost is reported separately. The ship is shown at its actual approximately 3 m length.

Original foreground geometry, palette, source, helper and review files are **CC0-1.0**, under the existing `LICENSE.txt`. No external artwork was imported. Blender and three.js/add-ons retain upstream licenses. Physical iPhone 12/XR frame rate, combined game performance and gameplay collisions remain unmeasured.
