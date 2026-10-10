import fs from 'node:fs';
import path from 'node:path';
import {startServer,launchBig,launchPhoneBrowser,installSignalHandlers,runCleanups,sleep} from './lib.mjs';
const ROOT='/private/tmp/claude-501/v14-test',OUT='/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test';
const device=process.argv[2]||'phone';
const R={at:new Date().toISOString(),device,cases:[],errors:[]};
installSignalHandlers();
async function main(){
const s=await startServer({port:8460,bots:0,env:{ASTRA_MOCK:'1',PERF_LOG:OUT+'/logs/builders-perf.log'},logFile:OUT+'/logs/builders-server.log'});
let b,p,c;if(device==='tv'){const q=await launchBig();b=q.browser;p=q.page;c=q.context;}else{const q=await launchPhoneBrowser();b=q.browser;({page:p,context:c}=await q.newPhone());}
p.on('pageerror',e=>R.errors.push(e.message));
await c.route('**/__qa/builders',r=>r.fulfill({contentType:'text/html',body:'<html><head><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"}}</script></head><body style="margin:0;background:#162340"><script type="module">import * as T from "three"; window.T=T; window.ready=true;</script></body></html>'}));
await p.goto(s.base+'/__qa/builders');await p.waitForFunction(()=>window.ready);
for(const [lane,kind] of [['v14-ship','ship'],['v14-entity3d','entity']]){
 const dir=path.join(ROOT,'dev',lane,'compare/gpt-6.1-sol');
 for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.spec.json'))){
 const rec=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));if(!rec.spec)continue;
 const spec=rec.spec;
 const r=await p.evaluate(async({spec,kind,quality,id})=>{
  const T=window.T;document.body.replaceChildren();const title=document.createElement('div');title.style='position:fixed;top:12px;left:16px;color:white;font:22px sans-serif';title.textContent=id+' · '+quality;document.body.append(title);
  const mod=await import(kind==='ship'?'/ship3d.js':'/entity3d.js');if(mod.loadEntityClips)await mod.loadEntityClips();
  const built=kind==='ship'?mod.buildShip(spec,{quality,color:0x2cbbff}):mod.buildEntity(spec,{quality,color:0x2cbbff});
  const scene=new T.Scene();scene.background=new T.Color('#172d52');scene.add(built.object3d);scene.add(new T.HemisphereLight(0xffffff,0x49659a,2));const key=new T.DirectionalLight(0xffffff,3);key.position.set(4,7,5);scene.add(key);
  const camera=new T.PerspectiveCamera(40,innerWidth/innerHeight,.01,100);camera.position.set(6,4,6);camera.lookAt(0,kind==='ship'?0:1,0);
  const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);document.body.prepend(renderer.domElement);
  let nonfinite=0,skinned=0,meshes=0;built.object3d.traverse(o=>{if(o.isMesh){meshes++;if(o.isSkinnedMesh)skinned++;const a=o.geometry.attributes.position.array;for(const v of a)if(!Number.isFinite(v))nonfinite++;}});
  if(built.setAnimation)try{built.setAnimation('walk',.5)}catch{}
  renderer.render(scene,camera);window.__builderCleanup=()=>{built.dispose();renderer.dispose();};
  return {triangles:built.triangles,reportedCalls:built.drawCalls,actualCalls:renderer.info.render.calls,size:built.size,buildMs:built.ms,nonfinite,skinned,meshes};
 },{spec,kind,quality:device==='tv'?'big':'lite',id:rec.id||f});
 R.cases.push({id:rec.id||f,kind,type:spec.type||'ship',...r});console.log(JSON.stringify(R.cases.at(-1)));
 await p.screenshot({path:OUT+'/shots/builder-'+device+'-'+(rec.id||f)+'.png'});await p.evaluate(()=>window.__builderCleanup());
 }
}
await b.close();
}
main().catch(e=>{R.fatal=String(e.stack||e);console.log(R.fatal)}).finally(async()=>{fs.writeFileSync(OUT+'/data/builders-'+device+'.json',JSON.stringify(R,null,2));await runCleanups();process.exit(R.fatal?1:0)});
