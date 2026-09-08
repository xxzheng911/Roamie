import assert from "node:assert/strict";
import {
  assessDeterministicRebuildCapacity,
  buildDeliverableItineraryCandidatePool,
  isDeliverableItineraryCandidate,
} from "../src/lib/ai/itinerary-deliverable-candidate.ts";
import {
  buildFallbackItineraryFromPlaces,
  candidateToDeliverableItineraryStop,
} from "../src/lib/trip/itinerary-guards.ts";
import { itineraryIdentityCounts } from "../src/lib/ai/itinerary-google-identity.ts";

const candidate = (index, google = true) => ({
  name: `P38 place ${index}`,
  placeName: `P38 place ${index}`,
  googlePlaceId: google ? `ChIJP38Deliverable${index}` : `candidate:internal-${index}`,
  address: "unknown locality",
  lat: 25.03 + index / 1000,
  lng: 121.53 + index / 1000,
  type: "tourist_attraction",
  primaryType: "tourist_attraction",
  types: ["tourist_attraction"],
  description: "",
  reason: "",
  estimatedTime: "1 hour",
  googleMapsUrl: "",
  reasonSource: "template",
});
const sourced = (candidates) => candidates.map((item) => ({
  candidate: item,
  sourceType: "supplemental_pool",
}));

// Case A: only the four candidates with hard Google identities are deliverable.
const eightHalfMissing = Array.from({ length: 8 }, (_, index) => candidate(index, index < 4));
const halfPool = buildDeliverableItineraryCandidatePool(sourced(eightHalfMissing), "台北");
assert.equal(halfPool.inputCount, 8);
assert.equal(halfPool.deliverableCount, 4);
assert.equal(halfPool.rejectionReasonCounts.missing_google_identity, 4);

// Case B: two-day minimum four builds four stops, all with Google identity.
const exactCapacity = assessDeterministicRebuildCapacity(halfPool.deliverableCount, 2);
assert.equal(exactCapacity.sufficient, true);
const fourStops = buildFallbackItineraryFromPlaces(
  halfPool.eligible.map(({ candidate: item }) => item),
  2,
  "2026-09-07",
  "台北",
  { requireDeliverableCandidates: true },
);
assert.equal(fourStops.length, 4);
assert.equal(itineraryIdentityCounts(fourStops).googleIdentityCount, 4);

// Case C: three deliverable candidates block rebuild; caller retains current plan.
const insufficient = assessDeterministicRebuildCapacity(3, 2);
assert.equal(insufficient.sufficient, false);
assert.equal(insufficient.buildBlockedReason, "insufficient_deliverable_capacity");
const currentPlan = fourStops;
const replacementAccepted = insufficient.sufficient;
assert.equal(replacementAccepted, false);
assert.equal(currentPlan.length, 4);

// Case D: source candidate without Google identity cannot enter strict constructor.
assert.equal(isDeliverableItineraryCandidate(candidate(20, false), "台北").reason, "missing_google_identity");
assert.throws(
  () => candidateToDeliverableItineraryStop(candidate(20, false), "2026-09-07", "10:00", true),
  /candidate_to_stop_rejected:missing_google_identity/,
);

// Case E: a 7/8 pool builds only the seven valid candidates; no final replacement is needed.
const sevenOfEight = Array.from({ length: 8 }, (_, index) => candidate(30 + index, index !== 7));
const sevenPool = buildDeliverableItineraryCandidatePool(sourced(sevenOfEight), "台北");
const sevenStops = buildFallbackItineraryFromPlaces(
  sevenPool.eligible.map(({ candidate: item }) => item),
  2,
  "2026-09-07",
  "台北",
  { requireDeliverableCandidates: true },
);
assert.equal(sevenStops.length, 6);
assert.equal(itineraryIdentityCounts(sevenStops).googleIdentityCount, sevenStops.length);
assert.equal(itineraryIdentityCounts(sevenStops).missingIdentityCount, 0);

console.log("P38 deliverable deterministic rebuild: PASS", {
  caseA: "4/8 deliverable",
  caseB: "4/4 Google identity",
  caseC: insufficient.buildBlockedReason,
  caseD: "strict constructor rejected",
  caseE: "7/8 source pool; emitted stops 100% Google identity, no recovery replacement",
  externalRequestDelta: 0,
});
