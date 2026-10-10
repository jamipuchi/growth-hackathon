import fs from 'node:fs';
import path from 'node:path';
import {startServer, launchPhoneBrowser, sleep, post, runCleanups, installSignalHandlers} from '/private/tmp/claude-501/v14-qa/dev/v11-client/lib.mjs';
const OUT='/Users/jaumepuig/Documents/growth-hackathon/dev/v14-qa';
const report={at:new Date().toISOString(),mockOnly:true,description:'Recorded real timeout entity replay; deterministic 1.2-second model HTML delivery, template geometry unchanged.'};
installSignalHandlers();
async function main(){
 const server=await startServer({port:8424,bots:0,script:path.join(OUT,'scripts/pad-repro-server.cjs'),env:{ASTRA_MOCK:'1',V11_DRAWINGS_DIR:path.join(OUT,'data/pad-repro-drawings'),PERF_LOG:path.join(OUT,'logs/pad-repro-perf.log')},logFile:path.join(OUT,'logs/pad-repro-server.log')});
 const b=await launchPhoneBrowser(); const {page}=await b.newPhone();
 report.requests=[];page.on('request',r=>{if(['/controller-html','/events'].includes(new URL(r.url()).pathname))report.requests.push({at:Date.now(),url:new URL(r.url()).pathname});});
 await page.goto(server.base+'/controller.html');await page.waitForFunction(()=>window.__spTest);await page.fill('#name','replay');await page.locator('#joinForm button').tap();await page.waitForFunction(()=>window.__sp.screen==='draw');await page.locator('#modeDraw').tap();
 const box=await page.locator('#drawPad').boundingBox();
 for(const pts of [ [[.47,.15],[.34,.65],[.59,.65],[.47,.15]],[[.37,.42],[.18,.71],[.34,.63]],[[.56,.43],[.75,.70],[.59,.63]],[[.445,.18],[.445,.05],[.49,.05],[.49,.18]],[[.4,.66],[.4,.79],[.33,.79]],[[.54,.66],[.54,.79],[.61,.79]],[[.43,.67],[.40,.93],[.47,.82],[.51,.94],[.51,.67]],[[.44,.35],[.50,.35],[.52,.43],[.49,.47],[.43,.43],[.44,.35]] ]){
  await page.mouse.move(box.x+pts[0][0]*box.width,box.y+pts[0][1]*box.height);await page.mouse.down();for(const p of pts.slice(1))await page.mouse.move(box.x+p[0]*box.width,box.y+p[1]*box.height,{steps:3});await page.mouse.up();
 }
 await page.locator('#done').tap();await page.waitForFunction(()=>window.__sp.step==='shipResult');await sleep(800);await page.screenshot({path:path.join(OUT,'shots/replay-real-timeout-card.png')});
 report.shipCard=await page.evaluate(()=>({drawn:window.__sp.drawn.ship,text:document.getElementById('result').innerText}));
 await page.locator('#resultNext').tap();await page.waitForFunction(()=>window.__sp.step==='controller');await page.evaluate(()=>window.__spTest.drawSample('controller'));await page.locator('#done').tap();await page.waitForFunction(()=>window.__sp.step==='controllerResult');await sleep(2500);
 const {json:serverPad}=await post(server.base,'/controller-html',{player:'replay'});report.serverPad={source:serverPad.htmlSource,pending:serverPad.pending};report.beforePlay=await page.evaluate(()=>({hasGame:!!window.__sp.game,padSource:window.__sp.pad?.source}));
 await page.locator('#resultNext').tap();await page.waitForFunction(()=>window.__sp.screen==='play');await sleep(3500);report.afterPlay=await page.evaluate(()=>window.__spTest.ctl());await page.screenshot({path:path.join(OUT,'shots/pad-missed-model-event.png')});
 await b.browser.close();
}
main().catch(e=>{report.fatal=String(e.stack||e);}).finally(async()=>{fs.writeFileSync(path.join(OUT,'data/pad-repro.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({serverPad:report.serverPad,beforePlay:report.beforePlay,afterPlay:report.afterPlay,fatal:report.fatal}));await runCleanups();process.exit(report.fatal?1:0);});
