#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  evaluateRestaurantRenderGuard,
  filterRecommendationsForCategoryRender,
  passesRestaurantRenderGuard,
} from "../src/lib/ai/chat-category-place-guard.ts";
import { evaluateFoodPlace } from "../src/lib/ai/chat-food-filter.ts";
import { mapPlaceResultToChatItem } from "../src/lib/chat-session.ts";
import { applyRecommendationPlaceTypeMetadata } from "../src/lib/ai/recommendation-place-type-metadata.ts";
import { normalizeRecommendationItem } from "../src/lib/ai/types.ts";

const place = (overrides = {}) => ({
  name: "測試地點",
  placeName: "測試地點",
  type: "point_of_interest",
  primaryType: "point_of_interest",
  types: ["point_of_interest"],
  description: "",
  reason: "",
  estimatedTime: "",
  address: "台北市信義區",
  lat: null,
  lng: null,
  googleMapsUrl: "",
  reasonSource: "template",
  googlePlaceId: "ChIJ-test",
  ...overrides,
});

assert.equal(
  passesRestaurantRenderGuard(
    place({ types: ["point_of_interest", "restaurant", "food"] }),
    "餐廳推薦",
  ),
  true,
  "full restaurant types must survive a generic primary type",
);
assert.equal(
  passesRestaurantRenderGuard(
    place({ types: ["point_of_interest", "food"] }),
    "餐廳推薦",
  ),
  true,
  "food type evidence must survive recommendation-item mapping",
);
assert.equal(
  passesRestaurantRenderGuard(
    place({
      type: "point_of_interest",
      primaryType: "chinese_restaurant",
      types: ["chinese_restaurant"],
    }),
    "餐廳推薦",
  ),
  true,
  "Google *_restaurant subtype must survive without parent restaurant type",
);
assert.equal(
  passesRestaurantRenderGuard(
    place({
      type: "point_of_interest",
      primaryType: "taiwanese_restaurant",
      types: ["taiwanese_restaurant", "point_of_interest", "establishment"],
    }),
    "餐廳推薦",
  ),
  true,
  "taiwanese_restaurant subtype must survive POI-only extra types",
);
assert.equal(
  passesRestaurantRenderGuard(
    place({ type: "restaurant", primaryType: "restaurant", types: ["restaurant"] }),
    "餐廳推薦",
  ),
  true,
  "generic primaryType + types=[restaurant] survives",
);
assert.equal(
  passesRestaurantRenderGuard(place(), "餐廳推薦"),
  false,
  "true non-food POI remains rejected",
);
assert.equal(
  passesRestaurantRenderGuard(
    place({ primaryType: "museum", types: ["museum", "point_of_interest"] }),
    "餐廳推薦",
  ),
  false,
  "blocked non-food type remains rejected",
);
assert.equal(
  passesRestaurantRenderGuard(place({ googlePlaceId: undefined }), "餐廳推薦"),
  false,
  "canonical Place ID remains required",
);
assert.equal(
  passesRestaurantRenderGuard(
    place({ types: ["restaurant", "food"], photoName: null, businessStatus: "CLOSED_TEMPORARILY" }),
    "餐廳推薦",
  ),
  true,
  "image and opening state remain outside the category render guard",
);

const mapped = applyRecommendationPlaceTypeMetadata(
  {
    name: "蘆洲麵店",
    type: "地點",
    primaryType: null,
    types: undefined,
    description: "",
    reason: "",
    estimatedTime: "",
    address: "新北市蘆洲區",
    lat: null,
    lng: null,
    googleMapsUrl: "",
    placeName: "蘆洲麵店",
    reasonSource: "template",
    googlePlaceId: "ChIJ-luzhou",
  },
  {
    primaryType: "chinese_restaurant",
    types: ["chinese_restaurant", "restaurant", "food", "point_of_interest"],
  },
);
assert.equal(mapped.primaryType, "chinese_restaurant");
assert.deepEqual(mapped.types, [
  "chinese_restaurant",
  "restaurant",
  "food",
  "point_of_interest",
]);
assert.equal(passesRestaurantRenderGuard(mapped, "新北蘆洲有什麼餐廳推薦嗎"), true);

const placeResult = {
  id: "ChIJ-roundtrip",
  name: "蘆洲小吃",
  address: "新北市蘆洲區中正路1號",
  lat: 25.08,
  lng: 121.47,
  rating: 4.4,
  userRatingCount: 88,
  photoName: null,
  primaryType: "chinese_restaurant",
  types: ["chinese_restaurant", "restaurant", "food"],
  businessStatus: "OPERATIONAL",
  openStatus: "unknown",
  openStatusLabel: "",
  todayHoursLabel: "",
  closingSoonNote: "",
  nextOpenHint: "",
};
const chatItem = mapPlaceResultToChatItem(placeResult, { locale: "zh-TW" });
const normalized = normalizeRecommendationItem(chatItem);
assert.equal(normalized.primaryType, "chinese_restaurant");
assert.ok(normalized.types?.includes("restaurant"));
assert.ok(normalized.types?.includes("food"));
assert.equal(normalized.googlePlaceId, "ChIJ-roundtrip");
assert.equal(
  evaluateRestaurantRenderGuard(normalized, "餐廳推薦").allowed,
  true,
);
assert.equal(
  filterRecommendationsForCategoryRender([normalized], "restaurant", "餐廳推薦").length,
  1,
);

const foodOnly = evaluateFoodPlace(
  { name: "便當", address: "新北市蘆洲區", primaryType: "point_of_interest", types: ["food"] },
  "餐廳推薦",
);
assert.equal(foodOnly.allowed, true, "types=[food] survives existing food contract");

const poiOnly = evaluateFoodPlace(
  {
    name: "普通地標",
    address: "新北市蘆洲區",
    primaryType: "point_of_interest",
    types: ["point_of_interest"],
  },
  "餐廳推薦",
);
assert.equal(poiOnly.allowed, false, "true non-food POI remains rejected");

console.info("verify-restaurant-render-type-fidelity: ok");
