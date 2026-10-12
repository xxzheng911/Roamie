import { prepareTripDateConfirmation, isCurrentTripDateSnapshot } from "../src/lib/ai/trip-date-confirmation.ts";
import { resolveSuggestedTripDates } from "../src/lib/ai/resolve-suggested-trip-dates.ts";
import { createExplicitCreateLoading } from "../src/lib/ai/explicit-create-loading.ts";
import { planCorrelationToken } from "../src/lib/ai/generated-plan-handoff-diagnostic.ts";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { beginTripCreation, isExplicitTripCreationTurn, shouldPersistGeneratedPlan, createGeneratedPlanHandoff, generatedPlanIdentity } from '../src/lib/ai/generated-plan-handoff.ts';

const creation=beginTripCreation({},'plan_ai_create','action-fixture');
for(const styleReselect of [false,true]) assert.equal(shouldPersistGeneratedPlan({authority:creation.tripCreationAuthority,generationId:'action-fixture',styleReselect}),true);
for(const text of ['幫我規劃東京兩天行程','建立行程','用 AI 建立行程']) assert.equal(isExplicitTripCreationTurn(text),true);
for(const styleReselect of [false,true]) assert.equal(shouldPersistGeneratedPlan({styleReselect}),false);
assert.equal(shouldPersistGeneratedPlan({explicitCreate:true,styleReselect:true}),true);
assert.equal(shouldPersistGeneratedPlan({authority:creation.tripCreationAuthority,generationId:'different'}),false);

// Execute the actual Chat handoff closure, not a mocked recommendation provider.
const source=fs.readFileSync('src/routes/_app.chat.tsx','utf8');
const ast=ts.createSourceFile('chat.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let bridge, direct, renderer, handler;
function visit(n){
 if(ts.isBinaryExpression(n)&&n.left.getText(ast)==='persistGeneratedPlanRef.current')bridge=n.right;
 if(ts.isBinaryExpression(n)&&n.left.getText(ast)==='runDirectItineraryRef.current')direct=n.right;
 if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='renderDestinationReply')renderer=n.initializer;
 if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='handleGenerateItinerary')handler=n.initializer;
 ts.forEachChild(n,visit);
}visit(ast);
assert.ok(bridge&&direct&&renderer&&handler);
function evaluate(text,context){return vm.runInNewContext(ts.transpileModule(`(${text})`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,context)}
let saved=0,navigated=0,replanned=0,fail=false,stale=false;
const dayPlan={days:2,items:Array.from({length:14},(_,i)=>({day:1+Math.floor(i/7),id:i}))};
const explicitDates=resolveSuggestedTripDates({days:2,userText:'2026/12/15'});
const session={travelContext:{interests:[],startDate:explicitDates.startDate,endDate:explicitDates.endDate,dateProvenance:explicitDates},planningSessionId:'fixture',planVersion:2,currentDayPlan:dayPlan,phase:'recommend',tripStartDate:'2026-12-15',tripEndDate:'2026-12-16',recommendedPlaces:[{fixture:true}]};
const messages=[];const loading=[];const errors=[];
const context={
 pauseForTripDates:(s,m,c)=>Boolean(prepareTripDateConfirmation(s,c)),
 explicitCreateLoading:createExplicitCreateLoading(()=>{},()=>{}),
 planCorrelationToken,
 logGeneratedPlanHandoff:()=>{},
 generatedPlanHandoffRef:{current:createGeneratedPlanHandoff()},activeGenerationRequestIdRef:{current:null},
 sessionRef:{current:session},setGenerating:v=>loading.push(v),
 setMsgs:fn=>errors.push(fn([])),chatRuntimeCopy:()=> 'failure',locale:'zh-TW',logTripLifecycle:()=>{},
 handleGenerateItinerary:async (ready,conversation,ownership)=>{
  assert.equal(ready.currentDayPlan,dayPlan);assert.equal(ready.tripStartDate,session.tripStartDate);
  assert.equal(ready.recommendedPlaces,session.recommendedPlaces);assert.equal(ready.phase,'ready');
  assert.equal(conversation,messages);assert.equal(ownership.isCurrent(),!stale);
  if(!ownership.isCurrent())return;
  await Promise.resolve();
  if(fail){errors.push('save_failed');return;} // Existing handler owns errors, never navigates on failed save.
  saved++;navigated++;
 },
};
const persist=evaluate(bridge.getText(ast),context);
const id=generatedPlanIdentity(session,'unused');
await Promise.all([persist(session,messages,id),persist(session,messages,id)]);
await persist(session,messages,id);
assert.equal(saved,1);assert.equal(navigated,1);assert.deepEqual(loading,[true,false]);
assert.equal(context.activeGenerationRequestIdRef.current,null);
fail=true;await persist(session,messages,'failed');await persist(session,messages,'failed');
assert.equal(saved,1);assert.equal(navigated,1);assert.ok(errors.includes('save_failed'));
fail=false;stale=true;context.sessionRef.current={planningSessionId:'new'};
await persist(session,messages,'stale');assert.equal(saved,1);
stale=false;context.sessionRef.current=session;
context.activeGenerationRequestIdRef.current='other';await persist(session,messages,'busy');assert.equal(saved,1);
context.activeGenerationRequestIdRef.current=null;

// Actual direct/confirm/trigger entry must return before preparation when a plan exists.
const directContext={...context,logTripRuntime:()=>{},chatLoading:true,generating:true,
 beginTripCreation,requireAuthForAction:()=>true,persistGeneratedPlanRef:{current:persist},generatedPlanIdentity,
 prepareDirectItineraryFlow:()=>{replanned++;throw Error('must not replan')},crypto:{randomUUID:()=> 'fresh'},
};
const run=evaluate(direct.getText(ast),directContext);
for(const entry of ['advice','direct_intent'])await run({...session,tripCreationAuthority:{generationId:id,intentSource:'direct_itinerary_create',explicitCreate:true}}, {},messages,entry);
assert.equal(replanned,0);assert.equal(saved,1);

// Execute the actual renderer's creation branch; preview stays in the renderer.
const creationBranch=renderer.body.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(ast).includes('shouldPersistGeneratedPlan'));
assert.ok(creationBranch);
let handoffs=0;
const renderContext={resultAuthority:creation.tripCreationAuthority,resultOwnerId:creation.tripCreationAuthority.generationId,handoffCorrelation:{correlationToken:planCorrelationToken("fixture")},storedDayPlan:dayPlan,itineraryRenderSuccess:true,shouldPersistGeneratedPlan,
 conversation:[{role:'user',content:'幫我排完整東京行程'}],styleReselect:false,isUserConfirmingItinerary:()=>false,userText:'經典地標',activeSession:session,
 settlePlaceCredits:async()=>{},persistGeneratedPlanRef:{current:async(s)=>{assert.equal(s.currentDayPlan,dayPlan);handoffs++}},
 sessionWithRecs:session,recs:session.recommendedPlaces,baseConversation:messages,generatedPlanIdentity,sessionForPlan:{...session,...creation},flowSessionId:'fixture',
};
const render=evaluate(`async () => {${creationBranch.getText(ast)};return false;}`,renderContext);
assert.equal(await render(),true);assert.equal(handoffs,1);
renderContext.styleReselect=true;assert.equal(await render(),true);assert.equal(handoffs,2);
renderContext.sessionForPlan=session;renderContext.resultAuthority=undefined;assert.equal(await render(),false);
renderContext.styleReselect=false;renderContext.conversation=[{role:'user',content:'推薦景點'}];assert.equal(await render(),false);

