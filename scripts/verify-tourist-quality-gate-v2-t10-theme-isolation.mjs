// Tourist Quality Gate V2 — T10 independent re-verification (offline, synthetic fixtures).
// Contract: the snapshot themeKey decides ONLY the Tourist Quality Gate intent; it must never change
// the pool theme (category contract / supplement search) nor any non-Gate admission.
//  T1 drifted offered-pin pool: pool.theme === resolveThemeKeyFromTitle(title) for every themeKey
//  T2 drifted: Gate intent follows themeKey (not the title); non-LOW ids identical across themeKeys
//  T3 old session (no themeKey, no verdict): no crash; title-derived re-judge; LOW w/o cultural out
//  T4 intact cache: pool.theme === cache theme; only LOW admission varies with themeKey;
//     category contract (food theme) identical for every themeKey
//
// Run: npx vite-node scripts/verify-tourist-quality-gate-v2-t10-theme-isolation.mjs --config scripts/vite.verify.config.mjs
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("t10 probe must not call providers");
};
for (const s of [process.stdout, process.stderr]) s._handle?.setBlocking?.(true);
setTimeout(() => {
  console.log("FAIL tqg v2 t10 theme isolation: watchdog timeout (90s)");
  process.exit(2);
}, 90_000).unref();

const { resolveThemeKeyFromTitle } = await import("../src/lib/ai/combination-candidate-quality");
const { setCachedDiscoveredCombinations } = await import("../src/lib/ai/destination-combination-discovery");
const { classifyTouristQuality } = await import("../src/lib/tourist-quality-gate");
const { buildOfferedCombinationsForSession } = await import("../src/lib/ai/destination-combination-suggestions");
const {
  resolveSelectedCombinationPools,
  createOfferedCombinationIdentity,
  withOfferedCombinationIdentity,
  clearCombinationPoolMemo,
  isCombinationIdDriftedFromOffered,
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
    console.log("FAIL", name, "--", (e?.message ?? String(e)).split("\n").slice(0, 6).join(" | "));
  }
};
const observe = (label, value) => console.log(`OBSERVE ${label}:`, JSON.stringify(value));

const DEST = "霧鳴市";
const CENTER = { lat: 35.2, lng: 135.2 };
const HOURS = {
  openNow: true,
  periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
  weekdayDescriptions: ["Monday: 9:00 AM – 5:00 PM"],
};
let seq = 0;
const cand = (key, name, types, extra = {}) => {
  seq++;
  const id = `ChIJ_TQG_T10_${key}`;
  return {
    name,
    originalName: name,
    googlePlaceId: id,
    searchCandidateId: id,
    address: `${DEST}本町${seq}-1`,
    coordinates: { lat: CENTER.lat + seq * 0.001, lng: CENTER.lng + seq * 0.001 },
    types,
    primaryType: types[0] ?? null,
    rating: 4.5,
    userRatingCount: 300,
    businessStatus: "OPERATIONAL",
    ...extra,
  };
};
// LOW with cultural evidence (admitted only under cultural_exploration).
const X = cand("X", "霧鳴旧船番所跡", ["historical_landmark", "point_of_interest"]);
// LOW without cultural evidence (never admitted).
const XN = cand("XN", "霧鳴旧物見櫓跡", ["landmark", "point_of_interest"]);
const M1 = cand("M1", "霧鳴郷土資料館", ["museum", "tourist_attraction"], { regularOpeningHours: HOURS });
const M2 = cand("M2", "霧鳴歴史博物館", ["museum", "tourist_attraction"], { regularOpeningHours: HOURS });
const P1 = cand("P1", "霧鳴展望台公園", ["park", "tourist_attraction"], { regularOpeningHours: HOURS });
const R1 = cand("R1", "霧鳴港食堂", ["restaurant", "food"], { regularOpeningHours: HOURS });
const R2 = cand("R2", "霧鳴そば処", ["restaurant", "food"], { regularOpeningHours: HOURS });
const OTHER = [
  cand("O1", "霧鳴海浜公園", ["park", "tourist_attraction"], { regularOpeningHours: HOURS }),
  cand("O2", "霧鳴港町広場", ["park", "tourist_attraction"], { regularOpeningHours: HOURS }),
];
const LOW_IDS = new Set([X.googlePlaceId, XN.googlePlaceId]);

const pinPlace = (c) => ({
  name: c.name,
  originalName: c.originalName,
  googlePlaceId: c.googlePlaceId,
  latitude: c.coordinates.lat,
  longitude: c.coordinates.lng,
  types: c.types,
  primaryType: c.primaryType,
  rating: c.rating,
  userRatingCount: c.userRatingCount,
  regularOpeningHours: c.regularOpeningHours,
});

