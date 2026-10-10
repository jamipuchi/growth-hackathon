import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export const CREATURE_TYPES = Object.freeze(['quadruped', 'flyer', 'swimmer', 'crawler', 'serpent']);
const cache = new Map();
const defaults = { quadruped:'idle', flyer:'flap', swimmer:'swim', crawler:'idle', serpent:'slither' };
function checkType(type) { if (!CREATURE_TYPES.includes(type)) throw new Error(`Unknown creature type: ${type}`); }
function boneMap(root) { const result=new Map(); root.traverse(o=>{if(o.isBone){if(result.has(o.name))throw new Error(`Duplicate bone: ${o.name}`);result.set(o.name,o);}});return result; }

export function loadCreatureRig(type) {
  checkType(type);
  if (!cache.has(type)) {
    const promise=Promise.all([
      new GLTFLoader().loadAsync(new URL(`${type}.glb`,import.meta.url).href),
      fetch(new URL(`${type}-clips.json`,import.meta.url)).then(r=>{if(!r.ok)throw new Error(`${type} metadata: ${r.status}`);return r.json();}),
    ]).then(([gltf,metadata])=>({...gltf,metadata})).catch(e=>{if(cache.get(type)===promise)cache.delete(type);throw e;});
    cache.set(type,promise);
  }
  return cache.get(type);
}

/** Target must be in its bind/rest pose; only one mixer may drive its bones. */
export async function retargetCreatureClips(type,target) {
  const source=await loadCreatureRig(type);source.scene.updateMatrixWorld(true);target.updateMatrixWorld(true);
  const from=boneMap(source.scene),to=boneMap(target),conversions=new Map();
  const sourceRootInverse=source.scene.getWorldQuaternion(new THREE.Quaternion()).invert();
  const targetRootInverse=target.getWorldQuaternion(new THREE.Quaternion()).invert();
  for(const [name,bone] of from){
    const other=to.get(name);if(!other)throw new Error(`Target ${type} is missing bone ${name}`);
    if(bone.parent.isBone&&(!other.parent.isBone||other.parent.name!==bone.parent.name))throw new Error(`Unexpected parent for ${name}`);
    const sourceWorld=bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(sourceRootInverse);
    const targetWorld=other.getWorldQuaternion(new THREE.Quaternion()).premultiply(targetRootInverse);
    const basis=targetWorld.invert().multiply(sourceWorld);
    conversions.set(name,{sourceRestInverse:bone.quaternion.clone().invert(),targetRest:other.quaternion.clone(),basis,inverse:basis.clone().invert()});
  }
  return source.animations.map(clip=>new THREE.AnimationClip(clip.name,clip.duration,clip.tracks.map(track=>{
    if(!track.name.endsWith('.quaternion'))throw new Error(`Unsupported creature track: ${track.name}`);
    const name=track.name.slice(0,-11),c=conversions.get(name);if(!c)throw new Error(`Unknown track bone: ${name}`);
    const values=new Float32Array(track.values.length),q=new THREE.Quaternion();
    for(let i=0;i<values.length;i+=4){q.fromArray(track.values,i).premultiply(c.sourceRestInverse).premultiply(c.basis).multiply(c.inverse).premultiply(c.targetRest).normalize().toArray(values,i);}
    return new THREE.QuaternionKeyframeTrack(track.name,track.times.slice(),values);
  })));
}

export async function createCreatureAnimator(type,target,{animation=defaults[type]}={}){
  checkType(type);const [source,clips]=await Promise.all([loadCreatureRig(type),retargetCreatureClips(type,target)]);
  const mixer=new THREE.AnimationMixer(target),byName=new Map(clips.map(c=>[c.name,c]));let current=null,disposed=false;
  function play(name,{fade=.12,loop=source.metadata.clips[name]?.loop??false,restart=false}={}){
    if(disposed)throw new Error('Creature animator is disposed');
    if(!Number.isFinite(fade)||fade<0)throw new Error('Fade must be finite nonnegative seconds');
    const clip=byName.get(name);if(!clip)throw new Error(`Unknown ${type} clip: ${name}`);
    const next=mixer.clipAction(clip);if(!restart&&current===next&&next.isRunning())return next;
    const previous=current;next.reset().setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);next.clampWhenFinished=!loop;next.play();
    if(previous&&previous!==next){if(fade){previous.fadeOut(fade);next.fadeIn(fade);}else previous.stop();}
    current=next;return next;
  }
  if(animation!==null)play(animation,{fade:0});
  return {type,clips,metadata:source.metadata,mixer,play,get action(){return current;},
    update(dt){if(!Number.isFinite(dt)||dt<0)throw new Error('dt must be finite nonnegative seconds');if(!disposed)mixer.update(dt);},
    dispose(){if(disposed)return;disposed=true;mixer.stopAllAction();mixer.uncacheRoot(target);},
  };
}

