import assert from "node:assert/strict";
import {
  applyQuickChipContext,
  detectChatIntent,
  inferNearbyIntentFromContext,
  resolveNormalizedShortcutRequestFromText,
} from "../src/lib/ai/chat-intent.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import {
  classifyNearbyShortcutPlaceKind,
  NEARBY_SHORTCUT_POLICY,
  pickShortcutTopPlaces,
  rankPlacesForShortcutScene,
  selectShortcutSceneCandidates,
  shortcutSceneRankScore,
  buildShortcutRankBreakdown,
  coffeeCandidateExcludeReason,
} from "../src/lib/ai/nearby-shortcut-ranking.ts";
import { shouldFetchDestinationCategoryPlaces } from "../src/lib/ai/chat-place-intent.ts";
import { extractProvisionalDestinationAreaCandidate } from "../src/lib/ai/destination-travel-profile.ts";
import { resolveNearbyRecommendationScope } from "../src/lib/ai/resolve-chat-location.ts";
import { buildSummaryForRecommendations } from "../src/lib/ai/chat-place-recommendation.ts";
import {
  filterPlacesForShortcutScene,
  isPlaceEligibleForShortcutScene,
  RELAX_WALK_INCLUDED_TYPES,
} from "../src/lib/ai/shortcut-category-fidelity.ts";
import { resolveResidentialPlace } from "../src/lib/ai/residential-place.ts";

function place(name, primaryType, types = [primaryType]) {
  return {
    id: name,
    name,
    primaryType,
    types,
    rating: 4.4,
    userRatingCount: 200,
  };
}

const temple = place("興隆淨寺", "place_of_worship", ["place_of_worship", "tourist_attraction"]);
const cultural = place("新思惟人文空間", "cultural_center", ["cultural_center", "tourist_attraction"]);
const park = place("凹子底森林公園", "park", ["park"]);
const gallery = place("獨立藝廊", "art_gallery", ["art_gallery"]);
const museum = place("佛光緣美術館", "museum", ["museum"]);
const bridge = place("光雕橋", "tourist_attraction", ["tourist_attraction"]);
const cafe = place("安靜咖啡廳", "cafe", ["cafe"]);
const coffeeShop = place("精品咖啡", "coffee_shop", ["coffee_shop"]);
const bakery = place("麵包咖啡", "bakery", ["bakery"]);
const mall = place("漢神巨蛋", "shopping_mall", ["shopping_mall"]);
const bookstore = place("獨立書店", "book_store", ["book_store"]);

// Google/provider metadata outranks name inference for residential vs culture.
const residentialFakeMuseum = place(
  "京城國家美術館",
  "apartment_complex",
  ["apartment_complex", "premise"],
);
const realMuseum = place("XX美術館", "museum", ["museum"]);
const realGallery = place("XX藝術中心", "art_gallery", ["art_gallery"]);
const museumBuilding = place("XX大樓", "museum", ["museum", "tourist_attraction"]);
const genericCommunity = place("XX社區", "point_of_interest", ["point_of_interest", "establishment"]);

assert.deepEqual(resolveResidentialPlace(residentialFakeMuseum), {
  residential: true,
  source: "google_primary_type",
  matchedValue: "apartment_complex",
});
assert.equal(classifyNearbyShortcutPlaceKind(residentialFakeMuseum), "other");
assert.equal(isPlaceEligibleForShortcutScene(residentialFakeMuseum, "relax_walk"), false);
assert.equal(isPlaceEligibleForShortcutScene(residentialFakeMuseum, "rainy_indoor"), false);
assert.equal(classifyNearbyShortcutPlaceKind(realMuseum), "museum");
assert.equal(classifyNearbyShortcutPlaceKind(realGallery), "art_gallery");
assert.equal(classifyNearbyShortcutPlaceKind(museumBuilding), "museum");
assert.equal(resolveResidentialPlace(museumBuilding).residential, false);
assert.equal(resolveResidentialPlace(genericCommunity).source, "name_fallback");
assert.equal(isPlaceEligibleForShortcutScene(genericCommunity, "relax_walk"), false);
assert.deepEqual(
  filterPlacesForShortcutScene(
    [residentialFakeMuseum, realMuseum, realGallery, museumBuilding, genericCommunity],
    "rainy_indoor",
  ).map((item) => item.name),
  ["XX美術館", "XX藝術中心", "XX大樓"],
);

assert.equal(classifyNearbyShortcutPlaceKind(temple), "temple");
assert.equal(classifyNearbyShortcutPlaceKind(park), "park");
assert.equal(classifyNearbyShortcutPlaceKind(gallery), "art_gallery");
assert.equal(classifyNearbyShortcutPlaceKind(museum), "museum");
assert.equal(classifyNearbyShortcutPlaceKind(bridge), "bridge");
assert.equal(classifyNearbyShortcutPlaceKind(cafe), "cafe");
assert.equal(classifyNearbyShortcutPlaceKind(cultural), "cultural_center");

