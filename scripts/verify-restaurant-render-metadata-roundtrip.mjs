#!/usr/bin/env node
/**
 * PlaceResult → RecommendationItem → restaurant render guard round-trip.
 * Quality-approved restaurant candidates must keep primaryType + full types[].
 */
import assert from "node:assert/strict";
import { mapPlaceResultToChatItem } from "../src/lib/chat-session.ts";
import {
  evaluateRestaurantRenderGuard,
  filterRecommendationsForCategoryRender,
} from "../src/lib/ai/chat-category-place-guard.ts";
import {
  applyRecommendationPlaceTypeMetadata,
  recommendationTypeMetadataFromItem,
  recommendationTypeMetadataFromPlace,
} from "../src/lib/ai/recommendation-place-type-metadata.ts";
import { normalizeRecommendationItem } from "../src/lib/ai/types.ts";

function placeResult(overrides = {}) {
  return {
    id: "ChIJ-luzhou-1",
    name: "蘆洲在地餐廳",
    address: "新北市蘆洲區得勝街12號",
    lat: 25.084,
    lng: 121.467,
    rating: 4.5,
    userRatingCount: 210,
    photoName: null,
    primaryType: "chinese_restaurant",
    types: ["chinese_restaurant", "restaurant", "food", "point_of_interest", "establishment"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    ...overrides,
  };
}

{
  const source = placeResult();
  const before = recommendationTypeMetadataFromPlace(source);
  assert.equal(before.primaryType, "chinese_restaurant");
  assert.ok(before.types.includes("restaurant"));
  assert.ok(before.types.includes("food"));

  const item = mapPlaceResultToChatItem(source, { locale: "zh-TW", categoryIntent: "restaurant" });
  const afterMap = recommendationTypeMetadataFromItem(item);
  assert.equal(afterMap.primaryType, "chinese_restaurant", "mapper must keep Google primaryType");
  assert.deepEqual(
    afterMap.types.slice().sort(),
    before.types.slice().sort(),
    "mapper must keep full types[]",
  );

  const normalized = normalizeRecommendationItem(item);
  const afterNorm = recommendationTypeMetadataFromItem(normalized);
  assert.equal(afterNorm.primaryType, "chinese_restaurant");
  assert.ok(afterNorm.types.includes("restaurant"));
  assert.ok(afterNorm.types.includes("chinese_restaurant"));

  const restored = applyRecommendationPlaceTypeMetadata(normalized, source);
  assert.equal(restored.primaryType, source.primaryType);
  assert.ok(restored.types.includes("restaurant"));
  assert.equal(evaluateRestaurantRenderGuard(restored, "新北蘆洲有什麼餐廳推薦嗎").allowed, true);
  assert.equal(
    filterRecommendationsForCategoryRender([restored], "restaurant", "新北蘆洲有什麼餐廳推薦嗎")
      .length,
    1,
  );
  console.log("  ✓ chinese_restaurant PlaceResult round-trip survives restaurant render guard");
}

{
  const source = placeResult({
    primaryType: "taiwanese_restaurant",
    types: ["taiwanese_restaurant"],
  });
  const item = mapPlaceResultToChatItem(source, { locale: "zh-TW" });
  assert.equal(item.primaryType, "taiwanese_restaurant");
  assert.deepEqual(item.types, ["taiwanese_restaurant"]);
  assert.equal(
    passesOrThrow(item, "Google subtype-only types[] must still render as restaurant"),
    true,
  );
  console.log("  ✓ subtype-only types=[taiwanese_restaurant] survives");
}

{
  const source = placeResult({
    primaryType: "point_of_interest",
    types: ["restaurant"],
  });
  const item = mapPlaceResultToChatItem(source, { locale: "zh-TW" });
  assert.equal(item.primaryType, "point_of_interest");
  assert.ok(item.types.includes("restaurant"));
  assert.equal(evaluateRestaurantRenderGuard(item, "餐廳推薦").allowed, true);
  console.log("  ✓ generic primaryType + types=[restaurant] survives");
}

{
  const source = placeResult({
    primaryType: "point_of_interest",
    types: ["food"],
  });
  const item = mapPlaceResultToChatItem(source, { locale: "zh-TW" });
  assert.equal(evaluateRestaurantRenderGuard(item, "餐廳推薦").allowed, true);
  console.log("  ✓ generic primaryType + types=[food] survives");
}

{
  const source = placeResult({
    id: "ChIJ-museum",
    name: "蘆洲某博物館",
    primaryType: "museum",
    types: ["museum", "point_of_interest"],
  });
  const item = mapPlaceResultToChatItem(source, { locale: "zh-TW" });
  const verdict = evaluateRestaurantRenderGuard(item, "餐廳推薦");
  assert.equal(verdict.allowed, false);
  assert.notEqual(verdict.reason, "ok");
  console.log(`  ✓ true non-food POI rejected (${verdict.reason})`);
}

{
  const qualityApproved = [
    placeResult({ id: "ChIJ-1", name: "餐廳A", primaryType: "chinese_restaurant", types: ["chinese_restaurant"] }),
    placeResult({ id: "ChIJ-2", name: "餐廳B", primaryType: "meal_takeaway", types: ["meal_takeaway", "food"] }),
    placeResult({
      id: "ChIJ-3",
      name: "餐廳C",
      primaryType: "point_of_interest",
      types: ["point_of_interest", "restaurant", "food"],
    }),
    placeResult({ id: "ChIJ-4", name: "餐廳D", primaryType: "restaurant", types: ["restaurant"] }),
    placeResult({ id: "ChIJ-5", name: "餐廳E", primaryType: "ramen_restaurant", types: ["ramen_restaurant"] }),
    placeResult({ id: "ChIJ-6", name: "餐廳F", primaryType: "fast_food_restaurant", types: ["fast_food_restaurant"] }),
  ].map((p) => mapPlaceResultToChatItem(p, { locale: "zh-TW" }));
  const renderable = filterRecommendationsForCategoryRender(
    qualityApproved,
    "restaurant",
    "新北蘆洲有什麼餐廳推薦嗎",
  );
  assert.equal(
    renderable.length,
    6,
    "quality-approved restaurant candidates must survive render guard",
  );
  console.log("  ✓ 6 quality-approved Luzhou restaurants survive render guard");
}

function passesOrThrow(item, message) {
  const allowed = evaluateRestaurantRenderGuard(item, "餐廳推薦").allowed;
  assert.equal(allowed, true, message);
  return allowed;
}

console.info("verify-restaurant-render-metadata-roundtrip: ok");
