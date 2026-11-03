// Tester probe (read-only audit of R20 in verify-recommendation-reason-v2.mjs).
// Checks that the HEAD R20 protection "the Trip normalizer's own reason round-trips unchanged under
// the same locale" can be asserted locale-independently, plus the canonical-text checks proposed to
// restore it. Offline: synthetic fixtures only; fetch trapped (must stay 0).
//
// Run: npx vite-node scripts/verify-recommendation-reason-r20-contract-probe.mjs --config scripts/vite.verify.config.mjs
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("R20 probe must not call providers");
};

const { buildPlaceRecommendationReason, resolveRecommendationReasonPlace } =
  await import("../src/lib/build-place-recommendation-reason");
const { extractPlaceReviewEvidence } = await import("../src/lib/place-review-evidence");
const { normalizeItineraryItem } = await import("../src/lib/ai/types");
const { tripPlaceFromPlaceResult, tripPlaceToItineraryItem } = await import("../src/lib/trip/trip-place-input");
const { effectiveAppLocale } = await import("../src/lib/i18n/effective-app-locale");

let cases = 0;
const failures = [];
const test = (name, fn) => {
  try {
    fn();
    cases++;
    console.log("PASS", name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL", name, "--", (e?.message ?? String(e)).split("\n").slice(0, 4).join(" | "));
  }
};

// Same fixture as R20 (synthetic cafe with socket reviews).
const p = resolveRecommendationReasonPlace({
  id: "ChIJ_V2_Evidence",
  name: "Synthetic ChIJ_V2_Evidence",
  primaryType: "cafe",
  types: ["cafe"],
  lat: 25,
  lng: 121,
  address: "Synthetic Rd",
});
const evidenced = {
  ...p,
  reviewEvidence: extractPlaceReviewEvidence(
    p.id,
    ["有插座", "插座很多"].map((text, i) => ({ name: `r/x/${i}`, text: { text } })),
  ),
};
const text = (locale) =>
  buildPlaceRecommendationReason(evidenced, null, null, "2026-10-14T10:00:00", undefined, locale);
const clone = (item) => JSON.parse(JSON.stringify(item));

const ambient = effectiveAppLocale();
const trip = tripPlaceToItineraryItem(tripPlaceFromPlaceResult(evidenced), { date: "2026-10-14" });
console.log("INFO ambient locale:", ambient, "trip reason:", JSON.stringify(trip.recommendationReason));

test("HEAD R20 protection, locale-pinned: Trip normalizer reason round-trips unchanged in its own locale", () => {
  assert.ok(trip.recommendationReason?.trim(), "trip has no reason");
  assert.equal(normalizeItineraryItem(clone(trip), ambient).recommendationReason, trip.recommendationReason);
});

test("Trip normalizer reason is the canonical evidence text for its locale", () => {
  assert.equal(trip.recommendationReason, text(ambient));
});

test("stored en reason is the canonical en evidence text (not just non-empty)", () => {
  assert.equal(normalizeItineraryItem(clone(trip), "en").recommendationReason, text("en"));
});

test("zero provider calls", () => assert.equal(fetchCalls, 0));

if (failures.length) {
  console.log(`FAIL r20 contract probe: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`);
  process.exitCode = 1;
} else {
  console.log(`PASS r20 contract probe: ${cases} scenarios, provider calls ${fetchCalls}`);
}
process.exit(process.exitCode ?? 0);