// The real busy guard accepts only the active owner, without weakening canGenerate.
const gate=handler.body.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(ast).includes('canGenerateItinerary'));
const guardContext={activeSession:session,canGenerateItinerary:()=>true,generating:true,ownership:{isCurrent:()=>true}};
const guard=evaluate(`() => ${gate.expression.getText(ast)}`,guardContext);
assert.equal(guard(),false);guardContext.ownership.isCurrent=()=>false;assert.equal(guard(),true);
guardContext.generating=false;guardContext.ownership.isCurrent=()=>true;guardContext.canGenerateItinerary=()=>false;assert.equal(guard(),true);
assert.match(handler.getText(ast),/const generationId = ownership\?\.generationId/);
assert.match(handler.getText(ast),/hasDayPlan: Boolean\(dayPlan\?\.items.length\)/);
assert.match(handler.getText(ast),/if \(dayPlan\?\.items.length\) \{\s*const rawItineraryItems = buildItineraryFromDayPlan/);
const save=handler.getText(ast).indexOf('await confirmSaveTrip');const nav=handler.getText(ast).indexOf('const navigation = navigate');
assert.ok(save>=0&&nav>save);assert.ok(handler.getText(ast).lastIndexOf('catch (')>nav);
assert.ok(!bridge.getText(ast).includes('Capacitor'));assert.ok(!renderer.getText(ast).includes('getPlatform'));
// Execute the real persistence await, navigation await and original error handler.
const persistenceTry=handler.body.statements.find(ts.isTryStatement);
const savedStatement=persistenceTry.tryBlock.statements.find(n=>n.getText(ast).startsWith('const saved = await confirmSaveTrip'));
const navigationStatement=persistenceTry.tryBlock.statements.find(n=>n.getText(ast).startsWith('const navigation = navigate'));
const navigationAwait=persistenceTry.tryBlock.statements.find(n=>n.getText(ast)==='await Promise.resolve(navigation);');
let actualNav=0,actualErrors=0,saveReject=true;
const persistenceContext={isCurrentTripDateSnapshot,sessionRef:{current:session},locale:'zh-TW',draftPayload:{dayPlan},cover:{},generationId:'fixture',lifecycleFailureCode:'save_failed',
 confirmSaveTrip:async(payload,source,options)=>{assert.equal(payload.dayPlan,dayPlan);assert.equal(options.generationId,'fixture');if(saveReject)throw Error('fixture save failure');return {id:'saved-fixture'}},
 navigate:()=>{actualNav++},tripDetailNavigateOptions:id=>({id}),
 logTripLifecycle:()=>{},abandonPendingCover:null,logSelectionStage:()=>{},selectionGenerateStage:'save',
 console:{warn:()=>{}},logItinerarySaveFailed:()=>{},logItineraryFailureReason:()=>{},
 persistSession:()=>{},activeSession:session,setMsgs:fn=>{actualErrors+=fn([]).length},chatRuntimeCopy:()=> 'save error',
};
const persistence=evaluate(`async () => {try {${savedStatement.getText(ast)};${navigationStatement.getText(ast)};${navigationAwait.getText(ast)}} ${persistenceTry.catchClause.getText(ast)}}`,persistenceContext);
await persistence();assert.equal(actualNav,0);assert.equal(actualErrors,1);
saveReject=false;await persistence();assert.equal(actualNav,1);assert.equal(actualErrors,1);
console.log('PASS explicit/confirm/Plan Form/multi-turn creation; preview/style no save; actual Chat handoff/direct branches; same dayPlan/dates/candidates; no replanner; duplicate/busy/stale/failure; shared Web/iOS. No network.');
