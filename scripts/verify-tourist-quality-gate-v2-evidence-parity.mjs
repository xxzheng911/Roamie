// Tourist Quality Gate V2 — evidence parity across entries (R34 / C5, R2b counter-evidence).
// Offline: synthetic fixtures + injected fake search; fetch is trapped.
//
// Run: npx vite-node scripts/verify-tourist-quality-gate-v2-evidence-parity.mjs --config scripts/vite.verify.config.mjs
//
// Claim under test: the SAME Google place (same types, same opening hours / review evidence)
// must get the same Gate tier at every entry. Chat / Explore / Home Nearby receive the full
// PlaceResult (hours + reviewEvidence) via placeResultToRecommendableInput; combination
// discovery / itinerary fetch / region expand / replan pools must not drop that evidence.
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("evidence parity verify must not call providers");
};

const { isRecommendablePlace, placeResultToRecommendableInput } =
  await import("../src/lib/is-recommendable-place");
const { validateCandidateIntent } = await import("../src/lib/ai/combination-candidate-quality");
const { classifyTouristQuality } = await import("../src/lib/tourist-quality-gate");
const { resolveRegionCandidate } = await import("../src/lib/ai/region-candidate-expand");
const {
  resolveSelectedCombinationPools,
  createOfferedCombinationIdentity,
  withOfferedCombinationIdentity,
  clearCombinationPoolMemo,
} = await import("../src/lib/ai/combination-itinerary-integrity");

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

const GATE_REASON_RE = /tourist_quality|low_experience/i;
const DESTINATION = "霧岬市";
const CENTER = { lat: 35.1, lng: 135.1 };
const HOURS = {
  openNow: true,
  periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
  weekdayDescriptions: ["Monday: 9:00 AM – 5:00 PM"],
};
const VIEW_REVIEW = { signals: [{ topic: "view", sentiment: "positive" }] };

let seq = 0;
const fx = (key, name, types, extra = {}) => {
  seq++;
  const id = `ChIJ_TQG_PARITY_${key}`;
  return {
    id,
    placeId: id,
    googlePlaceId: id,
    name,
    address: `${DESTINATION}中央${seq}-1`,
    lat: CENTER.lat + seq * 0.001,
    lng: CENTER.lng + seq * 0.001,
    rating: 4.5,
    userRatingCount: 300,
    photoName: null,
    primaryType: types[0] ?? null,
    types,
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    ...extra,
  };
};

// D1 (marker-only types) + D2 (old-site name) BUT with counter-evidence → must not be LOW.
const MARKER_TYPES = ["historical_landmark", "point_of_interest"];
const P_HOURS = fx("HOURS", "霧岬旧関所跡", MARKER_TYPES, {
  regularOpeningHours: HOURS,
  openStatus: "open",
});
const P_REVIEW = fx("REVIEW", "霧岬旧奉行所跡", MARKER_TYPES, { reviewEvidence: VIEW_REVIEW });
// Control: true LOW (no counter-evidence).
const P_LOW = fx("LOW", "霧岬旧船番所跡", MARKER_TYPES);

const gateInputOf = (p) => ({
  name: p.name,
  primaryType: p.primaryType,
  types: p.types,
  regularOpeningHours: p.regularOpeningHours,
  currentOpeningHours: p.currentOpeningHours,
  reviewEvidence: p.reviewEvidence,
});

const GENERAL_COMBO = { title: "城市景點漫遊", theme: "attraction" };

