import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { hasPendingTripCreationHandoff, bindTripCreationAuthority, beginTripCreation, shouldPersistGeneratedPlan } from '../src/lib/ai/generated-plan-handoff.ts';
const pending={intentSource:'plan_ai_create',explicitCreate:true};
const authority=bindTripCreationAuthority(pending,'generation-fixture');
assert.equal(authority.generationId,'generation-fixture');assert.equal(pending.generationId,undefined);
assert.equal(bindTripCreationAuthority(authority,'other'),undefined);
assert.equal(bindTripCreationAuthority(undefined,'generation-fixture'),undefined);
assert.equal(hasPendingTripCreationHandoff({pendingHandoff:true,tripCreationAuthority:authority}),true);
assert.equal(hasPendingTripCreationHandoff({pendingHandoff:true,tripCreationAuthority:authority},authority.generationId),false);
assert.equal(hasPendingTripCreationHandoff({pendingHandoff:true}),false);
assert.equal(hasPendingTripCreationHandoff({pendingHandoff:false,tripCreationAuthority:authority}),false);
const restored=JSON.parse(JSON.stringify(authority));assert.equal(shouldPersistGeneratedPlan({authority:restored,generationId:'generation-fixture',styleReselect:true}),true);
// Execute actual async wrapper: a stale/replaced session cannot drop captured authority.
const file=fs.readFileSync('src/lib/ai/destination-place-recommendation.ts','utf8');
const ast=ts.createSourceFile('wrapper.ts',file,ts.ScriptTarget.Latest,true);
const wrapper=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='buildDestinationMustVisitRecommendation');
let release,calls=0;const dayPlan={items:Array(14).fill({}),days:2};
const ctx={bindTripCreationAuthority,buildDestinationMustVisitRecommendationResult:async()=>{calls++;await new Promise(r=>release=r);return {dayPlan}}};
const run=vm.runInNewContext(ts.transpileModule(`(${wrapper.getText(ast).replace('export ','')})`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,ctx);
const session=beginTripCreation({},'plan_ai_create','generation-fixture');
const result=run({session,generationId:'generation-fixture'});
session.tripCreationAuthority=undefined;release();const delivered=await result;
assert.equal(delivered.dayPlan,dayPlan);assert.equal(calls,1);
assert.equal(delivered.tripCreationAuthority.explicitCreate,true);
assert.equal(shouldPersistGeneratedPlan({authority:delivered.tripCreationAuthority,generationId:delivered.generationId,styleReselect:true}),true);
const preview=run({session:{},generationId:'preview'});release();assert.equal((await preview).tripCreationAuthority,undefined);
const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');const send=chat.slice(chat.indexOf('const send = async'),chat.indexOf('const handleGenerateItinerary = async'));
// Planner 選點模式第 7 輪（#PL-FIX-T7，使用者裁定）在 send() 前段加入 `selectionConfirmedSwitch:` 換城市閘門，
// 其中先呼叫 isPlanningSelectionMode(session)；該閘門只會「先問」或放行，不會生成行程。
// 因此把這個閘門區塊排除後，仍要求 beginTripCreation 早於所有 selection 分支，且閘門內不得觸發生成。
const switchGateAt=send.indexOf('selectionConfirmedSwitch: {');
let sendWithoutSwitchGate=send;
if(switchGateAt>=0){
  let depth=0,end=-1;
  for(let i=send.indexOf('{',switchGateAt);i<send.length;i++){if(send[i]==='{')depth++;else if(send[i]==='}'&&--depth===0){end=i+1;break}}
  assert.ok(end>switchGateAt,'selectionConfirmedSwitch block must be balanced');
  const gate=send.slice(switchGateAt,end);
  assert.doesNotMatch(gate,/handleGenerateItinerary\(|runDirectItinerary(?:Ref\.current)?\(|beginTripCreation\(/,'selection switch gate must not generate or create trips');
  sendWithoutSwitchGate=send.slice(0,switchGateAt)+send.slice(end);
}
assert.ok(sendWithoutSwitchGate.indexOf('session = beginTripCreation(')>=0);
assert.ok(sendWithoutSwitchGate.indexOf('session = beginTripCreation(')<sendWithoutSwitchGate.indexOf('isPlanningSelectionMode(session)'));
assert.match(chat,/renderDestinationReply\(summary, recommendations, payload, contextPatch, dayPlan, returnedAuthority, returnedGenerationId\)/);
assert.match(chat,/if \(!newCreationHandoff && uiCache\?\.msgs\?\.length\)/);
assert.match(chat,/if \(!newCreationHandoff && chatLifecycleEstablishedRef.current\)/);
assert.match(chat,/if \(!newCreationHandoff && shouldStartFreshChatSession\(search\)\)/);
assert.ok(chat.indexOf('hasPendingTripCreationHandoff(pendingCreation')<chat.indexOf('const uiCache = consumeChatUiCache()'));
const hydrationPrefix=chat.slice(chat.indexOf('const pendingCreation = loadChatSession();'),chat.indexOf('if (!newCreationHandoff && uiCache?.msgs?.length)'));
const hydrated={loadChatSession:()=>({pendingHandoff:true,tripCreationAuthority:authority}),hasPendingTripCreationHandoff,consumedPlanCreationRef:{current:undefined},planHandoffStartedRef:{current:true},sessionRef:{current:{}},setSession:()=>{},consumeChatUiCache:()=>({msgs:['old']}),logGeneratedPlanHandoff:()=>{},planCorrelationToken:()=> '12345678'};
const hydrate=vm.runInNewContext(ts.transpileModule(`() => {${hydrationPrefix};return newCreationHandoff;}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,hydrated);
assert.equal(hydrate(),true);assert.equal(hydrated.sessionRef.current.tripCreationAuthority,authority);
assert.equal(hydrated.planHandoffStartedRef.current,false);assert.equal(hydrate(),false);
assert.match(chat,/authority: resultAuthority/);assert.match(chat,/generationId: resultOwnerId/);
console.log('PASS late binding, mismatch fail closed, captured request authority survives session replacement, result envelope, style priority, preview isolation, no second planner, entry capture precedes early dispatch.');
