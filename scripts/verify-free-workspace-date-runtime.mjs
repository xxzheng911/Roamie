import {traceCombinationPersisted} from '../src/lib/ai/combination-selection-diagnostics.ts';
import {matchesDateGenerationAction,traceDateGenerationContinuation} from '../src/lib/ai/date-generation-continuation.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createEmptySession,saveChatSession,loadChatSession} from '../src/lib/chat-session.ts';
import {upsertDraftWorkspaceFromSession,attachWorkspaceIdsToSession} from '../src/lib/conversation-workspace/sync.ts';
import {loadEphemeralWorkspace,clearEphemeralWorkspace,loadConversationWorkspace,listConversationWorkspaces} from '../src/lib/conversation-workspace/storage.ts';
import {restorePendingPlanAiOwner} from '../src/lib/ai/plan-ai-action-owner.ts';
import {prepareTripDateConfirmation,consumeTripDateConfirmation,isCurrentTripDateSnapshot,isRepeatedTripDateConfirmation,tripDateConfirmationCopy} from '../src/lib/ai/trip-date-confirmation.ts';
import {chatRuntimeCopy} from '../src/lib/chat-runtime-copy.ts';
let network=0;globalThis.fetch=async()=>{network++;throw Error('NO_NETWORK')};
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};
globalThis.window=globalThis;globalThis.localStorage=storage();globalThis.sessionStorage=storage();
const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');
// Execute the actual persistSession callback, including real upsert/attach/save.
const ps=chat.indexOf('      const pendingOwner =',chat.indexOf('  const persistSession = useCallback'));
const pe=chat.indexOf('\n    },\n    [hasPlusAccess]',ps);
const persistCode=ts.transpile(chat.slice(ps,pe),{target:ts.ScriptTarget.ES2022});
const persistFn=new Function('d',`with(d){${persistCode}}`);
const a=chat.indexOf('    if (isRepeatedTripDateConfirmation(session, trimmed))',chat.indexOf('  const send = async'));
const b=chat.indexOf('    // Entry snapshot:',a);
const sendFn=new (Object.getPrototypeOf(async function(){}).constructor)('d',`with(d){${ts.transpile(chat.slice(a,b),{target:ts.ScriptTarget.ES2022})}}`);
export function harness(plus=false){
 const sessionRef={current:createEmptySession()},msgsRef={current:[]};let calls=0,loading=false,failUpsert=false,failContinuation=false,switchOnFailure=false,resumeHook;
 const persist=(next,messagesForWorkspace)=>persistFn({next,messagesForWorkspace,planningSuggestionEntryPoint:undefined,traceCombinationPersisted,restorePendingPlanAiOwner,loadChatSession,sessionRef,setSession:s=>{sessionRef.current=s},msgsRef,
 extractLatestShownCandidatesFromMsgs:()=>[],snapshotPlanningCandidates:x=>x,logPlanningParseStage:()=>{},hasPlusAccess:plus,readCachedAuthenticatedUserIdSync:()=>null,
 upsertDraftWorkspaceFromSession:p=>{if(failUpsert)throw Error('fixture storage failure');return upsertDraftWorkspaceFromSession(p)},attachWorkspaceIdsToSession,saveChatSession,devVerboseInfo:()=>{},resolvePlanningSelectionPlaces:()=>[],homeMoodShortcutEngagedRef:{current:false}});
 const resume=async s=>{calls++;assert.ok(isCurrentTripDateSnapshot(s,sessionRef.current));assert.equal(s.pendingQuestion,undefined);assert.equal(s.travelContext.dateProvenance.confirmed,true);if(failContinuation){loading=true;if(switchOnFailure){sessionRef.current={...createEmptySession(),workspaceId:'new-chat',conversationId:'new-conversation'};msgsRef.current=[{role:'assistant',content:'new chat'}]}throw Error('fixture continuation failure')}if(resumeHook)await resumeHook(s);return true};
 async function send(text,locale='en') {await sendFn({session:sessionRef.current,trimmed:text,locale,sessionRef,msgsRef,matchesDateGenerationAction,traceDateGenerationContinuation,consumeTripDateConfirmation,isRepeatedTripDateConfirmation,isCurrentTripDateSnapshot,tripDateConfirmationCopy,chatRuntimeCopy,
 setText:()=>{},beginUserTurn:()=>{},setMsgs:m=>{msgsRef.current=typeof m==='function'?m(msgsRef.current):m},persistSession:persist,
 setGenerating:x=>{loading=x},setStreaming:x=>{loading=x},setSelectionGenerationStatus:()=>{},pushDestinationPlaceRecommendationRef:{current:resume},persistGeneratedPlanRef:{current:resume},handleGenerateItinerary:resume,runDirectItineraryRef:{current:resume}})}
 return {persist,send,sessionRef,msgsRef,set resumeHook(fn){resumeHook=fn},get calls(){return calls},get loading(){return loading},set failUpsert(x){failUpsert=x},set failContinuation(x){failContinuation=x},set switchOnFailure(x){switchOnFailure=x}};
}
const seed=destination=>({...createEmptySession(),phase:'ready',tripDays:4,planningSessionId:'fixture-'+destination,travelContext:{destination,destinationCountry:destination==='Porto'?'Portugal':'Iceland',days:4,travelMonth:'12月',interests:['nature'],selectedCombinationIds:['second']}});
const phrases={ja:'提案された日程でお願いします。',ko:'추천 날짜로 할게요.',en:'Those dates work for me.','zh-TW':'就照建議日期。'};
for(const plus of [false,true])for(const destination of ['Porto','Reykjavík'])for(const [locale,phrase] of Object.entries(phrases)){
 const h=harness(plus);let s=h.persist(seed(destination),[]);const ids=[s.workspaceId,s.conversationId];
 for(let i=0;i<3;i++){s=h.persist(s,[]);assert.deepEqual([s.workspaceId,s.conversationId],ids)}
 const context=JSON.stringify(s.travelContext);
 s=h.persist(prepareTripDateConfirmation(s,{entry:'direct'}),[]);assert.deepEqual([s.workspaceId,s.conversationId],ids);
 saveChatSession(s);h.sessionRef.current=loadChatSession();await h.send(phrase,locale);assert.equal(h.calls,1);
 const accepted=h.sessionRef.current;assert.equal(accepted.travelContext.dateProvenance.source,'month_default');assert.ok(accepted.travelContext.dateProvenance.confirmed);
 const again=h.persist(accepted,[]);assert.ok(isCurrentTripDateSnapshot(accepted,again));assert.deepEqual([again.workspaceId,again.conversationId],ids);
 for(const [key,value] of Object.entries(JSON.parse(context)))assert.deepEqual(again.travelContext[key],value);
 await h.send(phrase,locale);assert.equal(h.calls,1);
 if(plus)assert.ok(loadConversationWorkspace(ids[0]));else {assert.equal(loadConversationWorkspace(ids[0]),null);assert.ok(!listConversationWorkspaces().some(w=>w.workspaceId===ids[0]));assert.equal(loadEphemeralWorkspace().workspaceId,ids[0]);clearEphemeralWorkspace();assert.equal(h.persist(again,[]).workspaceId,ids[0])}
 const fresh=h.persist(seed(destination),[]);assert.notEqual(fresh.workspaceId,ids[0]);assert.notEqual(fresh.conversationId,ids[1]);assert.equal(fresh.pendingQuestion,undefined);
}
for(const key of ['workspaceId','conversationId','planningSessionId']){
 const h=harness();const s=h.persist(seed('Porto'),[]);const p=prepareTripDateConfirmation(s,{entry:'direct'});h.sessionRef.current={...p,[key]:'other'};await h.send(phrases.ja,'ja');assert.equal(h.calls,0);assert.equal(h.msgsRef.current.at(-1).content,chatRuntimeCopy('dateConfirmationExpired','ja'));
}
for(const failure of ['failUpsert','failContinuation'])for(const locale of Object.keys(phrases)){
 const h=harness();const s=h.persist(seed('Porto'),[]);h.persist(prepareTripDateConfirmation(s,{entry:'direct'}),[]);h[failure]=true;await h.send(phrases[locale],locale);
 assert.equal(h.msgsRef.current.at(-1).content,chatRuntimeCopy('generationFailed',locale));assert.equal(h.loading,false);assert.equal(h.calls,failure==='failUpsert'?0:1);
}
// Destination change in the same known slot creates a separate workspace, not shared state.
const h=harness();const s=h.persist(seed('Porto'),[]);const changed=h.persist({...seed('Reykjavík'),workspaceId:s.workspaceId,conversationId:s.conversationId},[]);assert.notEqual(changed.workspaceId,s.workspaceId);
assert.equal(network,0);
console.log('PASS actual Chat persistSession → real workspace upsert/attach/save → restore → date acceptance → continuation. Free/Plus, 4 locales, 2 destinations, fresh/cross-session, provenance, replay, exception UI/loading, no Free durable writes, 0 network.');

const late=harness();const initial=late.persist(seed('Porto'),[]);late.persist(prepareTripDateConfirmation(initial,{entry:'direct'}),[]);late.failContinuation=true;late.switchOnFailure=true;await late.send(phrases.en);assert.deepEqual(late.msgsRef.current,[{role:'assistant',content:'new chat'}]);
console.log('PASS old asynchronous continuation failure does not overwrite the newly selected conversation.');