await test("precondition: counter-evidence fixtures are not LOW; control is LOW", () => {
  assert.notEqual(classifyTouristQuality(gateInputOf(P_HOURS)).tier, "LOW_EXPERIENCE_VALUE");
  assert.notEqual(classifyTouristQuality(gateInputOf(P_REVIEW)).tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(classifyTouristQuality(gateInputOf(P_LOW)).tier, "LOW_EXPERIENCE_VALUE");
});

await test("Chat entry (placeResultToRecommendableInput) sees counter-evidence → not gate-rejected", () => {
  for (const p of [P_HOURS, P_REVIEW]) {
    const r = isRecommendablePlace(
      placeResultToRecommendableInput(p),
      "chat_destination_recommend",
      {
        logDrop: false,
      },
    );
    assert.doesNotMatch(r.reason ?? "", GATE_REASON_RE, `${p.name} chat reason=${r.reason}`);
  }
  const low = isRecommendablePlace(
    placeResultToRecommendableInput(P_LOW),
    "chat_destination_recommend",
    {
      logDrop: false,
    },
  );
  assert.match(low.reason ?? "", GATE_REASON_RE, "control LOW must be gate-rejected at chat");
});

await test("validateCandidateIntent itself honours counter-evidence when it is passed", () => {
  for (const p of [P_HOURS, P_REVIEW]) {
    const r = validateCandidateIntent(
      {
        name: p.name,
        types: p.types,
        primaryType: p.primaryType,
        address: p.address,
        lat: p.lat,
        lng: p.lng,
        googlePlaceId: p.id,
        regularOpeningHours: p.regularOpeningHours,
        reviewEvidence: p.reviewEvidence,
      },
      GENERAL_COMBO,
      DESTINATION,
      { center: CENTER, requireTourismType: true },
    );
    assert.doesNotMatch(r.reason ?? "", GATE_REASON_RE, `${p.name} reason=${r.reason}`);
  }
});

// Production call site: src/lib/ai/region-candidate-expand.ts:246 (same shape as
// itinerary-place-fetch.ts:1417/1563/1787 and destination-combination-discovery.ts:1011/2674).
await test("Region expand (production call site) keeps same verdict as Chat for counter-evidence places", async () => {
  let searchCalls = 0;
  // Only the first query returns the fixtures, so each place (incl. the control LOW) is
  // evaluated by the Gate exactly once; later queries are genuinely empty. This keeps the
  // strict `gateRejected === 1` meaning: LOW rejected once, HOURS / REVIEW never.
  const searchPlaces = async () => {
    searchCalls++;
    const places =
      searchCalls === 1 ? [P_HOURS, P_REVIEW, P_LOW].map((p) => JSON.parse(JSON.stringify(p))) : [];
    return { places, error: null, rawCount: places.length };
  };
  const out = await resolveRegionCandidate({
    regionName: DESTINATION,
    combinationId: 1,
    destination: DESTINATION,
    lat: CENTER.lat,
    lng: CENTER.lng,
    locale: "zh-TW",
    searchPlaces,
    theme: GENERAL_COMBO.theme,
    title: GENERAL_COMBO.title,
    maxPlaces: 3,
  });
  assert.ok(searchCalls > 0, "fake search not exercised");
  const ids = out.places.map((p) => p.googlePlaceId ?? p.placeId ?? p.id);
  const gateRejected = Object.entries(out.telemetry?.rejectionReasons ?? {})
    .filter(([k]) => GATE_REASON_RE.test(k))
    .reduce((n, [, v]) => n + v, 0);
  assert.ok(!ids.includes(P_LOW.id), "control LOW admitted by region expand");
  assert.ok(
    ids.includes(P_HOURS.id),
    `place with opening hours dropped (Chat admits it); ids=${JSON.stringify(ids)} rejections=${JSON.stringify(out.telemetry?.rejectionReasons)}`,
  );
  assert.ok(
    ids.includes(P_REVIEW.id),
    `place with positive view review evidence dropped (Chat admits it); rejections=${JSON.stringify(out.telemetry?.rejectionReasons)}`,
  );
  assert.equal(gateRejected, 1, `only the control LOW may be gate-rejected; got ${gateRejected}`);
});

// Production call site: combination-itinerary-integrity.ts offeredPinnedPool (replan / cache drift).
await test("Replan offered-pin pool keeps same verdict as Chat when offered place carries hours", () => {
  const offered = [
    {
      id: 1,
      title: GENERAL_COMBO.title,
      places: [P_HOURS, P_LOW].map((p) => ({
        name: p.name,
        originalName: p.name,
        googlePlaceId: p.id,
        latitude: p.lat,
        longitude: p.lng,
        types: p.types,
        primaryType: p.primaryType,
        rating: p.rating,
        regularOpeningHours: p.regularOpeningHours,
      })),
    },
  ];
  clearCombinationPoolMemo();
  const identity = createOfferedCombinationIdentity(DESTINATION, offered);
  const [pool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DESTINATION, [1], { forceRefresh: true }),
  );
  const ids = pool.all.map((c) => c.googlePlaceId);
  assert.ok(!ids.includes(P_LOW.id), "control LOW kept in replan pool");
  assert.ok(
    ids.includes(P_HOURS.id),
    `place with hours dropped from replan pool; ids=${JSON.stringify(ids)}`,
  );
});

