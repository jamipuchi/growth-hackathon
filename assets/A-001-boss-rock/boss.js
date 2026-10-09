import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const ARMOUR_STATES = Object.freeze(['armour_intact', 'armour_cracked', 'armour_broken']);

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
    loader.loadAsync(new URL('./decoy.glb', import.meta.url).href),
  ]);
  const boss = setArmourState(bossGltf.scene);
  const decoy = setArmourState(decoyGltf.scene);
  const decoys = Array.from({ length: decoyCount }, () => setArmourState(decoy.clone(true)));
  return { boss, decoys, setArmourState };
}
