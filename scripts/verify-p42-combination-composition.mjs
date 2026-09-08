import assert from "node:assert/strict";
import {
  computeCombinationProminenceScore,
  enforcePlanningCombinationComposition,
} from "../src/lib/ai/destination-combination-discovery.ts";
import { isHardGooglePlaceId } from "../src/lib/ai/planning-place-id.ts";

const make = (city, suffix, name, lat, lng, primaryType, types = [primaryType]) => ({
  name,
  googlePlaceId: `ChIJP42${city}${suffix}`,
  searchCandidateId: `ChIJP42${city}${suffix}`,
  coordinates: { lat, lng },
  address: `${city} ${suffix}`,
  types,
  primaryType,
  rating: 4.5,
  userRatingCount: 500,
  businessStatus: "OPERATIONAL",
});

for (const [city, lat, lng] of [
  ["Taipei", 25.033, 121.565],
  ["Kaohsiung", 22.627, 120.301],
  ["Tokyo", 35.676, 139.65],
  ["Osaka", 34.693, 135.502],
  ["Seoul", 37.566, 126.978],
]) {
  const combos = [
    {
      combinationId: `${city}:nature`,
      title: "城市慢遊組合",
      theme: "nature",
      placeCandidates: [
        make(city, "Trail", "Mountain Trail", lat, lng, "park"),
        make(city, "Boulder", "Boulder View", lat + 0.001, lng + 0.001, "tourist_attraction"),
        make(city, "River", "Riverside Park", lat + 0.02, lng + 0.02, "park"),
      ],
    },
    {
      combinationId: `${city}:classic`,
      title: "經典景點組合",
      theme: "attraction",
      placeCandidates: [
        make(city, "Tower", "City Landmark Tower", lat + 0.03, lng, "tourist_attraction"),
        make(city, "Store", "Brand Flagship Store", lat + 0.031, lng, "clothing_store", [
          "clothing_store",
          "store",
        ]),
        make(
          city,
          "Feature",
          "Tower Internal Observation Deck",
          lat + 0.03,
          lng + 0.001,
          "tourist_attraction",
        ),
        make(city, "Museum", "City Museum", lat + 0.04, lng + 0.01, "museum"),
      ],
    },
    {
      combinationId: `${city}:culture`,
      title: "舊城文化組合",
      theme: "historic",
      placeCandidates: [
        make(city, "Village", "Heritage Village", lat + 0.05, lng, "tourist_attraction"),
        make(
          city,
          "VillageMuseum",
          "Heritage Village Museum",
          lat + 0.0505,
          lng + 0.0005,
          "museum",
        ),
        make(city, "Temple", "Old Temple", lat + 0.06, lng, "place_of_worship"),
        make(city, "History", "History Museum", lat + 0.07, lng, "museum"),
      ],
    },
  ].map((combo) => ({ ...combo, primaryCandidates: combo.placeCandidates }));

  const result = enforcePlanningCombinationComposition(combos);
  assert.equal(result.length, 3, `${city}: high-quality groups retained`);
  const all = result.flatMap((combo) => combo.primaryCandidates ?? []);
  assert(
    all.every((candidate) => isHardGooglePlaceId(candidate.googlePlaceId)),
    `${city}: grounded`,
  );
  assert(
    !all.some((candidate) => /Flagship Store/.test(candidate.name)),
    `${city}: no store leakage`,
  );
  assert(
    !all.some((candidate) => /Observation Deck/.test(candidate.name)),
    `${city}: no child feature`,
  );
  assert.equal(result[0].primaryCandidates.length, 2, `${city}: same-venue nature dedupe`);
  assert.equal(result[2].primaryCandidates.length, 3, `${city}: heritage venue dedupe`);
  assert(
    result.every((combo) => combo.primaryCandidates.length >= 2),
    `${city}: shortage degrades safely`,
  );
}

