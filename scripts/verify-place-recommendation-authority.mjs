import assert from "node:assert/strict";
import {
  buildExplicitNearbySearchAttempt,
  buildLateNightCandidateFunnel,
  boundedLateNightStageTwoAttempts,
  canonicalizeExplicitNearbyKeyword,
  estimatedPlacesProviderCalls,
  extractExplicitNearbyKeyword,
  explicitNearbyCapacitySearchAttempts,
  matchesExplicitNearbyKeyword,
  matchesExplicitNearbyKeywordWithProviderEvidence,
  matchesNearbySemanticFamily,
  resolveExplicitNearbyKeywordForTurn,
} from "../src/lib/ai/chat-place-recommendation.ts";
import { identityDisplayLabel, resolvePlaceIdentity } from "../src/lib/place-identity.ts";
import {
  matchesNightPreferredPlace,
  matchesStageTwoLateNightPlace,
  matchesStrongLateNightPlace,
} from "../src/lib/home-nearby-eligibility.ts";
import { selectHomeNearbyPicks } from "../src/lib/home-nearby-places-filter.ts";
import { parseTravelContextFromText } from "../src/lib/ai/travel-context.ts";
import { resolveNearbyRecommendationScope } from "../src/lib/ai/resolve-chat-location.ts";
import { createPendingNearbyLocationRequest } from "../src/lib/ai/nearby-location-clarification.ts";
import { resolveExplicitNearbyIntent } from "../src/lib/ai/nearby-location-clarification.ts";
import { resolveChatIntentArbitration } from "../src/lib/ai/recommendation-refinement/arbitrate.ts";
import { isRecommendablePlace } from "../src/lib/is-recommendable-place.ts";
import { resolvePlaceDisplayCategory } from "../src/lib/unified-place-card.ts";
import { placeResultToCandidate } from "../src/lib/recommendation/place-mapping.ts";

function place(name, primaryType, types = [primaryType]) {
  return {
    id: `place-${name}`,
    name,
    address: "台北市",
    primaryType,
    types,
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "營業中",
    rating: 4.6,
    userRatingCount: 600,
    photoName: "places/example/photos/example",
    lat: 25.04,
    lng: 121.56,
  };
}

console.log("=== place recommendation authority ===\n");

const mallCafe = place("商場內咖啡店", "cafe", [
  "cafe",
  "coffee_shop",
  "shopping_mall",
  "point_of_interest",
  "establishment",
]);
assert.equal(resolvePlaceIdentity(mallCafe), "cafe");
assert.equal(identityDisplayLabel(resolvePlaceIdentity(mallCafe), mallCafe), "咖啡廳");
assert.equal(resolvePlaceDisplayCategory(mallCafe), "咖啡廳");
assert.equal(placeResultToCandidate(mallCafe, "coffee")?.type, "咖啡廳");

const mallFoodStall = place("商場內小吃攤", "food_stall", [
  "food_stall",
  "shopping_mall",
  "point_of_interest",
]);
assert.equal(resolvePlaceIdentity(mallFoodStall), "food_stall");
assert.notEqual(resolvePlaceIdentity(mallFoodStall), "shopping_mall");

const realMall = place("城市購物中心", "shopping_mall", ["shopping_mall", "point_of_interest"]);
assert.equal(resolvePlaceIdentity(realMall), "shopping_mall");
console.log("  ✓ specific food identity outranks generic parent venue types");
console.log("  ✓ Home/Explore and Chat mapping share the canonical category label");

const ordinaryRestaurant = place("日常家庭餐廳", "restaurant");
const lateNightRamen = place("深夜拉麵", "restaurant");
const nightScenic = place("河岸夜景散步道", "tourist_attraction");
const bar = place("夜間酒吧", "bar");
const closedBar = { ...place("已歇業酒吧", "bar"), businessStatus: "CLOSED_PERMANENTLY" };
const unknownHoursBar = { ...place("深夜餐酒館", "bar"), openStatus: "unknown", openNow: null };
assert.equal(matchesNightPreferredPlace(ordinaryRestaurant), false);
assert.equal(matchesNightPreferredPlace(lateNightRamen), true);
assert.equal(matchesNightPreferredPlace(bar), true);
assert.equal(matchesStrongLateNightPlace(bar), true);
assert.equal(matchesStageTwoLateNightPlace(nightScenic), true);
assert.equal(selectHomeNearbyPicks([unknownHoursBar], { period: "late_night" }).length, 1);
const nightPicks = selectHomeNearbyPicks([ordinaryRestaurant, nightScenic, closedBar, bar], {
  period: "late_night",
  minResults: 3,
  maxResults: 3,
});
assert.deepEqual(
  nightPicks.map((item) => item.name),
  ["夜間酒吧", "河岸夜景散步道"],
);
console.log("  ✓ late-night stage 1 outranks stage 2; ordinary/closed venues stay excluded");
assert.equal(
  estimatedPlacesProviderCalls({
    mode: "multi",
    query: "night",
    nearbyGroups: [["bar"], ["restaurant"]],
  }),
  2,
);
assert.equal(boundedLateNightStageTwoAttempts(0).length, 0);
assert.equal(boundedLateNightStageTwoAttempts(1).length, 1);
assert.equal(boundedLateNightStageTwoAttempts(5).length, 2);
console.log("  ✓ late-night Stage 2 is deficit-aware and bounded to two provider calls");

