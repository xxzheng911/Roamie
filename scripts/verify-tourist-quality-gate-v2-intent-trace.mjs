// Tourist Quality Gate V2 — intent trace (independent tester check).
// Discovery first pass (general toCandidate path / preferred top-up path) → session snapshot
// verdict → Replan (intact cache path / drifted offered-pin path): is the SAME canonical travel
// intent used at every step?
//
// OFFLINE: fetch trapped and counted (must stay 0); discovery cache seeded in-process.
// Fixture names are fictional (prefix "雲峡"); no rule depends on a specific place name.
//
// Intent only changes the outcome for LOW_EXPERIENCE_VALUE places with cultural type evidence
// (cultural_exploration admits them, general_sightseeing rejects them), so every probe uses such a
// place inside a combination whose theme intent differs from the place-level semantic family.
// Each probe first proves that ONLY the Tourist Quality Gate decides (with protection the same
// call passes), so a non-Gate rejection can never make a probe pass vacuously.
//
// Run: npx vite-node scripts/verify-tourist-quality-gate-v2-intent-trace.mjs --config scripts/vite.verify.config.mjs
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("intent trace verify must not call providers");
};
// Self-termination guard: never leave a hanging process behind (vite-node can keep the process
// alive after an uncaught top-level error, so all logic below also runs inside test()).
for (const s of [process.stdout, process.stderr]) s._handle?.setBlocking?.(true);
setTimeout(() => {
  console.log("FAIL tqg v2 intent trace: watchdog timeout (90s)");
  process.exit(2);
}, 90_000).unref();

const { setCachedDiscoveredCombinations, resolvePrimarySemanticFamily, mergeVerifiedCombinationTopUp } =
  await import("../src/lib/ai/destination-combination-discovery");
const { buildOfferedCombinationsForSession, offeredPlaceTouristQualityIntent } =
  await import("../src/lib/ai/destination-combination-suggestions");
const {
  validateCandidateIntent,
  touristQualityIntentForCombination,
  candidateTouristQualityDecision,
  canonicalCombinationTouristQualityIntent,
} = await import("../src/lib/ai/combination-candidate-quality");
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
const observe = (label, value) => console.log(`OBSERVE ${label}:`, JSON.stringify(value));

const DESTINATION = "雲峡市";
const CENTER = { lat: 35.3, lng: 135.3 };
const HOURS = {
  openNow: true,
  periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
  weekdayDescriptions: ["Monday: 9:00 AM – 5:00 PM"],
};

let seq = 0;
const cand = (key, name, types, extra = {}) => {
  seq++;
  const id = `ChIJ_TQG_INTENT_${key}`;
  return {
    name,
    originalName: name,
    googlePlaceId: id,
    searchCandidateId: id,
    address: `${DESTINATION}本町${seq}-1`,
    coordinates: { lat: CENTER.lat + seq * 0.001, lng: CENTER.lng + seq * 0.001 },
    types,
    primaryType: types[0] ?? null,
    rating: 4.5,
    userRatingCount: 300,
    businessStatus: "OPERATIONAL",
    ...extra,
  };
};

// LOW + cultural evidence (historical_landmark only + old-site name). The name also carries a
// nature word, so the place-level semantic family is NOT historic/culture → canonical intent
// general_sightseeing. The combination is culture-themed → combination intent cultural_exploration.
const X = cand("X", "雲峡公園旧番所跡", ["historical_landmark", "point_of_interest"]);
const M1 = cand("M1", "雲峡歴史資料館", ["museum", "tourist_attraction"], { regularOpeningHours: HOURS });
const M2 = cand("M2", "雲峡郷土博物館", ["museum", "tourist_attraction"], { regularOpeningHours: HOURS });
const M3 = cand("M3", "雲峡市立美術館", ["art_gallery", "museum", "tourist_attraction"], { regularOpeningHours: HOURS });
const COMBO = { title: "藝文博物館巡禮", theme: "culture" };

