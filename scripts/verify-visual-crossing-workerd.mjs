import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Real SQLite-backed DO and real workerd; every outbound request is intercepted.
const fixture=JSON.parse(fs.readFileSync('scripts/fixtures/visual-crossing-tokyo-stats.json','utf8'));
const entry=`
import { VisualCrossingClimate as RealClimate } from './src/lib/weather/visual-crossing-do';
export class VisualCrossingClimate extends RealClimate {
 constructor(ctx,env) {super(ctx,env);this.storage=ctx.storage;}
 async fetch(request) {
  if(new URL(request.url).pathname==='/state') return Response.json(await this.storage.get('state')??null);
  if(new URL(request.url).pathname==='/exhaust') {const state=await this.storage.get('state');state.charges[0].records=900;state.cache={};await this.storage.put('state',state);return Response.json(null);}
  return super.fetch(request);
 }
}
export default {async fetch(request,env) {
 const input=await request.json();
 return env.VISUAL_CROSSING_CLIMATE.get(env.VISUAL_CROSSING_CLIMATE.idFromName('global-v1')).fetch(new Request('https://internal',{
  method:'POST',body:JSON.stringify({input,deadline:Date.now()+12000})
 }));
}};`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser'});
let calls=0,active=0,maxActive=0;
const mf=new Miniflare(convertV4MiniflareOptions({
 modules:true,compatibilityDate:'2025-09-24',script:bundle.outputFiles[0].text,
 bindings:{VISUAL_CROSSING_API_KEY:'synthetic-not-a-real-secret'},
 durableObjects:{VISUAL_CROSSING_CLIMATE:{className:'VisualCrossingClimate',useSQLite:true}},
 outboundService:async request=>{
  calls++;active++;maxActive=Math.max(maxActive,active);
  const url=new URL(request.url);
  assert.equal(url.hostname,'weather.visualcrossing.com');
  assert.equal(url.searchParams.get('key'),'synthetic-not-a-real-secret');
  assert.equal(url.searchParams.get('include'),'stats');
  await new Promise(r=>setTimeout(r,15)); active--;
  return Response.json(fixture);
 },
}));
try {
 const input={destination:'東京都',lat:35.6762,lng:139.6503,timezone:'Asia/Tokyo',startDate:'2026-11-25',endDate:'2026-11-30'};
 const invoke=async value=>(await mf.dispatchFetch('https://test',{method:'POST',body:JSON.stringify(value)})).json();
 const results=await Promise.all(Array.from({length:8},()=>invoke(input)));
 const ns=await mf.getDurableObjectNamespace('VISUAL_CROSSING_CLIMATE');
 const stub=ns.get(ns.idFromName('global-v1'));
 assert.ok(results.every(r=>r && Math.round(r.low)===9 && Math.round(r.high)===14));
 assert.equal(calls,1);assert.equal(maxActive,1);
 const state=await (await stub.fetch('https://internal/state')).json();
 assert.equal(state.charges.reduce((sum,c)=>sum+c.records,0),6);
 assert.equal(Object.keys(state.cache).length,1);
 assert.ok(!JSON.stringify(state).includes('synthetic-not-a-real-secret'));
 await invoke(input);assert.equal(calls,1);
 await stub.fetch('https://internal/exhaust');
 assert.equal(await invoke({...input,destination:'budget-denied'}),null);assert.equal(calls,1);
 console.log('PASS real workerd + SQLite DO: concurrent dedup, persisted billing/cache, 900-record admission denial, no secret in stored/returned data. Outbound traffic mocked.');
} finally {await mf.dispose();}
