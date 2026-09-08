import assert from "node:assert/strict";
import {
  calculateDynamicStopCapacity,
  resolveItineraryCandidateCapacityTarget,
  resolveItineraryCandidateExpansionDecision,
} from "../src/lib/ai/real-place-supplement.ts";
import { assessDeterministicRebuildCapacity } from "../src/lib/ai/itinerary-deliverable-candidate.ts";

const sixDay = resolveItineraryCandidateCapacityTarget(6);
assert.deepEqual(
  { hardMinimum: sixDay.hardMinimum, preferredTarget: sixDay.preferredTarget },
  { hardMinimum: 12, preferredTarget: 18 },
);
assert.equal(calculateDynamicStopCapacity({ tripDays: 6, selectedCombinationCount: 1 }).minimumViableStops, 12);

// A: an eight-place auto-plan seed must enter the existing expansion path.
const seedEight = resolveItineraryCandidateExpansionDecision({
  deliverableCandidateCount: 8,
  capacityTarget: sixDay,
  selectedOnly: false,
  hasDayPlan: false,
  destinationResolved: true,
});
assert.equal(seedEight.attempted, true);
assert.equal(assessDeterministicRebuildCapacity(12, 6).sufficient, true);

// B: nine seeds supplemented to fourteen are deliverable-capacity sufficient.
const seedNine = resolveItineraryCandidateExpansionDecision({
  deliverableCandidateCount: 9,
  capacityTarget: sixDay,
  selectedOnly: false,
  hasDayPlan: false,
  destinationResolved: true,
});
assert.equal(seedNine.attempted, true);
assert.equal(assessDeterministicRebuildCapacity(14, 6).sufficient, true);

// C/D/E: eleven and ten remain insufficient; twelve is the exact hard floor.
assert.equal(assessDeterministicRebuildCapacity(11, 6).buildBlockedReason, "insufficient_deliverable_capacity");
assert.equal(assessDeterministicRebuildCapacity(12, 6).sufficient, true);
assert.equal(assessDeterministicRebuildCapacity(10, 6).sufficient, false);

// selected-only never expands; auto-plan required anchors do not disable supplement.
assert.equal(
  resolveItineraryCandidateExpansionDecision({
    deliverableCandidateCount: 3,
    capacityTarget: sixDay,
    selectedOnly: true,
    hasDayPlan: false,
    destinationResolved: true,
  }).skippedReason,
  "selected_only",
);
assert.equal(
  resolveItineraryCandidateExpansionDecision({
    deliverableCandidateCount: 7,
    capacityTarget: sixDay,
    selectedOnly: false,
    hasDayPlan: false,
    destinationResolved: true,
  }).attempted,
  true,
);

// Short trips do not add requests once the deliverable floor is already met.
for (const [days, count] of [[2, 4], [3, 6]]) {
  const target = resolveItineraryCandidateCapacityTarget(days);
  const decision = resolveItineraryCandidateExpansionDecision({
    deliverableCandidateCount: count,
    capacityTarget: target,
    selectedOnly: false,
    hasDayPlan: false,
    destinationResolved: true,
  });
  assert.equal(decision.attempted, false);
  assert.equal(decision.skippedReason, "capacity_sufficient");
}

// Existing partial-day contract: one stop for each explicit partial day.
const partialSixDay = resolveItineraryCandidateCapacityTarget(6, [1, 6]);
assert.equal(partialSixDay.hardMinimum, 10);
assert.equal(partialSixDay.preferredTarget, 14);

console.log("P53.1 long-trip candidate capacity: PASS", {
  sixDay,
  expansionCases: "8/9 seed attempted; 10/11 insufficient; 12/14 sufficient",
  shortTripExtraRequestDelta: 0,
  aiRequestDelta: 0,
});
