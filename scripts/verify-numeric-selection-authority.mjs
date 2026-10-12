import {discardExpiredSelection,bindSelectionOwner,rejectNumericSelection} from '../src/lib/ai/numeric-selection-authority.ts';
import {pendingQuestionForAskTripStyle} from '../src/lib/ai/ai-trip-style.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {harness} from './verify-free-workspace-date-runtime.mjs';
import {createEmptySession,saveChatSession,loadChatSession} from '../src/lib/chat-session.ts';
import {beginTripCreation} from '../src/lib/ai/generated-plan-handoff.ts';
import {prepareTripDateConfirmation} from '../src/lib/ai/trip-date-confirmation.ts';
import {isStyleReselectTurn,applyStyleReselectToSession,shouldTriggerTripStylePlanning} from '../src/lib/ai/chat-planning-state.ts';
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
function turn(text,s){const m=mergeTravelContext(s,text);const r=processAdviceTurn(text,m.session,m.context,undefined,'ja');return {...r,session:{...r.session,pendingQuestion:r.route?.pendingQuestion}}}

import {shouldFetchDestinationPlaces,resolveMustVisitDestination,mergeContextForPlaceFetch} from '../src/lib/ai/must-visit-places.ts';
import {resolveConversationDestination} from '../src/lib/ai/ai-chat-conversation-state.ts';
import {getOrCreatePlanningSessionId} from '../src/lib/ai/ai-planning-session.ts';
const preludeStart=chat.indexOf('      activeSession = restorePendingPlanAiOwner',chat.indexOf('  const pushDestinationPlaceRecommendation ='));
const preludeEnd=chat.indexOf('      const flowSessionId =',preludeStart);
const recommendation=new (Object.getPrototypeOf(async function(){}).constructor)('d',`with(d){${ts.transpile(chat.slice(preludeStart,preludeEnd),{target:ts.ScriptTarget.ES2022})}}`);
const styleStart=chat.indexOf('    const styleReselect = isStyleReselectTurn(trimmed, nextSession, merged.context);');
const styleEnd=chat.indexOf('    const stylePlanTurn =',styleStart);
const styleEntry=new (Object.getPrototypeOf(async function(){}).constructor)('d',`with(d){${ts.transpile(chat.slice(styleStart,styleEnd),{target:ts.ScriptTarget.ES2022})}}`);
const guardStart=chat.indexOf('    if (rejectNumericSelection(session, trimmed))');
const guardEnd=chat.indexOf('    // Entry snapshot:',guardStart);
assert.ok(guardStart>0 && guardEnd>guardStart);
const guard=new Function('d',`with(d){${ts.transpile(chat.slice(guardStart,guardEnd),{target:ts.ScriptTarget.ES2022})}}`);
function runGuard(h,s,text='2'){
 let replied=false;
 guard({session:s,trimmed:text,rejectNumericSelection,discardExpiredSelection,locale:'ja',msgsRef:{current:[]},chatRuntimeCopy,setText:()=>{},setMsgs:m=>{replied=true;assert.ok(m.at(-1).content)},persistSession:h.persist});
 return replied;
}
for(const failure of ['empty','provider_error']){
 clearDiscoveredCombinationsCache();clearCandidatePoolCache();let calls=0;
 let s=turn('12月にアイスランドへ旅行に行きたいです。',createEmptySession()).session;
 s=mergeTravelContext(s,'Reykjavík').session;
 s=await resolveGlobalPlanningCandidate(s,'ja',async()=>({rawResultCount:1,location:{placeId:'ChIJAuditReykjavik',country:'IS',city:'Reykjavík',region:'Reykjavík',lat:64.146,lng:-21.94,formattedName:'Reykjavík',displayLabel:'Reykjavík'}}));
 s=turn('Reykjavík',s).session;
 const ready=await ensureDestinationCombinationsReady({destination:'Reykjavík',destinationCountry:'IS',locale:'ja',days:4,generationRequestId:'audit-'+failure,resolvedDestination:{label:'Reykjavík',city:'Reykjavík',country:'IS',countryCode:'IS',type:'city',latitude:64.146,longitude:-21.94,placeId:'ChIJAuditReykjavik',source:'trip_destination',scopeLocked:false},searchPlaces:async()=>{calls++;return {places:[],error:failure==='provider_error'?'provider_error':null}}});
 const m=mergeTravelContext(s,'4日間です。');const r=processAdviceTurn('4日間です。',m.session,m.context,undefined,'ja');s={...r.session,pendingQuestion:r.route?.pendingQuestion};
 console.log('AUDIT_FAILED',JSON.stringify({failure,calls,ok:ready.ok,reason:ready.failureReason,detail:ready.failureDetail,count:ready.combinations?.length,city:s.travelContext.destination,country:s.travelContext.destinationCountry,days:s.travelContext.days,pending:s.pendingQuestion?.type,offers:s.travelContext.offeredCombinations?.length??0,selected:s.travelContext.selectedCombinationIds??[],phase:s.phase,planningState:s.chatPlanningState,hasPlanId:!!s.planningSessionId,reply:r.advice.reply}));
 for(const explicit of [false,true])for(const priorPlan of [false,true]){
  const h=harness(priorPlan);const input=priorPlan?getOrCreatePlanningSessionId(s,'audit_existing_planning').session:s;let failed=h.persist(explicit?beginTripCreation(input,'advice_create','audit-existing-action'):input,[]);saveChatSession(failed);failed=loadChatSession();
  assert.equal(runGuard(h,failed),true);assert.equal(runGuard(h,failed,'1'),true);
  const merged=mergeTravelContext(failed,'2');const nextSession=merged.session;let pendingType=null,started=false;
  const result=processAdviceTurn('2',nextSession,merged.context,undefined,'ja');
  const push=async(activeSession,userText,conversation,opts)=>recommendation({activeSession,userText,conversation,opts,restorePendingPlanAiOwner:x=>x,loadChatSession,mergeTravelContext,mergeContextForPlaceFetch,isStyleReselectTurn,shouldTriggerTripStylePlanning,shouldFetchDestinationPlaces,resolveMustVisitDestination,resolveConversationDestination,applyStyleReselectToSession,getOrCreatePlanningSessionId,pauseForTripDates:(session,messages,cont)=>{const p=prepareTripDateConfirmation(session,cont);if(p){pendingType=p.pendingQuestion.type;h.persist(p,messages);return true}return false},runDirectItineraryRef:{current:()=>{started=true}}});
  await styleEntry({trimmed:'2',nextSession,merged,isStyleReselectTurn,applyStyleReselectToSession,markShortcutEngaged:()=>{},msgs:[],displayMessage:'2',setMsgs:()=>{},setText:()=>{},scrollToUserMessage:()=>{},persistSession:h.persist,setStreaming:()=>{},pushDestinationPlaceRecommendationRef:{current:push},toast:{message:()=>{}},uiT:x=>x});
  assert.equal(pendingType,null);assert.equal(started,false);assert.equal(isStyleReselectTurn('2',nextSession,merged.context),null);assert.equal(result.advice.triggerItineraryGeneration??false,false);
  console.log('AUDIT_TWO',JSON.stringify({failure,explicit,priorPlan,style:isStyleReselectTurn('2',nextSession,merged.context),adviceGeneration:result.advice.triggerItineraryGeneration??false,adviceRecommendations:result.advice.triggerPlaceRecommendations??false,pendingType,started,offers:h.sessionRef.current.travelContext.offeredCombinations?.length??0,selected:h.sessionRef.current.travelContext.selectedCombinationIds??[],hasAction:!!h.sessionRef.current.tripCreationAuthority}));
 }
}
let countryCalls=0;
const countryResult=await ensureDestinationCombinationsReady({destination:'Iceland',destinationCountry:'IS',locale:'ja',days:4,generationRequestId:'audit-country-only',resolvedDestination:{label:'Iceland',country:'IS',countryCode:'IS',type:'country',source:'trip_destination',scopeLocked:false},searchPlaces:async()=>{countryCalls++;throw Error('COUNTRY_MUST_NOT_SEARCH')}});
console.log('AUDIT_COUNTRY',JSON.stringify({ok:countryResult.ok,reason:countryResult.failureReason,calls:countryCalls}));

