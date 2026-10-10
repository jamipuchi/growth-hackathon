import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const ARMOUR_STATES = Object.freeze(['armour_intact', 'armour_cracked', 'armour_broken']);
const pulseStates = new WeakMap();
const pulseMaterialSources = new WeakMap();

/** Pulse only owned material clones; independent bosses never share pulse state. */
export function updateBoss(object3d, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite nonnegative seconds');
  const core = object3d.getObjectByName('core');
  if (!core) return;
  let state = pulseStates.get(object3d);
  if (!state) {
    const restScale = core.userData.pulseRestScale ?? core.scale.toArray();
    core.userData.pulseRestScale = [...restScale];
    const materials = [];
    core.traverse(node => {
      if (!node.isMesh || !node.material.emissiveIntensity || node.material.emissive?.getHex() === 0) return;
      const source = pulseMaterialSources.get(node.material) ?? node.material;
      const owned = source.clone();
      pulseMaterialSources.set(owned, source);
      const intensity = source.userData.bossBaseEmission ?? source.emissiveIntensity;
      owned.userData.bossBaseEmission = intensity;
      node.material = owned;
      materials.push({ node, source, owned, intensity });
    });
    state = { time: 0, core, restScale: [...restScale], materials };
    pulseStates.set(object3d, state);
  }
  state.time += dt;
  const pulse = Math.sin(state.time * Math.PI * 2 * .8);
  state.core.scale.fromArray(state.restScale).multiplyScalar(1 + pulse * .035);
  for (const { owned, intensity } of state.materials) owned.emissiveIntensity = intensity * (.85 + pulse * .25);
}

/** Release only pulse clones and restore shared source materials/rest scale. */
export function disposeBossPulse(object3d) {
  const state = pulseStates.get(object3d);
  if (!state) return;
  for (const { node, source, owned } of state.materials) {
    if (node.material === owned) node.material = source;
    owned.dispose();
  }
  state.core.scale.fromArray(state.restScale);
  pulseStates.delete(object3d);
}

/** glTF has no standard visibility property: apply state before adding to scene. */
export function setArmourState(object3d, state = 'armour_intact') {
  if (!ARMOUR_STATES.includes(state)) throw new RangeError(`Unknown armour state: ${state}`);
  for (const name of ARMOUR_STATES) {
    const node = object3d.getObjectByName(name);
    if (!node) throw new Error(`Missing boss shell node: ${name}`);
    node.visible = name === state;
  }
  const core = object3d.getObjectByName('core');
  if (core) core.visible = state === 'armour_broken';
  object3d.userData.armourState = state;
  return object3d;
}

/** Four decoys share geometry/materials but have independent state transforms. */
export async function createBossEncounter({ loader = new GLTFLoader(), decoyCount = 4 } = {}) {
  if (!Number.isInteger(decoyCount) || decoyCount < 0) throw new RangeError('decoyCount must be a nonnegative integer');
  const [bossGltf, decoyGltf] = await Promise.all([
    loader.loadAsync(new URL('./boss.glb', import.meta.url).href),
    decoyCount ? loader.loadAsync(new URL('./decoy.glb', import.meta.url).href) : null,
  ]);
  const boss = setArmourState(bossGltf.scene);
  const decoy = decoyGltf ? setArmourState(decoyGltf.scene) : null;
  const decoys = Array.from({ length: decoyCount }, () => setArmourState(decoy.clone(true)));
  let disposed = false;
  return { boss, decoys, setArmourState, update(dt) { if (!disposed) updateBoss(boss, dt); },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeBossPulse(boss);
      const geometries = new Set(), materials = new Set();
      for (const root of [boss, ...decoys, ...(decoy ? [decoy] : [])]) root.traverse(node => {
        if (node.geometry) geometries.add(node.geometry);
        if (node.material) (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => materials.add(m));
      });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    },
  };
}
