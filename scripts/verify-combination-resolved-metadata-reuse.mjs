import assert from "node:assert/strict";

import { buildCombinationGenerationSeedPlan } from "../src/lib/ai/itinerary-place-fetch.ts";
import { mapChatPlacesToGooglePlaces } from "../src/lib/ai/map-named-places-to-google.ts";
import { buildMultiCombinationCoverageReport } from "../src/lib/ai/combination-itinerary-integrity.ts";

const destination = "Paris";
const center = { lat: 48.8566, lng: 2.3522 };
const locale = "zh-TW";
const selectedCombinationIds = [1, 2, 3];

function id(n) {
  return `ChIJParisMetadataSeed${String(n).padStart(2, "0")}`;
}

function offeredPlace(n, combinationId, overrides = {}) {
  return {
    candidateId: id(n),
    originalName: `Paris Place ${n}`,
    name: `巴黎地點${n}`,
    localizedDisplayName: `巴黎地點${n}`,
    searchQuery: `Paris Place ${n} Paris`,
    destination,
    sourceCombinationId: combinationId,
    isRequiredBySelection: true,
    googlePlaceId: id(n),
    latitude: center.lat + n * 0.001,
    longitude: center.lng + n * 0.001,
    address: `${n} Rue de Test, Paris, France`,
    types: ["tourist_attraction"],
    primaryType: "tourist_attraction",
    rating: 4.5,
    resolutionStatus: "resolved",
    ...overrides,
  };
}

function offeredCombinations(places) {
  return [1, 2, 3].map((combinationId) => ({
    id: combinationId,
    title: `Combination ${combinationId}`,
    places: places.filter((place) => place.sourceCombinationId === combinationId),
  }));
}

function contextFor(places) {
  return {
    interests: [],
    selectedCombinationIds,
    offeredCombinations: offeredCombinations(places),
  };
}

function planFor(places, pools = []) {
  return buildCombinationGenerationSeedPlan({
    context: contextFor(places),
    destination,
    selectedCombinationIds,
    pools,
    center,
    locale,
  });
}

function nameOnly(name, combinationId) {
  return {
    name,
    placeName: name,
    address: destination,
    lat: null,
    lng: null,
    sourceCombinationId: combinationId,
    sourceCombinationIds: [combinationId],
  };
}

