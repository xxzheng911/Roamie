import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('src/hooks/use-trip-outfit-suggestion.ts','utf8');
function fixture({cached,failCapability=false,mode='climate',coords=true}={}) {
 let cursor=0,dirty=false,pending=[],slots=[],capCalls=0,requests=0,resolveCap,rejectCap,resolveRequest,rejectRequest;
 const cap=new Promise((r,j)=>{resolveCap=r;rejectCap=j});const request=new Promise((r,j)=>{resolveRequest=r;rejectRequest=j});
 const same=(a,b)=>a&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={useState(init){const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],v=>{const n=typeof v==='function'?v(slots[i]):v;if(!Object.is(n,slots[i])){slots[i]=n;dirty=true}}]},useRef(v){const i=cursor++;return slots[i]??=( {current:v})},useMemo(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value},useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};pending.push(()=>{slots[i].cleanup=fn()})}}};
 const fallback=()=>({weatherSource:'unavailable',outfitSuggestion:'seasonal',outfitCopy:{},outfitSuggestionInputKey:'zh-TW|key'});
 const fetchCap=()=>{capCalls++;return cap},fetchRequest=()=>{requests++;return request};
 const deps={react,'@tanstack/react-start':{useServerFn:f=>f},'@/hooks/use-i18n':{useI18n:()=>({locale:'zh-TW'})},'@/lib/generated-locale':{isCurrentGeneratedCopy:()=>true},'@/lib/outfit/outfit.functions':{generateTripOutfitSuggestion:fetchRequest,getTripWeatherSourceAvailability:fetchCap},'@/lib/outfit/local-trip-outfit-fallback':{resolveLocalTripOutfit:fallback,buildLocalTripOutfitFallback:fallback},'@/lib/outfit/trip-outfit-context':{buildOutfitInputKey:()=> 'key'},'@/lib/outfit/weather-source-availability':{canonicalWeatherTimezone:x=>x,readWeatherSourceAvailability:f=>f()},'@/lib/outfit/trip-weather-policy':{isFreshTripOutfit:(f,k,now,v)=>f.outfitSuggestionInputKey===k&&!(f.weatherSource==='unavailable'&&v==='on'&&f.weatherSourceAvailability!=='on'),tripCalendarDates:()=>['2026-11-25'],unavailableTripWeatherCopy:()=> 'unavailable',tripWeatherMode:()=>mode,validWeatherCoords:()=>coords}};
 const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:id=>{assert.ok(deps[id],id);return deps[id]},Date,setInterval:()=>1,clearInterval(){},console:{warn(){}}});
 const params={initialFields:cached?{...fallback(),weatherSource:cached}: {},items:[],settings:{},destination:'Tokyo',destinationLocation:{lat:35,lng:139},dateRange:{start:'2026-11-25',end:'2026-11-30'},dayCount:6};
 let result;function render(){cursor=0;dirty=false;result=exports.useTripOutfitSuggestion(params);return result}
 async function flush(){for(let n=0;n<12;n++){for(const f of pending.splice(0))f();await Promise.resolve();if(dirty)render()}return result}
 return {render,flush,resolveCap:()=>resolveCap('on'),rejectCap:()=>rejectCap(Error('unavailable')),resolveRequest:(weatherSource='visual-crossing-stats')=>resolveRequest({outfitSuggestion:'final',outfitCopy:{},weatherSource,weatherSourceAvailability:'on'}),rejectRequest:()=>rejectRequest(Error('provider failure')),counts:()=>({capCalls,requests})};
}
const a=fixture();assert.equal(a.render().loading,true,'first render hides seasonal');await a.flush();assert.equal(a.counts().requests,0);a.resolveCap();assert.equal((await a.flush()).loading,true);a.resolveRequest();assert.equal((await a.flush()).loading,false);assert.equal((await a.flush()).outfitFields.weatherSource,'visual-crossing-stats');assert.deepEqual(a.counts(),{capCalls:1,requests:1});
for(const cached of ['visual-crossing-stats','openweather']){const f=fixture({cached});assert.equal(f.render().loading,false);await f.flush();assert.deepEqual(f.counts(),{capCalls:0,requests:0})}
const recent=fixture({mode:'forecast'});assert.equal(recent.render().loading,true);await recent.flush();recent.resolveRequest('openweather');assert.equal((await recent.flush()).outfitFields.weatherSource,'openweather');assert.deepEqual(recent.counts(),{capCalls:0,requests:1});
const fail=fixture();fail.render();await fail.flush();fail.resolveCap();await fail.flush();fail.rejectRequest();assert.equal((await fail.flush()).loading,false);assert.equal((await fail.flush()).outfitFields.weatherSource,'unavailable');assert.equal(fail.counts().requests,1);
const capability=fixture({cached:'unavailable'});assert.equal(capability.render().loading,true);await capability.flush();capability.rejectCap();assert.equal((await capability.flush()).loading,false);assert.equal(capability.counts().requests,0);
const old=fixture({cached:'unavailable'});assert.equal(old.render().loading,true);await old.flush();old.resolveCap();assert.equal((await old.flush()).loading,true);old.resolveRequest();assert.equal((await old.flush()).loading,false);
const missing=fixture({coords:false});assert.equal(missing.render().loading,false);
console.log('PASS hook lifecycle: first paint, capability pending/fail, stale fallback, VC/forecast caches, provider fail settlement; unchanged call counts; no real APIs.');
