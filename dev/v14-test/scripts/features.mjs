import fs from 'node:fs';
import path from 'node:path';
import {startServer,launchPhoneBrowser,launchBig,sleep,post,hook,installSignalHandlers,runCleanups} from './lib.mjs';
const OUT='/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test';
const R={at:new Date().toISOString(),checks:[],shots:[],errors:[]};
installSignalHandlers();
const check=(name,ok,detail)=>{R.checks.push({name,ok,detail});console.log(ok?'PASS':'FAIL',name,JSON.stringify(detail));save();};
const save=()=>fs.writeFileSync(path.join(OUT,'data/features.json'),JSON.stringify(R,null,2));
async function shot(p,n){await p.screenshot({path:path.join(OUT,'shots/'+n+'.png')});R.shots.push(n+'.png');save();}
async function ready(p,base,name){await p.goto(base+'/controller.html');await p.waitForFunction(()=>window.__spTest);p.on('pageerror',e=>R.errors.push(e.message));await p.fill('#name',name);await p.locator('#joinForm button').tap();await p.waitForFunction(()=>window.__sp.screen==='draw');}
const padState=()=>{const c=document.getElementById('drawPad'),r=c.getBoundingClientRect(),a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let pixels=0,sx=0,sy=0;for(let y=0;y<c.height;y+=3)for(let x=0;x<c.width;x+=3)if(a[(y*c.width+x)*4+3]>0){pixels++;sx+=x/c.width;sy+=y/c.height;}return {viewport:[innerWidth,innerHeight],box:{x:r.x,y:r.y,w:r.width,h:r.height},ratio:r.width*r.height/(innerWidth*innerHeight),pixels,centroid:pixels?[sx/pixels,sy/pixels]:null};};
async function main(){
 const s=await startServer({port:8456,bots:0,env:{ASTRA_MOCK:'1',V11_DRAWINGS_DIR:OUT+'/data/features-drawings',PERF_LOG:OUT+'/logs/features-perf.log'},logFile:OUT+'/logs/features-server.log'});
 const b=await launchPhoneBrowser();const {page:p,context}=await b.newPhone();
 await p.goto(s.base+'/controller.html');await p.waitForFunction(()=>window.__spTest);await sleep(900);
 R.iphone=await p.evaluate(()=>({fs:__spTest.fullscreen(),hint:document.querySelector('.pe-inst')?.textContent,visible:document.querySelector('.pe-inst')?.classList.contains('pe-on')}));
 check('iPhone Add to Home Screen hint',R.iphone.visible&&/Add to Home Screen/.test(R.iphone.hint),R.iphone);await shot(p,'iphone-install-hint');
 await ready(p,s.base,'drawer');await p.locator('#modeDraw').tap();
 const box=await p.locator('#drawPad').boundingBox();await p.mouse.move(box.x+box.width*.3,box.y+box.height*.35);await p.mouse.down();await p.mouse.move(box.x+box.width*.7,box.y+box.height*.65,{steps:12});await p.mouse.up();await sleep(200);
 R.canvasLandscape=await p.evaluate(padState);await shot(p,'canvas-landscape');
 await p.setViewportSize({width:390,height:844});await sleep(600);R.canvasPortrait=await p.evaluate(padState);await shot(p,'canvas-portrait');
 check('drawing canvas >=90% viewport both orientations',R.canvasLandscape.ratio>=.90&&R.canvasPortrait.ratio>=.90,{landscape:R.canvasLandscape,portrait:R.canvasPortrait});
 check('strokes retained on rotation',R.canvasPortrait.pixels>0&&Math.abs(R.canvasLandscape.centroid[0]-R.canvasPortrait.centroid[0])<.025&&Math.abs(R.canvasLandscape.centroid[1]-R.canvasPortrait.centroid[1])<.025,{before:R.canvasLandscape.centroid,after:R.canvasPortrait.centroid});
 await p.setViewportSize({width:844,height:390});
 const {page:play}=await b.newPhone();await ready(play,s.base,'waiter');await play.locator('#useDefault').tap();await play.waitForFunction(()=>window.__sp.game);
 const tc=await b.browser.newContext({viewport:{width:1440,height:900}});const tv=await tc.newPage();await tv.goto(s.base+'/space.html');await tv.waitForFunction(()=>window.__game);await sleep(500);await shot(tv,'tv-1440-lobby');
 const digits=async page=>page.evaluate(()=>({screen:window.__sp?.screen,phase:window.__sp?.phase,digits:[...document.querySelectorAll('.pe-cd.pe-on .pe-cd-n,#sting.on #stingBig')].map(e=>e.textContent)}));
 await tv.locator('#startBtn').click();R.countdown=[];
 for(let i=0;i<7;i++){await sleep(420);R.countdown.push({at:Date.now(),drawing:await digits(p),playing:await digits(play),tv:await digits(tv),server:(await hook.state(s.base)).phase});if(i===1){await shot(p,'phone-drawing-during-countdown');await shot(play,'phone-play-countdown');await shot(tv,'tv-countdown');}}
 check('phone in Play receives server countdown',R.countdown.some(x=>x.playing.digits.some(d=>/[123]/.test(d))),R.countdown);
 check('phone still drawing receives server countdown',R.countdown.some(x=>x.drawing.digits.some(d=>/[123]/.test(d))),R.countdown);
 await shot(tv,'tv-1440-play');await tv.setViewportSize({width:1920,height:1080});await sleep(800);await shot(tv,'tv-1920-play');
 await tv.evaluate(()=>__bigscreen.mock('play',{players:25,me:19,assists:true}));await sleep(600);R.scoreboard=await tv.evaluate(()=>({timer:document.getElementById('timer').textContent,rows:document.getElementById('rows').innerText,assist:document.getElementById('assist').innerText,followed:__bigscreen.followed()}));await shot(tv,'tv-followed-rank20-assists');check('top seven plus followed player',R.scoreboard.rows.split('\n').filter(x=>/^7$/.test(x)).length>0,R.scoreboard);await tv.evaluate(()=>__bigscreen.unmock());
 await play.evaluate(()=>window.__spTest.lateHint('dig','part',['shovel','drill']));await sleep(350);R.late=await play.evaluate(()=>({text:document.querySelector('.pe-late.pe-on')?.textContent,entity:window.__sp.entity}));check('DRAW X late hint shown',/DRAW A SHOVEL AND A DRILL/.test(R.late.text),R.late);await shot(play,'late-draw-hint');
 // Separate deterministic effect test through public production effect API, with genuine pointer events for wiping.
 await play.evaluate(async()=>{const m=await import('/mischief-fx.js');window.__ink=m.inkBomb(document.body,{seconds:10,seed:7,onClear:x=>window.__inkClear=x});});await sleep(250);R.inkStart=await play.evaluate(()=>__ink.coverage());await sleep(5000);R.ink5=await play.evaluate(()=>({coverage:__ink.coverage(),exists:!!document.querySelector('.mfx-ink'),opacity:getComputedStyle(document.querySelector('.mfx-ink')).opacity}));await shot(play,'ink-at-5s');await sleep(5200);R.inkEnd=await play.evaluate(()=>({exists:!!document.querySelector('.mfx-ink'),cleared:window.__inkClear}));check('ink persists at 5s and auto fades at 10s',R.ink5.exists&&R.ink5.opacity==='1'&&!R.inkEnd.exists,R.inkEnd);
 await play.evaluate(async()=>{const m=await import('/mischief-fx.js');window.__inkClear=null;window.__ink=m.inkBomb(document.body,{seconds:10,seed:7,onClear:x=>window.__inkClear=x});});
 for(let y=15;y<390;y+=28){await play.mouse.move(5,y);await play.mouse.down();await play.mouse.move(839,y,{steps:30});await play.mouse.up();}
 await sleep(450);R.wipe=await play.evaluate(()=>({exists:!!document.querySelector('.mfx-ink'),cleared:window.__inkClear,coverage:__ink.coverage()}));check('pointer wiping clears ink before safety timer',R.wipe.cleared?.wiped===true,R.wipe);await shot(play,'ink-wiped');
 const state=await hook.state(s.base);await hook.round(s.base,{maxSeconds:state.playT+1,scoreboardSeconds:30});await sleep(2300);await shot(tv,'tv-1920-results');await tv.setViewportSize({width:1440,height:900});await shot(tv,'tv-1440-results');
 R.resources=[];for(const url of ['/controller.webmanifest','/icons/icon-180.png','/icons/icon-192.png','/icons/icon-512.png','/icons/icon-maskable-512.png']){const x=await fetch(s.base+url);R.resources.push({url,status:x.status,type:x.headers.get('content-type')});}save();
 await b.browser.close();
 // Chromium fullscreen emulation runs only after WebKit has closed.
 const cb=await launchBig();await cb.context.close();
 for(const [device,ua,vp] of [['android','Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',{width:844,height:390}],['ipad','Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',{width:1024,height:768}]]){
  const c=await cb.browser.newContext({viewport:vp,hasTouch:true,isMobile:true,userAgent:ua});const q=await c.newPage();await q.goto(s.base+'/controller.html');await q.waitForFunction(()=>__spTest);const before=await q.evaluate(()=>__spTest.fullscreen());await q.locator('#fsBtn').click();await sleep(500);const after=await q.evaluate(()=>__spTest.fullscreen());check(device+' FULL SCREEN button',{...after}.active,{engine:'Chromium emulation, not hardware',before,after});await shot(q,device+'-fullscreen');await c.close();
 }
 await cb.browser.close();
}
main().catch(e=>{R.fatal=String(e.stack||e);console.log(R.fatal);}).finally(async()=>{save();await runCleanups();process.exit(R.fatal?1:0);});
