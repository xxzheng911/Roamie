import "./verify-netguard-full.mjs";
/**
 * T-S (tester, independent review). W (working tree) vs H (HEAD snapshot via --head-dir).
 * One section per run (--only=b4|q7|q5i|th) to keep each process short.
 *  b4   dropShortDerivedCombinations (cache path + final filter) / TripPlanEditor withStopDate
 *  q7   Taipei discovery: community filter, sunset title revalidation, counts, search calls
 *  q5i  buildItineraryFromDayPlan single venue at 19:00 -> arrivedAfterLastEntry
 *  th   thin city (Andong) 4-day planner + chat wrapper (x2 = applyLocalFallback re-run) + fallback copy
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=N scripts/verify-ts-review.mjs -- --only=b4 --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const ONLY = argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "b4";
const LIMIT = Number(argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 150);
const out = console.log.bind(console);
const progress = (s) => process.stderr.write(`@@P ${CHILD ? "H" : "W"} ${s}\n`);
for (const k of ["log", "info", "warn", "debug", "error"]) console[k] = () => {};
const armTimer = () => setTimeout(() => { out(`FAIL internal watchdog ${LIMIT}s (${CHILD ? "HEAD child" : "W"})`); process.exit(3); }, LIMIT * 1000).unref();
if (CHILD) armTimer();

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); };
const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: String(e?.message ?? e).split("\n")[0].slice(0, 220) }; } };

const hours = (open, close, days = [0, 1, 2, 3, 4, 5, 6]) => ({
  periods: days.map((day) => ({ open: { day, hour: Math.floor(open / 60), minute: open % 60 }, close: { day, hour: Math.floor(close / 60), minute: close % 60 } })),
  weekdayDescriptions: [],
});
let pid = 0;
const gPlace = ({ name, types, rating = 4.4, reviews = 1500, oh = hours(7 * 60, 22 * 60), lat, lng, addr, tag = "x", spread = 1 }) => {
  pid += 1;
  const bare = `ChIJ${tag}${String(pid).padStart(5, "0")}abcdefghijklmnop`.slice(0, 27);
  return {
    id: `places/${bare}`, placeId: bare, displayName: { text: name }, formattedAddress: addr ?? `${name} 1`,
    location: { latitude: lat + pid * 0.0009 * spread, longitude: lng + pid * 0.0011 * spread }, rating, userRatingCount: reviews,
    primaryType: types[0], types: [...types], regularOpeningHours: oh, utcOffsetMinutes: 480, businessStatus: "OPERATIONAL",
  };
};
const PARK = ["park", "point_of_interest", "establishment"];

async function collect() {
  const R = {};
  // ================= B4 =================
  if (ONLY === "b4") {
    const disc = await import("../src/lib/ai/destination-combination-discovery.ts");
    R.hasDropFn = /dropShortDerivedCombinations/.test(readFileSync("src/lib/ai/destination-combination-discovery.ts", "utf8"));
    let n = 0;
    const cand = (name, types, lat, lng) => { n += 1; return { name, localizedDisplayName: name, googlePlaceId: `ChIJb4${String(n).padStart(4, "0")}abcdefghijklmnopq`.slice(0, 27), coordinates: { lat, lng }, types, primaryType: types[0], rating: 4.5, userRatingCount: 3000, businessStatus: "OPERATIONAL", address: `台北市${name}` }; };
    const grp = (id, title, theme, list) => ({ combinationId: id, title, theme, placeCandidates: list, primaryCandidates: list, fallbackCandidates: [] });
    const temples = () => [cand("龍山寺", ["place_of_worship", "tourist_attraction"], 25.0372, 121.4999), cand("行天宮", ["place_of_worship", "tourist_attraction"], 25.0630, 121.5339), cand("大稻埕霞海城隍廟", ["place_of_worship", "tourist_attraction"], 25.0559, 121.5100)];
    const museums = () => [cand("國立故宮博物院", ["museum", "tourist_attraction"], 25.1024, 121.5485), cand("臺北市立美術館", ["museum", "art_gallery"], 25.0724, 121.5246), cand("國立臺灣博物館", ["museum", "tourist_attraction"], 25.0430, 121.5149)];
    const extra2 = () => [cand("中正紀念堂", ["tourist_attraction", "historical_landmark"], 25.0346, 121.5218), cand("西門町", ["tourist_attraction"], 25.0421, 121.5081)];
    const extra2b = () => [cand("華山1914文化創意產業園區", ["tourist_attraction"], 25.0441, 121.5293), cand("四四南村", ["tourist_attraction"], 25.0312, 121.5620)];
    const extra3child = () => [cand("台北101觀景台", ["tourist_attraction", "observation_deck"], 25.0339, 121.5645), cand("松山文創園區", ["tourist_attraction"], 25.0438, 121.5606), cand("饒河街觀光夜市", ["night_market", "tourist_attraction"], 25.0510, 121.5775)];
    const cacheCase = (combos) => {
      disc.clearDiscoveredCombinationsCache();
      disc.setCachedDiscoveredCombinations("台北", combos);
      const got = disc.getCachedDiscoveredCombinations("台北", undefined, undefined, { locale: "zh-TW" });
      disc.clearDiscoveredCombinationsCache();
      return got ? got.map((c) => `${c.combinationId}(${(c.primaryCandidates ?? c.placeCandidates).length})`) : null;
    };
    R["a pre3+extra2"] = await safe(() => cacheCase([grp("台北:1", "舊城文化組合", "historic", temples()), grp("台北:extra:2", "經典景點組合", "attraction", extra2())]));
    R["b pre3x2+extra2"] = await safe(() => cacheCase([grp("台北:1", "舊城文化組合", "historic", temples()), grp("台北:2", "藝文博物館組合", "culture", museums()), grp("台北:extra:3", "經典景點組合", "attraction", extra2())]));
    R["e1 pre3+extra2+extra2"] = await safe(() => cacheCase([grp("台北:1", "舊城文化組合", "historic", temples()), grp("台北:extra:2", "經典景點組合", "attraction", extra2()), grp("台北:extra:3", "城市散步組合", "attraction", extra2b())]));
    R["e2 pre3x2+extra3(child) -> enforce 2"] = await safe(() => cacheCase([grp("台北:1", "舊城文化組合", "historic", temples()), grp("台北:2", "藝文博物館組合", "culture", museums()), grp("台北:extra:3", "經典景點組合", "attraction", extra3child())]));
    const nature = () => [cand("大安森林公園", ["park", "tourist_attraction"], 25.0300, 121.5357), cand("陽明山國家公園", ["national_park", "park"], 25.1551, 121.5484), cand("象山步道", ["hiking_area", "tourist_attraction"], 25.0274, 121.5707)];
    R["b2 pre3(historic)+pre3(nature)+extra2"] = await safe(() => cacheCase([grp("台北:1", "舊城文化組合", "historic", temples()), grp("台北:2", "城市慢遊組合", "nature", nature()), grp("台北:extra:3", "經典景點組合", "attraction", extra2())]));
    R["e2b pre3(historic)+pre3(nature)+extra3(child)"] = await safe(() => cacheCase([grp("台北:1", "舊城文化組合", "historic", temples()), grp("台北:2", "城市慢遊組合", "nature", nature()), grp("台北:extra:3", "經典景點組合", "attraction", extra3child())]));
    R["why museums: enforce only"] = await safe(() => disc.enforcePlanningCombinationComposition([grp("台北:1", "舊城文化組合", "historic", temples()), grp("台北:2", "藝文博物館組合", "culture", museums()), grp("台北:extra:3", "經典景點組合", "attraction", extra2())]).map((c) => `${c.combinationId}(${(c.primaryCandidates ?? c.placeCandidates).length})`));
    R["why museums: cache skipLocalizationGate"] = await safe(() => { disc.clearDiscoveredCombinationsCache(); disc.setCachedDiscoveredCombinations("台北", [grp("台北:1", "舊城文化組合", "historic", temples()), grp("台北:2", "藝文博物館組合", "culture", museums()), grp("台北:extra:3", "經典景點組合", "attraction", extra2())]); const g = disc.getCachedDiscoveredCombinations("台北", undefined, undefined, { locale: "zh-TW", skipLocalizationGate: true }); disc.clearDiscoveredCombinationsCache(); return g?.map((c) => `${c.combinationId}(${(c.primaryCandidates ?? c.placeCandidates).length})`) ?? null; });
    const lg = await safe(() => import("../src/lib/ai/combination-localization-gate.ts"));
    R["why museums: localization gate only"] = lg.error ? lg : await safe(() => lg.applyCombinationLocalizationGate([grp("台北:1", "舊城文化組合", "historic", temples()), grp("台北:2", "藝文博物館組合", "culture", museums()), grp("台北:extra:3", "經典景點組合", "attraction", extra2())], { locale: "zh-TW", minPlacesPerCombo: 2, minCombinations: 2 }).combinations.map((c) => `${c.combinationId}(${(c.primaryCandidates ?? c.placeCandidates).length})`));
    R["e3 pre2+extra2"] =await safe(() => cacheCase([grp("台北:1", "舊城文化組合", "historic", temples().slice(0, 2)), grp("台北:extra:2", "經典景點組合", "attraction", extra2())]));
    const sunset4 = () => [cand("淡水夕陽觀景台", ["observation_deck", "tourist_attraction"], 25.1700, 121.4400), cand("迪化街", ["tourist_attraction"], 25.0560, 121.5100), cand("寶藏巖國際藝術村", ["tourist_attraction"], 25.0105, 121.5320), cand("剝皮寮歷史街區", ["tourist_attraction"], 25.0370, 121.5010)];
    const sunsetKeep = () => [cand("象山夕陽觀景平臺步道", ["tourist_attraction", "hiking_area"], 25.0270, 121.5760), cand("關渡夕陽碼頭", ["tourist_attraction"], 25.1190, 121.4620), cand("大稻埕夕陽碼頭", ["tourist_attraction"], 25.0560, 121.5080)];
    const titles = (list) => list.map((c) => `${c.combinationId}|${c.title}|${(c.primaryCandidates ?? c.placeCandidates).map((p) => p.name).join("、")}`);
    R["q7b enforce extra 日落 with 觀景台 dropped"] = await safe(() => titles(disc.enforcePlanningCombinationComposition([grp("台北:attraction:1", "經典景點組合", "attraction", extra2b().concat(extra2())), grp("台北:historic:2", "舊城文化組合", "historic", temples()), grp("台北:extra:3", "日落觀景組合", "attraction", sunset4())])));
    R["q7b control extra 日落 still backed"] = await safe(() => titles(disc.enforcePlanningCombinationComposition([grp("台北:historic:1", "舊城文化組合", "historic", temples()), grp("台北:extra:2", "日落觀景組合", "attraction", sunsetKeep())])));
    R["q7b predefined (non-extra) 日落 untouched"] = await safe(() => titles(disc.enforcePlanningCombinationComposition([grp("台北:historic:1", "舊城文化組合", "historic", temples()), grp("台北:nature:2", "日落觀景組合", "attraction", sunset4())])));
    // TripPlanEditor: functions are module-private; exercise withStopDate directly (same call the editor now makes).
    const mut = await safe(() => import("../src/lib/trip/trip-stop-mutations.ts"));
    if (typeof mut.withStopDate === "function") {
      const it = { date: "2026-11-20", time: "19:00", title: "ARTE", placeName: "ARTE", latestArrivalMinutes: 1140, arrivedAfterLastEntry: true };
      const pick = (x) => ({ date: x.date, lam: "latestArrivalMinutes" in x ? x.latestArrivalMinutes : "absent", late: "arrivedAfterLastEntry" in x ? x.arrivedAfterLastEntry : "absent" });
      R["d withStopDate changed"] = pick(mut.withStopDate(it, "2026-11-25"));
      R["d withStopDate same"] = pick(mut.withStopDate(it, "2026-11-20"));
      R["d withStopDate from undefined"] = pick(mut.withStopDate({ ...it, date: undefined }, "2026-11-20"));
      R["d input not mutated"] = pick(it);
    } else R["d withStopDate"] = "not exported";
    const editor = readFileSync("src/components/TripPlanEditor.tsx", "utf8");
    R["d editor spread {...item, date}"] = (editor.match(/\{\s*\.\.\.item,\s*date(?::\s*newIso)?\s*\}/g) ?? []).length;
    R["d editor withStopDate calls"] = (editor.match(/withStopDate\(item,\s*(date|newIso)\)/g) ?? []).length;
  }

  // ================= Q7 =================
  if (ONLY === "q7") {
    progress("q7 import");
    const disc = await import("../src/lib/ai/destination-combination-discovery.ts");
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    const sug = await safe(() => import("../src/lib/ai/destination-combination-suggestions.ts"));
    const gate = await import("../src/lib/ai/tourism-quality-gate.ts");
    const { clearCandidatePoolCache } = await import("../src/lib/ai/places-cost-cache/candidate-pool-cache.ts");
    progress("q7 imported");
    const LAT = 25.0330; const LNG = 121.5654;
    const SPEC = [
      ["龍山寺", ["place_of_worship", "tourist_attraction"], 60000, 4.6], ["行天宮", ["place_of_worship", "tourist_attraction"], 30000, 4.6], ["大稻埕霞海城隍廟", ["place_of_worship", "tourist_attraction"], 9000, 4.5], ["臺北市孔廟", ["place_of_worship", "historical_landmark"], 8000, 4.5],
      ["國立故宮博物院", ["museum", "tourist_attraction"], 70000, 4.6], ["臺北市立美術館", ["museum", "art_gallery"], 20000, 4.5], ["國立臺灣博物館", ["museum", "tourist_attraction"], 15000, 4.5],
      ["大安森林公園", ["park", "tourist_attraction"], 60000, 4.6], ["陽明山國家公園", ["national_park", "park"], 40000, 4.6], ["象山步道", ["hiking_area", "tourist_attraction"], 20000, 4.6],
      ["信義區三張里公園", PARK, 90, 4.1], ["大安社區館", ["tourist_attraction", "point_of_interest"], 60, 4.2], ["興雅里民活動中心", ["community_center", "point_of_interest"], 40, 4.0], ["松山區民權公民會館", ["tourist_attraction", "point_of_interest"], 50, 4.1],
      ["淡水夕陽觀景台", ["observation_deck", "tourist_attraction"], 8000, 4.5], ["關渡夕陽碼頭", ["tourist_attraction"], 3000, 4.4], ["社子島夕陽", ["tourist_attraction"], 2000, 4.3],
      ["中正紀念堂", ["tourist_attraction", "historical_landmark"], 80000, 4.6], ["西門町", ["tourist_attraction"], 50000, 4.4], ["華山1914文化創意產業園區", ["tourist_attraction"], 40000, 4.4], ["松山文創園區", ["tourist_attraction"], 30000, 4.4], ["四四南村", ["tourist_attraction"], 8000, 4.3],
      ["饒河街觀光夜市", ["night_market", "tourist_attraction"], 40000, 4.3], ["士林夜市", ["night_market", "tourist_attraction"], 60000, 4.2],
    ];
    const ATTR_HI = [["中正紀念堂", 80000], ["西門町", 50000], ["華山1914文化創意產業園區", 40000], ["松山文創園區", 30000], ["台北101", 90000], ["國父紀念館", 40000], ["臺北車站", 30000], ["永康街", 20000], ["信義商圈", 25000]].map(([n, r]) => [n, ["tourist_attraction"], r, 4.5]);
    const ATTR8 = [["中正紀念堂", 80000], ["西門町", 50000], ["國家戲劇院", 40000], ["總統府", 30000], ["台北101", 90000], ["國父紀念館", 40000], ["臺北車站", 30000], ["永康街", 20000]].map(([n, r]) => [n, ["tourist_attraction"], r, 4.5]);
    const TAIL4 = [["淡水夕陽觀景台", ["observation_deck", "tourist_attraction"], 300, 4.2], ["迪化街", ["tourist_attraction"], 300, 4.2], ["剝皮寮歷史街區", ["tourist_attraction"], 300, 4.2], ["寶藏巖國際藝術村", ["tourist_attraction"], 300, 4.2]];
    const TEMPLES = SPEC.slice(0, 3);
    const COMMUNITY = SPEC.filter(([n]) => /三張里|社區館|活動中心|公民會館/.test(n));
    const VARIANTS = {
      base: SPEC,
      v4tail: [...TEMPLES, ...ATTR_HI, ...TAIL4, ...COMMUNITY],
      v3tail: [...TEMPLES, ...ATTR_HI, ...TAIL4.slice(0, 3), ...COMMUNITY],
      s4: [...TEMPLES, ...ATTR8, ...TAIL4, ...COMMUNITY],
      s3: [...TEMPLES, ...ATTR8, ...TAIL4.slice(0, 3), ...COMMUNITY],
    };
    const mkPool = (spec = SPEC) => { pid = 0; return normalizeGooglePlaces(spec.map(([name, types, reviews, rating]) => gPlace({ name, types, reviews, rating, lat: LAT - 0.03, lng: LNG - 0.06, addr: `臺灣台北市${name}`, tag: "tpe", spread: 4 }))); };
    R.gate = Object.fromEntries(SPEC.filter(([n]) => /公園|社區館|活動中心|公民會館/.test(n)).map(([name, types, reviews, rating]) => [name, gate.evaluateTourismQuality({ id: `ChIJg${name.length}`, name, types, primaryType: types[0], rating, userRatingCount: reviews, address: `臺灣台北市${name}` })]));
    const scope = { label: "台北", city: "台北市", country: "台灣", countryCode: "TW", type: "city", latitude: LAT, longitude: LNG, placeId: "ChIJmQrivHKsQjQRzaJ1Qm7jkB8", source: "trip_destination", scopeLocked: false };
    const geocodeFn = async () => ({ location: { placeId: "ChIJmQrivHKsQjQRzaJ1Qm7jkB8", country: "台灣", city: "台北市", lat: LAT, lng: LNG, formattedName: "台灣台北市", displayLabel: "台北市", timezone: "Asia/Taipei", utcOffsetMinutes: 480 }, error: null });
    const RUNS = [["base", "ensure", true], ["s4", "ensure", true], ["s3", "ensure", true], ["s3", "discover", true]];
    for (const [variant, api, withScope] of RUNS) {
      {
        const key = `${variant}|${api}|${withScope ? "resolvedScope" : "geocodeOnly"}`;
        progress(`q7 ${key}`);
        disc.clearDiscoveredCombinationsCache(); clearCandidatePoolCache();
        const pool = mkPool(VARIANTS[variant]);
        const c = { calls: 0, topup: 0, lanes: {} };
        const searchPlaces = async (args) => {
          c.calls += 1;
          const lane = args?.data?.placesLane ?? args?.data?.placesCaller ?? "?";
          c.lanes[lane] = (c.lanes[lane] ?? 0) + 1;
          if (lane === "theme_topup" || /theme/.test(args?.data?.placesCaller ?? "")) c.topup += 1;
          return { places: pool, error: null };
        };
        const base = { destination: "台北", destinationCountry: "台灣", locale: "zh-TW", days: 4, searchPlaces, geocodeFn, generationRequestId: `ts-q7-${key}`, ...(withScope ? { resolvedDestination: scope } : {}) };
        R[`run|${key}`] = await safe(async () => {
          const res = api === "ensure" ? await disc.ensureDestinationCombinationsReady(base) : await disc.discoverDestinationCombinations(base);
          const list = api === "ensure" ? res?.combinations : res;
          const ok = api === "ensure" ? res?.ok : Boolean(list?.length);
          const reason = api === "ensure" ? res?.failureReason ?? null : disc.getLastCombinationDiscoveryFailure?.()?.reason ?? null;
          let visible = null;
          if (!sug.error && ok) {
            const p = sug.buildDestinationCombinationSuggestionPayload?.("台北", 4, { locale: "zh-TW" });
            visible = p ? { keys: Object.keys(p).slice(0, 12), text: String(p.displayText ?? "").slice(0, 900) } : null;
          }
          return { ok, reason, calls: c.calls, topupCalls: c.topup, lanes: c.lanes,
            combos: (list ?? []).map((x) => `${x.combinationId}|${x.title}|${(x.primaryCandidates ?? x.placeCandidates).map((p) => p.name).join("、")}`), visible };
        });
      }
    }
  }

  // ================= Q5(i) =================
  if (ONLY === "q5i") {
    progress("q5i import gate");
    await import("../src/lib/ai/tourism-quality-gate.ts");
    await import("../src/lib/ai/ai-classic-landmark-rules.ts");
    progress("q5i import slot");
    const slot = await import("../src/lib/ai/ai-day-plan-slot-rules.ts");
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    progress("q5i import source");
    const src = await import("../src/lib/ai/ai-day-plan-source.ts");
    progress("q5i imported");
    pid = 900;
    const [arte] = normalizeGooglePlaces([gPlace({ lat: 35.1796, lng: 129.0756, tag: "q5i", name: "ARTE MUSEUM BUSAN", types: ["museum", "tourist_attraction", "point_of_interest"], rating: 4.6, reviews: 9000, oh: hours(10 * 60, 20 * 60) })]);
    R.lab = slot.latestArrivalByWeekdayForPlace ? slot.latestArrivalByWeekdayForPlace(arte) : "n/a";
    const FRI = "2026-11-20";
    for (const t of ["17:30", "18:59", "19:00", "19:30"]) {
      const plan = src.composedPlansToAiDayPlan({ composedPlans: [{ day: 1, entries: [{ label: "景點", time: t, name: "ARTE MUSEUM BUSAN", place: arte }] }], destination: "부산", days: 1, planningSessionId: `ts-q5i-${t}` });
      R[`composed|${t}`] = await safe(() => {
        const built = src.buildItineraryFromDayPlan(plan, { startDate: FRI, endDate: FRI, dayDates: [FRI] });
        return { planItems: plan.items.length, planLab: plan.items[0]?.latestArrivalByWeekday ?? null, built: built.map((i) => ({ t: i.placeName, time: i.time, lam: i.latestArrivalMinutes ?? null, late: "arrivedAfterLastEntry" in i ? i.arrivedAfterLastEntry : "absent" })) };
      });
    }
    // direct AiDayPlan (no composition): a 19:00 slot-filler with explicit weekday map
    const direct = { planningSessionId: "ts-q5i-direct", destination: "부산", days: 1, items: [
      { dayIndex: 1, orderIndex: 0, time: "19:00", slotType: "景點", placeId: arte.id, name: "ARTE MUSEUM BUSAN", address: "x", lat: 35.18, lng: 129.07, type: "museum", latestArrivalByWeekday: R.lab && typeof R.lab === "object" ? R.lab : { 5: 1140 } },
      { dayIndex: 1, orderIndex: 1, time: "20:00", slotType: "晚餐", placeId: "ChIJq5irest0000abcdefghijkl", name: "해운대암소갈비집", address: "y", lat: 35.16, lng: 129.16, type: "restaurant" },
    ] };
    R["direct|19:00"] = await safe(() => src.buildItineraryFromDayPlan(direct, { startDate: FRI, endDate: FRI, dayDates: [FRI] }).map((i) => ({ t: i.placeName, time: i.time, lam: i.latestArrivalMinutes ?? null, late: "arrivedAfterLastEntry" in i ? i.arrivedAfterLastEntry : "absent" })));
    R["direct|noDate"] = await safe(() => src.buildItineraryFromDayPlan(direct, { dayDates: [] }).map((i) => ({ t: i.placeName, lam: i.latestArrivalMinutes ?? null, late: "arrivedAfterLastEntry" in i ? i.arrivedAfterLastEntry : "absent" })));
  }

  // ================= TH =================
  if (ONLY === "th") {
    progress("th import");
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    const dtp = await import("../src/lib/ai/destination-trip-planning.ts");
    const { classifyDestinationForPlaceSearch } = await import("../src/lib/ai/landmark-place-strategy.ts");
    const { resetPlannerSession } = await import("../src/lib/ai/planner-session-guard.ts");
    const gate = await import("../src/lib/ai/tourism-quality-gate.ts");
    progress("th imported");
    const ds = await import("../src/lib/ai/destination-scope.ts");
    const de = await import("../src/lib/ai/destination-entity.ts");
    R.labelProbe = Object.fromEntries(["安東", "안동", "안동시", "Andong", "安東市", "慶尚北道安東", "全州", "전주", "慶州", "경주", "釜山"].map((l) => [l, { entity: de.resolveDestinationEntity(l)?.type ?? null, canDiscover: ds.canDiscoverDestinationPlaces(l), gateBlocked: ds.evaluateDestinationScopeGate({ destination: l, destinationType: "city", countryCode: "KR", requestedIntent: "must_visit_places" }).placesCallBlocked }]));
    if (argv.includes("--probe-only")) return R;
    const LAT = 36.5684; const LNG = 128.7294;
    pid = 0;
    const g = (name, types, reviews, rating = 4.3, oh) => gPlace({ name, types, reviews, rating, lat: LAT, lng: LNG, addr: `경상북도 안동시 ${name}`, tag: "andong", oh });
    const FOOD = [["안동찜닭 골목 원조", ["restaurant", "food"], 900], ["맛있는 헛제사밥", ["restaurant", "food"], 500], ["옥야식당", ["restaurant", "food"], 1200], ["안동국시 명가", ["restaurant", "food"], 400], ["간고등어 정식", ["restaurant", "food"], 350], ["신시장 한우", ["restaurant", "food"], 600], ["월영교 식당", ["restaurant", "food"], 300], ["하회 손두부", ["restaurant", "food"], 420], ["안동 갈비골목", ["restaurant", "food"], 800], ["버버리찰떡", ["bakery", "food"], 700]].map(([n, t, c]) => g(n, t, c));
    const CAFE = [["카페 월영", ["cafe", "coffee_shop"], 400], ["안동 한옥카페", ["cafe"], 300], ["낙강물길 카페", ["cafe"], 250], ["커피 하회", ["cafe"], 180]].map(([n, t, c]) => g(n, t, c));
    const ATTR = [["안동하회마을", ["tourist_attraction", "point_of_interest"], 12000, 4.6], ["월영교", ["tourist_attraction", "point_of_interest"], 9000, 4.6], ["도산서원", ["tourist_attraction", "historical_landmark"], 5000, 4.6], ["병산서원", ["tourist_attraction", "historical_landmark"], 3000, 4.6], ["부용대", ["tourist_attraction", "natural_feature"], 1500, 4.6], ["안동민속박물관", ["museum", "tourist_attraction"], 1200, 4.4]].map(([n, t, c, r]) => g(n, t, c, r, hours(9 * 60, 18 * 60)));
    const ORD_SPEC = [["옥동근린공원", PARK, 40, 4.2], ["태화어린이공원", PARK, 22, 4.1], ["용상마을공원", PARK, 30, 4.0], ["정하동네공원", PARK, 35, 4.2], ["명륜소공원", PARK, 18, 4.3], ["강남공원", PARK, 60, 4.2], ["송현공원", PARK, 45, 4.1]];
    const PARKS_ORD = ORD_SPEC.map(([n, t, c, r]) => g(n, t, c, r));
    const PARKS_OK = [["낙동강 음악분수", ["tourist_attraction", "park"], 700, 4.4], ["안동댐 월영공원", ["park", "tourist_attraction"], 1500, 4.4]].map(([n, t, c, r]) => g(n, t, c, r));
    const SHOP = [["안동구시장", ["market", "tourist_attraction"], 3000, 4.3], ["안동 웅부공원", ["park"], 900, 4.3]].map(([n, t, c, r]) => g(n, t, c, r));
    const ALL = normalizeGooglePlaces([...FOOD, ...CAFE, ...ATTR, ...PARKS_ORD, ...PARKS_OK, ...SHOP]);
    R.gateParks = Object.fromEntries(ALL.filter((p) => (p.types ?? []).includes("park")).map((p) => [p.name, gate.evaluateTourismQuality(p).ok]));
    const byType = (re) => ALL.filter((p) => (p.types ?? []).some((t) => re.test(t)));
    const counters = { search: 0, queries: [], callers: {} };
    const searchPlaces = async ({ data }) => {
      counters.search += 1;
      const caller = String(data?.placesCaller ?? data?.caller ?? data?.placesLane ?? "?");
      counters.callers[caller] = (counters.callers[caller] ?? 0) + 1;
      const q = `${data?.query ?? ""} ${(data?.includedTypes ?? []).join(",")} ${data?.mode ?? ""}`.toLowerCase();
      counters.queries.push(q.slice(0, 32));
      let places;
      if (/restaurant|food|美食|餐|맛집|식당|breakfast|lunch|dinner|bakery|早餐|午餐|晚餐/.test(q)) places = byType(/restaurant|food|bakery/);
      else if (/cafe|coffee|咖啡|카페|dessert/.test(q)) places = byType(/cafe|coffee/);
      else if (/museum|博物|美術|gallery/.test(q)) places = byType(/museum/);
      else if (/park|公園|공원|nature|自然|garden|hiking/.test(q)) places = byType(/park|natural/);
      else if (/shop|market|市場|商圈|mall|night/.test(q)) places = byType(/market|shopping/);
      else places = ALL.filter((p) => !(p.types ?? []).some((t) => /restaurant|food|cafe|bakery/.test(t)));
      return { places: places.slice(0, 16), error: null };
    };
    const searchDestinationPlaces = async (params) => {
      const seen = new Set(); const all = [];
      for (const a of (params.attempts?.length ? params.attempts.slice(0, 12) : [{ query: `${params.label} 景點`, includedTypes: ["tourist_attraction"] }, { query: `${params.label} restaurant`, includedTypes: ["restaurant"] }])) {
        const r = await searchPlaces({ data: { query: a.query, includedTypes: a.includedTypes, lat: params.lat, lng: params.lng, mode: a.mode, placesCaller: "searchDestinationPlaces" } });
        for (const p of r.places) if (!seen.has(p.id)) { seen.add(p.id); all.push(p); }
      }
      return all;
    };
    const geocodeFn = async () => ({ location: { placeId: "geocode:andong", country: "대한민국", city: "안동시", lat: LAT, lng: LNG, formattedName: "대한민국 경상북도 안동시", displayLabel: "안동시", timezone: "Asia/Seoul", utcOffsetMinutes: 540 }, error: null });
    const ORD_RE = new RegExp(ORD_SPEC.map(([n]) => n).join("|"));
    const reset = () => { counters.search = 0; counters.queries = []; counters.callers = {}; };
    const snap = () => ({ searchCalls: counters.search, callers: { ...counters.callers }, queries: counters.queries.slice(0, 40) });
    const STYLE = argv.find((a) => a.startsWith("--style="))?.slice(8);
    for (const style of ["mixed", "slow_nature"].filter((s) => !STYLE || s === STYLE)) {
      reset();
      const sessionId = `ts-th-${style}`;
      resetPlannerSession(sessionId);
      progress(`th planner ${style}`);
      if (!argv.includes("--wrapper-only")) R[`planner|${style}`] = await safe(async () => {
        const plan = await dtp.generateTripPlanFromStyle({
          label: "안동", lat: LAT, lng: LNG, locale: "zh-TW", searchPlaces, weather: null,
          context: { destination: "안동", days: 4, country: "대한민국", startDate: "2026-11-20", endDate: "2026-11-23" },
          style, days: 4, caller: "verify.ts.thin", searchContext: { destination: "안동", days: 4 }, geocodeSucceeded: true,
          searchProfile: classifyDestinationForPlaceSearch("안동"), weatherSearchLabel: "안동", templateNameSearchAttempts: () => [],
          searchDestinationPlaces, planningSessionId: sessionId, geocodeFn,
        });
        const composed = plan.composedPlans ?? [];
        const names = composed.flatMap((d) => (d.entries ?? []).map((e) => e.name));
        return {
          ...snap(),
          candidateInsufficient: plan.candidateInsufficient ? { required: plan.candidateInsufficient.requiredCount, available: plan.candidateInsufficient.availableCount, missing: plan.candidateInsufficient.missingCount, affectedDays: plan.candidateInsufficient.affectedDays } : null,
          dayPlanItems: plan.dayPlan?.items?.length ?? 0, dayPlanDays: plan.dayPlan?.days ?? 0,
          perDay: composed.map((d) => `${d.day}:${(d.entries ?? []).map((e) => `${e.time} ${e.label} ${e.name}`).join(" / ")}`),
          poolExpansionExhausted: plan.poolExpansionExhausted ?? null, slowTravel: plan.slowTravel ?? null,
          ordinaryScheduled: names.filter((n) => ORD_RE.test(n)),
        };
      });
      const dpr = await import("../src/lib/ai/destination-place-recommendation.ts");
      const WL = argv.find((a) => a.startsWith("--label="))?.slice(8) ?? "안동";
      const text = style === "mixed" ? `幫我排${WL}4天行程` : `幫我排${WL}4天慢活自然行程`;
      const ctx = { destination: WL, days: 4, planningDaysConfirmed: true, planningTripStyle: style, startDate: "2026-11-20", endDate: "2026-11-23", country: "대한민국", destinationCountry: "KR", destinationType: "city", interests: [] };
      const sessionId2 = `ts-thw-${style}`;
      resetPlannerSession(sessionId2);
      let wrapperSearch = searchPlaces;
      const uc = { planner: 0 };
      if (argv.includes("--unified")) {
        const { createUnifiedSearchPlacesFn } = await import("../src/lib/places-search-unified.ts");
        const unified = createUnifiedSearchPlacesFn(async (args) => searchPlaces(args));
        wrapperSearch = async (args) => { uc.planner += 1; return unified(args); };
      }
      for (const round of [1, 2]) {
        reset(); uc.planner = 0;
        progress(`th wrapper ${style} round${round}`);
        R[`wrapper|${style}|round${round}`] = await safe(async () => {
          const r = await dpr.buildDestinationMustVisitRecommendation({
            destination: WL, userText: text, locale: "zh-TW", context: ctx,
            searchPlaces: wrapperSearch, geocodeFn, fetchWeatherFn: async () => null, planningSessionId: sessionId2, trustedCenter: { lat: LAT, lng: LNG },
          });
          const items = r.dayPlan?.items ?? [];
          if (argv.includes("--unified")) {
            return { plannerCalls: uc.planner, serverCalls: counters.search, distinctCallers: Object.keys(counters.callers).length,
              recs: r.recommendations?.length ?? 0, dayPlanItems: items.length, days: r.dayPlan?.days ?? 0,
              renderSuccess: Boolean(items.length) && (r.recommendations?.length ?? 0) > 0 && r.dayPlan?.days === 4,
              ordinaryScheduled: items.map((i) => i.name).filter((n) => ORD_RE.test(n ?? "")), summary: (r.summary ?? "").slice(0, 300) };
          }
          // _app.chat.tsx renderDestinationReply: itineraryRenderSuccess condition (line ~5578)
          const renderSuccess = Boolean(items.length) && (r.recommendations?.length ?? 0) > 0 && (r.dayPlan?.days ?? 0) > 0 && r.dayPlan.days === 4;
          return { ...snap(), recs: r.recommendations?.length ?? 0, dayPlanItems: items.length, days: r.dayPlan?.days ?? 0, renderSuccess,
            ordinaryScheduled: items.map((i) => i.name).filter((n) => ORD_RE.test(n ?? "")),
            perDay: [1, 2, 3, 4].map((d) => items.filter((i) => i.dayIndex === d).map((i) => `${i.time} ${i.localizedDisplayName || i.name}`).join(" / ")),
            summary: (r.summary ?? "").slice(0, 900) };
        });
      }
      // applyLocalFallback tail (after the second push returns false): local advice builders
      progress(`th fallback copy ${style}`);
      R[`fallback|${style}`] = await safe(async () => {
        const sm = await import("../src/lib/ai/chat-state-machine.ts");
        const te = await import("../src/lib/ai/chat-turn-engine.ts");
        const session = { travelContext: ctx, tripDays: 4, conversationMode: "destination_planning", activeChatIntent: "destination_advice" };
        const pf = await safe(() => sm.resolvePlanningFallbackTurn(text, session, ctx).advice?.reply ?? null);
        const off = await safe(() => te.buildPlanningOfflineReply(ctx, session, text, "zh-TW"));
        const adv = await safe(() => sm.processAdviceTurn(text, session, ctx, undefined, "zh-TW").advice?.reply ?? null);
        const cut = (v) => (typeof v === "string" ? v.slice(0, 500) : v);
        return { planningFallbackTurn: cut(pf), offlineReply: cut(off), adviceTurn: cut(adv) };
      });
    }
  }
  R.fetchCalls = fetchCalls;
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TS_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-ts-review.mjs";
    for (const f of [self, "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const headHasDrop = /dropShortDerivedCombinations/.test(readFileSync(join(headDir, "src/lib/ai/destination-combination-discovery.ts"), "utf8"));
    out(`HEAD snapshot sanity: dropShortDerivedCombinations present=${headHasDrop} (expected false)`);
    const childLimit = Math.max(30, LIMIT - 10);
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", `--only=${ONLY}`, `--limit=${childLimit}`, ...argv.filter((a) => a === "--wrapper-only" || a === "--probe-only" || a === "--unified" || a.startsWith("--label=") || a.startsWith("--style="))], { cwd: headDir, encoding: "utf8", timeout: (childLimit + 15) * 1000, killSignal: "SIGKILL", maxBuffer: 256 << 20 });
    const m = (r.stdout ?? "").match(/@@TS_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    const prog = (r.stderr ?? "").match(/@@P [^\n]*/g) ?? [];
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"} lastProgress=${prog.slice(-1)[0] ?? "-"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: stdout tail=${(r.stdout ?? "").slice(-400)} stderr tail=${(r.stderr ?? "").slice(-600)}`);
  }
  armTimer();
  const WR = await collect();
  const S = (v) => JSON.stringify(v);
  out(`==== section ${ONLY} ====`);
  for (const k of Object.keys(WR)) {
    out(`${k}\n  W=${S(WR[k])}`);
    if (HR) out(`  H=${S(HR[k])}`);
  }
  process.stdout.write("", () => process.exit(0));
}
