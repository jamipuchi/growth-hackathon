import fs from 'node:fs';import {spawn} from 'node:child_process';import path from 'node:path';
import {launchPhoneBrowser,sleep,watchPage,summariseConsole,runCleanups,installSignalHandlers} from '/private/tmp/claude-501/v14-qa/dev/v11-client/lib.mjs';
const OUT='/Users/jaumepuig/Documents/growth-hackathon/dev/v14-qa';
const report={at:new Date().toISOString(),checks:[],requests:[]};let child,page;
const save=()=>fs.writeFileSync(path.join(OUT,'data/real-generation.json'),JSON.stringify(report,null,2));
const shot=async(name)=>page.screenshot({path:path.join(OUT,'shots/real-'+name+'.png')});
installSignalHandlers();
async function stroke(points){const r=await page.locator('#drawPad').boundingBox();await page.mouse.move(r.x+points[0][0]*r.width,r.y+points[0][1]*r.height);await page.mouse.down();for(const p of points.slice(1))await page.mouse.move(r.x+p[0]*r.width,r.y+p[1]*r.height,{steps:3});await page.mouse.up();}
const glyph={F:[[[0,1],[0,0],[.65,0]],[[0,.45],[.5,.45]]],I:[[[.1,0],[.5,0]],[[.3,0],[.3,1]],[[.1,1],[.5,1]]],R:[[[0,1],[0,0],[.55,0],[.65,.15],[.65,.35],[.5,.5],[0,.5]],[[.35,.5],[.7,1]]],E:[[[.65,0],[0,0],[0,1],[.65,1]],[[0,.5],[.5,.5]]],L:[[[0,0],[0,1],[.65,1]]],A:[[[0,1],[.35,0],[.7,1]],[[.15,.6],[.55,.6]]],N:[[[0,1],[0,0],[.7,1],[.7,0]]],D:[[[0,1],[0,0],[.4,0],[.7,.25],[.7,.75],[.4,1],[0,1]]]};
async function word(s,x,y,w,h){for(let i=0;i<s.length;i++)for(const pts of glyph[s[i]])await stroke(pts.map(p=>[x+i*w+p[0]*w,y+p[1]*h]));}
async function submit(kind){const t=Date.now();await page.locator('#done').tap();await sleep(550);await shot(kind+'-waiting');await page.waitForFunction(()=>(window.__sp.step==='shipResult'||window.__sp.step==='controllerResult')||(!document.getElementById('gen').classList.contains('hidden')&&!document.getElementById('genActions').classList.contains('hidden'))||!document.getElementById('wrong').classList.contains('hidden'),null,{timeout:55000});const state=await page.evaluate(()=>({screen:window.__sp.screen,step:window.__sp.step,entity:window.__sp.entity,drawn:window.__sp.drawn,layout:window.__sp.layout,text:document.body.innerText}));report.checks.push({kind,afterDoneMs:Date.now()-t,state});await shot(kind+'-result');save();return state;}
async function main(){
 if(fs.existsSync('/Users/jaumepuig/Documents/growth-hackathon/dev/v12-client/.browser-lock'))throw Error('other browser job owns lock');
 child=spawn(process.execPath,[path.join(OUT,'scripts/real-server.cjs')],{cwd:'/private/tmp/claude-501/v14-qa',stdio:['ignore','pipe','pipe']});const stream=fs.createWriteStream(path.join(OUT,'logs/real-server.log'));child.stdout.pipe(stream);child.stderr.pipe(stream);report.serverPid=child.pid;
 for(let i=0;i<50;i++){try{const r=await fetch('http://127.0.0.1:8422/info');if(r.ok)break;}catch{}await sleep(100);}
 const b=await launchPhoneBrowser();page=(await b.newPhone()).page;const sink=watchPage(page,'real-phone');
 page.on('response',async(r)=>{if(new URL(r.url()).pathname==='/generate'){try{const q=r.request().postDataJSON(),a=await r.json();report.requests.push({kind:q.kind,speculative:q.speculative,status:r.status(),ok:a.ok,error:a.error,message:a.message,entity:a.entity,layout:a.layout,htmlSource:a.htmlSource});save();}catch{}}});
 await page.goto('http://127.0.0.1:8422/controller.html');await page.waitForFunction(()=>window.__spTest);await page.fill('#name','sketcher');await page.locator('#joinForm button').tap();await page.waitForFunction(()=>window.__sp.screen==='draw');await shot('ship-photo-start');await page.locator('#modeDraw').tap();
 // A simple first-timer rocket, wings, barrel, window, two feet, and flame. Ordinary pointer strokes, no sample hook.
 for(const pts of [ [[.47,.15],[.34,.65],[.59,.65],[.47,.15]],[[.37,.42],[.18,.71],[.34,.63]],[[.56,.43],[.75,.70],[.59,.63]],[[.445,.18],[.445,.05],[.49,.05],[.49,.18]],[[.4,.66],[.4,.79],[.33,.79]],[[.54,.66],[.54,.79],[.61,.79]],[[.43,.67],[.40,.93],[.47,.82],[.51,.94],[.51,.67]],[[.44,.35],[.50,.35],[.52,.43],[.49,.47],[.43,.43],[.44,.35]] ])await stroke(pts);
 await shot('ship-drawn');const ship=await submit('ship');
 if(ship.step!=='shipResult'){await page.evaluate(()=>window.__spTest.go('controller'));}else await page.locator('#resultNext').tap();await page.waitForFunction(()=>window.__sp.step==='controller');await page.locator('#modeDraw').tap();
 await stroke([[.15,.55],[.18,.39],[.28,.34],[.37,.42],[.4,.57],[.35,.76],[.22,.8],[.15,.55]]);
 await stroke([[.50,.28],[.90,.28],[.90,.50],[.50,.50],[.50,.28]]);await word('FIRE',.55,.32,.075,.13);
 await stroke([[.52,.63],[.91,.63],[.91,.87],[.52,.87],[.52,.63]]);await word('LAND',.55,.68,.075,.13);
 await shot('controller-drawn');await submit('controller');await sleep(7000);await shot('controller-final');await page.locator('#resultNext').tap();await page.waitForFunction(()=>window.__sp.screen==='play');await sleep(3000);report.mountedController=await page.evaluate(()=>window.__spTest.ctl());await shot('controller-live');
 report.console=summariseConsole([sink]);report.ended=new Date().toISOString();save();await b.browser.close();
}
main().catch(e=>{report.fatal=String(e.stack||e);save();console.log(report.fatal);}).finally(async()=>{await runCleanups();if(child){child.kill('SIGTERM');await sleep(300);if(child.exitCode===null)child.kill('SIGKILL');}save();console.log('done',report.checks.map(c=>({kind:c.kind,afterDoneMs:c.afterDoneMs,screen:c.state.screen})));process.exit(report.fatal?1:0);});
