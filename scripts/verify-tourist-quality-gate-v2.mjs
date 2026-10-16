// Tourist Quality Gate V2 — acceptance R1–R36. Offline: synthetic fixtures only.
// Spec: tqg-v2-spec.md (approved 2026-10-14). Do not weaken assertions.
//
// Run: npx vite-node scripts/verify-tourist-quality-gate-v2.mjs --config scripts/vite.verify.config.mjs
//
// Fixture place names are fictional test data (prefixes 雫坂／朧浜／霞丘／霧岬／Velmora／
// Zyntharra／Qorvella). R16(c) asserts none of them appear in the gate module source.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// R36 cost guard: any fetch is a provider call. Installed before any src import.
// ---------------------------------------------------------------------------
let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("tourist quality gate V2 must not call providers");
};

const { isRecommendablePlace, filterRecommendablePlaces } =
  await import("../src/lib/is-recommendable-place");
const { validateCandidateIntent } = await import("../src/lib/ai/combination-candidate-quality");
const { supplementRealPlacesForItinerary } = await import("../src/lib/ai/real-place-supplement");
const {
  resolveSelectedCombinationPools,
  createOfferedCombinationIdentity,
  withOfferedCombinationIdentity,
  clearCombinationPoolMemo,
} = await import("../src/lib/ai/combination-itinerary-integrity");
const { createUnselectedOfferExclusion, resolveSelectedCombinationAuthority } =
  await import("../src/lib/ai/selected-combination-authority");
const { filterRecommendationItemsForDisplay } = await import("../src/lib/recommend-place-ranking");

// Gate module is loaded dynamically so pipeline controls still report when it is missing.
let gate = null;
let gateLoadError = null;
try {
  gate = await import("../src/lib/tourist-quality-gate");
} catch (e) {
  gateLoadError = e;
}
const requireGate = () => {
  if (!gate) {
    throw new Error(
      `src/lib/tourist-quality-gate.ts not loadable: ${gateLoadError?.message?.split("\n")[0] ?? "unknown"}`,
    );
  }
  assert.equal(typeof gate.classifyTouristQuality, "function", "classifyTouristQuality export");
  assert.equal(typeof gate.touristQualityDecision, "function", "touristQualityDecision export");
  return gate;
};
const classify = (input) => requireGate().classifyTouristQuality(input);
const decide = (input, ctx) => requireGate().touristQualityDecision(input, ctx);
const GENERAL = { intent: "general_sightseeing" };
const CULTURAL = { intent: "cultural_exploration" };

// ---------------------------------------------------------------------------
// test harness: every case runs, failures are collected, exit code 1 on any failure.
// ---------------------------------------------------------------------------
let cases = 0;
const failures = [];
const test = async (name, fn) => {
  try {
    await fn();
    cases++;
    console.log("PASS", name);
  } catch (e) {
    failures.push(name);
    const msg = (e?.message ?? String(e)).split("\n").slice(0, 6).join(" | ");
    console.log("FAIL", name, "--", msg);
  }
};

// "可辨識的 reason"：Gate 在整合點的拒絕原因必須能與既有規則區分。
// ASSUMPTION（交接報告已列出）：reason 字串含 tourist_quality 或 low_experience。
const GATE_REASON_RE = /tourist_quality|low_experience/i;

