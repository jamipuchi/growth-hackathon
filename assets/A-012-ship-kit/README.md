# A-012 · Shared ship texture kit

Original bright painted panels, matching panel normals, five material patterns and sixteen alpha decals for chunky drawn ships. The kit supplies textures and a material helper; it does not build ships, assign material groups, add lights or change game code. The drawing's colour remains the material's tint.

Use the application's existing **three.js 0.160.0** module instance. Serve this directory over HTTP with its PNGs beside `ship-kit.js`; the loader resolves URLs relative to the module. The preview, generator, manifests and independent validation artifacts are separate from the runtime helper.

| Image | Size | Colour space | Sampling |
| --- | --- | --- | --- |
| `panels.png` | 512 × 512 | sRGB | Repeat, trilinear mipmaps |
| `panels-normal.png` | 512 × 512 | NoColorSpace | Repeat, trilinear mipmaps; OpenGL tangent +Y |
| `surfaces.png` | 1024 × 1024 | sRGB | Repeat, bilinear; **no mipmaps** |
| `decals.png` | 1024 × 1024 | sRGB | Clamp to edge, trilinear mipmaps; alpha |

All use anisotropy 1 and `flipY=true`. The four source images total **187,878 bytes** on disk in the supplied manifest. Estimated RGBA8 GPU storage with these sampler settings is **12,582,908 bytes, approximately 12 MiB**, excluding browser-decoded images, driver overhead and loading transients. An all-images-with-mips estimate would be larger; the helper intentionally disables surface-atlas mipmaps.

