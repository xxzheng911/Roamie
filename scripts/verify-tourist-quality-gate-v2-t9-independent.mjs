// Tourist Quality Gate V2 — T9 independent tester probes (offline, synthetic fixtures).
//  A) Legacy title-compat audit: APP_THEME_TITLE_KEYS (hand-copied in combination-candidate-quality)
//     vs THEME_TITLES (combination-theme-titles); every app non-zh theme title is conservative;
//     no zh-TW app theme title is wrongly forced conservative by a cross-locale collision.
//  B) Non-verified offered path (forceCombinations + populated cache whose themes do not match the
//     forced rows): the payload must not carry a mismatched first-pass verdict / themeKey, and the
//     drifted Replan must not reuse the mismatched verdict (LOW stays out).
//
// Run: npx vite-node scripts/verify-tourist-quality-gate-v2-t9-independent.mjs --config scripts/vite.verify.config.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("t9 probe must not call providers");
};
for (const s of [process.stdout, process.stderr]) s._handle?.setBlocking?.(true);
setTimeout(() => {
  console.log("FAIL tqg v2 t9 independent: watchdog timeout (90s)");
  process.exit(2);
}, 90_000).unref();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const { combinationThemeTitle } = await import("../src/lib/ai/combination-theme-titles");
const { destinationEditorialMessages } = await import("../src/lib/i18n/destination-editorial");
const {
  legacyTitleCombinationTouristQualityIntent,
  resolveThemeKeyFromTitle,
  canonicalCombinationTouristQualityIntent,
} = await import("../src/lib/ai/combination-candidate-quality");
const { setCachedDiscoveredCombinations } = await import("../src/lib/ai/destination-combination-discovery");
const { buildDestinationCombinationSuggestionPayload, buildOfferedCombinationsForSession } =
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
    await fn();
    cases++;
    console.log("PASS", name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL", name, "--", (e?.message ?? String(e)).split("\n").slice(0, 6).join(" | "));
  }
};
const observe = (label, value) => console.log(`OBSERVE ${label}:`, JSON.stringify(value));

