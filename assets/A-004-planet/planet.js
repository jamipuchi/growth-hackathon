import * as THREE from 'three';

export const PLANET_SUN_DIRECTION = Object.freeze([-.8,.35,-.65]);
export const LANDING_REGION = Object.freeze({longitude:74,latitude:-8,span:28});
let mapsPromise;
export function loadPlanetMaps(){
  return mapsPromise??=Promise.all(['planet_color.png','planet_data.png'].map(async (file,i)=>{
    const t=await new THREE.TextureLoader().loadAsync(new URL(file,import.meta.url).href);
    t.colorSpace=i===0?THREE.SRGBColorSpace:THREE.NoColorSpace;t.wrapS=THREE.RepeatWrapping;t.wrapT=THREE.ClampToEdgeWrapping;return t;
  })).then(([color,data])=>({color,data})).catch(e=>{mapsPromise=null;throw e;});
}
function seeded(seed){let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function islandMap(seed){
  const size=256,bytes=new Uint8Array(size*size*4),heights=new Float32Array(size*size);
  const hash=(x,y)=>{const v=Math.sin(x*127.1+y*311.7+seed*74.7)*43758.5453;return v-Math.floor(v);};
  const noise=(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy);return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iy),hash(ix+1,iy),ux),THREE.MathUtils.lerp(hash(ix,iy+1),hash(ix+1,iy+1),ux),uy);};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const px=x/(size-1)*2-1,py=y/(size-1)*2-1,r=Math.hypot(px,py);let n=0,amp=.5,f=1;
    for(let i=0;i<5;i++){n+=noise(px*f*3+10,py*f*3+10)*amp;amp*=.5;f*=2;}
    heights[y*size+x]=Math.max((n*1.4-.25)*Math.max(0,1-r*r)-r*r*.12,.18*(1-r/.3));
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const h=heights[y*size+x],i=(y*size+x)*4;
    const dx=heights[y*size+Math.min(size-1,x+1)]-heights[y*size+Math.max(0,x-1)];
    const dy=heights[Math.min(size-1,y+1)*size+x]-heights[Math.max(0,y-1)*size+x];
    bytes[i]=Math.round(THREE.MathUtils.smoothstep(h,-.006,.008)*255);bytes[i+1]=Math.round(THREE.MathUtils.clamp(h*2.2,0,1)*255);bytes[i+2]=Math.round(THREE.MathUtils.clamp(.5+dx*7-dy*5,0,1)*255);bytes[i+3]=255;
  }
  const texture=new THREE.DataTexture(bytes,size,size);texture.magFilter=texture.minFilter=THREE.LinearFilter;texture.needsUpdate=true;return texture;
}
function directionAt(longitude,latitude){const u=(longitude+180)/360,theta=(90-latitude)*Math.PI/180;return new THREE.Vector3(-Math.cos(u*Math.PI*2)*Math.sin(theta),Math.cos(theta),Math.sin(u*Math.PI*2)*Math.sin(theta));}

