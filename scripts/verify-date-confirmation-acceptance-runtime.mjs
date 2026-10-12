import {matchesDateGenerationAction,traceDateGenerationContinuation} from '../src/lib/ai/date-generation-continuation.ts';
import {chatRuntimeCopy} from '../src/lib/chat-runtime-copy.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createEmptySession,saveChatSession,loadChatSession} from '../src/lib/chat-session.ts';
import {prepareTripDateConfirmation,isCurrentTripDateSnapshot,consumeTripDateConfirmation,isRepeatedTripDateConfirmation,tripDateConfirmationCopy} from '../src/lib/ai/trip-date-confirmation.ts';
import {beginTripCreation,createGeneratedPlanHandoff} from '../src/lib/ai/generated-plan-handoff.ts';
import {resolveTripCreateDates} from '../src/lib/ai/resolve-trip-create-dates.ts';
let network=0;globalThis.fetch=async()=>{network++;throw Error('NO_NETWORK')};
const store=new Map();const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
globalThis.window={localStorage:storage,sessionStorage:storage};globalThis.localStorage=storage;globalThis.sessionStorage=storage;
const base={...beginTripCreation(createEmptySession(),'direct_itinerary_create','existing-owner'),workspaceId:'accept-workspace',conversationId:'accept-conversation',planningSessionId:'accept-plan',tripDays:4,
 travelContext:{interests:['nature'],destination:'Porto',destinationCountry:'Portugal',travelMonth:'12月',days:4,selectedCombinationIds:['second']},
 selectedPlaces:[{name:'existing selected',placeId:'ChIJExistingSelected',lat:41,lng:-8}]};
