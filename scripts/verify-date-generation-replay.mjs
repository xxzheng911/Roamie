import {bindSelectionOwner,rejectNumericSelection} from "../src/lib/ai/numeric-selection-authority.ts";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {harness} from './verify-free-workspace-date-runtime.mjs';
import {createEmptySession,saveChatSession,loadChatSession} from '../src/lib/chat-session.ts';
import {beginTripCreation} from '../src/lib/ai/generated-plan-handoff.ts';
import {prepareTripDateConfirmation} from '../src/lib/ai/trip-date-confirmation.ts';
import {isStyleReselectTurn} from '../src/lib/ai/chat-planning-state.ts';
import {mergeTravelContext} from '../src/lib/ai/travel-context.ts';
import {processAdviceTurn} from '../src/lib/ai/chat-state-machine.ts';
import {resolveGlobalPlanningCandidate} from '../src/lib/ai/global-planning-context.ts';
import {ensureDestinationCombinationsReady,clearDiscoveredCombinationsCache} from '../src/lib/ai/destination-combination-discovery.ts';
import {clearCandidatePoolCache} from '../src/lib/ai/places-cost-cache/candidate-pool-cache.ts';
import {chatRuntimeCopy} from '../src/lib/chat-runtime-copy.ts';
const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');
const start=chat.indexOf('      activeSession = restorePendingPlanAiOwner',chat.indexOf('  const pushDestinationPlaceRecommendation ='));
const end=chat.indexOf('      const merged = mergeTravelContext',start);
assert.ok(end>start);
const entry=new (Object.getPrototypeOf(async function(){}).constructor)('d',`with(d){${ts.transpile(chat.slice(start,end),{target:ts.ScriptTarget.ES2022})}}`);
const phrases={ja:'提案された日程でお願いします。',ko:'추천 날짜로 할게요.',en:'Those dates work for me.','zh-TW':'就照建議日期。'};
const names=['Clerigos Tower','Porto Cathedral','Bolsa Palace','Sao Francisco Church','Fernandina Walls','Dom Luis Bridge','Serralves Museum','Soares dos Reis Museum','Porto Photography Museum','Romantic Museum','Tram Museum','World of Discoveries Museum','Crystal Palace Gardens','City Park','Virtudes Garden','Passeio Alegre Garden','Botanical Garden','Covelo Park'];
function turn(text,s){const m=mergeTravelContext(s,text);const r=processAdviceTurn(text,m.session,m.context,undefined,'en');return {...r,session:{...r.session,pendingQuestion:r.route?.pendingQuestion}}}
for(const [city,country,code,lat,lng] of [['Porto','Portugal','PT',41.15,-8.61],['Reykjavík','Iceland','IS',64.146,-21.94]]){
 clearDiscoveredCombinationsCache();clearCandidatePoolCache();let searches=0;
 let s=turn(`I'm going to ${country} in December.`,createEmptySession()).session;
 s=mergeTravelContext(s,city).session;
 s=await resolveGlobalPlanningCandidate(s,'en',async()=>({rawResultCount:1,location:{placeId:`ChIJReplayCity${code}`,country:code,city,region:city,lat,lng,formattedName:city,displayLabel:city}}));
 s=turn(city,s).session;
 const pool=names.map((name,i)=>({id:`ChIJReplay${code}Place${i}`,name,lat:lat+i*.0003,lng,types:[i<6?'tourist_attraction':i<12?'museum':'park'],primaryType:i<6?'tourist_attraction':i<12?'museum':'park',rating:4.6,userRatingCount:10000,address:`${city} ${country}`,businessStatus:'OPERATIONAL'}));
 const ready=await ensureDestinationCombinationsReady({destination:city,destinationCountry:code,locale:'en',days:4,generationRequestId:`replay-${code}`,resolvedDestination:{label:city,city,country:code,countryCode:code,type:'city',latitude:lat,longitude:lng,placeId:`ChIJReplayCity${code}`,source:'trip_destination',scopeLocked:false},searchPlaces:async()=>{searches++;return {places:pool,error:null}}});
 assert.ok(ready.ok,city);
 s=turn('4',s).session;assert.equal(s.pendingQuestion.type,'combination_choice');
 const menuHarness=harness();const menu=menuHarness.persist(s,[]);
 assert.equal(rejectNumericSelection(menu,'2'),false);
 for(const key of ['workspaceId','conversationId','planningSessionId']){
  const foreign={...menu,[key]:'different-owner'};
  assert.equal(rejectNumericSelection(foreign,'2'),true);
  assert.equal(mergeTravelContext(foreign,'2').session.adviceSelectionThisTurn,undefined);
 }
 const chosen=turn('2',menu);assert.ok(chosen.advice.triggerItineraryGeneration);s=beginTripCreation(chosen.session,'advice_create',`action-${code}`);
 assert.equal(s.travelContext.conversationState,'ready_for_itinerary');
 const beforeCalls=searches;
 for(const plus of [false,true])for(const [locale,text] of Object.entries(phrases)){
  const h=harness(plus);const current=h.persist({...structuredClone(s),workspaceId:undefined,conversationId:undefined},[]);
  // A combination selection is never a numeric style selection.
  assert.equal(isStyleReselectTurn('2',{...current,planningSessionId:'active'},current.travelContext),null);
  const freshStyle=bindSelectionOwner({...current,planningSessionId:'active',adviceSelectionThisTurn:undefined,pendingQuestion:{type:'ask_trip_style',options:['classic_landmarks','local_life']},lastResolvedPendingQuestion:undefined});
  assert.equal(isStyleReselectTurn('2',{...freshStyle,planningSessionId:'active'},freshStyle.travelContext),'local_life');
  assert.equal(await entry({activeSession:freshStyle,userText:'2',conversation:[],restorePendingPlanAiOwner:x=>x,loadChatSession,pauseForTripDates:()=>{throw Error('new style must not be intercepted')},runDirectItineraryRef:{current:()=>{throw Error('new style must remain style arbitration')}}}),undefined);
  let paused=false;
  await entry({activeSession:current,userText:'2',conversation:[],restorePendingPlanAiOwner:x=>x,loadChatSession,
   pauseForTripDates:(active,messages,continuation)=>{h.persist(prepareTripDateConfirmation(active,continuation),messages);paused=true;return true},runDirectItineraryRef:{current:()=>{throw Error('generated before confirmation')}}});
  assert.ok(paused);const pending=h.sessionRef.current;assert.equal(pending.pendingQuestion.dateConfirmation.continuation.userText,'2');
  const snapshot=JSON.stringify(pending.travelContext.selectedCombinationIds);const owner=[pending.workspaceId,pending.conversationId,pending.planningSessionId];
  saveChatSession(pending);h.sessionRef.current=loadChatSession();
  h.resumeHook=async accepted=>{assert.equal(accepted.travelContext.destination,city);assert.equal(JSON.stringify(accepted.travelContext.selectedCombinationIds),snapshot);assert.deepEqual([accepted.workspaceId,accepted.conversationId,accepted.planningSessionId],owner);assert.deepEqual(accepted.selectedPlaces,pending.selectedPlaces)};
  await h.send(text,locale);assert.equal(h.calls,1);assert.equal(h.sessionRef.current.travelContext.dateProvenance.source,'month_default');await h.send(text,locale);assert.equal(h.calls,1);
  // Same owner but edited selection is stale; never replay obsolete action.
  const legacy=structuredClone(pending);delete legacy.pendingQuestion.dateConfirmation.continuation.action;h.sessionRef.current=legacy;await h.send(text,locale);assert.equal(h.calls,1);assert.equal(h.msgsRef.current.at(-1).content,chatRuntimeCopy('dateConfirmationExpired',locale));
  const stale=structuredClone(pending);stale.travelContext.selectedCombinationIds=[999];h.sessionRef.current=stale;await h.send(text,locale);assert.equal(h.calls,1);assert.equal(h.msgsRef.current.at(-1).content,chatRuntimeCopy('dateConfirmationExpired',locale));
 }
 assert.equal(searches,beforeCalls);console.log('PASS real discovery → duration → choice 2 → actual recommendation entry/date pause → real Free/Plus upsert/restore → Chat acceptance → generation boundary',city);
}
console.log('PASS no recommendation replay or added searches; external generation boundary mocked, device generation NOT VERIFIED');
