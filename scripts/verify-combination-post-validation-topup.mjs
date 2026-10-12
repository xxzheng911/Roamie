// Run with VITE_VERBOSE_LOG=1, as the assertions inspect actual source diagnostics.
import assert from 'node:assert/strict';
import {discoveryRequestSignature} from '../src/lib/ai/discovery-search-scope.ts';
import {clearCandidatePoolCache} from '../src/lib/ai/places-cost-cache/candidate-pool-cache.ts';
import {ensureDestinationCombinationsReady,clearDiscoveredCombinationsCache} from '../src/lib/ai/destination-combination-discovery.ts';
import {buildDestinationCombinationSuggestionPayload} from '../src/lib/ai/destination-combination-suggestions.ts';
globalThis.fetch=async()=>{throw Error('NETWORK_DISABLED')};
const names=['Clerigos Tower','Porto Cathedral','Bolsa Palace','Sao Francisco Church','Fernandina Walls','Dom Luis Bridge','Serralves Museum','Soares dos Reis Museum','Porto Photography Museum','Romantic Museum','Tram Museum','World of Discoveries Museum','Crystal Palace Gardens','City Park','Virtudes Garden','Passeio Alegre Garden','Botanical Garden','Covelo Park'];
const places=names.map((name,i)=>({id:`ChIJPortoOfflineFixture${i}`,name,lat:41.15+i*.0003,lng:-8.61,types:[i<6?'tourist_attraction':i<12?'museum':'park'],primaryType:i<6?'tourist_attraction':i<12?'museum':'park',rating:4.6,userRatingCount:10000,address:'Porto Portugal',businessStatus:'OPERATIONAL'}));

const oneNames=['Amber Castle','Royal Cathedral','Heritage Palace','Old Fortress','Historic Abbey','Marble Tower','Fine Arts Museum','Maritime Museum','Natural History Museum','Archaeology Museum','Design Museum','Science Museum','Botanical Gardens','Riverside Park','Woodland Park','Rose Gardens','Lakeside Park','Sculpture Gardens'];
const one=places.map((p,i)=>({...p,id:`ChIJOneGroupFixture${i}`,name:oneNames[i]}));

const scope={label:'Porto',city:'Porto',country:'PT',countryCode:'PT',type:'city',latitude:41.15,longitude:-8.61,placeId:'ChIJPortoFixtureCity',source:'trip_destination',scopeLocked:false};

const trail = one.map((p,i)=>({...p, id:`ChIJTrailFixture${i}`, lat:41.15+i*.003,
 name:i===14?'Woodland Trail':i===16?'Lakeside Mountain':p.name,
 types:[i===14||i===16?'hiking_area':p.primaryType], primaryType:i===14||i===16?'hiking_area':p.primaryType}));
const allHomogeneous=one.map((p,i)=>({...p,id:`ChIJHomogeneousFixture${i}`,name:i<6?`Heritage Museum ${i}`:p.name}));
async function run(key, pool, topupResponse) {
 clearDiscoveredCombinationsCache();clearCandidatePoolCache();
 let calls=0,topupCalls=0;const signatures=new Set();const records=[];const info=console.info;
 console.info=(...args)=>{records.push(args.map(v=>typeof v==='object'?JSON.stringify(v):String(v)).join(' '));};
 let result,reply;
 try {
 result=await ensureDestinationCombinationsReady({destination:'Porto',destinationCountry:'PT',resolvedDestination:scope,locale:'en',days:4,generationRequestId:`post-validation-${key}`,
 searchPlaces:async(args)=>{const signature=discoveryRequestSignature(args.data);assert.ok(!signatures.has(signature));signatures.add(signature);calls++;const topup=(args.data.placesLane==='theme_topup'||/theme/.test(args.data.placesCaller??''));
 if(topup){topupCalls++;return topupResponse?topupResponse(args):{places:pool,error:null};}return {places:pool,error:null};}});
 reply=buildDestinationCombinationSuggestionPayload('Porto',4,{locale:'en'});
 } finally {console.info=info;}
 assert.ok(calls<=12);assert.equal(!!reply,result.ok);
 const ids=result.combinations.flatMap(c=>c.placeCandidates.map(p=>p.googlePlaceId));
 assert.equal(new Set(ids).size,ids.length,"no repeated identity across delivered groups");
 const summary=records.find(x=>x.includes('[COMBINATION_PREFERRED_TOP_UP]'))??'';
 console.log(key,JSON.stringify({calls,topupCalls,ok:result.ok,count:result.combinations.length,reason:result.failureReason,summary}));
 return {result,calls,topupCalls,summary};
}
const ready=await run('ready',trail);
assert.equal(ready.result.ok,true);assert.equal(ready.topupCalls,0);assert.match(ready.summary,/initialCombinationCount=2/);
const recover=await run('recover',one);
assert.equal(recover.result.ok,true);assert.ok(recover.topupCalls>0);assert.match(recover.summary,/initialCombinationCount=1/);
const rejectedSupply=one.map((p,i)=>({...p,id:`ChIJRejectedSupply${i}`,name:`Bus Terminal ${i}`,types:['bus_station'],primaryType:'bus_station'}));
const empty=await run('empty-topup',one,()=>({places:rejectedSupply,error:null}));
assert.equal(empty.result.ok,false);assert.ok(empty.topupCalls>0);
assert.equal(empty.result.failureReason,'insufficient_combinations');
const exhausted=await run('budget-exhausted',one,()=>({places:[],error:null}));
assert.equal(exhausted.result.failureReason,'discovery_budget_exhausted');assert.equal(exhausted.calls,12);
const zero=await run('zero-validation',allHomogeneous);
assert.equal(zero.result.ok,false);assert.equal(zero.result.failureReason,"insufficient_combinations");assert.match(zero.summary,/assembledCombinationCount=3/);assert.ok(zero.topupCalls>0);assert.match(zero.summary,/initialCombinationCount=0/);
for(const error of ['rate_limited','auth_error']) {
 const stopped=await run(error,one,()=>({places:[],error}));
 assert.equal(stopped.result.ok,false);assert.equal(stopped.result.failureDetail,error);assert.equal(stopped.topupCalls,1);
}
console.log('PASS post-validation recovery, final validation, bounded budget and fail-fast');
