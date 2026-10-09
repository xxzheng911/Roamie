import assert from 'node:assert/strict';
import { VisualCrossingClimate } from '../src/lib/weather/visual-crossing-do.ts';
let reads=0, writes=0, outbound=0;
const original=globalThis.fetch;
globalThis.fetch=async()=>{outbound++;throw Error('No upstream allowed');};
const sql={exec(query){assert.equal(query,'SELECT 1 AS ok');return {toArray:()=>[{ok:1}]};}};
const state={charges:[{at:Date.now(),records:6}],leaseUntil:0,blocked:false,cache:{}};
const make=overrides=>new VisualCrossingClimate({storage:{sql,get:async()=>{reads++;return structuredClone(state);},put:async()=>{writes++;throw Error('No writes allowed');},...overrides}}, {VISUAL_CROSSING_API_KEY:'SECRET_MUST_NOT_LEAK'});
const health=doInstance=>doInstance.fetch(new Request('https://internal/__health'));
try {
 const response=await health(make({}));assert.equal(response.status,200);
 assert.equal((await response.json()).usedRecords,6);
 const empty=await (await health(make({get:async()=>undefined}))).json();
 assert.equal(empty.budget,'uninitialized');assert.equal(empty.usedRecords,null);
 for(const overrides of [
  {sql:undefined},{sql:{exec(){throw Error('SECRET_MUST_NOT_LEAK');}}},
  {get:async()=>{throw Error('SECRET_MUST_NOT_LEAK');}},
  ...[null,{}, {...state,charges:[{at:1,records:-1}]}, {...state,charges:[{at:1,records:NaN}]}, {...state,cache:{x:{until:null}}}].map(value=>({get:async()=>value})),
 ]) {const r=await health(make(overrides));assert.equal(r.status,503);assert.ok(!(await r.text()).includes('SECRET'));}
 assert.equal((await make({}).fetch(new Request('https://internal/__health',{method:'POST'}))).status,405);
 assert.equal(reads,1);assert.equal(writes,0);assert.equal(outbound,0);
 console.log('PASS DO health: readable/empty/malformed/unavailable SQLite and ledger, no writes, no upstream, no secrets. Binding-only; no public route added.');
} finally {globalThis.fetch=original;}
