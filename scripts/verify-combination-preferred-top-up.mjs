import {
  mergeVerifiedCombinationTopUp,
  searchPlacesForThemeDirections,
} from "../src/lib/ai/destination-combination-discovery.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

function place(name, id, index, types = ["tourist_attraction", "point_of_interest"]) {
  return {
    name,
    googlePlaceId: id,
    searchCandidateId: id,
    coordinates: { lat: 40.7 + index * 0.001, lng: -74 + index * 0.001 },
    address: "Example City, USA",
    types,
    primaryType: types[0],
    rating: 4.5,
  };
}

function combo(id, title, theme, places) {
  return {
    combinationId: id,
    title,
    theme,
    placeCandidates: places,
    primaryCandidates: places.slice(0, 3),
    fallbackCandidates: places.slice(3),
  };
}

const landmark = combo("city:1", "經典景點組合", "attraction", [
  place("Landmark A", "place-landmark-a", 1),
  place("Landmark B", "place-landmark-b", 2),
  place("Landmark C", "place-landmark-c", 3),
]);
const culture = combo("city:2", "藝文博物館組合", "culture", [
  place("Museum A", "place-museum-a", 4, ["museum", "tourist_attraction"]),
  place("Museum B", "place-museum-b", 5, ["museum", "tourist_attraction"]),
  place("Museum C", "place-museum-c", 6, ["museum", "tourist_attraction"]),
]);
const nature = combo("city:3", "自然風景組合", "nature", [
  place("Park A", "place-park-a", 7, ["park", "tourist_attraction"]),
  place("Park B", "place-park-b", 8, ["park", "tourist_attraction"]),
  place("Park C", "place-park-c", 9, ["park", "tourist_attraction"]),
]);

// Case 1: preferred count already met — no top-up mutation.
{
  const initial = [landmark, culture, nature];
  const result = mergeVerifiedCombinationTopUp("Example City", initial, []);
  assert(result.combinations === initial, "three initial groups return without top-up");
  assert(result.addedCount === 0, "three initial groups add nothing");
  assert(result.degradedReason == null, "preferred delivery is not degraded");
}

// Case 2 / 9: generic city fixture tops two groups up to three.
{
  const initial = [landmark, culture];
  const snapshot = JSON.stringify(initial);
  const result = mergeVerifiedCombinationTopUp("Example City", initial, [nature]);
  assert(result.combinations.length === 3, "two groups top up to preferred three");
  assert(result.combinations[0] === landmark && result.combinations[1] === culture, "original groups retain order and objects");
  assert(JSON.stringify(initial) === snapshot, "top-up does not mutate original groups");
  assert(result.addedCount === 1, "top-up reports one added group");
  assert(result.degradedReason == null, "successful top-up is not degraded");
}

// Case 3: first unused theme is incomplete; later unused theme succeeds.
{
  const incompleteShopping = combo("city:bad-shopping", "購物散策組合", "shopping", [
    place("Market A", "place-market-a", 10, ["shopping_mall"]),
    place("Market B", "place-market-b", 11, ["shopping_mall"]),
  ]);
  const result = mergeVerifiedCombinationTopUp(
    "Example City",
    [landmark, culture],
    [incompleteShopping, nature],
  );
  assert(result.combinations.length === 3, "later unused theme is tried after incomplete theme");
  assert(result.combinations[2]?.theme === "nature", "valid later theme becomes third group");
}

// Case 4: no verified top-up candidates keeps the original minimum delivery.
{
  const result = mergeVerifiedCombinationTopUp("Example City", [landmark, culture], []);
  assert(result.combinations.length === 2, "failed top-up preserves two original groups");
  assert(result.addedCount === 0, "failed top-up adds no group");
  assert(result.degradedReason === "insufficient_verified_candidates", "candidate shortage is marked explicitly");
}

// Case 7: cross-combination duplicates cannot fill the third group.
{
  const duplicate = combo("city:duplicate", "自然風景組合", "nature", [
    place("Landmark A", "place-landmark-a", 12),
    place("Park B", "place-park-b2", 13, ["park", "tourist_attraction"]),
    place("Park C", "place-park-c2", 14, ["park", "tourist_attraction"]),
  ]);
  const result = mergeVerifiedCombinationTopUp("Example City", [landmark, culture], [duplicate]);
  assert(result.combinations.length === 2, "duplicate removal prevents an undersized third group");
  assert(result.degradedReason === "validation_failed", "duplicate-depleted group reports validation failure");
}

// Case 8: name-only and synthetic identities cannot form a top-up group.
{
  const unverified = combo("city:unverified", "自然風景組合", "nature", [
    place("Park Name Only", undefined, 15, ["park", "tourist_attraction"]),
    place("Park Synthetic", "name:park-synthetic", 16, ["park", "tourist_attraction"]),
    { ...place("Park Missing Coordinates", "place-no-coordinates", 17), coordinates: undefined },
  ]);
  const result = mergeVerifiedCombinationTopUp("Example City", [landmark, culture], [unverified]);
  assert(result.combinations.length === 2, "unverified candidates do not create a third group");
  assert(result.degradedReason === "validation_failed", "unverified group reports validation failure");
}

// Case 5: active rate protection stops before issuing any theme search.
{
  let searchCalls = 0;
  const rateLimited = await searchPlacesForThemeDirections({
    destination: "Example City",
    country: "USA",
    lat: 40.7,
    lng: -74,
    searchPlaces: async () => {
      searchCalls += 1;
      return { places: [] };
    },
    generationRequestId: "verify-rate-protection",
    deadlineAt: Date.now() + 1_000,
    existingCombinations: [landmark, culture],
    targetCombinationCount: 3,
    rateProtectionActive: () => true,
  });
  assert(searchCalls === 0, "rate protection prevents new top-up searches");
  assert(rateLimited.combinations.length === 0, "rate-limited top-up adds no group");
  assert(rateLimited.stopReason === "rate_limited", "rate-limited degradation is explicit");
}

if (failed > 0) {
  console.error(`\n${failed} preferred top-up checks failed.`);
  process.exit(1);
}

console.log("\nAll preferred combination top-up checks passed.");
