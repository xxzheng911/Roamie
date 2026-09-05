import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeTripPlaceInput,
  tripPlaceFromPlaceResult,
  tripPlaceFromRecommendation,
  tripPlaceFromSavedPlace,
  tripPlaceToItineraryItem,
} from "../src/lib/trip/trip-place-input.ts";
import { normalizeItineraryItem } from "../src/lib/ai/types.ts";
import { itineraryItemToPlaceHandoff } from "../src/lib/trip/trip-itinerary-place-handoff.ts";
import { resolvePlaceDetailReasonWithSource } from "../src/lib/place-detail-resolve.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.info(`PASS ${name}`);
}

const recommendation = {
  name: "測試咖啡店", placeName: "測試咖啡店", type: "咖啡", description: "",
  reason: "適合在安靜午後停留。", estimatedTime: "1 小時", address: "測試地址",
  lat: 25.03, lng: 121.56, googleMapsUrl: "", reasonSource: "evidence",
  googlePlaceId: "ChIJReasonSnapshot123",
};

test("recommendation adapter preserves reason A", () => {
  const place = tripPlaceFromRecommendation(recommendation);
  assert.equal(place.recommendationReason, recommendation.reason);
  assert.equal(place.recommendationReasonSource, "evidence");
});

const input = normalizeTripPlaceInput({
  ...tripPlaceFromRecommendation(recommendation), recommendationSource: "explore",
});
const stop = tripPlaceToItineraryItem(input, { date: "2026-09-05" });

test("Add-to-Trip stop stores reason and provenance", () => {
  assert.equal(stop.recommendationReason, recommendation.reason);
  assert.equal(stop.recommendationSource, "explore");
  assert.equal(stop.recommendationReasonVersion, 1);
});

test("Trip to Detail resolves the same reason", () => {
  const handoff = itineraryItemToPlaceHandoff(stop);
  assert.equal(handoff.reason, recommendation.reason);
  assert.deepEqual(resolvePlaceDetailReasonWithSource(handoff, handoff.snapshot), {
    reason: recommendation.reason, source: "recommendation_session",
  });
});

test("JSON persistence and hydration preserve snapshot", () => {
  const hydrated = normalizeItineraryItem(JSON.parse(JSON.stringify(stop)));
  assert.equal(hydrated.recommendationReason, recommendation.reason);
  assert.equal(itineraryItemToPlaceHandoff(hydrated).reason, recommendation.reason);
});

test("Chat/Home/Selection recommendation shapes retain supplied reasons", () => {
  for (const source of ["chat", "home", "selection"]) {
    const item = tripPlaceToItineraryItem(normalizeTripPlaceInput({ ...input, recommendationSource: source }), { date: "2026-09-05" });
    assert.equal(item.recommendationReason, recommendation.reason);
    assert.equal(item.recommendationSource, source);
  }
});

test("Explore PlaceResult wrapper reason survives adapter", () => {
  const place = tripPlaceFromPlaceResult({
    id: recommendation.googlePlaceId, name: recommendation.name, address: recommendation.address,
    lat: recommendation.lat, lng: recommendation.lng, rating: 4.5, userRatingCount: 10,
    photoName: null, primaryType: "cafe", businessStatus: "OPERATIONAL", openStatus: "unknown",
    openStatusLabel: "", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "",
    reason: recommendation.reason, reasonSource: "evidence",
  });
  assert.equal(place.recommendationReason, recommendation.reason);
});

test("favorite-only place does not fabricate a recommendation reason", () => {
  const place = tripPlaceFromSavedPlace({ id: "saved-1", name: "收藏地點", category: "景點", notes: "我的私人筆記", createdAt: "2026-09-05" });
  assert.equal(place.recommendationReason, undefined);
});

test("legacy itinerary safely uses factual fallback", () => {
  const legacy = normalizeItineraryItem({ title: "舊地點", placeName: "舊地點", date: "", time: "", description: "", lat: null, lng: null });
  const handoff = itineraryItemToPlaceHandoff(legacy);
  assert.equal(handoff.reason, undefined);
  assert.equal(resolvePlaceDetailReasonWithSource(handoff, handoff.snapshot).source, "place_metadata_fallback");
});

test("legacy generic text is not persisted as authority", () => {
  const generic = normalizeTripPlaceInput({ ...input, recommendationReason: "先依地點資料提供你參考。" });
  assert.equal(generic.recommendationReason, undefined);
});

test("different trips keep independent recommendation context", () => {
  const a = tripPlaceToItineraryItem(normalizeTripPlaceInput({ ...input, recommendationReason: "理由 A" }), { date: "2026-09-05" });
  const b = tripPlaceToItineraryItem(normalizeTripPlaceInput({ ...input, recommendationReason: "理由 B" }), { date: "2026-09-06" });
  assert.equal(a.recommendationReason, "理由 A");
  assert.equal(b.recommendationReason, "理由 B");
});

test("Trip handoff does not regenerate or overwrite reason", () => {
  const source = readFileSync("src/lib/trip/trip-itinerary-place-handoff.ts", "utf8");
  assert.equal(source.includes("buildPlaceRecommendationReason"), false);
});

test("Google detail merge keeps canonical base reason", () => {
  const source = readFileSync("src/lib/place-detail-resolve.ts", "utf8");
  assert.match(source, /reason: preserveRecommendationReason \? base\.reason/);
});

test("global factual cache still strips personalized reason", () => {
  const source = readFileSync("src/lib/explore-map-persistent-cache.ts", "utf8");
  assert.match(source, /reason:\s*_reason/);
});

test("Google Maps CTA icon precedes its label", () => {
  const source = readFileSync("src/components/map/PlaceDetailSheet.tsx", "utf8");
  assert.match(source, /<ExternalLink[^>]+>[\s\S]*?<span>在 Google Maps 查看<\/span>/);
});

console.info(`P22 recommendation reason persistence: ${passed}/14 passed`);
