// Tourist Quality Gate V2 — plan_trip (enrichRoamieResponse → enrichItinerary) end-to-end.
// OFFLINE: globalThis.fetch is trapped and counted (must stay 0); no API key is used.
// Opening hours reach plan_trip in two ways, chosen per stop by what the claim needs:
//  - FAKE Google-shaped Text Search responses (with `id`), pre-registered IN-PROCESS on the
//    existing Places in-flight dedupe (runPlacesApiDeduped, same httpKey postPlaces builds).
//    The production hours runner (lookupPlaceHoursFromRaw) really executes and reads Google's
//    `id` from the injected raw place, so the Place-ID identity contract is exercised. These are
//    NOT provider calls; a console guard fails the run if the real request path is entered.
//  - Name-keyed in-flight hours dedupe (runAiHoursLookupDeduped): hours exist for availability,
//    but by contract they are UNVERIFIED (no Place ID) and never reach the Gate.
// Fixture names are fictional (prefix "Mistcape"); no rule depends on a specific place name.
// Fixture Place IDs use the `ChIJ` prefix + [\w-] chars so they satisfy isHardGooglePlaceId.
//
// Run: npx vite-node scripts/verify-tourist-quality-gate-v2-plan-trip.mjs --config scripts/vite.verify.config.mjs
//
// Claims under test:
//  C4 (R21–R24): a place the user selected (itineraryRequest.selectedPlaces, which the prompt
//      marks as 必須優先納入) must never be removed by the Gate.
//  C5 (R34) / R2b: when the itinerary path already holds opening-hours data for a stop, the Gate
//      must see it (counter-evidence) and reach the same verdict as Chat.
//  C5-reverse: hours whose Google Place ID differs from the stop's googlePlaceId (or carry no id)
//      must NOT be used as counter-evidence → the LOW-shaped stop is still removed.
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("plan_trip verify must not call providers");
};

let realProviderPathEntered = 0;
for (const level of ["log", "info", "warn", "debug", "error"]) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (
      first.includes("[PLACES_PROVIDER_REQUEST]") ||
      first.includes("[Roamie Places] request failed")
    ) {
      realProviderPathEntered++;
    }
    orig(...args);
  };
}

const { enrichRoamieResponse } = await import("../src/lib/enrich-roamie-places.server");
const { runAiHoursLookupDeduped, getAiHoursCacheByPlaceId } =
  await import("../src/lib/recommendation/ai-places-cache");
const { runPlacesApiDeduped, buildPlacesHttpKey, bucketPlacesCoordinate } =
  await import("../src/lib/places-api-guard");
const { DEFAULT_SEARCH_RADIUS_M } = await import("../src/lib/places-search-config");
const { effectiveAppLocale } = await import("../src/lib/i18n/effective-app-locale");
const { localeToGoogleLanguageCode } = await import("../src/lib/i18n/places-language");
const { classifyTouristQuality } = await import("../src/lib/tourist-quality-gate");
const { isRecommendablePlace, placeResultToRecommendableInput } =
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

const CENTER = { lat: 35.2, lng: 135.2 };
const DATE = "2026-11-03";
const PERIODS = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  open: { day, hour: 8, minute: 0 },
  close: { day, hour: 20, minute: 0 },
}));
const HOURS_DATA = {
  businessStatus: "OPERATIONAL",
  regularOpeningHours: {
    openNow: true,
    periods: PERIODS,
    weekdayDescriptions: ["Monday: 8:00 AM – 8:00 PM"],
  },
  currentOpeningHours: { openNow: true, periods: PERIODS },
  utcOffsetMinutes: 540,
};

const stop = (key, placeName, i) => ({
  date: DATE,
  time: "10:00",
  title: "historical_landmark",
  description: "",
  placeName,
  lat: CENTER.lat + i * 0.001,
  lng: CENTER.lng + i * 0.001,
  googlePlaceId: `ChIJ_TQG_PLANTRIP_${key}`,
  placeType: "historical_landmark",
  rating: 4.6,
  userRatingCount: 500,
});

