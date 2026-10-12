import {buildPlanningOfflineReply} from '../src/lib/ai/chat-turn-engine.ts';
import {createCombinationDiscoveryTrace} from '../src/lib/ai/combination-discovery-trace.ts';
import {combinationCorrelationToken,observeCombinationDiscovery,traceCombinationChatReturn,traceCombinationAdviceReturn} from '../src/lib/ai/combination-selection-diagnostics.ts';
import {buildNextStepAfterAdviceSelection,pendingQuestionForDestinationStyleChoice,USE_DEFAULT_ROUTES} from '../src/lib/ai/destination-pending-question.ts';
import {resolvePendingAnswer,advanceAfterPendingSelection} from '../src/lib/ai/chat-turn-engine.ts';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {traceCombinationDisplayed} from '../src/lib/ai/combination-selection-diagnostics.ts';
import {isDebugDiagnosticsEnabled} from '../src/lib/debug-flags.ts';
import ts from 'typescript';
import {harness} from './verify-free-workspace-date-runtime.mjs';
import {createEmptySession,loadChatSession,saveChatSession} from '../src/lib/chat-session.ts';
import {mergeTravelContext} from '../src/lib/ai/travel-context.ts';
import {processAdviceTurn} from '../src/lib/ai/chat-state-machine.ts';
import {applyAdviceResultToSession} from '../src/lib/ai/destination-advice.ts';
import {resolveGlobalPlanningCandidate} from '../src/lib/ai/global-planning-context.ts';
import {ensureDestinationCombinationsReady,clearDiscoveredCombinationsCache} from '../src/lib/ai/destination-combination-discovery.ts';
import {clearCandidatePoolCache} from '../src/lib/ai/places-cost-cache/candidate-pool-cache.ts';
import {rejectNumericSelection,matchesSelectionOwner,discardExpiredSelection} from '../src/lib/ai/numeric-selection-authority.ts';
import {withChatPlanningState} from '../src/lib/ai/chat-planning-state.ts';
import {chatRuntimeCopy} from '../src/lib/chat-runtime-copy.ts';
import {prepareTripDateConfirmation} from '../src/lib/ai/trip-date-confirmation.ts';
import {loadEphemeralWorkspace,loadConversationWorkspace} from '../src/lib/conversation-workspace/storage.ts';
Object.defineProperty(globalThis,'navigator',{value:{language:'ja-JP'},configurable:true});
const out=console.log;const adviceEvents=[];const returns=[];const events=[];for(const k of ['log','info','warn'])console[k]=(...args)=>{if(args[0]==='[COMBINATION_ADVICE_RETURN_TRACE]')adviceEvents.push(args[1]);if(args[0]==='[COMBINATION_CHAT_RETURN_TRACE]')returns.push(args[1]);if(String(args[0]).startsWith('[COMBINATION_') && ['[COMBINATION_OPTIONS_DISPLAYED]','[COMBINATION_SESSION_PERSISTED]','[COMBINATION_NUMERIC_ATTEMPT]','[COMBINATION_NUMERIC_REJECTED]'].includes(args[0]))events.push(args);};
const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');
const a=chat.indexOf('      const recs =',chat.indexOf('  const persistPlanningAdviceTurn'));
const b=chat.indexOf('\n    },',a);
const persistAdvice=new Function('d',`with(d){${ts.transpile(chat.slice(a,b),{target:ts.ScriptTarget.ES2022})}}`);
const gs=chat.indexOf('    if (rejectNumericSelection(session, trimmed))'); const ge=chat.indexOf('    // Entry snapshot:',gs); const guard=new Function('d',`with(d){${ts.transpile(chat.slice(gs,ge),{target:ts.ScriptTarget.ES2022})}}`);
function guardActual(h,s,t){let rejected=false;guard({session:s,trimmed:t,rejectNumericSelection,discardExpiredSelection,locale:'ja',msgsRef:{current:[]},chatRuntimeCopy,setText:()=>{},setMsgs:()=>{rejected=true},persistSession:h.persist});return rejected;}
const names=['清水寺','金閣寺','銀閣寺','元離宮二条城','産寧坂','二寧坂','京都博物館','京都美術館','歴史博物館','鉄道博物館','工芸博物館','文化博物館','京都御苑','都市公園','植物園','庭園','緑地公園','森林公園'];
function turn(t,s){const m=mergeTravelContext(s,t);return processAdviceTurn(t,m.session,m.context,undefined,'ja')}
function summary(s){return {pending:s.pendingQuestion?.type,options:s.pendingQuestion?.options.length,offers:s.travelContext?.offeredCombinations?.length,ownerPresent:!!s.pendingQuestion?.selectionOwner,ownerMatch:s.pendingQuestion?matchesSelectionOwner(s,s.pendingQuestion):false,reject1:rejectNumericSelection(s,'1'),reject2:rejectNumericSelection(s,'2'),country:s.travelContext?.destinationCountry,city:s.travelContext?.destination,days:s.travelContext?.days}}
for(const consumed of [false,true])for(const durationMenu of [false,true])for(const plus of [false,true])for(const rich of [false,true]){
clearDiscoveredCombinationsCache();clearCandidatePoolCache();const h=harness(plus);
let r=turn('12月に日本へ旅行に行きたいです。',createEmptySession());let s={...r.session,pendingQuestion:r.route?.pendingQuestion};
s=mergeTravelContext(s,'京都').session;
s=await resolveGlobalPlanningCandidate(s,'ja',async()=>({rawResultCount:1,location:{placeId:'ChIJKyotoAudit',country:'JP',city:'京都',region:'京都',lat:35.01,lng:135.76,formattedName:'京都',displayLabel:'京都'}}));
r=turn('京都',s);s=h.persist({...r.session,pendingQuestion:r.route?.pendingQuestion},[]);
const pool=names.map((name,i)=>({id:`ChIJAuditPlace${i}`,name,sourceLocale:'ja',lat:35.01+i*.0003,lng:135.76,types:[i<6?'tourist_attraction':i<12?'museum':'park'],primaryType:i<6?'tourist_attraction':i<12?'museum':'park',rating:4.6,userRatingCount:10000,address:'Kyoto Japan',businessStatus:'OPERATIONAL'}));
if(rich)for(let i=0;i<6;i++)pool.push({id:`ChIJAuditFood${i}`,name:`料理レストラン${i}`,sourceLocale:'ja',lat:35.01+i*.0003,lng:135.76,types:['restaurant'],primaryType:'restaurant',rating:4.6,userRatingCount:10000,address:'Kyoto Japan',businessStatus:'OPERATIONAL'});
const discoverySession=s;observeCombinationDiscovery(s,null);const diagnosticTrace=createCombinationDiscoveryTrace(combinationCorrelationToken(s),count=>observeCombinationDiscovery(discoverySession,count));
let calls=0;const ready=await ensureDestinationCombinationsReady({diagnosticTrace,destination:'京都',destinationCountry:'JP',locale:'ja',days:4,resolvedDestination:{label:'京都',city:'京都',country:'JP',countryCode:'JP',type:'city',latitude:35.01,longitude:135.76,placeId:'ChIJKyotoAudit',source:'trip_destination',scopeLocked:false},searchPlaces:async()=>{calls++;return {places:pool,error:null}}});
if(durationMenu){const menu=buildNextStepAfterAdviceSelection(USE_DEFAULT_ROUTES,pendingQuestionForDestinationStyleChoice('京都','JP'),s.travelContext,'ja');assert.equal(menu.pendingQuestion.type,'duration_choice');s=h.persist({...s,pendingQuestion:menu.pendingQuestion},[]);}
const helper=advanceAfterPendingSelection('4',s.pendingQuestion,{...s.travelContext,days:4},'ja');assert.equal(helper.contextPatch.offeredCombinations.length,rich?3:2);
// Exercise the actual suspicious return blocks with the real Discovery-backed helper.
// This isolates return construction; it does not claim the full router selected these fallbacks.
const adviceSource=fs.readFileSync('src/lib/ai/destination-advice.ts','utf8');
for(const code of ['consumed_duration_fallback','parsed_duration_fallback']){
 const marker=adviceSource.indexOf('observation.branchCode = "'+code+'"');
 const begin=adviceSource.indexOf('return {',marker);
 const ast=ts.createSourceFile('return.ts',adviceSource.slice(begin),ts.ScriptTarget.Latest,true);
 const end=ast.statements[0].end;
 const body=adviceSource.slice(marker,begin)+adviceSource.slice(begin,begin+end);
 const observation={branchCode:'unset'};
 const result=new Function('d',`with(d){${ts.transpile(body,{target:ts.ScriptTarget.ES2022})}}`)({observation,next:helper,datePatch:{},parsedDays:4,dest:'京都',destLabel:'京都',pending:s.pendingQuestion,ctx:s.travelContext,workingCtx:s.travelContext,session:{...s,lastResolvedPendingQuestion:s.pendingQuestion},mustVisit:null,suggested:null});
 assert.equal(observation.branchCode,code);assert.equal(result.pendingQuestion.options.length,rich?3:2);
 assert.equal(result.contextPatch.offeredCombinations,undefined,'diagnostics must preserve the existing fallback omission');
 traceCombinationAdviceReturn(s,observation,result);
 if(isDebugDiagnosticsEnabled()){const e=adviceEvents.at(-1);assert.equal(e.branchCode,code);assert.equal(e.nextContextPatchOfferedCount,rich?3:2);assert.equal(e.adviceContextPatchOfferedCount,0);}
}

if(consumed){const answer=resolvePendingAnswer('4日間です。',s,s.travelContext);assert.ok(answer);assert.equal(answer.session.lastResolvedPendingQuestion.type,durationMenu?'duration_choice':'ask_days');r=processAdviceTurn('4日間です。',answer.session,{...s.travelContext,...answer.contextPatch},undefined,'ja');}else r=turn('4日間です。',s);
out('PENDING_PATH',JSON.stringify({consumed,type:durationMenu?'duration_choice':'ask_days',plus,groups:rich?3:2,helperOffers:helper.contextPatch.offeredCombinations.length,adviceOffers:r.advice.contextPatch?.offeredCombinations?.length??0}));assert.deepEqual(r.advice.contextPatch?.offeredCombinations,helper.contextPatch.offeredCombinations,'duration helper offers must reach advice before persistence');
persistAdvice({turn:r,baseSession:s,messagesForWorkspace:[],roamieRecToChatItem:x=>x,applyAdviceResultToSession,withChatPlanningState,persistSession:h.persist,logPlanningSuggestionEmit:()=>{}});
s=h.sessionRef.current;
traceCombinationChatReturn(s,'completeAdviceTurn',r.advice);
// Real Discovery/Advice-created offers; repeating duration is not a combination selection.
const fallbackCopies={
 'zh-TW':'我還不確定你想用哪幾組。請回覆組合編號（例如 1、3），或說「可以幫我生成」讓我混搭全部組合。',
 en:'I’m not sure which combinations you want. Reply with their numbers (for example, 1, 3), or say “create the itinerary” to use all combinations.',
 ja:'どの組み合わせをご希望か、まだ確認できていません。番号（例：1、3）を返信するか、すべて使う場合は「旅程を作成して」とお伝えください。',
 ko:'어떤 조합을 원하시는지 아직 확인하지 못했어요. 번호(예: 1, 3)를 보내거나, 모든 조합을 사용하려면 “일정을 만들어 주세요”라고 말씀해 주세요.',
};
for(const locale of ['zh-TW','en','ja','ko']){
 const restored=JSON.parse(JSON.stringify(s));
 const repeated=processAdviceTurn('4日間です。',restored,restored.travelContext,undefined,locale);
 assert.equal(repeated.advice.pendingQuestion.type,'combination_choice');
 assert.equal(repeated.advice.pendingQuestion.options.length,rich?3:2);
 assert.equal(repeated.advice.contextPatch?.offeredCombinations?.length??0,0);
 assert.deepEqual(repeated.session.travelContext.offeredCombinations,s.travelContext.offeredCombinations,'clarification must preserve existing offers');
 assert.equal(repeated.advice.reply,fallbackCopies[locale],'fallback uses active locale after restore/switch');
 for(const option of ['1','2']){assert.equal(rejectNumericSelection(repeated.session,option),false);const selected=processAdviceTurn(option,repeated.session,repeated.session.travelContext,undefined,locale);assert.deepEqual(selected.session.travelContext.selectedCombinationIds,[Number(option)]);}
 const missing={...restored,travelContext:{...restored.travelContext,offeredCombinations:[]}};
 const rejected=processAdviceTurn('4日間です。',missing,missing.travelContext,undefined,locale);
 assert.equal(rejected.session.travelContext.offeredCombinations.length,0);
 assert.equal(rejectNumericSelection(rejected.session,'1'),true);
}

const fallbackStart=chat.indexOf('        const offline = buildPlanningOfflineReply(merged.context, nextSession, trimmed, locale);');const fallbackEnd=chat.indexOf('        return;\n      }',fallbackStart);const fallback=new Function('d',`with(d){${ts.transpile(chat.slice(fallbackStart,fallbackEnd),{target:ts.ScriptTarget.ES2022})}}`);
const legacy={...s,travelContext:{...s.travelContext,offeredCombinations:[]}};let fallbackMessages=[];fallback({merged:{context:legacy.travelContext},nextSession:legacy,trimmed:'4日間です。',locale:'ja',buildPlanningOfflineReply,persistSession:h.persist,setMsgs:m=>fallbackMessages=m,next:[],traceCombinationChatReturn,sessionRef:h.sessionRef});assert.equal((fallbackMessages.at(-1).content.match(/^\d+\./gm)??[]).length,rich?3:2);assert.equal(h.sessionRef.current.travelContext.offeredCombinations.length,0);
if(isDebugDiagnosticsEnabled()){const event=returns.at(-1);assert.equal(event.branchCode,'buildPlanningOfflineReply.sendFallback');assert.equal(event.helperOfferedCount,rich?3:2);assert.equal(event.discoveryCombinationCount,combinationCorrelationToken(discoverySession)===combinationCorrelationToken(s)?(rich?3:2):null);assert.equal(event.sessionOfferedCount,0);assert.equal(event.sessionPersisted,true);assert.equal(event.correlationToken,combinationCorrelationToken(s));}
h.persist(s,[]);
assert.equal(ready.ok,true);assert.equal(s.travelContext.offeredCombinations.length,rich?3:2);assert.equal(summary(s).ownerMatch,true);assert.equal(summary(loadChatSession()).reject1,false);traceCombinationDisplayed(s,(r.advice.reply.match(/^\d+\./gm)??[]).length);assert.equal(guardActual(h,s,'1'),false);assert.equal(guardActual(h,s,'2'),false);assert.equal(guardActual(h,{...s,pendingQuestion:undefined},'1'),true);const ownerless=structuredClone(s);delete ownerless.pendingQuestion.selectionOwner;assert.equal(guardActual(h,ownerless,'1'),true);assert.equal(guardActual(h,s,'99'),true);assert.equal(guardActual(h,{...s,travelContext:{...s.travelContext,tripPurpose:'combination_discovery_failed'}},'1'),true);const missing=structuredClone(s);missing.travelContext.offeredCombinations=[];delete missing.pendingQuestion.selectionOwner;missing.workspaceId=undefined;missing.conversationId=undefined;assert.equal(guardActual(h,missing,'1'),true);
for(const key of ['workspaceId','conversationId','planningSessionId'])assert.equal(guardActual(h,{...s,[key]:'other'},'1'),true);
h.persist(s,[]);const w=plus?loadConversationWorkspace(s.workspaceId):loadEphemeralWorkspace();assert.equal(summary(JSON.parse(JSON.stringify(w.planningSession))).ownerMatch,true);
out('WORKSPACE_RESTORE',JSON.stringify(summary(JSON.parse(JSON.stringify(w.planningSession)))));
out('GUARD',JSON.stringify({one:guardActual(h,s,'1'),two:guardActual(h,s,'2'),textOnly:guardActual(h,{...s,pendingQuestion:undefined,travelContext:{...s.travelContext,offeredCombinations:[]}},'1'),stale:guardActual(h,{...s,planningSessionId:'stale'},'1')}));
for(const choice of ['1','2']){const picked=turn(choice,s);h.persist({...picked.session,pendingQuestion:picked.route?.pendingQuestion},[]);const dated=prepareTripDateConfirmation(h.sessionRef.current,{entry:'direct'});h.persist(dated,[]);const prior=h.calls;await h.send('提案された日程でお願いします。','ja');assert.equal(h.calls-prior,1);assert.deepEqual(picked.session.travelContext.selectedCombinationIds,[Number(choice)]);out('CHOICE',JSON.stringify({choice,trigger:picked.advice.triggerItineraryGeneration,selected:picked.session.travelContext?.selectedCombinationIds,datePending:dated.pendingQuestion?.type,continuations:h.calls-prior,providerSearchCalls:calls}));}

}

