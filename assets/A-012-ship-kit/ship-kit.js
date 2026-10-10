// Original Space Party ship-kit helper. CC0-1.0 to the extent applicable.
// Use the same three.js r160 module instance as the application.
import * as THREE from 'three';

const ATLAS_SIZE = 1024;
const DECAL_NAMES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'star', 'chevrons', 'flame', 'shield', 'bolt', 'wing'];

function rectangle(name, x, y, width, height, imageSize = ATLAS_SIZE) {
  // PNG metadata starts at top-left; TextureLoader flipY=true uses bottom-left UVs.
  const u = x / imageSize, v = 1 - (y + height) / imageSize;
  const w = width / imageSize, h = height / imageSize;
  return Object.freeze({
    name, x, y, width, height, u, v, w, h,
    imageWidth: imageSize, imageHeight: imageSize,
    pixels: Object.freeze({ x, y, width, height }),
    uv: Object.freeze({ offset: Object.freeze([u, v]), repeat: Object.freeze([w, h]) }),
    texelCenters: Object.freeze({
      offset: Object.freeze([(x + 0.5) / imageSize, (imageSize - y - height + 0.5) / imageSize]),
      repeat: Object.freeze([(width - 1) / imageSize, (height - 1) / imageSize]),
    }),
  });
}

const hazardRect = rectangle('hazard', 16, 16, 480, 224);
const SURFACE_RECTS = Object.freeze({
  panels: rectangle('panels', 0, 0, 512, 512, 512),
  stripes: hazardRect,
  hazard: hazardRect,
  racing: rectangle('racing', 16, 272, 480, 224),
  glass: rectangle('glass', 528, 16, 480, 480),
  nozzle: rectangle('nozzle', 16, 528, 480, 480),
  trim: rectangle('trim', 528, 528, 480, 480),
});
const DECAL_RECTS = Object.freeze(Object.fromEntries(DECAL_NAMES.map((name, i) => [name,
  rectangle(name, (i % 4) * 256 + 32, Math.floor(i / 4) * 256 + 32, 192, 192),
])));

/** Frozen pixel/UV metadata. stripes and hazard are aliases for the same core. */
export function getShipSurfaceRect(name) {
  if (typeof name !== 'string' || !Object.hasOwn(SURFACE_RECTS, name)) {
    throw new RangeError(`Unknown ship surface: ${String(name)}`);
  }
  return SURFACE_RECTS[name];
}

/** A number 0..9 or a named sticker; UVs account for TextureLoader's flipY. */
export function getShipDecalRect(name) {
  if ((typeof name !== 'string' && typeof name !== 'number') || !Object.hasOwn(DECAL_RECTS, name)) {
    throw new RangeError(`Unknown ship decal: ${String(name)}`);
  }
  return DECAL_RECTS[name];
}

let cached = null;
const kitRecords = new WeakMap();

function cancelled() {
  const error = new Error('Ship kit was disposed while textures were loading.');
  error.name = 'AbortError';
  return error;
}

function ownTexture(record, texture) {
  record.textures.add(texture);
  if (record.disposed) texture.dispose();
  return texture;
}

function release(record) {
  if (record.disposed) return;
  record.disposed = true;
  for (const texture of record.textures) texture.dispose();
}

function configure(texture, name, { normal = false, atlas = false, decal = false } = {}) {
  texture.name = `ship_kit_${name}`;
  texture.mapping = THREE.UVMapping;
  texture.channel = 0;
  texture.colorSpace = normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = decal ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  // All surface views must retain exactly this sampler state for GPU Source reuse.
  // No atlas mipmaps: distant mip levels would merge neighbouring material cells.
  texture.minFilter = atlas ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = !atlas;
  texture.anisotropy = 1;
  texture.flipY = true;
  texture.premultiplyAlpha = false;
  texture.unpackAlignment = 4;
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.internalFormat = null;
  texture.offset.set(0, 0);
  texture.repeat.set(1, 1);
  texture.center.set(0, 0);
  texture.rotation = 0;
  texture.updateMatrix();
  texture.needsUpdate = true;
  return texture;
}

function loadTexture(record, loader, filename, width, height, options) {
  const url = new URL(filename, import.meta.url).href;
  return new Promise((resolve, reject) => {
    // Track the placeholder immediately: failures and disposal during loading also
    // release every Texture, without waiting for an image to finish downloading.
    const texture = loader.load(url, loaded => {
      if (record.disposed) { reject(cancelled()); return; }
      if (loaded.image.width !== width || loaded.image.height !== height) {
        reject(new Error(`${filename} must be ${width} x ${height} pixels.`));
        return;
      }
      try { resolve(configure(loaded, filename.replace('.png', '').replaceAll('-', '_'), options)); }
      catch (error) { reject(error); }
    }, undefined, cause => {
      reject(record.disposed ? cancelled() : new Error(`Could not load ship kit texture ${filename}.`, { cause }));
    });
    ownTexture(record, texture);
  });
}