// "park" in the name satisfies the pre-existing travel-friendly name rule, so the control
// proves every pre-Gate rule admits this shape of stop.
const CONTROL = stop("CONTROL", "Mistcape Parkside Mill", 1);
// D1 (historical_landmark) + D2 (Site of former …) — selected by the user.
const SELECTED = stop("SELECTED", "Site of former Mistcape Parkside Mill", 2);
// Same D1 + D2 shape, not selected, but opening hours exist for it.
const WITH_HOURS = stop("HOURS", "Site of former Mistcape Parkside Kiln", 3);
const STOPS = [CONTROL, SELECTED, WITH_HOURS];

const hoursKey = (s) =>
  `name:${s.placeName.trim().toLowerCase()}:${s.lat.toFixed(3)}:${s.lng.toFixed(3)}`;

// ---------- fake Google-shaped Text Search injection (in-process, not a provider call) ----------
const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const languageCode = localeToGoogleLanguageCode(effectiveAppLocale());
const textSearchHttpKey = (query, lat, lng) =>
  buildPlacesHttpKey("text", {
    lat: bucketPlacesCoordinate(lat),
    lng: bucketPlacesCoordinate(lng),
    query: query.trim().replace(/\s+/g, " ").toLowerCase(),
    types: "",
    radius: Math.min(Math.max(DEFAULT_SEARCH_RADIUS_M, 1), 50_000),
    language: languageCode,
  });
/** Raw Google Places (New) place carrying HOURS_DATA; `id` omitted when null. */
const fakeRawPlace = (id, name) => ({
  ...(id ? { id } : {}),
  displayName: { text: name, languageCode: "en" },
  types: ["historical_landmark"],
  primaryType: "historical_landmark",
  businessStatus: HOURS_DATA.businessStatus,
  regularOpeningHours: HOURS_DATA.regularOpeningHours,
  currentOpeningHours: HOURS_DATA.currentOpeningHours,
  utcOffsetMinutes: HOURS_DATA.utcOffsetMinutes,
});
/** Pre-register an in-flight Text Search for stop `s` whose (fake) Google response has `id`. */
const injectFakeGoogleHours = (s, id) => {
  void runPlacesApiDeduped(textSearchHttpKey(s.placeName, s.lat, s.lng), "text", () =>
    later(1500, { places: [fakeRawPlace(id, s.placeName)], error: null }),
  );
};

const planCtx = (selected) => ({
  mode: "itinerary",
  locale: "zh-TW",
  location: { lat: CENTER.lat, lng: CENTER.lng, city: "Mistcape" },
  time: `${DATE}T10:00:00+09:00`,
  itineraryRequest: {
    destination: "Mistcape",
    days: 1,
    startDate: DATE,
    selectedPlaces: selected.map((s) => ({
      name: s.placeName,
      placeName: s.placeName,
      googlePlaceId: s.googlePlaceId,
      lat: s.lat,
      lng: s.lng,
    })),
  },
  selectedPlaces: selected.map((s) => ({
    name: s.placeName,
    placeName: s.placeName,
    googlePlaceId: s.googlePlaceId,
    lat: s.lat,
    lng: s.lng,
  })),
});

const runPlanTrip = async () => {
  // CONTROL and WITH_HOURS: the production hours runner executes on a fake Google response
  // whose `id` equals the stop's googlePlaceId (Place-ID-verified hours).
  injectFakeGoogleHours(CONTROL, CONTROL.googlePlaceId);
  injectFakeGoogleHours(WITH_HOURS, WITH_HOURS.googlePlaceId);
  // SELECTED: hours only via the name-keyed in-flight dedupe (unverified, no Place ID). Hours
  // exist so the non-Gate availability rule passes, but the Gate sees none → the stop is LOW and
  // only selected-place protection can keep it (keeps C4 non-trivial).
  void runAiHoursLookupDeduped(hoursKey(SELECTED), () => later(1500, HOURS_DATA));
  const ctx = {
    mode: "itinerary",
    locale: "zh-TW",
    location: { lat: CENTER.lat, lng: CENTER.lng, city: "Mistcape" },
    time: `${DATE}T10:00:00+09:00`,
    itineraryRequest: {
      destination: "Mistcape",
      days: 1,
      startDate: DATE,
      selectedPlaces: [
        {
          name: SELECTED.placeName,
          placeName: SELECTED.placeName,
          googlePlaceId: SELECTED.googlePlaceId,
          lat: SELECTED.lat,
          lng: SELECTED.lng,
        },
      ],
    },
    selectedPlaces: [
      {
        name: SELECTED.placeName,
        placeName: SELECTED.placeName,
        googlePlaceId: SELECTED.googlePlaceId,
        lat: SELECTED.lat,
        lng: SELECTED.lng,
      },
    ],
  };
  const response = {
    summary: "",
    recommendations: [],
    itinerary: STOPS.map((s) => ({ ...s })),
  };
  const out = await enrichRoamieResponse(response, ctx);
  return (out.itinerary ?? []).map((i) => i.placeName);
};

