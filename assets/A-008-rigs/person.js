import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const LOOPS = new Set('idle walk run sprint fall crouch aim block dig climb swim glide sit push kneel look read celebrate wave'.split(' '));
const LIMBS = new Set(['upper_arm_l','fore_arm_l','upper_arm_r','fore_arm_r','thigh_l','shin_l','thigh_r','shin_r']);
let sourcePromise;
export function loadPersonRig() {
  return sourcePromise ??= new GLTFLoader().loadAsync(new URL('person.glb', import.meta.url).href).catch(error => { sourcePromise = null; throw error; });
}

function bones(root) { const result = new Map(); root.traverse(o => { if (o.isBone) result.set(o.name, o); }); return result; }

/** Call with the target in its bind/rest pose. Preserves target limb lengths. */
export async function retargetPersonClips(target) {
  const source = await loadPersonRig();
  source.scene.updateMatrixWorld(true); target.updateMatrixWorld(true);
  const from = bones(source.scene), to = bones(target), conversions = new Map();
  const sourceRootInverse = source.scene.getWorldQuaternion(new THREE.Quaternion()).invert();
  const targetRootInverse = target.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (const [name, bone] of from) {
    const other = to.get(name);
    if (!other) throw new Error(`Target person is missing bone ${name}`);
    if (bone.parent.isBone && other.parent.name !== bone.parent.name) throw new Error(`Unexpected parent for ${name}`);
    const sourceWorld = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(sourceRootInverse);
    const targetWorld = other.getWorldQuaternion(new THREE.Quaternion()).premultiply(targetRootInverse);
    conversions.set(name, { sourceRestInverse: bone.quaternion.clone().invert(), targetRest: other.quaternion.clone(), basis: targetWorld.invert().multiply(sourceWorld) });
  }
  return source.animations.map(clip => {
    const tracks = clip.tracks.map(track => {
      const name = track.name.slice(0, -'.quaternion'.length), c = conversions.get(name);
      if (!c || !track.name.endsWith('.quaternion')) throw new Error(`Unexpected person track ${track.name}`);
      const values = new Float32Array(track.values.length), q = new THREE.Quaternion(), inverse = c.basis.clone().invert();
      for (let i = 0; i < values.length; i += 4) {
        q.fromArray(track.values, i).premultiply(c.sourceRestInverse);
        q.premultiply(c.basis).multiply(inverse).premultiply(c.targetRest).normalize().toArray(values, i);
      }
      return new THREE.QuaternionKeyframeTrack(track.name, track.times.slice(), values);
    });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  });
}

/** Use one animation mixer per target. Stop an existing animator before attaching. */
export async function createPersonAnimator(target, { animation = 'idle' } = {}) {
  const clips = await retargetPersonClips(target), mixer = new THREE.AnimationMixer(target);
  const byName = new Map(clips.map(c => [c.name, c])); let current = null, disposed = false;
  function play(name, { fade = .12, loop = LOOPS.has(name), restart = false } = {}) {
    const clip = byName.get(name); if (!clip) throw new Error(`Unknown person clip: ${name}`);
    if (!Number.isFinite(fade) || fade < 0) throw new Error('Fade must be nonnegative seconds');
    const next = mixer.clipAction(clip);
    if (!restart && current === next && next.isRunning()) return next;
    const previous = current; next.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1); next.clampWhenFinished = !loop; next.play();
    if (previous && previous !== next) { if (fade) { previous.fadeOut(fade); next.fadeIn(fade); } else previous.stop(); }
    current = next; return next;
  }
  if (animation !== null) play(animation, { fade: 0 });
  return { clips, mixer, play, get action() { return current; },
    update(dt) { if (!Number.isFinite(dt) || dt < 0) throw new Error('dt must be finite nonnegative seconds'); if (!disposed) mixer.update(dt); },
    dispose() { if (disposed) return; disposed = true; mixer.stopAllAction(); mixer.uncacheRoot(target); },
  };
}

