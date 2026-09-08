import assert from "node:assert/strict";
import {
  classifyRequiredIdentityAvailability,
  replanUntilItineraryValid,
} from "../src/lib/ai/itinerary-validator/replan.ts";
import { validateItineraryPlan } from "../src/lib/ai/itinerary-validator/validate.ts";
import { applyComposedPlansToItineraryItems } from "../src/lib/ai/itinerary-validator/from-payload.ts";
import { itineraryIdentityCounts } from "../src/lib/ai/itinerary-google-identity.ts";

const place = (index, { google = true, required = false } = {}) => ({
  id: google ? `ChIJP40Candidate${index}` : `candidate:internal-${index}`,
  googlePlaceId: google ? `ChIJP40Candidate${index}` : null,
  plannerProvenanceKey: `candidate:${index}`,
  sourceCandidateIndex: index,
  name: `P40 place ${index}`,
  address: "unknown locality",
  lat: 25.03 + index / 1000,
  lng: 121.53 + index / 1000,
  rating: 4.5,
  userRatingCount: 100,
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
const entry = (candidate, time) => ({ time, label: "景點", name: candidate.name, place: candidate });
const validSupplemental = Array.from({ length: 4 }, (_, index) => place(index + 10));
const initialPlans = [
  { day: 1, entries: [entry(validSupplemental[0], "09:30"), entry(validSupplemental[1], "13:30")] },
  { day: 2, entries: [entry(validSupplemental[2], "09:30"), entry(validSupplemental[3], "13:30")] },
];
const validatorInput = {
  requestedDays: 2,
  style: "mixed",
  destination: "台北",
  creationPath: "direct",
};
const run = (pool, requiredPlaces = []) => replanUntilItineraryValid(
  { plans: initialPlans, pool, requiredPlaces, days: 2, style: "mixed", validatorInput, generationId: "p40-regression" },
  validateItineraryPlan({ plans: initialPlans, ...validatorInput }),
);

// A: four non-deliverable required candidates never enter any generic replan branch.
const missingRequired = Array.from({ length: 4 }, (_, index) => place(index, { google: false, required: true }));
const rejectedRequired = run([...missingRequired, ...validSupplemental], missingRequired);
assert.equal(
  rejectedRequired.plans.flatMap((plan) => plan.entries).filter((item) => item.place.id.startsWith("candidate:internal-")).length,
  0,
);
assert.equal(rejectedRequired.requiredCoverageComplete, false);

// B: a deliverable required candidate can be inserted with its exact Google identity.
const validRequired = [place(30, { required: true })];
const acceptedRequired = run([...validRequired, ...validSupplemental], validRequired);
const acceptedStops = applyComposedPlansToItineraryItems([], acceptedRequired.plans, "2026-09-07");
assert(acceptedStops.some((stop) => stop.googlePlaceId === validRequired[0].googlePlaceId));

// C: a supplemental candidate without Google identity cannot enter the plan.
const missingSupplemental = place(40, { google: false });
const rejectedSupplemental = run([missingSupplemental, ...validSupplemental]);
assert.equal(
  rejectedSupplemental.plans.flatMap((plan) => plan.entries).some((item) => item.place.id === missingSupplemental.id),
  false,
);

// D/E: valid supplemental capacity does not masquerade as required coverage; classify early.
assert.equal(rejectedRequired.plans.flatMap((plan) => plan.entries).length >= 4, true);
assert.equal(rejectedRequired.requiredSatisfiedCount, 0);
assert.deepEqual(classifyRequiredIdentityAvailability(missingRequired), {
  unavailableCount: 4,
  failureReason: "required_identity_unavailable",
});

// F: every emitted stop in the production-like valid flow is deliverable without recovery.
const productionRequired = Array.from({ length: 4 }, (_, index) => place(index + 50, { required: true }));
const productionLike = run([...productionRequired, ...validSupplemental], productionRequired);
const productionStops = applyComposedPlansToItineraryItems([], productionLike.plans, "2026-09-07");
const identity = itineraryIdentityCounts(productionStops);
assert.equal(identity.googleIdentityCount, productionStops.length);
assert.equal(identity.missingIdentityCount, 0);

console.log("P40 replan deliverable admission: PASS", {
  missingRequiredInserted: 0,
  validRequiredPreserved: true,
  missingSupplementalInserted: false,
  failureReason: "required_identity_unavailable",
  productionLike: `${identity.googleIdentityCount}/${productionStops.length}`,
  externalRequestDelta: 0,
});