function resolvedSearchResult(name, n) {
  return {
    id: id(20 + n),
    name,
    address: `Resolved ${n}, Paris, France`,
    lat: center.lat + n * 0.001,
    lng: center.lng + n * 0.001,
    rating: 4.4,
    userRatingCount: 100,
    photoName: "photo",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

async function mapWithSearchCount(places) {
  let calls = 0;
  const mapped = await mapChatPlacesToGooglePlaces({
    places,
    destination,
    ...center,
    locale,
    context: { interests: [] },
    generationRequestId: `verify_metadata_${places.length}_${Date.now()}`,
    searchPlaces: async ({ data }) => {
      calls += 1;
      const rawName = data.query.split(" Paris")[0];
      return { places: [resolvedSearchResult(rawName, calls)], error: null };
    },
  });
  return { mapped, calls };
}

const completePlaces = Array.from({ length: 9 }, (_, index) => {
  const n = index + 1;
  return offeredPlace(n, Math.floor(index / 3) + 1);
});
const completePlan = planFor(completePlaces);
assert.equal(completePlan.offeredResolvedSeedCount, 9);
assert.equal(completePlan.poolResolvedSeedCount, 0);
assert.equal(completePlan.dedupedResolvedSeedCount, 9);
const completeMapped = await mapWithSearchCount(completePlan.resolvedSeeds);
assert.equal(completeMapped.calls, 0, "complete offered metadata performs no Text Search");
assert.equal(completeMapped.mapped.length, 9);
const coverage = buildMultiCombinationCoverageReport({
  destination,
  selectedCombinationIds,
  resolvedPlaces: completeMapped.mapped,
  supplementAttempted: true,
  tripDays: 8,
});
assert.deepEqual(coverage.uncoveredIds, []);

const offeredWinner = offeredPlace(1, 1, { address: "Offered metadata, Paris, France" });
const poolPlan = planFor(
  [offeredWinner],
  [
    {
      combinationId: 1,
      title: "Combination 1",
      theme: "attraction",
      primary: [],
      fallback: [],
      all: [
        {
          name: offeredWinner.name,
          searchCandidateId: id(1),
          googlePlaceId: id(1),
          coordinates: { lat: center.lat, lng: center.lng },
          address: "Refreshed pool metadata, Paris, France",
          types: ["tourist_attraction"],
          primaryType: "tourist_attraction",
        },
      ],
    },
  ],
);
assert.equal(poolPlan.poolResolvedSeedCount, 0, "pool metadata does not replace offered metadata");
assert.equal(poolPlan.resolvedSeeds[0].address, "Offered metadata, Paris, France");

const partialStructured = completePlaces.slice(0, 6);
const partialPlan = planFor(partialStructured);
const unresolved = [nameOnly("巴黎地點7", 3), nameOnly("巴黎地點8", 3), nameOnly("巴黎地點9", 3)];
const partialMapped = await mapWithSearchCount([...partialPlan.resolvedSeeds, ...unresolved]);
assert.equal(partialPlan.offeredResolvedSeedCount, 6);
assert.equal(partialMapped.calls, 3, "only three name-only candidates perform Text Search");
assert.equal(partialMapped.mapped.length, 9);

const shared = offeredPlace(1, 1);
const duplicatePlan = planFor([shared, { ...shared, sourceCombinationId: 2 }, offeredPlace(3, 3)]);
assert.equal(duplicatePlan.dedupedResolvedSeedCount, 2);
const sharedSeed = duplicatePlan.resolvedSeeds.find((place) => place.googlePlaceId === id(1));
assert.ok(sharedSeed);
assert.deepEqual(sharedSeed.sourceCombinationIds, [1, 2]);
assert.deepEqual(sharedSeed.matchedSelectedCombinationIds, [1, 2]);

const invalid = [
  offeredPlace(1, 1, { googlePlaceId: "synthetic:paris" }),
  offeredPlace(2, 2, { latitude: undefined, longitude: undefined }),
  offeredPlace(3, 3, {
    address: "1 Market Street, San Francisco, USA",
    latitude: 37.7936,
    longitude: -122.3958,
  }),
];
const invalidPlan = planFor(invalid);
assert.equal(invalidPlan.resolvedSeeds.length, 0, "invalid metadata never becomes a seed");
const invalidFallback = await mapWithSearchCount(
  invalid.map((place) => nameOnly(place.name, place.sourceCombinationId)),
);
assert.equal(invalidFallback.calls, 3, "invalid metadata uses existing resolution fallback");

const refreshFailurePlan = planFor(completePlaces.slice(0, 5), []);
assert.equal(refreshFailurePlan.resolvedSeeds.length, 5);
const refreshFailureMapped = await mapWithSearchCount(refreshFailurePlan.resolvedSeeds);
assert.equal(refreshFailureMapped.calls, 0);
assert.equal(refreshFailureMapped.mapped.length, 5);

const oldSessionPlan = planFor([
  offeredPlace(1, 1, {
    googlePlaceId: undefined,
    latitude: undefined,
    longitude: undefined,
    address: undefined,
    resolutionStatus: "named",
  }),
]);
assert.equal(oldSessionPlan.resolvedSeeds.length, 0);
const oldSessionFallback = await mapWithSearchCount([nameOnly("巴黎舊地點", 1)]);
assert.equal(oldSessionFallback.calls, 1);
assert.equal(oldSessionFallback.mapped.length, 1);

assert.deepEqual(selectedCombinationIds, [1, 2, 3]);
console.log("Combination resolved metadata reuse verification passed.");