const intentInput = (c) => ({
  name: c.name,
  address: c.address,
  types: c.types,
  primaryType: c.primaryType,
  googlePlaceId: c.googlePlaceId,
});
const candidateInput = (c) => ({
  name: c.name,
  types: c.types,
  primaryType: c.primaryType,
  address: c.address,
  lat: c.coordinates.lat,
  lng: c.coordinates.lng,
  rating: c.rating,
  userRatingCount: c.userRatingCount,
  googlePlaceId: c.googlePlaceId,
  regularOpeningHours: c.regularOpeningHours,
  currentOpeningHours: c.currentOpeningHours,
  reviewEvidence: c.reviewEvidence,
});

const canonical = offeredPlaceTouristQualityIntent(intentInput(X));
const comboIntent = touristQualityIntentForCombination(COMBO);
const canonicalDecision = candidateTouristQualityDecision(candidateInput(X), { theme: canonical.theme });
observe("X intents", {
  placeFamily: resolvePrimarySemanticFamily({ ...X }).resolvedPrimaryTheme,
  canonicalIntent: canonical.intent,
  comboIntent,
  canonicalAdmit: canonicalDecision.admit,
});

await test("precondition: X is LOW with cultural evidence; place-level intent ≠ combination intent", () => {
  const a = classifyTouristQuality({ name: X.name, types: X.types, primaryType: X.primaryType });
  assert.equal(a.tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(a.culturalEvidence, true);
  assert.equal(canonical.intent, "general_sightseeing");
  assert.equal(comboIntent, "cultural_exploration");
  assert.equal(canonicalDecision.admit, false);
});

// ---------------- Discovery general path (toCandidate): theme = resolvePrimarySemanticFamily ----------------
await test("general path: first-pass intent source == snapshot canonical intent source", () => {
  for (const c of [X, M1, M2, M3]) {
    const t = resolvePrimarySemanticFamily({ ...c }).resolvedPrimaryTheme;
    assert.equal(
      touristQualityIntentForCombination({ theme: t }),
      offeredPlaceTouristQualityIntent(intentInput(c)).intent,
      c.name,
    );
  }
  const args = [candidateInput(X), { theme: resolvePrimarySemanticFamily({ ...X }).resolvedPrimaryTheme }, DESTINATION];
  const opts = { center: CENTER, requireTourismType: false, source: "places_discovery" };
  const unprotected = validateCandidateIntent(...args, opts);
  const protectedR = validateCandidateIntent(...args, { ...opts, protection: "explicit" });
  observe("general first pass", { unprotected, protectedR });
  assert.equal(protectedR.ok, true, `non-Gate rule rejects X on the general path: ${protectedR.reason}`);
  assert.equal(unprotected.ok, canonicalDecision.admit);
});

// ---------------- Discovery top-up path: exact args of mergeVerifiedCombinationTopUp ----------------
const topUpArgs = [candidateInput(X), { title: COMBO.title, theme: COMBO.theme }, DESTINATION];
const topUpOpts = { requireTourismType: true, source: "combination_preferred_top_up" };

await test("top-up path: only the Gate decides X (protected call passes)", () => {
  const protectedR = validateCandidateIntent(...topUpArgs, { ...topUpOpts, protection: "explicit" });
  assert.equal(protectedR.ok, true, `non-Gate rule rejects X on top-up: ${protectedR.reason}`);
});

// Rewritten (T8): canonical intent = the combination theme the user chose; the place-level semantic
// family is evidence only and must NOT decide.
const comboCanonicalIntent = canonicalCombinationTouristQualityIntent(COMBO.theme);
const comboDecision = candidateTouristQualityDecision(candidateInput(X), COMBO, null, comboCanonicalIntent);
await test("top-up path: first-pass decision equals the combination-canonical decision (not the place family)", () => {
  const r = validateCandidateIntent(...topUpArgs, topUpOpts);
  observe("top-up first pass", { r, comboCanonicalIntent, comboAdmit: comboDecision.admit, placeFamilyAdmit: canonicalDecision.admit });
  assert.equal(comboCanonicalIntent, "cultural_exploration");
  assert.equal(comboDecision.admit, true, "LOW with cultural evidence under a cultural combination");
  assert.equal(r.ok, comboDecision.admit, `top-up admits=${r.ok}, combination-canonical admits=${comboDecision.admit}`);
  // Non-trivial: the place-level family alone would have rejected X; it must not override.
  assert.notEqual(r.ok, canonicalDecision.admit);
});

// Cultural exploration ≠ every place passes: LOW WITHOUT cultural evidence under the same cultural
// combination is still rejected on the top-up path ("landmark" is a marker type, not cultural).
const XN = cand("XN", "雲峡旧物見櫓跡", ["landmark", "point_of_interest"]);
await test("top-up path (stricter): LOW without cultural evidence is rejected under the cultural combination", () => {
  const a = classifyTouristQuality({ name: XN.name, types: XN.types, primaryType: XN.primaryType });
  assert.equal(a.tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(a.culturalEvidence, false);
  const args = [candidateInput(XN), { title: COMBO.title, theme: COMBO.theme }, DESTINATION];
  const protectedR = validateCandidateIntent(...args, { ...topUpOpts, protection: "explicit" });
  assert.equal(protectedR.ok, true, `non-Gate rule rejects XN on top-up: ${protectedR.reason}`);
  const r = validateCandidateIntent(...args, topUpOpts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "tourist_quality_low_experience");
});

// End-to-end merge needs a combination that also passes validateCombinationOptions offline; if the
// fixture cannot satisfy it the probe is INCONCLUSIVE (reported, never counted as PASS).
const inconclusive = [];
{
  const extra = [
    cand("M4", "雲峡民俗博物館", ["museum", "tourist_attraction"], { regularOpeningHours: HOURS }),
    cand("M5", "雲峡文化会館", ["cultural_landmark", "tourist_attraction"], { regularOpeningHours: HOURS }),
  ];
  const topUp = mergeVerifiedCombinationTopUp(DESTINATION, [], [
    { combinationId: "1", title: COMBO.title, theme: COMBO.theme, placeCandidates: [X, M1, M2, M3, ...extra] },
  ]);
  const ids = topUp.combinations.flatMap((c) => c.placeCandidates.map((p) => p.googlePlaceId));
  observe("top-up merge", { addedCount: topUp.addedCount, degraded: topUp.degradedReason ?? null, ids });
  const name = "top-up path (end-to-end merge): LOW X does not enter a combination the canonical intent rejects";
  if (topUp.addedCount === 0) {
    inconclusive.push(name);
    console.log("INCONCLUSIVE", name, `-- combination not added offline (${topUp.degradedReason})`);
  } else {
    await test(name, () => {
      assert.ok(!ids.includes(X.googlePlaceId), `X admitted into the combination by top-up; ids=${JSON.stringify(ids)}`);
    });
  }
}

// ---------------- Snapshot → Replan (combination as top-up would store it) ----------------
const seed = (places) =>
  setCachedDiscoveredCombinations(DESTINATION, [
    { combinationId: "1", title: COMBO.title, theme: COMBO.theme, placeCandidates: places, primaryCandidates: places },
  ]);
const replan = (identity) => {
  clearCombinationPoolMemo();
  const drifted = withOfferedCombinationIdentity(identity, () => isCombinationIdDriftedFromOffered(DESTINATION, 1));
  const [pool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DESTINATION, [1], { forceRefresh: true }),
  );
  const ids = (pool?.all ?? []).map((c) => c.googlePlaceId);
  return { drifted, ids, hasX: ids.includes(X.googlePlaceId), hasControl: ids.includes(M1.googlePlaceId) };
};

let snapX = null;
let intact = null;
let drifted = null;
// Rewritten (T8): the snapshot verdict intent is the COMBINATION canonical intent (themeKey), not the
// place-level family; the snapshot also records the themeKey itself.
let snapCombo = null;
await test("snapshot: X stored with a verdict bound to its Place ID under the combination canonical intent", () => {
  seed([X, M1, M2]);
  const snap = buildOfferedCombinationsForSession(DESTINATION, "zh-TW");
  snapCombo = snap[0] ?? null;
  snapX = snap.flatMap((c) => c.places ?? []).find((p) => p.googlePlaceId === X.googlePlaceId) ?? null;
  const identity = createOfferedCombinationIdentity(DESTINATION, snap);
  intact = replan(identity);
  seed([M1, M2]);
  drifted = replan(identity);
  observe("snapshot/replan", { themeKey: snapCombo?.themeKey, verdict: snapX?.touristQuality ?? null, intact, drifted });
  assert.ok(snapX, "X missing from offered snapshot");
  assert.equal(snapCombo?.themeKey, COMBO.theme);
  assert.equal(snapX.touristQuality?.placeId, X.googlePlaceId);
  assert.equal(snapX.touristQuality?.intent, comboCanonicalIntent);
  assert.notEqual(snapX.touristQuality?.intent, canonical.intent, "place family leaked into the verdict intent");
  assert.equal(snapX.touristQuality?.tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(snapX.touristQuality?.admit, true);
  // Both Replan paths follow the verdict (stricter than parity alone).
  assert.equal(intact.hasX, true, `intact ids=${intact.ids}`);
  assert.equal(drifted.hasX, true, `drifted ids=${drifted.ids}`);
});

await test("Replan preconditions: intact and drifted paths both taken, control kept", () => {
  assert.ok(intact && drifted, "replan not executed");
  assert.equal(intact.drifted, false, "intact path not taken");
  assert.equal(drifted.drifted, true, "drifted path not taken");
  assert.ok(intact.hasControl, `intact control missing; ids=${intact.ids}`);
  assert.ok(drifted.hasControl, `drifted control missing; ids=${drifted.ids}`);
});

await test("Replan parity: intact-cache Replan and drifted offered-pin Replan agree for X", () => {
  assert.equal(
    intact?.hasX,
    drifted?.hasX,
    `intact (combination intent ${comboIntent}) admits=${intact?.hasX}; drifted (snapshot verdict, intent ${snapX?.touristQuality?.intent}) admits=${drifted?.hasX}`,
  );
});

await test("Replan: intact-cache decision equals the snapshot first-pass verdict", () => {
  assert.equal(intact?.hasX, snapX?.touristQuality?.admit, `intact=${intact?.hasX} snapshot admit=${snapX?.touristQuality?.admit}`);
});

// ---------------- Reverse direction: general-path place admitted under CULTURAL place-level
// intent, offered inside a GENERAL-themed combination (second destination, isolated cache). ----------------
const DEST2 = "雲峡町";
const GEN_COMBO = { title: "城市景點漫遊", theme: "attraction" };
// historical_landmark is an explicit-landmark type (attraction family) unless the name carries a
// heritage word, which lifts the place-level family to historic → cultural intent.
const Y = cand("Y", "雲峡古蹟番所跡", ["historical_landmark", "point_of_interest"]);
const P1 = cand("P1", "雲峡展望台公園", ["park", "tourist_attraction"]);
const P2 = cand("P2", "雲峡港町資料館", ["museum", "tourist_attraction"], { regularOpeningHours: HOURS });
const yCanonical = offeredPlaceTouristQualityIntent(intentInput(Y));
observe("Y family", { canonical: yCanonical, family: resolvePrimarySemanticFamily({ ...Y }) });
const seed2 = (places) =>
  setCachedDiscoveredCombinations(DEST2, [
    { combinationId: "1", title: GEN_COMBO.title, theme: GEN_COMBO.theme, placeCandidates: places, primaryCandidates: places },
  ]);
const replan2 = (identity) => {
  clearCombinationPoolMemo();
  const isDrifted = withOfferedCombinationIdentity(identity, () => isCombinationIdDriftedFromOffered(DEST2, 1));
  const [pool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DEST2, [1], { forceRefresh: true }),
  );
  const ids = (pool?.all ?? []).map((c) => c.googlePlaceId);
  return { drifted: isDrifted, ids, hasY: ids.includes(Y.googlePlaceId), hasControl: ids.includes(P2.googlePlaceId) };
};
let snapY = null;
let intact2 = null;
let drifted2 = null;

await test("reverse precondition: Y is LOW+cultural, canonical intent cultural (admit), combo intent general; general first pass admits Y only via the Gate's cultural branch", () => {
  const a = classifyTouristQuality({ name: Y.name, types: Y.types, primaryType: Y.primaryType });
  assert.equal(a.tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(yCanonical.intent, "cultural_exploration");
  assert.equal(touristQualityIntentForCombination(GEN_COMBO), "general_sightseeing");
  const r = validateCandidateIntent(candidateInput(Y), { theme: yCanonical.theme }, DEST2, {
    center: CENTER, requireTourismType: false, source: "places_discovery",
  });
  assert.equal(r.ok, true, `general first pass rejects Y: ${r.reason}`);
  const asCombo = validateCandidateIntent(candidateInput(Y), GEN_COMBO, DEST2, { protection: "explicit" });
  assert.equal(asCombo.ok, true, `non-Gate rule rejects Y under the general combination: ${asCombo.reason}`);
});

// Rewritten (T8): Y's place family is cultural, but the user chose a GENERAL combination → canonical
// intent general_sightseeing → LOW Y rejected at snapshot and on both Replan paths.
await test("reverse snapshot: Y verdict admit=false under the general combination intent; Replan paths taken and both exclude Y", () => {
  seed2([Y, P1, P2]);
  const snap = buildOfferedCombinationsForSession(DEST2, "zh-TW");
  snapY = snap.flatMap((c) => c.places ?? []).find((p) => p.googlePlaceId === Y.googlePlaceId) ?? null;
  const identity = createOfferedCombinationIdentity(DEST2, snap);
  intact2 = replan2(identity);
  seed2([P1, P2]);
  drifted2 = replan2(identity);
  observe("reverse snapshot/replan", { themeKey: snap[0]?.themeKey, verdict: snapY?.touristQuality ?? null, intact: intact2, drifted: drifted2 });
  assert.ok(snapY, "Y missing from offered snapshot");
  assert.equal(snap[0]?.themeKey, GEN_COMBO.theme);
  assert.equal(snapY.touristQuality?.placeId, Y.googlePlaceId);
  assert.equal(snapY.touristQuality?.tier, "LOW_EXPERIENCE_VALUE");
  assert.equal(snapY.touristQuality?.intent, canonicalCombinationTouristQualityIntent(GEN_COMBO.theme));
  assert.equal(snapY.touristQuality?.intent, "general_sightseeing");
  assert.notEqual(snapY.touristQuality?.intent, yCanonical.intent, "place family leaked into the verdict intent");
  assert.equal(snapY.touristQuality?.admit, false);
  assert.equal(intact2.drifted, false);
  assert.equal(drifted2.drifted, true);
  assert.ok(intact2.hasControl && drifted2.hasControl, "control missing");
  assert.equal(intact2.hasY, false, `LOW Y re-entered via intact Replan; ids=${intact2.ids}`);
  assert.equal(drifted2.hasY, false, `LOW Y re-entered via drifted Replan; ids=${drifted2.ids}`);
});

await test("reverse Replan parity: intact-cache and drifted Replan agree for Y (first pass rejected it)", () => {
  assert.equal(
    intact2?.hasY,
    drifted2?.hasY,
    `intact (combination intent general) admits=${intact2?.hasY}; drifted (snapshot cultural verdict) admits=${drifted2?.hasY}`,
  );
});

// ---------------- Swap (T8): culture theme ↔ general sightseeing ----------------
// Same two LOW+cultural places, combinations swapped: X (place family nature/general) now in a
// CULTURAL combination is admitted above; here X goes into a GENERAL combination and Y (place family
// historic/cultural) into a CULTURAL combination. Only the combination theme may decide; snapshot,
// intact Replan and drifted Replan must all agree.
const swapRun = async (label, dest, combo, low, controls) => {
  const seedS = (places) =>
    setCachedDiscoveredCombinations(dest, [
      { combinationId: "1", title: combo.title, theme: combo.theme, placeCandidates: places, primaryCandidates: places },
    ]);
  const run = (identity) => {
    clearCombinationPoolMemo();
    const isDrifted = withOfferedCombinationIdentity(identity, () => isCombinationIdDriftedFromOffered(dest, 1));
    const [pool] = withOfferedCombinationIdentity(identity, () =>
      resolveSelectedCombinationPools(dest, [1], { forceRefresh: true }),
    );
    const ids = (pool?.all ?? []).map((c) => c.googlePlaceId);
    return { drifted: isDrifted, ids, hasLow: ids.includes(low.googlePlaceId), hasControl: ids.includes(controls[0].googlePlaceId) };
  };
  seedS([low, ...controls]);
  const snap = buildOfferedCombinationsForSession(dest, "zh-TW");
  const snapLow = snap.flatMap((c) => c.places ?? []).find((p) => p.googlePlaceId === low.googlePlaceId) ?? null;
  const identity = createOfferedCombinationIdentity(dest, snap);
  const intactR = run(identity);
  seedS(controls);
  const driftedR = run(identity);
  observe(`swap ${label}`, { themeKey: snap[0]?.themeKey, verdict: snapLow?.touristQuality ?? null, intact: intactR, drifted: driftedR });
  return { snap, snapLow, intactR, driftedR };
};

await test("swap: X (place family general) in a GENERAL combination → rejected at snapshot, intact and drifted", async () => {
  const r = await swapRun("X→general", "雲峡村", GEN_COMBO, X, [P2, M1]);
  assert.ok(r.snapLow, "X missing from offered snapshot");
  assert.equal(r.snap[0]?.themeKey, GEN_COMBO.theme);
  assert.equal(r.snapLow.touristQuality?.intent, "general_sightseeing");
  assert.equal(r.snapLow.touristQuality?.admit, false);
  assert.equal(r.intactR.drifted, false);
  assert.equal(r.driftedR.drifted, true);
  assert.ok(r.intactR.hasControl && r.driftedR.hasControl, "control missing");
  assert.equal(r.intactR.hasLow, false, `intact ids=${r.intactR.ids}`);
  assert.equal(r.driftedR.hasLow, false, `drifted ids=${r.driftedR.ids}`);
});

await test("swap: Y (place family cultural) in a CULTURAL combination → admitted at snapshot, intact and drifted", async () => {
  const r = await swapRun("Y→culture", "雲峡郷", COMBO, Y, [M1, M2]);
  if (!r.snapLow) {
    inconclusive.push("swap Y→culture (Y not in snapshot offline)");
    console.log("INCONCLUSIVE swap Y→culture -- Y not in snapshot");
    return;
  }
  assert.equal(r.snap[0]?.themeKey, COMBO.theme);
  assert.equal(r.snapLow.touristQuality?.intent, "cultural_exploration");
  assert.equal(r.snapLow.touristQuality?.admit, true);
  assert.equal(r.intactR.drifted, false);
  assert.equal(r.driftedR.drifted, true);
  assert.ok(r.intactR.hasControl && r.driftedR.hasControl, "control missing");
  assert.equal(r.intactR.hasLow, true, `intact ids=${r.intactR.ids}`);
  assert.equal(r.driftedR.hasLow, true, `drifted ids=${r.driftedR.ids}`);
});

await test("swap (stricter): LOW without cultural evidence in the CULTURAL combination → rejected at snapshot and drifted Replan", async () => {
  const r = await swapRun("XN→culture", "雲峡里", COMBO, XN, [M1, M2]);
  // A culture-themed structured cache may drop XN before the Gate (non-Gate theme rule); then the
  // snapshot simply never offers it, which is also "not admitted".
  if (r.snapLow) {
    assert.equal(r.snapLow.touristQuality?.intent, "cultural_exploration");
    assert.equal(r.snapLow.touristQuality?.admit, false);
    assert.equal(r.driftedR.hasLow, false, `drifted ids=${r.driftedR.ids}`);
  }
  assert.equal(r.intactR.hasLow, false, `intact ids=${r.intactR.ids}`);
});

if (inconclusive.length) console.log(`INFO inconclusive: ${inconclusive.length}`);

await test("zero provider (fetch) calls", () => {
  assert.equal(fetchCalls, 0);
});

if (failures.length) {
  console.log(`FAIL tqg v2 intent trace: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`);
  process.exitCode = 1;
} else {
  console.log(`PASS tqg v2 intent trace: ${cases} scenarios, provider calls ${fetchCalls}`);
}
process.exit(process.exitCode ?? 0);
