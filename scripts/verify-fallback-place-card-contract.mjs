#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildNamedFallbackRecommendations } from "../src/lib/ai/must-visit-places.ts";
import {
  recommendationToPlaceSnapshot,
  openRecommendationOnMap,
  openRecommendationPlaceDetail,
} from "../src/lib/recommendation-place-handoff.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

console.log("\n[verify:fallback-place-card-contract]\n");

test("fallback name-only recommendation cannot become interactive snapshot", () => {
  const fallback = buildNamedFallbackRecommendations("曼谷")[0];
  assert.ok(fallback);
  assert.equal(Boolean(fallback.googlePlaceId), false);
  assert.equal(recommendationToPlaceSnapshot(fallback), null);
  assert.equal(openRecommendationOnMap(fallback), null);
  assert.equal(openRecommendationPlaceDetail(fallback), null);
});

test("verified google place can open normally", () => {
  const verified = {
    name: "東京車站",
    placeName: "東京車站",
    type: "景點",
    googlePlaceId: "ChIJ1234567890",
    lat: 35.6812,
    lng: 139.7671,
    address: "Tokyo",
    description: "",
    reason: "",
  };
  const snapshot = recommendationToPlaceSnapshot(verified);
  const detail = openRecommendationPlaceDetail(verified);
  assert.ok(snapshot);
  assert.ok(detail);
  assert.equal(snapshot?.id.startsWith("rec-"), false);
  assert.equal(detail?.placeId.startsWith("rec-"), false);
});

console.log("\n[verify:fallback-place-card-contract] OK\n");
