// Deterministic failure injection. No real key, no network, no game file edits.
const fs=require('node:fs');
const ROOT='/private/tmp/claude-501/v14-test',OUT='/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test';
process.env.OPENAI_API_KEY='qa-offline-placeholder';
delete process.env.ASTRA_MOCK;
const A=require(ROOT+'/astra.js');
A._internals.setDir(OUT+'/data/fallback-drawings');
let calls=0;
A._internals.setFetch(async()=>{calls++;return {ok:false,status:503,text:async()=> 'QA injected upstream outage'};});
const image='data:image/png;base64,'+fs.readFileSync(ROOT+'/dev/gen-corpus/entity/E01.png').toString('base64');
(async()=>{
 const result=await A.generate({player:'outage',kind:'ship',source:'draw',image,speculative:false});
 const report={at:new Date().toISOString(),injection:'All model requests return 503 locally; no outbound request',fakeCalls:calls,result:{ok:result.ok,source:result.entity?.source,verbs:result.entity?.verbs,unlocked:result.entity?.unlocked,card:result.entity?.card}};
 fs.writeFileSync(OUT+'/data/fallback.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