const kept = await runPlanTrip();
console.log("INFO plan_trip kept:", JSON.stringify(kept));

await test("precondition: hours injection works and pre-Gate rules admit the control stop", () => {
  assert.ok(kept.includes(CONTROL.placeName), `control dropped; kept=${JSON.stringify(kept)}`);
});

await test("precondition: with the same hours, the Gate classifies the 跡-type stop as not LOW (Chat admits)", () => {
  const input = {
    name: WITH_HOURS.placeName,
    primaryType: "historical_landmark",
    types: ["historical_landmark"],
    regularOpeningHours: HOURS_DATA.regularOpeningHours,
    currentOpeningHours: HOURS_DATA.currentOpeningHours,
  };
  assert.notEqual(classifyTouristQuality(input).tier, "LOW_EXPERIENCE_VALUE");
  const chat = isRecommendablePlace(
    placeResultToRecommendableInput({
      id: WITH_HOURS.googlePlaceId,
      name: WITH_HOURS.placeName,
      businessStatus: "OPERATIONAL",
      openStatus: "open",
      rating: 4.6,
      userRatingCount: 500,
      primaryType: "historical_landmark",
      types: ["historical_landmark"],
      regularOpeningHours: HOURS_DATA.regularOpeningHours,
      currentOpeningHours: HOURS_DATA.currentOpeningHours,
    }),
    "chat_destination_recommend",
    { logDrop: false },
  );
  assert.doesNotMatch(chat.reason ?? "", /tourist_quality|low_experience/i, `chat=${chat.reason}`);
});

await test("precondition: the Gate is the only rule that removes these stops at plan_trip", async () => {
  const { itineraryToRecommendableInput } = await import("../src/lib/is-recommendable-place");
  for (const s of [SELECTED, WITH_HOURS]) {
    const r = isRecommendablePlace(
      itineraryToRecommendableInput(s, { businessStatus: "OPERATIONAL", openStatus: "open" }),
      "plan_trip",
      { logDrop: false, touristQualityProtection: "selected_only" },
    );
    assert.equal(r.ok, true, `${s.placeName} rejected by a non-Gate rule: ${r.reason}`);
  }
});

await test("C4: user-selected stop is never removed by the Gate at plan_trip", () => {
  assert.ok(
    kept.includes(SELECTED.placeName),
    `selected place dropped by enrichItinerary; kept=${JSON.stringify(kept)}`,
  );
});

await test("C5/R2b: plan_trip passes the opening hours it already looked up to the Gate", () => {
  assert.ok(
    kept.includes(WITH_HOURS.placeName),
    `stop with opening hours dropped (Chat admits it); kept=${JSON.stringify(kept)}`,
  );
});

// ------------------------- added: injection evidence for C4 / C5 -------------------------
await test("precondition: fake Google responses consumed by the real hours runner (no real provider path)", () => {
  assert.equal(realProviderPathEntered, 0, "real provider request path was entered");
  // Side effect proving lookupPlaceHoursFromRaw ran on the fake response and read Google's id.
  assert.ok(getAiHoursCacheByPlaceId(WITH_HOURS.googlePlaceId), "runner did not consume WITH_HOURS response");
  assert.ok(getAiHoursCacheByPlaceId(CONTROL.googlePlaceId), "runner did not consume CONTROL response");
  // SELECTED hours came only from the name-keyed dedupe → never cached under its Place ID.
  assert.equal(getAiHoursCacheByPlaceId(SELECTED.googlePlaceId) ?? null, null);
});