// OBSERVATION (no assertion): enrich-roamie-places.server.ts enrichItinerary runs
// isRecommendablePlace(itineraryToRecommendableInput(item), "plan_trip") on AI itinerary stops,
// which can be user-selected / required places, without touristQualityProtection and without
// the hours it just looked up. Logged so the assigner can decide whether C4 needs wiring there.
await test("OBSERVE plan_trip (enrichItinerary) gate verdict for a selected marker-type 跡 stop", async () => {
  const { itineraryToRecommendableInput } = await import("../src/lib/is-recommendable-place");
  const item = {
    placeName: P_LOW.name,
    title: "historical_landmark",
    googlePlaceId: P_LOW.id,
    placeType: "historical_landmark",
    rating: 4.6,
    userRatingCount: 500,
  };
  const avail = { businessStatus: "OPERATIONAL", openStatus: "open" };
  const low = isRecommendablePlace(itineraryToRecommendableInput(item, avail), "plan_trip", {
    logDrop: false,
  });
  const neutral = isRecommendablePlace(
    itineraryToRecommendableInput({ ...item, placeName: "霧岬旧船番所" }, avail),
    "plan_trip",
    { logDrop: false },
  );
  console.log(
    `OBSERVE plan_trip selected-stop: name=${item.placeName} ok=${low.ok} reason=${low.reason ?? ""} | same stop without 跡 suffix ok=${neutral.ok} reason=${neutral.reason ?? ""}`,
  );
});

// Assigner ruling (round 2): a name ending in 「史跡」 (designated historic site) is NOT a D2
// old-site marker; 「遺跡」「〜跡」「跡地」「址」「遺址」 still are. Fictional names only.
await test("〜史跡 + historical_landmark only + no hours → INSUFFICIENT_EVIDENCE (not LOW, no D2)", async () => {
  const { touristQualityDecision } = await import("../src/lib/tourist-quality-gate");
  const p = fx("SHISEKI", "霧岬藩陣屋史跡", ["historical_landmark"]);
  const a = classifyTouristQuality(gateInputOf(p));
  assert.equal(a.tier, "INSUFFICIENT_EVIDENCE", `tier=${a.tier} evidence=${a.evidence}`);
  assert.ok(!a.evidence.includes("name:former_site_marker"), `史跡 hit D2: ${a.evidence}`);
  assert.ok(a.evidence.includes("type:marker_only"), `D1 expected: ${a.evidence}`);
  const d = touristQualityDecision(gateInputOf(p), { intent: "general_sightseeing" });
  assert.equal(d.admit, true);
  const chat = isRecommendablePlace(
    placeResultToRecommendableInput(p),
    "chat_destination_recommend",
    { logDrop: false },
  );
  assert.doesNotMatch(chat.reason ?? "", GATE_REASON_RE, `chat reason=${chat.reason}`);
});

await test("control: 〜遺跡 / 〜城跡 / 〜跡地 / 〜址 / 〜遺址 still hit D2 (→ LOW with marker-only type)", () => {
  const names = ["霧岬東遺跡", "霧岬城跡", "霧岬旧代官所跡地", "霧岬窯址", "霧岬古窯遺址"];
  for (const [i, name] of names.entries()) {
    const p = fx(`D2_${i}`, name, ["historical_landmark"]);
    const a = classifyTouristQuality(gateInputOf(p));
    assert.ok(a.evidence.includes("name:former_site_marker"), `${name} missing D2: ${a.evidence}`);
    assert.equal(a.tier, "LOW_EXPERIENCE_VALUE", `${name} tier=${a.tier}`);
  }
});

await test("zero provider calls", () => {
  assert.equal(fetchCalls, 0);
});

if (failures.length) {
  console.log(
    `FAIL tqg v2 evidence parity: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`,
  );
  process.exitCode = 1;
} else {
  console.log(`PASS tqg v2 evidence parity: ${cases} scenarios, provider calls ${fetchCalls}`);
}
