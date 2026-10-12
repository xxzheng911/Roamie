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

import {createEmptySession} from '../src/lib/chat-session.ts';
import {mergeTravelContext} from '../src/lib/ai/travel-context.ts';
import {resolveGlobalPlanningCandidate} from '../src/lib/ai/global-planning-context.ts';
import {processAdviceTurn} from '../src/lib/ai/chat-state-machine.ts';
function turn(text,session) {
 const merged=mergeTravelContext(session,text);
 const result=processAdviceTurn(text,merged.session,merged.context,undefined,'en');
 return {...result,session:{...result.session,pendingQuestion:result.route?.pendingQuestion}};
}
async function start() {
 let s={...createEmptySession(),workspaceId:'handoff-offline',travelContext:{interests:['museums']}};
 s=turn("I'm going to Portugal in December.",s).session;
 s=mergeTravelContext(s,'Porto').session;
 s=await resolveGlobalPlanningCandidate(s,'en',async()=>({rawResultCount:1,location:{placeId:scope.placeId,country:'PT',city:'Porto',region:'Porto',lat:scope.latitude,lng:scope.longitude,formattedName:'Porto',displayLabel:'Porto'}}));
 const response=processAdviceTurn('Porto',s,s.travelContext,undefined,'en');
 s={...response.session,pendingQuestion:response.route?.pendingQuestion};
 assert.equal(s.pendingQuestion?.type,'ask_days');return s;
}
const rejected=one.map((p,i)=>({...p,id:`ChIJHandoffRejected${i}`,name:`Bus Terminal ${i}`,types:['bus_station'],primaryType:'bus_station'}));
let previousOptions=[];
for(const [key,pool,shouldDeliver] of [['two',places,true],['many',rich,true],['recover',one,true],['one',one,false],['zero',[],false]]) {
 clearDiscoveredCombinationsCache();clearCandidatePoolCache();let calls=0;
 let session=await start();
 // A new duration turn must replace, not retain, a previous offered list.
 session.travelContext.offeredCombinations=previousOptions;
 const result=await ensureDestinationCombinationsReady({destination:'Porto',destinationCountry:'PT',resolvedDestination:scope,locale:'en',days:4,generationRequestId:'session-handoff-'+key,
 searchPlaces:async(args)=>{calls++;return {places:key==='one'&&/theme/.test(args.data.placesCaller??'')?rejected:pool,error:null};}});
 assert.equal(result.ok,shouldDeliver);
 const callsBeforeHandoff=calls;
 const response=turn('4',session);session=response.session;
 assert.equal(session.travelContext.days,4);
 assert.notEqual(session.travelContext.dateProvenance?.source,'user_date');
 assert.notEqual(session.travelContext.dateProvenance?.confirmed,true);
 assert.equal(session.travelContext.travelMonth,'12月');
 assert.equal(session.travelContext.destination,'Porto');
 assert.ok(['Portugal','葡萄牙','PT'].includes(session.travelContext.destinationCountry));
 assert.equal(session.workspaceId,'handoff-offline');
 assert.ok(session.travelContext.interests.includes('museums'));
 const offers=session.travelContext.offeredCombinations??[];
 if(!shouldDeliver) {assert.notEqual(session.pendingQuestion?.type,'combination_choice');assert.equal(offers.length,0);assert.equal(calls,callsBeforeHandoff);const staleChoice=turn('1',session);assert.notEqual(staleChoice.advice.triggerItineraryGeneration,true);continue;}
 assert.equal(session.pendingQuestion?.type,'combination_choice');assert.ok(offers.length>=2);if(key==='many') assert.ok(offers.length>=3);
 assert.deepEqual(offers,response.advice.contextPatch.offeredCombinations);
 previousOptions=offers;
 const restored=JSON.parse(JSON.stringify(session));
 for(const text of ['1','2']) {
   const chosen=turn(text,restored);
   assert.equal(chosen.session.travelContext.days,4);
   assert.equal(chosen.session.travelContext.travelMonth,'12月');
   assert.equal(chosen.advice.triggerItineraryGeneration,true);
   assert.deepEqual(chosen.advice.contextPatch.selectedCombinationIds,[offers[Number(text)-1].id]);
 }
 const invalid=turn('99',restored);
 assert.notEqual(invalid.advice.triggerItineraryGeneration,true);
 assert.equal(invalid.session.travelContext.days,4);
 assert.equal(invalid.session.pendingQuestion?.type,'combination_choice');
 assert.deepEqual(invalid.session.travelContext.offeredCombinations,offers);
 assert.equal(calls,callsBeforeHandoff); // The synchronous handoff/choice path cannot dispatch provider work.
 console.log('PASS session handoff',key,offers.length);
}
console.log('PASS raw discovery → duration → session → choice, restore, context, and failed-offer invalidation');