assert.equal(shortcutSceneRankScore("relax_walk", park) >= 100, true);
assert.equal(shortcutSceneRankScore("relax_walk", gallery) >= 80, true);
assert.ok(shortcutSceneRankScore("relax_walk", temple) <= -80);
assert.ok(
  shortcutSceneRankScore("relax_walk", park) >
    shortcutSceneRankScore("relax_walk", temple),
);

const relaxRanked = rankPlacesForShortcutScene(
  [temple, cultural, park, gallery],
  "relax_walk",
);
assert.equal(relaxRanked[0].name, "凹子底森林公園");
assert.notEqual(relaxRanked[0].name, "興隆淨寺");
assert.ok(relaxRanked.findIndex((item) => item.name === "興隆淨寺") >= 2);

const coffeePool = selectShortcutSceneCandidates(
  [museum, bridge, park, cafe, coffeeShop, bakery],
  "quiet_cafe",
  3,
);
assert.deepEqual(
  coffeePool.map((item) => item.name),
  ["安靜咖啡廳", "精品咖啡", "麵包咖啡"],
);
assert.equal(
  coffeePool.every((item) => !["park", "bridge", "museum"].includes(classifyNearbyShortcutPlaceKind(item))),
  true,
);

const coffeeTop = rankPlacesForShortcutScene(coffeePool, "quiet_cafe").slice(0, 3);
assert.equal(coffeeTop.length, 3);
assert.equal(
  coffeeTop.every((item) =>
    ["cafe", "coffee_shop", "bakery"].includes(classifyNearbyShortcutPlaceKind(item)),
  ),
  true,
);

assert.equal(isPlaceEligibleForShortcutScene(park, "quiet_cafe"), false);
assert.equal(isPlaceEligibleForShortcutScene(bridge, "quiet_cafe"), false);
assert.equal(isPlaceEligibleForShortcutScene(museum, "quiet_cafe"), false);
assert.equal(isPlaceEligibleForShortcutScene(cafe, "quiet_cafe"), true);

const rainyRanked = rankPlacesForShortcutScene(
  [park, temple, museum, cafe, mall, bookstore],
  "rainy_indoor",
);
assert.ok(
  ["museum", "cafe", "shopping_mall", "bookstore"].includes(
    classifyNearbyShortcutPlaceKind(rainyRanked[0]),
  ),
);
assert.ok(shortcutSceneRankScore("rainy_indoor", museum) >= 100);
assert.ok(shortcutSceneRankScore("rainy_indoor", park) <= -80);
assert.ok(shortcutSceneRankScore("rainy_indoor", temple) <= -70);

const rainyFiltered = filterPlacesForShortcutScene(
  [park, temple, museum, cafe, mall, bookstore],
  "rainy_indoor",
);
assert.ok(rainyFiltered.some((item) => item.name === "佛光緣美術館"));
assert.ok(rainyFiltered.some((item) => item.name === "安靜咖啡廳"));

assert.equal(detectChatIntent("今天想放鬆走走"), "attraction");
assert.equal(detectChatIntent("想找安靜的咖啡廳"), "cafe");
assert.equal(detectChatIntent("下雨天可以去哪"), "attraction");
assert.equal(detectChatIntent("下雨天"), "attraction");
assert.notEqual(detectChatIntent("下雨天可以去哪"), "weather");

const rainySession = applyQuickChipContext("下雨天可以去哪", createEmptySession());
assert.equal(rainySession.shortcutContext?.scene, "rainy_indoor");
assert.equal(
  inferNearbyIntentFromContext(
    { interests: ["室內", "咖啡"], mood: "下雨天", tripPurpose: "rainy_day" },
    "下雨天可以去哪",
    rainySession,
  ),
  "attraction",
);
assert.equal(resolveNormalizedShortcutRequestFromText("下雨天可以去哪")?.mode, "rainy");

assert.deepEqual([...RELAX_WALK_INCLUDED_TYPES], [
  "park",
  "garden",
  "museum",
  "art_gallery",
]);

assert.equal(NEARBY_SHORTCUT_POLICY.relax_walk.recommendationIntent, "attraction");
assert.equal(NEARBY_SHORTCUT_POLICY.quiet_cafe.recommendationIntent, "cafe");
assert.equal(NEARBY_SHORTCUT_POLICY.rainy_indoor.recommendationIntent, "attraction");

const relaxPool = [temple, cultural, park, gallery];
const relaxPicks = pickShortcutTopPlaces(relaxPool, "relax_walk", 3);
assert.equal(relaxPicks[0].name, "凹子底森林公園");
assert.ok(!relaxPicks.slice(0, 2).some((item) => item.name === "興隆淨寺"));