// ---------------------------------------------------------------------------
// Fixtures — fake formal Place IDs, fixed coords inside destination scope.
// ---------------------------------------------------------------------------
const DESTINATION = "霧岬市";
const CENTER = { lat: 35.1, lng: 135.1 };
const HOURS = {
  openNow: true,
  periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
  weekdayDescriptions: ["Monday: 9:00 AM – 5:00 PM"],
};
let seq = 0;
const fx = (key, name, types, extra = {}) => {
  seq++;
  const id = `ChIJ_TQG_${key}`;
  return {
    id,
    placeId: id,
    googlePlaceId: id,
    name,
    address: `${DESTINATION}中央${seq}-1`,
    lat: CENTER.lat + seq * 0.001,
    lng: CENTER.lng + seq * 0.001,
    rating: 4.2,
    userRatingCount: 60,
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
const withHours = (extra = {}) => ({ regularOpeningHours: HOURS, openStatus: "open", ...extra });

const F = {
  // LOW family (D1 marker-only types + D2 site/plaque name, no counter-evidence)
  R1: fx("R1_POSTAL", "雫坂郵便役所跡", ["historical_landmark", "point_of_interest"], {
    rating: 4.1,
    userRatingCount: 40,
  }),
  R1b: fx("R1B_NAMEONLY", "雫坂郵便役所跡", ["point_of_interest", "establishment"], {
    rating: 4.1,
    userRatingCount: 40,
  }),
  R2: fx("R2_KURA", "朧浜藩蔵屋敷跡", ["historical_landmark", "point_of_interest"], {
    rating: 4.5,
    userRatingCount: 300,
  }),
  R2b: fx(
    "R2B_KURA_HOURS",
    "朧浜藩蔵屋敷跡",
    ["historical_landmark", "point_of_interest"],
    withHours({ rating: 4.5, userRatingCount: 300 }),
  ),
  R3: fx("R3_PLAQUE", "雫坂旧街道説明板", ["landmark", "point_of_interest"], {
    rating: 4.0,
    userRatingCount: 30,
  }),
  R13: fx("R13_DAIKAN", "霞丘代官所跡", ["historical_landmark", "point_of_interest"], {
    rating: 4.8,
    userRatingCount: 2000,
  }),
  R15: fx("R15_POST", "霞丘旧道標柱", ["landmark", "point_of_interest"], {
    rating: 4.3,
    userRatingCount: 10000,
  }),
  R16a: fx(
    "R16A_NOVEL",
    "Site of former Zyntharra Ferry Office",
    ["historical_landmark", "point_of_interest"],
    { rating: 4.4, userRatingCount: 120 },
  ),
  // LOW that every pre-existing rule admits (travel-friendly name, high rating, no open requirement).
  LOW_PARK: fx(
    "LOW_PARKSIDE",
    "Site of former Velmora Parkside Mill",
    ["historical_landmark", "point_of_interest", "establishment"],
    { rating: 4.6, userRatingCount: 500 },
  ),
  // VISIT_WORTHY family
  R4: fx(
    "R4_CASTLE",
    "霞丘城跡",
    ["historical_landmark", "park", "tourist_attraction"],
    withHours(),
  ),
  R5: fx("R5_SHISEKI_PARK", "霞丘史跡公園", ["park", "historical_landmark"]),
  R6: fx("R6_SHRINE", "朧浜八幡神社", ["shinto_shrine", "place_of_worship"]),
  R7: fx(
    "R7_MUSEUM",
    "朧浜歴史博物館",
    ["museum"],
    withHours({ rating: 4.6, userRatingCount: 800 }),
  ),
  R7b: fx("R7B_MUSEUM_NOHOURS", "雫坂郷土資料館", ["museum"]),
  R8: fx("R8_HIST_HOUSE", "朧浜旧領主邸", ["historical_place", "tourist_attraction"], withHours()),
  R9: fx("R9_STELE", "雫坂開拓之碑", ["tourist_attraction", "monument"], {
    rating: 4.2,
    userRatingCount: 90,
  }),
  R10a: fx("R10A_MEMORIAL", "霞丘平和記念塔", ["monument", "tourist_attraction"]),
  R10b: fx("R10B_MEMORIAL_HALL", "霞丘平和記念館", ["monument"], withHours()),
  R14: fx("R14_LOWRATED_MUSEUM", "朧浜民俗館", ["museum"], { rating: 3.2, userRatingCount: 8 }),
  // INSUFFICIENT family
  R5b: fx("R5B_FORMER_MUSEUM", "旧朧浜美術館跡", ["museum"], { rating: 4.4, userRatingCount: 60 }),
  R6b: fx("R6B_FORMER_TEMPLE", "雫坂寺跡地", ["buddhist_temple", "place_of_worship"]),
  R11a: fx("R11A_ATO", "雫坂番所跡", ["point_of_interest", "establishment"]),
  R11b: fx("R11B_HI", "霞丘開拓碑", ["point_of_interest", "establishment"]),
  R11c: fx("R11C_SHISEKI", "朧浜史跡", ["point_of_interest", "establishment"]),
  R12poi: fx("R12_POI", "雫坂ポイント", ["point_of_interest"]),
  R12cafe: fx("R12_CAFE", "朧浜珈琲", ["cafe"], { rating: 4.6, userRatingCount: 200 }),
  R16b: fx("R16B_TYPEONLY", "Qorvella Corner", ["historical_landmark"]),
  // INSUFFICIENT that pre-existing rules admit (name-only D2 + travel-friendly name).
  INS_PARK: fx(
    "INS_PARKSIDE",
    "Site of former Velmora Parkside Kiln",
    ["point_of_interest", "establishment"],
    { rating: 4.5, userRatingCount: 300 },
  ),
};

const LOW_KEYS = ["R1", "R2", "R3", "R13", "R15", "R16a", "LOW_PARK"];
const VISIT_KEYS = ["R4", "R5", "R6", "R7", "R7b", "R8", "R9", "R10a", "R10b", "R14"];
const INSUFF_KEYS = [
  "R1b",
  "R5b",
  "R6b",
  "R11a",
  "R11b",
  "R11c",
  "R12poi",
  "R12cafe",
  "R16b",
  "INS_PARK",
  "R2b",
];

const ALL_PLACE_NAMES = [...new Set(Object.values(F).map((p) => p.name))];
const FIXTURE_PROPER_NOUNS = ["雫坂", "朧浜", "霞丘", "霧岬", "Velmora", "Zyntharra", "Qorvella"];

const gateInput = (p) => ({
  name: p.name,
  primaryType: p.primaryType,
  types: p.types,
  rating: p.rating,
  userRatingCount: p.userRatingCount,
  regularOpeningHours: p.regularOpeningHours,
  currentOpeningHours: p.currentOpeningHours,
  reviewEvidence: p.reviewEvidence,
});
const tierOf = (key) => classify(gateInput(F[key])).tier;

const candidateInput = (p) => ({
  name: p.name,
  types: p.types,
  primaryType: p.primaryType,
  address: p.address,
  lat: p.lat,
  lng: p.lng,
  rating: p.rating,
  googlePlaceId: p.id,
  // Not part of CandidateIntentInput today; passed so the same evidence reaches the gate (R34).
  userRatingCount: p.userRatingCount,
  regularOpeningHours: p.regularOpeningHours,
  currentOpeningHours: p.currentOpeningHours,
  reviewEvidence: p.reviewEvidence,
});

const GENERAL_COMBO = { title: "城市景點漫遊", theme: "attraction" };
const CULTURE_COMBO = { title: "藝文博物館巡禮", theme: "culture" };
const vci = (p, combo = GENERAL_COMBO) =>
  validateCandidateIntent(candidateInput(p), combo, DESTINATION, {
    center: CENTER,
    requireTourismType: true,
    source: "tqg_v2_verify",
  });

// Tourist-relevant isRecommendablePlace entries. LOW fixtures carry no open data, so only
// contexts that do not require a confirmed open state are used for "Gate must reject" checks.
const ENTRIES = {
  chat: (p) => isRecommendablePlace(p, "chat_destination_recommend", { logDrop: false }),
  explore_city: (p) => isRecommendablePlace(p, "explore_map_city", { logDrop: false }),
  home_nearby: (p) =>
    isRecommendablePlace(p, "home_nearby", { logDrop: false, homeNearbyTier: "operational_only" }),
  ai_recommend: (p) =>
    isRecommendablePlace(p, "ai_recommend", { logDrop: false, requireOpenNow: false }),
};
const runEntries = (p) => Object.fromEntries(Object.entries(ENTRIES).map(([k, fn]) => [k, fn(p)]));

const clone = (v) => JSON.parse(JSON.stringify(v));
const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

// Fake Places search for Refill (injected PlaceSearchFn, not a provider).
const makeSearch = (places) => {
  const calls = { n: 0 };
  const fn = async () => {
    calls.n++;
    return { places: places.map((p) => clone(p)), error: null, rawCount: places.length };
  };
  return { fn, calls };
};
const runRefill = (places, opts = {}) => {
  const search = makeSearch(places);
  return supplementRealPlacesForItinerary({
    destination: DESTINATION,
    tripDays: 3,
    existingPlaces: [],
    selectedCombinationIds: [1],
    themes: opts.themes ?? ["attraction"],
    lat: CENTER.lat,
    lng: CENTER.lng,
    locale: "zh-TW",
    searchPlaces: search.fn,
    needed: opts.needed ?? places.length + 2,
  }).then((r) => ({ ...r, searchCalls: search.calls.n }));
};

// Replan/repair pool: offered snapshot → resolveSelectedCombinationPools (cache-drift pin path).
const offeredPlace = (p) => ({
  name: p.name,
  originalName: p.name,
  googlePlaceId: p.id,
  latitude: p.lat,
  longitude: p.lng,
  types: p.types,
  primaryType: p.primaryType,
  rating: p.rating,
});
const resolvePools = (offered, selected, forceRefresh = true) => {
  const identity = createOfferedCombinationIdentity(DESTINATION, offered);
  return withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DESTINATION, selected, { forceRefresh }),
  );
};
const poolIds = (pool) => pool.all.map((c) => c.googlePlaceId);