`loadShipKit()` shares one promise and one kit across all 25 ships in the same JS module realm. It loads **four image sources**. `surfaces`, `stripes`, `hazard`, `racing`, `glass`, `nozzle` and `trim` share the same `THREE.Source`; their WebGL sampler/upload settings are identical. Only the texture-view UV transforms differ. This is designed to share one surface GPU allocation per renderer under [three.js r160's Source and sampler cache](https://github.com/mrdoob/three.js/blob/r160/src/renderers/webgl/WebGLTextures.js). Actual resource counts require renderer verification; each independent WebGL renderer has its own GPU allocations.

Do not change a shared texture's colour space, wrapping, filters, anisotropy, `flipY`, mip settings or image per ship: this either affects every consumer or creates another GPU allocation. Per-material settings go through the helper. Reuse the same import URL so a cache-busting second module import does not create another kit cache.

```js
import * as THREE from 'three';
import { loadShipKit, applyShipSurface } from './assets/A-012-ship-kit/ship-kit.js';

const kit = await loadShipKit();
const hullMaterial = new THREE.MeshStandardMaterial({
  color: '#32bdf3', // the player's drawing colour
  roughness: 0.65,
  metalness: 0.15,
});
applyShipSurface(hullMaterial, kit, 'panels', { normalScale: 0.35 });

const stripeMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff, roughness: 0.65,
});
applyShipSurface(stripeMaterial, kit, 'racing');

// Example: 3m-wide, 1m-tall geometry whose UV units also represent metres.
const panelGeometry = new THREE.PlaneGeometry(3, 1);
const uv = panelGeometry.getAttribute('uv');
for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i));
uv.needsUpdate = true;
const panel = new THREE.Mesh(panelGeometry, hullMaterial);
```

**Runtime API**

`await loadShipKit()` returns `{panels, panelsNormal, stripes, glass, nozzle, trim, decals, decalRects}` plus `racing`, `hazard` (the same object as `stripes`), full-atlas `surfaces`, `surfaceRects` and a `disposed` getter. The kit and metadata objects are frozen; the texture objects are shared engine resources. A failed load releases its textures, rejects with the actual failure and clears the cache so the next call can retry. Image dimensions are checked before returning the kit.

`applyShipSurface(material, kit, name, options = {})` accepts `MeshStandardMaterial` and `MeshPhysicalMaterial` and returns the material. Names are `panels`, `stripes`/`hazard`, `racing`, `glass`, `nozzle` and `trim`. It installs a shader hook, sets `map`, and adds the matched normal only for `panels`; other names clear `normalMap`. It preserves colour, vertex colours, roughness, metalness, opacity and transparency. For a glass appearance, choose those material properties explicitly; the texture alone does not enable transmission or a reflection pass.

Options are `metersPerTile` (default 1; positive, 0.0001–1,000,000), `offset` (default `[0,0]`, also accepts a `Vector2`-like object; measured in tile cycles), `rotation` (radians about UV origin, default 0), and `normalScale` (default 0.35; 0–4). Values must be finite; offsets and rotation are bounded to ±1,000,000. Inputs are copied into material-specific uniforms. Reapplying updates that material without stacking hooks or changing the shared textures. Normal UV rotation supports both derivative and explicit tangent frames.

**One UV unit must represent one metre** for one tile per metre. A primitive's default 0–1 UVs cover its face regardless of physical size; scale or generate its UVs when building the part. Changing a mesh's world scale later does not update UV density automatically. The helper uses UV channel 0 and replaces the map/normal-map transform for these two maps only; roughness, emissive and other maps retain their own transforms. Panel tint works best with the greyscale panels; leave coloured surface patterns white-tinted when their original colours should remain visible.

The atlas path takes `fract()` of continuous tile UVs and remaps into the selected core, so negative UVs and UVs larger than one repeat only that material. The generator supplies wrapped 16 px gutters for bilinear filtering across each core edge. Surface mipmaps are disabled to prevent distant mip levels from mixing neighbouring material cells. This avoids an explicit-gradient/texture-LOD extension requirement, but fine patterns can shimmer under strong minification; distant material simplification is an integration choice. No physical-phone performance is asserted.

The helper chains an existing `onBeforeCompile` and `customProgramCacheKey`; it requires the standard r160 `uv_vertex`, `map_fragment` and, for panels, `normal_fragment_maps` include hooks to remain available. A conflicting hook reports an error. Install other custom shader hooks before this helper, or call `clearShipSurface(material)` before replacing them. Reapply after `material.clone()`: three.js does not clone custom compile hooks. One helper call selects one surface per material/draw; it does not select arbitrary surface names per instance.

`clearShipSurface(material)` restores the pre-helper maps and hooks that this helper still owns, returns whether a patch existed, and never disposes textures. Caller changes to unrelated material properties survive. `disposeShipKit()` is the explicit **global** lifecycle call, returns whether a cached generation existed, and disposes its base and view textures once. Detach/dispose every consuming ship material before calling it. Do not dispose shared maps when removing one ship. Calls during loading mark that generation disposed; its promise rejects as image requests complete, while a subsequent `loadShipKit()` starts a fresh generation. The browser's image requests themselves are not aborted. A disposed kit cannot be reapplied.

**Atlas metadata and direct maps**

`getShipSurfaceRect(name)` and `getShipDecalRect(name)` return immutable metadata without loading images. Each entry includes `pixels:{x,y,width,height}` measured from the image's top-left, `uv:{offset:[u,v],repeat:[w,h]}` for the raw core, and `texelCenters:{offset,repeat}` for the first-to-last pixel centres. Flat `x/y/width/height/u/v/w/h` fields match the generated JSON metadata. UVs already account for `flipY=true`; do not invert V again.

| Surface | Top-left core `(x, y, width, height)` |
| --- | --- |
| stripes / hazard | 16, 16, 480, 224 |
| racing | 16, 272, 480, 224 |
| glass | 528, 16, 480, 480 |
| nozzle | 16, 528, 480, 480 |
| trim | 528, 528, 480, 480 |

Assigning `material.map = kit.glass` directly crops **one UV tile only**: UVs outside 0–1 leave the selected region because ordinary `Texture.repeat` repeats the full image. Use `applyShipSurface` for repeated metre UVs. For merged geometry with several different surface regions in a single draw, bake each face's 0–1 UVs into its raw-core rectangle and use `kit.surfaces` directly. Do not apply the single-surface wrapper to that already-atlased geometry.

Decals occupy a 4 × 4 grid in row-major image order: `0`–`9`, `star`, `chevrons`, `flame`, `shield`, `bolt`, `wing`. Every 256 px cell has a 192 × 192 artwork interior at cell offset `(32,32)`. Bake individual rects into the decal geometry and reuse `kit.decals`; this requires no per-decal texture clone and lets merged stickers share one material. Numeric arguments 0–9 and their string forms both work.

```js
import { getShipDecalRect } from './assets/A-012-ship-kit/ship-kit.js';

const geometry = new THREE.PlaneGeometry(0.4, 0.4);
const rect = getShipDecalRect('star').texelCenters;
const uv = geometry.getAttribute('uv');
for (let i = 0; i < uv.count; i++) {
  uv.setXY(i,
    rect.offset[0] + uv.getX(i) * rect.repeat[0],
    rect.offset[1] + uv.getY(i) * rect.repeat[1]);
}
uv.needsUpdate = true;
const material = new THREE.MeshStandardMaterial({
  map: kit.decals, color: 0xffffff, alphaTest: 0.2, roughness: 0.8,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
});
const sticker = new THREE.Mesh(geometry, material); // place just above the hull
```

The 32 px transparent decal margin limits ordinary edge bleed, but tiny decals can disappear or merge at very coarse mip levels; cull them by distance if needed. Decal normals, placement, depth ordering and material draw counts belong to the ship builder. This kit adds no animation, render targets, reflection passes or lights. Its four-image budget is independent of the number of part materials/draw calls.

**Source and verification**

The provided artwork is original deterministic procedural/vector-like artwork, with no external image or font sources. `texture-manifest.json` records image sizes, hashes and source information; `decal-rects.json` is the pixel/UV interchange format. Original custom helper code is dedicated CC0-1.0 to the extent applicable rights exist; three.js retains its upstream MIT license.

The coordinating asset model verified this standalone asset delivery on 10 October 2026. `validation.json` records **73/73 static checks** for PNG decoding, hashes, dimensions, neutral paint, repeat seams, normals, wrapped gutters and decal bounds. `browser-validation-chrome.json` and `browser-validation-webkit.json` each record **34/34 passing checks**, including real uploads, four GPU textures across 25 material groups, shader compilation, integer-UV pixel agreement (maximum channel difference 2/255), cache-hook compatibility and restoration. Both lifecycle reports show GPU texture counts **4 → 0 → 4** on disposal/reload. Final browser console captures contain zero errors/warnings. The initial Chrome attempt requested an unavailable cached Chromium revision; installed Chrome was used instead.

Visually inspected the texture sheet, repeated surfaces, sample front/rear, 25-ship fleet, and WebKit at 390 × 844 and 844 × 390 CSS pixels (iPhone 13 emulation, DPR 3; preview render DPR capped at 1.5). The illustrative ship is 384 triangles / three draws; its 25-instance fixture is 9,600 triangles / three draws, still four textures. Those are fixture counts, not generated-game-ship or game performance results. Full-page phone screenshots include scrolled content. Preview captures were taken during validation, before the final verification footer was updated.

The current full-game implementation round was not tested. No game integration code was edited. Physical iPhone frame time, thermal behavior, final ship geometry and final draw-call integration remain unmeasured. The kit has no per-frame update; distant atlas-pattern shimmer is the documented no-mipmap tradeoff.