// ============================ A) title compat audit ============================
const titlesSrc = read("src/lib/ai/combination-theme-titles.ts");
const themeBlock = titlesSrc.slice(
  titlesSrc.indexOf("const THEME_TITLES"),
  titlesSrc.indexOf("const ZH_TO_KEY"),
);
const themeTitleKeys = [...themeBlock.matchAll(/^ {2}([a-z_]+): \{/gm)].map((m) => m[1]);
const zhToKeyBlock = titlesSrc.slice(
  titlesSrc.indexOf("const ZH_TO_KEY"),
  titlesSrc.indexOf("const MECHANICAL_TITLE_RE"),
);
const zhAliasTitles = [...zhToKeyBlock.matchAll(/^ {2}([^\s:]+): "/gm)].map((m) => m[1]);

const qualitySrc = read("src/lib/ai/combination-candidate-quality.ts");
const appKeysBlock = qualitySrc.slice(
  qualitySrc.indexOf("const APP_THEME_TITLE_KEYS"),
  qualitySrc.indexOf("] as const", qualitySrc.indexOf("const APP_THEME_TITLE_KEYS")),
);
const appKeys = [...appKeysBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

await test("A1 APP_THEME_TITLE_KEYS equals THEME_TITLES row keys (same set, no drift)", () => {
  assert.ok(themeTitleKeys.length >= 10, `parsed THEME_TITLES keys: ${themeTitleKeys}`);
  assert.deepEqual([...appKeys].sort(), [...themeTitleKeys].sort());
});

const NON_ZH = ["en", "ja", "ko"];
const editorialThemeKeys = Object.keys(destinationEditorialMessages["zh-TW"]).filter((k) =>
  k.startsWith("theme_"),
);
const zhTitles = new Set([
  ...themeTitleKeys.map((k) => combinationThemeTitle(k, "zh-TW")),
  ...zhAliasTitles,
  ...editorialThemeKeys.map((k) => destinationEditorialMessages["zh-TW"][k]),
]);
const nonZhTitles = [];
for (const k of themeTitleKeys) {
  for (const loc of NON_ZH) nonZhTitles.push({ src: `app:${k}`, loc, title: combinationThemeTitle(k, loc) });
}
for (const k of editorialThemeKeys) {
  for (const loc of NON_ZH) {
    const t = destinationEditorialMessages[loc]?.[k];
    if (t) nonZhTitles.push({ src: `editorial:${k}`, loc, title: t });
  }
}

await test("A2 every app/editorial en/ja/ko theme title (not identical to a zh title) is conservative", () => {
  const leaks = nonZhTitles.filter(
    ({ title }) =>
      !zhTitles.has(title.trim()) &&
      legacyTitleCombinationTouristQualityIntent(title) !== "general_sightseeing",
  );
  assert.deepEqual(leaks, []);
});

const kanjiOnlyJa = nonZhTitles.filter(
  ({ loc, title }) => loc === "ja" && !/[぀-ヿㇰ-ㇿｦ-ﾟ]/.test(title) && /[一-龥]/.test(title),
);
observe("A kanji-only ja titles", kanjiOnlyJa.map((x) => x.title));
await test("A3 kanji-only ja app/editorial titles that a zh regex would read as cultural stay conservative", () => {
  const risky = kanjiOnlyJa.filter((x) =>
    ["culture", "historic"].includes(resolveThemeKeyFromTitle(x.title)),
  );
  observe("A3 risky (zh-regex cultural) kanji-only ja titles", risky.map((x) => x.title));
  for (const x of risky) {
    assert.equal(legacyTitleCombinationTouristQualityIntent(x.title), "general_sightseeing", x.title);
  }
});

const collisions = nonZhTitles.filter(({ title }) => zhTitles.has(title.trim()));
observe("A cross-locale collisions (non-zh title identical to some zh title)", collisions);
await test("A4 no zh-TW theme title is forced conservative by colliding with a non-zh title", () => {
  const wrong = [];
  for (const zh of zhTitles) {
    const key = resolveThemeKeyFromTitle(zh);
    const expected =
      key === "attraction" ? "general_sightseeing" : canonicalCombinationTouristQualityIntent(key);
    const got = legacyTitleCombinationTouristQualityIntent(zh);
    if (got !== expected) wrong.push({ zh, key, expected, got });
  }
  assert.deepEqual(wrong, []);
});
observe(
  "A zh cultural titles (legacy compat → cultural_exploration)",
  [...zhTitles].filter((t) => legacyTitleCombinationTouristQualityIntent(t) === "cultural_exploration"),
);

// ============================ B) forceCombinations mismatch ============================
const DEST = "霙沢市";
const CENTER = { lat: 34.9, lng: 134.9 };
const HOURS = {
  openNow: true,
  periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
  weekdayDescriptions: ["Monday: 9:00 AM – 5:00 PM"],
};
let seq = 0;
const cand = (key, name, types, extra = {}) => {
  seq++;
  const id = `ChIJ_TQG_T9_${key}`;
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
// LOW with cultural evidence: admitted only under cultural_exploration.
const X = cand("X", "霙沢古蹟番所跡", ["historical_landmark", "point_of_interest"]);
const M1 = cand("M1", "霙沢歴史資料館", ["museum", "tourist_attraction"], { regularOpeningHours: HOURS });
const M2 = cand("M2", "霙沢郷土博物館", ["museum", "tourist_attraction"], { regularOpeningHours: HOURS });
const P1 = cand("P1", "霙沢展望台公園", ["park", "tourist_attraction"], { regularOpeningHours: HOURS });
const P2 = cand("P2", "霙沢港町広場", ["park", "tourist_attraction"], { regularOpeningHours: HOURS });
const P3 = cand("P3", "霙沢海浜公園", ["park", "tourist_attraction"], { regularOpeningHours: HOURS });

const seed = (cultural, general) =>
  setCachedDiscoveredCombinations(DEST, [
    { combinationId: "1", title: "藝文博物館組合", theme: "culture", placeCandidates: cultural, primaryCandidates: cultural },
    { combinationId: "2", title: "經典景點組合", theme: "attraction", placeCandidates: general, primaryCandidates: general },
  ]);

await test("B0 precondition: X is LOW with cultural evidence; verified snapshot verdict is cultural admit", () => {
  const a = classifyTouristQuality({ name: X.name, types: X.types, primaryType: X.primaryType });
  assert.equal(a.tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(a.culturalEvidence, true);
  seed([X, M1, M2], [P1, P2, P3]);
  const snap = buildOfferedCombinationsForSession(DEST, "zh-TW");
  const x = snap[0]?.places.find((p) => p.googlePlaceId === X.googlePlaceId);
  observe("B0 verified snapshot", { themeKey: snap[0]?.themeKey, verdict: x?.touristQuality ?? null });
  assert.equal(snap[0]?.themeKey, "culture");
  assert.equal(x?.touristQuality?.intent, "cultural_exploration");
  assert.equal(x?.touristQuality?.admit, true);
});

// Forced rows: row 1 is a GENERAL-looking combination that lists the cultural group's places
// (source index 0 = cached culture group). Row 2 maps to the attraction group.
const forced = [
  { title: "霙沢週末提案", places: [X.name, M1.name, M2.name] },
  { title: "經典景點組合", places: [P1.name, P2.name, P3.name] },
];
let payload = null;
await test("B1 forceCombinations payload: no themeKey and no first-pass verdict on index-unverified rows", () => {
  seed([X, M1, M2], [P1, P2, P3]);
  payload = buildDestinationCombinationSuggestionPayload(DEST, 3, {
    locale: "zh-TW",
    forceCombinations: forced,
  });
  observe("B1 payload", payload?.offeredCombinations?.map((c) => ({
    id: c.id,
    title: c.title,
    themeKey: c.themeKey ?? null,
    places: c.places.map((p) => ({ id: p.googlePlaceId, tq: p.touristQuality ?? null })),
  })));
  if (!payload) {
    inconclusive.push("B1 payload null offline");
    throw Error("payload null (fixture not deliverable offline)");
  }
  const row = payload.offeredCombinations.find((c) => c.places.some((p) => p.googlePlaceId === X.googlePlaceId));
  assert.ok(row, "X not in forced payload (name match failed)");
  assert.equal(row.themeKey, undefined, "themeKey carried on a forced (index-unverified) row");
  for (const c of payload.offeredCombinations) {
    for (const p of c.places) assert.equal(p.touristQuality, undefined, `verdict carried on ${p.googlePlaceId}`);
  }
});

await test("B2 drifted Replan of the forced general row does not reuse the cultural verdict (LOW X out)", () => {
  assert.ok(payload, "no payload");
  const row = payload.offeredCombinations.find((c) => c.places.some((p) => p.googlePlaceId === X.googlePlaceId));
  assert.ok(row, "X row missing");
  const identity = createOfferedCombinationIdentity(DEST, payload.offeredCombinations);
  // Drift: cache now has a different first group, so the offered pin is used.
  setCachedDiscoveredCombinations(DEST, [
    { combinationId: "1", title: "經典景點組合", theme: "attraction", placeCandidates: [P1, P2, P3], primaryCandidates: [P1, P2, P3] },
    { combinationId: "2", title: "藝文博物館組合", theme: "culture", placeCandidates: [M1, M2], primaryCandidates: [M1, M2] },
  ]);
  clearCombinationPoolMemo();
  const drifted = withOfferedCombinationIdentity(identity, () => isCombinationIdDriftedFromOffered(DEST, row.id));
  const [pool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DEST, [row.id], { forceRefresh: true }),
  );
  const ids = (pool?.all ?? []).map((c) => c.googlePlaceId);
  observe("B2 replan", { drifted, rowId: row.id, ids });
  assert.equal(drifted, true, "drifted offered-pin path not taken");
  assert.ok(ids.includes(M1.googlePlaceId), `control M1 missing: ${ids}`);
  assert.ok(!ids.includes(X.googlePlaceId), `LOW X re-entered via mismatched verdict: ${ids}`);
});

// Reverse control: the SAME scenario with a verdict forged onto the forced row (what the pre-fix
// code would have carried) is reused → X admitted. Proves B2 is non-trivial.
await test("B3 reverse control: had the cultural verdict been carried, drifted Replan would admit X", () => {
  assert.ok(payload, "no payload");
  const row = payload.offeredCombinations.find((c) => c.places.some((p) => p.googlePlaceId === X.googlePlaceId));
  const forgedRow = {
    ...row,
    places: row.places.map((p) =>
      p.googlePlaceId === X.googlePlaceId
        ? { ...p, touristQuality: { placeId: X.googlePlaceId, tier: "LOW_EXPERIENCE_VALUE", admit: true, intent: "cultural_exploration" } }
        : { ...p, touristQuality: { placeId: p.googlePlaceId, tier: "VISIT_WORTHY", admit: true, intent: "cultural_exploration" } },
    ),
  };
  const others = payload.offeredCombinations.filter((c) => c.id !== row.id);
  const identity = createOfferedCombinationIdentity(DEST, [forgedRow, ...others]);
  clearCombinationPoolMemo();
  const [pool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DEST, [row.id], { forceRefresh: true }),
  );
  const ids = (pool?.all ?? []).map((c) => c.googlePlaceId);
  observe("B3 replan with carried verdict", { ids });
  assert.ok(ids.includes(X.googlePlaceId), `reverse control did not admit X: ${ids}`);
});

// ============================ C) drifted pin: themeKey also changes the pool THEME ============================
// Attribution for verify-chat-regenerate-handler-runtime C1 (PASS at HEAD, FAIL in worktree): the
// drifted offered-pin pool's `theme` (which drives the non-Gate category contract and supplement)
// now comes from the snapshot themeKey instead of the (localized) title. OBSERVE only: the probe
// records the difference; whether HEAD's title-derived theme or the themeKey is the intended
// category contract is a product decision for the assigner.
{
  const DEST3 = "霙沢町";
  const parks = [P1, P2, P3];
  setCachedDiscoveredCombinations(DEST3, [
    { combinationId: "1", title: "城市慢遊組合", theme: "nature", placeCandidates: parks, primaryCandidates: parks },
  ]);
  const snap = buildOfferedCombinationsForSession(DEST3, "en");
  const withKey = snap.map((c) => ({ ...c }));
  const withoutKey = snap.map(({ themeKey: _omit, ...c }) => c);
  // Drift: cache rebuilt with a different first group.
  setCachedDiscoveredCombinations(DEST3, [
    { combinationId: "1", title: "經典景點組合", theme: "attraction", placeCandidates: [M1, M2], primaryCandidates: [M1, M2] },
  ]);
  const poolFor = (offered) => {
    clearCombinationPoolMemo();
    const identity = createOfferedCombinationIdentity(DEST3, offered);
    const drifted = withOfferedCombinationIdentity(identity, () => isCombinationIdDriftedFromOffered(DEST3, 1));
    const [pool] = withOfferedCombinationIdentity(identity, () =>
      resolveSelectedCombinationPools(DEST3, [1], { forceRefresh: true }),
    );
    return { drifted, theme: pool?.theme ?? null, ids: (pool?.all ?? []).map((c) => c.googlePlaceId) };
  };
  observe("C drifted pin pool theme", {
    title: snap[0]?.title,
    themeKey: snap[0]?.themeKey ?? null,
    withThemeKey: poolFor(withKey),
    withoutThemeKey_HEAD_like: poolFor(withoutKey),
  });
}

await test("zero provider (fetch) calls", () => {
  assert.equal(fetchCalls, 0);
});

if (inconclusive.length) console.log(`INFO inconclusive: ${inconclusive.join("; ")}`);
if (failures.length) {
  console.log(`FAIL tqg v2 t9 independent: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`);
  process.exitCode = 1;
} else {
  console.log(`PASS tqg v2 t9 independent: ${cases} scenarios, provider calls ${fetchCalls}`);
}
process.exit(process.exitCode ?? 0);
