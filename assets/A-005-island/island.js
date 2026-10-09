import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';

export const ISLAND_LIGHTING = Object.freeze({ sunElevation: 18, sunAzimuth: -115, sunIntensity: 3.0, hemisphereIntensity: 2.1, turbidity: 5.5, rayleigh: 1.65, mieCoefficient: .004, mieDirectionalG: .82 });
let propsPromise, normalsPromise;
export function loadIslandProps() { return propsPromise ??= new GLTFLoader().loadAsync(new URL('island_props.glb', import.meta.url).href).catch(e=>{propsPromise=null;throw e;}); }
function loadNormals() { return normalsPromise ??= new THREE.TextureLoader().loadAsync(new URL('water_normals.png',import.meta.url).href).then(t=>{t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.NoColorSpace;return t;}).catch(e=>{normalsPromise=null;throw e;}); }
function random(seed) { let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}; }
function slopeAt(heightAt,x,z) { const a=(heightAt(x+.75,z)-heightAt(x-.75,z))/1.5,b=(heightAt(x,z+.75)-heightAt(x,z-.75))/1.5;return Math.hypot(a,b); }

/** Expand the land horizontally while keeping terrain heights and prop sizes. */
export function createScaledHeightAt(heightAt,scale=2) {
  if(typeof heightAt!=='function'||!Number.isFinite(scale)||scale<=0)throw new Error('A height function and positive scale are required');
  return (x,z)=>heightAt(x/scale,z/scale);
}

