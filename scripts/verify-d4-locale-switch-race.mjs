/**
 * D4 — race: device language switches while a combination discovery is in flight.
 *
 * zh-TW discovery starts (searchPlaces held), navigator.language → en-US, the zh results resolve.
 * Expected (D2 round 7): the skipped round writes no old-language cache; the same call re-runs
 * once in the new App language (fresh `:relocale` scope) and caches/returns the en result.
 * A second switch during that re-run → failureReason `locale_switched`.
 *
 * The fake search answers by `args.data.locale` like places-search-unified (zh → zh names,
 * otherwise → en names), so a leak of the old language is observable.
 *
 * Run: npx vite-node scripts/verify-d4-locale-switch-race.mjs --config scripts/vite.verify.config.mjs
 */
import assert from "node:assert/strict";

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug", "error"]) console[k] = () => {};
const watchdog = setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 120_000);
watchdog.unref();
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("NO_NETWORK"); };
const setDeviceLanguage = (language) => Object.defineProperty(globalThis, "navigator", { value: { language }, configurable: true, writable: true });

const discovery = await import(/* @vite-ignore */ "/src/lib/ai/destination-combination-discovery.ts");
const combos = await import(/* @vite-ignore */ "/src/lib/ai/destination-combination-suggestions.ts");
const scopeMod = await import(/* @vite-ignore */ "/src/lib/ai/discovery-search-scope.ts");
const BUDGET = scopeMod.DISCOVERY_REQUEST_BUDGET;