// Re-author the neutral bind mesh and skeleton together for proportion review.
// This is setup-time work, never an animation-time bone scale track.
function resizeLimbs(root, factors) {
  root.updateMatrixWorld(true); const all = bones(root), oldWorld = new Map();
  for (const [name, bone] of all) oldWorld.set(name, bone.matrixWorld.clone());
  for (const bone of all.values()) if (bone.parent.isBone && LIMBS.has(bone.parent.name)) bone.position.multiplyScalar(factors[bone.parent.name]);
  root.updateMatrixWorld(true);
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    mesh.geometry = mesh.geometry.clone();
    const worldInverse = mesh.matrixWorld.clone().invert();
    const deform = mesh.skeleton.bones.map(bone => worldInverse.clone().multiply(bone.matrixWorld).multiply(new THREE.Matrix4().makeScale(1, factors[bone.name] ?? 1, 1)).multiply(oldWorld.get(bone.name).clone().invert()).multiply(mesh.matrixWorld));
    const normalTransforms = deform.map(m => new THREE.Matrix3().getNormalMatrix(m));
    const { position, normal, skinIndex, skinWeight } = mesh.geometry.attributes;
    const point = new THREE.Vector3(), direction = new THREE.Vector3(), sum = new THREE.Vector3(), normalSum = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      sum.set(0,0,0); normalSum.set(0,0,0);
      for (let k = 0; k < 4; k++) {
        const weight = skinWeight.getComponent(i,k); if (!weight) continue;
        const index = skinIndex.getComponent(i,k);
        sum.addScaledVector(point.fromBufferAttribute(position,i).applyMatrix4(deform[index]),weight);
        normalSum.addScaledVector(direction.fromBufferAttribute(normal,i).applyMatrix3(normalTransforms[index]).normalize(),weight);
      }
      position.setXYZ(i,sum.x,sum.y,sum.z);normalSum.normalize();normal.setXYZ(i,normalSum.x,normalSum.y,normalSum.z);
    }
    position.needsUpdate = normal.needsUpdate = true;
    mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
    mesh.skeleton.calculateInverses(); mesh.bind(mesh.skeleton,mesh.matrixWorld);
  });
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root); root.position.y -= box.min.y;root.updateMatrixWorld(true);
}

export async function createPerson({ animation = 'idle', limbScale = 1, limbScales = {} } = {}) {
  if (!Number.isFinite(limbScale) || limbScale < .7 || limbScale > 1.4) throw new Error('limbScale must be within 0.7–1.4');
  for(const [name,value] of Object.entries(limbScales)) if(!LIMBS.has(name)||!Number.isFinite(value)||value<.7||value>1.4) throw new Error(`Invalid limb proportion: ${name}`);
  const factors=Object.fromEntries([...LIMBS].map(name=>[name,limbScales[name]??limbScale]));
  const source = await loadPersonRig(), scene = clone(source.scene), object3d = new THREE.Group();object3d.name='person_instance';object3d.add(scene);
  const materials = new Map(), ownedGeometry = [];
  scene.traverse(o => { if (o.isMesh) { if (!materials.has(o.material)) materials.set(o.material,o.material.clone());o.material=materials.get(o.material);o.frustumCulled=false;if(o.isSkinnedMesh)o.skeleton.boneInverses=o.skeleton.boneInverses.map(m=>m.clone()); } });
  if (Object.values(factors).some(v=>v!==1)) { resizeLimbs(scene,factors);scene.traverse(o=>{if(o.isMesh)ownedGeometry.push(o.geometry);}); }
  const animator = await createPersonAnimator(object3d,{animation});
  const sockets = {};object3d.traverse(o=>{if(o.name.startsWith('socket_'))sockets[o.name.slice(7)]=o;});
  let disposed=false;
  return { object3d, bones: bones(object3d), sockets, limbScale, limbScales:factors, ...animator, get action() { return animator.action; },
    dispose() { if(disposed)return;disposed=true;animator.dispose();materials.forEach(m=>m.dispose());ownedGeometry.forEach(g=>g.dispose()); },
  };
}
