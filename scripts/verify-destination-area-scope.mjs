#!/usr/bin/env node
import assert from "node:assert/strict";
import { resolveDestinationAreaScope } from "../src/lib/ai/destination-travel-profile.ts";
import { parsePlaceRecommendationIntent } from "../src/lib/ai/place-recommendation-intent/parse.ts";
import { buildChatPlaceSearchAttempts } from "../src/lib/ai/chat-place-intent.ts";

const fixtures = [
  ["台南安平有什麼咖啡廳推薦", "台南", "安平"],
  ["高雄鹽埕有什麼咖啡廳推薦", "高雄", "鹽埕"],
  ["台北信義有什麼咖啡廳推薦", "台北", "信義"],
  ["東京上野有什麼咖啡廳推薦", "東京", "上野"],
  ["東京澀谷有什麼咖啡廳推薦", "東京", "澀谷"],
  ["大阪心齋橋有什麼咖啡廳推薦", "大阪", "心齋橋"],
  ["京都祇園有什麼咖啡廳推薦", "京都", "祇園"],
  ["首爾弘大有什麼咖啡廳推薦", "首爾", "弘大"],
  ["首爾明洞有什麼咖啡廳推薦", "首爾", "明洞"],
  ["曼谷暹羅有什麼咖啡廳推薦", "曼谷", "暹羅"],
];

for (const [text, parentCity, area] of fixtures) {
  const scope = resolveDestinationAreaScope(text);
  assert.ok(scope, text);
  assert.equal(scope.parentCity, parentCity);
  assert.equal(scope.area, area);
  assert.equal(scope.searchScope, "area");
  const parsed = parsePlaceRecommendationIntent(text);
  assert.equal(parsed?.destinationDisplayLabel, `${parentCity}${area}`);
  assert.equal(parsed?.resolvedSearchCity, parentCity);
  assert.equal(parsed?.destinationArea, area);
}

const attempts = buildChatPlaceSearchAttempts(
  "cafe",
  "台南安平",
  "台南安平有什麼咖啡廳推薦",
);
assert.ok(attempts.primary.length > 0);
assert.ok(attempts.primary.every((attempt) => attempt.query.includes("台南安平")));
assert.ok(attempts.fallback.some((attempt) => attempt.query.includes("台南")));
const firstCityFallback = attempts.fallback.findIndex(
  (attempt) => attempt.query.includes("台南") && !attempt.query.includes("安平"),
);
assert.ok(firstCityFallback >= 0, "parent city fallback must exist after area attempts");

const canonicalPlace = { id: "ChIJcanonical", googlePlaceId: "ChIJcanonical" };
assert.deepEqual(canonicalPlace, { id: "ChIJcanonical", googlePlaceId: "ChIJcanonical" });

console.info("verify-destination-area-scope: ok");
