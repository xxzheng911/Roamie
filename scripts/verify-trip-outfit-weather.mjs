import * as sourceAvailability from '../src/lib/outfit/weather-source-availability.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from '../src/lib/outfit/trip-weather-policy.ts';
import * as context from '../src/lib/outfit/trip-outfit-context.ts';
import * as parser from '../src/lib/weather/parse-openweather.ts';
import { createServerRequestCache } from '../src/lib/server-request-cache.ts';
import { buildLocalTripOutfitFallback, tripPackingSeason, climateOutfitCopy } from '../src/lib/outfit/local-trip-outfit-fallback.ts';

let now = Date.parse('2026-10-09T03:00:00Z');
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
function load(path, dependencies, fetch) {
  const exports = {};
  const sandbox = { exports, require: name => {
    if (!(name in dependencies)) throw Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, process: {env:{}}, Date: Clock, console: {info(){},warn(){},error(){}}, fetch, Response, AbortController, AbortSignal, setTimeout, clearTimeout };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, sandbox);
  return exports;
}
let calls=0, mode='normal';
const dates=policy.tripCalendarDates('2026-10-09','2026-10-16');
const rawDay = (date,i) => ({dt:Date.parse(date+'T03:00:00Z')/1000,sunrise:1,sunset:2,temp:{min:10+i,max:20+i},pop:0.2,weather:[{description:'多雲'}]});
const weather=load('src/lib/weather/openweather.server.ts', {
  '@/lib/outfit/trip-weather-policy':policy,
  '@/lib/openweather-key-resolve.server':{requireOpenWeatherApiKey:()=> 'fixture'},
  '@/lib/weather-diagnostics':{logOpenWeatherRequest(){},logOpenWeatherResponse(){},maskApiKey:()=>''},
  '@/lib/api/constants':{API_CACHE_TTL_MS:{weather:policy.FORECAST_TTL_MS}},
  '@/lib/server-request-cache':{createServerRequestCache},
  '@/lib/weather/parse-openweather':parser,
}, async url=>{
  calls++;
  if(mode==='failure') return new Response('{}',{status:503});
  if(mode==='fallback' && url.includes('onecall')) return new Response('{}',{status:503});
  if(mode==='fallback') return Response.json({city:{timezone:32400},list:Array.from({length:8},(_,i)=>({dt:Date.parse('2026-10-10T15:00:00Z')/1000+i*10800,main:{temp_min:12,temp_max:20,humidity:60},clouds:{all:20},wind:{speed:2},weather:[], /* no pop */}))});
  return Response.json({timezone:'Asia/Tokyo',timezone_offset:32400,daily:mode==='empty'?[]:dates.map(rawDay)});
});
const base={destination:'東京都',lat:35.68,lng:139.69,timezone:'Asia/Tokyo',startDate:'2026-10-11',endDate:'2026-10-13'};
assert.deepEqual(Array.from(await weather.openWeatherGetTripForecast({...base,startDate:'2026-11-25',endDate:'2026-11-30'})),[]);
assert.equal(calls,0,'A far future must not fetch current forecast');
let rows=await weather.openWeatherGetTripForecast(base);
assert.deepEqual(rows.map(r=>r.date),['2026-10-11','2026-10-12','2026-10-13']);
assert.equal(policy.forecastFacts(rows).low,12);
assert.equal(policy.forecastFacts(rows).high,24);
assert.equal(calls,1);
await Promise.all([weather.openWeatherGetTripForecast(base),weather.openWeatherGetTripForecast(base)]);
assert.equal(calls,1,'cache prevents repeated provider calls');
assert.equal((await weather.openWeatherGetTripForecast({...base,endDate:'2026-10-18'})).length,0,'C partial coverage unavailable');
for(const change of [{destination:'大阪',lat:34.69,lng:135.5},{lat:35.7},{endDate:'2026-10-12'}]) await weather.openWeatherGetTripForecast({...base,...change});
assert.equal(calls,4,'F/G keys isolate city, coordinates and dates');
mode='failure';assert.equal((await weather.openWeatherGetTripForecast({...base,destination:'failure'})).length,0);
const failedCalls=calls;
await weather.openWeatherGetTripForecast({...base,destination:'failure'});assert.equal(calls,failedCalls,'failure cached');
mode='empty';assert.equal((await weather.openWeatherGetTripForecast({...base,destination:'empty'})).length,0);
mode='fallback';rows=await weather.openWeatherGetTripForecast({...base,destination:'fallback',endDate:'2026-10-11'});
assert.equal(rows.length,1,'city.timezone groups full Tokyo local day');
assert.equal(rows[0].date,'2026-10-11');assert.equal(rows[0].precipProbability,null);
assert.deepEqual(policy.tripCalendarDates('2026-10-30','2026-11-02'),['2026-10-30','2026-10-31','2026-11-01','2026-11-02']);
assert.deepEqual(policy.tripCalendarDates('2026-12-30','2027-01-02'),['2026-12-30','2026-12-31','2027-01-01','2027-01-02']);
assert.equal(policy.tripCalendarDates('2028-02-28','2028-03-01').length,3);
for(const pair of [['',''],['2026-02-29','2026-03-01'],['2026-12-31','2026-12-30']]) assert.equal(policy.tripCalendarDates(...pair).length,0);
assert.equal(policy.destinationDate(Date.parse('2026-10-09T16:00Z'),'Asia/Tokyo'),'2026-10-10');
assert.equal(policy.destinationDate(Date.parse('2026-10-09T03:00Z'),'America/Los_Angeles'),'2026-10-08');
const key=context.buildOutfitInputKey({...base,dayCount:3});
for(const change of [{lat:35.69},{destination:'大阪'},{startDate:'2026-10-12'},{timezone:'UTC'}]) assert.notEqual(context.buildOutfitInputKey({...base,dayCount:3,...change}),key);
const fields={outfitSuggestion:'test',outfitSuggestionUpdatedAt:new Date(now).toISOString(),outfitSuggestionInputKey:key,weatherSource:'openweather'};
assert.equal(policy.isFreshTripOutfit(fields,key,now),true);
assert.equal(policy.isFreshTripOutfit(fields,key,now+policy.FORECAST_TTL_MS),false);
assert.equal(policy.isFreshTripOutfit({...fields,outfitSuggestionInputKey:'legacy'},key,now),false);
const missing=parser.parseOneCallDailyForecast({timezone:'Asia/Tokyo',daily:[{...rawDay('2026-10-11',0),temp:{min:null,max:null},pop:null,weather:[]}]},1);
assert.equal(missing[0].tempLowC,null);assert.equal(missing[0].precipProbability,null);assert.equal(missing[0].condition,'');
assert.equal(policy.selectTripForecast(missing,['2026-10-11']).length,0);
assert.equal(policy.selectTripForecast([...rows,...rows],['2026-10-11']).length,0);
for(const locale of ['zh-TW','en','ja','ko']) {
  const fallback=buildLocalTripOutfitFallback({locale,destination:'東京',startDate:'2026-11-25',endDate:'2026-11-30',items:[],inputKey:key});
  assert.equal(fallback.weatherSource,'unavailable');assert.equal(fallback.weatherSummary,'');assert.ok(!fallback.outfitSuggestion.includes('°C'));
  assert.ok(!policy.tripForecastSummary(locale,'東京','2026-10-11','2026-10-11',rows).includes('0%'));
}
const hook=fs.readFileSync('src/hooks/use-trip-outfit-suggestion.ts','utf8');
assert.ok(!hook.includes('tripCenter'));assert.ok(hook.includes('lat: destinationLocation?.lat'));
assert.ok(!/Capacitor|detectPlatform/.test(hook),'J one shared Web/iOS boundary');
assert.ok(!fs.readFileSync('src/components/saved/SavedTripItineraryEditor.tsx','utf8').includes('return { start: today, end: today }'));
console.log('PASS A–J adjusted scope: far/partial dates unavailable; exact forecast dates; calendar/leap/timezone; cache; empty/error/null; locale/platform contract. No live API/AI calls.');
let aiCalls=0;
let selectedRows=rows;
let selectedClimate=null, climateCalls=0, forecastCalls=0;
const generator=load('src/lib/outfit/generate-trip-outfit.server.ts', {
  './weather-source-availability':sourceAvailability,
  './trip-weather-policy':policy,
  './local-trip-outfit-fallback':{buildLocalTripOutfitFallback,climateOutfitCopy},
  '../weather/visual-crossing.server':{visualCrossingTripClimate:async()=>{climateCalls++;return selectedClimate;}},
  '@/lib/abuse-guard-telemetry.server':{aiObservation:()=>({}),observeProviderAttempt:()=>()=>{}},
  './localized-outfit-copy':{localizedOutfitCopy:()=> 'rule fallback'},
  '@/lib/i18n/ai-instructions':{aiLanguageInstruction:()=>''},
  '@/lib/abuse-guard.server':{assertAiUse:async()=>{}},
  '@/lib/env.server':{getOpenAIKey:()=> 'fixture'},
  '@/lib/ai/errors':{mapOpenAIError:()=>new Error('mock AI error')},
  '@/lib/weather/openweather.server':{openWeatherGetTripForecast:async()=>{forecastCalls++;return selectedRows;}},
  '@/lib/outfit/trip-outfit-context':context,
},async()=>{aiCalls++;return Response.json({choices:[{message:{content:JSON.stringify({suggestion:'依預報分層穿著。'})}}]});});
let result=await generator.generateOutfitSuggestion({...base,endDate:'2026-10-11',items:[],dayCount:1});
assert.equal(result.weatherSource,'openweather');assert.ok(result.weatherSummary.includes('天氣預報'));assert.ok(result.weatherSummary.includes('降雨資料不足'));assert.equal(aiCalls,1);
assert.equal(climateCalls,0,'recent forecast does not call climate provider');
selectedRows=[];
result=await generator.generateOutfitSuggestion({...base,items:[],dayCount:3});
assert.equal(result.weatherSource,'unavailable');assert.equal(result.weatherSummary,'');assert.equal(aiCalls,1,'no AI calls without weather');
result=await generator.generateOutfitSuggestion({...base,startDate:'',endDate:'',items:[],dayCount:3});
assert.equal(result.weatherSource,'unavailable');assert.equal(aiCalls,1);
mode='normal';
const before=calls;
await Promise.all([weather.openWeatherGetTripForecast({...base,destination:'single-flight'}),weather.openWeatherGetTripForecast({...base,destination:'single-flight'})]);
assert.equal(calls,before+1,'concurrent cache miss single flight');
console.log('PASS server generation, no AI on unavailable, concurrent miss deduplication.');