if(isDebugDiagnosticsEnabled()) {
 for(const name of ['COMBINATION_OPTIONS_DISPLAYED','COMBINATION_SESSION_PERSISTED','COMBINATION_NUMERIC_ATTEMPT','COMBINATION_NUMERIC_REJECTED'])assert.ok(events.some(e=>e[0]===`[${name}]`));
 for(const reason of ['missing_pending','owner_missing','owner_mismatch','snapshot_mismatch','option_out_of_range','offer_missing','recommendation_failed'])assert.ok(events.some(e=>e[1].reason===reason),reason);
 const allowed=new Set(['correlationToken','menuToken','currentSnapshotToken','pendingType','offeredCount','pendingOptionsCount','workspaceOwnerMatch','conversationOwnerMatch','planningOwnerMatch','ownerMatch','snapshotMatch','inputKind','reason','displayedCount','displayedSnapshotToken','displayedSessionMatch','beforeCorrelationToken','beforeSnapshotToken','persistSucceeded','authoritativeSessionReturned','offeredCountBefore','offeredCountAfter','ownerChanged','snapshotChanged']);
 for(const [,data] of events)for(const key of Object.keys(data))assert.ok(allowed.has(key),key);
 assert.ok(!JSON.stringify(events).includes('ChIJAudit'));assert.ok(!JSON.stringify(events).includes('京都'));
for(const event of returns){assert.deepEqual(Object.keys(event).sort(),['branchCode','correlationToken','discoveryCombinationCount','helperOfferedCount','adviceOfferedCount','sessionOfferedCount','pendingType','pendingOptionsCount','contextPatchPresent','sessionPersisted'].sort());assert.ok(!JSON.stringify(event).includes('京都'));assert.ok(!JSON.stringify(event).includes('ChIJ'));}
 for(const e of adviceEvents){assert.deepEqual(Object.keys(e).sort(),['branchCode','correlationToken','pendingType','lastResolvedPendingType','guardReason','nextOfferedCount','nextContextPatchOfferedCount','adviceOfferedCount','adviceContextPatchOfferedCount','pendingOptionsCount'].sort());assert.ok(!JSON.stringify(e).includes('京都'));assert.ok(!JSON.stringify(e).includes('ChIJ'));}
 assert.ok(adviceEvents.some(e=>e.branchCode==='consumed_duration_structured'));
 assert.ok(adviceEvents.some(e=>e.branchCode==='pending_selection_return'));
} else {assert.equal(events.length,0);assert.equal(returns.length,0);assert.equal(adviceEvents.length,0);}
out('PASS combination selection diagnostics: real discovery 2/3, Chat persistence/guard, Free/Plus, restore, selection/date continuation, safe event schema; enabled='+isDebugDiagnosticsEnabled());
