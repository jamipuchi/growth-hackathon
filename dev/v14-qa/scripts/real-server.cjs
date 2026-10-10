// QA-only boot wrapper. Uses the game's credential loader; never reads or logs credentials here.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const ROOT='/private/tmp/claude-501/v14-qa';
const OUT='/Users/jaumepuig/Documents/growth-hackathon/dev/v14-qa';
process.env.PORT='8422';process.env.HTTPS_PORT='0';process.env.ASTRA_MOCK='0';
process.env.PERF_LOG=path.join(OUT,'logs/real-perf.log');
process.env.ASTRA_HTML_CALL_LOG=path.join(OUT,'logs/real-html-calls.jsonl');
const prior=fs.existsSync(path.join(OUT,'data/real-call-count.json'))?JSON.parse(fs.readFileSync(path.join(OUT,'data/real-call-count.json'),'utf8')):{calls:0,timings:[]};const f=globalThis.fetch;let calls=prior.calls;const timings=prior.timings;
globalThis.fetch=async function(url,...rest){
 if(String(url).startsWith('https://api.openai.com/')){
  if(calls>=10)throw Error('QA hard cap reached: ten outbound generation requests');
  const call=++calls;const t=Date.now();fs.writeFileSync(path.join(OUT,'data/real-call-count.json'),JSON.stringify({calls,timings}));
  try{const r=await f(url,...rest);timings.push({call,ms:Date.now()-t,status:r.status});fs.writeFileSync(path.join(OUT,'data/real-call-count.json'),JSON.stringify({calls,timings}));return r;}
  catch(e){timings.push({call,ms:Date.now()-t,failed:true});fs.writeFileSync(path.join(OUT,'data/real-call-count.json'),JSON.stringify({calls,timings}));throw e;}
 }
 return f(url,...rest);
};
require(path.join(ROOT,'astra.js'))._internals.setDir(path.join(OUT,'data/real-drawings'));
const parent=process.ppid;setInterval(()=>{if(process.ppid!==parent)process.exit(0);},1000).unref();
require(path.join(ROOT,'server.js'));
