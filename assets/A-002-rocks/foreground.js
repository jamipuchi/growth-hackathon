/** Original CC0 Space Party foreground rocks. three.js r160, no texture assets. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEFAULT_URL = new URL('./foreground.glb', import.meta.url).href;
const TRIANGLES = 256, SOURCE_VERTICES = 130;
const NAMES = ['foreground_stone_1', 'foreground_stone_2', 'foreground_stone_3'];

function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
function vector(value, length, name) {
  const values = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : value && (length === 3 ? [value.x, value.y, value.z] : [value.x, value.y, value.z, value.w]);
  if (!values || values.length !== length || values.some(v => !Number.isFinite(v) || Math.abs(v) > 1e9)) throw new TypeError(`${name} must contain ${length} finite components within one billion`);
  return values;
}
function random(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296;};
}
function prepare(rocks, seed) {
  finite(seed, 'seed');
  if (!Array.isArray(rocks) || rocks.length > 65535) throw new RangeError('rocks must be an array with at most 65535 records');
  const ids = new Set(), rng = random(seed);
  return rocks.map((record, index) => {
    if (!record || typeof record !== 'object') throw new TypeError('Each rock must be a record');
    const id = record.id ?? index;
    if (!(typeof id === 'string' && id.length > 0 || typeof id === 'number' && Number.isFinite(id))) throw new TypeError('id must be a nonempty string or finite number');
    if (ids.has(id)) throw new RangeError(`Duplicate rock id: ${id}`);
    ids.add(id);
    const position = vector(record.position, 3, 'position');
    finite(record.diameter, 'diameter');
    if (record.diameter <= 0 || record.diameter > 1e6) throw new RangeError('diameter must be positive and at most one million metres');
    const variant = record.variant ?? (1 + Math.floor(rng() * 3));
    if (!Number.isInteger(variant) || variant < 1 || variant > 3) throw new RangeError('variant must be 1, 2 or 3');
    const quaternion = vector(record.quaternion ?? [0, 0, 0, 1], 4, 'quaternion');
    const length = Math.hypot(...quaternion);
    if (length < 1e-12) throw new RangeError('quaternion must have nonzero length');
    for (let i = 0; i < 4; i++) quaternion[i] /= length;
    return {id, index, variant, diameter: record.diameter, position: Object.freeze(position), quaternion: Object.freeze(quaternion), hidden: false};
  });
}
function disposeLoaded(scene) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}
function rgbAttribute(attribute, label) {
  if (!attribute || attribute.itemSize < 3 || attribute.count !== TRIANGLES * 3) throw new Error(`Invalid ${label} attribute`);
  const array = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    const values = [attribute.getX(i), attribute.getY(i), attribute.getZ(i)];
    if (!values.every(Number.isFinite)) throw new Error(`Nonfinite ${label} data`);
    array.set(values, i * 3);
  }
  return new THREE.BufferAttribute(array, 3);
}
function selectMaterial(source) {
  const material = source.clone();
  material.name = 'foreground_variant_material';
  material.vertexColors = true; material.side = THREE.FrontSide;
  material.transparent = false; material.opacity = 1; material.depthWrite = true;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float instance_variant;
      attribute vec3 fg_position_2, fg_normal_2, fg_color_2;
      attribute vec3 fg_position_3, fg_normal_3, fg_color_3;`);
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      if (instance_variant > 1.5) objectNormal = fg_normal_3;
      else if (instance_variant > .5) objectNormal = fg_normal_2;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      if (instance_variant > 1.5) transformed = fg_position_3;
      else if (instance_variant > .5) transformed = fg_position_2;`);
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
      #ifdef USE_COLOR
        if (instance_variant > 1.5) vColor = fg_color_3;
        else if (instance_variant > .5) vColor = fg_color_2;
      #endif`);
  };
  material.customProgramCacheKey = () => 'space_foreground_variant_selection_v1';
  return material;
}

/**
 * Static placements. Diameter is the longest authored local bounding-box span,
 * before rotation; each normalized source spans 2m on its longest local axis.
 * All records are copied/validated before loading. Custom loaders must return
 * fresh GLTF resources per call; this helper owns and releases that load.
 * Shader-selected geometry is not supported by the built-in exact raycaster.
 * Use game-owned collision shapes; no shadows, lights or reflection passes.
 */
