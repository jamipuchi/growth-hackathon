/** Original CC0 Space Party car helper. three.js r160; no game/physics side effects. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const URL_DEFAULT = new URL('./car.glb', import.meta.url).href;
const KEYS = ['fl', 'fr', 'bl', 'br'];
const TAU = Math.PI * 2;
const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0);

function number(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite and between ${min} and ${max}.`);
  }
  return value;
}
function tint(value) {
  if (value === undefined) return null;
  if (value?.isColor && [value.r, value.g, value.b].every(n => Number.isFinite(n) && n >= 0 && n <= 16)) return value.clone();
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff) return new THREE.Color(value);
  if (typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return new THREE.Color(value);
  throw new TypeError('color must be a THREE.Color, a 24-bit integer or a #RGB/#RRGGBB string.');
}
function collect(scene) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  return { geometries, materials, textures };
}
function release(resources) {
  for (const geometry of resources.geometries) geometry.dispose();
  for (const material of resources.materials) material.dispose();
  for (const texture of resources.textures) texture.dispose();
}
function triangles(geometry) { return (geometry.index?.count ?? geometry.attributes.position.count) / 3; }

function wheelGeometry(merged, carRoot, pivots) {
  const geometry = merged.geometry;
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const color = geometry.getAttribute('color'), uv = geometry.getAttribute('uv');
  if (!position || !normal || !color || !uv || position.itemSize !== 3 || normal.itemSize !== 3 || color.itemSize < 3) throw new Error('Car wheels require position, normal, colour and wheel-ID UV attributes.');
  if ([normal, color, uv].some(a => a.count !== position.count)) throw new Error('Car wheel attribute lengths disagree.');
  const carInverse = carRoot.matrixWorld.clone().invert();
  const sourceToCar = new THREE.Matrix4().multiplyMatrices(carInverse, merged.matrixWorld);
  const transforms = pivots.map(pivot => {
    const pivotToCar = new THREE.Matrix4().multiplyMatrices(carInverse, pivot.matrixWorld);
    return new THREE.Matrix4().multiplyMatrices(pivotToCar.invert(), sourceToCar);
  });
  const normalTransforms = transforms.map(matrix => new THREE.Matrix3().getNormalMatrix(matrix));
  const groups = Array.from({ length: 4 }, () => ({ position: [], normal: [], color: [] }));
  const count = geometry.index?.count ?? position.count;
  if (count % 3) throw new Error('Car wheel triangle index count is invalid.');
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let corner = 0; corner < count; corner += 3) {
    let triangleId = -1;
    for (let j = 0; j < 3; j++) {
      const index = geometry.index ? geometry.index.getX(corner + j) : corner + j;
      const rawId = uv.getX(index) * 4 - 0.5, id = Math.round(rawId);
      if (id < 0 || id > 3 || Math.abs(rawId - id) > 1e-5 || j && id !== triangleId) throw new Error('Each wheel triangle must carry one valid wheel ID.');
      triangleId = id;
      p.fromBufferAttribute(position, index).applyMatrix4(transforms[id]);
      n.fromBufferAttribute(normal, index).applyMatrix3(normalTransforms[id]).normalize();
      const rgb = [color.getX(index), color.getY(index), color.getZ(index)];
      if (![p.x, p.y, p.z, n.x, n.y, n.z, ...rgb].every(Number.isFinite) || n.lengthSq() < 0.5) throw new Error('Nonfinite or invalid car wheel geometry.');
      groups[id].position.push(p.x, p.y, p.z); groups[id].normal.push(n.x, n.y, n.z); groups[id].color.push(...rgb);
    }
  }
  if (!groups[0].position.length) throw new Error('Car has no wheel prototype.');
  // Validate that choosing one prototype does not alter the other three wheels.
  for (let i = 1; i < 4; i++) for (const name of ['position', 'normal', 'color']) {
    const a = groups[0][name], b = groups[i][name];
    // Blender encodes split normals relative to each translated vertex's local
    // normal basis; round-trip component differences can approach 6e-5.
    const tolerance = name === 'normal' ? 1e-4 : 1e-5;
    if (a.length !== b.length || a.some((value, k) => Math.abs(value - b[k]) > tolerance)) throw new Error(`Wheel ${KEYS[i]} does not match the shared ${name} prototype.`);
  }
  const result = new THREE.BufferGeometry(); result.name = 'car_wheel_prototype';
  for (const name of ['position', 'normal', 'color']) result.setAttribute(name, new THREE.Float32BufferAttribute(groups[0][name], 3));
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

/**
 * Each call owns an independent load and its GPU resources. A custom loader must
 * return a fresh, exclusively owned GLTF scene. No shared default-entity cache is
 * changed. Zero textures; three mesh calls with independently posed wheel pivots.
 */
