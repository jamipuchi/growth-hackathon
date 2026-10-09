import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const cache=new Map();
async function instantiate(kind){
  if(!cache.has(kind)){
    const promise=new GLTFLoader().loadAsync(new URL(`./${kind}.glb`,import.meta.url).href);
    cache.set(kind,promise);promise.catch(()=>cache.delete(kind));
  }
  const gltf=await cache.get(kind),object3d=clone(gltf.scene),materials=new Map();
  object3d.traverse(o=>{
    if(!o.isMesh)return;
    const copy=m=>{if(!materials.has(m))materials.set(m,m.clone());return materials.get(m);};
    o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);
    o.castShadow=false;o.receiveShadow=false;
    // Animated bounds can change every frame; these tiny avatars should not pop
    // out when a limb leaves the GLB rest-pose bounds.
    if(o.isSkinnedMesh)o.frustumCulled=false;
  });
  const sockets={};object3d.traverse(o=>{if(o.name.startsWith('socket_'))sockets[o.name.slice(7)]=o;});
  let disposed=false;
  return {object3d,clips:gltf.animations,sockets,materials:[...materials.values()],
    dispose(){if(disposed)return;disposed=true;object3d.removeFromParent();for(const m of materials.values())m.dispose();object3d.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();});},
  };
}

export async function createDefaultShip({color}={}){
  const asset=await instantiate('ship');
  const engine=asset.materials.find(m=>m.name==='engine_glow');
  if(color!==undefined){asset.materials.find(m=>m.name==='paper_suit').color.set(color);engine.emissive.set(color);}
  return {...asset,setEnginePower(power=1){if(!Number.isFinite(power))throw new TypeError('Engine power must be finite');engine.emissiveIntensity=5*THREE.MathUtils.clamp(power,0,3);}};
}

export async function createDefaultExplorer({animation='idle',color}={}){
  const asset=await instantiate('explorer');
  const mixer=new THREE.AnimationMixer(asset.object3d);
  const actions=new Map(asset.clips.map(clip=>[clip.name,mixer.clipAction(clip)]));
  const visor=asset.materials.find(m=>m.name==='visor'),defaultMap=visor.map;
  if(color!==undefined)asset.materials.find(m=>m.name==='paper_suit').color.set(color);
  let active=null;
  function play(name,{fade=.15,loop=!['jump','land'].includes(name),restart=false}={}){
    const next=actions.get(name);if(!next)throw new RangeError(`Unknown explorer clip: ${name}`);
    if(!Number.isFinite(fade)||fade<0)throw new RangeError('fade must be nonnegative');
    if(active===next&&next.isRunning()&&!restart)return next;
    if(active&&active!==next){if(fade)active.fadeOut(fade);else active.stop();}
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
    next.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);next.clampWhenFinished=!loop;
    if(fade)next.fadeIn(fade);next.play();active=next;return next;
  }
  if(animation!==null)play(animation,{fade:0});
  return {...asset,mixer,play,
    update(dt){if(!Number.isFinite(dt)||dt<0)throw new RangeError('dt must be nonnegative');mixer.update(dt);},
    setVisorTexture(texture){if(!texture?.isTexture)throw new TypeError('Provide a THREE.Texture');texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;visor.color.set(0xffffff);visor.map=texture;visor.needsUpdate=true;},
    resetVisor(){visor.map=defaultMap;visor.needsUpdate=true;},
    dispose(){mixer.stopAllAction();mixer.uncacheRoot(asset.object3d);asset.dispose();},
  };
}
