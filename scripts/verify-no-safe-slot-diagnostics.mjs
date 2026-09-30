import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { normalizeSameDayClockConflicts, repairCrossDayGeographicCohesion } from "../src/lib/ai/cross-day-geographic-cohesion.ts";
import { serializeNormalizationFailures, sanitizeNormalizationFailures, SLOT_REJECTION_COUNTS } from "../src/lib/analytics/timeline-normalization-failures.server.ts";
import { buildItineraryValidatorFailureTelemetry, sanitizeItineraryFailureTelemetry } from "../src/lib/analytics/itinerary-failure-telemetry.ts";
import { LEGAL_DAY_TIME_SLOTS } from "../src/lib/ai/day-time-slots.ts";
import { isClearlyClosedAtSlot } from "../src/lib/ai/itinerary-validator/place-checks.ts";
import { resolveNightlifeClassification } from "../src/lib/ai/nightlife-classification.ts";
import { validateItineraryPlan, setItineraryValidatorEnabledOverride } from "../src/lib/ai/itinerary-validator/index.ts";
const path="src/lib/ai/cross-day-geographic-cohesion.ts";
const base=execFileSync("git",["show","2cf69be8f0d747073d443a46d047451470f1793f:"+path],{encoding:"utf8"});
const snippet=base.slice(base.indexOf("function clockMinutes("),base.indexOf("function membershipChanged("));
const baselineContext={exports:{},LEGAL_DAY_TIME_SLOTS,isClearlyClosedAtSlot,resolveNightlifeClassification,logAiPipeline:()=>{}};
vm.runInNewContext(ts.transpileModule(snippet,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,baselineContext);
const old=baselineContext.exports.normalizeSameDayClockConflicts;
// Pin the approved diagnostic patch too: adapter output must equal its exact metadata.
const diagnosticBase=execFileSync("git",["show","32d713840cf2af048ce4b332e2f947119445984f:"+path],{encoding:"utf8"});
const originalSanitizer=execFileSync("git",["show","32d713840cf2af048ce4b332e2f947119445984f:src/lib/analytics/timeline-normalization-failures.ts"],{encoding:"utf8"}).replace(/^import .*;\n/,"");
const diagnosticContext={...baselineContext,exports:{},MAX_ITINERARY_DAYS:30};
vm.runInNewContext(ts.transpileModule(originalSanitizer+diagnosticBase.slice(diagnosticBase.indexOf("function clockMinutes("),diagnosticBase.indexOf("function membershipChanged(")),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,diagnosticContext);
const shared=readFileSync(path,"utf8");
assert.doesNotMatch(shared,/from ["'][^"']*(?:analytics|\.server)/);
assert.doesNotMatch(shared,/failed_entry_time|candidate_slots_evaluated|rejected_(?:order|used|closed|window)|sanitizeNormalizationFailures/);

const clone=x=>JSON.parse(JSON.stringify(x));
function entry(time,label="景點",extra={}) {return {time,label,name:"PRIVATE_PLACE",place:{id:"PRIVATE_ID",googlePlaceId:"PRIVATE_GOOGLE",name:"PRIVATE_PLACE",address:"PRIVATE_ADDRESS",lat:35,lng:129,primaryType:"tourist_attraction",types:["tourist_attraction"],businessStatus:"OPERATIONAL",todayHoursLabel:"",...extra}};}
function validate(entries,day) {return validateItineraryPlan({plans:[{day,entries}],requestedDays:day,creationPath:"selected_places",placeAuthority:"selected_only",style:"mixed",plannedDate:"2026-10-01",validationStage:"final"});}
setItineraryValidatorEnabledOverride(true);
function check(name,entries,day,safe) {
 const before=clone(entries),events=[];
 const a=old(entries,"2026-10-01",day),b=normalizeSameDayClockConflicts(entries,"2026-10-01",day,x=>events.push(...serializeNormalizationFailures([x])));
 const originalEvents=[];
 const originalResult=diagnosticContext.exports.normalizeSameDayClockConflicts(entries,"2026-10-01",day,x=>originalEvents.push(x));
 assert.deepEqual(clone(events),clone(originalEvents),name+" pinned diagnostic metadata/count parity");
 assert.deepEqual(clone(b),clone(originalResult),name+" diagnostic patch result parity");
 assert.deepEqual(clone(b),clone(a),name+" exact result parity");assert.equal(b.safe,safe,name);
 assert.deepEqual(clone(entries),before,name+" input unchanged");
 assert.deepEqual(clone(validate(b.entries,day)),clone(validate(a.entries,day)),name+" validator parity");
 assert.deepEqual(clone(normalizeSameDayClockConflicts(entries,"2026-10-01",day,()=>{throw new Error("PRIVATE_THROW");})),clone(a),name+" diagnostic throw isolation");
 if(safe)assert.equal(events.length,0);
 else {
  assert.equal(events.length,1);const d=events[0];assert.equal(d.day,day);
  assert.equal(d.candidate_slots_evaluated,LEGAL_DAY_TIME_SLOTS.length);
  assert.equal(SLOT_REJECTION_COUNTS.reduce((sum,k)=>sum+d[k],0),d.candidate_slots_evaluated);
  assert.equal(d.rejected_used,0,"ordering precedes used check; no double attribution");
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE|tourist|night_market|restaurant|address|category/);
 }
 console.log("PASS "+name);return events[0];
}
// Production-shaped clock/day counts; synthetic constraints, NOT a replay of the user's places.
const lunch=check("A Day 3 lunch conflict",[entry("09:30"),entry("11:00"),entry("12:00","午餐"),entry("14:00"),entry("12:00","午餐")],3,false);
assert.equal(lunch.failed_entry_time,"12:00");assert.ok(lunch.rejected_window>0);
const dinner=check("B Day 4 dinner conflict",[entry("09:30"),entry("12:00","午餐"),entry("18:30","晚餐"),entry("20:00"),entry("18:30","晚餐")],4,false);
assert.equal(dinner.failed_entry_time,"18:30");assert.ok(dinner.rejected_window>0);
const closed=check("C closed-hours exhaustion",Array.from({length:4},()=>entry("16:00","景點",{primaryType:"museum",types:["museum"],todayHoursLabel:"10:00-18:00"})),1,false);
assert.ok(closed.rejected_closed>0);
check("D nightlife exhaustion",Array.from({length:4},()=>entry("19:00","夜間",{primaryType:"night_market",types:["night_market"]})),1,false);
const used=check("E used-slot exhaustion",[...LEGAL_DAY_TIME_SLOTS.map(t=>entry(t)),entry("20:30")],1,false);
assert.equal(used.rejected_order,LEGAL_DAY_TIME_SLOTS.length);
const ordering=check("F ordering exhaustion",[entry("23:00"),entry("09:30")],1,false);
assert.equal(ordering.rejected_order,LEGAL_DAY_TIME_SLOTS.length);
check("G safe normalization",[entry("09:30"),entry("09:30")],1,true);
// Overlapping failure: a closed and out-of-window slot is attributed to closed first.
const overlap=check("first rejection closed before window",[entry("12:00","午餐"),entry("12:00","午餐",{todayHoursLabel:"closed"})],1,false);
assert.ok(overlap.rejected_closed>0);assert.equal(overlap.rejected_window,0);
function internal(x) { return {...x, failedTime:x.failed_entry_time,evaluated:x.candidate_slots_evaluated,order:x.rejected_order,used:x.rejected_used,closed:x.rejected_closed,window:x.rejected_window}; }
const poison={...lunch,place:"PRIVATE_PLACE",type:"PRIVATE_TYPE",prompt:"PRIVATE_PROMPT",user_id:"PRIVATE_USER",openingHours:"PRIVATE_HOURS",request_id:"PRIVATE_REQUEST",reason:"PRIVATE_REASON"};
const meta=buildItineraryValidatorFailureTelemetry({failedRules:[{code:"timeline_conflict"}],requestedDayCount:5,perDayPlaceCounts:[5,5,5,5,4],timelineNormalization:{status:"no_safe_slot",affectedDays:[3,4],failures:[internal(poison),internal(dinner)]}});
const stored=sanitizeItineraryFailureTelemetry(meta);
assert.deepEqual(stored.timeline_normalization_failures,[lunch,dinner]);assert.doesNotMatch(JSON.stringify(stored),/PRIVATE/);
assert.deepEqual(stored.timeline_normalization,{status:"no_safe_slot",affected_days:[3,4]});
assert.equal(sanitizeNormalizationFailures(Array.from({length:10},(_,i)=>({...lunch,day:i+1}))).length,4);
assert.equal(sanitizeNormalizationFailures([{...lunch,rejected_order:0.5}]).length,0);
assert.equal(sanitizeNormalizationFailures([{...lunch,candidate_slots_evaluated:999}]).length,0);
assert.equal(sanitizeNormalizationFailures([{...lunch,day:31}]).length,0);
assert.equal(sanitizeNormalizationFailures([{...lunch,failed_entry_time:"PRIVATE"}])[0].failed_entry_time,undefined);
assert.equal(sanitizeItineraryFailureTelemetry({...meta,timeline_normalization:{status:"safe",affected_days:[3,4]}}).timeline_normalization_failures,undefined);
console.log("PASS H privacy/schema cap/attribution and I diagnostics throw isolation");
// Execute existing geographic-repair fixture through the full observation->analytics path.
const X={lat:35.18,lng:129.08},Y={lat:35.05,lng:129.03};
const plans=[1,2].map(day=>({day,entries:Array.from({length:5},(_,i)=>{
 const p=day===1?(i===0?Y:X):(i===1?X:Y);
 return entry("19:00","夜間",{id:`fixture-${day}-${i}`,googlePlaceId:`fixture-${day}-${i}`,lat:p.lat+i*.0012,lng:p.lng+i*.0011,primaryType:"night_market",types:["night_market"],userRatingCount:90});
})}));
const outcome={status:"not_called"};const repaired=repairCrossDayGeographicCohesion(plans,{stage:"final_pre_persistence",plannedDate:"2026-10-01",logDiagnostics:false,normalizationOutcome:outcome});
assert.equal(outcome.status,"no_safe_slot");assert.deepEqual(outcome.affectedDays,[1,2]);assert.equal(outcome.failures.length,2);
const sink=buildItineraryValidatorFailureTelemetry({failedRules:[{code:"timeline_conflict"}],requestedDayCount:2,perDayPlaceCounts:[5,5],timelineNormalization:outcome});assert.equal(sanitizeItineraryFailureTelemetry(sink).timeline_normalization_failures.length,2);
const brokenSink={status:"not_called"};Object.defineProperty(brokenSink,"failures",{configurable:false,set(){throw new Error("PRIVATE");}});
assert.deepEqual(repairCrossDayGeographicCohesion(plans,{stage:"final_pre_persistence",plannedDate:"2026-10-01",logDiagnostics:false,normalizationOutcome:brokenSink}),repaired);
setItineraryValidatorEnabledOverride(null);
console.log("PASS no-safe-slot diagnostics: baseline result + validator parity, real repair propagation, no network");
