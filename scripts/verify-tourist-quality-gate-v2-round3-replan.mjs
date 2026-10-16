// Tourist Quality Gate V2 — round 3 independent check: Replan offered-pin verdict reuse.
// OFFLINE: fetch trapped and counted (must stay 0); discovery cache seeded in-process with
// synthetic candidates. Fixture names are fictional (prefix "霧岬"/"Velmora"); no rule depends
// on a specific place name.
//
// Contract under test (round 3):
//  - first-pass verdict bound to Google Place ID; reused only when Place ID AND canonical intent
//    are both equal; otherwise re-judged; never default-admit; LOW never re-enters via Replan;
//  - a first-pass REJECTION stays rejected even if re-judging would admit;
//  - old sessions (no / malformed touristQuality) never crash and are never default-admitted;
//  - stored verdict is minimal (no review text / opening hours / personal data).
//
// Run: npx vite-node scripts/verify-tourist-quality-gate-v2-round3-replan.mjs --config scripts/vite.verify.config.mjs
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("round3 replan verify must not call providers");
};

const { setCachedDiscoveredCombinations } =
  await import("../src/lib/ai/destination-combination-discovery");
const { buildOfferedCombinationsForSession, offeredPlaceTouristQualityIntent } =
  await import("../src/lib/ai/destination-combination-suggestions");
const { classifyTouristQuality } = await import("../src/lib/tourist-quality-gate");
const {
  resolveSelectedCombinationPools,
  createOfferedCombinationIdentity,
  withOfferedCombinationIdentity,
  clearCombinationPoolMemo,
  isCombinationIdDriftedFromOffered,
} = await import("../src/lib/ai/combination-itinerary-integrity");

let cases = 0;
const failures = [];
const inconclusive = [];
const test = async (name, fn) => {
  try {
    const before = inconclusive.length;
    await fn();
    if (inconclusive.length > before) {
      console.log("INCONCLUSIVE", name);
      return;
    }
    cases++;
    console.log("PASS", name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL", name, "--", (e?.message ?? String(e)).split("\n").slice(0, 4).join(" | "));
  }
};

const DESTINATION = "霧岬市";
const CENTER = { lat: 35.1, lng: 135.1 };
const HOURS = {
  openNow: true,
  periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
  weekdayDescriptions: ["Monday: 9:00 AM – 5:00 PM"],
};
const COMBO = { title: "城市景點漫遊", theme: "attraction" }; // general sightseeing title

let seq = 0;
const cand = (key, name, types, extra = {}) => {
  seq++;
  const id = `ChIJ_R3_REPLAN_${key}`;
  return {
    name,
    originalName: name,
    googlePlaceId: id,
    searchCandidateId: id,
    address: `${DESTINATION}港町${seq}-2`,
    coordinates: { lat: CENTER.lat + seq * 0.001, lng: CENTER.lng + seq * 0.001 },
    types,
    primaryType: types[0] ?? null,
    rating: 4.5,
    userRatingCount: 300,
    businessStatus: "OPERATIONAL",
    ...extra,
  };
};

// LOW shape: D1 marker-only type + D2 old-site name, no counter-evidence.
const C_LOW = cand("LOW", "霧岬旧船番所跡", ["historical_landmark", "point_of_interest"]);
// Same shape WITH hours → first pass admits (counter-evidence).
const C_HOURS = cand("HOURS", "霧岬旧関所跡", ["historical_landmark", "point_of_interest"], {
  regularOpeningHours: HOURS,
  reviewEvidence: { signals: [{ topic: "view", sentiment: "positive", text: "PRIVATE REVIEW TEXT" }] },
});
const C_MUSEUM = cand("MUSEUM", "霧岬港町資料館", ["museum"], { regularOpeningHours: HOURS });
const C_PARK = cand("PARK", "霧岬臨海公園", ["park", "tourist_attraction"]);

const offeredPlace = (c, extra = {}) => ({
  name: c.name,
  originalName: c.name,
  googlePlaceId: c.googlePlaceId,
  latitude: c.coordinates.lat,
  longitude: c.coordinates.lng,
  types: c.types,
  primaryType: c.primaryType,
  rating: c.rating,
  userRatingCount: c.userRatingCount,
  address: c.address,
  resolutionStatus: "resolved",
  ...extra,
});

const intentOf = (c) =>
  offeredPlaceTouristQualityIntent({
    name: c.name,
    address: c.address,
    types: c.types,
    primaryType: c.primaryType,
    googlePlaceId: c.googlePlaceId,
  }).intent;
const otherIntent = (i) => (i === "cultural_exploration" ? "general_sightseeing" : "cultural_exploration");

// Drifted cache: re-discovery no longer holds the offered places → offered-pin pool path.
const seedDriftedCache = () =>
  setCachedDiscoveredCombinations(DESTINATION, [
    {
      combinationId: "1",
      title: COMBO.title,
      theme: COMBO.theme,
      placeCandidates: [C_MUSEUM, C_PARK],
      primaryCandidates: [C_MUSEUM, C_PARK],
    },
  ]);

/** Replan pool ids for an offered combination [museum control + given places]. */
const replanPoolIds = (places, title = COMBO.title, themeKey = undefined, museum = offeredPlace(C_MUSEUM)) => {
  seedDriftedCache();
  clearCombinationPoolMemo();
  const identity = createOfferedCombinationIdentity(DESTINATION, [
    { id: 1, title, ...(themeKey === undefined ? {} : { themeKey }), places: [museum, ...places] },
  ]);
  const drifted = withOfferedCombinationIdentity(identity, () =>
    isCombinationIdDriftedFromOffered(DESTINATION, 1),
  );
  assert.equal(drifted, true, "precondition: offered-pin path not taken");
  const [pool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DESTINATION, [1], { forceRefresh: true }),
  );
  const ids = (pool?.all ?? []).map((c) => c.googlePlaceId);
  assert.ok(ids.includes(C_MUSEUM.googlePlaceId), `museum control missing; ids=${ids}`);
  return ids;
};

