// Instrumentation only. No game module is modified. Hard external-call and local-port guards.
const fs = require('fs'), http = require('http'), net = require('net');
const OUT = '/Users/jaumepuig/Documents/growth-hackathon/dev/load25';
const log = (file, data) => fs.appendFileSync(`${OUT}/${file}.jsonl`, JSON.stringify({at:Date.now(),...data})+'\n');
const counts={responses:0,decisions:0}, caps={responses:60,decisions:80};
try {for(const line of fs.readFileSync(OUT+'/api-start.jsonl','utf8').trim().split('\n')){const r=JSON.parse(line);if(r.kind in counts)counts[r.kind]++;}}catch{}
const nativeFetch=globalThis.fetch;
globalThis.fetch=async function(url, opts={}) {
  const u=new URL(typeof url==='string'?url:url.url);
  if (['localhost','127.0.0.1','::1'].includes(u.hostname) && !(+u.port>=8810&&+u.port<=8819)) throw Error('load25 local port guard');
  const kind=u.hostname==='api.openai.com'?u.pathname.split('/').pop():null;
  if (!(kind in caps)) return nativeFetch.apply(this,arguments);
  if(counts[kind]>=caps[kind]) {log('api',{kind,blocked:true});throw Error('load25 API cap');}
  const n=++counts[kind], started=Date.now(); let body={};try{body=JSON.parse(opts.body)}catch{}
  const base={kind,n,model:body.model,schema:body.text?.format?.name||body.response_format?.json_schema?.name||null,started};
  log('api-start',base);
  try {const r=await nativeFetch.apply(this,arguments);const s=await r.clone().text();log('api',{...base,ms:Date.now()-started,status:r.status,bytes:Buffer.byteLength(s),rateLimit:r.status===429,timeout:false});return r;}
  catch(e){log('api',{...base,ms:Date.now()-started,error:e.name,timeout:/abort|timeout/i.test(e.name+' '+e.message)});throw e;}
};
const listen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){const p=typeof args[0]==='object'?args[0].port:args[0];if(!(Number(p)>=8810&&Number(p)<=8819))throw Error('load25 listen port guard');return listen.apply(this,args)};
const traffic={requests:0,requestBodyBytes:0,responseBodyBytes:0,routes:{},sse:{}};
const create=http.createServer;
http.createServer=function(fn){return create.call(this,(req,res)=>{
  const u=new URL(req.url,'http://localhost:8810'),route=u.pathname;
  traffic.requests++;traffic.routes[route]=(traffic.routes[route]||0)+1;
  // Never consume GET request bodies: doing so fires IncomingMessage.close before the SSE response ends.
  if(req.method==='POST')req.on('data',b=>traffic.requestBodyBytes+=b.length);
  const player=route==='/events'?(u.searchParams.get('player')||'TV'):null;
  const count=b=>{if(!b)return;const n=Buffer.byteLength(b);traffic.responseBodyBytes+=n;if(player)traffic.sse[player]=(traffic.sse[player]||0)+n;};
  const w=res.write,e=res.end;res.write=function(b,...a){count(b);return w.call(this,b,...a)};res.end=function(b,...a){count(b);return e.call(this,b,...a)};
  return fn(req,res);
})};
let prev=performance.now(),lag=[];
setInterval(()=>{const n=performance.now();lag.push(Math.max(0,n-prev-100));prev=n;},100).unref();
setInterval(()=>{log('monitor',{lagMs:lag,traffic});lag=[]},2000).unref();