// ===========================================================================
// Classification / decision layer — R1–R25
// ===========================================================================
await test("R1 old-site marker (postal office 跡) → LOW with type+name evidence; general excludes", () => {
  const a = classify(gateInput(F.R1));
  assert.equal(a.tier, "LOW_EXPERIENCE_VALUE");
  assert.ok(
    Array.isArray(a.evidence) && a.evidence.length >= 2,
    `evidence=${JSON.stringify(a.evidence)}`,
  );
  assert.ok(
    a.evidence.some((c) => /type|d1/i.test(c)),
    `no type-dimension code: ${a.evidence}`,
  );
  assert.ok(
    a.evidence.some((c) => /name|d2/i.test(c)),
    `no name-dimension code: ${a.evidence}`,
  );
  const d = decide(gateInput(F.R1), GENERAL);
  assert.equal(d.admit, false);
  assert.equal(d.tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(typeof d.reason, "string");
  assert.ok(d.reason.length > 0);
});

await test("R1b same name, generic POI types only → INSUFFICIENT_EVIDENCE", () => {
  assert.equal(tierOf("R1b"), "INSUFFICIENT_EVIDENCE");
});

await test("R2 kura-yashiki 跡 rated 4.5/300 → LOW; rating/review count never changes tier", () => {
  assert.equal(tierOf("R2"), "LOW_EXPERIENCE_VALUE");
  for (const [rating, userRatingCount] of [
    [1.0, 0],
    [5.0, 99999],
    [null, null],
  ]) {
    assert.equal(
      classify({ ...gateInput(F.R2), rating, userRatingCount }).tier,
      "LOW_EXPERIENCE_VALUE",
      `rating=${rating} reviews=${userRatingCount}`,
    );
  }
  // C2 across every fixture: rating / review count are not evidence.
  for (const key of Object.keys(F)) {
    const base = tierOf(key);
    for (const [rating, userRatingCount] of [
      [1.0, 0],
      [5.0, 99999],
      [null, null],
    ]) {
      assert.equal(
        classify({ ...gateInput(F[key]), rating, userRatingCount }).tier,
        base,
        `${key} tier moved with rating=${rating} reviews=${userRatingCount}`,
      );
    }
  }
});

await test("R2b same as R2 but with opening hours → not LOW", () => {
  assert.notEqual(tierOf("R2b"), "LOW_EXPERIENCE_VALUE");
  assert.notEqual(
    classify({ ...gateInput(F.R2), regularOpeningHours: undefined, currentOpeningHours: HOURS })
      .tier,
    "LOW_EXPERIENCE_VALUE",
    "currentOpeningHours is also counter-evidence",
  );
});

await test("R3 explanatory plaque (説明板, landmark) → LOW", () => {
  assert.equal(tierOf("R3"), "LOW_EXPERIENCE_VALUE");
});

await test("R4 visitable castle ruins (城跡 + park/tourist_attraction + hours) → VISIT_WORTHY", () => {
  assert.equal(tierOf("R4"), "VISIT_WORTHY");
});

await test("R5 historic-site park (史跡公園, park) → VISIT_WORTHY", () => {
  assert.equal(tierOf("R5"), "VISIT_WORTHY");
});

await test("R5b former museum site (旧〜美術館跡, museum, no hours) → INSUFFICIENT_EVIDENCE", () => {
  const t = tierOf("R5b");
  assert.notEqual(t, "VISIT_WORTHY");
  assert.notEqual(t, "LOW_EXPERIENCE_VALUE");
  assert.equal(t, "INSUFFICIENT_EVIDENCE");
});

await test("R6 shrine (shinto_shrine, place_of_worship) → VISIT_WORTHY", () => {
  assert.equal(tierOf("R6"), "VISIT_WORTHY");
});

await test("R6b former temple site (寺跡地, buddhist_temple, no hours) → INSUFFICIENT_EVIDENCE", () => {
  assert.equal(tierOf("R6b"), "INSUFFICIENT_EVIDENCE");
});

await test("R7 museum with hours → VISIT_WORTHY", () => {
  assert.equal(tierOf("R7"), "VISIT_WORTHY");
});

await test("R7b museum without hours, neutral name → VISIT_WORTHY", () => {
  assert.equal(tierOf("R7b"), "VISIT_WORTHY");
});

await test("R8 historical_place + tourist_attraction with hours → VISIT_WORTHY", () => {
  assert.equal(tierOf("R8"), "VISIT_WORTHY");
});

await test("R9 stele (碑) with tourist_attraction + monument → VISIT_WORTHY", () => {
  assert.equal(tierOf("R9"), "VISIT_WORTHY");
});

await test("R10 memorial (monument+tourist_attraction; monument with hours) → VISIT_WORTHY", () => {
  assert.equal(tierOf("R10a"), "VISIT_WORTHY");
  assert.equal(tierOf("R10b"), "VISIT_WORTHY");
});

await test("R11 跡/碑/史跡 names with generic POI types → INSUFFICIENT; general admits", () => {
  for (const key of ["R11a", "R11b", "R11c"]) {
    assert.equal(tierOf(key), "INSUFFICIENT_EVIDENCE", key);
    assert.equal(decide(gateInput(F[key]), GENERAL).admit, true, key);
  }
});

await test("R12 sparse POI and cafe → INSUFFICIENT (non-tourist never LOW)", () => {
  assert.equal(tierOf("R12poi"), "INSUFFICIENT_EVIDENCE");
  assert.equal(tierOf("R12cafe"), "INSUFFICIENT_EVIDENCE");
});

await test("R13 high rating (4.8/2000) but no experience → LOW", () => {
  assert.equal(tierOf("R13"), "LOW_EXPERIENCE_VALUE");
});

await test("R14 low rating (3.2/8) museum → classification VISIT_WORTHY", () => {
  assert.equal(tierOf("R14"), "VISIT_WORTHY");
});

await test("R15 plaque evidence with 10000 reviews → LOW", () => {
  assert.equal(tierOf("R15"), "LOW_EXPERIENCE_VALUE");
});

await test("R16 no blacklist: novel name same tier as R1; type-only → INSUFFICIENT; source has no place names", () => {
  assert.equal(tierOf("R16a"), tierOf("R1"));
  assert.equal(tierOf("R16a"), "LOW_EXPERIENCE_VALUE");
  assert.equal(tierOf("R16b"), "INSUFFICIENT_EVIDENCE");
  // (c) source scan
  const src = fs.readFileSync(
    new URL("../src/lib/tourist-quality-gate.ts", import.meta.url),
    "utf8",
  );
  for (const name of [...ALL_PLACE_NAMES, ...FIXTURE_PROPER_NOUNS]) {
    assert.ok(!src.includes(name), `gate source contains fixture place name: ${name}`);
  }
});

await test("R17 cultural intent admits LOW with cultural type evidence; tier stays LOW", () => {
  const a = classify(gateInput(F.R1));
  assert.equal(a.culturalEvidence, true);
  const d = decide(gateInput(F.R1), CULTURAL);
  assert.equal(d.admit, true);
  assert.equal(d.tier, "LOW_EXPERIENCE_VALUE");
});

await test("R18 cultural intent still excludes LOW without cultural type evidence (landmark plaque)", () => {
  assert.equal(classify(gateInput(F.R3)).culturalEvidence, false);
  const d = decide(gateInput(F.R3), CULTURAL);
  assert.equal(d.tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(d.admit, false);
});

await test("R19 intent switch on same place: no cached carry-over", () => {
  const input = gateInput(F.R1);
  const seqOut = [GENERAL, CULTURAL, GENERAL, CULTURAL, CULTURAL, GENERAL].map(
    (ctx) => decide(input, ctx).admit,
  );
  assert.deepEqual(seqOut, [false, true, false, true, true, false]);
  // Same through the itinerary entry (validateCandidateIntent): general → culture → general.
  const viaVci = [GENERAL_COMBO, CULTURE_COMBO, GENERAL_COMBO].map((c) => vci(F.R1, c).ok);
  assert.deepEqual(viaVci, [false, true, false]);
});

await test("R20 INSUFFICIENT under general sightseeing is admitted", () => {
  for (const key of ["R11a", "R11b", "R11c", "R12poi", "R12cafe"]) {
    const d = decide(gateInput(F[key]), GENERAL);
    assert.equal(d.tier, "INSUFFICIENT_EVIDENCE", key);
    assert.equal(d.admit, true, key);
  }
});

for (const [rid, protection] of [
  ["R21", "explicit"],
  ["R22", "required"],
  ["R23", "locked"],
]) {
  await test(`${rid} protection=${protection} admits LOW (general and cultural)`, () => {
    for (const ctx of [GENERAL, CULTURAL]) {
      const d = decide(gateInput(F.R1), { ...ctx, protection });
      assert.equal(d.admit, true);
      assert.equal(d.tier, "LOW_EXPERIENCE_VALUE");
    }
    const plaque = decide(gateInput(F.R3), { ...CULTURAL, protection });
    assert.equal(plaque.admit, true);
  });
}

await test("R24 selected_only with all-LOW selection admits every place", () => {
  const out = ["R1", "R3", "R13"].map((k) =>
    decide(gateInput(F[k]), { ...GENERAL, protection: "selected_only" }),
  );
  assert.deepEqual(
    out.map((d) => d.admit),
    [true, true, true],
  );
  assert.deepEqual(
    out.map((d) => d.tier),
    Array(3).fill("LOW_EXPERIENCE_VALUE"),
  );
});

await test("R25 higher-priority contracts still apply to explicitly chosen LOW", () => {
  // Existing eligibility keeps its own reasons (Gate does not override them).
  const closed = { ...F.R1, businessStatus: "CLOSED_PERMANENTLY" };
  for (const fn of Object.values(ENTRIES)) assert.equal(fn(closed).reason, "non_operational");
  const noId = { ...F.R1, id: "", placeId: "", googlePlaceId: "" };
  assert.equal(ENTRIES.chat(noId).reason, "missing_place_id");
  assert.equal(ENTRIES.ai_recommend(noId).reason, "missing_place_id");
  const far = { ...F.R1, address: "遠方県某所1-1", lat: CENTER.lat + 2, lng: CENTER.lng + 2 };
  const r = vci(far);
  assert.equal(r.ok, false);
  assert.match(r.reason, /^outside_destination/);
  // Gate itself admits the same place under protection (it only removes LOW when unprotected).
  for (const protection of ["explicit", "required", "locked", "selected_only"]) {
    assert.equal(decide(gateInput(closed), { ...GENERAL, protection }).admit, true, protection);
    assert.equal(decide(gateInput(noId), { ...GENERAL, protection }).admit, true, protection);
  }
});

// ===========================================================================
// Pipeline layer — R26–R35
// ===========================================================================
await test("R26 initial candidates/eligibility: isRecommendablePlace + validateCandidateIntent reject LOW", () => {
  // Controls first: VISIT_WORTHY and INSUFFICIENT still pass.
  for (const key of ["R7", "R5b", "INS_PARK", "R12cafe"]) {
    for (const [entry, r] of Object.entries(runEntries(F[key]))) {
      if (entry === "explore_city" && key === "INS_PARK") continue; // existing semantic rule (unproven_visitor_purpose)
      assert.equal(r.ok, true, `control ${key}@${entry} rejected: ${r.reason}`);
    }
  }
  for (const key of ["R7", "R7b", "R5b", "R11a", "INS_PARK"]) {
    const r = vci(F[key]);
    assert.equal(r.ok, true, `control ${key}@validateCandidateIntent rejected: ${r.reason}`);
  }
  // Precondition: these LOW fixtures pass every pre-existing rule, so a rejection proves the Gate.
  for (const key of ["LOW_PARK"]) {
    for (const [entry, r] of Object.entries(runEntries(F[key]))) {
      assert.equal(r.ok, false, `${key}@${entry} admitted LOW`);
      assert.match(r.reason ?? "", GATE_REASON_RE, `${key}@${entry} reason=${r.reason}`);
    }
  }
  // R13 passes the existing city filter (famous-landmark exemption) → Gate must reject it there.
  const city13 = ENTRIES.explore_city(F.R13);
  assert.equal(city13.ok, false, "R13@explore_city admitted LOW");
  assert.match(city13.reason ?? "", GATE_REASON_RE, `R13@explore_city reason=${city13.reason}`);
  // R1/R3/R13 rejected everywhere (some contexts reject earlier via pre-existing rules).
  for (const key of ["R1", "R3", "R13"]) {
    for (const [entry, r] of Object.entries(runEntries(F[key]))) {
      assert.equal(r.ok, false, `${key}@${entry} admitted LOW`);
      assert.ok(r.reason, `${key}@${entry} has no reason`);
    }
  }
  // Combination/itinerary entry: general theme rejects all LOW with a gate reason.
  for (const key of ["R1", "R3", "R13", "LOW_PARK"]) {
    const r = vci(F[key]);
    assert.equal(r.ok, false, `${key}@validateCandidateIntent admitted LOW`);
    assert.match(
      r.reason ?? "",
      GATE_REASON_RE,
      `${key}@validateCandidateIntent reason=${r.reason}`,
    );
  }
});

await test("R27 ranking cannot promote LOW: excluded before ranking/display ordering", () => {
  const items = [
    {
      name: F.LOW_PARK.name,
      type: "historical_landmark",
      primaryType: "historical_landmark",
      types: F.LOW_PARK.types,
      googlePlaceId: F.LOW_PARK.id,
      rating: 5.0,
      userRatingCount: 99999,
      openStatusLabel: "營業中",
    },
    {
      name: F.R7.name,
      type: "museum",
      primaryType: "museum",
      types: ["museum"],
      googlePlaceId: F.R7.id,
      rating: 4.3,
      userRatingCount: 40,
      openStatusLabel: "營業中",
    },
  ];
  const out = filterRecommendationItemsForDisplay(items);
  const ids = out.map((i) => i.googlePlaceId);
  assert.ok(ids.includes(F.R7.id), "VISIT_WORTHY control dropped");
  assert.ok(!ids.includes(F.LOW_PARK.id), "LOW survived into ranked display list");
  // Ranking file modification is checked in R36.
});

await test("R28 selection with spare capacity never selects LOW", () => {
  const pool = ["LOW_PARK", "R13", "R7", "R12cafe", "INS_PARK"].map((k) => F[k]);
  const kept = filterRecommendablePlaces(pool, "chat_destination_recommend", { logDrop: false });
  const ids = kept.map((p) => p.id);
  assert.ok(kept.length < 10, "capacity is not the limiting factor");
  for (const k of ["R7", "R12cafe", "INS_PARK"])
    assert.ok(ids.includes(F[k].id), `control ${k} missing`);
  for (const k of ["LOW_PARK", "R13"]) assert.ok(!ids.includes(F[k].id), `${k} selected`);
});

await test("R29 continuation under culture-themed combination uses cultural_exploration", () => {
  const r1 = vci(F.R1, CULTURE_COMBO);
  assert.equal(r1.ok, true, `R1 (cultural evidence) rejected under culture theme: ${r1.reason}`);
  // Continuation pool for a culture combination (replan pin path).
  clearCombinationPoolMemo();
  const [pool] = resolvePools(
    [
      {
        id: 1,
        title: CULTURE_COMBO.title,
        places: ["R1", "R3", "R7"].map((k) => offeredPlace(F[k])),
      },
    ],
    [1],
  );
  assert.equal(pool.theme, "culture");
  const ids = poolIds(pool);
  assert.ok(ids.includes(F.R1.id), "culture pool dropped R1");
  assert.ok(ids.includes(F.R7.id), "culture pool dropped museum control");
  for (const key of ["R3", "R15"]) {
    const r = vci(F[key], CULTURE_COMBO);
    assert.equal(r.ok, false, `${key} (no cultural type evidence) admitted under culture theme`);
    assert.match(r.reason ?? "", GATE_REASON_RE, `${key} reason=${r.reason}`);
  }
  assert.ok(!ids.includes(F.R3.id), "culture pool kept R3 (LOW without cultural evidence)");
});

await test("R30 refill (supplementRealPlacesForItinerary) never adds LOW", async () => {
  const candidates = ["R1", "R3", "R13", "LOW_PARK", "R7", "R11a", "R5b"].map((k) => F[k]);
  const r = await runRefill(candidates);
  const ids = r.added.map((p) => p.googlePlaceId ?? p.placeId ?? p.id);
  assert.ok(r.searchCalls > 0, "fake search not exercised");
  for (const k of ["R7", "R11a", "R5b"])
    assert.ok(ids.includes(F[k].id), `refill dropped control ${k}`);
  for (const k of ["R1", "R3", "R13", "LOW_PARK"])
    assert.ok(!ids.includes(F[k].id), `refill added LOW ${k}`);
});

await test("R31 replan/repair pool (resolveSelectedCombinationPools) keeps LOW out, same verdict on repeat", () => {
  const offered = [
    {
      id: 1,
      title: GENERAL_COMBO.title,
      places: ["R1", "R13", "LOW_PARK", "R7", "R11a"].map((k) => offeredPlace(F[k])),
    },
  ];
  clearCombinationPoolMemo();
  const first = resolvePools(offered, [1]);
  const second = resolvePools(offered, [1]);
  assert.equal(first[0].theme, "attraction");
  for (const pools of [first, second]) {
    const ids = poolIds(pools[0]);
    for (const k of ["R7", "R11a"]) assert.ok(ids.includes(F[k].id), `pool dropped control ${k}`);
    for (const k of ["R1", "R13", "LOW_PARK"])
      assert.ok(!ids.includes(F[k].id), `pool kept LOW ${k}`);
  }
  assert.deepEqual(poolIds(first[0]), poolIds(second[0]));
  // Same verdict as the first-pass eligibility entry.
  for (const k of ["R1", "R13", "LOW_PARK", "R7", "R11a"]) {
    assert.equal(poolIds(first[0]).includes(F[k].id), vci(F[k]).ok, `${k} replan≠initial`);
  }
});

await test("R32 shortage: keep shortfall, never backfill with LOW; INSUFFICIENT may fill", async () => {
  const r = await runRefill(
    ["R1", "R13", "R3", "R11a"].map((k) => F[k]),
    { needed: 5 },
  );
  const ids = r.added.map((p) => p.googlePlaceId ?? p.placeId ?? p.id);
  assert.ok(ids.includes(F.R11a.id), "INSUFFICIENT candidate not used to fill shortage");
  assert.deepEqual(ids, [F.R11a.id]);
  assert.ok(r.added.length < r.needed, "shortfall must remain visible");
});

await test("R33 in-combination refill / cross-combination isolation unchanged", () => {
  const offered = [
    { id: 1, title: "組合A", places: [offeredPlace(F.R7)] },
    { id: 2, title: "組合B", places: [offeredPlace(F.R6), offeredPlace(F.R4)] },
  ];
  const auth = resolveSelectedCombinationAuthority(
    { selectedCombinationIds: [1], offeredCombinations: offered, selectionSource: "user" },
    DESTINATION,
  );
  assert.equal(auth.ok, true);
  assert.deepEqual(auth.selectedPlaceIds, [F.R7.id]);
  assert.ok(auth.allowlist.exclusiveExcludedPlaceNames.includes(F.R6.name));
  const excluded = createUnselectedOfferExclusion(
    [1],
    offered,
    auth.allowlist.exclusiveExcludedPlaceNames,
  );
  assert.equal(excluded({ googlePlaceId: F.R6.id, name: F.R6.name }), true, "borrowed from B");
  assert.equal(excluded({ googlePlaceId: F.R4.id, name: F.R4.name }), true, "borrowed from B");
  assert.equal(
    excluded({ googlePlaceId: F.R7.id, name: F.R7.name }),
    false,
    "A's own place excluded",
  );
  // A's own LOW candidate must still be gated (not protected by isolation).
  assert.equal(vci(F.R1).ok, false);
});

await test("R34 cross-entry: one classification, consistent eligibility per tier", () => {
  const keys = ["R1", "R3", "R13", "LOW_PARK", "R2b", "R5b", "R7", "R12cafe", "INS_PARK"];
  for (const key of keys) {
    const p = F[key];
    const a1 = classify(gateInput(p));
    const a2 = classify(clone(gateInput(p)));
    assert.deepEqual(a1, a2, `${key} classification not deterministic`);
    const results = { ...runEntries(p), itinerary: vci(p) };
    for (const [entry, r] of Object.entries(results)) {
      if (a1.tier === "LOW_EXPERIENCE_VALUE") {
        assert.equal(r.ok, false, `${key} (LOW) admitted at ${entry}`);
      } else {
        assert.doesNotMatch(
          r.reason ?? "",
          GATE_REASON_RE,
          `${key} (${a1.tier}) gate-rejected at ${entry}`,
        );
      }
    }
  }
  // Spec §2: Explore city filter must drop its own name-keyword (碑／跡／史跡) and pure
  // rating/review-count heuristics in favour of the shared classification.
  const stele = F.R9; // 碑 name, tourist_attraction + monument → VISIT_WORTHY
  assert.equal(classify(gateInput(stele)).tier, "VISIT_WORTHY");
  const city9 = ENTRIES.explore_city(stele);
  assert.equal(city9.ok, true, `explore_city rejected VISIT_WORTHY 碑: ${city9.reason}`);
  const modestMemorial = { ...F.R10b, rating: 3.9, userRatingCount: 12 }; // monument + hours
  assert.equal(classify(gateInput(modestMemorial)).tier, "VISIT_WORTHY");
  const cityMem = ENTRIES.explore_city(modestMemorial);
  assert.equal(
    cityMem.ok,
    true,
    `explore_city rejected VISIT_WORTHY memorial by rating heuristic: ${cityMem.reason}`,
  );
});

await test("R35 identity/scope: ids ⊆ input, ids/coords/destination unmodified, no synthetic places", async () => {
  // Eligibility entries do not mutate (frozen inputs would throw on write).
  for (const key of Object.keys(F)) {
    const p = deepFreeze(clone(F[key]));
    const before = clone(p);
    for (const fn of Object.values(ENTRIES)) fn(p);
    validateCandidateIntent(deepFreeze(candidateInput(p)), GENERAL_COMBO, DESTINATION, {
      center: CENTER,
    });
    assert.deepEqual(p, before, key);
  }
  // Refill output.
  const input = ["R1", "R7", "R11a", "R5b", "LOW_PARK"].map((k) => F[k]);
  const r = await runRefill(input);
  const byId = new Map(input.map((p) => [p.id, p]));
  for (const item of r.added) {
    const id = item.googlePlaceId ?? item.placeId ?? item.id;
    assert.ok(byId.has(id), `refill produced unknown id ${id}`);
    const src = byId.get(id);
    assert.equal(item.lat, src.lat);
    assert.equal(item.lng, src.lng);
  }
  // Replan pool output.
  clearCombinationPoolMemo();
  const offeredSrc = ["R1", "R7", "R11a"].map((k) => F[k]);
  const [pool] = resolvePools(
    [{ id: 1, title: GENERAL_COMBO.title, places: offeredSrc.map(offeredPlace) }],
    [1],
  );
  const srcById = new Map(offeredSrc.map((p) => [p.id, p]));
  for (const c of pool.all) {
    assert.ok(srcById.has(c.googlePlaceId), `pool produced unknown id ${c.googlePlaceId}`);
    assert.deepEqual(c.coordinates, {
      lat: srcById.get(c.googlePlaceId).lat,
      lng: srcById.get(c.googlePlaceId).lng,
    });
  }
  assert.equal(DESTINATION, "霧岬市");
  // Gate layer: pure, no mutation, never emits identity/coordinates (cannot synthesize places).
  for (const key of Object.keys(F)) {
    const p = deepFreeze(clone(F[key]));
    const before = clone(p);
    const a = classify(deepFreeze(gateInput(p)));
    decide(deepFreeze(gateInput(p)), GENERAL);
    decide(deepFreeze(gateInput(p)), { ...CULTURAL, protection: "explicit" });
    assert.deepEqual(p, before, key);
    for (const field of ["id", "placeId", "googlePlaceId", "lat", "lng", "name"]) {
      assert.ok(!(field in a), `assessment exposes ${field}`);
    }
  }
});

// ===========================================================================
// R36 — cost and protected systems
// ===========================================================================
await test("R36 zero provider calls; protected systems untouched; gate module is pure", () => {
  assert.equal(fetchCalls, 0, `fetch called ${fetchCalls} times`);

  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  // Baseline: branch base commit for TQG V2 (falls back to HEAD if unavailable).
  let base = "4976add";
  try {
    git("rev-parse", "--verify", `${base}^{commit}`);
  } catch {
    base = "HEAD";
  }
  const changed = [
    ...git("diff", "--name-only", base).split("\n"),
    ...git("ls-files", "--others", "--exclude-standard").split("\n"),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  const PROTECTED = [
    /^src\/lib\/[^/]*rank[^/]*\.ts$/i, // ranking files (recommend-place-ranking, home-*-ranking, …)
    /^src\/lib\/ai\/[^/]*rank[^/]*\.ts$/i,
    /^src\/lib\/ai\/(ai-multi-day-planner|time-budget-planner|planner-[^/]+)\.ts$/, // Planner core
    /^src\/lib\/pie\/planner-search\.ts$/,
    /^src\/lib\/ai\/daily-[^/]+\.ts$/, // Daily Balance
    /diversity/i, // Diversity
    /^src\/lib\/credits\//, // Credits
    /(^|\/)(auth|oauth)[^/]*\.(ts|tsx)$|\/auth\//i, // Auth
    /budget/i, // Budget
    /plus/i, // Plus
    /^src\/lib\/build-place-recommendation-reason\.ts$/, // Reason V2
    /^src\/lib\/(place-reason[^/]*|place-review-evidence|reason-personalization-store)\.ts$/,
    /^package(-lock)?\.json$/,
  ];
  const touched = changed
    .filter((f) => f.startsWith("src/") || f.startsWith("package"))
    .filter((f) => !/\.test\.tsx?$/.test(f) && PROTECTED.some((re) => re.test(f)));
  assert.deepEqual(touched, [], `protected files modified: ${touched.join(", ")}`);

  const src = fs.readFileSync(
    new URL("../src/lib/tourist-quality-gate.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(src, /\bfetch\s*\(/, "gate module calls fetch");
  assert.doesNotMatch(
    src,
    /from\s+["'][^"']*(\.server|\.functions|openai|anthropic|gemini|places-api|supabase|ai-client|provider)[^"']*["']/i,
    "gate module imports a provider/server module",
  );
  assert.equal(fetchCalls, 0, `fetch called ${fetchCalls} times`);
});

// ---------------------------------------------------------------------------
if (gateLoadError)
  console.log("NOTE gate module load error:", gateLoadError.message.split("\n")[0]);
if (failures.length) {
  console.log(
    `FAIL tourist quality gate V2: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`,
  );
  console.log(`FAILED: ${failures.map((n) => n.split(" ")[0]).join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`PASS tourist quality gate V2: ${cases} scenarios, provider calls ${fetchCalls}`);
}
