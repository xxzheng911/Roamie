import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeTripPlaceInput,
  tripPlaceFromPlaceResult,
  tripPlaceFromRecommendation,
  tripPlaceFromSavedPlace,
  tripPlaceToItineraryItem,
} from "../src/lib/trip/trip-place-input";
import { normalizeItineraryItem } from "../src/lib/ai/types";
import { itineraryItemToPlaceHandoff } from "../src/lib/trip/trip-itinerary-place-handoff";
import { resolvePlaceDetailReasonWithSource } from "../src/lib/place-detail-resolve";
import {
  buildPlaceRecommendationReason,
  resolveRecommendationReasonPlace,
} from "../src/lib/build-place-recommendation-reason";
import { extractPlaceReviewEvidence } from "../src/lib/place-review-evidence";
import { effectiveAppLocale } from "../src/lib/i18n/effective-app-locale";
let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log("PASS", name);
};
const locale = effectiveAppLocale();
const recommendation = {
  name: "測試咖啡店",
  placeName: "測試咖啡店",
  type: "cafe",
  primaryType: "cafe",
  description: "",
  reason: "unsupported original prose",
  estimatedTime: "1 hour",
  address: "Taipei",
  lat: 25.03,
  lng: 121.56,
  googleMapsUrl: "",
  reasonSource: "evidence",
  googlePlaceId: "ChIJReasonSnapshot123",
};
recommendation.reviewEvidence = extractPlaceReviewEvidence(recommendation.googlePlaceId, [
  { text: { text: "有插座" } },
  { text: { text: "插座很多" } },
]);
const expected = buildPlaceRecommendationReason(
  resolveRecommendationReasonPlace(recommendation),
  null,
  null,
  undefined,
  undefined,
  locale,
);
const input = normalizeTripPlaceInput({
  ...tripPlaceFromRecommendation(recommendation),
  recommendationSource: "explore",
});
const stop = tripPlaceToItineraryItem(input, { date: "2026-09-05" });
test("adapter preserves structured evidence", () =>
  assert.deepEqual(input.reviewEvidence, recommendation.reviewEvidence));
test("Add-to-Trip stores canonical prose and provenance", () => {
  assert.equal(stop.recommendationReason, expected);
  assert.equal(stop.recommendationSource, "explore");
});
test("Trip to Detail uses same evidence", () =>
  assert.equal(itineraryItemToPlaceHandoff(stop, locale).reason, expected));
test("JSON hydration preserves evidence", () =>
  assert.deepEqual(
    normalizeItineraryItem(JSON.parse(JSON.stringify(stop)), locale).reviewEvidence,
    recommendation.reviewEvidence,
  ));
test("all add surfaces share same core", () => {
  for (const source of ["chat", "home", "selection"])
    assert.equal(
      tripPlaceToItineraryItem({ ...input, recommendationSource: source }, { date: "2026-09-05" })
        .recommendationReason,
      expected,
    );
});
test("Explore adapter preserves evidence", () =>
  assert.deepEqual(
    tripPlaceFromPlaceResult(resolveRecommendationReasonPlace(recommendation)).reviewEvidence,
    recommendation.reviewEvidence,
  ));
test("private favorite notes do not become evidence", () =>
  assert.equal(
    tripPlaceFromSavedPlace({
      id: "saved-1",
      name: "收藏地點",
      category: "景點",
      notes: "有插座",
      createdAt: "2026-09-05",
    }).reviewEvidence,
    undefined,
  ));
test("legacy fallback is factual identity", () => {
  const legacy = normalizeItineraryItem(
    { title: "舊地點", placeName: "舊地點", lat: null, lng: null },
    locale,
  );
  assert.doesNotMatch(legacy.recommendationReason, /outlets|插座|popular|熱門/);
});
test("generic prose is not authority", () =>
  assert.equal(
    normalizeTripPlaceInput({ ...input, recommendationReason: "先依地點資料提供你參考。" })
      .recommendationReason,
    undefined,
  ));
test("different trips retain same evidence with independent notes", () => {
  const a = tripPlaceToItineraryItem(input, { date: "2026-09-05", notes: "A" }),
    b = tripPlaceToItineraryItem(input, { date: "2026-09-06", notes: "B" });
  assert.equal(a.recommendationReason, b.recommendationReason);
  assert.equal(a.notes, "A");
  assert.equal(b.notes, "B");
});
test("detail reads structured evidence", () => {
  const h = itineraryItemToPlaceHandoff(stop, locale);
  assert.deepEqual(resolvePlaceDetailReasonWithSource(h, h.snapshot, locale), {
    reason: expected,
    source: "review_evidence",
  });
});
test("handoff delegates to authority", () =>
  assert.match(
    readFileSync("src/lib/trip/trip-itinerary-place-handoff.ts", "utf8"),
    /buildPlaceRecommendationReason/,
  ));
test("global cache does not store personalized prose", () =>
  assert.match(
    readFileSync("src/lib/explore-map-persistent-cache.ts", "utf8"),
    /reason:\s*_reason/,
  ));
test("Google Maps CTA remains present", () =>
  assert.match(
    readFileSync("src/components/map/PlaceDetailSheet.tsx", "utf8"),
    /openExternal\(googleMapsExternalUrl\)[\s\S]*?t\("uiCoverage.maps"\)/,
  ));
console.log(`PASS P22 structured reason persistence: ${passed}/14`);
