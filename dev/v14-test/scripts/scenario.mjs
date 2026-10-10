// Read-only frozen-v1.3 QA. All files written in the main repo's QA lane.
import fs from 'node:fs';
import path from 'node:path';
import {startServer,launchBig,launchPhoneBrowser,watchPage,post,sleep,hook,input,axis,Samples,killBoss,pressLand,landParty,waitForMode,installSignalHandlers,runCleanups,summariseConsole,standByRockChest,keepAlive} from '/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test/scripts/lib.mjs';
import {installSampler,resetSampler,readSampler,summarise} from '/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test/scripts/lib2.mjs';
const OUT='/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test';
const device=process.argv[2]||'tv';
const result={at:new Date().toISOString(),device,build:'a1bf42970488c7dcaab60963b99c3001e3d36ff8',windows:{},states:{},assets:[],shots:[]};
const log=(...x)=>console.log(new Date().toISOString(),device,...x);
installSignalHandlers(log);
let page,base;
const shot=async(name)=>{const f=`shots/${device}-${name}.png`;await page.screenshot({path:path.join(OUT,f),timeout:15000}); result.shots.push(f);save();};
const save=()=>fs.writeFileSync(path.join(OUT,`data/scenario-${device}.json`),JSON.stringify(result,null,2));
const sample=async(name,seconds=20)=>{await resetSampler(page);await sleep(seconds*1000);const raw=await readSampler(page);result.windows[name]=summarise(raw);result.windows[name].budgetViolations={calls:raw.calls.filter(n=>n>(device==='phone'?80:120)).length,triangles:device==='phone'?raw.tris.filter(n=>n>120000).length:null};fs.writeFileSync(path.join(OUT,`data/raw-${device}-${name}.json`),JSON.stringify(raw));log(name,JSON.stringify(result.windows[name]));await shot(name);save();};
async function main(){
 if(fs.existsSync('/Users/jaumepuig/Documents/growth-hackathon/dev/v12-client/.browser-lock')||fs.existsSync('/Users/jaumepuig/Documents/growth-hackathon/.orch/status/HOLD'))throw Error('shared browser lock or HOLD present');
 const server=await startServer({port:8457,bots:24,serverArgs:['--cap','900','--assists','800'],env:{ASTRA_MOCK:'1',PERF_LOG:path.join(OUT,`logs/live-${device}-perf.log`),V11_DRAWINGS_DIR:path.join(OUT,'data/mock-drawings')},logFile:path.join(OUT,`logs/server-${device}.log`),log});base=server.base;result.serverPid=server.pid;
 let browser;
 if(device==='tv'){const b=await launchBig();browser=b.browser;page=b.page;await post(base,'/join',{player:'nova',device:'qa-tv-nova-token'});}
 else{const b=await launchPhoneBrowser();browser=b.browser;page=(await b.newPhone()).page;}
 const sink=watchPage(page,device,log);
 page.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/assets/'))result.assets.push({path:new URL(r.url()).pathname,status:r.status()});});
 if(device==='phone'){
 await page.goto(base+'/controller.html?perf');await page.waitForFunction(()=>window.__spTest);await page.fill('#name','nova');await page.locator('#joinForm button').tap();await page.waitForFunction(()=>window.__sp.screen==='draw');await shot('first-draw');await page.locator('#useDefault').tap();await page.waitForFunction(()=>window.__sp.game);await page.evaluate(()=>window.__game=window.__sp.game);
 }
 for(const kind of ['ship','explorer']){const g=await post(base,'/generate',{player:'nova',kind,image:Samples.dataUrl(kind==='ship'?'ship':'astronaut',1),source:'draw',speculative:false,requestId:`qa-${device}-${kind}`});result.states['gen-'+kind]={status:g.status,ok:g.json?.ok,verbs:g.json?.entity?.verbs};}
 if(device==='tv'){await page.goto(base+'/space.html?perf');await page.waitForFunction(()=>window.__game);}
 await sleep(3500);await installSampler(page);result.states.lobby=await hook.state(base);await shot('lobby');
 if(device==='tv')await page.locator('#startBtn').click();else await post(base,'/start');await sleep(650);await shot('countdown');await sleep(2500);await shot('go');await sleep(2000);await shot('space-flight');
 const st=await hook.state(base),b=st.boss;let i=0;
 for(const name of Object.keys(st.players)){await hook.teleport(base,{player:name,near:{x:b.x,y:b.y,z:b.z},distance:b.radius+60+(i++%8)*5,face:{x:b.x,y:b.y,z:b.z},heal:true});}
 await hook.boss(base,{hp:b.maxHp});await input(base,'nova','shoot',true);await sleep(1200);await sample('boss',20);if(device==='phone'){await page.evaluate(()=>window.__game.setView('cockpit'));await sample('cockpit',8);await page.evaluate(()=>window.__game.setView('chase'));}await input(base,'nova','shoot',false);
 // Burst capture starts before the final hit; screenshots deliberately remain outside perf windows.
 result.states.beforeKill=await hook.state(base);
 const burst=(async()=>{for(let i=0;i<12;i++){await sleep(180);await shot('boss-kill-'+String(i).padStart(2,'0'));}})();
 await Promise.all([killBoss(base,'nova',{log}),burst]);await sleep(500);await shot('planet-reveal');await sleep(1800);
 await pressLand(base,'nova',{log});await sleep(750);await shot('landing-shot');await waitForMode(base,'nova','planet');await sleep(1800);
 if(device==='phone')await page.evaluate(()=>window.__spTest.go('play')); 
 // The 24 bot population lands through the same LAND action, with only travel skipped.
 await landParty(base,Object.keys((await hook.state(base)).players).filter(n=>n!=='nova'),{log});await sleep(4500);
 result.states.planet=await hook.state(base);await sample('planet',25);
 for(const [kind,verb] of [['buried','dig'],['rock','drill']]){
 const chest=await standByRockChest(base,'nova',{kind});result.states[verb+'Chest']=chest;
 if(chest){await input(base,'nova',verb,true);await sleep(700);await shot(verb);await sleep(2000);await input(base,'nova',verb,false);}
 }
 // Explicit message-injection coverage: rendering of each rare event, not proof of gameplay trigger rules.
 for(const kind of ['emp','inkbomb','tractor','mine','decoy']){
 await page.evaluate(k=>{const g=window.__game,I=g._internals,me=I.game.lastSnap.players.find(p=>p.name==='nova');I.handle({type:'fx',kind:k,mode:me.mode,pos:{x:me.x,y:me.y+1,z:me.z},color:0x7d42ff,size:k==='mine'?3:6});if(window.__spTest)window.__spTest.mischief({kind:k,seconds:5,from:'Rival',points:30,dir:0.5});if(window.__bigscreen)window.__bigscreen.feed(k==='emp'?"⚡ Rival scrambled nova's buttons":k==='inkbomb'?"🖋 Rival inked nova":k==='tractor'?"🧲 Rival pulled nova":k==='mine'?"nova hit Rival's mine! −30":"nova fell for Rival's decoy");},kind);
 await sleep(350);await shot('mischief-'+kind);await sleep(kind==='inkbomb'?10500:5200);
 }
 for(const [name,text] of [['steal','💰 Rival stole 750 points from nova!'],['wreck',"🔧 Rival wrecked nova's ship (+150)"]]){await page.evaluate(t=>{if(window.__bigscreen)window.__bigscreen.feed(t,true);else window.__spTest.announce(t,true);},text);await sleep(400);await shot(name);await sleep(4000);}
 const end=await hook.state(base);await hook.round(base,{maxSeconds:end.playT+1,scoreboardSeconds:30});await sleep(2300);await shot('results');result.states.results=await hook.state(base);
 result.console=summariseConsole([sink]);result.device=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,ua:navigator.userAgent,game:window.__game.perf()}));
 result.assets=[...new Map(result.assets.map(a=>[a.path,a])).values()];save();log('done',result.shots.length,'shots');await browser.close();
}
main().catch(e=>{result.fatal=String(e.stack||e);log('FAILED',result.fatal);save();}).finally(async()=>{await runCleanups();log('cleaned');process.exit(result.fatal?1:0);});
