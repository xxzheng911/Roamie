import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const logs=[];
const source=fs.readFileSync('src/lib/ai/trip-action-diagnostic.ts','utf8');
const exports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto:{randomUUID:()=> 'abcdef12-0000-0000-0000-000000000000'},console:{warn:(...args)=>logs.push(args)}});
const {receiveTripAction,logTripAction,chatActionSource}=exports;
for(const s of exports.actionSources){const a=receiveTripAction(s);assert.equal(a.actionSource,s);assert.equal(JSON.parse(logs.at(-1)[1]).generationBound,false);}
assert.equal(chatActionSource('生成行程'),'chat_generate_trip');assert.equal(chatActionSource('重新生成'),'chat_regenerate');assert.equal(chatActionSource('private prompt'),'unknown');
for(const s of ['plan_ai_button','chat_generate_trip']){const action=JSON.parse(JSON.stringify(receiveTripAction(s)));logTripAction('action_bound',action,true,'019fa3c0');assert.deepEqual(JSON.parse(logs.at(-1)[1]),{actionSource:s,hasCreateAuthority:true,actionToken:'abcdef12',correlationToken:'019fa3c0',generationBound:true});}
const style=receiveTripAction('style_selection');assert.equal(JSON.parse(logs.at(-1)[1]).hasCreateAuthority,false);assert.equal(style.explicitCreate,undefined);
logTripAction('handoff_received',{actionSource:'SECRET',actionToken:'SECRET',token:'SECRET'},false,'SECRET');assert.ok(!JSON.stringify(logs.at(-1)).includes('SECRET'));
const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');
assert.ok(chat.includes('return selectTripActionOwner(current, (style || source === "unknown") && current.tripActionDiagnostic ? current.tripActionDiagnostic : action)!;'));
assert.match(chat,/tripActionDiagnostic: sessionForPlan.tripActionDiagnostic/);
assert.match(chat,/actionDiagnostic: captureChatAction\(s\)/);
assert.match(chat,/actionDiagnostic: captureChatAction\(text\)/);
const plan=fs.readFileSync('src/routes/_app.plan.tsx','utf8');assert.match(plan,/startPlanChat\(true, action, authority\)/);assert.match(plan,/preparedSession.tripActionDiagnostic = actionDiagnostic/);
const diag=fs.readFileSync('src/lib/ai/generated-plan-handoff-diagnostic.ts','utf8');assert.match(diag,/stage === 'planner_start' \|\| stage === 'received'/);
console.log('PASS action enums, UI callback wiring, authority observation only, late correlation binding, serialized metadata, style origin preservation, redaction.');

// Execute the actual UI callback capture, including a restored session and style selection.
const callback=chat.slice(chat.indexOf('  const captureChatAction ='),chat.indexOf('  const send = async'));
const current={tripCreationAuthority:{explicitCreate:true},tripActionDiagnostic:receiveTripAction('plan_ai_button'),pendingQuestion:{type:'ask_trip_style'}};
const capture=vm.runInNewContext(ts.transpileModule(callback+';captureChatAction',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{restorePendingPlanAiOwner:(v)=>v,loadChatSession:()=>current,selectTripActionOwner:(_s,a)=>a,sessionRef:{current},parseAskTripStyleSelection:v=>v==='style'?'classic':null,receiveTripAction,chatActionSource});
assert.equal(capture('style'),current.tripActionDiagnostic);
assert.equal(JSON.parse(logs.at(-1)[1]).actionSource,'style_selection');
current.pendingQuestion=undefined;
assert.equal(capture('style'),current.tripActionDiagnostic);
assert.equal(JSON.parse(logs.at(-1)[1]).actionSource,'style_preview');
assert.equal(capture('重新生成').actionSource,'chat_regenerate');
assert.equal(capture('生成行程').actionSource,'chat_generate_trip');
assert.equal(current.tripCreationAuthority.explicitCreate,true);
console.log('PASS executed composer callback: style selection/preview preserve original action, regenerate/generate capture distinct actions, authority unchanged.');

assert.equal(capture("date answer"),current.tripActionDiagnostic);