export async function createForegroundRocks({rocks = [], seed = 1, loader = new GLTFLoader(), url = DEFAULT_URL} = {}) {
  const records = prepare(rocks, seed);
  if (!loader || typeof loader.loadAsync !== 'function' && typeof loader.load !== 'function') throw new TypeError('loader must provide loadAsync or load');
  if (!(typeof url === 'string' && url.trim() || url instanceof URL)) throw new TypeError('url must be a nonempty string or URL');
  const resolvedUrl = new URL(url, import.meta.url).href;
  const object3d = new THREE.Group(); object3d.name = 'foreground_rocks';
  const handles = new Map(records.map(record => [record.id, record]));
  const active = records.slice();
  let mesh = null, geometry = null, material = null, disposed = false;
  function recomputeBounds() {
    if (!mesh) return;
    if (!mesh.count) {
      mesh.boundingBox = new THREE.Box3().makeEmpty(); mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0); mesh.visible = false;
    } else {mesh.visible = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();}
  }
  function getStats() {
    const count = disposed ? 0 : active.length, calls = count ? 1 : 0;
    const variants = [0, 0, 0]; if (!disposed) for (const record of active) variants[record.variant - 1]++;
    return {count, activeCount: count, instances: count, capacity: records.length, hiddenInstances: records.length - count, triangles: count * TRIANGLES, submittedTriangles: count * TRIANGLES, trianglesPerRock: TRIANGLES, calls, meshDrawCalls: calls, materials: !disposed && mesh ? 1 : 0, textures: 0, vertexAttributes: 14, vertexAttributeSlots: 14, variants, bounds: mesh && count ? {min: mesh.boundingBox.min.toArray(), max: mesh.boundingBox.max.toArray()} : null, disposed};
  }
  function hide(id) {
    if (disposed) return false;
    const handle = handles.get(id);
    if (!handle || handle.hidden || !mesh) return false;
    const index = handle.index, last = active.length - 1;
    if (index !== last) {
      const moved = active[last];
      mesh.instanceMatrix.array.copyWithin(index * 16, last * 16, (last + 1) * 16);
      const variants = geometry.getAttribute('instance_variant'); variants.array[index] = variants.array[last]; variants.needsUpdate = true;
      active[index] = moved; moved.index = index;
    }
    active.pop(); handle.hidden = true; handle.index = -1;
    mesh.count = active.length; mesh.instanceMatrix.needsUpdate = true; recomputeBounds();
    return true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true; object3d.removeFromParent();
    if (mesh) {mesh.removeFromParent(); mesh.dispose(); geometry.dispose(); material.dispose();}
    for (const record of active) {record.hidden = true; record.index = -1;}
    active.length = 0; handles.clear();
  }
  if (!records.length) return {object3d, mesh, handles, getStats, hide, dispose};
  let gltf;
  const expanded = [];
  try {
    gltf = typeof loader.loadAsync === 'function' ? await loader.loadAsync(resolvedUrl) : await new Promise((resolve, reject) => loader.load(resolvedUrl, resolve, undefined, reject));
    if (!gltf?.scene?.isObject3D) throw new Error('Foreground GLB must contain a scene');
    gltf.scene.updateMatrixWorld(true);
    const sources = NAMES.map(name => {
      const object = gltf.scene.getObjectByName(name);
      if (!object?.isMesh || Array.isArray(object.material) || !object.material.isMeshStandardMaterial || object.material.transparent) throw new Error(`Invalid foreground source: ${name}`);
      if (Object.values(object.material).some(value => value?.isTexture)) throw new Error('Foreground sources must not use textures');
      const clone = object.geometry.clone().applyMatrix4(object.matrixWorld);
      const result = clone.index ? clone.toNonIndexed() : clone;
      if (result !== clone) clone.dispose();
      expanded.push(result);
      if (result.getAttribute('position')?.count !== TRIANGLES * 3) throw new Error(`${name} must contain exactly ${TRIANGLES} triangles`);
      return {object, geometry: result};
    });
    // UVs are topology IDs, not an image map. Validate matching expanded corner
    // order before selecting alternatives, then omit them from GPU attributes.
    const identity = sources.map(({geometry}, variant) => {
      const uv = geometry.getAttribute('uv');
      if (!uv || uv.count !== TRIANGLES * 3) throw new Error(`Variant ${variant + 1} is missing topology IDs`);
      const ids = new Uint16Array(uv.count);
      for (let i = 0; i < uv.count; i++) {
        const sourceId = uv.getX(i) * (SOURCE_VERTICES - 1), faceId = (1 - uv.getY(i)) * (TRIANGLES - 1);
        const vertexId = Math.round(sourceId);
        if (!Number.isFinite(sourceId) || Math.abs(sourceId - vertexId) > .001 || vertexId < 0 || vertexId >= SOURCE_VERTICES || Math.abs(faceId - Math.floor(i / 3)) > .001) throw new Error(`Variant ${variant + 1} has invalid topology order`);
        ids[i] = vertexId;
      }
      return ids;
    });
    for (let variant = 1; variant < 3; variant++) for (let i = 0; i < identity[0].length; i++) if (identity[0][i] !== identity[variant][i]) throw new Error('Foreground variants must have identical expanded topology');
    geometry = new THREE.BufferGeometry(); geometry.name = 'foreground_variant_geometry';
    const union = new THREE.Box3().makeEmpty();
    for (let variant = 0; variant < 3; variant++) {
      const source = sources[variant].geometry;
      for (const kind of ['position', 'normal', 'color']) {
        const name = variant === 0 ? kind : `fg_${kind}_${variant + 1}`;
        geometry.setAttribute(name, rgbAttribute(source.getAttribute(kind), `${NAMES[variant]} ${kind}`));
      }
      source.computeBoundingBox(); union.union(source.boundingBox);
    }
    geometry.boundingBox = union;
    geometry.boundingSphere = union.getBoundingSphere(new THREE.Sphere());
    geometry.setAttribute('instance_variant', new THREE.InstancedBufferAttribute(new Float32Array(records.length), 1));
    material = selectMaterial(sources[0].object.material);
    mesh = new THREE.InstancedMesh(geometry, material, records.length); mesh.name = 'foreground_stone_batch';
    mesh.castShadow = mesh.receiveShadow = false; mesh.frustumCulled = true;
    const transform = new THREE.Object3D(), variantAttribute = geometry.getAttribute('instance_variant');
    for (const record of records) {
      transform.position.fromArray(record.position); transform.quaternion.fromArray(record.quaternion);
      transform.scale.setScalar(record.diameter / 2); transform.updateMatrix(); mesh.setMatrixAt(record.index, transform.matrix);
      variantAttribute.array[record.index] = record.variant - 1;
    }
    mesh.instanceMatrix.needsUpdate = true; variantAttribute.needsUpdate = true;
    recomputeBounds(); object3d.add(mesh);
  } catch (error) {
    mesh?.dispose(); geometry?.dispose(); material?.dispose();
    throw error;
  } finally {
    for (const source of expanded) source.dispose();
    disposeLoaded(gltf?.scene);
  }
  return {object3d, mesh, handles, getStats, hide, dispose};
}
