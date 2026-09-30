/** Local synthetic gate execution; no RPC/provider calls. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import {
  INTEGRITY_REASONS, INTEGRITY_RULE_CODES, integrityRuleCodes, sanitizeIntegrityFailureTelemetry,
} from "../src/lib/analytics/itinerary-integrity-failure-telemetry.ts";
import { sanitizeItineraryFailureTelemetry } from "../src/lib/analytics/itinerary-failure-telemetry.ts";
import { resolveItineraryCandidateCapacityTarget } from "../src/lib/ai/real-place-supplement.ts";
const path = "src/lib/itinerary.functions.ts";
const current = readFileSync(path, "utf8");
// Pin the reviewed pre-patch authority so this verification remains valid after a future commit.
const baseline = execFileSync("git", ["show", "2a25c6af6328093089bd38083a8bbc95ed214a79:" + path], { encoding: "utf8" });
const start = "    if (\n      (!integrity.ok || !recommendationIntegrity.ok || !delivery.ok)";
const end = "    // Explicit duration remains authoritative";
const block = s => s.slice(s.indexOf(start), s.indexOf(end));
const observationStart = current.indexOf("        // Observe this already-decided failure only.");
const observationEnd = current.indexOf("        return finish({", observationStart);
assert.ok(observationStart > 0 && observationEnd > observationStart);
const restored = (current.slice(0, observationStart) +
  '        await recordGenerationOutcome(false, "itinerary_integrity_failed");\n' + current.slice(observationEnd))
  .replace(/^import \{ integrityRuleCodes, sanitizeIntegrityFailureTelemetry \}[^\n]*\n/, "");
assert.equal(restored, baseline, "all application logic, responses, capacity, selection and settlement unchanged");
const gate = source => vm.runInNewContext(`(async function(ctx) { with(ctx) { ${block(source)} return "continue"; } })`);
const run = gate(current), oldRun = gate(baseline);
const json = x => JSON.parse(JSON.stringify(x));
function fixture(reason, { days = 3, selectedOnly = false, failWriter = false, combos = [1,2] } = {}) {
  const events = [];
  const ctx = {
    integrity: { ok: !reason, reasons: reason ? [reason] : [], coverage: {
      required: 22, scheduled: 4, unresolved: 18, mergedAsDuplicate: 0, invalid: 0, fallbackAdded: 0,
    } },
    recommendationIntegrity: { ok: true, reasons: [], coveragePercent: 100,
      requiredAnchorPlaces: ["private-name"], coveredPlaces: ["private-name"], missingPlaces: [] },
    delivery: { ok: !reason, reasons: [] }, selectedCombinationIds: combos,
    inputPlaces: Array(22), selectedPlaces: Array(20), finalStops: Array(4),
    data: { days, placeAuthority: selectedOnly ? "selected_only" : undefined }, startDate: "2026-10-01", generationId: "private-operation",
    resolveItineraryCandidateCapacityTarget,
    composedPlansFromItineraryItems: () => [{ entries: Array(2) },{ entries: Array(2) },{ entries: [] }],
    logAiPipeline: () => {}, console: { info: () => {} }, integrityRuleCodes, sanitizeIntegrityFailureTelemetry,
    INSUFFICIENT_ITINERARY_PLACES_MESSAGE: "unchanged-response",
    recordGenerationOutcome: async (success, code, metadata) => {
      if (failWriter) throw new Error("private-credential");
      events.push({ success, code, metadata: sanitizeItineraryFailureTelemetry(metadata) });
    }, finish: r => r,
  };
  return { ctx, events };
}
for (const [raw, expected] of [
  ["insufficient_real_places:got=2,need_at_least=3", "insufficient_deliverable_capacity"],
  ["missing_combination:private-label", "selected_combination_integrity_failed"],
]) {
  const f = fixture(raw); const before = JSON.stringify(f.ctx.integrity);
  const response = await run(f.ctx);
  const old = fixture(raw); assert.deepEqual(json(response),json(await oldRun(old.ctx)));
  assert.equal(f.events.length,1); const m=f.events[0].metadata;
  assert.equal(f.events[0].code,"itinerary_integrity_failed");assert.equal(m.integrity_reason,expected);
  assert.equal(m.selected_input_count,22);assert.equal(m.planner_input_count,20);
  assert.equal(m.required_capacity,resolveItineraryCandidateCapacityTarget(3).hardMinimum);
  assert.equal(m.required_capacity,6);assert.equal(m.delivered_place_count,4);
  assert.deepEqual(json(m.per_day_place_counts),[2,2,0]);assert.equal(m.coverage_unresolved_count,18);
  assert.equal(m.coverage_required_count,22);assert.equal(m.coverage_scheduled_count,4);
  assert.equal(JSON.stringify(f.ctx.integrity),before);
  const broken = fixture(raw,{failWriter:true});assert.deepEqual(json(await run(broken.ctx)),json(response));
}
for (const selectedOnly of [false,true]) {
  for (const reason of [null,"missing_combination:1","duplicate_placeId:private-place"]) {
    const f=fixture(reason,{selectedOnly});const old=fixture(reason,{selectedOnly});
    assert.deepEqual(json(await run(f.ctx)),json(await oldRun(old.ctx)));
    if (!reason || reason.startsWith("duplicate")) assert.equal(f.events.length,0);
  }
}
const absentCoverage=fixture("missing_combination:1");delete absentCoverage.ctx.integrity.coverage;
await run(absentCoverage.ctx);assert.equal(absentCoverage.events.length,1);
assert.equal(Object.hasOwn(absentCoverage.events[0].metadata,"coverage_required_count"),false);
const noCombination=fixture("missing_combination:1",{combos:[]});assert.equal(await run(noCombination.ctx),"continue");assert.equal(noCombination.events.length,0);
const anchors=fixture(null);anchors.ctx.recommendationIntegrity={ok:false,reasons:["missing_required_anchors:secret-place"],coveragePercent:0,requiredAnchorPlaces:["secret-place"],coveredPlaces:[],missingPlaces:["secret-place"]};
await run(anchors.ctx);assert.equal(anchors.events[0].metadata.missing_anchor_count,1);assert.equal(anchors.events[0].metadata.integrity_reason,"selected_combination_integrity_failed");
const poison={integrity_reason:"arbitrary-private-user",place:"private-place",prompt:"private-prompt",user_id:"private-user",request_id:"private-request",selected_input_count:22};
assert.deepEqual(sanitizeIntegrityFailureTelemetry(poison),{rules:[]});
const clean=sanitizeItineraryFailureTelemetry({...poison,integrity_reason:INTEGRITY_REASONS[0],integrity_rule_codes:["missing_combination:private-place","private-user","missing_combination"],selected_input_count:2.5,planner_input_count:-1,required_capacity:Infinity,per_day_place_counts:[1,"private-place"],timeline_conflicts:[{day:1,time:"09:00",count:2}]});
assert.deepEqual(clean,{rules:[],integrity_reason:INTEGRITY_REASONS[0],integrity_rule_codes:["missing_combination"]});
assert.deepEqual(integrityRuleCodes(INTEGRITY_RULE_CODES.map(k=>k+(k==="coverage"?"=50":":private-place"))),[...INTEGRITY_RULE_CODES]);
assert.deepEqual(integrityRuleCodes(["missing_combination_evil:private-place"]),[]);
for (const days of [1,2,3,7]) {
 const f=fixture("insufficient_real_places:fixture",{days});await run(f.ctx);
 assert.equal(f.events[0].metadata.required_capacity,resolveItineraryCandidateCapacityTarget(days).hardMinimum);
}
assert.equal(resolveItineraryCandidateCapacityTarget(3,[3],"packed").hardMinimum,5);
assert.equal(resolveItineraryCandidateCapacityTarget(3,[],"relaxed").hardMinimum,6);
assert.match(block(current),/resolveItineraryCandidateCapacityTarget\(data.days\)/);
console.log("PASS integrity telemetry A–G: actual gate, runtime counts/capacity, privacy, success silence, writer isolation, response/selection/billing source parity");
