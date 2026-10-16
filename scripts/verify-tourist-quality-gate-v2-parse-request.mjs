// Tourist Quality Gate V2 — production request path: parseRoamieRequest → enrichRoamieResponse.
// The request body is a JSON round-trip of what the client sends to /api/roamie, parsed by the
// SAME exported parser the route uses (RequestSchema / PlaceItemSchema transform). The parsed
// context is then handed to enrichRoamieResponse (plan_trip / enrichItinerary), where selected-
// place protection reads googlePlaceId from ctx.selectedPlaces and ctx.itineraryRequest.selectedPlaces.
//
// OFFLINE: globalThis.fetch is trapped and counted (must stay 0); no API key. Every stop's opening
// hours come from the name-keyed in-flight hours dedupe (runAiHoursLookupDeduped) — hours exist for
// availability, but by contract they are UNVERIFIED (no Place ID) and never reach the Gate, so every
// LOW-shaped stop is LOW for the Gate and only selected-place protection can keep it.
// Fixture names are fictional (prefix "Hollowmere"); no rule depends on a specific place name.
//
// Run: npx vite-node scripts/verify-tourist-quality-gate-v2-parse-request.mjs --config scripts/vite.verify.config.mjs
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("parse-request verify must not call providers");
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
for (const s of [process.stdout, process.stderr]) s._handle?.setBlocking?.(true);
setTimeout(() => {
  console.log("FAIL tqg v2 parse-request: watchdog timeout (90s)");
  process.exit(2);
}, 90_000).unref();

const { parseRoamieRequest } = await import("../src/lib/ai/service.server");
const { enrichRoamieResponse } = await import("../src/lib/enrich-roamie-places.server");
const { runAiHoursLookupDeduped } = await import("../src/lib/recommendation/ai-places-cache");
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
const HOURS_DATA = {
  businessStatus: "OPERATIONAL",
  regularOpeningHours: { openNow: true, periods: PERIODS, weekdayDescriptions: ["Monday: 8:00 AM – 8:00 PM"] },
  currentOpeningHours: { openNow: true, periods: PERIODS },
  utcOffsetMinutes: 540,
};

let seq = 0;
/** LOW-shaped itinerary stop: D1 historical_landmark + D2 "Site of former …", no counter-evidence. */
const lowStop = (placeName, googlePlaceId) => {
  seq++;
  return {
    date: DATE,
    time: "10:00",
    title: "historical_landmark",
    description: "",
    placeName,
    lat: CENTER.lat + seq * 0.001,
    lng: CENTER.lng + seq * 0.001,
    ...(googlePlaceId === undefined ? {} : { googlePlaceId }),
    placeType: "historical_landmark",
    rating: 4.6,
    userRatingCount: 500,
  };
};

// Control: not LOW (no D2 marker; "park" satisfies the pre-existing travel-friendly name rule).
const CONTROL = lowStop("Hollowmere Parkside Mill", "ChIJ_TQG_PARSE_CONTROL");
// (a) protected via ctx.selectedPlaces (top-level) — ChIJ-format ID.
const SEL_TOP = lowStop("Site of former Hollowmere Parkside Kiln", "ChIJ_TQG_PARSE_SEL_TOP");
// (a) protected via ctx.itineraryRequest.selectedPlaces — non-ChIJ opaque Google ID format.
const SEL_ITIN_ID = "GhIJTQGParseSelItin_0123456789";
const SEL_ITIN = lowStop("Site of former Hollowmere Parkside Forge", SEL_ITIN_ID);
// (b) reverse fixtures — every one LOW-shaped and must stay removed.
const UNSEL = lowStop("Site of former Hollowmere Parkside Wharf", "ChIJ_TQG_PARSE_UNSELECTED");
const SYN_IDS = [
  "name:site of former hollowmere parkside weir",
  "synthetic:hollowmere-parkside-sluice",
  "classic-fallback:hollowmere-parkside-gate",
  "landmark-cache:hollowmere-parkside-bridge",
  "dayplan:1:hollowmere-parkside-tower",
];
const SYN = SYN_IDS.map((id, i) => lowStop(`Site of former Hollowmere Parkside Synthetic ${i + 1}`, id));
// Selection without googlePlaceId but same name as a stop that HAS a real ID → no name protection.
const NOID = lowStop("Site of former Hollowmere Parkside Granary", "ChIJ_TQG_PARSE_NOID_STOP");
// Selection with a DIFFERENT real Place ID but same name.
const DIFF = lowStop("Site of former Hollowmere Parkside Ropery", "ChIJ_TQG_PARSE_DIFF_STOP");
const DIFF_SELECTED_ID = "ChIJ_TQG_PARSE_DIFF_SELECTED";
const ALL_STOPS = [CONTROL, SEL_TOP, SEL_ITIN, UNSEL, ...SYN, NOID, DIFF];
const LOW_STOPS = ALL_STOPS.filter((s) => s !== CONTROL);

