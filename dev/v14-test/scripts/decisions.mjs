import fs from 'node:fs';
import {startServer,post,hook,sleep,openEvents,installSignalHandlers,runCleanups} from './lib.mjs';
const OUT='/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test';
const R={at:new Date().toISOString(),joins:[],ticks:[]};installSignalHandlers();
async function main(){
 const s=await startServer({port:8461,bots:24,env:{ASTRA_MOCK:'1',PERF_LOG:OUT+'/logs/decisions-perf.log'},logFile:OUT+'/logs/decisions-server.log'});
 for(let i=1;i<=26;i++){const r=await post(s.base,'/join',{player:'human'+i,device:'qa-device-'+String(i).padStart(16,'0')});R.joins.push({i,status:r.status,response:r.json});}
 R.capState=await hook.state(s.base);
 R.start=await post(s.base,'/start',{});
 const positions=x=>Object.fromEntries(Object.entries(x.players).map(([n,p])=>[n,{x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch}]));
 R.before=positions(await hook.state(s.base));
 const e=openEvents(s.base,m=>{if(m.type==='tick')R.ticks.push({phase:m.phase,countdown:m.countdown,left:m.left,bullets:m.bullets.length});});
 await post(s.base,'/input',{type:'axis',player:'human1',axis:'steer',x:1,y:1});await post(s.base,'/input',{type:'input',player:'human1',action:'forward',down:true});await sleep(1200);R.during=positions(await hook.state(s.base));await sleep(2200);e.close();
 R.countdownFrozen=JSON.stringify(R.before)===JSON.stringify(R.during);R.digits=[...new Set(R.ticks.filter(t=>t.phase==='countdown').map(t=>t.countdown))];
 R.beforeHints=(await hook.state(s.base)).players.human1;
 // Move the test clock threshold only; this exercises the real HTTP server's hint/skills transition without waiting 3 minutes.
 await hook.round(s.base,{assistsAt:1,maxSeconds:240});await sleep(7000);R.afterHints=(await hook.state(s.base)).players.human1;
 R.checks={cap25:R.joins[24].status===200&&R.joins[25].status===400&&Object.keys(R.capState.players).length===25,countdownFrozen:R.countdownFrozen,threeTwoOne:JSON.stringify(R.digits)==='[3,2,1]',noCountdownBullets:R.ticks.filter(t=>t.phase==='countdown').every(t=>t.bullets===0),noFreeSkills:JSON.stringify(R.beforeHints.verbs)===JSON.stringify(R.afterHints.verbs)};
 console.log(JSON.stringify({checks:R.checks,rejected:R.joins[25],digits:R.digits,before:R.beforeHints.verbs,after:R.afterHints.verbs},null,2));
}
main().catch(e=>{R.fatal=String(e.stack||e);console.log(R.fatal)}).finally(async()=>{fs.writeFileSync(OUT+'/data/decisions.json',JSON.stringify(R,null,2));await runCleanups();process.exit(R.fatal?1:0);});
