import assert from "node:assert/strict";
import {
  buildRequiredCoverageDecisions,
  classifyItineraryGeographicScope,
  itineraryGeographicScopeDecision,
} from "../src/lib/itinerary.functions.ts";
import { invalidItineraryStopReason } from "../src/lib/ai/generic-place-label.ts";
import { buildFallbackItineraryFromPlaces } from "../src/lib/trip/itinerary-guards.ts";
import { composedPlansFromItineraryItems } from "../src/lib/ai/itinerary-validator/from-payload.ts";
import { validateItineraryPlan } from "../src/lib/ai/itinerary-validator/validate.ts";

const localityCases = [
  ["台北市信義區松仁路", "in_scope"],
  ["臺北市中正區襄陽路", "in_scope"],
  ["信義區松壽路", "in_scope"],
  ["中正區館前路", "in_scope"],
  ["萬華區廣州街", "in_scope"],
  ["松山區八德路", "in_scope"],
];
for (const [address, expected] of localityCases) {
  assert.equal(classifyItineraryGeographicScope({ address }, "台北"), expected);
}

const staleProvenance = itineraryGeographicScopeDecision(
  {
    address: "台北市大安區新生南路",
    destinationScope: "nearby_extension",
    extensionDestination: "基隆",
    sourceRegionCandidate: "基隆市",
  },
  "台北",
);
assert.equal(staleProvenance.decision, "in_scope");
assert.equal(staleProvenance.evidenceSource, "formatted_address_city");
assert.equal(staleProvenance.candidateCityNormalized, "台北");

assert.equal(
  classifyItineraryGeographicScope(
    { sourceRegionCandidate: "基隆市", extensionDestination: "基隆" },
    "台北",
  ),
  "unknown",
);
assert.equal(classifyItineraryGeographicScope({ address: "基隆市仁愛區" }, "台北"), "out_of_scope");

const place = (id, name, address, type = "tourist_attraction") => ({
  name,
  placeName: name,
  googlePlaceId: id,
  address,
  lat: 25.03,
  lng: 121.55,
  type,
  primaryType: type,
  types: [type],
  description: "",
  reason: "",
  estimatedTime: "1 小時",
  googleMapsUrl: "",
  reasonSource: "template",
});

const required = [
  place("ChIJP32Longshan", "龍山寺", "台北市萬華區廣州街"),
  place("ChIJP32Raohe", "饒河街觀光夜市", "台北市松山區饒河街", "night_market"),
  place("ChIJP32Museum", "台北當代藝術館", "台北市大同區長安西路", "museum"),
];
const supplemental = localityCases.map(([address], index) =>
  place(`ChIJP32Supplement${index}`, `P32 測試地點 ${index + 1}`, address),
);
const eligibleSupplemental = supplemental.filter(
  (candidate) => classifyItineraryGeographicScope(candidate, "台北") !== "out_of_scope",
);
assert.equal(eligibleSupplemental.length, 6);

const finalStops = buildFallbackItineraryFromPlaces(
  [...required, ...eligibleSupplemental],
  2,
  "2026-09-07",
  "台北",
);
const plans = composedPlansFromItineraryItems(finalStops, 2, "2026-09-07");
assert(plans.every((plan) => plan.entries.length >= 2));
const finalIds = new Set(finalStops.map((stop) => stop.googlePlaceId));
assert.equal(required.filter((candidate) => finalIds.has(candidate.googlePlaceId)).length, 3);
assert.deepEqual(
  validateItineraryPlan({
    plans,
    requestedDays: 2,
    destination: "台北",
    creationPath: "direct",
  }).failedRules,
  [],
);

const missingInitial = buildRequiredCoverageDecisions(required, {
  initial: finalStops.filter((stop) => stop.googlePlaceId !== required[2].googlePlaceId),
  afterReplan: finalStops.filter((stop) => stop.googlePlaceId !== required[2].googlePlaceId),
  afterRebuild: [],
  preValidator: finalStops.filter((stop) => stop.googlePlaceId !== required[2].googlePlaceId),
  rebuildAttempted: true,
});
assert.equal(missingInitial[2].dropReasonCode, "not_generated");
assert.equal(missingInitial[2].presentPreValidator, false);

assert.equal(
  invalidItineraryStopReason({ name: "自由安排", googlePlaceId: "placeholder" }, "台北"),
  "generic_name",
);
assert.equal(invalidItineraryStopReason({ name: "實際景點" }, "台北"), "invalid_identity");
assert.equal(
  invalidItineraryStopReason({ name: "實際景點", lat: 0, lng: 0 }, "台北"),
  "invalid_coordinates",
);
assert.equal(
  invalidItineraryStopReason({
    name: "紀念墓園",
    googlePlaceId: "ChIJP32Cemetery",
    primaryType: "cemetery",
    types: ["cemetery"],
  }),
  "burial_funeral",
);
assert.equal(invalidItineraryStopReason(finalStops[0], "台北"), null);

console.log("verify-p32-itinerary-scope-coverage: ok");