const sel = (s, googlePlaceId) => ({
  name: s.placeName,
  placeName: s.placeName,
  lat: s.lat,
  lng: s.lng,
  ...(googlePlaceId === undefined ? {} : { googlePlaceId }),
});

// Client body exactly as sent over the wire (JSON round-trip), then the production parser.
const body = JSON.parse(
  JSON.stringify({
    mode: "itinerary",
    locale: "zh-TW",
    location: { lat: CENTER.lat, lng: CENTER.lng, city: "Hollowmere" },
    time: `${DATE}T10:00:00+09:00`,
    selectedPlaces: [
      sel(SEL_TOP, `  ${SEL_TOP.googlePlaceId}  `), // whitespace is trimmed, not dropped
      ...SYN.map((s) => sel(s, s.googlePlaceId)),
      sel(NOID), // no googlePlaceId at all
      sel(DIFF, DIFF_SELECTED_ID),
      sel(UNSEL, ""), // empty string → absent, never protection
    ],
    itineraryRequest: {
      destination: "Hollowmere",
      days: 1,
      startDate: DATE,
      selectedPlaces: [sel(SEL_ITIN, SEL_ITIN_ID), sel(NOID)],
    },
  }),
);
const ctx = parseRoamieRequest(body);

const hoursKey = (s) => `name:${s.placeName.trim().toLowerCase()}:${s.lat.toFixed(3)}:${s.lng.toFixed(3)}`;
const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
for (const s of ALL_STOPS) void runAiHoursLookupDeduped(hoursKey(s), () => later(1500, HOURS_DATA));

const out = await enrichRoamieResponse(
  { summary: "", recommendations: [], itinerary: ALL_STOPS.map((s) => ({ ...s })) },
  ctx,
);
const kept = (out.itinerary ?? []).map((i) => i.placeName);
const keptItems = out.itinerary ?? [];
console.log("INFO kept:", JSON.stringify(kept));

// ------------------------------ preconditions ------------------------------
await test("precondition: control stop admitted (hours injection works, pre-Gate rules pass)", () => {
  assert.ok(kept.includes(CONTROL.placeName), `kept=${JSON.stringify(kept)}`);
});

await test("precondition: every LOW fixture is LOW and removed ONLY by the Gate (protected call passes)", () => {
  for (const s of LOW_STOPS) {
    assert.equal(
      classifyTouristQuality({ name: s.placeName, primaryType: "historical_landmark", types: ["historical_landmark"] }).tier,
      "LOW_EXPERIENCE_VALUE",
      s.placeName,
    );
    const input = itineraryToRecommendableInput(s, { businessStatus: "OPERATIONAL", openStatus: "open" });
    const unprotected = isRecommendablePlace(input, "plan_trip", { logDrop: false });
    assert.equal(unprotected.reason, "tourist_quality_low_experience", `${s.placeName}: ${unprotected.reason}`);
    const protectedR = isRecommendablePlace(input, "plan_trip", {
      logDrop: false,
      touristQualityProtection: "explicit",
    });
    assert.equal(protectedR.ok, true, `${s.placeName} rejected by a non-Gate rule: ${protectedR.reason}`);
  }
});