function makeView(record, source, name) {
  const view = ownTexture(record, source.clone());
  const rect = getShipSurfaceRect(name);
  // clone() shares THREE.Source. Only uniforms (UV transforms) differ; image and
  // every WebGL sampler/upload option remain identical to the full-atlas base.
  view.name = `ship_kit_${name}`;
  view.offset.fromArray(rect.uv.offset);
  view.repeat.fromArray(rect.uv.repeat);
  view.updateMatrix();
  return view;
}

/**
 * Load once and share the returned textures across all ships in this JS realm.
 * Simultaneous calls return the same promise. A rejected load can be retried.
 * No TextureLoader cache, canvas, renderer, material or scene is created here.
 */
export function loadShipKit() {
  if (cached) return cached.promise;
  const record = { textures: new Set(), disposed: false, promise: null };
  cached = record;
  const loader = new THREE.TextureLoader();
  record.promise = Promise.all([
    loadTexture(record, loader, 'panels.png', 512, 512, {}),
    loadTexture(record, loader, 'panels-normal.png', 512, 512, { normal: true }),
    loadTexture(record, loader, 'surfaces.png', 1024, 1024, { atlas: true }),
    loadTexture(record, loader, 'decals.png', 1024, 1024, { decal: true }),
  ]).then(([panels, panelsNormal, surfaces, decals]) => {
    if (record.disposed) throw cancelled();
    const stripes = makeView(record, surfaces, 'stripes');
    const kit = Object.freeze({
      panels, panelsNormal, surfaces, stripes, hazard: stripes,
      racing: makeView(record, surfaces, 'racing'),
      glass: makeView(record, surfaces, 'glass'),
      nozzle: makeView(record, surfaces, 'nozzle'),
      trim: makeView(record, surfaces, 'trim'),
      decals, decalRects: DECAL_RECTS, surfaceRects: SURFACE_RECTS,
      get disposed() { return record.disposed; },
    });
    kitRecords.set(kit, record);
    return kit;
  }).catch(error => {
    release(record);
    if (cached === record) cached = null;
    throw error;
  });
  return record.promise;
}

/**
 * Global lifecycle, not per ship. Detach/dispose all consuming materials first.
 * An in-flight load rejects; a subsequent loadShipKit() starts a fresh generation.
 * ImageLoader requests themselves cannot be aborted by this API.
 */
export function disposeShipKit() {
  if (!cached) return false;
  const record = cached;
  cached = null;
  release(record);
  return true;
}

const materialPatches = new WeakMap();

