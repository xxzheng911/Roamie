import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseClimateStats, climateCacheKey } from '../src/lib/weather/visual-crossing-contract.ts';
import { VisualCrossingGuard, VC_RECORD_LIMIT } from '../src/lib/weather/visual-crossing-guard.ts';
import { VisualCrossingClimate } from '../src/lib/weather/visual-crossing-do.ts';
import { visualCrossingTripClimate } from '../src/lib/weather/visual-crossing.server.ts';
import { runWithWorkerRequest } from '../src/lib/worker-request-scope.ts';
import { buildOutfitInputKey } from '../src/lib/outfit/trip-outfit-context.ts';
import { tripCalendarDates, tripWeatherMode, isFreshTripOutfit } from '../src/lib/outfit/trip-weather-policy.ts';
import { climateOutfitCopy, climateCopy } from '../src/lib/outfit/local-trip-outfit-fallback.ts';

// Only this fixture is real provider data (one authorized query, queryCost=6).
// Other destinations/dates below are deterministic contract fixtures, not weather claims.
const tokyo = JSON.parse(fs.readFileSync('scripts/fixtures/visual-crossing-tokyo-stats.json','utf8'));
const base = { destination:'東京都',lat:35.6762,lng:139.6503,startDate:'2026-11-25',endDate:'2026-11-30',timezone:'Asia/Tokyo' };
let now = Date.parse('2026-10-10T00:00:00Z');
const facts = parseClimateStats(tokyo,base,now);
assert.ok(facts); assert.equal(tokyo.queryCost,6);
assert.ok(Math.abs(facts.low - 8.916666666666666)<1e-9);
assert.ok(Math.abs(facts.high - 13.616666666666667)<1e-9);
assert.equal(Math.round(facts.low),9); assert.equal(Math.round(facts.high),14);
for (const modify of [
  d=>delete d.timezone,d=>d.timezone='UTC+9',d=>d.timezone='Invalid/Zone',d=>d.latitude=NaN,d=>d.longitude=Infinity,
  d=>d.days.pop(),d=>d.days.push(d.days[0]),d=>d.days[0].source='fcst',
  d=>d.days[0].normal.tempmin=[-50,null,60],d=>d.days[0].normal.tempmin=[-50,99,100],
  d=>d.days[0].tempmin=NaN,d=>d.latitude=0,d=>d.timezone='Europe/London',
]) { const raw=structuredClone(tokyo);modify(raw);assert.equal(parseClimateStats(raw,base,now),null); }
for (const input of [
  {...base,lat:-37.8136,lng:144.9631,destination:'Melbourne',timezone:'Australia/Melbourne',startDate:'2027-07-01',endDate:'2027-07-06'},
  {...base,startDate:'2026-11-28',endDate:'2026-12-03'},
  {...base,startDate:'2026-12-29',endDate:'2027-01-03'},
  {...base,startDate:'2028-02-27',endDate:'2028-03-02'},
]) {
  const raw={...tokyo,latitude:input.lat,longitude:input.lng,timezone:input.timezone,
    days:tripCalendarDates(input.startDate,input.endDate).map(date=>({...tokyo.days[0],datetime:date}))};
  assert.ok(parseClimateStats(raw,input,now));
  assert.notEqual(climateCacheKey(input),climateCacheKey(base));
}
assert.notEqual(climateCacheKey({...base,lat:35.68}),climateCacheKey(base));
assert.notEqual(climateCacheKey({...base,destination:'other'}),climateCacheKey(base));
const oldKey=buildOutfitInputKey({...base,dayCount:6,now});
const recentNow=Date.parse('2026-11-24T00:00:00Z');
const newKey=buildOutfitInputKey({...base,dayCount:6,now:recentNow});
assert.equal(tripWeatherMode(base,now),'climate');assert.equal(tripWeatherMode(base,recentNow),'forecast');
assert.notEqual(oldKey,newKey);
const saved={outfitSuggestion:'climate',weatherSource:'visual-crossing-stats',outfitSuggestionUpdatedAt:new Date(now).toISOString(),outfitSuggestionInputKey:oldKey};
assert.ok(isFreshTripOutfit(saved,oldKey,now));
assert.equal(isFreshTripOutfit(saved,newKey,recentNow),false);
assert.equal(isFreshTripOutfit({...saved,outfitSuggestionInputKey:'trip-weather-v3'},oldKey,now),false);
for (const locale of ['zh-TW','en','ja','ko']) {
  const copy=climateOutfitCopy(locale,facts.low,facts.high);
  assert.ok(copy.weatherSummary.includes('9–14°C'));
  assert.ok(copy.outfitSuggestion.includes(climateCopy[locale].disclaimer));
  assert.ok(climateCopy[locale].source.includes('Visual Crossing'));
  assert.ok(!copy.weatherSummary.includes('%'));assert.ok(!copy.outfitSuggestion.includes('%'));
}

