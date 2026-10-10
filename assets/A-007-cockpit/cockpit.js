import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Authored camera: metres, Y up, eye at (0,0,0), looking down -Z. */
export const COCKPIT_CAMERA = Object.freeze({ fov: 70, aspect: 16 / 9 });
const DEFAULT_URL = new URL('./cockpit.glb', import.meta.url).href;

function cameraScale(camera) {
  if (!camera?.isPerspectiveCamera) throw new TypeError('Cockpit requires a PerspectiveCamera.');
  if (![camera.fov, camera.aspect, camera.zoom].every(Number.isFinite) ||
      camera.fov <= 0 || camera.fov >= 179 || camera.aspect <= 0 || camera.zoom <= 0)
    throw new RangeError('Camera FOV, aspect and zoom must be finite and positive (FOV < 179).');
  if (camera.view?.enabled) throw new RangeError('Cockpit fitting does not support camera view offsets.');
  if (camera.filmOffset) throw new RangeError('Cockpit fitting does not support camera film offsets.');
  const y = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) /
    (camera.zoom * Math.tan(THREE.MathUtils.degToRad(COCKPIT_CAMERA.fov / 2)));
  return [y * camera.aspect / COCKPIT_CAMERA.aspect, y];
}

/**
 * Loads an independent, camera-mounted cockpit. Add object3d to the active camera,
 * then add that camera to the scene. Call fitToCamera on resize/FOV/zoom changes.
 * Does not install a camera, lights, labels, renderer settings or frame callbacks.
 */
export async function createCockpit({ camera, loader = new GLTFLoader(), url = DEFAULT_URL } = {}) {
  if (camera) cameraScale(camera);
  const gltf = await loader.loadAsync(url);
  const object3d = gltf.scene;
  object3d.name = 'cockpit';
  const geometries = new Set(), materials = new Set(), textures = new Set(), meshes = [];
  object3d.traverse(node => {
    if (!node.isMesh) return;
    meshes.push(node);
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    node.castShadow = node.receiveShadow = false;
    // The frame is always in view when fitted; it must not disappear at screen edges.
    node.frustumCulled = false;
  });
  const sockets = Object.fromEntries([1, 2, 3].map(i => {
    const name = `socket_gauge_${i}`;
    return [name, object3d.getObjectByName(name)];
  }));
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    object3d.removeFromParent();
    // Only resources loaded here: attached, caller-owned gauge meshes are untouched.
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }
  if (Object.values(sockets).some(socket => !socket)) {
    dispose();
    throw new Error('Cockpit GLB is missing a required gauge socket.');
  }
  const assertLive = () => { if (disposed) throw new Error('Cockpit has been disposed.'); };
  function fitToCamera(activeCamera) {
    assertLive();
    const [x, y] = cameraScale(activeCamera);
    object3d.scale.set(x, y, 1);
    object3d.updateMatrixWorld(true);
    return api;
  }
  function getStats() {
    let triangles = 0, calls = 0;
    for (const mesh of meshes) {
      const geometry = mesh.geometry;
      triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
      calls += Array.isArray(mesh.material) ? geometry.groups.length : 1;
    }
    return { meshes: meshes.length, triangles, calls, materials: materials.size,
      textures: textures.size, animations: gltf.animations.length, disposed };
  }
  const api = { object3d, sockets, meshes, materials: [...materials], fitToCamera,
    getStats, dispose };
  if (camera) fitToCamera(camera);
  return api;
}