function finite(value, name, min = -1e6, max = 1e6) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite and between ${min} and ${max}.`);
  }
  return value;
}

function settings(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Surface options must be an object.');
  const { metersPerTile = 1, offset = [0, 0], rotation = 0, normalScale = 0.35 } = options;
  finite(metersPerTile, 'metersPerTile', 1e-4, 1e6);
  finite(rotation, 'rotation');
  finite(normalScale, 'normalScale', 0, 4);
  let x, y;
  if ((Array.isArray(offset) || ArrayBuffer.isView(offset)) && offset.length === 2) [x, y] = offset;
  else if (offset && typeof offset === 'object' && 'x' in offset && 'y' in offset) ({ x, y } = offset);
  else throw new TypeError('offset must be [x, y] or a Vector2-like object.');
  finite(x, 'offset.x'); finite(y, 'offset.y');
  const angle = rotation % (2 * Math.PI), c = Math.cos(angle), s = Math.sin(angle);
  return { normalScale, c, s, matrix: new THREE.Matrix3().set(
    c / metersPerTile, -s / metersPerTile, x,
    s / metersPerTile, c / metersPerTile, y,
    0, 0, 1,
  ) };
}

function installPatch(material) {
  const state = {
    originalCompile: material.onBeforeCompile,
    originalKey: material.customProgramCacheKey,
    originalMap: material.map,
    originalNormal: material.normalMap,
    originalNormalType: material.normalMapType,
    originalNormalScale: material.normalScale.clone(),
    mode: 'atlas',
    uniforms: {
      uShipKitUv: { value: new THREE.Matrix3() },
      uShipKitRect: { value: new THREE.Vector4() },
      uShipKitRotation: { value: new THREE.Vector2(1, 0) },
    },
  };
  state.compile = function (shader, renderer) {
    state.originalCompile.call(this, shader, renderer);
    if (!shader.vertexShader.includes('#include <uv_vertex>') || !shader.fragmentShader.includes('#include <map_fragment>')) {
      throw new Error('applyShipSurface requires the three.js r160 uv_vertex and map_fragment shader hooks.');
    }
    Object.assign(shader.uniforms, state.uniforms);
    shader.vertexShader = 'uniform mat3 uShipKitUv;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `
      #include <uv_vertex>
      #ifdef USE_MAP
        vMapUv = (uShipKitUv * vec3(uv, 1.0)).xy;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv = (uShipKitUv * vec3(uv, 1.0)).xy;
      #endif
    `);
    if (state.mode === 'atlas') {
      shader.fragmentShader = 'uniform vec4 uShipKitRect;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          // Base-level bilinear sampling only; wrapped gutters make this periodic.
          vec2 shipKitUv = uShipKitRect.xy + fract(vMapUv) * uShipKitRect.zw;
          diffuseColor *= texture2D(map, shipKitUv);
        #endif
      `);
    } else {
      // Derivative tangent frames already follow rotated vNormalMapUv. Explicit
      // geometry tangents do not, so rotate sampled XY back into their UV basis.
      if (!shader.fragmentShader.includes('#include <normal_fragment_maps>')) {
        throw new Error('Panel normal mapping requires the r160 normal_fragment_maps shader hook.');
      }
      shader.fragmentShader = 'uniform vec2 uShipKitRotation;\n' + shader.fragmentShader;
      const normalChunk = THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', `
        #ifdef USE_TANGENT
          mapN.xy = mat2(uShipKitRotation.x, -uShipKitRotation.y,
                        uShipKitRotation.y, uShipKitRotation.x) * mapN.xy;
        #endif
        mapN.xy *= normalScale;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', normalChunk);
    }
  };
  state.cacheKey = function () {
    // The default key reads this.onBeforeCompile, which is now our wrapper.
    // Preserve the original hook's source too, or distinct prior shaders collide.
    return `${state.originalKey.call(this)}|prior:${state.originalCompile.toString()}|ship-kit-r160-v1:${state.mode}`;
  };
  material.onBeforeCompile = state.compile;
  material.customProgramCacheKey = state.cacheKey;
  materialPatches.set(material, state);
  return state;
}

/**
 * Install/reconfigure a shared texture without mutating that Texture's transform.
 * Geometry uv values are metres: one UV unit repeats one tile by default.
 * Material colour, vertex colours, metalness, roughness and alpha settings survive.
 * Returns the material; reapply on material clones (three.js does not clone hooks).
 */
export function applyShipSurface(material, kit, name, options = {}) {
  if (!material?.isMeshStandardMaterial) throw new TypeError('Use a THREE.MeshStandardMaterial or MeshPhysicalMaterial.');
  const record = kit && kitRecords.get(kit);
  if (!record || record.disposed) throw new Error('Use a live kit returned by loadShipKit().');
  const rect = getShipSurfaceRect(name);
  const opts = settings(options);
  let state = materialPatches.get(material);
  if (state && (material.onBeforeCompile !== state.compile || material.customProgramCacheKey !== state.cacheKey)) {
    throw new Error('Material shader hooks changed after applyShipSurface; clear the patch before replacing hooks.');
  }
  if (!state) state = installPatch(material);
  state.mode = name === 'panels' ? 'panels' : 'atlas';
  state.uniforms.uShipKitUv.value.copy(opts.matrix);
  state.uniforms.uShipKitRect.value.set(rect.u, rect.v, rect.w, rect.h);
  state.uniforms.uShipKitRotation.value.set(opts.c, opts.s);
  state.map = kit[name];
  state.normal = name === 'panels' ? kit.panelsNormal : null;
  material.map = state.map;
  material.normalMap = state.normal;
  if (state.normal) {
    material.normalMapType = THREE.TangentSpaceNormalMap;
    material.normalScale.set(opts.normalScale, opts.normalScale);
  }
  material.needsUpdate = true;
  return material;
}

/** Remove only this helper's hooks/maps. Shared textures are never disposed here. */
export function clearShipSurface(material) {
  const state = material && materialPatches.get(material);
  if (!state) return false;
  if (material.onBeforeCompile === state.compile) material.onBeforeCompile = state.originalCompile;
  if (material.customProgramCacheKey === state.cacheKey) material.customProgramCacheKey = state.originalKey;
  if (material.map === state.map) material.map = state.originalMap;
  if (material.normalMap === state.normal) {
    material.normalMap = state.originalNormal;
    material.normalMapType = state.originalNormalType;
    material.normalScale.copy(state.originalNormalScale);
  }
  materialPatches.delete(material);
  material.needsUpdate = true;
  return true;
}
