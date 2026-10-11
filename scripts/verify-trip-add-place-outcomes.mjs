import assert from 'node:assert/strict';
import { fetchTripAddPlaceCandidatePool, fetchTripAddPlaceRecommendations, prepareTripAddPlaceSession } from '../src/lib/trip/trip-add-place-handoff.ts';
import { processTripAddPlaceUserMessage } from '../src/lib/trip/trip-add-place-recommendation-engine.ts';
import { resetShortcutProviderOrchestrationForTests } from '../src/lib/ai/chat-place-recommendation.ts';
import { tripSearchFailure, tripSearchOutcomeCopy } from '../src/lib/trip/trip-add-place-outcome.ts';
import { normalizePlacesSearchResult } from '../src/lib/places-search-normalize.ts';
import { getTripAddPlaceCopy } from '../src/lib/i18n/trip-add-place-copy.ts';
import { finalizeChatRecommendationDisplay } from '../src/lib/chat-display-recommendations.ts';
import { buildTripAddPlaceChatMessage } from '../src/lib/trip/trip-add-place-render.ts';
const ctx={mode:'trip_add_place',source:'trip_detail_add_place',tripId:'fixture',destination:'Tokyo',tripDates:{start:'2026-12-15',end:'2026-12-16',dayCount:2,label:''},selectedDay:1,dayIndex:0,dateKey:'2026-12-15',currentPlaces:[],existingPlaceNames:[],destinationLocation:{lat:35.71,lng:139.79,placeId:'fixture-city',country:'Japan',city:'Tokyo'},transportationMode:'walk'};
const bundle={preferences:{},location:{lat:35.71,lng:139.79,city:'Tokyo'},weather:null,time:'12:00',usedFallbackLocation:false};
const session=()=>prepareTripAddPlaceSession(ctx,bundle);
const fixtures=Array.from({length:12},(_,i)=>({id:'fixture-'+i,name:`Tokyo Art Museum ${i}`,primaryType:'museum',types:['museum','tourist_attraction'],address:'Tokyo',lat:35.7101+i*.0001,lng:139.79,rating:4.8,userRatingCount:1000,businessStatus:'OPERATIONAL',openStatus:'unknown',photoName:null}));
const errors=[['cooldown_skipped','cooldown_skipped'],['user_rate_limited','rate_limited'],['provider_error','provider_error'],['network_error','network_error'],['stale_generation','stale'],['places_search_attempt_timeout','timeout'],['Unauthorized','auth_error']];
globalThis.fetch=async()=>{throw Error('unexpected real provider call')};
for(const [error,status] of errors){
 resetShortcutProviderOrchestrationForTests();let calls=0;
 const searchPlaces=async()=>{calls++;return normalizePlacesSearchResult({places:[],error,blockedReason:'query_cooldown',retryAfterSeconds:12.2,body:'SECRET',url:'SECRET'})};
 const result=await fetchTripAddPlaceCandidatePool({ctx,intent:'attraction',searchPlaces,locale:'en'});
 assert.equal(result.status,status);assert.equal(calls,1,'failure stops all bounded queries');
 assert.equal(result.blockedReason,'query_cooldown');assert.equal(result.retryAfterSeconds,13);
 assert.ok(!JSON.stringify(result).includes('SECRET'));
 resetShortcutProviderOrchestrationForTests();calls=0;
 const first=await fetchTripAddPlaceRecommendations({ctx,searchPlaces,locale:'en'});
 assert.equal(calls,1);assert.equal(first.outcome.status,status);assert.notEqual(first.summary,getTripAddPlaceCopy('en').empty);
 resetShortcutProviderOrchestrationForTests();calls=0;
 const turn=await processTripAddPlaceUserMessage({session:session(),msgs:[],userText:'museum',searchPlaces,locale:'en'});
 assert.equal(calls,1,'engine must not recover/retry service failure');assert.equal(turn.outcome.status,status);
 const display=finalizeChatRecommendationDisplay(turn.nextSession,'museum',turn.summary,turn.recommendations);
 const message=buildTripAddPlaceChatMessage({...display,session:turn.nextSession,locale:'en'});
 assert.notEqual(message.content,getTripAddPlaceCopy('en').empty);
}
for(const places of [[],fixtures]){
 resetShortcutProviderOrchestrationForTests();let calls=0;
 const result=await fetchTripAddPlaceCandidatePool({ctx,intent:'attraction',searchPlaces:async()=>{calls++;return {places}},locale:'en'});
 assert.equal(result.status,places.length?'success':'empty');assert.ok(calls>0);
 if(places.length)assert.ok(result.candidates.length>0);else assert.equal(result.rawCount,0);
}
resetShortcutProviderOrchestrationForTests();
const filtered=await fetchTripAddPlaceCandidatePool({ctx:{...ctx,existingPlaceNames:fixtures.map(p=>p.name)},intent:'attraction',searchPlaces:async()=>({places:fixtures}),locale:'en'});
assert.equal(filtered.status,'filtered');assert.ok(filtered.rawCount>0);
for(const locale of ['zh-TW','en','ja','ko']) {
 assert.equal(tripSearchOutcomeCopy(tripSearchFailure('cooldown_skipped').outcome,locale),getTripAddPlaceCopy(locale).searchRestricted);
 assert.notEqual(tripSearchOutcomeCopy(filtered,locale),getTripAddPlaceCopy(locale).empty);
}
console.log('PASS trip add place: actual bounded search, initial handoff, local turn, display; seven failures stop at one call; success/empty/filtered; four locales; safe metadata');
// Execute actual server category loop and unified browser/native dispatch without network.
const fs=await import('node:fs');const vm=await import('node:vm');const ts=await import('typescript');
function extract(file,name,context){
 const src=fs.readFileSync(file,'utf8');const ast=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true);let found;
 ts.forEachChild(ast,n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found=n});assert.ok(found,name);
 const code=found.getText(ast).replace(/^export /,'');
 return vm.runInNewContext(ts.transpileModule(code+'\n'+name,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
}
let groupCalls=0;
const searchMulti=extract('src/lib/places.functions.ts','searchMultiNearby',{searchNearby:async()=>{groupCalls++;return {places:[],error:'cooldown_skipped',blockedReason:'request_cooldown',retryAfterSeconds:15}},devVerboseInfo:()=>{}});
const multi=await searchMulti('fixture',1,1,1000,[['museum'],['park'],['cafe']],'en',{caller:'chat.fetchNearbyPlacesForIntent.trip_add_place',screen:'chat'});
assert.equal(groupCalls,1);assert.equal(multi.blockedReason,'request_cooldown');assert.equal(multi.retryAfterSeconds,15);
for(const name of ['searchText','searchNearby']) {
 const fn=extract('src/lib/places.functions.ts',name,{exploreLocale:()=>({languageCode:'en'}),locationCircle:()=>({}),placesSearchTextUrl:()=>'',placesSearchNearbyUrl:()=>'',postPlaces:async()=>({places:[],error:'cooldown_skipped',blockedReason:'rate_window',retryAfterSeconds:9}),devVerboseInfo:()=>{}});
 const r=await fn('fixture',...(name==='searchText'?['fixture',1,1,1000]:[1,1,1000,['museum']]));
 assert.equal(r.blockedReason,'rate_window');assert.equal(r.retryAfterSeconds,9);
}
for(const native of [false,true]) {
 let serverCalls=0,clientCalls=0;
 const create=extract('src/lib/places-search-unified.ts','createUnifiedSearchPlacesFn',{
 isCapacitorNativeShell:()=>native,getExploreRequestSession:()=>null,buildPlacesSearchKey:()=>'',getPlacesSearchCachedOrRun:async(k,run)=>run(),logPlacesApiCall:()=>{},devVerboseInfo:()=>{},normalizePlacesSearchResult,CHAT_PLACES_SEARCH_TIMEOUT_MS:25000,
 runClientSearch:async()=>{clientCalls++;return {places:[],error:'cooldown_skipped',blockedReason:'query_cooldown'}}});
 const search=create(async()=>{serverCalls++;return {places:[],error:'cooldown_skipped',blockedReason:'query_cooldown'}});
 const r=await search({data:{placesCaller:'chat.fetchNearbyPlacesForIntent.trip_add_place',placesScreen:'chat'}});
 assert.equal(r.error,'cooldown_skipped');assert.equal(serverCalls,native?0:1);assert.equal(clientCalls,native?1:0);
}
console.log('PASS server metadata text/nearby; category fail-fast; Web/native dispatch without secondary fallback');
