import assert from "node:assert/strict";
import { filterRecommendationItemsForDisplay } from "../src/lib/recommend-place-ranking.ts";
import { resolveRecommendationTimePolicy } from "../src/lib/ai/recommendation-time-sensitivity.ts";

const base = {
  id: "place-1",
  placeId: "place-1",
  googlePlaceId: "place-1",
  name: "測試咖啡",
  type: "cafe",
  rating: 4.5,
  userRatingCount: 100,
};

const general = resolveRecommendationTimePolicy("台南有什麼咖啡廳推薦");
assert.equal(
  filterRecommendationItemsForDisplay(
    [{ ...base, openStatusLabel: "目前未營業" }],
    general,
  ).length,
  1,
);
assert.equal(
  filterRecommendationItemsForDisplay(
    [{ ...base, businessStatus: "CLOSED_TEMPORARILY", openStatusLabel: "目前未營業" }],
    general,
  ).length,
  0,
);
assert.equal(
  filterRecommendationItemsForDisplay(
    [{ ...base, businessStatus: "CLOSED_PERMANENTLY", openStatusLabel: "目前未營業" }],
    general,
  ).length,
  0,
);

const followup = resolveRecommendationTimePolicy("還有嗎");
assert.equal(
  filterRecommendationItemsForDisplay([{ ...base, openStatusLabel: "目前未營業" }], followup).length,
  1,
);

const now = resolveRecommendationTimePolicy("現在有什麼咖啡廳");
assert.equal(
  filterRecommendationItemsForDisplay([{ ...base, openStatusLabel: "目前未營業" }], now).length,
  0,
);

const meal = resolveRecommendationTimePolicy("今晚吃什麼");
assert.equal(meal.mode, "TIME_SENSITIVE");
assert.equal(meal.requireOpenNow, true);

const nearby = resolveRecommendationTimePolicy("附近有什麼推薦", "LIVE_NEARBY");
assert.equal(nearby.mode, "LIVE_NEARBY");
assert.equal(nearby.requireOpenNow, false);

console.log("General recommendation opening-hours verification passed.");
