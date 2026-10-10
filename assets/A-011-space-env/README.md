# A-011 — Space environment

Blue, violet and magenta nebula clouds with a sparse starfield, supplied as a bright space panorama and a dimmer nebula-interior variant. Both delivered JPEGs are **2048 × 1024**, in a 2:1 equirectangular projection.

| File | Purpose | Bytes |
| --- | --- | ---: |
| `space.jpg` | Bright space panorama | 494,033 |
| `space_nebula.jpg` | Dimmer variant | 395,700 |
| `environment.js` | Direct sky sampling, diffuse lighting and lifecycle helper | See file |
| `lighting.json` | Nine RGB spherical-harmonic coefficients per variant | See file |
| `space_source.png`, `space_nebula_source.png` | Unmodified generated originals | See files |
| `prompts.json` | Exact generation/edit prompts and export settings | See file |
| `bake_lighting.py` | Rebuild lighting coefficients and map evidence | See file |
| `map-validation.json`, `validate-browser.js` | Quantitative map evidence and browser checks | See files |

## Integrate

Use the same three.js **0.160.0** instance as the game. The helper imports only `three`; it loads its JPEG and `lighting.json` relative to its module URL. Serve these files over HTTP rather than opening the module through `file://`.

```js
import { createSpaceEnvironment } from './assets/A-011-space-env/environment.js';

const environment = await createSpaceEnvironment({
  variant: 'space',          // 'space' or 'nebula'
  intensity: 1,              // sky brightness
  lightingIntensity: 0.35,   // diffuse LightProbe strength
  rotation: 0,               // radians about world +Y
});
scene.add(environment.object3d);

// No per-frame update or camera-position following is needed.
environment.setIntensity(0.9);
environment.setLightingIntensity(0.3);
environment.setRotation(Math.PI / 4);
await environment.setVariant('nebula');

// On permanent scene teardown:
environment.dispose();
```

The return value contains `object3d`, `sky`, `probe`, read-only `texture` and `variant` getters, plus `setVariant`, `setIntensity`, `setLightingIntensity`, `setRotation` and `dispose`.

- `object3d` starts at the identity transform. Add it once to the intended scene. This helper does not assign `scene.background` or `scene.environment`; remove or disable a competing background in the integration if necessary.
- `sky` is a back-facing cube rendered before other opaque objects. Its shader uses camera rotation and ignores camera translation, with depth testing/writing disabled. It is intended for a **perspective camera**. Use `setRotation` to orient the panorama; moving or rotating the root is not a sky-positioning API.
- Positive `rotation` turns the artwork about world +Y. Longitude sampling matches three.js: `u = 0.5 + atan2(z,x)/(2π)`, `v = 0.5 + asin(y)/π`. +X is at the image centre and +Y at its top. The diffuse coefficients rotate with the artwork.
- `setVariant(name)` resolves `true` when its new texture is applied and `false` for an already active, superseded or disposed request. Duplicate pending requests share one promise. The previous sky remains visible while a replacement loads. Newer requests win; selecting the current variant cancels a pending switch. Real load failures reject and preserve the current sky.
- Optional `loader` accepts a `THREE.TextureLoader` or an object with `load`/`loadAsync`. A custom loader must return a **fresh texture per request**. The helper owns and disposes these returned textures, but does not dispose the loader or unrelated scene resources.
- Inputs must be finite; intensities accept 0–1,000,000 and rotation is wrapped to one revolution. Unknown variants reject/throw. `dispose()` is idempotent, removes the root and releases its texture, geometry, material and probe. Late loads are discarded and disposed. Mutating methods after disposal are safe no-ops; `texture` becomes `null` and `variant` retains the last selected name.

## Lighting and render cost

The helper contributes **one draw call, 12 triangles and one active texture**, measured in Chromium and emulated iPhone WebKit for each variant. Any preview objects, lights, UI or post-processing are additional; they are not part of that count.

The active 2048 × 1024 texture is sRGB, UV-mapped, linearly filtered with mipmaps, repeat-wrapped horizontally, clamped vertically and limited to anisotropy 1. An RGBA8 GPU allocation plus its complete mip chain is approximately **10.67 MiB**. This estimate excludes decoded CPU images, downloads, renderer overhead and temporary resources during a switch. The helper releases the old texture after a successful replacement rather than retaining both variants as a texture cache.

`probe` supplies **diffuse image-based lighting only**. `bake_lighting.py` converts JPEG sRGB to linear radiance, integrates with spherical solid-angle weights, and applies the same seam/pole sampling guards as the shader, and stores the nine coefficients in the `THREE.SphericalHarmonics3` basis. Rotation uses the exact linear/quadratic coefficient transform, without rendering a lighting capture.

There is **no specular environment lighting**, cubemap conversion, PMREM generation, reflection rendering or shadow-map pass. Metallic objects therefore do not receive a reflected starfield from this helper; existing game lighting remains relevant. The sky works with the game's existing tone mapping and bloom, and also renders without bloom. One draw call still shades the visible background pixels; it is not evidence of physical-phone frame rate.