const emptySession = { phase: "discover", recommendedPlaces: [], interests: [] };
assert.equal(extractExplicitNearbyKeyword("附近有沒有老宅咖啡？"), "老宅咖啡");
assert.equal(extractExplicitNearbyKeyword("我想找附近餐酒館"), "餐酒館");
assert.equal(extractExplicitNearbyKeyword("我想找附近居酒屋"), "居酒屋");
assert.equal(extractExplicitNearbyKeyword("那附近居酒屋呢"), "居酒屋");
for (const generic of [
  "附近適合去哪裡",
  "附近有什麼地方",
  "附近哪裡可以去",
  "附近推薦一下",
  "附近有什麼",
  "附近走走",
]) {
  assert.equal(extractExplicitNearbyKeyword(generic), null, generic);
}
assert.deepEqual(resolveExplicitNearbyIntent("我想找附近餐酒館"), {
  rawKeyword: "餐酒館",
  canonicalKeyword: "餐酒館",
  intent: "restaurant",
  semanticFamily: "nightlife",
});
assert.equal(resolveExplicitNearbyIntent("我要找附近酒吧")?.semanticFamily, "nightlife");
assert.equal(
  resolveChatIntentArbitration("我想夜晚散策，幫我看看附近適合去哪裡。", {
    ...emptySession,
    normalizedShortcutRequest: {
      source: "home_mood",
      mode: "late_night",
      intent: "nearby_recommendation",
      structured: true,
    },
  }).reason,
  "structured_shortcut_precedence",
);
assert.equal(resolveChatIntentArbitration("附近居酒屋", emptySession).route, "NEW_RECOMMENDATION");
assert.equal(canonicalizeExplicitNearbyKeyword("餐酒 bistro"), "餐酒館");
assert.deepEqual(buildExplicitNearbySearchAttempt("附近有沒有老宅咖啡？"), {
  query: "老宅咖啡",
  mode: "text",
});
assert.equal(resolveExplicitNearbyKeywordForTurn("再推薦幾個", "老宅咖啡"), "老宅咖啡");
assert.equal(matchesExplicitNearbyKeyword(place("老宅咖啡館", "cafe"), "老宅咖啡"), true);
assert.equal(
  matchesExplicitNearbyKeyword(place("一般購物中心", "shopping_mall"), "老宅咖啡"),
  false,
);
assert.equal(matchesExplicitNearbyKeyword(place("純素餐廳", "restaurant"), "素食"), true);
assert.equal(matchesExplicitNearbyKeyword(place("一般牛排館", "restaurant"), "素食"), false);
assert.deepEqual(
  explicitNearbyCapacitySearchAttempts("早午餐", 0)?.map((lane) => lane.id),
  ["brunch_primary", "brunch_bilingual", "brunch_breakfast"],
);
assert.deepEqual(
  explicitNearbyCapacitySearchAttempts("早午餐", 1)?.map((lane) => lane.id),
  ["brunch_cafe", "brunch_weekend", "brunch_breakfast_cafe"],
);
assert.equal(matchesExplicitNearbyKeyword(place("Morning Brunch Cafe", "cafe"), "早午餐"), true);
assert.equal(matchesExplicitNearbyKeyword(place("一般晚餐餐廳", "restaurant"), "早午餐"), false);
assert.equal(
  matchesExplicitNearbyKeywordWithProviderEvidence(
    place("日光餐桌", "restaurant"),
    "早午餐",
    new Set(["brunch_primary"]),
  ),
  true,
);
assert.equal(
  matchesExplicitNearbyKeywordWithProviderEvidence(
    place("日光餐桌", "restaurant"),
    "早午餐",
    new Set(["brunch_bilingual"]),
  ),
  true,
);
assert.equal(
  matchesExplicitNearbyKeywordWithProviderEvidence(
    place("夜間酒吧", "bar", ["bar"]),
    "早午餐",
    new Set(["brunch_primary"]),
  ),
  false,
);
const mappedBrunchCandidates = ["brunch_primary", "brunch_bilingual", "brunch_breakfast"].flatMap(
  (lane) =>
    Array.from({ length: 20 }, (_, index) => ({
      candidate: place(`日光餐桌 ${index}`, "restaurant"),
      lanes: new Set([lane]),
    })),
);
const admittedBrunchCandidates = mappedBrunchCandidates.filter(({ candidate, lanes }) =>
  matchesExplicitNearbyKeywordWithProviderEvidence(candidate, "早午餐", lanes),
);
assert.equal(mappedBrunchCandidates.length, 60);
assert.equal(admittedBrunchCandidates.length, 40);
assert.ok(
  admittedBrunchCandidates.length > 0,
  "mapped provider candidates must not collapse to zero",
);
assert.equal(
  matchesExplicitNearbyKeywordWithProviderEvidence(
    place("一般早餐店", "restaurant"),
    "早午餐",
    new Set(["brunch_breakfast"]),
  ),
  false,
);
assert.equal(matchesNearbySemanticFamily(place("一般餐廳", "restaurant"), "nightlife"), false);
assert.equal(matchesNearbySemanticFamily(place("M", "bar", ["bar", "pub"]), "nightlife"), true);
console.log("  ✓ explicit nearby keyword controls query, relevance, and continuation");

