import fs from 'node:fs';
import {startServer,launchPhoneBrowser,installSignalHandlers,runCleanups,sleep} from './lib.mjs';
const OUT='/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test';
const R={at:new Date().toISOString(),note:'Focused repair of QA interactions: dismiss drawing guide; start wiping on covered ink cells.'};installSignalHandlers();
const pad=()=>{const c=document.getElementById('drawPad'),r=c.getBoundingClientRect(),a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0,sx=0,sy=0;for(let y=0;y<c.height;y+=3)for(let x=0;x<c.width;x+=3)if(a[(y*c.width+x)*4+3]>0){n++;sx+=x/c.width;sy+=y/c.height;}return {ratio:r.width*r.height/innerWidth/innerHeight,pixels:n,centroid:n?[sx/n,sy/n]:null,width:r.width,height:r.height};};
async function main(){
const s=await startServer({port:8462,bots:0,env:{ASTRA_MOCK:'1',PERF_LOG:OUT+'/logs/rotate-wipe-perf.log'},logFile:OUT+'/logs/rotate-wipe-server.log'});const b=await launchPhoneBrowser();const {page:p}=await b.newPhone();
await p.goto(s.base+'/controller.html');await p.waitForFunction(()=>__spTest);await p.fill('#name','rotate');await p.locator('#joinForm button').tap();await p.waitForFunction(()=>__sp.screen==='draw');await p.locator('#modeDraw').tap();await p.locator('#guideOk').tap();await sleep(350);
const box=await p.locator('#drawPad').boundingBox();await p.mouse.move(box.x+box.width*.3,box.y+box.height*.35);await p.mouse.down();await p.mouse.move(box.x+box.width*.7,box.y+box.height*.65,{steps:20});await p.mouse.up();await sleep(100);R.land=await p.evaluate(pad);await p.screenshot({path:OUT+'/shots/canvas-actual-landscape.png'});
await p.setViewportSize({width:390,height:844});await sleep(450);R.port=await p.evaluate(pad);await p.screenshot({path:OUT+'/shots/canvas-actual-portrait.png'});R.rotatePass=R.land.pixels>0&&R.port.pixels>0&&Math.hypot(R.land.centroid[0]-R.port.centroid[0],R.land.centroid[1]-R.port.centroid[1])<.03;
await p.evaluate(()=>__spTest.go('controller'));await p.locator('#modeDraw').tap();if(await p.locator('#guideOk').isVisible())await p.locator('#guideOk').tap();await sleep(250);R.controllerPortrait=await p.evaluate(pad);await p.screenshot({path:OUT+'/shots/controller-canvas-portrait.png'});
await p.setViewportSize({width:844,height:390});await p.evaluate(()=>__spTest.go('play'));await sleep(2000);
await p.evaluate(async()=>{const m=await import('/mischief-fx.js');window.__ink=m.inkBomb(document.body,{seed:7,seconds:10,onClear:r=>window.__inkClear=r});});R.inkBefore=await p.evaluate(()=>__ink.coverage());
const start=Date.now();
for(let pass=0;pass<3;pass++){
 const cells=await p.locator('[data-ink-cell]').evaluateAll(es=>es.filter(e=>getComputedStyle(e).pointerEvents!=='none').map(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}));
 for(const c of cells){await p.mouse.move(c.x,c.y);await p.mouse.down();await p.mouse.move(Math.min(838,c.x+48),Math.min(385,c.y+30),{steps:2});await p.mouse.up();}
 if(await p.evaluate(()=>!!window.__inkClear))break;
}
await sleep(450);R.wipe=await p.evaluate(()=>({coverage:__ink.coverage(),cleared:window.__inkClear,exists:!!document.querySelector('.mfx-ink')}));R.wipeWallMs=Date.now()-start;await p.screenshot({path:OUT+'/shots/ink-actual-wiped.png'});console.log(JSON.stringify(R,null,2));await b.browser.close();
}
main().catch(e=>{R.fatal=String(e.stack||e);console.log(R.fatal)}).finally(async()=>{fs.writeFileSync(OUT+'/data/rotate-wipe.json',JSON.stringify(R,null,2));await runCleanups();process.exit(R.fatal?1:0);});
