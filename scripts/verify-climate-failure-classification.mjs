import assert from 'node:assert/strict';
import fs from 'node:fs';
import {VisualCrossingGuard} from '../src/lib/weather/visual-crossing-guard.ts';
import {VisualCrossingClimate} from '../src/lib/weather/visual-crossing-do.ts';
const input={destination:'fixture',lat:35.6762,lng:139.6503,startDate:'2026-11-25',endDate:'2026-11-30'};
const fixture=JSON.parse(fs.readFileSync('scripts/fixtures/visual-crossing-tokyo-stats.json','utf8'));
const now=Date.parse('2026-10-10T00:00:00Z');
const logs=[];const warn=console.warn;console.warn=(...args)=>logs.push(args);
let calls=0;
const makeStore=(initial)=>{let state=initial;return {get:async()=>structuredClone(state),put:async(_,v)=>{state=structuredClone(v)},peek:()=>structuredClone(state)}};
async function check(code,{state,body=fixture,http=200,invalidJson=false,timeout=false,throws=false}={}){
 logs.length=0;let count=0;
 const store=makeStore(state);
 const guard=new VisualCrossingGuard(store,'SECRET_SENTINEL',async()=>{
  count++;calls++;
  if(timeout)return new Promise(()=>{});
  if(throws)throw Error('SECRET_SENTINEL https://provider.invalid/?key=SECRET_SENTINEL');
  return invalidJson?new Response('SECRET_SENTINEL',{status:200}):Response.json(body,{status:http});
 },()=>now);
 const result=await guard.request(input,now+(timeout?15:12000));
 if(code){assert.equal(result,null);assert.deepEqual(logs,[['[climate_failure]',code]]);}else{assert.ok(result);assert.equal(logs.length,0);}
 assert.equal(count,state?0:1);
 if(!state)assert.equal(store.peek().charges.reduce((s,c)=>s+c.records,0),6,'diagnostics add no reservations');
 assert.ok(!JSON.stringify(logs).includes('SECRET_SENTINEL'));assert.ok(!JSON.stringify(logs).includes('://'));
 return store;
}
try{
 // Exact allowlisted code output only; no exception messages / URLs / response bodies.
 const state={charges:[],leaseUntil:0,blocked:true,cache:{}};
 await check('guard_blocked',{state});
 await check('budget_exhausted',{state:{...state,blocked:false,charges:[{at:now,records:900}]}});
 await check('provider_timeout',{timeout:true});
 await check('provider_invalid_json',{invalidJson:true});
 await check('unknown_provider_failure',{throws:true});
 await check('invalid_timezone',{body:{...fixture,timezone:'UTC+9'}});
 const missing=structuredClone(fixture);delete missing.days[0].normal;
 await check('incomplete_stats',{body:missing});
 await check('incomplete_dates',{body:{...fixture,days:fixture.days.slice(1)}});
 const invalid=structuredClone(fixture);invalid.days[0].normal.tempmin=[0,99,100];
 await check('invalid_normal_values',{body:invalid});
 await check(null);
 logs.length=0;const store=makeStore();
 const guard=new VisualCrossingGuard(store,'SECRET_SENTINEL',async()=>{calls++;return new Response('SECRET_SENTINEL',{status:503})},()=>now);
 assert.equal(await guard.request(input),null);assert.deepEqual(logs,[['[climate_failure]','provider_http_error']]);
 const before=calls;await guard.request(input);assert.equal(calls,before,'failure cache does not retry');
 assert.ok(!JSON.stringify(logs).includes('SECRET_SENTINEL'));assert.ok(!JSON.stringify(logs).includes('://'));
 // Health is read-only, independent from provider and record accounting.
 const saved=store.peek();const health=new VisualCrossingClimate({storage:{...store,sql:{exec:()=>({toArray:()=>[{ok:1}]})},put:async()=>{throw Error('health wrote ledger')}}},{VISUAL_CROSSING_API_KEY:'SECRET_SENTINEL'});
 const healthResult=await (await health.fetch(new Request('https://internal/__health'))).json();
 assert.equal(healthResult.guardVersion,'visual-crossing-guard-v1');assert.deepEqual(store.peek(),saved);assert.equal(calls,before);
 console.log('PASS failure A–J: blocked/budget/timeout/http/json/timezone/stats/means/success; fixed private codes, no secrets/raw responses, no added calls/charges, read-only health. All providers mocked.');
}finally{console.warn=warn;}
