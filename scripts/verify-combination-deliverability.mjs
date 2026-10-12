import assert from 'node:assert/strict';
import {clearCandidatePoolCache} from '../src/lib/ai/places-cost-cache/candidate-pool-cache.ts';
import {ensureDestinationCombinationsReady,clearDiscoveredCombinationsCache} from '../src/lib/ai/destination-combination-discovery.ts';
import {buildDestinationCombinationSuggestionPayload} from '../src/lib/ai/destination-combination-suggestions.ts';
globalThis.fetch=async()=>{throw Error('NETWORK_DISABLED')};
const names=['Clerigos Tower','Porto Cathedral','Bolsa Palace','Sao Francisco Church','Fernandina Walls','Dom Luis Bridge','Serralves Museum','Soares dos Reis Museum','Porto Photography Museum','Romantic Museum','Tram Museum','World of Discoveries Museum','Crystal Palace Gardens','City Park','Virtudes Garden','Passeio Alegre Garden','Botanical Garden','Covelo Park'];
const places=names.map((name,i)=>({id:`ChIJPortoOfflineFixture${i}`,name,lat:41.15+i*.0003,lng:-8.61,types:[i<6?'tourist_attraction':i<12?'museum':'park'],primaryType:i<6?'tourist_attraction':i<12?'museum':'park',rating:4.6,userRatingCount:10000,address:'Porto Portugal',businessStatus:'OPERATIONAL'}));

const oneNames=['Amber Castle','Royal Cathedral','Heritage Palace','Old Fortress','Historic Abbey','Marble Tower','Fine Arts Museum','Maritime Museum','Natural History Museum','Archaeology Museum','Design Museum','Science Museum','Botanical Gardens','Riverside Park','Woodland Park','Rose Gardens','Lakeside Park','Sculpture Gardens'];
const one=places.map((p,i)=>({...p,id:`ChIJOneGroupFixture${i}`,name:oneNames[i]}));
const rich=[...places,...['Riverside Restaurant','Garden Restaurant','Heritage Restaurant','Central Bistro','Harbor Restaurant','Terrace Restaurant'].map((name,i)=>({id:`ChIJFoodFixture${i}`,name,lat:41.15+i*.0003,lng:-8.61,types:['restaurant'],primaryType:'restaurant',rating:4.6,userRatingCount:10000,address:'Porto Portugal',businessStatus:'OPERATIONAL'}))];
const scope={label:'Porto',city:'Porto',country:'PT',countryCode:'PT',type:'city',latitude:41.15,longitude:-8.61,placeId:'ChIJPortoFixtureCity',source:'trip_destination',scopeLocked:false};
for(const [key,pool,expected] of [['zero',[],0],['one',one,2],['two',places,2],['many',rich,3]]) {
 clearDiscoveredCombinationsCache();clearCandidatePoolCache();let calls=0;const events=[];const info=console.info;
 console.info=(prefix,json)=>{if(String(prefix).startsWith('[COMBINATION_DISCOVERY_TRACE]')) events.push({stage:prefix,...JSON.parse(json)})};
 let result,reply;
 try {
 result=await ensureDestinationCombinationsReady({destination:'Porto',destinationCountry:'PT',resolvedDestination:scope,locale:'en',days:4,generationRequestId:'deliverability-'+key,
 geocodeFn:async()=>{throw Error('must reuse scope')},searchPlaces:async()=>{calls++;return {places:pool,error:null}}});
 reply=buildDestinationCombinationSuggestionPayload('Porto',4,{locale:'en'});
 } finally {console.info=info;}
 assert.equal(result.ok,expected>=2,key);assert.equal(!!reply,expected>=2,key);
 
 if(expected>=2){if(key==='one') assert.ok(result.combinations.length>=2); else if(key==='many') assert.ok(result.combinations.length>=3); else assert.equal(result.combinations.length,expected);assert.equal(events.at(-1).failureReason,null);}
 assert.ok(calls>0 && calls<=12);
 console.log('PASS actual discovery and renderer',key,JSON.stringify({calls,count:events.find(e=>e.stage.endsWith('candidate_summary'))?.combinationCount,ok:result.ok,reason:result.failureReason??null}));
}
for(const error of ['provider_error','network_error','timeout','rate_limited','auth_error']) {
 clearDiscoveredCombinationsCache();clearCandidatePoolCache();let calls=0;
 const result=await ensureDestinationCombinationsReady({destination:'Porto',destinationCountry:'PT',resolvedDestination:scope,locale:'en',days:4,generationRequestId:'deliverability-'+error,searchPlaces:async()=>{calls++;return {places:[],error}}});
 assert.equal(result.ok,false);assert.equal(result.failureDetail,error);assert.equal(calls,1);
}
clearDiscoveredCombinationsCache();
console.log('PASS provider reason preservation. No live providers.');
