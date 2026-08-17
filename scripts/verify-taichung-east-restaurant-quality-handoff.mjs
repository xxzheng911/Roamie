#!/usr/bin/env node
/**
 * Quality → recommendation mapper → restaurant render handoff.
 * Generic「有什麼餐廳推薦」must not infer lunch hours and wipe quality candidates.
 */
import assert from "node:assert/strict";
import { mapPlaceResultToChatItem } from "../src/lib/chat-session.ts";
import {
  applyRecommendationPlaceTypeMetadata,
  recommendationTypeMetadataFromItem,
  recommendationTypeMetadataFromPlace,
} from "../src/lib/ai/recommendation-place-type-metadata.ts";
import { normalizeRecommendationItem } from "../src/lib/ai/types.ts";
import {
  dedupeRecommendationCopy,
  evaluateRestaurantRenderGuard,
  filterRecommendationsForCategoryRender,
} from "../src/lib/ai/chat-category-place-guard.ts";
import { filterChatCategoryPlaces } from "../src/lib/ai/chat-destination-place-filter.ts";
import { isAcceptableRestaurantPlace } from "../src/lib/ai/recommendation-refinement/search.ts";
import {
  filterPlacesForMealIntent,
  isExplicitMealSlotText,
  parseMealIntentFromText,
  resolveExplicitMealIntent,
} from "../src/lib/ai/meal-intent-parser.ts";
import { resolveDestinationAreaScope } from "../src/lib/ai/destination-travel-profile.ts";
import { filterPlacesByDestinationArea } from "../src/lib/ai/chat-place-search-context.ts";
import { resolveDestinationApproxCenter } from "../src/lib/ai/destination-geocode.ts";

const TAICHUNG_EAST_QUERY = "台中東區有什麼餐廳推薦嗎";

