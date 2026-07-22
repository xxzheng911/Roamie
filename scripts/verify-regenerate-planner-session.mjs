#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createPlanningSessionId,
  resetPlanningPipelineForRegenerate,
} from "../src/lib/ai/ai-planning-session.ts";
import {
  beginPlannerSession,
  finishPlannerSession,
  resetPlannerSession,
} from "../src/lib/ai/planner-session-guard.ts";
import {
  clearAffiliateSummaryLogDedupe,
  logAffiliateSummary,
} from "../src/lib/affiliate/affiliate-debug-log.ts";

const sid = createPlanningSessionId();
assert.equal(beginPlannerSession(sid), true);
finishPlannerSession(sid, 3);
assert.equal(beginPlannerSession(sid), false);
resetPlannerSession(sid);
assert.equal(beginPlannerSession(sid), true);
finishPlannerSession(sid, 1);

const session = {
  phase: "ready",
  recommendedPlaces: [],
  selectedPlaces: [{ name: "A" }],
  planningSessionId: sid,
  planVersion: 1,
  travelContext: {
    interests: [],
    destination: "東京",
    days: 3,
    selectedCombinationIds: [1, 2],
    selectedCombinationPlaceNames: ["X"],
    partiallyResolvedPlaces: [{ name: "partial" }],
    failedCombinationIds: [3],
  },
  aiItineraryState: "FAILED",
  chatPlanningState: "generationFailed",
  currentDayPlan: { planningSessionId: sid, items: [{ day: 1 }] },
  draftTrip: { title: "x" },
};

const next = resetPlanningPipelineForRegenerate(session, "regenerate");
assert.notEqual(next.planningSessionId, sid);
assert.equal(next.planVersion, 2);
assert.equal(next.currentDayPlan, undefined);
assert.equal(next.draftTrip, undefined);
assert.equal(next.selectedPlaces.length, 0);
assert.deepEqual(next.travelContext.selectedCombinationIds, [1, 2]);
assert.equal(next.travelContext.partiallyResolvedPlaces, undefined);
assert.equal(beginPlannerSession(next.planningSessionId), true);

clearAffiliateSummaryLogDedupe();
logAffiliateSummary({
  place: "上野公園",
  category: "park",
  reason: "excluded_generic_park",
});
logAffiliateSummary({
  place: "上野公園",
  category: "park",
  reason: "excluded_generic_park",
});
logAffiliateSummary({
  place: "東京塔",
  category: "attraction",
  klook: true,
  kkday: true,
  reason: "famous_landmark_whitelist",
});

console.log("verify-regenerate-planner-session: OK");