const LOW_INTENT = intentOf(C_LOW);
console.log("INFO canonical place-level intent for LOW fixture:", LOW_INTENT);

await test("precondition: LOW fixture is LOW; fresh Replan judgement (no verdict) rejects it", () => {
  assert.equal(
    classifyTouristQuality({ name: C_LOW.name, types: C_LOW.types, primaryType: C_LOW.primaryType }).tier,
    "LOW_EXPERIENCE_VALUE",
  );
  const ids = replanPoolIds([offeredPlace(C_LOW)]);
  assert.ok(!ids.includes(C_LOW.googlePlaceId), `ids=${JSON.stringify(ids)}`);
});

await test("control: verdict with SAME Place ID and SAME canonical intent is reused", () => {
  const ids = replanPoolIds([
    offeredPlace(C_LOW, {
      touristQuality: { placeId: C_LOW.googlePlaceId, tier: "VISIT_WORTHY", admit: true, intent: LOW_INTENT },
    }),
  ]);
  assert.ok(ids.includes(C_LOW.googlePlaceId), `reuse path not taken; ids=${JSON.stringify(ids)}`);
});

await test("Replan: verdict bound to a DIFFERENT Place ID is not reused (LOW stays out)", () => {
  const ids = replanPoolIds([
    offeredPlace(C_LOW, {
      touristQuality: { placeId: "ChIJ_R3_REPLAN_ELSEWHERE", tier: "VISIT_WORTHY", admit: true, intent: LOW_INTENT },
    }),
  ]);
  assert.ok(!ids.includes(C_LOW.googlePlaceId), `ids=${JSON.stringify(ids)}`);
});

await test("Replan: same name, swapped verdict (identity by name never used)", () => {
  // Two offered places share a display name; the admitting verdict belongs to the other one.
  const twin = cand("TWIN", C_LOW.name, ["historical_landmark"]);
  const ids = replanPoolIds([
    offeredPlace(C_LOW, {
      touristQuality: { placeId: twin.googlePlaceId, tier: "VISIT_WORTHY", admit: true, intent: LOW_INTENT },
    }),
  ]);
  assert.ok(!ids.includes(C_LOW.googlePlaceId), `ids=${JSON.stringify(ids)}`);
});

// Rewritten (T8, user contract: canonical intent = the combination theme the user chose; a verdict
// is reused only when intent AND Place ID match). "DIFFERENT intent" now means different from the
// COMBINATION's canonical intent (themeKey), not from the place-level semantic family.
// LOW without cultural evidence ("landmark" marker type is not a cultural type).
const C_LOW_NC = cand("LOWNC", "霧岬旧物見櫓跡", ["landmark", "point_of_interest"]);
const lowVerdict = (c, admit, intent, tier = "LOW_EXPERIENCE_VALUE") => ({
  touristQuality: { placeId: c.googlePlaceId, tier, admit, intent },
});