/** Radius in metres. External scene lighting should match sunDirection. */
export async function createPlanet({seed=1,radius=200,unlocked=true,sunDirection=PLANET_SUN_DIRECTION}={}){
  if(!Number.isInteger(seed)||!Number.isFinite(radius)||radius<=0)throw new Error('Planet seed must be integer and radius positive');
  const worldSun=new THREE.Vector3().fromArray(sunDirection);
  if(![worldSun.x,worldSun.y,worldSun.z].every(Number.isFinite)||worldSun.lengthSq()===0)throw new Error('sunDirection must be a finite nonzero [x,y,z]');
  worldSun.normalize();const maps=await loadPlanetMaps(),islandTexture=islandMap(seed),rng=seeded(seed);
  const object3d=new THREE.Group();object3d.name='planet';
  const uniforms={planetData:{value:maps.data},planetIsland:{value:islandTexture},planetTime:{value:0},planetCloudOffset:{value:rng()},planetSun:{value:worldSun.clone()},planetSunWorld:{value:worldSun.clone()},planetLocked:{value:unlocked?0:1},planetNear:{value:0},planetIslandUV:{value:new THREE.Vector2((LANDING_REGION.longitude+180)/360,(LANDING_REGION.latitude+90)/180)},planetIslandSpan:{value:LANDING_REGION.span/360}};
  const surfaceMaterial=new THREE.MeshStandardMaterial({map:maps.color,roughness:.82,metalness:0});surfaceMaterial.name='planet_surface_pbr';
  surfaceMaterial.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec3 planetNormal;varying vec3 planetWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nplanetNormal=normal;planetWorld=(modelMatrix*vec4(position,1.0)).xyz;');
    shader.fragmentShader=`uniform sampler2D planetData;uniform sampler2D planetIsland;uniform float planetTime;uniform float planetCloudOffset;uniform vec3 planetSun;uniform vec3 planetSunWorld;uniform float planetLocked;uniform vec2 planetIslandUV;uniform float planetIslandSpan;varying vec3 planetNormal;varying vec3 planetWorld;\n`+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      vec3 packedPlanet=texture2D(planetData,vMapUv).rgb;
      vec2 islandUV=(vMapUv-planetIslandUV)/vec2(planetIslandSpan,planetIslandSpan*2.0)+.5;
      float inIsland=step(0.0,islandUV.x)*step(islandUV.x,1.0)*step(0.0,islandUV.y)*step(islandUV.y,1.0);
      vec3 islandRG=texture2D(planetIsland,clamp(islandUV,0.0,1.0)).rgb*inIsland;
      float islandLand=islandRG.r;
      vec3 islandColor=mix(vec3(.64,.56,.34),vec3(.08,.23,.04),smoothstep(.015,.13,islandRG.g));
      islandColor*=.68+.62*islandRG.b;
      diffuseColor.rgb=mix(diffuseColor.rgb,islandColor,islandLand);
      float planetLand=max(packedPlanet.b,islandLand);
      vec2 cloudUV=vec2(fract(vMapUv.x+planetCloudOffset+planetTime*.00035),vMapUv.y);
      float planetCloud=texture2D(planetData,cloudUV).g;
      // Keep the landing landmark readable through a local break in the clouds.
      planetCloud*=1.0-.85*exp(-dot(islandUV-.5,islandUV-.5)*8.0)*inIsland;
      float cloudShadow=texture2D(planetData,cloudUV+vec2(.002,-.001)).g;
      diffuseColor.rgb*=1.0-cloudShadow*.16;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.84,.88,.91),planetCloud*.90);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(mix(.31,.92,planetLand),.95,planetCloud);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      float sunFacing=dot(normalize(planetNormal),planetSun);
      float darkness=1.0-smoothstep(-.18,.12,sunFacing);
      float cities=packedPlanet.r*darkness*(1.0-planetCloud*.80)*(1.0-islandLand);
      totalEmissiveRadiance+=vec3(2.2,.95,.18)*cities;
      float rim=pow(1.0-clamp(dot(normal,normalize(vViewPosition)),0.0,1.0),4.0);
      totalEmissiveRadiance+=vec3(.04,.19,.46)*rim*(.25+.75*smoothstep(-.3,.5,sunFacing));
      float shimmer=pow(.5+.5*sin(planetNormal.y*52.0+planetTime*1.4),20.0);
      totalEmissiveRadiance+=vec3(.02,.07,.12)*planetLocked*(.12+shimmer)*(.3+rim);
    `);
  };
  surfaceMaterial.customProgramCacheKey=()=> 'space_party_planet_pbr_r160_v1';
  const surface=new THREE.Mesh(new THREE.SphereGeometry(radius,96,48),surfaceMaterial);surface.name='planet_surface';object3d.add(surface);
  const atmosphereMaterial=new THREE.ShaderMaterial({name:'planet_atmosphere',uniforms,
    vertexShader:`varying vec3 vWorld;varying vec3 vNormal;void main(){vec4 p=modelMatrix*vec4(position,1.0);vWorld=p.xyz;vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader:`uniform vec3 planetSunWorld;varying vec3 vWorld;varying vec3 vNormal;void main(){vec3 V=normalize(cameraPosition-vWorld);float f=1.0-abs(dot(normalize(vNormal),V));float edge=pow(f,3.0)*(1.0-smoothstep(.94,1.0,f));float lit=.18+.82*smoothstep(-.3,.6,dot(normalize(vNormal),planetSunWorld));gl_FragColor=vec4(vec3(.008,.17,.85)*1.5,edge*lit*.72);#include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(';#include',';\n#include'),
    transparent:true,depthWrite:false,side:THREE.BackSide,blending:THREE.AdditiveBlending});
  const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(radius*1.045,64,32),atmosphereMaterial);atmosphere.name='planet_atmosphere';object3d.add(atmosphere);
  const landingDirection=directionAt(LANDING_REGION.longitude,LANDING_REGION.latitude);
  const socket=new THREE.Object3D();socket.name='socket_landing';socket.position.copy(landingDirection).multiplyScalar(radius*1.017);socket.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),landingDirection);object3d.add(socket);
  const ringMaterial=new THREE.ShaderMaterial({name:'landing_ring_glow',uniforms,
    vertexShader:`varying vec2 ringPoint;void main(){ringPoint=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform float planetTime;uniform float planetNear;varying vec2 ringPoint;void main(){float d=length(ringPoint)/${radius.toFixed(8)};float band=exp(-pow((d-.145)*190.0,2.0))+.26*exp(-pow((d-.145)*49.0,2.0));float a=atan(ringPoint.y,ringPoint.x);float ticks=pow(.5+.5*cos(a*12.0),22.0)*.14;float pulse=.93+.07*sin(planetTime*2.6);gl_FragColor=vec4(mix(vec3(.22,.86,1.0),vec3(.80,1.0,.75),planetNear)*1.8,(band+ticks*band)*pulse*(.7+.3*planetNear));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>}`,
    transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});ringMaterial.forceSinglePass=true;
  const landingRing=new THREE.Mesh(new THREE.RingGeometry(radius*.10,radius*.19,96,4),ringMaterial);landingRing.name='landing_ring';socket.add(landingRing);landingRing.visible=Boolean(unlocked);
  let disposed=false,time=0,isUnlocked=Boolean(unlocked);const rotation=new THREE.Quaternion();
  const getStats=()=>{let calls=0,triangles=0;object3d.traverseVisible(o=>{if(o.isMesh){calls++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});return {triangles,calls,radius,unlocked:isUnlocked,textures:3,reflectionPasses:0};};
  const syncSun=()=>{object3d.getWorldQuaternion(rotation).invert();uniforms.planetSun.value.copy(worldSun).applyQuaternion(rotation);uniforms.planetSunWorld.value.copy(worldSun);};
  syncSun();
  return {object3d,group:object3d,surface,atmosphere,landingRing,sockets:{landing:socket},landingDirection:landingDirection.clone(),get sunDirection(){return worldSun.clone();},getStats,
    update(dt){if(!Number.isFinite(dt)||dt<0)throw new Error('dt must be finite nonnegative seconds');if(disposed)return;time+=dt;uniforms.planetTime.value=time;syncSun();},
    setUnlocked(value){isUnlocked=Boolean(value);landingRing.visible=isUnlocked;uniforms.planetLocked.value=isUnlocked?0:1;},
    setProximity(value){if(!Number.isFinite(value))throw new Error('Proximity must be finite');uniforms.planetNear.value=THREE.MathUtils.clamp(value,0,1);},
    setSunDirection(direction){const d=new THREE.Vector3().fromArray(direction);if(![d.x,d.y,d.z].every(Number.isFinite)||d.lengthSq()===0)throw new Error('Invalid sun direction');worldSun.copy(d).normalize();syncSun();},
    getLandingPoint(target=new THREE.Vector3()){return socket.getWorldPosition(target);},
    dispose(){if(disposed)return;disposed=true;[surface,atmosphere,landingRing].forEach(o=>{o.geometry.dispose();o.material.dispose();});islandTexture.dispose();},
  };
}
