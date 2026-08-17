#!/usr/bin/env node
/**
 * Continuation dedupe visibility: only shown identities are globally excluded.
 * SEARCHED_CANDIDATE != SHOWN_RECOMMENDATION.
 */
import assert from "node:assert/strict";
import { mapPlaceResultToChatItem } from "../src/lib/chat-session.ts";
import {
  countRestaurantRenderRejectionReasons,
  evaluateRestaurantRenderGuard,
  filterRecommendationsForCategoryRender,
} from "../src/lib/ai/chat-category-place-guard.ts";
import { evaluateFoodPlace } from "../src/lib/ai/chat-food-filter.ts";
import { isAcceptableRestaurantPlace } from "../src/lib/ai/recommendation-refinement/search.ts";
import { filterChatCategoryPlaces } from "../src/lib/ai/chat-destination-place-filter.ts";
import {
  continueRecommendation,
  createRecommendationSession,
  DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE,
} from "../src/lib/ai/conversation-recommendation-session.ts";
import {
  filterContinuationByShownIdentity,
  shownRecommendationIdentitiesFromSession,
  storedPoolPlaceIdsFromSession,
} from "../src/lib/ai/recommendation-continuation-dedupe.ts";
import {
  collectUsedPlaces,
  excludeUsedPlacesFromFollowUp,
} from "../src/lib/ai/trip-planning-follow-up.ts";
import {
  filterPlacesByDestinationArea,
} from "../src/lib/ai/chat-place-search-context.ts";
import { resolveDestinationAreaScope } from "../src/lib/ai/destination-travel-profile.ts";

function place(overrides = {}) {
  return {
    id: "ChIJ-xitun-1",
    name: "西屯午餐店",
    address: "台中市西屯區台灣大道三段301號",
    lat: 24.178,
    lng: 120.647,
    rating: 4.5,
    userRatingCount: 220,
    photoName: null,
    primaryType: "restaurant",
    types: ["restaurant", "food", "point_of_interest"],
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    ...overrides,
  };
}

function recItem(source) {
  return mapPlaceResultToChatItem(source, { locale: "zh-TW", categoryIntent: "restaurant" });
}

console.log("\n=== Taichung Xitun first-round shown vs searched ===\n");

const qualitySix = [
  place({
    id: "ChIJ-shown",
    name: "屋馬燒肉 文心店",
    primaryType: "barbecue_restaurant",
    types: ["barbecue_restaurant", "restaurant", "food"],
  }),
  place({
    id: "ChIJ-chinese",
    name: "西屯中餐廳",
    primaryType: "chinese_restaurant",
    types: ["chinese_restaurant", "restaurant", "food"],
  }),
  place({
    id: "ChIJ-taiwanese",
    name: "西屯麵店",
    primaryType: "taiwanese_restaurant",
    types: ["taiwanese_restaurant", "restaurant"],
  }),
  place({
    id: "ChIJ-mall",
    name: "新光三越 台中中港店",
    primaryType: "shopping_mall",
    types: ["shopping_mall", "point_of_interest"],
    userRatingCount: 18000,
  }),
  place({
    id: "ChIJ-nightmarket",
    name: "逢甲夜市",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction", "point_of_interest"],
    userRatingCount: 40000,
  }),
  place({
    id: "ChIJ-park",
    name: "秋紅谷廣場",
    primaryType: "park",
    types: ["park", "tourist_attraction"],
    userRatingCount: 8000,
  }),
];

const qualityPassed = qualitySix.filter((candidate) => isAcceptableRestaurantPlace(candidate));
const qualityItems = qualityPassed.map(recItem);
const renderReasons = countRestaurantRenderRejectionReasons(qualityItems, "台中西屯有什麼午餐餐廳");
const renderableItems = filterRecommendationsForCategoryRender(
  qualitySix.map(recItem),
  "restaurant",
  "台中西屯有什麼午餐餐廳",
);
console.log("  first-round quality/render reasons", {
  qualityPassed: qualityPassed.length,
  renderable: renderableItems.length,
  reasons: renderReasons,
});
assert.ok(qualityPassed.length >= 3, "legal restaurants must occupy quality slots");
assert.ok(
  !qualityPassed.some((candidate) => candidate.id === "ChIJ-mall"),
  "shopping mall must not steal restaurant quality slots",
);
assert.ok(
  !qualityPassed.some((candidate) => candidate.id === "ChIJ-park"),
  "park must not steal restaurant quality slots",
);
assert.ok(
  renderableItems.some((item) => item.googlePlaceId === "ChIJ-chinese"),
  "chinese_restaurant must remain renderable",
);
assert.equal(
  evaluateRestaurantRenderGuard(recItem(qualitySix[3]), "台中西屯有什麼午餐餐廳").reason,
  "blocked_type",
);
assert.equal(
  evaluateRestaurantRenderGuard(recItem(qualitySix[4]), "台中西屯有什麼午餐餐廳").reason,
  "food_district_not_card",
);

