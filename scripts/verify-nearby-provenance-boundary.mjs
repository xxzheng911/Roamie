import assert from "node:assert/strict";
import { RoamieItineraryItemSchema, normalizeItineraryItem } from "../src/lib/ai/types.ts";
import { buildFallbackItineraryFromPlaces } from "../src/lib/trip/itinerary-guards.ts";
import {
  applyComposedPlansToItineraryItems,
  composedPlansFromItineraryItems,
} from "../src/lib/ai/itinerary-validator/from-payload.ts";
import { validateItineraryPlan } from "../src/lib/ai/itinerary-validator/validate.ts";
import { setItineraryValidatorEnabledOverride } from "../src/lib/ai/itinerary-validator/feature-flag.ts";
import { enforceGlobalFamilyFeasibility } from "../src/lib/ai/global-family-feasibility.ts";
import { assignDiversityAwareSeedDays } from "../src/lib/ai/diversity-aware-seed-assignment.ts";

setItineraryValidatorEnabledOverride(true);

function recommendation(id, options = {}) {
  return {
    name: options.name ?? id,
    placeName: options.name ?? id,
    type: options.primaryType ?? "tourist_attraction",
    primaryType: options.primaryType ?? "tourist_attraction",
    types: options.types ?? [options.primaryType ?? "tourist_attraction"],
    description: id,
    reason: id,
    estimatedTime: "1-2 小時",
    address: options.address ?? "Unmarked destination address",
    lat: options.lat ?? 34.99,
    lng: options.lng ?? 135.75,
    googleMapsUrl: "",
    googlePlaceId: `ChIJ${id}`,
    reasonSource: "template",
    rating: 4.6,
    userRatingCount: 800,
    destinationScope: options.destinationScope,
    extensionDestination: options.extensionDestination,
    sourceRegionCandidate: options.sourceRegionCandidate,
    isRequiredBySelection: options.required,
  };
}

function itineraryItem(id, options = {}) {
  return normalizeItineraryItem({
    date: options.date ?? "2027-03-01",
    time: options.time ?? "10:00",
    title: options.name ?? id,
    placeName: options.name ?? id,
    description: id,
    address: options.address ?? "Unmarked destination address",
    lat: options.lat ?? 34.99,
    lng: options.lng ?? 135.75,
    googlePlaceId: `ChIJ${id}`,
    placeType: options.primaryType ?? "tourist_attraction",
    types: options.types ?? [options.primaryType ?? "tourist_attraction"],
    destinationScope: options.destinationScope,
    extensionDestination: options.extensionDestination,
    sourceRegionCandidate: options.sourceRegionCandidate,
    dayIndex: options.dayIndex ?? 0,
  });
}

function validateItems(items, days, extensions) {
  return validateItineraryPlan({
    plans: composedPlansFromItineraryItems(items, days, "2027-03-01"),
    requestedDays: days,
    nearbyExtensions: extensions,
    creationPath: "selected_places",
    destination: "Primary Destination",
  });
}

function nearbyFailures(result) {
  return result.failedRules.filter((rule) => rule.code === "nearby_extension_coverage");
}

// Explicit provenance wins even when neither name nor address contains the extension text.
const explicitItems = [
  itineraryItem("TempleWithoutCity", {
    destinationScope: "nearby_extension",
    extensionDestination: "京都",
  }),
  itineraryItem("GardenWithoutCity", {
    destinationScope: "nearby_extension",
    extensionDestination: "京都",
    time: "14:00",
  }),
  itineraryItem("PrimaryAttraction", { time: "16:00" }),
];
const explicitResult = validateItems(explicitItems, 1, ["京都"]);
assert.equal(nearbyFailures(explicitResult).length, 0);
assert.equal(explicitResult.nearbyCoverage?.matchedByProvenance["京都"], 2);

// An explicit primary tag blocks stale source-region metadata and text fallback.
const primaryResult = validateItems(
  [
    itineraryItem("PrimaryOne", {
      destinationScope: "primary",
      sourceRegionCandidate: "京都",
    }),
    itineraryItem("PrimaryTwo", { destinationScope: "primary", time: "14:00" }),
  ],
  1,
  ["京都"],
);
assert.ok(
  nearbyFailures(primaryResult).some((rule) => rule.message.includes("missing_extensions")),
);

// JSON/schema/validator round trip retains all three fields.
const allFields = itineraryItem("RoundTrip", {
  destinationScope: "nearby_extension",
  extensionDestination: "京都",
  sourceRegionCandidate: "京都",
});
const parsed = RoamieItineraryItemSchema.parse(JSON.parse(JSON.stringify(allFields)));
const roundTripPlace = composedPlansFromItineraryItems([parsed], 1, "2027-03-01")[0].entries[0]
  .place;
assert.deepEqual(
  {
    destinationScope: roundTripPlace.destinationScope,
    extensionDestination: roundTripPlace.extensionDestination,
    sourceRegionCandidate: roundTripPlace.sourceRegionCandidate,
  },
  {
    destinationScope: "nearby_extension",
    extensionDestination: "京都",
    sourceRegionCandidate: "京都",
  },
);