// ------------------------------ (a) parse keeps googlePlaceId; selected LOW kept ------------------------------
await test("a) parseRoamieRequest keeps googlePlaceId on selectedPlaces (trimmed) and itineraryRequest.selectedPlaces", () => {
  const top = ctx.selectedPlaces.find((p) => p.name === SEL_TOP.placeName);
  assert.equal(top.googlePlaceId, SEL_TOP.googlePlaceId);
  const itin = ctx.itineraryRequest.selectedPlaces.find((p) => p.name === SEL_ITIN.placeName);
  assert.equal(itin.googlePlaceId, SEL_ITIN_ID);
});

await test("a) selected LOW stop via ctx.selectedPlaces is not removed by the Gate", () => {
  assert.ok(kept.includes(SEL_TOP.placeName), `kept=${JSON.stringify(kept)}`);
});

await test("a) selected LOW stop via ctx.itineraryRequest.selectedPlaces (non-ChIJ Google ID) is not removed", () => {
  assert.ok(kept.includes(SEL_ITIN.placeName), `kept=${JSON.stringify(kept)}`);
});

await test("a) kept selected stops still carry their own googlePlaceId (no ID rewrite)", () => {
  assert.equal(keptItems.find((i) => i.placeName === SEL_TOP.placeName)?.googlePlaceId, SEL_TOP.googlePlaceId);
  assert.equal(keptItems.find((i) => i.placeName === SEL_ITIN.placeName)?.googlePlaceId, SEL_ITIN_ID);
});

// ------------------------------ (b) reverse ------------------------------
await test("b) unselected LOW stop of the same shape is still removed", () => {
  assert.ok(!kept.includes(UNSEL.placeName), `kept=${JSON.stringify(kept)}`);
});

await test("b) empty-string googlePlaceId is dropped by the parser (not protection)", () => {
  const p = ctx.selectedPlaces.find((x) => x.name === UNSEL.placeName);
  assert.equal("googlePlaceId" in p, false, JSON.stringify(p));
});

await test("b) synthetic / name / fallback / landmark-cache / dayplan IDs are preserved verbatim but never protect", () => {
  for (const s of SYN) {
    const p = ctx.selectedPlaces.find((x) => x.name === s.placeName);
    assert.equal(p.googlePlaceId, s.googlePlaceId, "parser must not rewrite IDs");
    assert.ok(!kept.includes(s.placeName), `${s.googlePlaceId} protected; kept=${JSON.stringify(kept)}`);
  }
});

await test("b) selection without googlePlaceId: parser does not invent one; same-name stop not protected", () => {
  for (const list of [ctx.selectedPlaces, ctx.itineraryRequest.selectedPlaces]) {
    const p = list.find((x) => x.name === NOID.placeName);
    assert.ok(p, "selection missing");
    assert.equal("googlePlaceId" in p, false, JSON.stringify(p));
  }
  assert.ok(!kept.includes(NOID.placeName), `kept=${JSON.stringify(kept)}`);
});

await test("b) selection with a DIFFERENT Place ID (same name) does not protect the stop", () => {
  assert.ok(!kept.includes(DIFF.placeName), `kept=${JSON.stringify(kept)}`);
});

