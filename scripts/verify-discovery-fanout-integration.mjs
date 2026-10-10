import assert from 'node:assert/strict';
import {discoverDestinationCombinations,clearDiscoveredCombinationsCache,ensureDestinationCombinationsReady,setCachedDiscoveredCombinations} from '../src/lib/ai/destination-combination-discovery.ts';
const logs=[];const info=console.info;console.info=(...args)=>{if(String(args[0]).includes('COMBINATION_DISCOVERY_TRACE')) logs.push(JSON.parse(args[1]));};
try {
 clearDiscoveredCombinationsCache();let calls=0;
 const params={destination:'大阪',days:2,locale:'zh-TW',generationRequestId:'fixture-fail',geocodeFn:async()=>({lat:34.6937,lng:135.5023}),searchPlaces:async()=>{calls++;return {places:[],error:'places_rate_limited'}}};
 const failed=await discoverDestinationCombinations(params);assert.equal(failed,null);assert.equal(calls,1);assert.equal(logs.at(-1).success,false);
 // Grounded fixture covers three distinct themes; no network or real Places calls.
 clearDiscoveredCombinationsCache();
 const names=['大阪城','通天閣','四天王寺','住吉大社','梅田藍天大廈','難波八阪神社','大阪歷史博物館','大阪市立科學館','大阪中之島美術館','大阪市立美術館','大阪生活今昔館','國立國際美術館','大阪城公園','中之島公園','天王寺公園','靱公園','長居公園','花博紀念公園'];
 const places=names.map((name,i)=>({id:`ChIJOsakaFixtureLongId${i}`,name,lat:34.6937+i*.0005,lng:135.5023,types:[i<6?'tourist_attraction':i<12?'museum':'park'],primaryType:i<6?'tourist_attraction':i<12?'museum':'park',rating:4.6,userRatingCount:10000,address:'大阪市 日本',businessStatus:'OPERATIONAL'}));
 calls=0;
 const normal=await discoverDestinationCombinations({...params,generationRequestId:'fixture-healthy',searchPlaces:async()=>{calls++;return {places,error:null}}});
 assert.ok(normal?.length>=2, 'healthy discovery must form real combinations');
 assert.ok(calls<=12);console.warn(`FIXTURE healthy calls=${calls} combinations=${normal.length}`);
 // Reopening the actual generated cache must perform zero searches.
 calls=0;
 const cached=await ensureDestinationCombinationsReady({...params,generationRequestId:'fixture-cache',searchPlaces:async()=>{calls++;throw Error('cache must not search')}});
 assert.equal(cached.ok,true);assert.equal(cached.source,'cache');assert.equal(calls,0);
}finally{console.info=info;clearDiscoveredCombinationsCache();}
console.log('PASS actual Osaka discovery rate-limit -> one search, unwinds all fallback/top-up; actual cache -> zero calls.');