function storage(initial) {
  let data=initial;
  return { get:async()=>structuredClone(data),put:async(_key,value)=>{data=structuredClone(value);},peek:()=>structuredClone(data) };
}
let calls=0,active=0,maxActive=0;
const store=storage();
const provider=async(url,options)=>{
  calls++;active++;maxActive=Math.max(maxActive,active);
  assert.equal(new URL(url).searchParams.get('include'),'stats');
  assert.equal(new URL(url).searchParams.get('unitGroup'),'metric');
  assert.equal(new URL(url).searchParams.has('timezone'),false);
  assert.equal(options.redirect,'manual');
  await new Promise(r=>setTimeout(r,2));active--;
  return Response.json(tokyo);
};
const guard=new VisualCrossingGuard(store,'fixture-secret',provider,()=>now);
const results=await Promise.all(Array.from({length:20},()=>guard.request(base)));
assert.ok(results.every(Boolean));assert.equal(calls,1);assert.equal(maxActive,1);
await new VisualCrossingGuard(store,'fixture-secret',provider,()=>now).request(base);
assert.equal(calls,1,'cache survives DO recreation');
assert.equal(store.peek().charges[0].records,6);
await guard.request({...base,lat:35.677});assert.equal(calls,2,'different coordinates miss');
await guard.request({...base,destination:'other'});assert.equal(calls,3,'different city misses');
for (const timezone of ['UTC+9','GMT+9',undefined,'Asia/Tokyo']) {
  const legacy={...base,timezone};
  assert.equal(parseClimateStats(tokyo,legacy,now)?.timezone,'Asia/Tokyo');
  const oldCalls=calls;
  assert.ok(await new VisualCrossingGuard(storage(),'fixture',provider,()=>now).request(legacy));
  assert.equal(calls,oldCalls+1);
}
const before=calls;
for(const invalid of [{...base,lat:undefined},{...base,endDate:''}]) {
 assert.equal(await new VisualCrossingGuard(storage(),'fixture',provider,()=>now).request(invalid),null);
 assert.equal(calls,before);
}

await new VisualCrossingGuard(storage(),'',provider,()=>now).request(base);assert.equal(calls,before);
await new VisualCrossingGuard(storage(), 'fixture', provider,()=>recentNow).request(base);assert.equal(calls,before,'recent forecast never calls VC');
const full=storage({charges:[{at:now,records:VC_RECORD_LIMIT}],leaseUntil:0,blocked:false,cache:{}});
assert.equal(await new VisualCrossingGuard(full,'fixture',provider,()=>now).request(base),null);assert.equal(calls,before);
now+=24*60*60_000+1;
assert.ok(await new VisualCrossingGuard(full,'fixture',provider,()=>now).request(base));
let failures=0;
const badStore=storage();
const bad=new VisualCrossingGuard(badStore,'fixture',async()=>{failures++;return new Response('',{status:503});},()=>now);
assert.equal(await bad.request(base),null);assert.equal(await bad.request(base),null);assert.equal(failures,1);
assert.equal(badStore.peek().charges[0].records,6,'no refund on provider failure');
assert.equal(await new VisualCrossingGuard(badStore,'fixture',provider,()=>now).request({...base,destination:'restart'}),null,'persistent lease prevents overlapping restart');
const unavailable=new VisualCrossingGuard({get:async()=>{throw Error('storage unavailable')},put:async()=>{}},'fixture',provider,()=>now);
const b=calls;assert.equal(await unavailable.request(base),null);assert.equal(calls,b);
const costStore=storage();
const wrongCost=new VisualCrossingGuard(costStore,'fixture',async()=>Response.json({...tokyo,queryCost:144}),()=>now);
assert.equal(await wrongCost.request(base),null);assert.equal(costStore.peek().blocked,true);
assert.equal(await new VisualCrossingGuard(costStore,'fixture',provider,()=>now).request({...base,destination:'blocked'}),null);