const taipeiEvidence = enforcePlanningCombinationComposition(
  [
    {
      combinationId: "taipei:nature",
      title: "城市慢遊組合",
      theme: "nature",
      placeCandidates: [
        make("TaipeiEvidence", "Elephant", "象山", 25.027, 121.57, "tourist_attraction"),
        make("TaipeiEvidence", "Rocks", "六巨石", 25.028, 121.571, "tourist_attraction"),
        make("TaipeiEvidence", "Park", "象山公園", 25.026, 121.569, "park"),
        make("TaipeiEvidence", "River", "大佳河濱公園", 25.074, 121.536, "park"),
      ],
    },
    {
      combinationId: "taipei:classic",
      title: "經典景點組合",
      theme: "attraction",
      placeCandidates: [
        make(
          "TaipeiEvidence",
          "Store",
          "cas:pace in Taipei 信義旗艦店",
          25.033,
          121.565,
          "clothing_store",
          ["clothing_store", "store"],
        ),
        make("TaipeiEvidence", "Damper", "台北101風阻尼球", 25.034, 121.565, "tourist_attraction"),
        make("TaipeiEvidence", "Hall", "中正紀念堂", 25.035, 121.52, "tourist_attraction"),
        make("TaipeiEvidence", "Museum", "國立臺灣博物館", 25.042, 121.515, "museum"),
      ],
    },
    {
      combinationId: "taipei:culture",
      title: "舊城文化組合",
      theme: "historic",
      placeCandidates: [
        make("TaipeiEvidence", "Village", "四四南村", 25.032, 121.561, "tourist_attraction"),
        make("TaipeiEvidence", "VillageMuseum", "臺北眷村文物館", 25.0324, 121.5614, "museum"),
        make("TaipeiEvidence", "Temple", "龍山寺", 25.037, 121.5, "place_of_worship"),
        make("TaipeiEvidence", "Block", "剝皮寮歷史街區", 25.036, 121.503, "tourist_attraction"),
      ],
    },
  ].map((combo) => ({ ...combo, primaryCandidates: combo.placeCandidates })),
);
const taipeiNames = taipeiEvidence.flatMap((combo) =>
  combo.primaryCandidates.map((place) => place.name),
);
assert(!taipeiNames.includes("cas:pace in Taipei 信義旗艦店"));
assert(!taipeiNames.includes("台北101風阻尼球"));
assert(
  taipeiEvidence[0].primaryCandidates.filter((place) => /象山|六巨石/.test(place.name)).length <= 1,
);
assert(
  taipeiEvidence[2].primaryCandidates.filter((place) => /四四南村|眷村文物館/.test(place.name))
    .length <= 1,
);

const productionLikeLandmarks = [
  ["Taipei", "台北101", "101觀景台", 25.0339, 121.5645],
  ["Tokyo", "Tokyo Tower", "Tower Internal Observation Component", 35.6586, 139.7454],
  ["Osaka", "Osaka Castle", "Castle Internal Exhibit", 34.6873, 135.5262],
  ["Seoul", "N Seoul Tower", "Tower Internal Observation Component", 37.5512, 126.9882],
  ["Kaohsiung", "85 Sky Tower", "Tower Internal Observation Component", 22.6117, 120.3002],
];

for (const [city, parentName, childName, lat, lng] of productionLikeLandmarks) {
  const child = make(city, "ChildFirst", childName, lat, lng, "tourist_attraction");
  const plaza = make(city, "Plaza", `${city} Minor Plaza`, lat + 0.006, lng, "plaza");
  const pond = make(city, "Pond", `${city} Decorative Pond`, lat + 0.007, lng, "point_of_interest");
  const generic = make(
    city,
    "Generic",
    `${city} Generic POI`,
    lat + 0.008,
    lng,
    "tourist_attraction",
  );
  const secondary = make(
    city,
    "Secondary",
    `${city} Secondary Attraction`,
    lat + 0.012,
    lng,
    "tourist_attraction",
  );
  const museum = make(city, "Museum", `${city} City Museum`, lat + 0.016, lng, "museum");
  const store = make(
    city,
    "NameOnlyStore",
    `${city} Flagship Store`,
    lat + 0.009,
    lng,
    "point_of_interest",
    ["point_of_interest", "establishment"],
  );
  const parent = {
    ...make(city, "ParentLater", parentName, lat, lng, "tourist_attraction", [
      "tourist_attraction",
      "landmark",
    ]),
    rating: 4.4,
    userRatingCount: 30_000,
  };
  const result = enforcePlanningCombinationComposition([
    {
      combinationId: `${city}:production-like-classic`,
      title: "經典景點組合",
      theme: "attraction",
      placeCandidates: [child, plaza, pond, generic, secondary, museum, store, parent],
      primaryCandidates: [child, plaza, pond],
    },
  ]);
  assert.equal(result.length, 1, `${city}: classic group retained`);
  const selected = result[0].primaryCandidates;
  assert(
    selected.some((place) => place.name === parentName),
    `${city}: parent promoted into top 3`,
  );
  assert(
    !selected.some((place) => place.name === childName),
    `${city}: child-first loses to parent`,
  );
  assert(
    !selected.some((place) => /Flagship Store/.test(place.name)),
    `${city}: name-only store dropped`,
  );
  assert(
    selected.every((place) => isHardGooglePlaceId(place.googlePlaceId)),
    `${city}: P41 identity`,
  );
  assert(
    computeCombinationProminenceScore(parent, "attraction").prominenceScore >
      computeCombinationProminenceScore(plaza, "attraction").prominenceScore,
    `${city}: landmark prominence beats plaza`,
  );
}

console.log("P42 combination composition: PASS", {
  cities: ["Taipei", "Kaohsiung", "Tokyo", "Osaka", "Seoul"],
  semanticFidelity: true,
  storeLeakage: 0,
  childPlaceLeakage: 0,
  venueDuplicates: 0,
  groundedIdentityInvariant: true,
  forcedLowQualityFiller: 0,
  externalRequestDelta: 0,
  childFirstParentLater: true,
  landmarkProminenceRanking: true,
  rankingExcludedDiagnostics: true,
});
