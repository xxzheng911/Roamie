// Tourist Quality Gate V2 — round 3 independent check: opening-hours Place Identity at
// plan_trip (enrichItinerary) and Ranking (enrichRecommendations).
//
// OFFLINE. globalThis.fetch is trapped and counted (must stay 0). No API key is used.
// "Google-shaped" responses below are FAKE responses injected IN-PROCESS through the existing
// Places in-flight dedupe (runPlacesApiDeduped, same httpKey postPlaces builds). They are NOT
// real provider calls: the production hours runner (lookupPlaceHoursFromRaw) really executes and
// reads `id` from the injected raw place exactly as it would from a Google response.
// A console guard additionally fails the run if the real provider request path is ever entered
// ([PLACES_PROVIDER_REQUEST] is logged only right before googleRestFetch).
//
// Fixture names are fictional (prefix "Velmora"); no rule depends on a specific place name.
//
// Run: npx vite-node scripts/verify-tourist-quality-gate-v2-round3-identity.mjs --config scripts/vite.verify.config.mjs
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("round3 identity verify must not call providers");
};

let realProviderPathEntered = 0;
for (const level of ["log", "info", "warn", "debug", "error"]) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (first.includes("[PLACES_PROVIDER_REQUEST]") || first.includes("[Roamie Places] request failed")) {
      realProviderPathEntered++;
    }
    orig(...args);
  };
}

const { enrichRoamieResponse } = await import("../src/lib/enrich-roamie-places.server");
const { runAiHoursLookupDeduped, setAiHoursCacheByPlaceId, getAiHoursCacheByPlaceId } =
  await import("../src/lib/recommendation/ai-places-cache");
const { runPlacesApiDeduped, buildPlacesHttpKey, bucketPlacesCoordinate } =
  await import("../src/lib/places-api-guard");
const { DEFAULT_SEARCH_RADIUS_M } = await import("../src/lib/places-search-config");
const { effectiveAppLocale } = await import("../src/lib/i18n/effective-app-locale");
const { localeToGoogleLanguageCode } = await import("../src/lib/i18n/places-language");
const { classifyTouristQuality } = await import("../src/lib/tourist-quality-gate");
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

const CENTER = { lat: 35.4, lng: 135.4 };
const DATE = "2026-11-03";
const PERIODS = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  open: { day, hour: 8, minute: 0 },
  close: { day, hour: 20, minute: 0 },
}));
const REGULAR = {
  openNow: true,
  periods: PERIODS,
  weekdayDescriptions: ["Monday: 8:00 AM – 8:00 PM"],
};
const CURRENT = { openNow: true, periods: PERIODS };
const HOURS_DATA = {
  businessStatus: "OPERATIONAL",
  regularOpeningHours: REGULAR,
  currentOpeningHours: CURRENT,
  utcOffsetMinutes: 540,
};
const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

// ---------- fake Google-shaped Text Search injection (in-process, not a provider call) ----------
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
/** Pre-register an in-flight Text Search whose (fake) raw result is `rawPlace`. */
const injectFakeGoogleTextSearch = (query, lat, lng, rawPlace) => {
  void runPlacesApiDeduped(textSearchHttpKey(query, lat, lng), "text", () =>
    later(1500, { places: [rawPlace], error: null }),
  );
};
const fakeRawPlace = (id, name) => ({
  ...(id ? { id } : {}),
  displayName: { text: name, languageCode: "en" },
  types: ["historical_landmark"],
  primaryType: "historical_landmark",
  businessStatus: "OPERATIONAL",
  regularOpeningHours: REGULAR,
  currentOpeningHours: CURRENT,
  utcOffsetMinutes: 540,
});
const nameHoursKey = (s) =>
  `name:${s.placeName.trim().toLowerCase()}:${s.lat.toFixed(3)}:${s.lng.toFixed(3)}`;

// ---------------------------------------- plan_trip ----------------------------------------
const stop = (key, placeName, i) => ({
  date: DATE,
  time: "10:00",
  title: "historical_landmark",
  description: "",
  placeName,
  lat: CENTER.lat + i * 0.001,
  lng: CENTER.lng + i * 0.001,
  googlePlaceId: `ChIJ_R3_PLAN_${key}`,
  placeType: "historical_landmark",
  rating: 4.6,
  userRatingCount: 500,
});

