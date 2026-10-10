const fs=require('node:fs');
const OUT='/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test';
const prior=JSON.parse(fs.readFileSync('/Users/jaumepuig/Documents/growth-hackathon/dev/v14-qa/data/real-generation.json','utf8'));
const layout=prior.requests.find(r=>r.kind==='controller').layout;
const recognised={...layout,buttons:layout.buttons.filter(b=>!b.auto)};
const current=require('/private/tmp/claude-501/v14-test/world.js').withSteer(recognised);
const r={at:new Date().toISOString(),method:'Replay prior recognised controls into v1.4 withSteer; no fresh vision call',recognised,priorAutomatic:layout.buttons.filter(b=>b.auto),currentAutomatic:current.buttons.filter(b=>b.auto)};
r.identical=JSON.stringify(r.priorAutomatic)===JSON.stringify(r.currentAutomatic);
fs.writeFileSync(OUT+'/data/steering-replay.json',JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));