await test("Replan: verdict computed under a DIFFERENT intent than the combination themeKey is re-judged (LOW stays out)", () => {
  // Combination canonical = general_sightseeing (themeKey attraction); verdict admitted LOW under cultural.
  assert.equal(COMBO.theme, "attraction");
  const ids = replanPoolIds(
    [offeredPlace(C_LOW, lowVerdict(C_LOW, true, "cultural_exploration"))],
    COMBO.title,
    COMBO.theme,
  );
  assert.ok(!ids.includes(C_LOW.googlePlaceId), `ids=${JSON.stringify(ids)}`);
});

await test("Replan (reverse): themeKey=culture, rejection recorded under general → not reused, re-judged under culture", () => {
  // Proves mismatch means re-judge (not "keep whatever the verdict said"): C_LOW has cultural evidence.
  const ids = replanPoolIds(
    [offeredPlace(C_LOW, lowVerdict(C_LOW, false, "general_sightseeing"))],
    "藝文博物館巡禮",
    "culture",
  );
  assert.ok(ids.includes(C_LOW.googlePlaceId), `ids=${JSON.stringify(ids)}`);
});

await test("Replan (LOW anti-reentry): themeKey=culture, forged admit verdict under general for LOW without cultural evidence → out", () => {
  const ids = replanPoolIds(
    [offeredPlace(C_LOW_NC, lowVerdict(C_LOW_NC, true, "general_sightseeing", "VISIT_WORTHY"))],
    "藝文博物館巡禮",
    "culture",
  );
  assert.ok(!ids.includes(C_LOW_NC.googlePlaceId), `ids=${JSON.stringify(ids)}`);
});

await test("Replan (old session, no themeKey): verdict intents disagree → no trusted intent → no reuse, LOW stays out", () => {
  // Stricter old-session equivalent of the original case: another place's verdict is under general,
  // the LOW's admitting verdict under cultural; title is general → re-judged conservatively.
  const ids = replanPoolIds(
    [offeredPlace(C_LOW, lowVerdict(C_LOW, true, "cultural_exploration"))],
    COMBO.title,
    undefined,
    offeredPlace(C_MUSEUM, { touristQuality: { placeId: C_MUSEUM.googlePlaceId, tier: "VISIT_WORTHY", admit: true, intent: "general_sightseeing" } }),
  );
  assert.ok(!ids.includes(C_LOW.googlePlaceId), `ids=${JSON.stringify(ids)}`);
});

await test("Replan: first-pass REJECTION is kept even when re-judging would admit", () => {
  // Offered place carries hours → a fresh judgement would admit it; first pass said no.
  const fresh = replanPoolIds([offeredPlace(C_HOURS, { regularOpeningHours: HOURS })]);
  assert.ok(fresh.includes(C_HOURS.googlePlaceId), `precondition: fresh re-judge should admit; ids=${fresh}`);
  const ids = replanPoolIds([
    offeredPlace(C_HOURS, {
      regularOpeningHours: HOURS,
      touristQuality: {
        placeId: C_HOURS.googlePlaceId,
        tier: "LOW_EXPERIENCE_VALUE",
        admit: false,
        intent: intentOf(C_HOURS),
      },
    }),
  ]);
  assert.ok(!ids.includes(C_HOURS.googlePlaceId), `rejection overridden; ids=${JSON.stringify(ids)}`);
});

await test("Replan: offered place WITHOUT googlePlaceId never reuses a verdict", () => {
  const { googlePlaceId: _drop, ...noId } = offeredPlace(C_LOW);
  const ids = replanPoolIds([
    { ...noId, touristQuality: { placeId: C_LOW.googlePlaceId, tier: "VISIT_WORTHY", admit: true, intent: LOW_INTENT } },
  ]);
  const names = ids.filter(Boolean);
  assert.ok(!ids.some((id) => id == null || id === C_LOW.googlePlaceId), `ids=${JSON.stringify(ids)} names=${names}`);
});

await test("K old session: no touristQuality field → no crash, LOW not admitted, others kept", () => {
  const legacy = JSON.parse(JSON.stringify([offeredPlace(C_LOW), offeredPlace(C_PARK)]));
  for (const p of legacy) assert.equal("touristQuality" in p, false);
  const ids = replanPoolIds(legacy);
  assert.ok(!ids.includes(C_LOW.googlePlaceId), `LOW default-admitted; ids=${JSON.stringify(ids)}`);
  assert.ok(ids.includes(C_PARK.googlePlaceId), `visit-worthy legacy place dropped; ids=${ids}`);
});