function place(overrides = {}) {
  return {
    id: "ChIJ-east-default",
    name: "東區餐廳",
    address: "台中市東區復興路4段1號",
    lat: 24.137,
    lng: 120.697,
    rating: 4.5,
    userRatingCount: 80,
    photoName: null,
    primaryType: "restaurant",
    types: ["restaurant", "food", "point_of_interest", "establishment"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    ...overrides,
  };
}

function mapQualityToRender(places, userText) {
  const mappedRecommendationItems = places.map((source) => {
    const item = mapPlaceResultToChatItem(source, {
      locale: "zh-TW",
      categoryIntent: "restaurant",
      categoryLabel: "餐廳",
    });
    return dedupeRecommendationCopy(applyRecommendationPlaceTypeMetadata(item, source));
  });
  const normalizedItems = mappedRecommendationItems.map((item) =>
    normalizeRecommendationItem(item),
  );
  const restaurantRenderOutput = filterRecommendationsForCategoryRender(
    normalizedItems,
    "restaurant",
    userText,
  );
  return {
    qualityPlaces: places,
    mappedRecommendationItems,
    normalizedItems,
    preRenderItems: normalizedItems,
    restaurantRenderInput: normalizedItems,
    restaurantRenderOutput,
  };
}

function assertMetadataRoundTrip(source, item, label) {
  const before = recommendationTypeMetadataFromPlace(source);
  const after = recommendationTypeMetadataFromItem(item);
  assert.equal(item.googlePlaceId ?? item.placeId, source.id, `${label} keeps placeId`);
  assert.equal(after.primaryType, before.primaryType, `${label} keeps primaryType`);
  for (const type of before.types) {
    assert.ok(after.types.includes(type), `${label} keeps type ${type}`);
  }
}

{
  assert.equal(isExplicitMealSlotText(TAICHUNG_EAST_QUERY), false);
  assert.equal(parseMealIntentFromText(TAICHUNG_EAST_QUERY), null);
  assert.equal(resolveExplicitMealIntent(TAICHUNG_EAST_QUERY), null);
  assert.ok(isExplicitMealSlotText("台中東區午餐有什麼餐廳"));
  assert.equal(resolveExplicitMealIntent("台中東區午餐有什麼餐廳")?.slot, "lunch");
  console.log("  ✓ generic 餐廳推薦 is not inferred lunch; explicit 午餐 still parses");
}

{
  const scope = resolveDestinationAreaScope(TAICHUNG_EAST_QUERY);
  assert.ok(scope);
  assert.equal(scope.parentCity, "台中");
  assert.equal(scope.area, "東區");

  const qualitySpecs = [
    {
      id: "ChIJ-east-1",
      name: "東區中餐廳",
      primaryType: "chinese_restaurant",
      types: ["chinese_restaurant", "restaurant", "food"],
    },
    {
      id: "ChIJ-east-2",
      name: "東區牛排館",
      primaryType: "steak_house",
      types: ["steak_house", "food", "point_of_interest"],
    },
    {
      id: "ChIJ-east-3",
      name: "東區三明治",
      primaryType: "sandwich_shop",
      types: ["sandwich_shop", "food"],
    },
    {
      id: "ChIJ-east-4",
      name: "東區diner",
      primaryType: "diner",
      types: ["diner"],
    },
    {
      id: "ChIJ-east-5",
      name: "東區茶餐廳",
      primaryType: "tea_house",
      types: ["tea_house", "restaurant"],
    },
    {
      id: "ChIJ-east-6",
      name: "東區麵店",
      primaryType: "taiwanese_restaurant",
      types: ["taiwanese_restaurant"],
    },
  ];

  const destRestaurantsLowReview = Array.from({ length: 16 }, (_, i) =>
    place({
      id: `ChIJ-east-low-${i}`,
      name: `東區在地小吃${i + 1}`,
      rating: 4.5,
      userRatingCount: 8,
      primaryType: "restaurant",
      types: ["restaurant", "food"],
    }),
  );
  const destNonRestaurant = [
    place({
      id: "ChIJ-east-museum",
      name: "台中文化博物館",
      primaryType: "museum",
      types: ["museum", "tourist_attraction"],
      userRatingCount: 400,
    }),
    place({
      id: "ChIJ-east-mall",
      name: "東區購物中心",
      primaryType: "shopping_mall",
      types: ["shopping_mall", "store"],
      userRatingCount: 900,
    }),
  ];
  const destAccepted = [
    ...qualitySpecs.map((spec) => place({ ...spec, userRatingCount: 80, rating: 4.5 })),
    ...destRestaurantsLowReview,
    ...destNonRestaurant,
  ];
  assert.equal(destAccepted.length, 24, "destination accepted fixture is 24");

  const outOfArea = [
    ...Array.from({ length: 10 }, (_, i) =>
      place({
        id: `ChIJ-xitun-${i}`,
        name: `西屯餐廳${i + 1}`,
        address: "台中市西屯區台灣大道三段301號",
        lat: 24.178,
        lng: 120.647,
      }),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      place({
        id: `ChIJ-taipei-${i}`,
        name: `台北餐廳${i + 1}`,
        address: "台北市信義區松壽路9號",
        lat: 25.04,
        lng: 121.56,
      }),
    ),
  ];
  const providerCandidates = [...destAccepted, ...outOfArea];
  assert.equal(providerCandidates.length, 39, "provider candidates=39");

  const afterDestination = filterPlacesByDestinationArea(providerCandidates, scope);
  assert.equal(afterDestination.length, 24, "destination accepted=24");

  let categoryCount = 0;
  let qualityCount = 0;
  const qualityPlaces = filterChatCategoryPlaces(afterDestination, {
    intent: "restaurant",
    destination: "台中東區",
    userText: TAICHUNG_EAST_QUERY,
    onDiagnostics: (counts) => {
      categoryCount = counts.afterCategoryGuardCount;
      qualityCount = counts.afterQualityCount;
    },
  });
  assert.equal(categoryCount, 22, "category accepted=22");
  assert.equal(qualityCount, 6, "quality=6");
  assert.equal(qualityPlaces.length, 6);
  assert.ok(qualityPlaces.every((p) => isAcceptableRestaurantPlace(p)));

  const inferredLunch = { slot: "lunch", targetTime: "12:00" };
  const mealWiped = filterPlacesForMealIntent(qualityPlaces, inferredLunch);
  assert.equal(
    mealWiped.length,
    0,
    "missing-hours lunch filter is the historical 6→0 boundary",
  );
  assert.equal(
    resolveExplicitMealIntent(TAICHUNG_EAST_QUERY),
    null,
    "generic restaurant must not apply that meal filter",
  );

  const handoff = mapQualityToRender(qualityPlaces, TAICHUNG_EAST_QUERY);
  assert.equal(handoff.mappedRecommendationItems.length, 6, "mappedRecommendationItems=6");
  assert.equal(handoff.normalizedItems.length, 6, "normalizedItems=6");
  assert.equal(handoff.restaurantRenderInput.length, 6, "restaurantRenderInput=6");
  assert.equal(
    handoff.restaurantRenderOutput.length,
    6,
    "quality candidates must not become 0 after mapper/render",
  );
  for (const source of qualityPlaces) {
    const item = handoff.mappedRecommendationItems.find(
      (row) => (row.googlePlaceId ?? row.placeId) === source.id,
    );
    assert.ok(item, `mapped item for ${source.id}`);
    assertMetadataRoundTrip(source, item, source.name);
    assert.equal(evaluateRestaurantRenderGuard(item, TAICHUNG_EAST_QUERY).allowed, true);
  }
  console.log("  ✓ 台中東區 39→24→22→6 quality candidates survive mapper/render");
}

function cityRestaurantHandoff(query, address, primaryType, types) {
  const source = place({
    id: `ChIJ-${query}`,
    name: `${query}餐廳`,
    address,
    primaryType,
    types,
    rating: 4.6,
    userRatingCount: 120,
  });
  assert.equal(resolveExplicitMealIntent(query), null);
  const quality = filterChatCategoryPlaces([source], {
    intent: "restaurant",
    destination: query.replace(/有什麼餐廳推薦嗎/, ""),
    userText: query,
  });
  assert.equal(quality.length, 1, `${query} stays in quality`);
  const handoff = mapQualityToRender(quality, query);
  assert.equal(handoff.restaurantRenderOutput.length, 1, `${query} reaches render`);
  assertMetadataRoundTrip(source, handoff.mappedRecommendationItems[0], query);
}

cityRestaurantHandoff(
  "新北蘆洲有什麼餐廳推薦嗎",
  "新北市蘆洲區得勝街12號",
  "chinese_restaurant",
  ["chinese_restaurant", "restaurant", "food"],
);
cityRestaurantHandoff(
  "台中西屯有什麼餐廳推薦嗎",
  "台中市西屯區台灣大道三段301號",
  "barbecue_restaurant",
  ["barbecue_restaurant", "restaurant"],
);
cityRestaurantHandoff(
  "高雄鼓山有什麼餐廳推薦嗎",
  "高雄市鼓山區鼓山一路1號",
  "seafood_restaurant",
  ["seafood_restaurant"],
);
cityRestaurantHandoff(
  "花蓮玉里有什麼餐廳推薦嗎",
  "花蓮縣玉里鎮中山路1號",
  "restaurant",
  ["restaurant", "food"],
);
cityRestaurantHandoff(
  "東京新宿有什麼餐廳推薦嗎",
  "東京都新宿区新宿3-1-1",
  "ramen_restaurant",
  ["ramen_restaurant"],
);
console.log("  ✓ 蘆洲 / 西屯 / 鼓山 / 玉里 / 新宿 restaurant handoff");

{
  const blocked = [
    place({
      id: "ChIJ-museum",
      name: "某博物館",
      primaryType: "museum",
      types: ["museum", "point_of_interest"],
    }),
    place({
      id: "ChIJ-mall",
      name: "某百貨",
      primaryType: "shopping_mall",
      types: ["shopping_mall"],
    }),
    place({
      id: "ChIJ-park",
      name: "某公園",
      primaryType: "park",
      types: ["park"],
    }),
  ];
  for (const source of blocked) {
    const item = mapPlaceResultToChatItem(source, { locale: "zh-TW", categoryIntent: "restaurant" });
    assert.equal(
      evaluateRestaurantRenderGuard(item, TAICHUNG_EAST_QUERY).allowed,
      false,
      `${source.primaryType} must not render as restaurant`,
    );
  }
  const missingId = mapPlaceResultToChatItem(
    place({ id: "", name: "無ID餐廳" }),
    { locale: "zh-TW", categoryIntent: "restaurant" },
  );
  assert.equal(evaluateRestaurantRenderGuard(missingId, TAICHUNG_EAST_QUERY).allowed, false);
  console.log("  ✓ museum / mall / park / missing Place ID still rejected");
}

{
  const cityCenter = resolveDestinationApproxCenter("台中");
  assert.ok(cityCenter);
  assert.equal(cityCenter.lat, 24.1477);
  assert.equal(cityCenter.lng, 120.6736);
  console.log("  ✓ 24.1477,120.6736 is 台中 city centroid, not a dedicated 東區 centroid");
}

console.info("verify-taichung-east-restaurant-quality-handoff: ok");
