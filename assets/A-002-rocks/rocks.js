import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ROCK_TYPES=Object.freeze(['stone','iron','volatile','crystal','magnet','splitter']);

/** One material and draw call per type, including all three shapes. */
function variantMaterial(source){
  const material=source.clone();
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute float rock_variant;
      attribute float instance_variant;`);
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      transformed *= 1.0 - step(0.5, abs(rock_variant - instance_variant));`);
  };
  material.customProgramCacheKey=()=> 'rock_variant_batch_v1';
  // Front-side alpha blending keeps crystals at one pass without refraction.
  material.side=THREE.FrontSide;
  if(material.transparent)material.depthWrite=false;
  return material;
}

export async function loadRocks({loader=new GLTFLoader()}={}){
  const gltf=await loader.loadAsync(new URL('./rocks.glb',import.meta.url).href);
  gltf.scene.updateMatrixWorld(true);
  const templates={};
  for(const type of ROCK_TYPES){
    templates[type]=[1,2,3].map(variant=>{
      const mesh=gltf.scene.getObjectByName(`${type}_${variant}`);
      if(!mesh?.isMesh||Array.isArray(mesh.material))throw new Error(`Invalid rock template: ${type}_${variant}`);
      // Bake imported transform so direct InstancedMesh users get Y up too.
      const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      geometry.computeBoundingSphere();
      return {geometry,material:mesh.material,name:mesh.name};
    });
  }
  // Geometry has been cloned; templates retain the original shared materials/maps.
  gltf.scene.traverse(o=>{if(o.isMesh)o.geometry.dispose();});
  return templates;
}

/**
 * records: {id,type,variant:1..3,position:[x,y,z],radius,quaternion?:[x,y,z,w]}[]
 * Geometry has radius 1. No per-instance materials or per-frame allocations.
 * Caller owns templates and can reuse them across fields. dispose() owns only batches.
 */
export function createRockField({templates,rocks=[],seed=1}={}){
  if(!templates)throw new TypeError('templates from loadRocks() are required');
  if(!Number.isFinite(seed))throw new TypeError('seed must be finite');
  const object3d=new THREE.Group();object3d.name='rock_field';
  const batches={};const handles=new Map();
  const bucket=Object.fromEntries(ROCK_TYPES.map(t=>[t,[]]));
  let rngState=seed>>>0;
  function random(){rngState=(Math.imul(rngState,1664525)+1013904223)>>>0;return rngState/4294967296;}
  for(let index=0;index<rocks.length;index++){
    const r=rocks[index];const id=r.id??index;
    if(!bucket[r.type])throw new RangeError(`Unknown rock type: ${r.type}`);
    if(handles.has(id))throw new RangeError(`Duplicate rock id: ${id}`);
    if(!Array.isArray(r.position)||r.position.length!==3||!r.position.every(Number.isFinite))throw new TypeError('position must be three finite numbers');
    if(!Number.isFinite(r.radius)||r.radius<=0)throw new RangeError('radius must be positive');
    const variant=r.variant??(1+Math.floor(random()*3));
    if(!Number.isInteger(variant)||variant<1||variant>3)throw new RangeError('variant must be 1, 2, or 3');
    const quaternion=r.quaternion??[0,0,0,1];
    if(!Array.isArray(quaternion)||quaternion.length!==4||!quaternion.every(Number.isFinite)||Math.hypot(...quaternion)<1e-6)throw new TypeError('quaternion must be a finite nonzero [x,y,z,w]');
    handles.set(id,{type:r.type,index:bucket[r.type].length});
    bucket[r.type].push({...r,variant,quaternion});
  }
  const transform=new THREE.Object3D();
  for(const type of ROCK_TYPES){
    const records=bucket[type];if(!records.length)continue;
    const parts=templates[type].map((template,i)=>{
      const geometry=template.geometry.clone();
      geometry.setAttribute('rock_variant',new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(i),1));
      return geometry;
    });
    const geometry=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());
    if(!geometry)throw new Error(`Could not merge ${type} variants`);
    const variants=new Float32Array(records.length);
    geometry.setAttribute('instance_variant',new THREE.InstancedBufferAttribute(variants,1));
    const material=variantMaterial(templates[type][0].material);
    const mesh=new THREE.InstancedMesh(geometry,material,records.length);mesh.name=`${type}_batch`;
    mesh.castShadow=false;mesh.receiveShadow=false;
    records.forEach((record,i)=>{
      variants[i]=record.variant-1;transform.position.fromArray(record.position);
      transform.quaternion.fromArray(record.quaternion).normalize();transform.scale.setScalar(record.radius);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
    object3d.add(mesh);batches[type]=mesh;
  }
  return {object3d,batches,handles,
    // Remove a destroyed rock without reallocating a batch. Gameplay owns hit tests.
    hide(id){const h=handles.get(id);if(!h)return false;transform.position.set(0,0,0);transform.quaternion.identity();transform.scale.setScalar(0);transform.updateMatrix();const b=batches[h.type];b.setMatrixAt(h.index,transform.matrix);b.instanceMatrix.needsUpdate=true;return true;},
    dispose(){for(const mesh of Object.values(batches)){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}handles.clear();},
  };
}
