import assert from "node:assert/strict";
import {
  extractItineraryDestinationFromText,
  sanitizeDestinationForGeocode,
} from "../src/lib/ai/itinerary-entity-extraction.ts";
import { extractEmbeddedDestinationFromText } from "../src/lib/ai/trip-planning-context.ts";

// Google zh-TW geocode labels Tokyo as 「日本東京都」, which contains 京都.
const fixtures = [
  ["日本東京都", "東京"],
  ["日本東京都澀谷區", "東京"],
  ["東京都", "東京"],
  ["日本京都府", "京都"],
  ["京都", "京都"],
  ["日本大阪府", "大阪"],
  ["日本北海道札幌市", "北海道"],
  ["台灣台北市", "台北"],
  ["韓國首爾特別市", "首爾"],
];

for (const [input, expected] of fixtures) {
  assert.equal(sanitizeDestinationForGeocode(input), expected, `sanitize ${input}`);
  assert.equal(extractItineraryDestinationFromText(input), expected, `extract ${input}`);
  assert.equal(extractEmbeddedDestinationFromText(input), expected, `embedded ${input}`);
}

// Labels outside the embedded list must pass through untouched (no cross-city rewrite).
const passThrough = [
  "Tokyo, Japan", "일본 도쿄도", "Osaka, Japan", "Porto, Portugal", "葡萄牙波多",
  "Reykjavík, Iceland", "冰島雷克雅維克", "Seoul, South Korea", "서울특별시", "Taipei City, Taiwan",
];
for (const input of passThrough) {
  assert.equal(sanitizeDestinationForGeocode(input), input, `pass-through ${input}`);
}

console.log(`PASS embedded destination overlap (${fixtures.length + passThrough.length} fixtures)`);
