// Tourist Quality Gate V2 — Place ID format compatibility (independent tester check).
//
// OFFLINE. globalThis.fetch is trapped and counted (must stay 0). No API key is used.
// Opening hours are shared only through the name-keyed in-flight hours dedupe, so they are
// UNVERIFIED for the Gate (no Place ID) but satisfy the non-Gate availability rule; the stops are
// therefore LOW for the Gate and can only survive via selected-place protection.
//
// Google documents that Place IDs are opaque and are not guaranteed to start with "ChIJ"
// (e.g. "GhIJ…", "EiQ…"/"Ei…" for some address/route results). The project-wide validator
// isHardGooglePlaceId (and isMappableGooglePlaceId, which wraps it) accepts only /^ChIJ[\w-]+$/.
// This script checks whether that ChIJ-only filter, newly used for Tourist Quality Gate
// selected-place protection at plan_trip, removes a user-selected place whose Place ID has a
// different (documented) prefix. The ID strings below are format samples only.
//
// Fixture names are fictional (prefix "Quillbrook"); no rule depends on a specific place name.
//
// Run: npx vite-node scripts/verify-tourist-quality-gate-v2-placeid-compat.mjs --config scripts/vite.verify.config.mjs
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("placeid compat verify must not call providers");
};

const { enrichRoamieResponse } = await import("../src/lib/enrich-roamie-places.server");
const { runAiHoursLookupDeduped } = await import("../src/lib/recommendation/ai-places-cache");
const { isHardGooglePlaceId } = await import("../src/lib/ai/planning-place-id");
const { isMappableGooglePlaceId } = await import("../src/lib/ai/map-named-places-to-google");
const { isRecommendablePlace, itineraryToRecommendableInput } =
  await import("../src/lib/is-recommendable-place");

let cases = 0;
const failures = [];
const test = async (name, fn) => {
  try {
    await fn();
    cases++;
    console.log("PASS", name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL", name, "--", (e?.message ?? String(e)).split("\n").slice(0, 4).join(" | "));
  }
};

const CENTER = { lat: 35.6, lng: 135.6 };
const DATE = "2026-11-03";
const PERIODS = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  open: { day, hour: 8, minute: 0 },
  close: { day, hour: 20, minute: 0 },
}));
const HOURS_DATA = {
  businessStatus: "OPERATIONAL",
  regularOpeningHours: { openNow: true, periods: PERIODS, weekdayDescriptions: ["Monday: 8:00 AM – 8:00 PM"] },
  currentOpeningHours: { openNow: true, periods: PERIODS },
  utcOffsetMinutes: 540,
};
const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

// Format samples (Google-documented prefixes); not real places.
const ID_CHIJ = "ChIJgUbEo8cfqokR5lP9_Wh_DaM";
const ID_GHIJ = "GhIJQWDl0CIeQUARxks3icF8U8A";
const ID_EIQ = "EiQxMjMgTWFpbiBTdCwgUXVpbGxicm9vaywgWFggMTIzNDUiMBIu";

const stop = (placeName, i, googlePlaceId) => ({
  date: DATE,
  time: "10:00",
  title: "historical_landmark",
  description: "",
  placeName,
  lat: CENTER.lat + i * 0.001,
  lng: CENTER.lng + i * 0.001,
  googlePlaceId,
  placeType: "historical_landmark",
  rating: 4.6,
  userRatingCount: 500,
});
// All D1 (historical_landmark) + D2 ("Site of former …") → LOW without verified hours.
const SEL_CHIJ = stop("Site of former Quillbrook Parkside Mill", 1, ID_CHIJ);
const SEL_GHIJ = stop("Site of former Quillbrook Parkside Kiln", 2, ID_GHIJ);
const SEL_EIQ = stop("Site of former Quillbrook Parkside Forge", 3, ID_EIQ);
const STOPS = [SEL_CHIJ, SEL_GHIJ, SEL_EIQ];

const nameHoursKey = (s) =>
  `name:${s.placeName.trim().toLowerCase()}:${s.lat.toFixed(3)}:${s.lng.toFixed(3)}`;
for (const s of STOPS) void runAiHoursLookupDeduped(nameHoursKey(s), () => later(1500, HOURS_DATA));

const selected = STOPS.map((s) => ({
  name: s.placeName,
  placeName: s.placeName,
  googlePlaceId: s.googlePlaceId,
  lat: s.lat,
  lng: s.lng,
}));
const out = await enrichRoamieResponse(
  { summary: "", recommendations: [], itinerary: STOPS.map((s) => ({ ...s })) },
  {
    mode: "itinerary",
    locale: "zh-TW",
    location: { lat: CENTER.lat, lng: CENTER.lng, city: "Quillbrook" },
    time: `${DATE}T10:00:00+09:00`,
    itineraryRequest: { destination: "Quillbrook", days: 1, startDate: DATE, selectedPlaces: selected },
    selectedPlaces: selected,
  },
);
const kept = (out.itinerary ?? []).map((i) => i.placeName);
console.log("INFO plan_trip kept:", JSON.stringify(kept));

await test("contract: isHardGooglePlaceId / isMappableGooglePlaceId accept only ChIJ (documents current behaviour)", () => {
  assert.equal(isHardGooglePlaceId(ID_CHIJ), true);
  assert.equal(isMappableGooglePlaceId(ID_CHIJ), true);
  assert.equal(isHardGooglePlaceId(`places/${ID_CHIJ}`), true);
  for (const id of [ID_GHIJ, ID_EIQ]) {
    assert.equal(isHardGooglePlaceId(id), false, id);
    assert.equal(isMappableGooglePlaceId(id), false, id);
  }
});

await test("precondition: every selected stop is LOW for the Gate and rejected only by the Gate", () => {
  for (const s of STOPS) {
    const r = isRecommendablePlace(
      itineraryToRecommendableInput(s, { businessStatus: "OPERATIONAL", openStatus: "open" }),
      "plan_trip",
      { logDrop: false },
    );
    assert.equal(r.reason, "tourist_quality_low_experience", `${s.placeName}: ${r.reason}`);
    const protectedR = isRecommendablePlace(
      itineraryToRecommendableInput(s, { businessStatus: "OPERATIONAL", openStatus: "open" }),
      "plan_trip",
      { logDrop: false, touristQualityProtection: "explicit" },
    );
    assert.equal(protectedR.ok, true, `${s.placeName} rejected by a non-Gate rule: ${protectedR.reason}`);
  }
});

await test("control: user-selected LOW stop with a ChIJ Place ID is protected at plan_trip", () => {
  assert.ok(kept.includes(SEL_CHIJ.placeName), `kept=${JSON.stringify(kept)}`);
});

await test("DEFECT probe: user-selected LOW stop with a GhIJ Place ID is protected at plan_trip", () => {
  assert.ok(kept.includes(SEL_GHIJ.placeName), `selected GhIJ stop removed by Gate; kept=${JSON.stringify(kept)}`);
});

await test("DEFECT probe: user-selected LOW stop with an EiQ Place ID is protected at plan_trip", () => {
  assert.ok(kept.includes(SEL_EIQ.placeName), `selected EiQ stop removed by Gate; kept=${JSON.stringify(kept)}`);
});

await test("zero provider calls", () => {
  assert.equal(fetchCalls, 0);
});

if (failures.length) {
  console.log(
    `FAIL tqg v2 placeid compat: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`,
  );
  process.exitCode = 1;
} else {
  console.log(`PASS tqg v2 placeid compat: ${cases} scenarios, provider calls ${fetchCalls}`);
}