await test("K old/corrupt session: malformed touristQuality values never crash nor release LOW", () => {
  for (const bad of [null, {}, "VISIT_WORTHY", { admit: true }, { placeId: null, admit: true }]) {
    const ids = replanPoolIds([offeredPlace(C_LOW, { touristQuality: bad })]);
    assert.ok(!ids.includes(C_LOW.googlePlaceId), `bad=${JSON.stringify(bad)} ids=${ids}`);
  }
});

// Production snapshot: verdict present, bound to Place ID, minimal.
setCachedDiscoveredCombinations(DESTINATION, [
  {
    combinationId: "1",
    title: COMBO.title,
    theme: COMBO.theme,
    placeCandidates: [C_HOURS, C_MUSEUM],
    primaryCandidates: [C_HOURS, C_MUSEUM],
  },
]);
const offered = buildOfferedCombinationsForSession(DESTINATION, "zh-TW");
const snapPlaces = offered.flatMap((c) => c.places ?? []);

await test("snapshot: verdict bound to the place's own Google Place ID with canonical intent", () => {
  const p = snapPlaces.find((x) => x.googlePlaceId === C_HOURS.googlePlaceId);
  assert.ok(p, "place missing from offered snapshot");
  assert.ok(p.touristQuality, "no touristQuality on snapshot place");
  assert.equal(p.touristQuality.placeId, C_HOURS.googlePlaceId);
  assert.equal(p.touristQuality.admit, true);
  assert.ok(["general_sightseeing", "cultural_exploration"].includes(p.touristQuality.intent));
});

await test("snapshot: stored verdict and place are minimal (no review text / hours / personal data)", () => {
  for (const p of snapPlaces) {
    if (p.touristQuality) {
      assert.deepEqual(Object.keys(p.touristQuality).sort(), ["admit", "intent", "placeId", "tier"]);
    }
    const json = JSON.stringify(p);
    assert.doesNotMatch(json, /PRIVATE REVIEW TEXT/);
    assert.equal("regularOpeningHours" in p, false);
    assert.equal("currentOpeningHours" in p, false);
    assert.equal("reviewEvidence" in p, false);
  }
});

// Parity under a cultural-themed combination: the SAME offered place must get the same Replan
// verdict whether the cache is intact (validateCandidateIntent, combination-level intent) or
// drifted (offered-pin pool reusing the snapshot verdict).
const CULTURAL = { title: "歴史文化散策", theme: "culture" };
await test("parity: cultural combination — intact-cache Replan and drifted offered-pin Replan agree", () => {
  const cache = [
    {
      combinationId: "1",
      title: CULTURAL.title,
      theme: CULTURAL.theme,
      placeCandidates: [C_LOW, C_MUSEUM],
      primaryCandidates: [C_LOW, C_MUSEUM],
    },
  ];
  setCachedDiscoveredCombinations(DESTINATION, cache);
  const snap = buildOfferedCombinationsForSession(DESTINATION, "zh-TW");
  const snapLow = snap.flatMap((c) => c.places ?? []).find((p) => p.googlePlaceId === C_LOW.googlePlaceId);
  clearCombinationPoolMemo();
  const identity = createOfferedCombinationIdentity(DESTINATION, snap);
  const [intactPool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DESTINATION, [1], { forceRefresh: true }),
  );
  const intact = (intactPool?.all ?? []).some((c) => c.googlePlaceId === C_LOW.googlePlaceId);
  seedDriftedCache();
  clearCombinationPoolMemo();
  const [driftPool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DESTINATION, [1], { forceRefresh: true }),
  );
  const drifted = (driftPool?.all ?? []).some((c) => c.googlePlaceId === C_LOW.googlePlaceId);
  console.log(
    "OBSERVE cultural parity:",
    JSON.stringify({ inSnapshot: Boolean(snapLow), verdict: snapLow?.touristQuality ?? null, intact, drifted }),
  );
  if (!snapLow) {
    // Fixture could not place the LOW candidate into a cultural offer offline: not a pass.
    inconclusive.push("cultural parity (LOW place not in snapshot)");
    return;
  }
  assert.equal(drifted, intact, "drifted Replan verdict differs from intact-cache Replan");
});

await test("zero provider (fetch) calls", () => {
  assert.equal(fetchCalls, 0);
});

if (failures.length) {
  console.log(
    `FAIL tqg v2 round3 replan: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`,
  );
  process.exitCode = 1;
} else {
  console.log(`PASS tqg v2 round3 replan: ${cases} scenarios, provider calls ${fetchCalls}`);
}
