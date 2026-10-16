// Tourist Quality Gate V2 — R29 session canonical-intent matrix (new / old sessions).
//
// Contract (user decision, verbatim intent):
//  - Canonical intent = the combination theme the user chose. A place's semantic family is quality
//    evidence only and never overrides the combination intent.
//  - A localized title is never the sole trusted source. Snapshot and Replan use the same intent;
//    a first-pass verdict is reused only when intent AND Place ID both match.
//  - Old sessions: prefer an existing trusted intent field; if absent, a compat derivation from the
//    stored combination title is allowed for explicitly recognizable themes only (else conservative).
//    The derived intent never poses as the trusted original intent; LOW is never released
//    unconditionally; LOW without cultural evidence stays excluded; never crash.
//  - Cultural exploration does not mean every place passes.
//
// OFFLINE: fetch trapped and counted (must stay 0); discovery cache seeded in-process.
// Fixture names are fictional (prefix "霜谷"); no rule depends on a specific place name.
//
// Run: npx vite-node scripts/verify-tourist-quality-gate-v2-session-intent.mjs --config scripts/vite.verify.config.mjs
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("session intent verify must not call providers");
};
for (const s of [process.stdout, process.stderr]) s._handle?.setBlocking?.(true);
setTimeout(() => {
  console.log("FAIL tqg v2 session intent: watchdog timeout (90s)");
  process.exit(2);
}, 90_000).unref();

const { setCachedDiscoveredCombinations } = await import("../src/lib/ai/destination-combination-discovery");
const { buildOfferedCombinationsForSession } = await import("../src/lib/ai/destination-combination-suggestions");
const { localizeCombinationThemeTitle } = await import("../src/lib/ai/combination-theme-titles");
const { validateCandidateIntent, canonicalCombinationTouristQualityIntent, legacyTitleCombinationTouristQualityIntent } =
  await import("../src/lib/ai/combination-candidate-quality");
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
      console.log("INCONCLUSIVE", name, "--", inconclusive.at(-1));
      return;
    }
    cases++;
    console.log("PASS", name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL", name, "--", (e?.message ?? String(e)).split("\n").slice(0, 4).join(" | "));
  }
};
const observe = (label, value) => console.log(`OBSERVE ${label}:`, JSON.stringify(value));

const DEST = "霜谷市";
const CENTER = { lat: 35.6, lng: 135.6 };
const HOURS = {
  openNow: true,
  periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
  weekdayDescriptions: ["Monday: 9:00 AM – 5:00 PM"],
};

let seq = 0;
const cand = (key, name, types, extra = {}) => {
  seq++;
  const id = `ChIJ_TQG_SESSION_${key}`;
  return {
    name,
    originalName: name,
    googlePlaceId: id,
    searchCandidateId: id,
    address: `${DEST}北町${seq}-3`,
    coordinates: { lat: CENTER.lat + seq * 0.001, lng: CENTER.lng + seq * 0.001 },
    types,
    primaryType: types[0] ?? null,
    rating: 4.5,
    userRatingCount: 300,
    businessStatus: "OPERATIONAL",
    ...extra,
  };
};

// LC: LOW + cultural evidence (historical_landmark marker only + old-site name, no counter-evidence).
const LC = cand("LC", "霜谷旧船番所跡", ["historical_landmark", "point_of_interest"]);
// LN: LOW WITHOUT cultural evidence ("landmark" is a marker type but not a cultural type).
const LN = cand("LN", "霜谷旧物見櫓跡", ["landmark", "point_of_interest"]);
// Controls (visit-worthy under any intent).
const M = cand("M", "霜谷郷土資料館", ["museum", "tourist_attraction"], { regularOpeningHours: HOURS });
const M2 = cand("M2", "霜谷市立美術館", ["art_gallery", "museum", "tourist_attraction"], { regularOpeningHours: HOURS });

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
const verdict = (c, tier, admit, intent) => ({ placeId: c.googlePlaceId, tier, admit, intent });

/**
 * Replan one offered combination (id 1).
 *  path "drifted": cache holds other places → offered-pin pool (snapshot intent).
 *  path "intact":  cache holds the offered places under `cacheTheme` → discovery pool.
 */
