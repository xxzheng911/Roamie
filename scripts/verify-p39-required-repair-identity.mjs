import assert from "node:assert/strict";
import { repairRequiredPlaceCoverage } from "../src/lib/ai/itinerary-validator/replan.ts";
import { applyComposedPlansToItineraryItems } from "../src/lib/ai/itinerary-validator/from-payload.ts";
import { itineraryIdentityCounts } from "../src/lib/ai/itinerary-google-identity.ts";
import { validateCompleteItineraryPayload } from "../src/lib/trip/itinerary-guards.ts";
import { normalizeStoredItinerary } from "../src/lib/itinerary-storage.ts";
import { tripDetailNavigateOptions } from "../src/lib/trip/trip-detail-nav.ts";

const place = (index, google = true, required = true) => ({
  id: `planner:required-${index}`,
  googlePlaceId: google ? `ChIJP39Required${index}` : null,
  plannerProvenanceKey: `candidate:${index}`,
  sourceCandidateIndex: index,
  name: `P39 place ${index}`,
  address: `Address ${index}`,
  lat: 25.03 + index / 1000,
  lng: 121.53 + index / 1000,
  rating: null,
  userRatingCount: null,
  photoName: null,
  primaryType: "tourist_attraction",
  types: ["tourist_attraction"],
  businessStatus: "OPERATIONAL",
  openStatus: "unknown",
  openStatusLabel: "",
  todayHoursLabel: "",
  closingSoonNote: "",
  nextOpenHint: "",
  isRequiredBySelection: required,
});
const entry = (candidate, time = "10:00") => ({
  time,
  label: "景點",
  name: candidate.name,
  place: candidate,
});

const required = Array.from({ length: 4 }, (_, index) => place(index));
const supplemental = Array.from({ length: 4 }, (_, index) => place(index + 4, true, false));
const occupiedPlans = [
  { day: 1, entries: supplemental.slice(0, 2).map((candidate, i) => entry(candidate, `${10 + i * 2}:00`)) },
  { day: 2, entries: supplemental.slice(2).map((candidate, i) => entry(candidate, `${10 + i * 2}:00`)) },
];

// A/B/C: all four required replacements are atomic and survive the shared serializer.
const repaired = repairRequiredPlaceCoverage({
  plans: occupiedPlans,
  requiredPlaces: required,
  days: 2,
  generationId: "p39-regression",
});
assert.equal(repaired.insertedCount, 4);
assert.equal(repaired.replacedSupplementalCount, 4);
assert.equal(repaired.blockedRequiredCount, 0);
const repairedStops = applyComposedPlansToItineraryItems([], repaired.plans, "2026-09-07");
assert.equal(repairedStops.length, 4);
assert.deepEqual(
  new Set(repairedStops.map((stop) => stop.googlePlaceId)),
  new Set(required.map((candidate) => candidate.googlePlaceId)),
);

// D: a non-deliverable required source is blocked and cannot displace supplemental.
const missingGoogle = place(20, false);
const blocked = repairRequiredPlaceCoverage({
  plans: [{ day: 1, entries: [entry(supplemental[0])] }],
  requiredPlaces: [missingGoogle],
  days: 1,
  generationId: "p39-regression",
});
assert.equal(blocked.insertedCount, 0);
assert.equal(blocked.blockedRequiredCount, 1);
assert.equal(blocked.failureReasonCounts.required_missing_google_identity, 1);
assert.equal(blocked.plans[0].entries[0].place.googlePlaceId, supplemental[0].googlePlaceId);

// E: production-like 4 repaired required + 4 other stops remain 8/8 deliverable.
const eightPlans = repaired.plans.map((plan, dayIndex) => ({
  ...plan,
  entries: [...plan.entries, ...supplemental.slice(dayIndex * 2, dayIndex * 2 + 2).map((candidate, i) => entry(candidate, `${16 + i * 2}:00`))],
}));
const eightStops = applyComposedPlansToItineraryItems([], eightPlans, "2026-09-07");
const counts = itineraryIdentityCounts(eightStops);
assert.equal(eightStops.length, 8);
assert.equal(counts.googleIdentityCount, 8);
assert.equal(counts.missingIdentityCount, 0);
const payload = {
  version: 2,
  title: "P39",
  summary: "required repair identity",
  moodTag: "",
  recommendations: [],
  destination: "台北",
  days: 2,
  itinerary: eightStops,
};
const validation = validateCompleteItineraryPayload(payload, 2, "2026-09-07");
assert.equal(validation.valid, true);
const stored = normalizeStoredItinerary({
  id: "trip-p39",
  title: "P39",
  created_at: "2026-09-07T00:00:00.000Z",
  payload: validation.normalizedPayload,
});
assert(stored);
assert.deepEqual(tripDetailNavigateOptions(stored.id), {
  to: "/saved/$tripId",
  params: { tripId: "trip-p39" },
  search: undefined,
});

console.log("P39 required repair identity: PASS", {
  requiredIdentity: "4/4",
  atomicReplacements: repaired.replacedSupplementalCount,
  missingSource: "required_missing_google_identity",
  productionLike: "8/8",
  externalRequestDelta: 0,
});
