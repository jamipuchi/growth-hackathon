import fs from 'node:fs';
import {startServer,launchPhoneBrowser,installSignalHandlers,runCleanups,sleep} from './lib.mjs';
const OUT='/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test';const R={at:new Date().toISOString()};installSignalHandlers();
async function main(){
const s=await startServer({port:8466,bots:0,env:{ASTRA_MOCK:'1',PERF_LOG:OUT+'/logs/ink-sweep-perf.log'},logFile:OUT+'/logs/ink-sweep-server.log'});const b=await launchPhoneBrowser();const {page:p}=await b.newPhone();await p.goto(s.base+'/controller.html');await p.waitForFunction(()=>__spTest);
await p.evaluate(async()=>{const m=await import('/mischief-fx.js');window.__ink=m.inkBomb(document.body,{seed:7,seconds:10,onClear:r=>window.__inkClear=r});});R.before=await p.evaluate(()=>__ink.coverage());await sleep(200);
const cell=await p.locator('[data-ink-cell]').evaluateAll(es=>{const e=es.find(e=>getComputedStyle(e).pointerEvents!=='none');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
await p.mouse.move(cell.x,cell.y);await p.mouse.down();for(let y=15,row=0;y<390;y+=35,row++){await p.mouse.move(row%2?825:15,y,{steps:3});await p.mouse.move(row%2?15:825,y,{steps:14});if(await p.evaluate(()=>!!window.__inkClear))break;}await p.mouse.up();await sleep(450);R.after=await p.evaluate(()=>({coverage:__ink.coverage(),clear:window.__inkClear,exists:!!document.querySelector('.mfx-ink')}));await p.screenshot({path:OUT+'/shots/ink-continuous-wiped.png'});console.log(JSON.stringify(R,null,2));await b.browser.close();}
main().catch(e=>R.fatal=String(e.stack||e)).finally(async()=>{fs.writeFileSync(OUT+'/data/ink-sweep.json',JSON.stringify(R,null,2));await runCleanups();process.exit(R.fatal?1:0)});
