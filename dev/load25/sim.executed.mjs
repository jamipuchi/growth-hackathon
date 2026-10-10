// One light process owns all 25 simulated phones, sequential browser probes, and its isolated server.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const OUT=path.dirname(new URL(import.meta.url).pathname), BUILD='/private/tmp/claude-501/load25-build',BASE='http://localhost:8810';
const PW=require('/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core');
const Contract=require(BUILD+'/contract.js'),{DEFAULT_LAYOUT}=require(BUILD+'/world.js');
const {createDriver}=await import(BUILD+'/dev/e2e/driver.mjs');
const strokes=JSON.parse(fs.readFileSync(path.resolve(OUT,'../v191-release/c-strokes.json'),'utf8')).E04.strokes;
const CACHE='/Users/jaumepuig/Library/Caches/ms-playwright';
const CHROME=CACHE+'/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const WEBKIT=CACHE+'/webkit-2311/pw_run.sh';
const started=Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const log=(event,data={})=>{const x={at:Date.now(),t:(Date.now()-started)/1000,event,...data};fs.appendFileSync(OUT+'/events.jsonl',JSON.stringify(x)+'\n');console.log(JSON.stringify(x))};
const R={started,players:[],requests:{},inputLatency:[],errors:[],phases:[],browser:[],ps:[],kicks:[],hall:[]};
const names=Array.from({length:25},(_,i)=>'load'+String(i+1).padStart(2,'0'));
const token=n=>'load25device000000'+n;
const agent=new http.Agent({keepAlive:true,maxSockets:100});
const streams=[],timers=[];let server,browser,stopping=false,phase=null,playingAt=null,endedAt=null,world=null,lastTick=null;
function save(){fs.writeFileSync(OUT+'/results.json',JSON.stringify({...R,players:R.players.map(({driver,world,tick,axes,busy,...p})=>({...p,stages:driver?.D.stages||p.stages,driverIssues:driver?.D.issues||p.driverIssues})),endedAt,playingAt,finished:Date.now()},null,2))}
async function req(route,body){
  const at=performance.now(),data=body===undefined?null:JSON.stringify(body);R.requests[route]=(R.requests[route]||0)+1;
  return new Promise(resolve=>{const q=http.request(BASE+route,{agent,method:data?'POST':'GET',headers:data?{'content-type':'application/json','content-length':Buffer.byteLength(data)}:{}},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>{let json;try{json=JSON.parse(s)}catch{}const ms=performance.now()-at;if(route==='/input')R.inputLatency.push({at:Date.now(),ms,status:res.statusCode,phase});if(res.statusCode>=400)R.errors.push({route,status:res.statusCode,json});resolve({status:res.statusCode,json,ms})})});q.setTimeout(20000,()=>q.destroy(Error('timeout')));q.on('error',e=>{R.errors.push({route,error:e.message});resolve({status:0,json:null,ms:performance.now()-at})});q.end(data)});
}
function openStream(p){const q=http.get(BASE+'/events?player='+p.name,{agent:false},res=>{let buf='';res.on('data',c=>{p.bytes+=c.length;const live=['playing','assists'].includes(phase);if(live)p.playBytes+=c.length;buf+=c;let ix;while((ix=buf.indexOf('\n\n'))>=0){const part=buf.slice(0,ix);buf=buf.slice(ix+2);for(const line of part.split('\n'))if(line.startsWith('data: ')){let m;try{m=JSON.parse(line.slice(6))}catch{continue}p.messages++;if(live)p.playMessages++;
    if(m.type==='world'){p.world=m;if(p.name===names[0])world=m;}
    if(m.type==='entity'&&m.player===p.name){p.entity=m.entity;p.entities.push({at:Date.now(),source:m.entity.source,specSource:m.entity.spec?.source,hasSpec:!!m.entity.spec,failed:m.entity.failed});}
    if(m.type==='kicked'){R.kicks.push({player:p.name,m});}
    if(m.type==='tick'){p.ticks++;if(live)p.playTicks++;p.tick=m;p.me=m.players?.find(x=>x.name===p.name);if(p.name===names[0]){lastTick=m;if(m.phase!==phase){phase=m.phase;R.phases.push({at:Date.now(),phase,players:m.players?.length,waiting:m.waiting?.length});log('phase',R.phases.at(-1));if(['playing','assists'].includes(phase)&&!playingAt)playingAt=Date.now();if(phase==='scoreboard'&&!endedAt)endedAt=Date.now();}}
      if(p.me?.mode==='planet'&&!p.landedAt){p.landedAt=Date.now();log('landed',{player:p.name});req('/default',{player:p.name,device:token(p.name),kind:'explorer'}).then(r=>{p.explorer=r;p.explorerAt=Date.now()});}}
    p.driver.onMessage(m);
  }}})});q.on('error',e=>R.errors.push({stream:p.name,error:e.message}));streams.push(q)}