const driftedPool = ({ title, themeKey, places }) => {
  // Cache rebuilt with an unrelated group under id 1 → offered pin must be used.
  setCachedDiscoveredCombinations(DEST, [
    { combinationId: "1", title: "經典景點組合", theme: "attraction", placeCandidates: OTHER, primaryCandidates: OTHER },
  ]);
  clearCombinationPoolMemo();
  const row = { id: 1, title, places: places.map(pinPlace) };
  if (themeKey !== undefined) row.themeKey = themeKey;
  const identity = createOfferedCombinationIdentity(DEST, [row]);
  const drifted = withOfferedCombinationIdentity(identity, () => isCombinationIdDriftedFromOffered(DEST, 1));
  const [pool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DEST, [1], { forceRefresh: true }),
  );
  return { drifted, theme: pool?.theme ?? null, ids: (pool?.all ?? []).map((c) => c.googlePlaceId) };
};

const intactPool = ({ cacheTitle, cacheTheme, themeKey, places }) => {
  setCachedDiscoveredCombinations(DEST, [
    { combinationId: "1", title: cacheTitle, theme: cacheTheme, placeCandidates: places, primaryCandidates: places },
  ]);
  clearCombinationPoolMemo();
  // Offered snapshot from the production writer (so the pin matches what the cache actually holds),
  // then the themeKey under test replaces the written one (undefined = older session without it).
  const snap = buildOfferedCombinationsForSession(DEST, "zh-TW");
  const { themeKey: _written, ...base } = snap[0] ?? { id: 1, title: cacheTitle, places: [] };
  const row = { ...base };
  if (themeKey !== undefined) row.themeKey = themeKey;
  const identity = createOfferedCombinationIdentity(DEST, [row, ...snap.slice(1)]);
  const drifted = withOfferedCombinationIdentity(identity, () => isCombinationIdDriftedFromOffered(DEST, 1));
  const [pool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DEST, [1], { forceRefresh: true }),
  );
  return { drifted, theme: pool?.theme ?? null, ids: (pool?.all ?? []).map((c) => c.googlePlaceId) };
};
const nonLow = (ids) => ids.filter((id) => !LOW_IDS.has(id)).sort();