// Setup-time rebind, with a new mesh and inverse-bind matrices per instance.
// Bone local Y is the authored segment-length axis. Child origins move with it.
function resizeSegments(root,factors){
  root.updateMatrixWorld(true);const all=boneMap(root),oldWorld=new Map();
  for(const [name,bone]of all)oldWorld.set(name,bone.matrixWorld.clone());
  for(const bone of all.values()){
    if(bone.parent.isBone)bone.position.y*=factors[bone.parent.name];
    for(const child of bone.children)if(!child.isBone)child.position.y*=factors[bone.name];
  }
  root.updateMatrixWorld(true);
  root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    mesh.geometry=mesh.geometry.clone();const worldInverse=mesh.matrixWorld.clone().invert();
    const deform=mesh.skeleton.bones.map(bone=>worldInverse.clone().multiply(bone.matrixWorld).multiply(new THREE.Matrix4().makeScale(1,factors[bone.name],1)).multiply(oldWorld.get(bone.name).clone().invert()).multiply(mesh.matrixWorld));
    const normalTransforms=deform.map(m=>new THREE.Matrix3().getNormalMatrix(m));
    const {position,normal,skinIndex,skinWeight}=mesh.geometry.attributes;
    const point=new THREE.Vector3(),direction=new THREE.Vector3(),sum=new THREE.Vector3(),normalSum=new THREE.Vector3();
    for(let i=0;i<position.count;i++){
      sum.set(0,0,0);normalSum.set(0,0,0);
      for(let k=0;k<4;k++){
        const weight=skinWeight.getComponent(i,k);if(!weight)continue;const index=skinIndex.getComponent(i,k);
        sum.addScaledVector(point.fromBufferAttribute(position,i).applyMatrix4(deform[index]),weight);
        if(normal)normalSum.addScaledVector(direction.fromBufferAttribute(normal,i).applyMatrix3(normalTransforms[index]).normalize(),weight);
      }
      position.setXYZ(i,sum.x,sum.y,sum.z);if(normal){normalSum.normalize();normal.setXYZ(i,normalSum.x,normalSum.y,normalSum.z);}
    }
    position.needsUpdate=true;if(normal)normal.needsUpdate=true;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
    mesh.skeleton.calculateInverses();mesh.bind(mesh.skeleton,mesh.matrixWorld);
  });root.updateMatrixWorld(true);
}

/** limbScale scales every bone segment; limbScales can override named segments. */
export async function createCreature({type='quadruped',animation=defaults[type],limbScale=1,limbScales={}}={}){
  checkType(type);if(!Number.isFinite(limbScale)||limbScale<.7||limbScale>1.4)throw new Error('limbScale must be within 0.7–1.4');
  const source=await loadCreatureRig(type),scene=clone(source.scene),object3d=new THREE.Group();object3d.name=`${type}_instance`;object3d.add(scene);
  const bones=boneMap(scene);for(const[name,value]of Object.entries(limbScales))if(!bones.has(name)||!Number.isFinite(value)||value<.7||value>1.4)throw new Error(`Invalid bone proportion: ${name}`);
  const factors=Object.fromEntries([...bones.keys()].map(name=>[name,limbScales[name]??limbScale]));
  const materials=new Map(),ownedGeometry=[],ownedSkeletons=new Set();
  scene.traverse(o=>{if(o.isMesh){if(!materials.has(o.material))materials.set(o.material,o.material.clone());o.material=materials.get(o.material);o.frustumCulled=false;if(o.isSkinnedMesh){o.skeleton.boneInverses=o.skeleton.boneInverses.map(m=>m.clone());ownedSkeletons.add(o.skeleton);}}});
  if(Object.values(factors).some(v=>v!==1)){resizeSegments(scene,factors);scene.traverse(o=>{if(o.isMesh)ownedGeometry.push(o.geometry);});}
  if(type==='quadruped'||type==='crawler'){scene.updateMatrixWorld(true);scene.position.y-=new THREE.Box3().setFromObject(scene).min.y;scene.updateMatrixWorld(true);}
  const sockets={};object3d.traverse(o=>{if(o.name.startsWith('socket_'))sockets[o.name.slice(7)]=o;});
  let animator;try{animator=await createCreatureAnimator(type,object3d,{animation});}catch(error){materials.forEach(m=>m.dispose());ownedGeometry.forEach(g=>g.dispose());ownedSkeletons.forEach(s=>s.dispose());throw error;}let disposed=false;
  return {type,object3d,bones,sockets,limbScale,limbScales:factors,clips:animator.clips,metadata:source.metadata,mixer:animator.mixer,play:animator.play,update:animator.update,get action(){return animator.action;},
    dispose(){if(disposed)return;disposed=true;animator.dispose();materials.forEach(m=>m.dispose());ownedGeometry.forEach(g=>g.dispose());ownedSkeletons.forEach(s=>s.dispose());},
  };
}