async function cleanup(){if(stopping)return;stopping=true;for(const t of timers)clearInterval(t);for(const q of streams)q.destroy();agent.destroy();try{await browser?.close()}catch{}if(server){server.kill('SIGTERM');await sleep(350);if(server.exitCode===null)server.kill('SIGKILL')}save();log('cleanup',{serverPid:server?.pid});}
process.on('SIGTERM',()=>cleanup().then(()=>process.exit(0)));process.on('SIGINT',()=>cleanup().then(()=>process.exit(0)));
timers.push(setTimeout(()=>{log('hard-stop');cleanup().then(()=>process.exit(2))},11*60*1000));
async function launch(kind){const b=await PW[kind].launch({executablePath:kind==='chromium'?CHROME:WEBKIT,headless:true,args:kind==='chromium'?['--use-angle=metal','--ignore-gpu-blocklist','--enable-gpu','--autoplay-policy=no-user-gesture-required']:[]});browser=b;log('browser-open',{kind});return b}
async function guardContext(ctx){await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(['http:','https:'].includes(u.protocol)&&!(u.hostname==='localhost'&&+u.port===8810)&&!['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return r.abort();return r.continue()});}
function observe(page,label){page.on('pageerror',e=>R.browser.push({at:Date.now(),label,error:e.message}));page.on('console',m=>{if(m.type()==='error')R.browser.push({at:Date.now(),label,console:m.text().slice(0,240)})});page.on('request',q=>{if(q.url().endsWith('/perf')){try{R.browser.push({at:Date.now(),label,perf:JSON.parse(q.postData()),players:lastTick?.players?.length,ships:lastTick?.players?.filter(p=>p.mode==='space').length})}catch{}}});}
async function phoneProbe(n){const ctx=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'});await guardContext(ctx);const info=await req('/info');await ctx.addInitScript(({n,device,layout,session})=>{for(const [k,v]of Object.entries({player:n,device,layout,session,round:1,shipDone:true,coachSeen:true,a2hsSeen:true,muted:true}))localStorage.setItem('sp.'+k,JSON.stringify(v))},{n,device:token(n),layout:DEFAULT_LAYOUT,session:info.json.session});const p=await ctx.newPage();observe(p,n);await p.goto(BASE+'/controller.html?perf',{waitUntil:'domcontentloaded'});await sleep(13000);R.browser.push({at:Date.now(),label:n,state:await p.evaluate(()=>({screen:window.__sp?.screen,step:window.__sp?.step,player:window.__sp?.player,mode:window.__sp?.lastMode,perf:window.__sp?.game?.perf?.sample?.()})),players:lastTick?.players?.length,ships:lastTick?.players?.filter(p=>p.mode==='space').length});await p.screenshot({path:OUT+'/'+n+'.png'});await ctx.close();log('phone-probe-done',{player:n});}
async function tvPage(){const ctx=await browser.newContext({viewport:{width:1920,height:1080}});await guardContext(ctx);const p=await ctx.newPage();observe(p,'TV');await p.goto(BASE+'/space.html?perf',{waitUntil:'domcontentloaded'});return p}
try{
  const env={...process.env,PORT:'8810',HTTPS_PORT:'8811',ASTRA_HEDGE_MS:'60000',ASTRA_SPEC_HEDGE_MS:'60000',HALL_DIR:OUT+'/hall',PERF_LOG:OUT+'/perf.jsonl',PUBLIC_URL:'',PUBLIC_URL_FILE:'',MAGIC_DOMAIN:'',KEEPALIVE:'1'};
  for(const k of ['NODE_OPTIONS','ASTRA_MOCK','HALL_MOCK','OPENAI_API_KEY'])delete env[k];
  const fd=fs.openSync(OUT+'/server.log','w');server=spawn(process.execPath,['--require',OUT+'/preload.cjs','server.js','--bots','0'],{cwd:BUILD,env,stdio:['ignore',fd,fd]});fs.writeFileSync(OUT+'/server.pid',String(server.pid));log('server-start',{pid:server.pid});
  timers.push(setInterval(()=>execFile('ps',['-p',String(server.pid),'-o','pid=,%cpu=,rss='],{timeout:1000},(e,s)=>{if(!e){const [pid,cpu,rssKiB]=s.trim().split(/\s+/).map(Number);const v={at:Date.now(),pid,cpu,rssKiB,phase};R.ps.push(v);fs.appendFileSync(OUT+'/ps.jsonl',JSON.stringify(v)+'\n')}}),2000));
  await sleep(1200);const health=await req('/info');if(health.status!==200)throw Error('isolated server did not start');R.info=health.json;
  await launch('chromium');const canvasPage=await browser.newPage();
  const images=await canvasPage.evaluate(({strokes})=>Array.from({length:25},(_,i)=>{const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,512,512);x.strokeStyle='#111';x.lineWidth=6;x.lineCap=x.lineJoin='round';for(const s of strokes){x.beginPath();s.forEach(([a,b],j)=>j?x.lineTo(a*490+10+(i%5)*.3,b*490+10):x.moveTo(a*490+10+(i%5)*.3,b*490+10));x.stroke()}x.fillStyle='#111';x.font='18px sans-serif';x.fillText('L'+String(i+1),20,485);return c.toDataURL('image/png')}),{strokes});await canvasPage.close();await browser.close();browser=null;
  for(const name of names){const p={name,bytes:0,playBytes:0,messages:0,playMessages:0,ticks:0,playTicks:0,entities:[],axes:{},busy:{},joinedAt:Date.now()};
    p.buttons={};p.driver=createDriver({me:name,route:'expert',Contract,post:(url,body)=>{if(url!='/input'){R.errors.push({blockedDriver:url});return Promise.resolve({status:599,json:{}})}const final={};for(const m of (Array.isArray(body)?body:[body])){if(m.type==='axis')p.axes[m.axis]={...m,device:token(name)};else final[m.action]=m;}for(const m of Object.values(final)){if(p.buttons[m.action]===m.down)continue;p.buttons[m.action]=m.down;req('/input',{...m,device:token(name)})}return Promise.resolve({status:204,json:null})},onStage:s=>{if(['digging','drilling','bossDead'].includes(s))log('stage',{player:name,stage:s})}});
    for(const g of ['ship','controller','explorer','shoot','boost','dig','drill','flare','scan','shield'])p.driver.D.gates[g]={state:'done'};
    p.join=await req('/join',{player:name,device:token(name)});R.players.push(p);openStream(p);
  }
  R.full=await req('/join',{player:'overflow26',device:'overflow26device0000'});log('26th-join',R.full);
  timers.push(setInterval(()=>{if(!['playing','assists'].includes(phase))return;for(const p of R.players)for(const [axis,m]of Object.entries(p.axes)){if(p.busy[axis])continue;p.busy[axis]=true;req('/input',m).finally(()=>p.busy[axis]=false)}},55));
  R.burstAt=Date.now();log('generation-burst',{players:25});
  R.uniqueDrawings=5; // Recovery run: the original 25-way real generation burst used 50 of the global 60-call cap.
  await Promise.all(R.players.map(async(p,i)=>{p.generateStarted=Date.now();p.gen=await req('/generate',{player:p.name,device:token(p.name),kind:'ship',image:images[i%5],source:'draw',speculative:false,requestId:'load25-'+p.name});p.generateEnded=Date.now();p.default=await req('/default',{player:p.name,device:token(p.name),kind:'controller'});await req('/input',{type:'input',player:p.name,device:token(p.name),action:'ready',down:true});p.readyAt=Date.now();log('ready',{player:p.name,ms:p.readyAt-p.joinedAt,generationMs:p.gen.ms,ok:p.gen.json?.ok,free:p.gen.json?.free,source:p.gen.json?.entity?.source});}));
  await launch('chromium');const earlyTv=await tvPage();while(!playingAt||Date.now()-playingAt<10000)await sleep(500);await earlyTv.screenshot({path:OUT+'/tv-25-ships.png'});await browser.close();browser=null;
  // Three actual WebKit phone pages use three of the 25 identities, sequentially in one browser.
  await launch('webkit');for(const n of names.slice(0,3))await phoneProbe(n);await browser.close();browser=null;
  await launch('chromium');const tv=await tvPage();
  while(!endedAt&&Date.now()-started<300000){await sleep(2000);if(playingAt&&!R.tvShot&&Date.now()-playingAt>30000){await tv.screenshot({path:OUT+'/tv-playing.png'});R.tvShot=true}save();}
  log('round-ended',{endedAt,playingMs:endedAt-playingAt});
  for(let i=0;i<85;i++){const h=await req('/hall');const v={at:Date.now(),count:h.json?.entries?.length,scored:h.json?.entries?.filter(e=>e.judge==='done').length,judging:h.json?.judging};R.hall.push(v);if(i%5===0)log('hall',v);if(v.count>=25&&v.scored>=25){R.hallAllAt=Date.now();R.hallFinal=h.json;break}await sleep(1500);}
  await sleep(1000);R.hallVisible=await tv.evaluate(()=>({frames:[...document.querySelectorAll('iframe')].map(f=>({src:f.src,text:f.contentDocument?.body?.innerText?.slice(0,1500),items:f.contentDocument?.querySelectorAll('img').length})),text:document.body.innerText.slice(-2000)}));await tv.screenshot({path:OUT+'/hall-tv.png'});log('finished',{scored:R.hall.at(-1)?.scored,landed:R.players.filter(p=>p.landedAt).length});
}catch(e){R.fatal=e.stack;log('fatal',{message:e.message})}finally{for(const p of R.players){p.stages=p.driver.D.stages;p.driverIssues=p.driver.D.issues;delete p.driver;delete p.world;delete p.tick;delete p.axes;delete p.busy;}await cleanup();}
