import { dailyCompleteness } from "../src/lib/ai/daily-completeness.ts";
import { plannerFailureCounts } from "../src/lib/ai/planner-validation-diagnostic.ts";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { comparePlannerSnapshots, logPlannerReplacement, fixedPlannerFailureCodes } from '../src/lib/ai/planner-best-so-far.ts';
import { isPlannerResultBetter } from '../src/lib/ai/ai-day-plan-source.ts';
const source=fs.readFileSync('src/lib/ai/destination-trip-planning.ts','utf8');
const ast=ts.createSourceFile('planner.ts',source,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='resolveTripPlanningDayPlans');
const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const flat=plans=>plans.flatMap(p=>p.entries.map(e=>e.place));
const count=plans=>flat(plans).length;
const pool=Array.from({length:97},(_,i)=>({id:`fixture-${i}`,name:'Fixture',lat:35,lng:139,primaryType:'tourist_attraction',types:['tourist_attraction']}));
function plans(n,valid=false){return [0,1].map(d=>({day:d+1,fixtureValid:valid,entries:pool.slice(d*n,(d+1)*n).map((p,i)=>({place:p,name:p.name,time:['08:30','10:00','12:00','14:00','16:00','18:00','20:00'][i],label:'景點'}))}))}
function validation(p){return {ok:p.every(d=>d.fixtureValid),reasons:p.every(d=>d.fixtureValid)?[]:['invalid_lunch:SECRET_PLACE'],failedDays:p.filter(d=>!d.fixtureValid).map(d=>d.day)}}
async function run({initial=plans(7),rebuilt=plans(0),fallback=plans(2),refill,classicOnly=false,rebuiltPoolCount=10,style='classic_landmarks'}={}){
 const diagnostics=[];let calls=0;let rebuildCalls=0;
 const exports={};
 const result=p=>({composedPlans:p,ranked:flat(p),buckets:[]});
 const context={exports,structuredClone,dailyCompleteness,plannerFailureCounts,console:{info(){}},
  filterRealPlanningPlaces:p=>p,filterExcludedRetailPlaces:p=>p,normalizePlanningPlaces:p=>p,
  isPlannerPoolReady:()=>true,countScenicPlaces:()=>1,shouldSkipPlanningPlacesApi:()=>true,
  rankPlacesForTripPlanning:({places:p})=>result(structuredClone(calls++===0?initial:classicOnly&&p.length!==rebuiltPoolCount?initial:rebuilt)),
  minItemsPerDayForTrip:()=>7,minItemsPerDayForStyle:()=>7,
  validateComposedDayPlans:p=>({ok:p.every(d=>d.entries.length>=7),missingDays:[],overflowDays:[],sparseDays:p.filter(d=>d.entries.length<7).map(d=>d.day)}),
  validateItinerary:validation,validateClassicLandmarkItinerary:validation,
  isItineraryRenderable:p=>p.every(d=>d.fixtureValid),classifyPlanPlaceKind:()=> 'attraction',
  plannerTotalPlaces:count,flattenComposedDayPlanPlaces:flat,countUniqueCanonicalLandmarks:p=>new Set(p.map(x=>x.id)).size,
  comparePlannerSnapshots,isPlannerResultBetter,
  logPlannerReplacement:(...args)=>diagnostics.push(args),
  refillMissingDaySlots:({plans:p,pool:working})=>{if(refill)return structuredClone(refill);p[0].entries=[];working.length=0;return plans(0)},
  ensureAllDayPlansExist:p=>p,enforceStandardDaySlotPlans:p=>p,composedDayPlansToBuckets:()=>[],
  fetchClassicLandmarkPlacesForTrip:async()=>{rebuildCalls++;return pool.slice(0,rebuiltPoolCount)},
  buildComposedDayPlans:()=>structuredClone(fallback),buildBalancedSlowDayPlans:()=>structuredClone(fallback),
  logAiDayPlanRebuild(){},logAiDayPlanFinalValidate(){},
 };
 vm.runInNewContext(code,context);
 const output=await exports.resolveTripPlanningDayPlans({filteredPlaces:pool,days:2,style,profile:{pace:'medium'},context:{},label:'Fixture'});
 return {output,diagnostics,calls,rebuildCalls};
}
const retained=await run();
assert.equal(count(retained.output.composedPlans),14,'14 must survive zero rebuild and worse nonempty fallback');
assert.equal(retained.output.places.length,97,'pool authority follows retained plan, not rebuilt pool');
assert.ok(retained.diagnostics.filter(d=>d[0]!=='initial').every(d=>!d[3].replaced));
assert.equal(retained.output.composedPlans[0].entries.length,7,'mutating refill cannot corrupt best');
const improved=await run({initial:plans(2),rebuilt:plans(7,true),refill:plans(2)});
assert.equal(count(improved.output.composedPlans),14);assert.ok(improved.diagnostics.some(d=>d[0]==='retry'&&d[3].replaced));
const fallback=await run({fallback:plans(7,true)});
assert.equal(count(fallback.output.composedPlans),14);assert.ok(fallback.diagnostics.some(d=>d[0]==='fallback'&&d[3].replaced));
const acceptedRebuild=await run({initial:plans(2),rebuilt:plans(7,true),refill:plans(2),classicOnly:true,rebuiltPoolCount:14});
assert.equal(acceptedRebuild.output.places.length,14);assert.equal(count(acceptedRebuild.output.composedPlans),14);
assert.ok(acceptedRebuild.diagnostics.some(d=>d[0]==='classic_rebuild'&&d[3].replaced));
const success=await run({initial:plans(7,true)});
assert.equal(success.calls,1);assert.equal(success.rebuildCalls,0);assert.equal(count(success.output.composedPlans),14);
// Validation wins over item count; fewer affected days win before score.
const q={valid:false,renderable:false,totalCount:14,perDayCounts:[7,7],canonicalCount:14,affectedDays:2,completeDays:2};
assert.equal(comparePlannerSnapshots(q,{...q,valid:true,totalCount:10},()=>false).replaced,true);
assert.equal(comparePlannerSnapshots(q,{...q,affectedDays:1,totalCount:10},()=>false).replaced,true);
assert.equal(comparePlannerSnapshots({...q,valid:true},{...q,totalCount:20},()=>true).replaced,false);
const captured=[];const warn=console.warn;console.warn=(...a)=>captured.push(a);
try{logPlannerReplacement('fallback',q,q,{replaced:false,reason:'keep_equal'},['invalid_lunch:SECRET_PLACE'],['unknown:SECRET_TOKEN'])}finally{console.warn=warn}
assert.ok(!JSON.stringify(captured).includes('SECRET'));assert.deepEqual(fixedPlannerFailureCodes(['invalid_lunch:SECRET']),['invalid_lunch']);
// Gate and all code outside this inner resolver remain exactly as before this task.
assert.match(source,/planningResult\.candidateInsufficient \?\?/);
assert.match(source,/\(finalRenderable \|\| gracefulDegradationAllowed\) && !candidateInsufficientResult/);
console.log('PASS best-so-far: refill mutation isolation; retry/rebuild regression; 14→0 blocked; fallback validated; improvement accepted; pool authority; successful path unchanged; fixed diagnostics; outer gate structure retained. No network.');