const pack=(lat,lng,startDate,endDate=startDate,destination='fixture')=>({lat,lng,startDate,endDate,destination});
assert.equal(tripPackingSeason(pack(35.68,139.69,'2026-11-25','2026-11-30')),'cool');
assert.equal(tripPackingSeason(pack(35.68,139.69,'2026-07-01')),'warm');
assert.equal(tripPackingSeason(pack(-37.81,144.96,'2026-07-01')),'cool');
for(let m=1;m<=12;m++) assert.equal(tripPackingSeason(pack(1.35,103.82,`2026-${String(m).padStart(2,'0')}-01`)),'neutral');
assert.equal(tripPackingSeason(pack(35.68,139.69,'2026-08-28','2026-09-04')),'transition');
assert.equal(tripPackingSeason(pack(null,null,'2026-11-25')),'neutral');
assert.equal(tripPackingSeason(pack(35.68,139.69,'2026-11-25','2026-11-25','')),'neutral');
for(const locale of ['zh-TW','en','ja','ko']) {
 const seasonal=buildLocalTripOutfitFallback({...pack(35.68,139.69,'2026-11-25','2026-11-30','東京都'),locale,items:[],inputKey:'test'});
 assert.equal(seasonal.outfitSuggestion.split('\n\n').length,3);
 assert.ok(seasonal.outfitSuggestion.startsWith(policy.unavailableTripWeatherCopy(locale)));
 assert.ok(!/°C|%|18|31/.test(seasonal.outfitSuggestion));
 assert.equal(seasonal.weatherSummary,'');
}
selectedRows=[];
const noAiBefore=aiCalls;
result=await generator.generateOutfitSuggestion({...base,startDate:'2026-11-25',endDate:'2026-11-30',items:[],dayCount:6});
assert.ok(result.outfitSuggestion.includes('保暖外套'));
assert.ok(result.outfitSuggestion.includes('並非實際天氣預報'));
assert.equal(aiCalls,noAiBefore);
console.log('PASS seasonal A–H: hemispheres, tropical/unknown neutral, cross-month, 4 locales, disclaimer, no extra AI calls.');
selectedClimate={low:8.916666666666666,high:13.616666666666667,fetchedAt:now};
const forecastBefore=forecastCalls;
for(const locale of ['zh-TW','en','ja','ko']) {
 result=await generator.generateOutfitSuggestion({...base,locale,startDate:'2026-11-25',endDate:'2026-11-30',items:[],dayCount:6});
 assert.equal(result.weatherSource,'visual-crossing-stats');
 assert.ok(result.weatherSummary.includes('9–14°C'));
 assert.ok(!result.weatherSummary.includes('%'));
 assert.equal(aiCalls,noAiBefore);
 assert.equal(forecastCalls,forecastBefore,'far trip never calls OpenWeather');
}
console.log('PASS integrated historical branch: four locales, actual mean values, no additional AI/OpenWeather calls.');