const dates=s=>resolveTripCreateDates({context:s.travelContext,session:s,days:s.tripDays});
const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');
const start=chat.indexOf('    if (isRepeatedTripDateConfirmation(session, trimmed))',chat.indexOf('  const send = async'));
const end=chat.indexOf('    // Entry snapshot:',start);assert.ok(start>0&&end>start);
const fn=new (Object.getPrototypeOf(async function(){}).constructor)('d',`with(d){${ts.transpile(chat.slice(start,end),{target:ts.ScriptTarget.ES2022})}}`);
async function send(session,text,locale='en',fail=false){
 let saved=session,calls=0,entry,proposedAtHandoff;const sessionRef={current:session};let replies=[];
 const resume=kind=>async s=>{calls++;entry=kind;proposedAtHandoff=dates(s);assert.equal(proposedAtHandoff.datesConfirmed,true);assert.equal(saved.pendingQuestion,undefined);assert.deepEqual(loadChatSession().travelContext.dateProvenance,s.travelContext.dateProvenance);if(fail)throw Error('mock generation failure')};
 let error;
 try{await fn({matchesDateGenerationAction,traceDateGenerationContinuation,session,trimmed:text,locale,isCurrentTripDateSnapshot,isRepeatedTripDateConfirmation,consumeTripDateConfirmation,tripDateConfirmationCopy,chatRuntimeCopy,sessionRef,setGenerating:()=>{},setStreaming:()=>{},setSelectionGenerationStatus:()=>{},beginUserTurn:()=>{},msgsRef:{current:[]},setText:()=>{},setMsgs:m=>{replies=typeof m==='function'?m(replies):m},persistSession:s=>{saved=s;sessionRef.current=s;saveChatSession(s);return s},pushDestinationPlaceRecommendationRef:{current:resume('recommendation')},persistGeneratedPlanRef:{current:resume('persist')},handleGenerateItinerary:resume('selection'),runDirectItineraryRef:{current:resume('direct')}})}catch(e){error=e}
 return {session:saved,calls,entry,proposedAtHandoff,error,replies};
}
const variants={ja:['提案された日程でお願いします。','提案された日程を使います。','その日程で大丈夫です。'],ko:['추천해 준 날짜로 진행해 주세요.','추천 날짜로 할게요.','그 일정으로 진행해 주세요.'],en:['Use the suggested dates.','Those dates work for me.',"Let's go with the suggested dates."],'zh-TW':['使用建議日期。','就照建議日期。','這個日期可以。']};
for(const [locale,texts] of Object.entries(variants))for(const text of texts)for(const entry of ['direct','selection','recommendation','persist']){
 const pending=prepareTripDateConfirmation(base,{entry,generationId:'existing-generation'});
 saveChatSession(pending);const restored=loadChatSession();
 const out=await send(restored,text,locale);assert.ifError(out.error);assert.equal(out.calls,1);assert.equal(out.entry,entry==='recommendation'?'direct':entry);assert.deepEqual(out.session.tripCreationAuthority,base.tripCreationAuthority);
 assert.equal(out.proposedAtHandoff.source,'month_default');assert.equal(out.proposedAtHandoff.hasExplicitDates,false);
 assert.deepEqual(out.session.selectedPlaces,restored.selectedPlaces);
 assert.deepEqual(out.session.selectedPlaces.map(({placeId,lat,lng})=>({placeId,lat,lng})),base.selectedPlaces.map(({placeId,lat,lng})=>({placeId,lat,lng})));assert.deepEqual(out.session.travelContext.selectedCombinationIds,['second']);
 for(const k of ['workspaceId','conversationId','planningSessionId','tripDays'])assert.equal(out.session[k],base[k]);
 for(const k of ['destination','destinationCountry','travelMonth','days','interests'])assert.deepEqual(out.session.travelContext[k],base.travelContext[k]);
 assert.equal(prepareTripDateConfirmation(out.session,{entry}),null);
 assert.equal((await send(out.session,text,locale)).calls,0);
 assert.equal((await send(out.session,texts[0],locale)).calls,0);
}
const pending=prepareTripDateConfirmation(base,{entry:'direct'});
for(const text of ['No, do not use the suggested dates.','Those dates do not work for me.','不要使用建議日期。','その日程は使いません。','추천 날짜로 진행하지 말고 다른 날짜로 해주세요.','Are those dates okay?','yes','2','maybe','2026/02/31'])assert.equal((await send(pending,text)).calls,0,text);
for(const text of Object.values(variants).flat())assert.equal((await send(base,text)).calls,0);
for(const proposed of [undefined,{...pending.pendingQuestion.dateConfirmation.proposed,source:'unknown'},{...pending.pendingQuestion.dateConfirmation.proposed,startDate:'2026-02-31'}]){
 const invalid=structuredClone(pending);invalid.pendingQuestion.dateConfirmation.proposed=proposed;
 assert.equal((await send(invalid,variants.ja[0])).calls,0);
}
for(const id of ['workspaceId','conversationId','planningSessionId'])assert.equal((await send({...pending,[id]:'other'},variants.en[0])).calls,0);
const explicit=await send(pending,'2026/12/30');assert.equal(explicit.calls,1);assert.equal(dates(explicit.session).hasExplicitDates,true);assert.equal(explicit.session.tripEndDate,'2027-01-02');
const ai=structuredClone(pending);ai.pendingQuestion.dateConfirmation.proposed.source='ai_suggested';assert.equal(dates((await send(ai,variants.en[0])).session).source,'ai_suggested');
const clarification=await send(pending,'maybe');assert.equal((await send(clarification.session,variants.en[0])).calls,1);
const failed=await send(pending,variants.en[0],'en',true);assert.ifError(failed.error);assert.ok(failed.replies.some(m=>m.content===chatRuntimeCopy('generationFailed','en')));assert.equal((await send(failed.session,variants.en[0])).calls,0);assert.equal(prepareTripDateConfirmation(failed.session,{entry:'direct'}),null);
// Existing generation retry can reuse confirmed authority; acknowledgement replay is not a retry authority.
assert.equal(dates(failed.session).datesConfirmed,true);
const otherPending={...base,pendingQuestion:{type:'ask_days'}};assert.equal((await send(otherPending,variants.en[0])).session.pendingQuestion.type,'ask_days');
assert.equal(network,0);
console.log('PASS T1–T17: actual Chat branch, 12 expressions × 4 continuations, persistence-before-handoff, provenance, context/combination, restore, rejection/missing/stale, replay/failure safety; 0 network. Generation continuation mocked, real backend NOT VERIFIED.');

// Existing production handoff still owns at-most-once persistence, including failure.
const handoff=createGeneratedPlanHandoff();let persists=0;
const failSave=()=>{persists++;throw Error('mock save failure')};
await assert.rejects(handoff('one',failSave));await assert.rejects(handoff('one',failSave));assert.equal(persists,1);
await handoff('explicit-retry',async()=>{persists++});assert.equal(persists,2);
console.log('PASS unchanged generation owner and real handoff duplicate/failure/new-generation retry policy.');
