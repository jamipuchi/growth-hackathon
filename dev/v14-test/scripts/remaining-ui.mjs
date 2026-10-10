import fs from 'node:fs';
import {startServer,launchPhoneBrowser,installSignalHandlers,runCleanups,sleep} from './lib.mjs';
const OUT='/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test';const R={at:new Date().toISOString()};installSignalHandlers();
async function main(){
const s=await startServer({port:8465,bots:0,env:{ASTRA_MOCK:'1',PERF_LOG:OUT+'/logs/remaining-ui-perf.log'},logFile:OUT+'/logs/remaining-ui-server.log'});const b=await launchPhoneBrowser();
const ic=await b.browser.newContext({viewport:{width:1024,height:768},isMobile:true,hasTouch:true,deviceScaleFactor:2,userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});const ip=await ic.newPage();await ip.goto(s.base+'/controller.html');await ip.waitForFunction(()=>__spTest);R.ipadBefore=await ip.evaluate(()=>__spTest.fullscreen());await ip.locator('#fsBtn').tap();await sleep(300);R.ipadAfter=await ip.evaluate(()=>__spTest.fullscreen());await ip.screenshot({path:OUT+'/shots/ipad-webkit-fullscreen.png'});await ic.close();
const {page:p}=await b.newPhone();await p.goto(s.base+'/controller.html');await p.waitForFunction(()=>__spTest);await p.fill('#name','sound');await p.locator('#joinForm button').tap();await p.waitForFunction(()=>__sp.screen==='draw');await p.locator('#useDefault').tap();await p.waitForFunction(()=>__sp.game);
const tc=await b.browser.newContext({viewport:{width:1440,height:900}}),tv=await tc.newPage();await tv.goto(s.base+'/space.html');await tv.waitForFunction(()=>__game);
for(const q of [p,tv])await q.evaluate(()=>{const g=window.__game||window.__sp.game;window.__sounds=[];const orig=g.sfx.play;g.sfx.play=function(name,...args){__sounds.push({name,at:performance.now()});return orig.call(this,name,...args)};});
await tv.locator('#startBtn').click();await sleep(4200);R.audio={phone:await p.evaluate(()=>__sounds),tv:await tv.evaluate(()=>__sounds)};await p.screenshot({path:OUT+'/shots/audio-after-go.png'});
await p.evaluate(async()=>{const m=await import('/mischief-fx.js');window.__ink=m.inkBomb(document.body,{seed:7,seconds:10,onClear:r=>window.__inkClear=r});});R.inkBefore=await p.evaluate(()=>__ink.coverage());const start=Date.now();
for(let pass=0;pass<3;pass++){
 const cells=await p.locator('[data-ink-cell]').evaluateAll(es=>es.filter(e=>getComputedStyle(e).pointerEvents!=='none').map(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}));
 for(const c of cells){await p.mouse.move(c.x,c.y);await p.mouse.down();await p.mouse.move(Math.min(838,c.x+48),Math.min(385,c.y+30),{steps:2});await p.mouse.up();}
 if(await p.evaluate(()=>!!window.__inkClear))break;
}
await sleep(450);R.wipe=await p.evaluate(()=>({coverage:__ink.coverage(),cleared:window.__inkClear,exists:!!document.querySelector('.mfx-ink')}));R.wipeWallMs=Date.now()-start;await p.screenshot({path:OUT+'/shots/ink-actual-wiped.png'});
await p.setViewportSize({width:390,height:844});await p.evaluate(()=>__spTest.go('controller'));await sleep(400);R.controllerPortrait=await p.evaluate(()=>{const c=document.getElementById('drawPad'),r=c.getBoundingClientRect(),rotate=document.getElementById('rotate');return {ratio:r.width*r.height/innerWidth/innerHeight,rotateVisible:!!rotate.getClientRects().length&&getComputedStyle(rotate).display!=='none',text:rotate.innerText}});await p.screenshot({path:OUT+'/shots/controller-canvas-portrait.png'});
console.log(JSON.stringify(R,null,2));await b.browser.close();
}
main().catch(e=>{R.fatal=String(e.stack||e);console.log(R.fatal)}).finally(async()=>{fs.writeFileSync(OUT+'/data/remaining-ui.json',JSON.stringify(R,null,2));await runCleanups();process.exit(R.fatal?1:0);});