await test("P0 precondition: X LOW+cultural, XN LOW without cultural, controls not LOW", () => {
  const x = classifyTouristQuality({ name: X.name, types: X.types, primaryType: X.primaryType });
  const xn = classifyTouristQuality({ name: XN.name, types: XN.types, primaryType: XN.primaryType });
  assert.equal(x.tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(x.culturalEvidence, true);
  assert.equal(xn.tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(xn.culturalEvidence, false);
  for (const c of [M1, M2, P1, R1, R2]) {
    const v = classifyTouristQuality({
      name: c.name,
      types: c.types,
      primaryType: c.primaryType,
      regularOpeningHours: c.regularOpeningHours,
    });
    assert.notEqual(v.tier, "LOW_EXPERIENCE_VALUE", c.name);
  }
});

const TITLES = ["藝文博物館組合", "經典景點組合", "人氣美食組合", "自然公園組合"];
const THEME_KEYS = [undefined, "culture", "historic", "attraction", "nature", "food", "shopping"];

await test("T1 drifted pin: pool.theme is title-derived for every themeKey (themeKey never changes category/supplement theme)", () => {
  const rows = [];
  let nonTrivial = 0;
  for (const title of TITLES) {
    const titleTheme = resolveThemeKeyFromTitle(title);
    for (const themeKey of THEME_KEYS) {
      const r = driftedPool({ title, themeKey, places: [M1, X, XN, P1] });
      assert.equal(r.drifted, true, `not drifted: ${title}/${themeKey}`);
      rows.push({ title, themeKey: themeKey ?? null, titleTheme, poolTheme: r.theme });
      if (themeKey && themeKey !== titleTheme) nonTrivial++;
    }
  }
  observe("T1 matrix (mismatches only)", rows.filter((r) => r.poolTheme !== r.titleTheme));
  assert.ok(nonTrivial >= 10, `too few themeKey≠titleTheme cases: ${nonTrivial}`);
  for (const r of rows) assert.equal(r.poolTheme, r.titleTheme, JSON.stringify(r));
});

await test("T2 drifted pin: Gate intent follows themeKey over title; non-LOW ids identical across themeKeys", () => {
  const culturalTitleGeneralKey = driftedPool({ title: "藝文博物館組合", themeKey: "attraction", places: [M1, X, XN, P1] });
  const generalTitleCulturalKey = driftedPool({ title: "經典景點組合", themeKey: "culture", places: [M1, X, XN, P1] });
  observe("T2", { culturalTitleGeneralKey, generalTitleCulturalKey });
  assert.ok(!culturalTitleGeneralKey.ids.includes(X.googlePlaceId), "X admitted under general themeKey");
  assert.ok(generalTitleCulturalKey.ids.includes(X.googlePlaceId), "X rejected under cultural themeKey");
  for (const r of [culturalTitleGeneralKey, generalTitleCulturalKey]) {
    assert.ok(!r.ids.includes(XN.googlePlaceId), "LOW without cultural evidence admitted");
  }
  for (const title of TITLES) {
    const sets = THEME_KEYS.map((k) => JSON.stringify(nonLow(driftedPool({ title, themeKey: k, places: [M1, X, XN, P1] }).ids)));
    assert.equal(new Set(sets).size, 1, `${title}: non-LOW admission varies with themeKey: ${[...new Set(sets)]}`);
  }
});

await test("T3 old session (no themeKey, no verdict, sparse fields): no crash; title re-judge; LOW w/o cultural out", () => {
  const cultural = driftedPool({ title: "藝文博物館組合", themeKey: undefined, places: [M1, X, XN, P1] });
  const general = driftedPool({ title: "經典景點組合", themeKey: undefined, places: [M1, X, XN, P1] });
  observe("T3", { cultural, general });
  assert.ok(cultural.ids.includes(X.googlePlaceId), "legacy cultural title should re-judge X under cultural");
  assert.ok(!general.ids.includes(X.googlePlaceId), "X admitted under legacy general title");
  for (const r of [cultural, general]) assert.ok(!r.ids.includes(XN.googlePlaceId), "XN admitted");
  // Corrupt/old rows: non-string title, no coords/rating/hours, one place without id/types.
  observe("T3 XN name-only tier (types absent)", classifyTouristQuality({ name: XN.name }).tier);
  setCachedDiscoveredCombinations(DEST, [
    { combinationId: "1", title: "經典景點組合", theme: "attraction", placeCandidates: OTHER, primaryCandidates: OTHER },
  ]);
  clearCombinationPoolMemo();
  const identity = createOfferedCombinationIdentity(DEST, [
    {
      id: 1,
      title: undefined,
      places: [{ name: XN.name, googlePlaceId: XN.googlePlaceId, types: XN.types, primaryType: XN.primaryType }, { name: M1.name }],
    },
  ]);
  const [pool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DEST, [1], { forceRefresh: true }),
  );
  const ids = (pool?.all ?? []).map((c) => c.googlePlaceId);
  observe("T3 corrupt row", { theme: pool?.theme, ids });
  assert.ok(!ids.includes(XN.googlePlaceId), "XN admitted from corrupt old row");
});

await test("T4 intact cache: pool.theme is the cache theme; only LOW admission varies with themeKey", () => {
  const byKey = THEME_KEYS.map((k) => ({
    k: k ?? null,
    ...intactPool({ cacheTitle: "藝文博物館組合", cacheTheme: "culture", themeKey: k, places: [M1, M2, X, XN, P1] }),
  }));
  observe("T4 culture cache", byKey);
  for (const r of byKey) {
    assert.equal(r.drifted, false, `unexpected drift for themeKey=${r.k}`);
    assert.equal(r.theme, "culture", `pool.theme changed by themeKey=${r.k}`);
    assert.ok(!r.ids.includes(XN.googlePlaceId), `XN admitted (themeKey=${r.k})`);
  }
  assert.equal(new Set(byKey.map((r) => JSON.stringify(nonLow(r.ids)))).size, 1, "non-LOW admission varies with themeKey");
  const general = byKey.find((r) => r.k === "attraction");
  const cultural = byKey.find((r) => r.k === "culture");
  assert.ok(!general.ids.includes(X.googlePlaceId), "X admitted under general themeKey on intact path");
  assert.ok(cultural.ids.includes(X.googlePlaceId), "X rejected under cultural themeKey on intact path");
});

await test("T4b intact cache, food theme: category contract result identical for every themeKey", () => {
  const byKey = THEME_KEYS.map((k) => ({
    k: k ?? null,
    ...intactPool({ cacheTitle: "人氣美食組合", cacheTheme: "food", themeKey: k, places: [R1, R2, P1, M1] }),
  }));
  observe("T4b food cache", byKey);
  for (const r of byKey) assert.equal(r.theme, "food", `pool.theme changed by themeKey=${r.k}`);
  assert.equal(new Set(byKey.map((r) => JSON.stringify([...r.ids].sort()))).size, 1, "food category contract varies with themeKey");
});

await test("zero provider (fetch) calls", () => {
  assert.equal(fetchCalls, 0);
});

if (failures.length) {
  console.log(`FAIL tqg v2 t10 theme isolation: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`);
  process.exitCode = 1;
} else {
  console.log(`PASS tqg v2 t10 theme isolation: ${cases} scenarios, provider calls ${fetchCalls}`);
}
process.exit(process.exitCode ?? 0);