/** Local +Y height, -Z front. No textures; height/slope blend on standard PBR. */
export function createTerrainMaterial() {
  const material=new THREE.MeshStandardMaterial({roughness:1,metalness:0});material.name='island_terrain';
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vIslandPosition; varying vec3 vIslandNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvIslandPosition=position;vIslandNormal=normal;');
    shader.fragmentShader='varying vec3 vIslandPosition; varying vec3 vIslandNormal;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float h=vIslandPosition.y;
      float slope=1.0-abs(normalize(vIslandNormal).y);
      float terrainVariation=sin(vIslandPosition.x*.079)*sin(vIslandPosition.z*.091)+.35*sin(vIslandPosition.x*.21+vIslandPosition.z*.13);
      vec3 sand=vec3(.76,.69,.48);vec3 wet=vec3(.39,.38,.25);
      vec3 grass=mix(vec3(.115,.245,.035),vec3(.19,.32,.055),.5+.25*terrainVariation);
      vec3 rock=vec3(.31,.28,.215);
      vec3 base=mix(wet,sand,smoothstep(-1.2,1.4,h));
      float plants=smoothstep(1.8,5.2,h+terrainVariation*.55)*(1.0-smoothstep(.17,.47,slope));
      base=mix(base,grass,plants);
      float crags=smoothstep(.20,.51,slope)*smoothstep(3.0,9.0,h);
      base=mix(base,rock,crags);
      diffuseColor.rgb*=base*(.96+.035*terrainVariation);
    `);
  };
  material.customProgramCacheKey=()=> 'space_party_island_terrain_r160_v1';return material;
}

export function createTerrainGeometry({heightAt,size=420,resolution=160}) {
  if(typeof heightAt!=='function')throw new Error('heightAt(x,z) is required');
  if(!Number.isFinite(size)||size<=0||!Number.isInteger(resolution)||resolution<16||resolution>192)throw new Error('Invalid size or resolution');
  const geometry=new THREE.PlaneGeometry(size,size,resolution,resolution);geometry.rotateX(-Math.PI/2);
  const p=geometry.attributes.position;
  for(let i=0;i<p.count;i++){const h=heightAt(p.getX(i),p.getZ(i));if(!Number.isFinite(h))throw new Error('heightAt returned a nonfinite height');p.setY(i,h);}
  p.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}

function shoreMap(heightAt,size) {
  const n=256,data=new Uint8Array(n*n*4);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const h=heightAt((x/(n-1)-.5)*size,(y/(n-1)-.5)*size),i=(y*n+x)*4;data[i]=Math.round(THREE.MathUtils.clamp((h+16)/80,0,1)*255);data[i+1]=data[i+2]=0;data[i+3]=255;}
  const map=new THREE.DataTexture(data,n,n);map.minFilter=map.magFilter=THREE.LinearFilter;map.generateMipmaps=false;map.needsUpdate=true;return map;
}

function createOcean(normals,heightMap,size,sun) {
  const water=new Water(new THREE.PlaneGeometry(size*30,size*30),{textureWidth:1,textureHeight:1,waterNormals:normals,sunDirection:sun,sunColor:0xffe3bd,waterColor:0x1ba697,distortionScale:1.2,fog:true});
  water.name='island_water';water.rotation.x=-Math.PI/2;water.material.name='island_water_no_reflection';
  const uniforms=water.material.uniforms;
  uniforms.islandHeightMap={value:heightMap};uniforms.islandSize={value:size};uniforms.islandInverse={value:new THREE.Matrix4()};
  // Water r160 normally renders a reflected camera in onBeforeRender. Replace
  // that callback, retaining only the eye uniform. No render target pass occurs.
  water.onBeforeRender=(_renderer,_scene,camera)=>{uniforms.eye.value.setFromMatrixPosition(camera.matrixWorld);};
  let fragment=water.material.fragmentShader;
  fragment='uniform sampler2D islandHeightMap;uniform float islandSize;uniform mat4 islandInverse;\n'+fragment;
  const reflection=/vec3 reflectionSample =[^;]*;/;
  if(!reflection.test(fragment)||!fragment.includes('vec3 outgoingLight = albedo;'))throw new Error('Unsupported Water shader: use three.js 0.160.0');
  fragment=fragment.replace(reflection,'vec3 reflectionSample = vec3(.14,.30,.34);');
  fragment=fragment.replace('vec3 outgoingLight = albedo;',`
    vec2 islandUV=(islandInverse*worldPosition).xz/islandSize+.5;
    float offshoreDistance=max(0.0,length(islandUV-.5)-.46)*islandSize;
    float bed=texture2D(islandHeightMap,clamp(islandUV,0.0,1.0)).r*80.0-16.0-offshoreDistance*.05;
    float depth=max(0.0,-bed);
    vec3 lagoon=mix(vec3(.18,.66,.53),vec3(.014,.20,.26),smoothstep(.25,10.0,depth));
    float ripple=.5+.5*sin(depth*7.0-time*1.65+sin(worldPosition.x*.24)*.5+sin(worldPosition.z*.28)*.4);
    float foam=(1.0-smoothstep(.08,1.25,depth))*(.18+.68*pow(ripple,5.0));
    vec3 outgoingLight=mix(lagoon*(.80+.24*surfaceNormal.y)+albedo*.20+specularLight*.08,vec3(.91,.96,.83),foam);
  `);
  water.material.fragmentShader=fragment;water.material.needsUpdate=true;water.userData.reflectionPasses=0;return water;
}

function shadeMap(){const n=64,data=new Uint8Array(n*n*4);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const r=Math.hypot((x+.5)/n*2-1,(y+.5)/n*2-1),i=(y*n+x)*4;data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(Math.max(0,1-r)**2*255);}const t=new THREE.DataTexture(data,n,n);t.needsUpdate=true;return t;}

/** Seeded decoration; terrain physics stays authoritative in heightAt. */
export async function createIsland({seed=1,heightAt,size=420,resolution=160,palmCount=300,bushCount=160,rockCount=80,cliffCount=20,clearings=[{x:0,z:0,radius:12}],triangleBudget=150000,palmDetailDistance=85}={}) {
  if(!Number.isInteger(seed)||!Number.isFinite(size)||size<=0||!Number.isInteger(resolution)||resolution<16||resolution>192)throw new Error('Invalid seed, size or resolution');
  if(typeof heightAt!=='function')throw new Error('heightAt(x,z) is required');
  if(![palmCount,bushCount,rockCount,cliffCount].every(n=>Number.isInteger(n)&&n>=0&&n<=1000))throw new Error('Invalid prop count');
  if(!Number.isFinite(triangleBudget)||triangleBudget<1||triangleBudget>150000||!Number.isFinite(palmDetailDistance)||palmDetailDistance<=0)throw new Error('Invalid triangle budget or LOD distance');
  if(!clearings.every(c=>[c.x,c.z,c.radius].every(Number.isFinite)&&c.radius>=0))throw new Error('Invalid clearing');
  const [gltf,normals]=await Promise.all([loadIslandProps(),loadNormals()]);
  const templates=new Map();gltf.scene.updateMatrixWorld(true);gltf.scene.traverse(o=>{if(o.isMesh)templates.set(o.name,o);});
  const object3d=new THREE.Group();object3d.name='tropical_island';const ownedGeometry=[],ownedMaterials=[],ownedTextures=[],ownedInstances=[];
  const terrainGeometry=createTerrainGeometry({heightAt,size,resolution}),terrainMaterial=createTerrainMaterial();
  ownedGeometry.push(terrainGeometry);ownedMaterials.push(terrainMaterial);
  const terrain=new THREE.Mesh(terrainGeometry,terrainMaterial);terrain.name='island_terrain';object3d.add(terrain);
  const sunDirection=new THREE.Vector3().setFromSphericalCoords(1,THREE.MathUtils.degToRad(90-ISLAND_LIGHTING.sunElevation),THREE.MathUtils.degToRad(ISLAND_LIGHTING.sunAzimuth));
  const heightMap=shoreMap(heightAt,size);ownedTextures.push(heightMap);
  const water=createOcean(normals,heightMap,size,sunDirection);object3d.add(water);ownedGeometry.push(water.geometry);ownedMaterials.push(water.material);ownedTextures.push(water.material.uniforms.mirrorSampler.value);
  const sky=new Sky();sky.name='island_sky';sky.scale.setScalar(size*25);
  for(const key of ['turbidity','rayleigh','mieCoefficient','mieDirectionalG'])sky.material.uniforms[key].value=ISLAND_LIGHTING[key];
  sky.material.uniforms.sunPosition.value.copy(sunDirection);object3d.add(sky);ownedGeometry.push(sky.geometry);ownedMaterials.push(sky.material);
  const sunlight=new THREE.DirectionalLight(0xffdfac,ISLAND_LIGHTING.sunIntensity);sunlight.name='island_sun';sunlight.position.copy(sunDirection).multiplyScalar(500);sunlight.castShadow=false;
  const ambient=new THREE.HemisphereLight(0xcae8e9,0x655039,ISLAND_LIGHTING.hemisphereIntensity);ambient.name='island_ambient';object3d.add(sunlight,sunlight.target,ambient);
  const palette=templates.get('bush_1').material.clone();ownedMaterials.push(palette);
  const palmMaterial=palette.clone(),wind={value:0};ownedMaterials.push(palmMaterial);
  palmMaterial.onBeforeCompile=shader=>{shader.uniforms.islandWind=wind;shader.vertexShader='uniform float islandWind;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    float heightWeight=smoothstep(1.0,9.0,position.y);
    float phase=instanceMatrix[3].x*.13+instanceMatrix[3].z*.17;
    transformed.x+=sin(islandWind*.75+phase)*.13*heightWeight;
    transformed.z+=cos(islandWind*.56+phase)*.09*heightWeight;
  `);};palmMaterial.customProgramCacheKey=()=> 'space_party_palm_wind_r160_v1';
  const rng=random(seed),placements=[],palmPlacements=[];const byType=new Map(),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),s=new THREE.Vector3();
  const reserved=(x,z,r)=>clearings.some(c=>Math.hypot(x-c.x,z-c.z)<c.radius+r);
  function scatter(kind,count,variants,minY,maxY,maxSlope,spacing,scaleRange) {
    const placed=[];let attempts=0;
    while(placed.length<count&&attempts++<Math.max(500,count*100)){
      const x=(rng()-.5)*size*.96,z=(rng()-.5)*size*.96,y=heightAt(x,z),slope=slopeAt(heightAt,x,z);
      if(!Number.isFinite(y+slope))throw new Error('heightAt returned a nonfinite height');
      if(y<minY||y>maxY||slope>maxSlope||reserved(x,z,spacing*.6)||placed.some(p=>Math.hypot(x-p.position[0],z-p.position[2])<spacing))continue;
      const variant=1+Math.floor(rng()*variants),scale=scaleRange[0]+rng()*(scaleRange[1]-scaleRange[0]),yaw=rng()*Math.PI*2;
      const position=[x,y-(kind==='cliff'?scale*.9:.045),z],item={kind,variant,position,scale,yaw,slope};
      q.setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);matrix.compose(v.fromArray(position),q,s.setScalar(scale));item.matrix=matrix.clone();
      placed.push(item);placements.push(item);const name=kind+'_'+variant;if(!byType.has(name))byType.set(name,[]);byType.get(name).push(item);
      if(kind==='palm')palmPlacements.push(item);
    }
  }
  scatter('palm',palmCount,3,1.6,24,.60,6,[.72,1.28]);
  scatter('bush',bushCount,2,3.2,30,.8,2.8,[.75,1.8]);
  scatter('beach_rock',rockCount,3,-.35,5.8,1.0,3.2,[.65,1.9]);
  scatter('cliff',cliffCount,2,8,33,2.0,9,[.75,1.8]);
  const batches=new Map();
  function batch(name,count,material){const source=templates.get(name);if(!source)throw new Error('Missing prop '+name);const mesh=new THREE.InstancedMesh(source.geometry,material,Math.max(1,count));mesh.name=name+'_instances';mesh.count=0;mesh.frustumCulled=false;object3d.add(mesh);ownedInstances.push(mesh);batches.set(name,mesh);return mesh;}
  for(const [name,items] of byType){
    if(name.startsWith('palm_')){batch(name,items.length,palmMaterial);batch(name+'_lod',items.length,palmMaterial);}
    else{const mesh=batch(name,items.length,palette);items.forEach((p,i)=>mesh.setMatrixAt(i,p.matrix));mesh.count=items.length;mesh.instanceMatrix.needsUpdate=true;}
  }
  // Cheap soft ground contact; this is an alpha decal batch, not a shadow map.
  const shadeTexture=shadeMap();ownedTextures.push(shadeTexture);
  const shadeGeometry=new THREE.PlaneGeometry(1,1);shadeGeometry.rotateX(-Math.PI/2);ownedGeometry.push(shadeGeometry);
  const shadeMaterial=new THREE.MeshBasicMaterial({color:0x173325,map:shadeTexture,transparent:true,opacity:.24,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});ownedMaterials.push(shadeMaterial);
  const shade=new THREE.InstancedMesh(shadeGeometry,shadeMaterial,Math.max(1,placements.length));ownedInstances.push(shade);shade.name='ground_contact';shade.count=placements.length;shade.frustumCulled=false;
  placements.forEach((p,i)=>{const width=p.scale*(p.kind==='palm'?2.2:p.kind==='cliff'?6:2.7);matrix.makeScale(width,1,width);matrix.setPosition(p.position[0],heightAt(p.position[0],p.position[2])+.035,p.position[2]);shade.setMatrixAt(i,matrix);});shade.instanceMatrix.needsUpdate=true;object3d.add(shade);
  const triangleCount=mesh=>(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
  let fixedTriangles=resolution*resolution*2+14+placements.length*2;
  for(const [name,mesh] of batches)if(!name.startsWith('palm_'))fixedTriangles+=triangleCount(mesh)*mesh.count;
  const lowTriangles=palmPlacements.reduce((total,p)=>total+triangleCount(templates.get('palm_'+p.variant+'_lod')),0);
  // Use the most expensive upgrade as a conservative cap if variants change.
  const highExtra=Math.max(1,...[1,2,3].map(i=>triangleCount(templates.get('palm_'+i))-triangleCount(templates.get('palm_'+i+'_lod'))));
  if(fixedTriangles+lowTriangles>triangleBudget){ownedInstances.forEach(m=>m.dispose());ownedGeometry.forEach(g=>g.dispose());ownedMaterials.forEach(m=>m.dispose());ownedTextures.forEach(t=>t.dispose());throw new Error('Requested island density/resolution exceeds the triangle budget even at low LOD');}
  const maxHighPalms=Math.min(palmPlacements.length,Math.floor((triangleBudget-fixedTriangles-lowTriangles)/highExtra));
  let elapsed=0,lodElapsed=1,disposed=false,lodMode='auto';const cameraPoint=new THREE.Vector3();
  function updateLOD(camera){
    if(camera){camera.getWorldPosition(cameraPoint);object3d.worldToLocal(cameraPoint);}else cameraPoint.set(0,10000,0);
    const ordered=palmPlacements.map((p,index)=>({p,index,d:new THREE.Vector3().fromArray(p.position).distanceToSquared(cameraPoint)})).sort((a,b)=>a.d-b.d||a.index-b.index);
    const high=new Set(ordered.filter(o=>lodMode==='high'||(lodMode==='auto'&&o.d<palmDetailDistance*palmDetailDistance)).slice(0,maxHighPalms).map(o=>o.p));
    for(const [name,mesh] of batches)if(name.startsWith('palm_'))mesh.count=0;
    for(const p of palmPlacements){const name='palm_'+p.variant+(high.has(p)?'':'_lod'),mesh=batches.get(name);mesh.setMatrixAt(mesh.count++,p.matrix);}
    for(const [name,mesh] of batches)if(name.startsWith('palm_'))mesh.instanceMatrix.needsUpdate=true;
  }
  updateLOD();
  function getStats(){let triangles=0,calls=0;object3d.traverseVisible(o=>{if(!o.isMesh)return;const count=o.isInstancedMesh?o.count:1;if(count){triangles+=triangleCount(o)*count;calls++;}});return {triangles,calls,triangleBudget,maxHighPalms,counts:Object.fromEntries(['palm','bush','beach_rock','cliff'].map(k=>[k,placements.filter(p=>p.kind===k).length])),reflectionPasses:0};}
  return {object3d,terrain,water,sky,sunlight,ambient,batches,placements:placements.map(({matrix,...p})=>p),heightAt,clearings,getStats,
    update(dt,camera){if(!Number.isFinite(dt)||dt<0)throw new Error('dt must be finite nonnegative seconds');if(disposed)return;elapsed+=dt;wind.value=elapsed;water.material.uniforms.time.value=elapsed;object3d.updateMatrixWorld(true);water.material.uniforms.islandInverse.value.copy(object3d.matrixWorld).invert();lodElapsed+=dt;if(lodElapsed>=.25){updateLOD(camera);lodElapsed=0;}},
    setLodMode(mode,camera){if(!['auto','low','high'].includes(mode))throw new Error('Invalid LOD mode');lodMode=mode;updateLOD(camera);},
    dispose(){if(disposed)return;disposed=true;ownedInstances.forEach(m=>m.dispose());ownedGeometry.forEach(g=>g.dispose());ownedMaterials.forEach(m=>m.dispose());ownedTextures.forEach(t=>t.dispose());},
  };
}