// Non-triviality: before the hotfix PlaceItemSchema had no googlePlaceId, so zod stripped it.
// Simulate exactly that stripped context: the same selected stops must then be removed.
await test("a) non-trivial: with googlePlaceId stripped (pre-hotfix schema behavior) the selected stops are removed", async () => {
  const strip = (list) => list.map(({ googlePlaceId: _drop, ...rest }) => rest);
  const stripped = {
    ...ctx,
    selectedPlaces: strip(ctx.selectedPlaces),
    itineraryRequest: { ...ctx.itineraryRequest, selectedPlaces: strip(ctx.itineraryRequest.selectedPlaces) },
  };
  const stops = [CONTROL, SEL_TOP, SEL_ITIN];
  for (const s of stops) void runAiHoursLookupDeduped(hoursKey(s), () => later(200, HOURS_DATA));
  const res = await enrichRoamieResponse(
    { summary: "", recommendations: [], itinerary: stops.map((s) => ({ ...s })) },
    stripped,
  );
  const names = (res.itinerary ?? []).map((i) => i.placeName);
  assert.ok(names.includes(CONTROL.placeName), `control dropped; kept=${JSON.stringify(names)}`);
  assert.ok(!names.includes(SEL_TOP.placeName), `kept=${JSON.stringify(names)}`);
  assert.ok(!names.includes(SEL_ITIN.placeName), `kept=${JSON.stringify(names)}`);
});

// ------------------------------ (c) other schema fields unchanged ------------------------------
await test("c) PlaceItemSchema transform defaults unchanged; no googlePlaceId key when absent", () => {
  const parsed = parseRoamieRequest({ mode: "chat", selectedPlaces: [{ name: "Hollowmere Bare" }] });
  assert.deepEqual(parsed.selectedPlaces[0], {
    name: "Hollowmere Bare",
    type: "地點",
    description: "",
    reason: "",
    estimatedTime: "1-2 小時",
    address: "",
    lat: null,
    lng: null,
    googleMapsUrl: "",
    placeName: "Hollowmere Bare",
    reasonSource: "template",
  });
});

await test("c) explicit fields pass through unchanged next to googlePlaceId (all PlaceItem positions)", () => {
  const full = {
    name: "Hollowmere Full",
    type: "museum",
    description: "d",
    reason: "r",
    estimatedTime: "2 小時",
    address: "1 Hollow St",
    lat: 1.5,
    lng: 2.5,
    googleMapsUrl: "https://maps.example/x",
    placeName: "Hollowmere Full PN",
    reasonSource: "evidence",
    googlePlaceId: "ChIJ_TQG_PARSE_FULL",
  };
  const parsed = parseRoamieRequest({
    mode: "itinerary",
    recommendedPlaces: [full],
    focusedPlace: full,
    selectedPlaces: [full],
    itineraryRequest: { destination: "Hollowmere", days: 1, selectedPlaces: [full] },
  });
  for (const p of [
    parsed.recommendedPlaces[0],
    parsed.focusedPlace,
    parsed.selectedPlaces[0],
    parsed.itineraryRequest.selectedPlaces[0],
  ]) {
    assert.deepEqual(p, full);
  }
});

await test("c) schema still rejects a PlaceItem without name (unchanged)", () => {
  assert.throws(() => parseRoamieRequest({ mode: "chat", selectedPlaces: [{ googlePlaceId: "ChIJ_x" }] }));
});

// Behavior change vs HEAD (reported, not asserted as contract): HEAD's PlaceItemSchema had no
// googlePlaceId key, so zod silently stripped ANY value (null / number). Now a non-string value
// fails the whole request (route → 400 "Invalid request").
{
  const outcome = (v) => {
    try {
      const p = parseRoamieRequest({ mode: "chat", selectedPlaces: [{ name: "x", googlePlaceId: v }] });
      return { ok: true, googlePlaceId: p.selectedPlaces[0].googlePlaceId ?? "(absent)" };
    } catch {
      return { ok: false };
    }
  };
  console.log(
    "OBSERVE non-string googlePlaceId:",
    JSON.stringify({ null: outcome(null), number: outcome(42), whitespace: outcome("   ") }),
  );
}

// ------------------------------ (d) cost ------------------------------
await test("d) zero provider calls (fetch trapped; real provider path never entered)", () => {
  assert.equal(fetchCalls, 0);
  assert.equal(realProviderPathEntered, 0);
});

if (failures.length) {
  console.log(`FAIL tqg v2 parse-request: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`);
  process.exitCode = 1;
} else {
  console.log(`PASS tqg v2 parse-request: ${cases} scenarios, provider calls ${fetchCalls}`);
}
process.exit(process.exitCode ?? 0);