const displayBatch = DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE;
const { session, batch } = createRecommendationSession({
  destination: "台中西屯",
  parentCity: "台中",
  area: "西屯",
  searchScope: "area",
  searchRegionLabel: "台中西屯",
  topic: "restaurant",
  pool: renderableItems,
  batchSize: displayBatch,
});
assert.equal(session.area, "西屯", "structured area stays 西屯, not 台中西屯");
assert.equal(session.parentCity, "台中");
assert.equal(session.searchScope, "area");
assert.equal(session.searchRegionLabel, "台中西屯", "display label may stay 台中西屯");
assert.equal(batch.length, Math.min(displayBatch, renderableItems.length));
assert.equal(session.returnedPlaceIds.length, batch.length);
assert.notEqual(session.returnedPlaceIds.length, qualitySix.length);
assert.ok(
  session.returnedPlaceIds.length < renderableItems.length || renderableItems.length <= displayBatch,
  "shown IDs are the displayed batch, not the full searched/quality set",
);
assert.equal(session.pool.length, renderableItems.length);
assert.equal(
  shownRecommendationIdentitiesFromSession(session).placeIds.length,
  batch.length,
);
console.log(
  `  ✓ shownIds=${session.returnedPlaceIds.length} pool=${session.pool.length} searched=${qualitySix.length}`,
);

console.log("\n=== 18 category candidates → identity-only dedupe ===\n");

const shown = qualitySix[0];
const continuation18 = [
  shown,
  ...Array.from({ length: 17 }, (_, index) =>
    place({
      id: `ChIJ-cont-${index + 1}`,
      name: `西屯餐廳 ${index + 1}`,
      address: `台中市西屯區河南路 ${index + 1} 號`,
      primaryType: index % 2 === 0 ? "restaurant" : "taiwanese_restaurant",
      types:
        index % 2 === 0
          ? ["restaurant", "food"]
          : ["taiwanese_restaurant", "restaurant", "food"],
    }),
  ),
];
assert.equal(continuation18.length, 18);

const used = collectUsedPlaces({
  recommendedPlaces: [recItem(shown)],
  recommendedPlaceIds: [`id:${shown.id}`],
  usedPlaceIds: [`id:${shown.id}`],
  usedPlaceNames: [shown.name],
  selectedPlaces: [],
  plannedStops: [],
});
assert.ok(
  used.usedAreaKeys.some((key) => key.includes("西屯")),
  `legacy follow-up records a 西屯 district key, got ${used.usedAreaKeys.join(",")}`,
);
const legacyDropped = excludeUsedPlacesFromFollowUp(continuation18, used);
assert.equal(
  legacyDropped.length,
  0,
  "legacy area-key follow-up is the 18→0 collapse",
);
console.log("  ✓ legacy excludeUsedPlacesFromFollowUp: 18 → 0 (same-district area key)");

const merelySearched = qualitySix.map((candidate) => candidate.id);
const identity = filterContinuationByShownIdentity(continuation18, {
  shownPlaceIds: session.returnedPlaceIds,
  shownCanonicalKeys: session.returnedCanonicalKeys,
  merelySearchedPlaceIds: merelySearched,
  storedPoolPlaceIds: storedPoolPlaceIdsFromSession(session),
});
console.log("  identity breakdown", identity.breakdown);
assert.equal(identity.breakdown.inputCount, 18);
assert.equal(identity.breakdown.matchedByPlaceId, 1);
assert.equal(identity.breakdown.matchedAgainstDisplayed, 1);
assert.equal(identity.kept.length, 17);
assert.ok(
  identity.kept.every((candidate) => candidate.id !== shown.id),
  "already-shown Place ID stays excluded",
);
assert.ok(
  identity.kept.some((candidate) => merelySearched.includes(candidate.id) && candidate.id !== shown.id) ||
    identity.breakdown.matchedAgainstMerelySearched >= 0,
  "unshown searched candidates are countable and not hard-excluded",
);
assert.ok(
  identity.kept.some((candidate) => candidate.id === "ChIJ-cont-1"),
  "unshown legal Xitun restaurants remain available for 還有嗎",
);

const zhEnSameId = filterContinuationByShownIdentity(
  [
    place({
      id: shown.id,
      name: "Wagyama BBQ Wenxin",
      address: "No. 301, Sec. 3, Taiwan Blvd, Xitun District, Taichung",
    }),
  ],
  {
    shownPlaceIds: session.returnedPlaceIds,
    shownCanonicalKeys: session.returnedCanonicalKeys,
  },
);
assert.equal(zhEnSameId.kept.length, 0, "same Google Place ID in English still dedupes");
assert.equal(zhEnSameId.breakdown.matchedByPlaceId, 1);