const ROWS = [
  ["tourist_attraction", "Senso-ji", "淺草寺"], ["tourist_attraction", "Meiji Jingu", "明治神宮"],
  ["tourist_attraction", "Tokyo Skytree", "東京晴空塔"], ["park", "Ueno Park", "上野恩賜公園"],
  ["museum", "Tokyo National Museum", "東京國立博物館"], ["tourist_attraction", "Tokyo Tower", "東京鐵塔"],
  ["park", "Shinjuku Gyoen National Garden", "新宿御苑"], ["market", "Tsukiji Outer Market", "築地場外市場"],
  ["market", "Ameya-Yokocho", "阿美橫町"], ["park", "Imperial Palace East Gardens", "皇居東御苑"],
  ["restaurant", "Sushi Dai", "壽司大"], ["museum", "Mori Art Museum", "森美術館"],
  ["restaurant", "Ichiran Shibuya", "一蘭 澀谷店"], ["cafe", "Blue Bottle Coffee Kiyosumi", "藍瓶咖啡 清澄白河"],
];
const pool = (col) => ROWS.map((r, i) => {
  const id = `ChIJD4Race${String(i + 1).padStart(3, "0")}`;
  return {
    id, googlePlaceId: id, placeId: id, name: r[col], address: col === 2 ? "日本東京都" : "Tokyo, Japan",
    lat: 35.68 + (i % 5) * 0.006, lng: 139.76 + Math.floor(i / 5) * 0.006, rating: 4.6, userRatingCount: 6000 + i, photoName: null,
    primaryType: r[0], types: [r[0], "point_of_interest", "establishment"], businessStatus: "OPERATIONAL",
    openStatus: "unknown", openStatusLabel: "", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "",
  };
});
const DEST = "東京";
const ZH = ROWS.map((r) => r[2]);
const EN = ROWS.map((r) => r[1]);
const BUILD = { startDate: "2026-12-10", endDate: "2026-12-12", tentativeDates: false };
const numbered = (t) => t.split("\n").filter((l) => /^\d+\. /.test(l));
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
let failed = false;
function check(name, fn) { try { fn(); out(`PASS ${name}`); } catch (e) { failed = true; out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").join("\n  ")}`); } }

/** Locale-aware fake search (mirrors places-search-unified): zh → pool(2), otherwise pool(1). */
function makeSearch(hold) {
  const calls = { zh: 0, en: 0, other: 0, total: 0, locales: new Set() };
  const fn = async (args) => {
    const loc = String(args?.data?.locale ?? "");
    calls.locales.add(loc || "(none)");
    calls.total++;
    const key = loc.startsWith("zh") ? "zh" : loc.startsWith("en") ? "en" : "other";
    calls[key]++;
    const h = hold?.(key);
    if (h) await h;
    return { places: key === "zh" ? pool(2) : pool(1), error: null };
  };
  return { fn, calls };
}
const deferred = () => { let release; const p = new Promise((r) => { release = r; }); return { p, release }; };
const enCache = () => discovery.getCachedDiscoveredCombinations(DEST, undefined, undefined, { log: false, locale: "en" });
const zhCache = () => discovery.getCachedDiscoveredCombinations(DEST, undefined, undefined, { log: false, locale: "zh-TW" });
/** Cache is keyed by destination; raw entry (no locale gate) shows what was actually written. */
const rawCache = () => discovery.getCachedDiscoveredCombinations(DEST, undefined, undefined, { log: false, skipLocalizationGate: true });
const namesOf = (list) => (list ?? []).flatMap((c) => (c.primaryCandidates ?? c.placeCandidates ?? []).map((p) => p.name));

// ===== Baselines (no switch): call counts that the switch path's first round must equal =====
discovery.clearDiscoveredCombinationsCache();
setDeviceLanguage("zh-TW");
discovery.getCachedDiscoveredCombinations(DEST);
const baseDiscover = makeSearch();
await discovery.discoverDestinationCombinations({ destination: DEST, locale: "zh-TW", searchPlaces: baseDiscover.fn });
discovery.clearDiscoveredCombinationsCache();
const baseEnsure = makeSearch();
await discovery.ensureDestinationCombinationsReady({ destination: DEST, locale: "zh-TW", days: 3, searchPlaces: baseEnsure.fn });
out(`baseline zh no-switch: discover calls=${baseDiscover.calls.total} ensure calls=${baseEnsure.calls.total} locales=${[...baseDiscover.calls.locales]}`);
check("baseline (no switch) only searches zh, no relocale round", () => {
  assert.equal(baseDiscover.calls.en + baseDiscover.calls.other, 0);
  assert.equal(baseEnsure.calls.en + baseEnsure.calls.other, 0);
  assert.ok(baseDiscover.calls.total > 0 && baseEnsure.calls.total > 0);
});

// ===== Race A — discover entry: zh in flight → en =====
discovery.clearDiscoveredCombinationsCache();
setDeviceLanguage("zh-TW");
discovery.getCachedDiscoveredCombinations(DEST);
const gA = deferred();
const sA = makeSearch((k) => (k === "zh" ? gA.p : undefined));
const runA = discovery.discoverDestinationCombinations({ destination: DEST, locale: "zh-TW", generationRequestId: "d6_gen_A", searchPlaces: sA.fn });
await tick();
setDeviceLanguage("en-US");
discovery.getCachedDiscoveredCombinations(DEST); // a render after the switch
gA.release();
const resA = await runA;
out(`race A (discover): zh calls=${sA.calls.zh} en(relocale) calls=${sA.calls.en} other=${sA.calls.other} result combos=${resA?.length ?? "null"} lastFailure=${JSON.stringify(discovery.getLastCombinationDiscoveryFailure())}`);
check("race A: returned result is the en re-run (non-empty, en names only)", () => {
  assert.ok(Array.isArray(resA) && resA.length >= 2, `result=${resA?.length ?? "null"}`);
  const n = namesOf(resA);
  assert.deepEqual(n.filter((x) => ZH.includes(x)), [], "zh names in returned result");
  assert.ok(n.filter((x) => EN.includes(x)).length >= 3, `en names=${JSON.stringify(n)}`);
});
check("race A (L67): skipped round wrote no old-language cache; en re-run result is cached", () => {
  assert.deepEqual(namesOf(rawCache()).filter((x) => ZH.includes(x)), [], "zh-TW names written by the skipped round");
  const n = namesOf(enCache());
  assert.ok(n.length > 0, "en re-run result not cached");
  assert.deepEqual(n.filter((x) => ZH.includes(x)), [], "zh names in en cache");
});
const raceARawZh = namesOf(rawCache()).filter((x) => ZH.includes(x));
check("race A (L100): re-run searched in en (> 0), extra <= budget, first round <= baseline", () => {
  assert.ok(sA.calls.en > 0, `en calls=${sA.calls.en}`);
  assert.ok(sA.calls.en <= BUDGET, `en calls=${sA.calls.en} > ${BUDGET}`);
  assert.ok(sA.calls.zh <= baseDiscover.calls.total, `first round zh=${sA.calls.zh} vs baseline=${baseDiscover.calls.total}`);
  assert.equal(sA.calls.other, 0);
});
for (const [tag, opts] of [["locale=en", { locale: "en", ...BUILD }], ["locale=device(en)", { ...BUILD }]]) {
  const p = combos.buildDestinationCombinationSuggestionPayload(DEST, 3, opts);
  const t = p?.displayText ?? "";
  out(`  race A payload (${tag}): ${p ? `${numbered(t).length} numbered lines` : "null"}`);
  for (const l of numbered(t)) out(`    ${l}`);
  check(`race A payload (${tag}) (L81): non-null list, no zh-TW names, en names shown`, () => {
    assert.ok(p, "payload is null → route would show a failure reply");
    assert.ok(numbered(t).length >= 2, `numbered combos=${numbered(t).length}`);
    assert.deepEqual(ZH.filter((n) => t.includes(n)), [], "old-locale names shown");
    assert.ok(EN.filter((n) => t.includes(n)).length >= 3, "en names missing");
  });
}

// ===== next en query after the re-run: same locale +0 =====
const sNext = makeSearch();
await discovery.discoverDestinationCombinations({ destination: DEST, locale: "en", searchPlaces: sNext.fn });
const text = combos.buildDestinationCombinationSuggestionPayload(DEST, 3, { locale: "en", ...BUILD })?.displayText ?? "";
check("next en query (L95/L101): +0 searches, list en-only with en names", () => {
  assert.equal(sNext.calls.total, 0, `calls=${sNext.calls.total}`);
  assert.deepEqual(ZH.filter((n) => text.includes(n)), [], "zh names leaked");
  assert.ok(EN.filter((n) => text.includes(n)).length >= 3, "en names missing");
});
const sRep1 = makeSearch(); const sRep2 = makeSearch();
await discovery.discoverDestinationCombinations({ destination: DEST, locale: "en", searchPlaces: sRep1.fn });
discovery.getCachedDiscoveredCombinations(DEST);
await discovery.ensureDestinationCombinationsReady({ destination: DEST, locale: "en", days: 3, searchPlaces: sRep2.fn });
check("same locale (en) repeat discover + ensure: +0", () => {
  assert.equal(sRep1.calls.total, 0); assert.equal(sRep2.calls.total, 0);
});

// ===== zh-TW no-switch after returning: write happens, repeat +0 =====
setDeviceLanguage("zh-TW");
discovery.getCachedDiscoveredCombinations(DEST);
const zA = makeSearch(); const zB = makeSearch();
await discovery.discoverDestinationCombinations({ destination: DEST, locale: "zh-TW", searchPlaces: zA.fn });
await discovery.discoverDestinationCombinations({ destination: DEST, locale: "zh-TW", searchPlaces: zB.fn });
check("zh-TW no switch: first run == baseline, repeat +0, no relocale", () => {
  assert.equal(zA.calls.total, baseDiscover.calls.total, `zA=${zA.calls.total}`);
  assert.equal(zA.calls.en, 0);
  assert.equal(zB.calls.total, 0);
  assert.ok(zhCache()?.length, "zh cache written");
});

// ===== Race B — ensure entry (route): zh in flight → en =====
discovery.clearDiscoveredCombinationsCache();
setDeviceLanguage("zh-TW");
discovery.getCachedDiscoveredCombinations(DEST);
const gB = deferred();
const sB = makeSearch((k) => (k === "zh" ? gB.p : undefined));
const runB = discovery.ensureDestinationCombinationsReady({ destination: DEST, locale: "zh-TW", days: 3, generationRequestId: "d6_gen_B", searchPlaces: sB.fn });
await tick();
setDeviceLanguage("en-US");
discovery.getCachedDiscoveredCombinations(DEST);
gB.release();
const resB = await runB;
out(`race B (ensure): zh calls=${sB.calls.zh} en calls=${sB.calls.en} ok=${resB.ok} source=${resB.source} failureReason=${resB.failureReason ?? ""}`);
{
  const p = combos.buildDestinationCombinationSuggestionPayload(DEST, 3, { locale: "en", ...BUILD });
  const t = p?.displayText ?? "";
  for (const l of numbered(t)) out(`    ${l}`);
  check("race B (L149): ensure ok, no failure, payload en-only with en names, no zh cache", () => {
    assert.equal(resB.ok, true, `ok=${resB.ok} reason=${resB.failureReason}`);
    assert.equal(resB.failureReason, undefined);
    assert.deepEqual(namesOf(resB.combinations).filter((x) => ZH.includes(x)), [], "zh names in ensure result");
    assert.ok(p && numbered(t).length >= 2, "payload null/empty");
    assert.deepEqual(ZH.filter((n) => t.includes(n)), []);
    assert.ok(EN.filter((n) => t.includes(n)).length >= 3, "en names missing");
    assert.deepEqual(namesOf(rawCache()).filter((x) => ZH.includes(x)), [], "zh names written to cache");
    assert.deepEqual(namesOf(enCache()).filter((x) => ZH.includes(x)), []);
  });
  check("race B cost: en re-run > 0 and <= budget; first round <= baseline", () => {
    assert.ok(sB.calls.en > 0 && sB.calls.en <= BUDGET, `en=${sB.calls.en}`);
    assert.ok(sB.calls.zh <= baseEnsure.calls.total, `zh=${sB.calls.zh} vs ${baseEnsure.calls.total}`);
  });
}

// ===== Race C — double switch (zh → en during round 1, en → ja during re-run) =====
async function doubleSwitch(entry) {
  discovery.clearDiscoveredCombinationsCache();
  setDeviceLanguage("zh-TW");
  discovery.getCachedDiscoveredCombinations(DEST);
  const g1 = deferred(); const g2 = deferred();
  const s = makeSearch((k) => (k === "zh" ? g1.p : k === "en" ? g2.p : undefined));
  const params = { destination: DEST, locale: "zh-TW", days: 3, generationRequestId: `d6_gen_C_${entry}`, searchPlaces: s.fn };
  const run = entry === "ensure" ? discovery.ensureDestinationCombinationsReady(params) : discovery.discoverDestinationCombinations(params);
  await tick();
  setDeviceLanguage("en-US");
  g1.release();
  for (let i = 0; i < 100 && s.calls.en === 0; i++) await tick(10);
  setDeviceLanguage("ja-JP");
  g2.release();
  const res = await run;
  return { res, s };
}
for (const entry of ["discover", "ensure"]) {
  const { res, s } = await doubleSwitch(entry);
  const f = discovery.getLastCombinationDiscoveryFailure();
  out(`race C (${entry}): zh=${s.calls.zh} en=${s.calls.en} other=${s.calls.other} result=${JSON.stringify(entry === "ensure" ? { ok: res.ok, failureReason: res.failureReason } : res?.length ?? null)} lastFailure=${JSON.stringify(f)}`);
  check(`race C (${entry}): second switch → locale_switched, no cache, no third round`, () => {
    if (entry === "ensure") { assert.equal(res.ok, false); assert.equal(res.failureReason, "locale_switched"); }
    else assert.equal(res, null);
    assert.equal(f?.reason, "locale_switched");
    assert.equal(namesOf(rawCache()).length, 0, "a cache entry was written");
    assert.equal(s.calls.other, 0, "a third (ja) round ran");
    assert.ok(s.calls.en > 0 && s.calls.en <= BUDGET);
  });
}

// ===== Control: en-only run, no switch — are zh names in the raw cache anyway? =====
{
  discovery.clearDiscoveredCombinationsCache();
  setDeviceLanguage("en-US");
  discovery.getCachedDiscoveredCombinations(DEST);
  const s = makeSearch();
  await discovery.discoverDestinationCombinations({ destination: DEST, locale: "en", searchPlaces: s.fn });
  const ctl = namesOf(rawCache()).filter((x) => ZH.includes(x));
  out(`control en no-switch: calls=${s.calls.total} raw zh names=${JSON.stringify(ctl)} (race A raw zh=${JSON.stringify(raceARawZh)})`);
  check("control: race A raw cache has no more zh names than an en-only run", () => assert.deepEqual(raceARawZh.filter((x) => !ctl.includes(x)), []));
}

// ===== locale_switched reply copy (advice: null payload → buildDestinationRecommendationFailedMessage) =====
for (const loc of ["zh-TW", "en", "ja", "ko"]) {
  const switched = discovery.buildDestinationRecommendationFailedMessage(DEST, "locale_switched", loc);
  const searchFail = discovery.buildDestinationRecommendationFailedMessage(DEST, "place_discovery_failed", loc);
  out(`  reply(${loc}, locale_switched)=${JSON.stringify(switched)}`);
  check(`locale_switched reply (${loc}): non-blank`, () => assert.ok(switched.trim().length > 0));
  check(`locale_switched reply (${loc}): not the search-failure copy`, () => assert.notEqual(switched, searchFail, "locale_switched is shown as a Places/search failure"));
}

try { assert.equal(fetchCalls, 0); out("PASS no network"); } catch (e) { failed = true; out(`FAIL no network ${fetchCalls}`); }
process.exit(failed ? 1 : 0);
