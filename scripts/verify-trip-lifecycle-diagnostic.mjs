import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const emitted=[];const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/ai/trip-lifecycle-diagnostic.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,console:{warn:(...args)=>emitted.push(args)}});
const stages=['final_planner_gate','destination_resolution','draft_payload_created','save_started','save_result','navigation_started','navigation_completed','aborted'];
for(const stage of stages){exports.logTripLifecycle(stage,{success:true,count:4,hasTripId:true,renderable:false,failureCode:'save_failed',prompt:'SECRET',token:'SECRET',payload:{email:'SECRET'},userId:'SECRET'});const [marker,json]=emitted.at(-1);assert.equal(marker,`[AI_TRIP_LIFECYCLE] ${stage}`);assert.ok(!json.includes('SECRET'));assert.equal(JSON.parse(json).failureCode,stage==='aborted'?'save_failed':undefined)}
for(const failureCode of ['planner_not_renderable','candidate_insufficient','destination_unresolved','draft_payload_failed','save_failed','navigation_failed','generation_failed','entry_blocked']){exports.logTripLifecycle('aborted',{failureCode});assert.equal(JSON.parse(emitted.at(-1)[1]).failureCode,failureCode)}
exports.logTripLifecycle('aborted',{failureCode:'SECRET',count:NaN,success:'SECRET'});assert.equal(emitted.at(-1)[1],'{}');const n=emitted.length;exports.logTripLifecycle('SECRET');assert.equal(emitted.length,n);
const chat=fs.readFileSync('src/routes/_app.chat.tsx','utf8');
const positions=['logTripLifecycle("draft_payload_created"','logTripLifecycle("save_started"','await confirmSaveTrip(draftPayload, "chat"','logTripLifecycle("save_result", { success: true','logTripLifecycle("navigation_started"','const navigation = navigate(tripDetailNavigateOptions(saved.id))','await Promise.resolve(navigation)','logTripLifecycle("navigation_completed"'].map(s=>chat.indexOf(s));assert.ok(positions.every((p,i)=>p>=0&&(!i||p>positions[i-1])));
assert.match(chat,/if \(lifecycleFailureCode === "save_failed"\) logTripLifecycle\("save_result", \{ success: false/);
const planner=fs.readFileSync('src/lib/ai/destination-trip-planning.ts','utf8');assert.ok(planner.indexOf('logTripLifecycle("final_planner_gate"')>planner.indexOf('logItineraryDeliveryAllowed(validation, dayCountsOfPlans(composedPlans))'));
// A broken logging bridge must not throw into business logic.
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/ai/trip-lifecycle-diagnostic.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,console:{warn(){throw Error('bridge')}}});assert.doesNotThrow(()=>exports.logTripLifecycle('save_started'));
console.log('PASS fixed stages/codes, allowlisted primitive fields, redaction, final gate placement, save/navigation ordering, logging cannot throw. No network.');
