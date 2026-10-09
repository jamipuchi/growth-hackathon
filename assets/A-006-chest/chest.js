import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();
function load(name) {
  if (!cache.has(name)) cache.set(name, loader.loadAsync(new URL(name, import.meta.url).href).catch(error => { cache.delete(name); throw error; }));
  return cache.get(name);
}

/** Metres, +Y up, -Z front; dt is in seconds. Source geometry/maps are cached. */
export async function createChest({ state = 'closed' } = {}) {
  if (!['closed', 'open', 'buried'].includes(state)) throw new Error(`Unknown chest state: ${state}`);
  const [source, buriedSource] = await Promise.all([load('chest.glb'), load('buried.glb')]);
  const chest = source.scene.clone(true), buried = buriedSource.scene.clone(true);
  const object3d = new THREE.Group(); object3d.name = 'chest_encounter'; object3d.add(chest, buried);
  const materialCopies = new Map();
  object3d.traverse(node => {
    if (!node.isMesh) return;
    if (!materialCopies.has(node.material)) materialCopies.set(node.material, node.material.clone());
    node.material = materialCopies.get(node.material);
  });
  const lid = chest.getObjectByName('chest_lid'), rest = lid.quaternion.clone();
  const mixer = new THREE.AnimationMixer(chest), clip = source.animations.find(c => c.name === 'open');
  const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
  let current = 'closed', disposed = false;
  const finished = event => { if (event.action === action) current = 'open'; };
  mixer.addEventListener('finished', finished);
  function setState(value) {
    if (!['closed', 'open', 'buried'].includes(value)) throw new Error(`Unknown chest state: ${value}`);
    action.stop(); lid.quaternion.copy(rest);
    chest.visible = value !== 'buried'; buried.visible = value === 'buried';
    current = value;
    if (value === 'open') { action.reset().play(); mixer.update(clip.duration); }
    object3d.updateMatrixWorld(true);
  }
  setState(state);
  return {
    object3d, chest, buried, mixer, clips: source.animations,
    sockets: { treasure: chest.getObjectByName('socket_treasure'), lid: chest.getObjectByName('socket_lid'), glint: buried.getObjectByName('socket_glint') },
    get state() { return current; },
    setState,
    open({ restart = false } = {}) {
      if (!restart && (current === 'open' || current === 'opening')) return action;
      setState('closed'); current = 'opening'; action.reset().play(); return action;
    },
    update(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw new Error('Chest dt must be finite, nonnegative seconds');
      if (!disposed) mixer.update(dt);
    },
    setGlow(strength = 2.4) {
      if (!Number.isFinite(strength) || strength < 0) throw new Error('Glow must be finite and nonnegative');
      for (const material of materialCopies.values()) material.emissiveIntensity = strength;
    },
    dispose() {
      if (disposed) return; disposed = true;
      mixer.removeEventListener('finished', finished); mixer.stopAllAction(); mixer.uncacheRoot(chest);
      for (const material of materialCopies.values()) material.dispose();
      // Cached geometry and textures are shared with other instances; retain them.
    },
  };
}

/** One optional draw call, 2 triangles, 512px alpha map. Place over locally flat ground. */
export async function createDigHole({ width = 2.7, depth = 2.15, opacity = 1 } = {}) {
  if (![width, depth].every(v => Number.isFinite(v) && v > 0) || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('Invalid dig-hole dimensions or opacity');
  const map = await new THREE.TextureLoader().loadAsync(new URL('dig_hole.png', import.meta.url).href);
  map.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(width, depth); geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ map, transparent: true, opacity, roughness: 1, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const object3d = new THREE.Mesh(geometry, material); object3d.name = 'dig_hole'; object3d.position.y = .012;
  return { object3d, dispose() { geometry.dispose(); material.dispose(); map.dispose(); } };
}