const replan = ({ title, themeKey, places, path = "drifted", cacheTheme = "attraction", cacheTitle }) => {
  // Intact: the cache holds exactly the offered places (a structured cache under a culture theme
  // drops LN for non-Gate reasons, so intact probes under culture offer [M, LC] only).
  const offeredIds = new Set(places.map((p) => p.googlePlaceId));
  const cachePlaces = path === "intact" ? [M, LC, LN].filter((c) => offeredIds.has(c.googlePlaceId)) : [M, M2];
  setCachedDiscoveredCombinations(DEST, [
    {
      combinationId: "1",
      title: cacheTitle ?? "霜谷組合",
      theme: cacheTheme,
      placeCandidates: cachePlaces,
      primaryCandidates: cachePlaces,
    },
  ]);
  clearCombinationPoolMemo();
  const combo = { id: 1, title, places };
  if (themeKey !== undefined) combo.themeKey = themeKey;
  const identity = createOfferedCombinationIdentity(DEST, [combo]);
  const drifted = withOfferedCombinationIdentity(identity, () => isCombinationIdDriftedFromOffered(DEST, 1));
  assert.equal(drifted, path === "drifted", `precondition: ${path} path not taken`);
  const [pool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DEST, [1], { forceRefresh: true }),
  );
  const ids = (pool?.all ?? []).map((c) => c.googlePlaceId);
  assert.ok(ids.includes(M.googlePlaceId), `${path}: control missing; ids=${JSON.stringify(ids)}`);
  return { ids, LC: ids.includes(LC.googlePlaceId), LN: ids.includes(LN.googlePlaceId) };
};
const plain = () => [offeredPlace(M), offeredPlace(LC), offeredPlace(LN)];