export async function createDefaultCar({ color, loader = new GLTFLoader(), url = URL_DEFAULT } = {}) {
  const bodyTint = tint(color);
  if (!loader || typeof loader.loadAsync !== 'function') throw new TypeError('loader must provide loadAsync(url).');
  if (!(typeof url === 'string' && url.trim() || url instanceof URL)) throw new TypeError('url must be a nonempty string or URL.');
  const resolvedUrl = new URL(url, import.meta.url).href;
  let resources = { geometries: new Set(), materials: new Set(), textures: new Set() }, batch = null, object3d = null;
  try {
    const gltf = await loader.loadAsync(resolvedUrl);
    if (!gltf?.scene?.isObject3D) throw new Error('Car GLB must contain a scene.');
    object3d = gltf.scene; resources = collect(object3d);
    const carRoot = object3d.getObjectByName('default_car');
    if (!carRoot) throw new Error('Car root default_car is missing.');
    const body = carRoot.getObjectByName('car_body'), lights = carRoot.getObjectByName('car_lights'), merged = carRoot.getObjectByName('car_wheels');
    for (const mesh of [body, lights, merged]) {
      if (!mesh?.isMesh || Array.isArray(mesh.material) || !mesh.material.isMeshStandardMaterial || mesh.material.side !== THREE.FrontSide) throw new Error('Car requires three single-sided PBR mesh primitives.');
      if (mesh.material.transparent || Object.values(mesh.material).some(value => value?.isTexture)) throw new Error('Car materials must be opaque and texture-free.');
    }
    const pivots = KEYS.map(key => {
      const pivot = carRoot.getObjectByName(`wheel_${key}`);
      if (!pivot || pivot.isMesh) throw new Error(`Missing empty wheel_${key} pivot.`);
      return pivot;
    });
    const sockets = Object.fromEntries(['seat', 'roof', 'front', 'back'].map(name => {
      const node = carRoot.getObjectByName(`socket_${name}`);
      if (!node || node.isMesh) throw new Error(`Missing socket_${name}.`);
      return [name, node];
    }));
    const radius = number(carRoot.userData.wheel_radius, 'wheel radius', 0.1, 2);
    object3d.updateWorldMatrix(true, true);
    const prototype = wheelGeometry(merged, carRoot, pivots); resources.geometries.add(prototype);
    const wheelTriangles = triangles(prototype), totalTriangles = triangles(body.geometry) + triangles(lights.geometry) + 4 * wheelTriangles;
    if (!Number.isInteger(totalTriangles) || totalTriangles > 5000) throw new Error('Car exceeds its 5,000 triangle contract.');
    batch = new THREE.InstancedMesh(prototype, merged.material, 4); batch.name = 'car_wheel_instances';
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    batch.castShadow = batch.receiveShadow = false; batch.frustumCulled = true;
    carRoot.add(batch); merged.removeFromParent();
    resources.geometries.delete(merged.geometry); merged.geometry.dispose();
    if (bodyTint) body.material.color.copy(bodyTint);
    object3d.traverse(node => { if (node.isMesh) node.castShadow = node.receiveShadow = false; });
    const wheels = Object.freeze(Object.fromEntries(KEYS.map((key, i) => [key, pivots[i]])));
    const records = pivots.map(pivot => ({ pivot, rest: pivot.quaternion.clone(), spin: 0, steer: 0 }));
    const inverse = new THREE.Matrix4(), matrices = pivots.map(() => new THREE.Matrix4());
    const spinRotation = new THREE.Quaternion(), steerRotation = new THREE.Quaternion();
    let speed = 0, steer = 0, disposed = false;

    function syncWheels() {
      if (disposed) return false;
      carRoot.updateWorldMatrix(true, true); inverse.copy(carRoot.matrixWorld).invert();
      for (let i = 0; i < 4; i++) {
        matrices[i].multiplyMatrices(inverse, pivots[i].matrixWorld);
        if (!matrices[i].elements.every(Number.isFinite)) throw new Error('Wheel transforms must stay finite.');
      }
      for (let i = 0; i < 4; i++) batch.setMatrixAt(i, matrices[i]);
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingBox(); batch.computeBoundingSphere();
      return true;
    }
    function pose() {
      for (const record of records) {
        steerRotation.setFromAxisAngle(Y_AXIS, record.steer);
        spinRotation.setFromAxisAngle(X_AXIS, record.spin);
        record.pivot.quaternion.copy(record.rest).multiply(steerRotation).multiply(spinRotation);
      }
      return syncWheels();
    }
    function setMotion(options = {}) {
      if (disposed) return false;
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Motion must be an object.');
      const nextSpeed = number(options.speed ?? speed, 'speed', -100, 100);
      const nextSteer = number(options.steer ?? steer, 'steer', -0.65, 0.65);
      speed = nextSpeed; steer = nextSteer;
      if (options.steer !== undefined) { records[0].steer = steer; records[1].steer = steer; }
      return pose();
    }
    function setWheel(name, options = {}) {
      if (disposed) return false;
      const key = typeof name === 'string' ? name.replace(/^wheel_/, '') : '';
      const index = KEYS.indexOf(key);
      if (index < 0) throw new RangeError('Wheel name must be fl, fr, bl or br (optional wheel_ prefix).');
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Wheel pose must be an object.');
      const record = records[index];
      const nextSpin = number(options.spin ?? record.spin, 'spin', -1e9, 1e9) % TAU;
      const nextSteer = number(options.steer ?? record.steer, 'steer', -0.65, 0.65);
      if (index > 1 && nextSteer !== 0) throw new RangeError('Only front wheels steer.');
      record.spin = nextSpin; record.steer = nextSteer;
      return pose();
    }
    function update(dt) {
      if (disposed) return false;
      number(dt, 'dt', 0, 3600);
      if (!dt || !speed) return false;
      const delta = speed * dt / radius;
      for (const record of records) record.spin = (record.spin - delta) % TAU;
      return pose();
    }
    function getStats() {
      return { triangles: disposed ? 0 : totalTriangles, calls: disposed ? 0 : 3,
        meshDrawCalls: disposed ? 0 : 3, trianglesPerWheel: wheelTriangles, wheels: disposed ? 0 : 4,
        materials: disposed ? 0 : 3, textures: 0, rawGlbDrawCalls: 3, wheelRadius: radius,
        speed, steer, wheelPoses: Object.fromEntries(KEYS.map((key, i) => [key, { spin: records[i].spin, steer: records[i].steer }])), disposed };
    }
    function dispose() {
      if (disposed) return;
      disposed = true; object3d.removeFromParent(); batch.removeFromParent(); batch.dispose();
      release(resources);
    }
    syncWheels();
    return { object3d, wheels, sockets: Object.freeze(sockets), wheelMesh: batch,
      setMotion, setWheel, syncWheels, update, getStats, dispose };
  } catch (error) {
    object3d?.removeFromParent(); batch?.dispose(); release(resources);
    throw error;
  }
}