const lowRatedParkA = { ...place("低評分公園 A", "park"), rating: 2.2, userRatingCount: 8 };
const lowRatedParkB = { ...place("低評分公園 B", "park"), rating: 2.3, userRatingCount: 6 };
const qualifiedRelaxPool = [
  lowRatedParkA,
  lowRatedParkB,
  gallery,
  cultural,
  place("河濱步道", "promenade", ["promenade", "park"]),
  place("城市博物館", "museum", ["museum"]),
  temple,
];
const qualifiedRelaxPicks = pickShortcutTopPlaces(qualifiedRelaxPool, "relax_walk", 5);
assert.equal(qualifiedRelaxPicks.length, 5);
assert.equal(qualifiedRelaxPicks.slice(0, 4).some((item) => item.rating < 4), false);
assert.ok(
  qualifiedRelaxPicks.findIndex((item) => item.name === "興隆淨寺") >
    qualifiedRelaxPicks.findIndex((item) => item.name === "獨立藝廊"),
);
const templeBreakdown = buildShortcutRankBreakdown(temple, "relax_walk");
const parkBreakdown = buildShortcutRankBreakdown(park, "relax_walk");
assert.equal(templeBreakdown.matchedCategories, "temple");
assert.equal(templeBreakdown.shortcutWeight, -80);
assert.equal(parkBreakdown.matchedCategories, "park");
assert.equal(parkBreakdown.shortcutWeight, 100);
assert.ok(parkBreakdown.finalScore > templeBreakdown.finalScore);
console.info("[RT_SHORTCUT_RANKING_FIXTURE]", JSON.stringify([
  { ...parkBreakdown, rankingIndex: 0 },
  { ...buildShortcutRankBreakdown(gallery, "relax_walk"), rankingIndex: 1 },
  { ...buildShortcutRankBreakdown(cultural, "relax_walk"), rankingIndex: 2 },
  { ...templeBreakdown, rankingIndex: 3 },
]));

const coffeeRejected = [museum, bridge, park];
const coffeePassed = selectShortcutSceneCandidates(
  [...coffeeRejected, cafe, coffeeShop],
  "quiet_cafe",
  3,
);
assert.equal(coffeePassed.every((item) => ["安靜咖啡廳", "精品咖啡"].includes(item.name) || item.name.includes("咖啡")), true);
assert.equal(coffeePassed.some((item) => item.name === "佛光緣美術館"), false);
assert.equal(coffeePassed.some((item) => item.name === "光雕橋"), false);
assert.equal(coffeePassed.some((item) => item.name === "凹子底森林公園"), false);

assert.equal(
  extractProvisionalDestinationAreaCandidate("下雨天可以去哪"),
  null,
  "下雨天 must not be treated as a geographic area",
);
assert.equal(
  shouldFetchDestinationCategoryPlaces("下雨天可以去哪", { interests: [] }, rainySession),
  false,
  "Rainy shortcut must not enter destination category clarification",
);

assert.equal(
  shouldFetchDestinationCategoryPlaces(
    "下雨天可以去哪",
    { interests: [], destination: "高雄" },
    {
      ...rainySession,
      travelContext: { interests: [], destination: "高雄" },
      tripDestination: { city: "高雄", displayLabel: "高雄" },
    },
  ),
  false,
  "Rainy shortcut must skip destination category even with leftover destination",
);

const rainyScope = resolveNearbyRecommendationScope(
  {
    ...rainySession,
    location: { lat: 22.63, lng: 120.3, city: "高雄" },
    travelContext: { interests: [], destination: "東京" },
    normalizedShortcutRequest: {
      source: "chat_shortcut",
      intent: "nearby_recommendation",
      mode: "rainy",
      structured: true,
    },
  },
  "東京",
);
assert.equal(rainyScope.scope, "current_location");
assert.equal(rainyScope.hasExplicitDestination, false);

const coffeeShortcutCopy = buildSummaryForRecommendations(
  "cafe",
  [cafe, coffeeShop].map((item) => ({
    name: item.name,
    placeName: item.name,
    type: item.primaryType,
  })),
  { interests: [], excludedCategories: ["park"] },
  ["park"],
  "quiet_cafe",
);
assert.equal(coffeeShortcutCopy, "附近有 2 間我覺得不錯的選擇：");
for (const forbidden of ["避開公園", "如果你偏好", "安靜讀書", "有插座"]) {
  assert.equal(coffeeShortcutCopy.includes(forbidden), false);
}

console.info("[RT_COFFEE_CANDIDATES_FIXTURE]", JSON.stringify(
  [museum, bridge, park, cafe, coffeeShop].map((item, index) => {
    const passed = selectShortcutSceneCandidates([item], "quiet_cafe", 1).some(
      (row) => row.name === item.name,
    );
    return {
      ...buildShortcutRankBreakdown(item, "quiet_cafe", {
        passedCandidateFilter: passed,
        rankingIndex: index,
      }),
      excludeReason: passed ? "" : coffeeCandidateExcludeReason(item),
    };
  }),
));

console.info("[verify:nearby-shortcut-ranking] all passed");
