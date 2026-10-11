import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync('src/lib/ai/candidate-insufficient-diagnostic.ts', 'utf8');
const exports = {}, logs = [];
vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {exports, console:{warn:(...args)=>logs.push(args)}});
const planner = fs.readFileSync('src/lib/ai/destination-trip-planning.ts','utf8');
const start = planner.indexOf('    logCandidateDiagnostic("CANDIDATE_INSUFFICIENT_BLOCK_SAVE"');
const call = planner.slice(start, planner.indexOf('\n    });',start)+7);
for (const [available, affected, renderable] of [[3,[2],false],[6,[],true]]) {
  vm.runInNewContext(call, {logCandidateDiagnostic:exports.logCandidateDiagnostic,
    candidateInsufficientResult:{requiredCount:6,availableCount:3,affectedDays:[2]},
    planningResult:{candidateInsufficient:{}}, finalDayCounts:affected.length?[3,0]:[3,3],
    paceHint:'medium',finalRenderable:renderable,gracefulDegradationAllowed:false,
    availableCanonicalFinal:available,requiredCanonicalFinal:6,affectedDaysFinal:affected,
    dailyCompleteness:()=>({minimumPlacesPerDay:7})});
  const data=JSON.parse(logs.at(-1)[1]);
  assert.equal(data.candidateInsufficientFromEarlyState,true);
  assert.equal(data.candidateInsufficientRecomputedFinal,available<6);
  assert.equal(data.finalRenderable,renderable);
}
exports.logCandidateDiagnostic('CANDIDATE_INSUFFICIENT_RESULT',{requiredCount:6,availableCount:6,affectedDaysCount:0,dayCounts:[3,3],pace:'medium',candidateInsufficientFromEarlyState:false,placeId:'SECRET',prompt:'SECRET',userId:'SECRET',token:'SECRET'});
const sufficient=JSON.parse(logs.at(-1)[1]);
assert.equal(sufficient.candidateInsufficientFromEarlyState,false);
assert.equal(sufficient.finalRenderable,undefined);
assert.ok(!JSON.stringify(logs).includes('SECRET'));
exports.logCandidateDiagnostic('CANDIDATE_INSUFFICIENT_RESULT',{dayCounts:['SECRET',NaN,-1],pace:'SECRET',requiredCount:'SECRET'});
assert.ok(!logs.at(-1)[1].includes('SECRET'));
// Gate still prefers the early state; this task only observes that behavior.
assert.match(planner,/planningResult\.candidateInsufficient \?\?/);
assert.match(planner,/\(finalRenderable \|\| gracefulDegradationAllowed\) && !candidateInsufficientResult/);
assert.equal((planner.match(/logCandidateDiagnostic\("CANDIDATE_INSUFFICIENT_RESULT"/g)||[]).length,2);
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,console:{warn(){throw Error('bridge')}}});
assert.doesNotThrow(()=>exports.logCandidateDiagnostic('CANDIDATE_INSUFFICIENT_RESULT',{dayCounts:[]}));
console.log('PASS: still insufficient, refill sufficient with stale early flag, sufficient state, redaction, unchanged gate, logging failure isolation.');