for(const plus of [false,true]){
 const h=harness(plus);
 const seed=()=>({...createEmptySession(),tripDays:4,planningSessionId:'numeric-test',travelContext:{destination:'Reykjavík',destinationCountry:'IS',days:4,travelMonth:'12月',planningDaysConfirmed:true,interests:[]}});
 const first=h.persist({...seed(),pendingQuestion:pendingQuestionForAskTripStyle('Reykjavík','IS')},[]);
 saveChatSession(first);const restored=loadChatSession();
 assert.equal(runGuard(h,restored),false);assert.equal(isStyleReselectTurn('2',restored),'local_life');
 const chosen=mergeTravelContext(restored,'2');assert.equal(chosen.session.adviceSelectionThisTurn,'local_life');
 assert.equal(isStyleReselectTurn('2',chosen.session,chosen.context),'local_life');
 assert.equal(shouldTriggerTripStylePlanning('2',chosen.session,chosen.context),true);
 let pushed=0;
 await styleEntry({trimmed:'2',nextSession:chosen.session,merged:chosen,isStyleReselectTurn,applyStyleReselectToSession,markShortcutEngaged:()=>{},msgs:[],displayMessage:'2',setMsgs:()=>{},setText:()=>{},scrollToUserMessage:()=>{},persistSession:h.persist,setStreaming:()=>{},pushDestinationPlaceRecommendationRef:{current:async active=>{pushed++;assert.equal(active.travelContext.planningTripStyle,'local_life');return true}},toast:{message:()=>{}},uiT:x=>x});
 assert.equal(pushed,1);
 const second=h.persist(seed(),[]);assert.notEqual(second.workspaceId,first.workspaceId);assert.notEqual(second.conversationId,first.conversationId);
 for(const key of ['workspaceId','conversationId','planningSessionId']){
  const foreign={...first,[key]:key==='planningSessionId'?'other':second[key]};
  assert.equal(runGuard(h,foreign),true);assert.equal(isStyleReselectTurn('2',foreign),null);
  assert.equal(mergeTravelContext(foreign,'2').session.adviceSelectionThisTurn,undefined);
 }
 assert.equal(runGuard(h,{...restored,pendingQuestion:undefined}),true);
 assert.equal(isStyleReselectTurn('local_life',{...restored,pendingQuestion:undefined}),'local_life');
 const legacy=structuredClone(restored);delete legacy.pendingQuestion.selectionOwner;
 assert.equal(runGuard(h,legacy),true);assert.equal(h.sessionRef.current.pendingQuestion,undefined);
 assert.equal(runGuard(h,restored,'9'),true);
 const dated=prepareTripDateConfirmation(beginTripCreation(second,'advice_create','direct-test'),{entry:'direct'});
 h.sessionRef.current=dated;await h.send('2','ja');assert.equal(h.calls,0);assert.equal(h.sessionRef.current.pendingQuestion.type,'date_confirmation');
 assert.equal(isStyleReselectTurn('2',dated),null);
 await h.send('提案された日程でお願いします。','ja');assert.equal(h.calls,1);
}
console.log('PASS Numeric Authority: actual Chat rejection/style branches, real failed discovery, restore, Free/Plus ownership isolation, active style menu, invalid menu, direct date continuation; no live providers.');