// Every non-control stop is D1 (historical_landmark only) + D2 ("Site of former …") → LOW
// without counter-evidence.
const P_CONTROL = stop("CONTROL", "Velmora Parkside Mill", 1); // no D2 → never LOW
const P_SAME_ID = stop("SAMEID", "Site of former Velmora Parkside Kiln", 2);
const P_OTHER_ID = stop("OTHERID", "Site of former Velmora Parkside Forge", 3);
const P_NO_ID = stop("NOID", "Site of former Velmora Parkside Weir", 4);
const P_DEDUPED = stop("DEDUPED", "Site of former Velmora Parkside Wharf", 5);
const P_SELECTED = stop("SELECTED", "Site of former Velmora Parkside Gate", 6);
const OTHER_GOOGLE_ID = "ChIJ_R3_SOME_OTHER_PLACE";

const planCtx = (selected = []) => ({
  mode: "itinerary",
  locale: "zh-TW",
  location: { lat: CENTER.lat, lng: CENTER.lng, city: "Velmora" },
  time: `${DATE}T10:00:00+09:00`,
  itineraryRequest: {
    destination: "Velmora",
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
});
const runPlan = async (stops, selected) => {
  const out = await enrichRoamieResponse(
    { summary: "", recommendations: [], itinerary: stops.map((s) => ({ ...s })) },
    planCtx(selected),
  );
  return out.itinerary ?? [];
};

// Batch 1 (one concurrency chunk of 4): the hours runner really executes for each stop.
injectFakeGoogleTextSearch(P_CONTROL.placeName, P_CONTROL.lat, P_CONTROL.lng,
  fakeRawPlace(P_CONTROL.googlePlaceId, P_CONTROL.placeName));
injectFakeGoogleTextSearch(P_SAME_ID.placeName, P_SAME_ID.lat, P_SAME_ID.lng,
  fakeRawPlace(P_SAME_ID.googlePlaceId, P_SAME_ID.placeName));
injectFakeGoogleTextSearch(P_OTHER_ID.placeName, P_OTHER_ID.lat, P_OTHER_ID.lng,
  fakeRawPlace(OTHER_GOOGLE_ID, P_OTHER_ID.placeName));
injectFakeGoogleTextSearch(P_NO_ID.placeName, P_NO_ID.lat, P_NO_ID.lng,
  fakeRawPlace(null, P_NO_ID.placeName));
const plan1 = await runPlan([P_CONTROL, P_SAME_ID, P_OTHER_ID, P_NO_ID], []);
const plan1Kept = plan1.map((i) => i.placeName);
console.log("INFO plan_trip batch1 kept:", JSON.stringify(plan1Kept));

// Batch 2: hours shared via the name-keyed hours dedupe (runner never executes) + a selected
// LOW stop with no hours at all.
void runAiHoursLookupDeduped(nameHoursKey(P_DEDUPED), () => later(1500, HOURS_DATA));
// Selected stop: hours also only via dedupe (unverified → the Gate sees no hours, so it is LOW);
// hours exist so the pre-existing non-Gate open_unknown rule does not decide the outcome.
void runAiHoursLookupDeduped(nameHoursKey(P_SELECTED), () => later(1500, HOURS_DATA));
const plan2 = await runPlan([P_DEDUPED, P_SELECTED], [P_SELECTED]);
const plan2Kept = plan2.map((i) => i.placeName);
console.log("INFO plan_trip batch2 kept:", JSON.stringify(plan2Kept));

await test("precondition: fake Google responses consumed by the real runner, real provider path never entered", () => {
  assert.equal(realProviderPathEntered, 0, "real provider request path was entered");
  assert.ok(plan1Kept.includes(P_CONTROL.placeName), `control dropped; kept=${plan1Kept}`);
  // Side effect proving the runner executed on the OTHER_ID response: Google's id was cached.
  assert.ok(getAiHoursCacheByPlaceId(OTHER_GOOGLE_ID), "runner did not consume OTHER_ID response");
  assert.ok(getAiHoursCacheByPlaceId(P_SAME_ID.googlePlaceId), "runner did not consume SAME_ID response");
});

await test("precondition: these stops without hours are LOW and rejected only by the Gate", () => {
  for (const s of [P_SAME_ID, P_OTHER_ID, P_NO_ID, P_DEDUPED, P_SELECTED]) {
    assert.equal(
      classifyTouristQuality({ name: s.placeName, primaryType: "historical_landmark",
        types: ["historical_landmark"] }).tier,
      "LOW_EXPERIENCE_VALUE",
    );
    const r = isRecommendablePlace(
      itineraryToRecommendableInput(s, { businessStatus: "OPERATIONAL", openStatus: "open" }),
      "plan_trip",
      { logDrop: false },
    );
    assert.equal(r.reason, "tourist_quality_low_experience", `${s.placeName}: ${r.reason}`);
  }
});

await test("plan_trip (production runner): Google id EQUALS googlePlaceId → hours reach Gate, stop kept", () => {
  assert.ok(plan1Kept.includes(P_SAME_ID.placeName), `kept=${JSON.stringify(plan1Kept)}`);
});

await test("plan_trip: Google id DIFFERS from googlePlaceId → hours ignored, LOW removed", () => {
  assert.ok(!plan1Kept.includes(P_OTHER_ID.placeName), `kept=${JSON.stringify(plan1Kept)}`);
});

await test("plan_trip: Google response without id → hours unverified, LOW removed", () => {
  assert.ok(!plan1Kept.includes(P_NO_ID.placeName), `kept=${JSON.stringify(plan1Kept)}`);
});

await test("plan_trip: hours shared via name-keyed dedupe (runner not executed) → LOW removed", () => {
  assert.ok(!plan2Kept.includes(P_DEDUPED.placeName), `kept=${JSON.stringify(plan2Kept)}`);
});

await test("plan_trip: user-selected LOW stop (no verified hours) is protected by Place ID match", () => {
  assert.ok(plan2Kept.includes(P_SELECTED.placeName), `kept=${JSON.stringify(plan2Kept)}`);
});

await test("plan_trip: itinerary items gain no opening-hours fields", () => {
  for (const item of [...plan1, ...plan2]) {
    assert.equal("regularOpeningHours" in item, false, item.placeName);
    assert.equal("currentOpeningHours" in item, false, item.placeName);
  }
});

// ----------------------------------------- Ranking -----------------------------------------
const rec = (key, name, i) => ({
  name,
  type: "historical_landmark",
  description: "",
  reason: "",
  googlePlaceId: `ChIJ_R3_RANK_${key}`,
  lat: CENTER.lat + 0.01 + i * 0.001,
  lng: CENTER.lng + 0.01 + i * 0.001,
  rating: 4.6,
  userRatingCount: 500,
});
const R_CONTROL = rec("CONTROL", "Velmora Riverside Park Mill", 1);
const R_CACHE = rec("CACHE", "Site of former Velmora Riverside Park Kiln", 2);
const R_RUNNER_SAME = rec("RUNSAME", "Site of former Velmora Riverside Park Forge", 3);
const R_RUNNER_OTHER = rec("RUNOTHER", "Site of former Velmora Riverside Park Weir", 4);
const R_DEDUPED = rec("DEDUPED", "Site of former Velmora Riverside Park Wharf", 5);
const R_CACHE_OTHER = rec("CACHEOTHER", "Site of former Velmora Riverside Park Gate", 6);
const RANK_OTHER_ID = "ChIJ_R3_RANK_SOMEONE_ELSE";

// Batch A (one chunk of 4): Place-ID cache hits + real runner on fake Google responses.
setAiHoursCacheByPlaceId(R_CONTROL.googlePlaceId, HOURS_DATA);
setAiHoursCacheByPlaceId(R_CACHE.googlePlaceId, HOURS_DATA);
injectFakeGoogleTextSearch(R_RUNNER_SAME.name, R_RUNNER_SAME.lat, R_RUNNER_SAME.lng,
  fakeRawPlace(R_RUNNER_SAME.googlePlaceId, R_RUNNER_SAME.name));
injectFakeGoogleTextSearch(R_RUNNER_OTHER.name, R_RUNNER_OTHER.lat, R_RUNNER_OTHER.lng,
  fakeRawPlace(RANK_OTHER_ID, R_RUNNER_OTHER.name));
// Batch B: pid-keyed hours dedupe (runner never executes for this call) and hours cached only
// under ANOTHER Place ID.
setAiHoursCacheByPlaceId("ChIJ_R3_RANK_CACHED_NEIGHBOUR", HOURS_DATA);

const rankCtx = {
  mode: "recommend",
  locale: "zh-TW",
  location: { lat: CENTER.lat, lng: CENTER.lng, city: "Velmora" },
  time: `${DATE}T10:00:00+09:00`,
};
const runRank = async (recs) => {
  const out = await enrichRoamieResponse(
    { summary: "", recommendations: recs.map((r) => ({ ...r })), itinerary: [] },
    rankCtx,
  );
  return out.recommendations ?? [];
};
const rankA = await runRank([R_CONTROL, R_CACHE, R_RUNNER_SAME, R_RUNNER_OTHER]);
void runAiHoursLookupDeduped(`pid:${R_DEDUPED.googlePlaceId}`, () => later(1500, HOURS_DATA));
void runAiHoursLookupDeduped(`pid:${R_CACHE_OTHER.googlePlaceId}`, () => later(1500, null));
const rankB = await runRank([R_CONTROL, R_DEDUPED, R_CACHE_OTHER]);
const rankAKept = rankA.map((r) => r.name);
const rankBKept = rankB.map((r) => r.name);
console.log("INFO ranking A kept:", JSON.stringify(rankAKept), "B kept:", JSON.stringify(rankBKept));

await test("precondition: ranking control admitted; runner consumed fake responses; no real provider path", () => {
  assert.equal(realProviderPathEntered, 0, "real provider request path was entered");
  assert.ok(rankAKept.includes(R_CONTROL.name), `kept=${JSON.stringify(rankAKept)}`);
  assert.ok(rankBKept.includes(R_CONTROL.name), `kept=${JSON.stringify(rankBKept)}`);
  assert.ok(getAiHoursCacheByPlaceId(RANK_OTHER_ID), "runner did not consume RUNNER_OTHER response");
});

await test("ranking (a): LOW-shaped rec with Place-ID-cache hours is NOT removed by the Gate", () => {
  assert.ok(rankAKept.includes(R_CACHE.name), `kept=${JSON.stringify(rankAKept)}`);
});

await test("ranking (a'): LOW-shaped rec with hours from its own lookup (Google id equal) kept", () => {
  assert.ok(rankAKept.includes(R_RUNNER_SAME.name), `kept=${JSON.stringify(rankAKept)}`);
});

await test("ranking (b): hours whose Google id differs → still removed as LOW", () => {
  assert.ok(!rankAKept.includes(R_RUNNER_OTHER.name), `kept=${JSON.stringify(rankAKept)}`);
});

await test("ranking (b'): hours shared via pid dedupe (unverified) → still removed as LOW", () => {
  assert.ok(!rankBKept.includes(R_DEDUPED.name), `kept=${JSON.stringify(rankBKept)}`);
});

await test("ranking (b''): hours cached under another Place ID never leak → removed as LOW", () => {
  assert.ok(!rankBKept.includes(R_CACHE_OTHER.name), `kept=${JSON.stringify(rankBKept)}`);
});

await test("ranking: output recommendation objects gain no opening-hours fields", () => {
  assert.ok(rankA.length > 0 && rankB.length > 0);
  for (const r of [...rankA, ...rankB]) {
    assert.equal("regularOpeningHours" in r, false, `${r.name} has regularOpeningHours`);
    assert.equal("currentOpeningHours" in r, false, `${r.name} has currentOpeningHours`);
  }
});

await test("zero provider (fetch) calls", () => {
  assert.equal(fetchCalls, 0);
  assert.equal(realProviderPathEntered, 0);
});

if (failures.length) {
  console.log(
    `FAIL tqg v2 round3 identity: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`,
  );
  process.exitCode = 1;
} else {
  console.log(`PASS tqg v2 round3 identity: ${cases} scenarios, provider calls ${fetchCalls}`);
}