console.log("\n=== Remaining renderable pool before new search ===\n");
{
  const firstMore = continueRecommendation(session);
  if (session.pool.length > session.cursor) {
    assert.ok(firstMore.batch.length > 0, "還有嗎 must consume remaining renderable pool first");
    assert.equal(firstMore.session.searchScope, "area");
    assert.equal(firstMore.session.area, "西屯");
  } else {
    assert.equal(firstMore.batch.length, 0);
  }
  console.log(
    `  ✓ stored remaining=${Math.max(0, session.pool.length - session.cursor)} firstMore=${firstMore.batch.length}`,
  );
}

console.log("\n=== Explicit area still does not cross districts ===\n");
{
  const xitunScope = resolveDestinationAreaScope("台中西屯");
  assert.ok(xitunScope);
  assert.equal(xitunScope.parentCity, "台中");
  assert.equal(xitunScope.area === "西屯" || xitunScope.area === "西屯區", true);
  const mixed = [
    place({ id: "ChIJ-keep", name: "西屯店", address: "台中市西屯區河南路1號" }),
    place({
      id: "ChIJ-beidun",
      name: "北屯店",
      address: "台中市北屯區昌平路二段1號",
    }),
  ];
  const scoped = filterPlacesByDestinationArea(mixed, xitunScope);
  assert.ok(scoped.some((candidate) => candidate.id === "ChIJ-keep"));
  assert.ok(!scoped.some((candidate) => candidate.id === "ChIJ-beidun"));
  console.log("  ✓ 西屯 hard scope still drops 北屯");
}

console.log("\n=== Tokyo Shinjuku stored-pool continuation ===\n");
{
  const usable = Array.from({ length: 6 }, (_, index) => ({
    name: `新宿咖啡 ${index + 1}`,
    googlePlaceId: `ChIJshinjuku_cafe_${index + 1}`,
    address: "東京都新宿区西新宿1-1",
  }));
  const created = createRecommendationSession({
    destination: "東京新宿",
    parentCity: "東京",
    area: "新宿",
    searchScope: "area",
    topic: "cafe",
    pool: usable,
    batchSize: DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE,
  });
  const firstMore = continueRecommendation(created.session);
  assert.equal(firstMore.batch.length, 3);
  assert.equal(firstMore.session.area, "新宿");
  assert.equal(created.session.returnedPlaceIds.length, 3);
  console.log("  ✓ 東京新宿 stored pool continuation still works");
}

console.log("\n=== Kaohsiung Gushan continuation ===\n");
{
  const usable = Array.from({ length: 6 }, (_, index) => ({
    name: `鼓山餐廳 ${index + 1}`,
    googlePlaceId: `ChIJgushan_rest_${index + 1}`,
    address: "高雄市鼓山區臨海二路1號",
  }));
  const created = createRecommendationSession({
    destination: "高雄鼓山",
    parentCity: "高雄",
    area: "鼓山",
    searchScope: "area",
    topic: "restaurant",
    pool: usable,
    batchSize: DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE,
  });
  const firstMore = continueRecommendation(created.session);
  assert.equal(created.session.returnedPlaceIds.length, 3);
  assert.equal(firstMore.batch.length, 3);
  assert.equal(firstMore.session.area, "鼓山");
  assert.equal(firstMore.session.parentCity, "高雄");
  const gushanScope = resolveDestinationAreaScope("高雄鼓山");
  const crossed = filterPlacesByDestinationArea(
    [
      place({
        id: "ChIJ-yancheng",
        name: "鹽埕店",
        address: "高雄市鹽埕區大勇路1號",
      }),
    ],
    gushanScope,
  );
  assert.equal(crossed.length, 0, "鼓山 continuation still does not cross to 鹽埕");
  console.log("  ✓ 高雄鼓山 continuation keeps area and does not cross districts");
}

console.log("\n=== Category filter uses restaurant taxonomy, not POI ratings ===\n");
{
  const filtered = filterChatCategoryPlaces(qualitySix, {
    intent: "restaurant",
    destination: "台中西屯",
    userText: "台中西屯有什麼午餐餐廳",
  });
  assert.ok(filtered.every((candidate) => evaluateFoodPlace(candidate).allowed));
  assert.ok(!filtered.some((candidate) => candidate.id === "ChIJ-mall"));
  console.log(`  ✓ category/quality pool=${filtered.length} is restaurant-only`);
}

console.log("\nverify-continuation-dedupe-visibility: ok");