let release,queueCalls=0;
const queuedStore=storage();
const queued=new VisualCrossingGuard(queuedStore,'fixture',()=>{queueCalls++;return new Promise(r=>{release=()=>r(Response.json(tokyo));});},()=>now);
const q1=queued.request(base);await new Promise(r=>setTimeout(r,0));
const q2=queued.request({...base,destination:'expires'},now+1);
const q3=queued.request({...base,destination:'three'});
const q4=queued.request({...base,destination:'four'});
const q5=queued.request({...base,destination:'five'});
assert.equal(await queued.request({...base,destination:'overflow'}),null);
now+=13_000;release();await Promise.all([q1,q2,q3,q4,q5]);assert.equal(queueCalls,1,'expired queue work never dispatches');
let aborted=false;
const timeoutStore=storage();
const timeout=new VisualCrossingGuard(timeoutStore,'fixture',(_url,options)=>new Promise(()=>{options.signal.addEventListener('abort',()=>{aborted=true;});}),()=>now);
assert.equal(await timeout.request(base,now+20),null);assert.equal(aborted,true);
assert.equal(timeoutStore.peek().charges[0].records,6,'uncertain timed out billing retained');

// Shared server boundary, no browser/native branch, no key returned or direct-fetch fallback.
let bindingCalls=0;
const env={VISUAL_CROSSING_ENABLED:'true',VISUAL_CROSSING_API_KEY:'fixture',VISUAL_CROSSING_CLIMATE:{
  idFromName:name=>{assert.equal(name,'global-v1');return name;},
  get:()=>({fetch:async()=>{bindingCalls++;return Response.json(facts);}}),
}};
assert.deepEqual(await runWithWorkerRequest({env},()=>visualCrossingTripClimate(base)),facts);
assert.equal(bindingCalls,1);
// Exercise the adapter → DO contract → durable guard → provider fixture together.
for (const timezone of ['UTC+9','GMT+9',undefined,'Asia/Tokyo']) {
 const integratedGuard=new VisualCrossingGuard(storage(),'fixture',provider,()=>now);
 const integratedEnv={...env,VISUAL_CROSSING_CLIMATE:{
  idFromName:name=>{assert.equal(name,'global-v1');return name},
  get:()=>({fetch:async req=>{
   const {input}=await req.json();
   assert.equal(input.timezone,timezone==='Asia/Tokyo'?'Asia/Tokyo':undefined);
   return Response.json(await integratedGuard.request(input));
  }}),
 }};
 assert.equal((await runWithWorkerRequest({env:integratedEnv},()=>visualCrossingTripClimate({...base,timezone})))?.timezone,'Asia/Tokyo');
}
for (const invalid of [{...base,lat:undefined},{...base,endDate:''}])
 assert.equal(await runWithWorkerRequest({env},()=>visualCrossingTripClimate(invalid)),null);
assert.equal(bindingCalls,1,'invalid coordinates/dates rejected before DO');
assert.equal(await runWithWorkerRequest({env:{...env,VISUAL_CROSSING_API_KEY:''}},()=>visualCrossingTripClimate(base)),null);
assert.equal(bindingCalls,1,'missing secret rejected before DO');

assert.equal(await runWithWorkerRequest({env:{}},()=>visualCrossingTripClimate(base)),null);
const doWithoutKey=new VisualCrossingClimate({storage:storage()},{});
assert.equal(await (await doWithoutKey.fetch(new Request('https://internal',{method:'POST',body:JSON.stringify({input:base,deadline:Date.now()+1000})}))).json(),null);
const card=fs.readFileSync('src/components/saved/TripOutfitCard.tsx','utf8');
assert.ok(card.includes('https://www.visualcrossing.com/'));
assert.ok(!JSON.stringify(facts).includes('fixture-secret'));
console.log('PASS VC A–L: real Tokyo mean fixture; synthetic Melbourne/calendar/leap; date authority and source switch; four locales; 900-record durable budget; global dedup/queue; restart/cache; abort/failure; secret-free shared server boundary. No live API calls.');