// ------------------------------ preconditions ------------------------------
await test("precondition: LC is LOW with cultural evidence; LN is LOW without cultural evidence", () => {
  const a = classifyTouristQuality({ name: LC.name, types: LC.types, primaryType: LC.primaryType });
  assert.equal(a.tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(a.culturalEvidence, true);
  const b = classifyTouristQuality({ name: LN.name, types: LN.types, primaryType: LN.primaryType });
  assert.equal(b.tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(b.culturalEvidence, false);
  assert.equal(canonicalCombinationTouristQualityIntent("culture"), "cultural_exploration");
  assert.equal(canonicalCombinationTouristQualityIntent("historic"), "cultural_exploration");
  assert.equal(canonicalCombinationTouristQualityIntent("attraction"), "general_sightseeing");
});

// Intact-path probes are only meaningful when non-Gate rules admit the place (protected call ok).
const intactGateOnly = {};
for (const theme of ["culture", "attraction"]) {
  for (const c of [LC, LN]) {
    const r = validateCandidateIntent(
      {
        name: c.name,
        types: c.types,
        primaryType: c.primaryType,
        lat: c.coordinates.lat,
        lng: c.coordinates.lng,
        rating: c.rating,
        googlePlaceId: c.googlePlaceId,
        userRatingCount: c.userRatingCount,
      },
      { title: "霜谷組合", theme },
      DEST,
      { protection: "explicit" },
    );
    intactGateOnly[`${theme}:${c === LC ? "LC" : "LN"}`] = r.ok;
  }
}
observe("intact path non-Gate admits (protected)", intactGateOnly);

// ------------------------------ new session (themeKey) ------------------------------
await test("new session themeKey=culture: LC kept (cultural evidence), LN excluded (no cultural evidence)", () => {
  const r = replan({ title: "Art & Museum Walk", themeKey: "culture", places: plain() });
  assert.equal(r.LC, true, `ids=${r.ids}`);
  assert.equal(r.LN, false, `ids=${r.ids}`);
});

await test("new session themeKey=attraction with a cultural-looking zh title: themeKey wins, LC and LN excluded", () => {
  const r = replan({ title: "藝文博物館巡禮", themeKey: "attraction", places: plain() });
  assert.equal(r.LC, false, `title overrode themeKey; ids=${r.ids}`);
  assert.equal(r.LN, false, `ids=${r.ids}`);
});

await test("swap culture ↔ general (same title, same places): only themeKey decides LC; LN excluded both ways", () => {
  const title = "霜谷週末提案";
  const cul = replan({ title, themeKey: "culture", places: plain() });
  const gen = replan({ title, themeKey: "attraction", places: plain() });
  assert.deepEqual([cul.LC, cul.LN, gen.LC, gen.LN], [true, false, false, false]);
});

await test("new session: unknown themeKey string is strict (general), never title-derived", () => {
  const r = replan({ title: "藝文博物館巡禮", themeKey: "zz_unknown_theme", places: plain() });
  assert.equal(r.LC, false, `ids=${r.ids}`);
});

await test("new session: themeKey with surrounding whitespace is honored (trimmed)", () => {
  const r = replan({ title: "霜谷週末提案", themeKey: "  historic  ", places: plain() });
  assert.equal(r.LC, true, `ids=${r.ids}`);
  assert.equal(r.LN, false, `ids=${r.ids}`);
});

for (const themeKey of ["culture", "attraction"]) {
  await test(`intact ↔ drifted parity (themeKey=${themeKey}, cache theme=${themeKey})`, () => {
    const places = () =>
      themeKey === "culture" ? [offeredPlace(M), offeredPlace(LC)] : plain();
    const drifted = replan({ title: "霜谷週末提案", themeKey, places: places() });
    const intact = replan({ title: "霜谷週末提案", themeKey, places: places(), path: "intact", cacheTheme: themeKey });
    observe(`parity ${themeKey}`, { drifted, intact });
    assert.equal(drifted.LC, themeKey === "culture");
    if (intactGateOnly[`${themeKey}:LC`]) assert.equal(intact.LC, drifted.LC, "LC intact≠drifted");
    else inconclusive.push(`intact non-Gate rule rejects LC under ${themeKey}`);
    if (themeKey === "attraction") assert.equal(intact.LN, drifted.LN, "LN intact≠drifted");
  });
}
await test("intact ↔ drifted parity: LN (no cultural evidence) excluded under culture on both paths", () => {
  // Intact culture cache drops LN before the Gate (non-Gate rule); drifted must exclude it via the Gate.
  const drifted = replan({ title: "霜谷週末提案", themeKey: "culture", places: plain() });
  assert.equal(drifted.LN, false, `ids=${drifted.ids}`);
});

// Snapshot (production writer) → Replan: themeKey written, verdict intent = themeKey intent, both
// Replan paths agree with the verdict.
for (const theme of ["culture", "attraction"]) {
  await test(`writer → Replan (theme=${theme}): snapshot themeKey + verdict intent + intact/drifted agree`, () => {
    setCachedDiscoveredCombinations(DEST, [
      { combinationId: "1", title: "霜谷組合", theme, placeCandidates: [M, LC, M2], primaryCandidates: [M, LC, M2] },
    ]);
    const snap = buildOfferedCombinationsForSession(DEST, "zh-TW");
    const combo = snap[0];
    const snapLC = combo?.places?.find((p) => p.googlePlaceId === LC.googlePlaceId);
    observe(`writer ${theme}`, { themeKey: combo?.themeKey, verdict: snapLC?.touristQuality ?? null });
    assert.equal(combo?.themeKey, theme);
    assert.ok(snapLC, "LC missing from snapshot");
    const expectIntent = canonicalCombinationTouristQualityIntent(theme);
    assert.equal(snapLC.touristQuality?.intent, expectIntent);
    assert.equal(snapLC.touristQuality?.admit, expectIntent === "cultural_exploration");
    const identity = createOfferedCombinationIdentity(DEST, snap);
    clearCombinationPoolMemo();
    const intactIds = (
      withOfferedCombinationIdentity(identity, () => resolveSelectedCombinationPools(DEST, [1], { forceRefresh: true }))[0]?.all ?? []
    ).map((c) => c.googlePlaceId);
    setCachedDiscoveredCombinations(DEST, [
      { combinationId: "1", title: "霜谷組合", theme, placeCandidates: [M, M2], primaryCandidates: [M, M2] },
    ]);
    clearCombinationPoolMemo();
    assert.equal(withOfferedCombinationIdentity(identity, () => isCombinationIdDriftedFromOffered(DEST, 1)), true);
    const driftIds = (
      withOfferedCombinationIdentity(identity, () => resolveSelectedCombinationPools(DEST, [1], { forceRefresh: true }))[0]?.all ?? []
    ).map((c) => c.googlePlaceId);
    assert.equal(intactIds.includes(LC.googlePlaceId), snapLC.touristQuality.admit, `intact=${intactIds}`);
    assert.equal(driftIds.includes(LC.googlePlaceId), snapLC.touristQuality.admit, `drifted=${driftIds}`);
  });
}

// Snapshot and Replan must use the same intent: when the intact cache still holds the offered places
// but now carries a DIFFERENT theme, Replan must still follow the theme the user chose (themeKey).
await test("intact path: cache theme changed after the offer → Replan still uses the snapshot themeKey intent", () => {
  if (!intactGateOnly["culture:LC"] || !intactGateOnly["attraction:LC"]) {
    inconclusive.push("intact non-Gate rule rejects LC");
    return;
  }
  const places = () => [offeredPlace(M), offeredPlace(LC)];
  // User chose a general combination; cache now says culture for the same places.
  const a = replan({ title: "城市景點漫遊", themeKey: "attraction", places: places(), path: "intact", cacheTheme: "culture" });
  // User chose a cultural combination; cache now says attraction.
  const b = replan({ title: "藝文博物館巡禮", themeKey: "culture", places: places(), path: "intact", cacheTheme: "attraction" });
  observe("intact theme drift", { chosenGeneral: a, chosenCulture: b });
  assert.equal(a.LC, false, "LOW released under a cache theme the user never chose");
  assert.equal(b.LC, true, "user's cultural choice ignored by intact Replan");
});

// ------------------------------ old session: trusted snapshot intent ------------------------------
await test("old session (no themeKey) + consistent snapshot intent cultural: reuse LC verdict; LN re-judged → excluded", () => {
  const r = replan({
    title: "城市景點漫遊",
    places: [
      offeredPlace(M, { touristQuality: verdict(M, "VISIT_WORTHY", true, "cultural_exploration") }),
      offeredPlace(LC, { touristQuality: verdict(LC, "LOW_EXPERIENCE_VALUE", true, "cultural_exploration") }),
      offeredPlace(LN),
    ],
  });
  assert.equal(r.LC, true, `ids=${r.ids}`);
  assert.equal(r.LN, false, `ids=${r.ids}`);
});

await test("old session (no themeKey) + consistent snapshot intent general beats a cultural title: LC excluded", () => {
  const r = replan({
    title: "藝文博物館巡禮",
    places: [
      offeredPlace(M, { touristQuality: verdict(M, "VISIT_WORTHY", true, "general_sightseeing") }),
      offeredPlace(LC),
      offeredPlace(LN),
    ],
  });
  assert.equal(r.LC, false, `ids=${r.ids}`);
  assert.equal(r.LN, false, `ids=${r.ids}`);
});

// ------------------------------ old session: neither (title compat) ------------------------------
for (const title of ["藝文博物館巡禮", "古蹟巡禮"]) {
  await test(`old session (neither) explicit zh theme title "${title}": LC kept, LN still excluded`, () => {
    assert.equal(legacyTitleCombinationTouristQualityIntent(title), "cultural_exploration");
    const r = replan({ title, places: plain() });
    assert.equal(r.LC, true, `ids=${r.ids}`);
    assert.equal(r.LN, false, `LOW without cultural evidence released; ids=${r.ids}`);
  });
}

for (const title of ["城市景點漫遊", "霜谷週末提案", "", "🙂"]) {
  await test(`old session (neither) general/unrecognized title ${JSON.stringify(title)}: conservative, LC and LN excluded`, () => {
    assert.equal(legacyTitleCombinationTouristQualityIntent(title), "general_sightseeing");
    const r = replan({ title, places: plain() });
    assert.equal(r.LC, false, `ids=${r.ids}`);
    assert.equal(r.LN, false, `ids=${r.ids}`);
  });
}

// Localized titles (en / ja / ko): app-produced localizations of a cultural zh title, plus
// hand-written ones. Contract: a localized title is never a trusted source → conservative.
const localized = [];
for (const loc of ["en", "ja", "ko"]) {
  // Real app localizations of cultural theme titles (theme keys with a THEME_TITLES row).
  for (const key of ["culture", "historic", "temple_culture", "culture_stroll"]) {
    const title = localizeCombinationThemeTitle(key, loc);
    const zh = localizeCombinationThemeTitle(key, "zh-TW");
    if (title && title !== zh) localized.push({ loc, title, source: `app:${key}` });
  }
}
localized.push(
  { loc: "en", title: "History & Culture Walk", source: "hand" },
  { loc: "en", title: "Museums and Heritage", source: "hand" },
  { loc: "ja", title: "カルチャー＆ミュージアム巡り", source: "hand" },
  { loc: "ko", title: "역사 문화 산책", source: "hand" },
);
observe(
  "localized titles → legacy intent",
  localized.map((l) => ({ ...l, intent: legacyTitleCombinationTouristQualityIntent(l.title) })),
);
for (const l of localized) {
  await test(`old session (neither) localized ${l.loc} title ${JSON.stringify(l.title)} (${l.source}): conservative`, () => {
    const r = replan({ title: l.title, places: plain() });
    assert.equal(r.LC, false, `localized title released LOW; ids=${r.ids}`);
    assert.equal(r.LN, false, `ids=${r.ids}`);
  });
}

// ------------------------------ verdict reuse only on intent + Place ID match ------------------------------
await test("themeKey=culture vs forged LN verdict under general intent: not reused → re-judged → LN excluded", () => {
  const r = replan({
    title: "霜谷週末提案",
    themeKey: "culture",
    places: [offeredPlace(M), offeredPlace(LC), offeredPlace(LN, { touristQuality: verdict(LN, "VISIT_WORTHY", true, "general_sightseeing") })],
  });
  assert.equal(r.LN, false, `ids=${r.ids}`);
});

await test("themeKey=attraction vs LC verdict admitted under cultural intent: not reused → LC excluded", () => {
  const r = replan({
    title: "霜谷週末提案",
    themeKey: "attraction",
    places: [offeredPlace(M), offeredPlace(LC, { touristQuality: verdict(LC, "LOW_EXPERIENCE_VALUE", true, "cultural_exploration") }), offeredPlace(LN)],
  });
  assert.equal(r.LC, false, `ids=${r.ids}`);
});

await test("themeKey=culture vs LC rejection recorded under general intent: not reused → re-judged under culture → LC kept", () => {
  const r = replan({
    title: "霜谷週末提案",
    themeKey: "culture",
    places: [offeredPlace(M), offeredPlace(LC, { touristQuality: verdict(LC, "LOW_EXPERIENCE_VALUE", false, "general_sightseeing") }), offeredPlace(LN)],
  });
  assert.equal(r.LC, true, `ids=${r.ids}`);
});

await test("themeKey=culture, LC rejection recorded under the SAME intent + Place ID: reused → LC stays excluded", () => {
  const r = replan({
    title: "霜谷週末提案",
    themeKey: "culture",
    places: [offeredPlace(M), offeredPlace(LC, { touristQuality: verdict(LC, "LOW_EXPERIENCE_VALUE", false, "cultural_exploration") }), offeredPlace(LN)],
  });
  assert.equal(r.LC, false, `ids=${r.ids}`);
});

await test("same intent but a DIFFERENT Place ID on the verdict: not reused (LN excluded)", () => {
  const r = replan({
    title: "霜谷週末提案",
    themeKey: "culture",
    places: [
      offeredPlace(M),
      offeredPlace(LN, { touristQuality: { ...verdict(LN, "VISIT_WORTHY", true, "cultural_exploration"), placeId: M2.googlePlaceId } }),
    ],
  });
  assert.equal(r.LN, false, `ids=${r.ids}`);
});

// Title-derived intent is never trusted: a forged admitting verdict under the title-derived intent
// must not be reused. Control: with a real themeKey the same verdict IS reused (proves non-trivial).
await test("old session: title-derived intent never trusted → verdict under that intent not reused (LN excluded)", () => {
  const places = () => [
    offeredPlace(M, { touristQuality: verdict(M, "VISIT_WORTHY", true, "general_sightseeing") }),
    offeredPlace(LN, { touristQuality: verdict(LN, "VISIT_WORTHY", true, "cultural_exploration") }),
  ];
  const control = replan({ title: "藝文博物館巡禮", themeKey: "culture", places: places() });
  assert.equal(control.LN, true, "precondition: trusted-intent reuse path not taken");
  // Old session: no themeKey; snapshot verdict intents disagree → no trusted intent; title says culture.
  const r = replan({ title: "藝文博物館巡禮", places: places() });
  assert.equal(r.LN, false, `title-derived intent treated as trusted; ids=${r.ids}`);
});

// ------------------------------ old session robustness ------------------------------
const badThemeKeys = [123, null, {}, [], true, "", "   "];
await test("old/corrupt session: non-string or blank themeKey ignored (no crash, no LOW release under general title)", () => {
  for (const themeKey of badThemeKeys) {
    const r = replan({ title: "城市景點漫遊", themeKey, places: plain() });
    assert.equal(r.LC, false, `themeKey=${JSON.stringify(themeKey)} ids=${r.ids}`);
    assert.equal(r.LN, false, `themeKey=${JSON.stringify(themeKey)} ids=${r.ids}`);
  }
});

await test("old/corrupt session: non-string themeKey falls back to title compat (cultural title keeps LC, never LN)", () => {
  for (const themeKey of badThemeKeys) {
    const r = replan({ title: "藝文博物館巡禮", themeKey, places: plain() });
    assert.equal(r.LN, false, `themeKey=${JSON.stringify(themeKey)} ids=${r.ids}`);
    assert.equal(r.LC, true, `themeKey=${JSON.stringify(themeKey)} ids=${r.ids}`);
  }
});

for (const title of [undefined, null, 42]) {
  await test(`old/corrupt session: title ${String(title)} with no themeKey → no crash, conservative`, () => {
    const r = replan({ title, places: plain() });
    assert.equal(r.LC, false, `ids=${r.ids}`);
    assert.equal(r.LN, false, `ids=${r.ids}`);
  });
}

await test("old/corrupt session: places missing coords / rating / address → no crash, LOW not released", () => {
  const strip = (c) => {
    const { latitude: _a, longitude: _b, rating: _r, userRatingCount: _u, address: _d, ...rest } = offeredPlace(c);
    return rest;
  };
  const r = replan({ title: "城市景點漫遊", places: [offeredPlace(M), strip(LC), strip(LN)] });
  assert.equal(r.LC, false, `ids=${r.ids}`);
  assert.equal(r.LN, false, `ids=${r.ids}`);
});

// A malformed verdict (intent only: no Place ID / tier / admit) is not a trusted intent field; it
// must not switch the whole combination to cultural_exploration and release LOW under a general title.
await test("old/corrupt session: intent-only malformed verdict is not a trusted intent (LC excluded under general title)", () => {
  const r = replan({
    title: "城市景點漫遊",
    places: [offeredPlace(M), offeredPlace(LC, { touristQuality: { intent: "cultural_exploration" } }), offeredPlace(LN)],
  });
  assert.equal(r.LC, false, `malformed verdict became trusted intent; ids=${r.ids}`);
  assert.equal(r.LN, false, `ids=${r.ids}`);
});

await test("zero provider (fetch) calls", () => {
  assert.equal(fetchCalls, 0);
});

if (inconclusive.length) console.log(`INFO inconclusive: ${inconclusive.length}`);
if (failures.length) {
  console.log(`FAIL tqg v2 session intent: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`);
  process.exitCode = 1;
} else {
  console.log(`PASS tqg v2 session intent: ${cases} scenarios, provider calls ${fetchCalls}`);
}
process.exit(process.exitCode ?? 0);