await test("precondition: C4 is non-trivial — without protection the selected stop is removed by the Gate", async () => {
  const { itineraryToRecommendableInput } = await import("../src/lib/is-recommendable-place");
  const r = isRecommendablePlace(
    itineraryToRecommendableInput(SELECTED, { businessStatus: "OPERATIONAL", openStatus: "open" }),
    "plan_trip",
    { logDrop: false },
  );
  assert.equal(r.reason, "tourist_quality_low_experience", `selected: ${r.reason}`);
});

// ------------------------- added: C5 reverse (identity mismatch / missing) -------------------------
const REV_CONTROL = stop("REVCONTROL", "Mistcape Parkside Weir", 11); // no D2 → never LOW
const REV_OTHER_ID = stop("REVOTHER", "Site of former Mistcape Parkside Forge", 12);
const REV_NO_ID = stop("REVNOID", "Site of former Mistcape Parkside Wharf", 13);
const SOME_OTHER_GOOGLE_ID = "ChIJ_TQG_PLANTRIP_SOME_OTHER_PLACE";
injectFakeGoogleHours(REV_CONTROL, REV_CONTROL.googlePlaceId);
injectFakeGoogleHours(REV_OTHER_ID, SOME_OTHER_GOOGLE_ID);
injectFakeGoogleHours(REV_NO_ID, null);
const revOut = await enrichRoamieResponse(
  {
    summary: "",
    recommendations: [],
    itinerary: [REV_CONTROL, REV_OTHER_ID, REV_NO_ID].map((s) => ({ ...s })),
  },
  planCtx([]),
);
const revKept = (revOut.itinerary ?? []).map((i) => i.placeName);
console.log("INFO plan_trip reverse kept:", JSON.stringify(revKept));

await test("precondition (reverse): control admitted; runner consumed the mismatched-id response", () => {
  assert.equal(realProviderPathEntered, 0, "real provider request path was entered");
  assert.ok(revKept.includes(REV_CONTROL.placeName), `control dropped; kept=${JSON.stringify(revKept)}`);
  assert.ok(getAiHoursCacheByPlaceId(SOME_OTHER_GOOGLE_ID), "runner did not consume OTHER id response");
  assert.equal(getAiHoursCacheByPlaceId(REV_OTHER_ID.googlePlaceId) ?? null, null);
});

await test("precondition (reverse): these stops are LOW without hours, not LOW with them, and only the Gate rejects", async () => {
  const { itineraryToRecommendableInput } = await import("../src/lib/is-recommendable-place");
  for (const s of [REV_OTHER_ID, REV_NO_ID]) {
    const base = { name: s.placeName, primaryType: "historical_landmark", types: ["historical_landmark"] };
    assert.equal(classifyTouristQuality(base).tier, "LOW_EXPERIENCE_VALUE");
    assert.notEqual(
      classifyTouristQuality({ ...base, ...HOURS_DATA }).tier,
      "LOW_EXPERIENCE_VALUE",
      `${s.placeName}: hours would admit it, so removal below proves hours were withheld`,
    );
    const r = isRecommendablePlace(
      itineraryToRecommendableInput(s, { businessStatus: "OPERATIONAL", openStatus: "open" }),
      "plan_trip",
      { logDrop: false },
    );
    assert.equal(r.reason, "tourist_quality_low_experience", `${s.placeName}: ${r.reason}`);
  }
});

await test("C5-reverse: hours whose Google Place ID differs from googlePlaceId → LOW stop still removed", () => {
  assert.ok(!revKept.includes(REV_OTHER_ID.placeName), `kept=${JSON.stringify(revKept)}`);
});

await test("C5-reverse: hours from a Google response without id → LOW stop still removed", () => {
  assert.ok(!revKept.includes(REV_NO_ID.placeName), `kept=${JSON.stringify(revKept)}`);
});

await test("zero provider calls", () => {
  assert.equal(fetchCalls, 0);
  assert.equal(realProviderPathEntered, 0);
});

if (failures.length) {
  console.log(
    `FAIL tqg v2 plan_trip: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`,
  );
  process.exitCode = 1;
} else {
  console.log(`PASS tqg v2 plan_trip: ${cases} scenarios, provider calls ${fetchCalls}`);
}