// Authoritative selected-place deterministic path carries provenance to validation.
const authoritativeStops = buildFallbackItineraryFromPlaces(
  [
    recommendation("AuthoritativeOne", {
      destinationScope: "nearby_extension",
      extensionDestination: "京都",
      sourceRegionCandidate: "京都",
    }),
    recommendation("AuthoritativeTwo", {
      destinationScope: "nearby_extension",
      extensionDestination: "京都",
      sourceRegionCandidate: "京都",
      lat: 35.001,
    }),
    recommendation("AuthoritativePrimary", { lat: 35.002 }),
  ],
  1,
  "2027-03-01",
  "Primary Destination",
);
assert.equal(nearbyFailures(validateItems(authoritativeStops, 1, ["京都"])).length, 0);

// Existing structured region metadata is the secondary matching source.
const sourceRegionResult = validateItems(
  [
    itineraryItem("SourceRegionOne", { sourceRegionCandidate: "京都" }),
    itineraryItem("SourceRegionTwo", { sourceRegionCandidate: "京都", time: "14:00" }),
  ],
  1,
  ["京都"],
);
assert.equal(nearbyFailures(sourceRegionResult).length, 0);
assert.equal(sourceRegionResult.nearbyCoverage?.matchedBySourceRegion["京都"], 2);

// Legacy payloads still use text fallback.
const legacyResult = validateItems(
  [
    itineraryItem("LegacyOne", { address: "京都市 中京區" }),
    itineraryItem("LegacyTwo", { address: "京都府 東山區", time: "14:00" }),
  ],
  1,
  ["京都"],
);
assert.equal(nearbyFailures(legacyResult).length, 0);
assert.equal(legacyResult.nearbyCoverage?.matchedByTextFallback["京都"], 2);

// Multiple extension provenance is isolated per normalized destination.
const multiple = ["京都", "神戶", "奈良"].flatMap((extension, extensionIndex) =>
  [0, 1].map((index) =>
    itineraryItem(`${extensionIndex}-${index}`, {
      destinationScope: "nearby_extension",
      extensionDestination: extension,
      dayIndex: extensionIndex,
      date: `2027-03-0${extensionIndex + 1}`,
      time: index ? "14:00" : "10:00",
    }),
  ),
);
const multipleResult = validateItems(multiple, 3, ["京都", "神戶", "奈良"]);
assert.equal(multipleResult.nearbyCoverage?.missingExtensions.length, 0);
for (const extension of ["京都", "神戶", "奈良"]) {
  assert.equal(multipleResult.nearbyCoverage?.matchedByProvenance[extension], 2);
}

// Existing scattered hard rule remains unchanged.
const scattered = [0, 1, 2].flatMap((dayIndex) => [
  itineraryItem(`Scattered-${dayIndex}`, {
    destinationScope: "nearby_extension",
    extensionDestination: "京都",
    dayIndex,
    date: `2027-03-0${dayIndex + 1}`,
  }),
  itineraryItem(`DayAttraction-${dayIndex}`, {
    dayIndex,
    date: `2027-03-0${dayIndex + 1}`,
    time: "14:00",
  }),
]);
const scatteredResult = validateItems(scattered, 3, ["京都"]);
assert.ok(
  nearbyFailures(scatteredResult).some((rule) => rule.message.includes("scattered_extension")),
);
assert.ok(nearbyFailures(scatteredResult).every((rule) => rule.severity === "fail"));

// Global replacement and diversity-aware seed assignment retain object provenance.
const nearbyCandidate = recommendation("NearbyCandidate", {
  destinationScope: "nearby_extension",
  extensionDestination: "京都",
  sourceRegionCandidate: "京都",
});
const globalSelection = enforceGlobalFamilyFeasibility({
  candidates: [nearbyCandidate, recommendation("AlternativeOne"), recommendation("AlternativeTwo")],
  dayCount: 1,
  targetCount: 3,
  selectedCombinationIds: [],
  minimumPerCombination: 0,
  style: "mixed",
});
const selectedNearby = globalSelection.selected.find(
  (item) => item.googlePlaceId === nearbyCandidate.googlePlaceId,
);
assert.equal(selectedNearby?.extensionDestination, "京都");
const seedSelection = assignDiversityAwareSeedDays({
  candidates: [{ item: nearbyCandidate, preferredDay: 0 }],
  dayCount: 1,
  dailyScenicCapacity: 3,
});
assert.equal(seedSelection.dayPlaces[0][0].sourceRegionCandidate, "京都");

// Applying a cross-day composed plan keeps the base item's nearby metadata.
const moved = applyComposedPlansToItineraryItems(
  [allFields],
  [
    {
      day: 2,
      entries: [{ time: "10:00", label: "景點", name: roundTripPlace.name, place: roundTripPlace }],
    },
  ],
  "2027-03-01",
);
assert.equal(moved[0].destinationScope, "nearby_extension");
assert.equal(moved[0].extensionDestination, "京都");
assert.equal(moved[0].sourceRegionCandidate, "京都");

// A normal restaurant without provenance never satisfies nearby coverage.
const mealResult = validateItems(
  [
    itineraryItem("Restaurant", { primaryType: "restaurant" }),
    itineraryItem("Primary", { time: "14:00" }),
  ],
  1,
  ["京都"],
);
assert.ok(nearbyFailures(mealResult).some((rule) => rule.message.includes("missing_extensions")));

setItineraryValidatorEnabledOverride(null);
console.log("verify-nearby-provenance-boundary: OK");