assert.equal(parseTravelContextFromText("我想找附近餐酒館", emptySession).destination, undefined);
assert.equal(parseTravelContextFromText("附近有沒有咖啡廳", emptySession).destination, undefined);
const pending = createPendingNearbyLocationRequest("restaurant", "我想找附近餐酒館");
assert.equal(pending.rawExplicitKeyword, "餐酒館");
assert.equal(pending.canonicalKeyword, "餐酒館");
const staleFallbackPending = createPendingNearbyLocationRequest("attraction", "我想找附近餐酒館");
assert.equal(staleFallbackPending.intent, "restaurant");
assert.equal(staleFallbackPending.category, "restaurant");
assert.equal(staleFallbackPending.queryCategory, "餐酒館");
assert.equal(staleFallbackPending.rawExplicitKeyword, "餐酒館");
assert.equal(staleFallbackPending.semanticFamily, "nightlife");
const clarifiedSession = {
  ...emptySession,
  travelContext: { interests: [], destination: "過期的行程目的地" },
  location: { lat: 22.6877, lng: 120.2946, city: "已澄清地區" },
  nearbyLocationAuthority: {
    displayLabel: "已澄清地區",
    district: "已澄清地區",
    lat: 22.6877,
    lng: 120.2946,
    source: "clarification",
  },
};
assert.equal(
  resolveNearbyRecommendationScope(clarifiedSession, "餐酒館", {
    explicitNearbyRequest: true,
  }).scope,
  "current_location",
);
assert.equal(
  resolveNearbyRecommendationScope(emptySession, undefined, { explicitNearbyRequest: true }).scope,
  "none",
);
console.log(
  "  ✓ Nearby keyword never becomes destination; clarified scope outranks stale trip context",
);

const shortNamePub = {
  ...place("M", "pub", ["pub", "bar", "point_of_interest", "establishment"]),
  openStatus: "unknown",
  openNow: null,
};
assert.equal(isRecommendablePlace(shortNamePub, "chat_nearby").ok, true);
assert.equal(
  isRecommendablePlace({ ...shortNamePub, id: "", placeId: "", name: "123" }, "chat_nearby").ok,
  false,
);
assert.equal(
  isRecommendablePlace({ ...shortNamePub, businessStatus: "CLOSED_TEMPORARILY" }, "chat_nearby").ok,
  false,
);
const funnel = buildLateNightCandidateFunnel([shortNamePub, ordinaryRestaurant, closedBar]);
assert.equal(funnel.strongSemanticCount, 1);
assert.equal(funnel.unknownHoursCount, 1);
assert.equal(funnel.dropReasons.closed, 1);
assert.equal(funnel.dropReasons.address_like_marker, 0);
console.log(
  "  ✓ valid short-name pub survives marker heuristic and unknown hours reaches enrichment",
);

console.log("\nPlace recommendation authority verification passed.");