## Source and rebuild

The artwork was generated with the **built-in `image_gen` tool**. The bright image was generated from the exact text in `prompts.json`; the dim variant was an edit of that generated bright image. The world-look reference supplied palette and composition direction through text, with no external reference image submitted to generation. No outside photograph, texture or stock image was imported.

The generated originals were **1774 × 887**, already an exact 2:1 aspect ratio. macOS `sips` performed the mechanical resize/export to 2048 × 1024 JPEG, quality 92; the source PNGs remain unmodified. This resize does not create additional native artwork detail. Generation is not promised to be repeatable: retaining the originals is the way to reproduce the exact delivered JPEGs.

From the repository root:

```sh
sips -s format jpeg -s formatOptions 92 -z 1024 2048 \
  assets/A-011-space-env/space_source.png \
  --out assets/A-011-space-env/space.jpg
sips -s format jpeg -s formatOptions 92 -z 1024 2048 \
  assets/A-011-space-env/space_nebula_source.png \
  --out assets/A-011-space-env/space_nebula.jpg

# Requires Python, NumPy and Pillow. This reads images; it does not edit them.
python3 assets/A-011-space-env/bake_lighting.py
```

The bake rewrites `lighting.json` and `map-validation.json`, including final JPEG hashes. In this workspace `/opt/homebrew/anaconda3/bin/python3` has the required NumPy/Pillow dependencies.

Serve the repository root with any static HTTP server. If port 8766 is already occupied by the existing asset server, reuse it:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 \
  --directory /Users/jaumepuig/Documents/growth-hackathon
```

Open `http://127.0.0.1:8766/assets/A-011-space-env/preview.html` for the interactive preview. `validate-browser.js` exports its browser audit. Final browser reports, console logs and desktop/WebKit captures are included alongside it. The World contrast view uses existing boss, planet and ship assets solely as review props (the ship is scaled 3x; portrait layout also scales/repositions the planet). Their costs are reported separately from the sky.

## Evidence and remaining limits

The current map evidence passes **six checks**: exact dimensions, finite lighting coefficients, a dimmer nebula variant, correlated composition, a bounded raw wrap difference, and uniform guarded pole colours. The dim variant has **0.2986×** the bright variant's solid-angle-weighted mean **linear luminance**; this is not a perceived-brightness ratio.

The source edges are **not pixel-identical**. Mean left/right differences are approximately **6.4 code levels** for `space.jpg` and **4.7 code levels** for `space_nebula.jpg`, on a 0–255 sRGB scale. The sky shader blends mirrored edge samples toward their average within the final **1% of U on each side**, then smoothly returns to ordinary sampling. Wrapped longitude derivatives and explicit texture gradients additionally avoid a WebKit mip-level stripe at the wrap; this uses WebGL2, or the WebGL1 `OES_standard_derivatives` and `EXT_shader_texture_lod` extensions. Both final browsers used WebGL2; a WebGL1 fallback is not verified. This is a runtime seam guard, not an alteration of the delivered images or a guarantee that every renderer will hide the raw seam. The shader also fades toward averaged edge colours over `abs(direction.y) = .80` to `.995`, removing the pinched pole centre; the exact polar cap is uniform and avoids the undefined `atan(0,0)`. These are runtime sampling corrections: use the helper for the reviewed result. Directly assigning the raw JPEG as a background will retain edge differences and pole distortion. Some stretched wisps/stars remain outside the uniform caps; broad darker polar regions are intentional.

**37 Chromium and 37 emulated iPhone WebKit browser checks pass**. They cover both real JPEGs, one-call/12-triangle/one-texture rendering, finite SH data and orientation, pixel-identical views under camera translation, camera/panorama rotation, independent instances, lazy loading, duplicate requests, cancellation, newest-request selection, failure preservation and disposal races. Additional pixel checks verify uniform polar centres in both variants under four panorama rotations and reject a narrow dark seam in both variants. Both final runs reported zero shader/GL errors and zero console errors/warnings; console evidence is saved alongside the reports.

Final visual review covers bright/dim world contrast, both poles, the horizontal seam and diffuse-only matte spheres in Chromium at 1440 × 1000 and emulated iPhone 13 WebKit at 844 × 390, plus portrait layout at 390 × 844. WebKit device DPR is 3; renderer DPR is capped at 1.5. The corrected centres are smooth, and the horizontal wrap is continuous in these views. No physical iPhone 12/XR performance, game integration or whole-game frame-rate claim is made.

## License

Original artwork and custom source are dedicated under **CC0-1.0 to the extent the contributors hold applicable rights**; see `LICENSE.txt`. The generated imagery carries no guarantee of copyright eligibility, exclusive ownership or repeatable generation. three.js and its tools retain their upstream licenses and are not relicensed by this dedication.
