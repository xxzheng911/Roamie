import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import * as geography from '../src/lib/location/geographic-only.ts';
import * as format from '../src/lib/location/format.ts';
import * as coords from '../src/lib/ai/destination-provider-coords.ts';
import * as language from '../src/lib/i18n/places-language.ts';
let requests=[], predictions=[], details=null, status=200;
const builder=()=>({middleware(){return this},inputValidator(fn){this.validate=fn;return this},handler(fn){const validate=this.validate;return args=>fn({data:validate(args.data)});}});
const deps={
 '@tanstack/react-start':{createServerFn:builder},zod:{z},
 '@/lib/location/geographic-only':geography,'@/lib/location/format':format,
 '@/lib/ai/destination-provider-coords':coords,'@/lib/i18n/places-language':language,
 '@/lib/i18n/resolve-locale':{coerceLocale:x=>x},
 '@/lib/google-maps-api':{placesAutocompleteUrl:()=>'/autocomplete',placeDetailsUrl:id=>'/details/'+id},
 '@/lib/google-rest-transport':{googleRestFetch:async(url,init)=>{
  requests.push({url,...init,body:init.body?JSON.parse(init.body):undefined});
  return Response.json(url.startsWith('/details/')?details:{suggestions:predictions.shift()??[]},{status});
 }},
};
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/location.functions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports,require:id=>deps[id]??{},console:{error(){}},URL,Response,Set,Number,
});
const pred=(id,name,types,secondary)=>({placePrediction:{placeId:id,structuredFormat:{mainText:{text:name},secondaryText:{text:secondary}},types}});
const cases=[['東京','東京都','日本','administrative_area_level_1'],['大阪','大阪市','日本','locality'],['首爾','Seoul','韓國','locality'],['巴黎','Paris','France','locality'],['高雄','高雄市','台灣','locality'],['Bali','Bali','Indonesia','administrative_area_level_1'],['峇里島','Bali','Indonesia','administrative_area_level_1'],['Melbourne','Melbourne','Australia','locality'],['Osaka','Osaka','Japan','locality'],['London','London','UK','locality']];
for(const [query,name,country,type] of cases){
 requests=[];predictions=[[pred('shop',query+'餐廳',['restaurant','establishment'],'台北市'),pred('city',name,[type,'political'],country)]];
 const r=await exports.searchTripLocations({data:{query,locale:'zh-TW',lat:25.03,lng:121.56}});
 assert.equal(r.suggestions.length,1);assert.equal(r.suggestions[0].placeId,'city');assert.ok(r.suggestions[0].label.includes(name));
 assert.equal(requests.length,1);const body=requests[0].body;
 assert.deepEqual(body.includedPrimaryTypes,['(regions)']);assert.equal(body.regionCode,undefined);assert.equal(body.includedRegionCodes,undefined);
 assert.deepEqual(body.locationBias.rectangle,{low:{latitude:-90,longitude:-180},high:{latitude:90,longitude:180}});
}
requests=[];predictions=[[],[pred('island','島嶼',['natural_feature','establishment'],'Indonesia')]];
assert.equal((await exports.searchTripLocations({data:{query:'島嶼'}})).suggestions[0].placeId,'island');
assert.equal(requests.length,2);assert.deepEqual(requests[1].body.includedPrimaryTypes,['natural_feature']);
requests=[];predictions=[];status=503;
assert.ok((await exports.searchTripLocations({data:{query:'東京'}})).error);assert.equal(requests.length,1,'no retry/fallback on provider failure');status=200;
details={id:'tokyo-canonical',displayName:{text:'東京都'},formattedAddress:'日本東京都',location:{latitude:35.68,longitude:139.69},types:['administrative_area_level_1','political'],utcOffsetMinutes:540,addressComponents:[{longText:'日本',types:['country']},{longText:'東京都',types:['administrative_area_level_1']}]};
const resolved=await exports.resolveTripLocation({data:{placeId:'tokyo-canonical',locale:'zh-TW'}});
assert.equal(resolved.location.placeId,'tokyo-canonical');assert.equal(resolved.location.country,'日本');assert.equal(resolved.location.region,'東京都');assert.equal(resolved.location.city,'東京都');assert.equal(resolved.location.lat,35.68);assert.equal(resolved.location.lng,139.69);assert.equal(resolved.location.utcOffsetMinutes,540);assert.ok(resolved.location.timezone);
for (const key of ['placeId','country','city','region','lat','lng','formattedName','timezone','utcOffsetMinutes']) assert.equal(JSON.parse(JSON.stringify(resolved.location))[key],resolved.location[key],'saved destination '+key);
details={...details,location:undefined};assert.equal((await exports.resolveTripLocation({data:{placeId:'bad'}})).location,null,'no label-only selection');
const ui=fs.readFileSync('src/components/LocationSearchField.tsx','utf8');
assert.match(ui,/searchMode === "geographic"\s*\? await searchLocationFn/);assert.match(ui,/resolveLocationFn\(\{ data: \{ placeId: item.placeId, locale \} \}\)/);assert.match(ui,/commitLocation\(location\)/);
assert.match(fs.readFileSync('src/routes/_app.plan.tsx','utf8'),/fieldRole="destination"\s+searchMode="geographic"/);
assert.match(fs.readFileSync('src/lib/plan-form-trip-payload.ts','utf8'),/destinationLocation: form.destination/);
assert.match(fs.readFileSync('src/lib/plan-trip-handoff.ts','utf8'),/tripDestination: form.destination/);
console.log('PASS destination A–J fixtures; global regions first, natural fallback only on empty; no error retry; complete Details identity/geo/offset; shared Web/iOS wiring and handoff. No live Google calls.');
