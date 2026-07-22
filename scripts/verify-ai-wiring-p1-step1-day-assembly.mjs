#!/usr/bin/env node
/**
 * AI 接線 P1 Step 1 — Planner 日組裝（路線／容量／近郊／canonical 去重）
 *
 * 不開 Recommendation Validator / Itinerary Validator / PIE Search。
 * 不驗證 Recommendation Engine 權重。
 *
 * 執行：npm run verify:ai-wiring-p1-step1-day-assembly
 */
import assert from "node:assert/strict";
import { distanceMeters } from "../src/lib/geo-distance.ts";
import {
  applyPlannerRouteAndCapacityAssembly,
  buildDayPreferredPools,
  minEffectivePlacesPerDay,
  orderPlacesNearestNeighbor,
  placeMatchesNearbyExtension,
  resolveNearbyExtensionDay,
} from "../src/lib/ai/planner-day-route-assembly.ts";
import { distributeTripPlacesAcrossDays } from "../src/lib/ai/trip-place-scoring.ts";
import {
  dedupeByCanonicalLandmark,
  requiredCanonicalCandidatesForTrip,
  resolveCanonicalLandmarkKey,
} from "../src/lib/ai/canonical-landmark.ts";
import {
  buildMixedItineraryFromPlaces,
  buildMixedItineraryWithDiagnostics,
} from "../src/lib/trip/mixed-itinerary-schedule.ts";
import {
  buildItineraryFromDayPlan,
  composedPlansToAiDayPlan,
} from "../src/lib/ai/ai-day-plan-source.ts";
import {
  buildThemedMultiDayPlans,
  ensureEveryDayPopulated,
  redistributePlacesEvenly,
} from "../src/lib/ai/ai-multi-day-planner.ts";
import {
  setRecEnginePlannerEnabledOverride,
} from "../src/lib/recommendation/engine/index.ts";
import {
  computeFirstRoundPlaceMapCap,
  computeItineraryResolvedTarget,
} from "../src/lib/ai/place-map-queue.ts";
import { calculateDynamicStopCapacity } from "../src/lib/ai/real-place-supplement.ts";
import { redistributeToFillEmptyDays } from "../src/lib/ai/combination-itinerary-integrity.ts";
import { buildFallbackItineraryFromPlaces } from "../src/lib/trip/itinerary-guards.ts";
import { generateTripPlanFromStyle } from "../src/lib/ai/destination-trip-planning.ts";
import { resetPlannerSession } from "../src/lib/ai/planner-session-guard.ts";
import { classifyDestinationForPlaceSearch } from "../src/lib/ai/landmark-place-strategy.ts";
import {
  STYLE_PER_QUERY_KEEP,
  buildAttemptsForStyleKind,
  buildNightScenerySearchAttempts,
  countPlacesByPlanKind,
  formatKindCounts,
  resolveStyleSearchKinds,
  underrepresentedKinds,
} from "../src/lib/ai/style-candidate-diversity.ts";
import {
  GEO_MAX_CLUSTER_SHARE,
  isGeoHubSaturated,
  matchPlaceToGeoHub,
  pickNextGeoHub,
  resolveGeoHubsForDestination,
  scopeAttemptToGeoHub,
  underrepresentedGeoHubs,
} from "../src/lib/ai/style-geo-diversity.ts";
import { kindsForStyle } from "../src/lib/ai/ai-day-plan-source.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

let placeSeq = 0;
function place(partial) {
  placeSeq += 1;
  const suffix = String(partial.id ?? placeSeq)
    .replace(/[^A-Za-z0-9_-]/g, "")
    .padEnd(16, "x")
    .slice(0, 16);
  const id =
    partial.id && String(partial.id).startsWith("ChIJ")
      ? partial.id
      : `ChIJ${suffix}${String(placeSeq).padStart(6, "0")}`;
  return {
    address: null,
    photoName: "photos/verify",
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: true,
    userRatingCount: 200,
    rating: 4.4,
    ...partial,
    id,
  };
}

/** 東京下町／山手／橫濱座標 fixture（刻意交錯 Engine 順序） */
function tokyoYokohamaPool() {
  return [
    place({
      id: "asakusa",
      name: "淺草寺",
      lat: 35.7148,
      lng: 139.7967,
      address: "東京都台東区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction", "place_of_worship"],
    }),
    place({
      id: "yamashita",
      name: "山下公園",
      lat: 35.4459,
      lng: 139.6498,
      address: "横浜市中区",
      primaryType: "park",
      types: ["park"],
    }),
    place({
      id: "skytree",
      name: "東京晴空塔",
      lat: 35.7101,
      lng: 139.8107,
      address: "東京都墨田区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "minatomirai",
      name: "橫濱未來港",
      lat: 35.4577,
      lng: 139.6322,
      address: "横浜市西区みなとみらい",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "shibuya",
      name: "澀谷十字路口",
      lat: 35.6595,
      lng: 139.7005,
      address: "東京都渋谷区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "chinatown",
      name: "橫濱中華街",
      lat: 35.4429,
      lng: 139.6462,
      address: "横浜市中区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction", "market"],
    }),
    place({
      id: "ueno",
      name: "上野公園",
      lat: 35.7142,
      lng: 139.7731,
      address: "東京都台東区",
      primaryType: "park",
      types: ["park"],
    }),
    place({
      id: "shinjuku",
      name: "新宿御苑",
      lat: 35.6852,
      lng: 139.7101,
      address: "東京都新宿区",
      primaryType: "park",
      types: ["park"],
    }),
    place({
      id: "redbrick",
      name: "橫濱紅磚倉庫",
      lat: 35.4527,
      lng: 139.6433,
      address: "横浜市中区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "ginza",
      name: "銀座",
      lat: 35.6717,
      lng: 139.765,
      address: "東京都中央区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "akihabara",
      name: "秋葉原",
      lat: 35.6984,
      lng: 139.7731,
      address: "東京都千代田区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "odaiba",
      name: "台場海濱公園",
      lat: 35.6295,
      lng: 139.7765,
      address: "東京都港区",
      primaryType: "park",
      types: ["park"],
    }),
    place({
      id: "harajuku",
      name: "原宿竹下通",
      lat: 35.6702,
      lng: 139.7027,
      address: "東京都渋谷区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "meiji",
      name: "明治神宮",
      lat: 35.6764,
      lng: 139.6993,
      address: "東京都渋谷区",
      primaryType: "place_of_worship",
      types: ["place_of_worship"],
    }),
    place({
      id: "roppongi",
      name: "六本木之丘",
      lat: 35.6605,
      lng: 139.7292,
      address: "東京都港区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "imperial",
      name: "皇居外苑",
      lat: 35.6812,
      lng: 139.7521,
      address: "東京都千代田区",
      primaryType: "park",
      types: ["park"],
    }),
    place({
      id: "tokyo-st",
      name: "東京車站",
      lat: 35.6812,
      lng: 139.7671,
      address: "東京都千代田区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "teamlab",
      name: "teamLab Planets",
      lat: 35.6495,
      lng: 139.7875,
      address: "東京都江東区",
      primaryType: "museum",
      types: ["museum"],
    }),
    place({
      id: "kappabashi",
      name: "合羽橋道具街",
      lat: 35.717,
      lng: 139.789,
      address: "東京都台東区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "yanaka",
      name: "谷中銀座",
      lat: 35.726,
      lng: 139.769,
      address: "東京都台東区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "tsukiji",
      name: "築地場外市場",
      lat: 35.6654,
      lng: 139.7707,
      address: "東京都中央区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction", "market"],
    }),
  ];
}

function tokyoOnlyPool() {
  return tokyoYokohamaPool().filter((p) => !placeMatchesNearbyExtension(p, ["橫濱"]));
}

function maxAdjacentLegM(entries) {
  let max = 0;
  for (let i = 1; i < entries.length; i += 1) {
    const a = entries[i - 1].place;
    const b = entries[i].place;
    if (a.lat == null || b.lat == null) continue;
    const d = distanceMeters(
      { lat: a.lat, lng: a.lng },
      { lat: b.lat, lng: b.lng },
    );
    if (d > max) max = d;
  }
  return max;
}

function yokohamaDayCounts(plans) {
  const byDay = new Map();
  for (const plan of plans) {
    let n = 0;
    for (const e of plan.entries) {
      if (placeMatchesNearbyExtension(e.place, ["橫濱"])) n += 1;
    }
    byDay.set(plan.day, n);
  }
  return byDay;
}

console.info("[verify:ai-wiring-p1-step1-day-assembly] Planner day assembly\n");

test("minEffectivePlacesPerDay: normal=3, slow=2", () => {
  assert.equal(minEffectivePlacesPerDay("medium"), 3);
  assert.equal(minEffectivePlacesPerDay("slow"), 2);
  assert.equal(minEffectivePlacesPerDay("active"), 3);
});

test("orderPlacesNearestNeighbor reduces fold-back vs unsorted cross-region list", () => {
  const messy = [
    place({ id: "a", name: "淺草", lat: 35.7148, lng: 139.7967 }),
    place({ id: "b", name: "橫濱", lat: 35.4437, lng: 139.638 }),
    place({ id: "c", name: "晴空塔", lat: 35.7101, lng: 139.8107 }),
  ];
  const { ordered, longLegs } = orderPlacesNearestNeighbor(messy, 12_000);
  assert.equal(ordered.length, 3);
  // 淺草與晴空塔應相鄰；橫濱在端點
  const names = ordered.map((p) => p.name);
  const asakusaIdx = names.indexOf("淺草");
  const skyIdx = names.indexOf("晴空塔");
  assert.equal(Math.abs(asakusaIdx - skyIdx), 1);
  assert.ok(longLegs.length >= 1, "expects a long leg involving Yokohama");
});

test("placeMatchesNearbyExtension detects Yokohama by address/coords", () => {
  const y = place({
    id: "y1",
    name: "山下公園",
    lat: 35.4459,
    lng: 139.6498,
    address: "横浜市中区",
  });
  const t = place({
    id: "t1",
    name: "淺草寺",
    lat: 35.7148,
    lng: 139.7967,
    address: "東京都台東区",
  });
  assert.equal(placeMatchesNearbyExtension(y, ["橫濱"]), "橫濱");
  assert.equal(placeMatchesNearbyExtension(t, ["橫濱"]), null);
});

function seedPlansFromPools(pool, days, nearbyExtensions) {
  const preferred = buildDayPreferredPools(pool, days, nearbyExtensions);
  const used = new Set();
  const plans = [];
  for (let day = 1; day <= days; day += 1) {
    const entries = [];
    const dayPool = preferred.get(day) ?? [];
    for (const p of dayPool) {
      if (entries.length >= 4) break;
      const id = p.id ?? p.name;
      if (!id || used.has(id)) continue;
      used.add(id);
      entries.push({ time: "10:00", label: "景點", name: p.name, place: p });
    }
    // 交錯污染：故意把遠方點塞進 Day1（模擬組裝前問題）
    if (day === 1 && nearbyExtensions?.includes("橫濱")) {
      const y = pool.find((p) => placeMatchesNearbyExtension(p, ["橫濱"]));
      if (y && !used.has(y.id)) {
        entries.push({ time: "16:00", label: "景點", name: y.name, place: y });
        used.add(y.id);
      }
    }
    plans.push({ day, entries });
  }
  return plans;
}

test("Case A: 東京 6 天 + 組合近郊橫濱 — 容量／橫濱集中／同日無跨區折返", () => {
  const pool = tokyoYokohamaPool();
  const seeded = seedPlansFromPools(pool, 6, ["橫濱"]);
  // 再故意把橫濱點散到多天
  const yExtra = pool.filter((p) => placeMatchesNearbyExtension(p, ["橫濱"]));
  if (yExtra[1]) {
    seeded[1].entries.push({
      time: "14:00",
      label: "景點",
      name: yExtra[1].name,
      place: yExtra[1],
    });
  }

  const result = applyPlannerRouteAndCapacityAssembly({
    plans: seeded,
    pool,
    days: 6,
    style: "mixed",
    nearbyExtensions: ["橫濱"],
    pace: "medium",
  });
  assert.equal(result.plans.length, 6);

  for (const plan of result.plans) {
    assert.notEqual(
      plan.entries.length,
      1,
      `day ${plan.day} must not be a singleton, got ${plan.entries.length}`,
    );
    assert.ok(
      plan.entries.length >= 2,
      `day ${plan.day} should have >=2 places, got ${plan.entries.length}`,
    );
  }
  assert.equal(
    result.candidateInsufficient,
    false,
    "expanded Tokyo+Yokohama pool should not report candidateInsufficient",
  );

  const yCounts = yokohamaDayCounts(result.plans);
  const daysWithYokohama = [...yCounts.entries()].filter(([, n]) => n > 0);
  assert.ok(
    daysWithYokohama.length <= 1,
    `Yokohama should concentrate on one day, got ${JSON.stringify([...yCounts])}`,
  );
  if (daysWithYokohama.length === 1) {
    const [, n] = daysWithYokohama[0];
    assert.ok(n >= 2 && n <= 4, `Yokohama day should have 2–4 Yokohama places, got ${n}`);
  }

  const nearbyDay = resolveNearbyExtensionDay(6);
  for (const plan of result.plans) {
    if (plan.day === nearbyDay) continue;
    const maxLeg = maxAdjacentLegM(plan.entries);
    assert.ok(
      maxLeg <= 22_000 || plan.entries.length <= 1,
      `day ${plan.day} adjacent leg ${Math.round(maxLeg)}m too long (fold-back)`,
    );
  }
});

test("Case B: 東京 6 天無近郊 — 每天 ≥3 且同區分組合理", () => {
  const pool = tokyoOnlyPool();
  while (pool.length < 24) {
    const base = pool[pool.length % tokyoOnlyPool().length];
    pool.push(
      place({
        ...base,
        id: `${base.id}-x${pool.length}`,
        name: `${base.name}分館${pool.length}`,
        lat: base.lat + (pool.length % 5) * 0.002,
        lng: base.lng + (pool.length % 5) * 0.002,
      }),
    );
  }

  const result = applyPlannerRouteAndCapacityAssembly({
    plans: Array.from({ length: 6 }, (_, i) => ({
      day: i + 1,
      entries: [],
    })),
    pool,
    days: 6,
    style: "mixed",
    pace: "medium",
  });

  for (const plan of result.plans) {
    assert.ok(
      plan.entries.length >= 3,
      `day ${plan.day} need >=3, got ${plan.entries.length}`,
    );
  }

  const buckets = distributeTripPlacesAcrossDays(pool, {
    style: "mixed",
    days: 6,
    vibe: "either",
    pace: "medium",
    centerLat: 35.6762,
    centerLng: 139.6503,
    plusContext: null,
  });
  for (const b of buckets) {
    assert.ok(b.names.length >= 3, `bucket day ${b.day} >=3, got ${b.names.length}`);
  }
});

test("Case C: 候選不足 — 不得靜默產生單點日，必須標記 insufficient", () => {
  const tiny = [
    place({
      id: "only1",
      name: "唯一景點",
      lat: 35.68,
      lng: 139.76,
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "only2",
      name: "第二景點",
      lat: 35.69,
      lng: 139.77,
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
  ];

  const result = applyPlannerRouteAndCapacityAssembly({
    plans: [
      {
        day: 1,
        entries: [
          { time: "10:00", label: "景點", name: tiny[0].name, place: tiny[0] },
        ],
      },
      {
        day: 2,
        entries: [
          { time: "10:00", label: "景點", name: tiny[1].name, place: tiny[1] },
        ],
      },
      { day: 3, entries: [] },
    ],
    pool: tiny,
    days: 3,
    style: "mixed",
    pace: "medium",
  });

  assert.equal(result.candidateInsufficient, true);
  for (const plan of result.plans) {
    assert.notEqual(
      plan.entries.length,
      1,
      `day ${plan.day} must not silently keep a singleton day`,
    );
  }
});

test("buildDayPreferredPools concentrates Yokohama on nearby day", () => {
  const pools = buildDayPreferredPools(tokyoYokohamaPool(), 6, ["橫濱"]);
  const nearbyDay = resolveNearbyExtensionDay(6);
  const nearbyNames = (pools.get(nearbyDay) ?? []).map((p) => p.name);
  assert.ok(nearbyNames.some((n) => /橫濱|横浜|山下|中華|紅磚|未來/.test(n)));
  for (const [day, list] of pools) {
    if (day === nearbyDay) continue;
    for (const p of list) {
      assert.equal(
        placeMatchesNearbyExtension(p, ["橫濱"]),
        null,
        `day ${day} should not hold Yokohama place ${p.name}`,
      );
    }
  }
});

// ── Case B: 同義地標去重（分配前）──
test("Case B: canonical landmark dedup — Skytree family keeps one, continues with others", () => {
  const pool = [
    place({
      id: "sky1",
      name: "東京晴空塔",
      lat: 35.7101,
      lng: 139.8107,
      address: "東京都墨田区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "sky2",
      name: "東京晴空塔城",
      lat: 35.7103,
      lng: 139.8109,
      address: "東京都墨田区",
      primaryType: "shopping_mall",
      types: ["shopping_mall"],
    }),
    place({
      id: "sky3",
      name: "Tokyo Skytree",
      lat: 35.71005,
      lng: 139.81065,
      address: "Sumida, Tokyo",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "ameyoko",
      name: "上野阿美橫商店街",
      lat: 35.7107,
      lng: 139.7745,
      address: "東京都台東区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction", "market"],
    }),
  ];
  const keys = pool.map((p) => resolveCanonicalLandmarkKey(p));
  assert.equal(keys[0], keys[1], "晴空塔 / 晴空塔城 same canonical key");
  assert.equal(keys[0], keys[2], "晴空塔 / Tokyo Skytree same canonical key");
  assert.notEqual(keys[0], keys[3], "Ameyoko stays distinct");

  const deduped = dedupeByCanonicalLandmark(pool);
  assert.equal(deduped.uniqueCanonicalCount, 2);
  assert.equal(deduped.places.length, 2);
  const names = deduped.places.map((p) => p.name);
  assert.ok(names.some((n) => /阿美橫|アメ横/.test(n)), "keeps Ameyoko after Skytree collapse");
  assert.equal(
    names.filter((n) => /晴空塔|Skytree|ソラマチ|skytree/i.test(n)).length,
    1,
    "only one Skytree-family representative",
  );
});

// ── Case C: 候選不足必須標記 ──
test("Case C: requiredCanonicalCandidatesForTrip + insufficient flag counts", () => {
  assert.equal(requiredCanonicalCandidatesForTrip(6, "medium"), 18);
  assert.equal(requiredCanonicalCandidatesForTrip(6, "slow"), 12);
  assert.ok(computeItineraryResolvedTarget(6) >= 18, "resolved target must cover days×3");
  assert.ok(
    computeItineraryResolvedTarget(6) >= 24,
    "fetchTarget should oversample to days×4",
  );
  assert.equal(computeFirstRoundPlaceMapCap(6), 24);
  const cap = calculateDynamicStopCapacity({
    tripDays: 6,
    selectedCombinationCount: 2,
  });
  assert.ok(cap.preferredStops >= 18, "preferredStops must not clamp at tripDays+6");
});

// ── Case B: 候選確實不足 → 不得建立假完成／單點日 ──
test("Case B: candidateInsufficient blocks singleton redistribute + fallback fill", () => {
  const tinyRecs = [
    place({
      id: "t1",
      name: "淺草寺",
      lat: 35.7148,
      lng: 139.7967,
      address: "東京都台東区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "t2",
      name: "上野公園",
      lat: 35.7142,
      lng: 139.7731,
      address: "東京都台東区",
      primaryType: "park",
      types: ["park"],
    }),
    place({
      id: "t3",
      name: "東京晴空塔",
      lat: 35.7101,
      lng: 139.8107,
      address: "東京都墨田区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: "t4",
      name: "澀谷十字路口",
      lat: 35.6595,
      lng: 139.7005,
      address: "東京都渋谷区",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
  ].map((p) => ({
    name: p.name,
    placeName: p.name,
    type: p.primaryType ?? "tourist_attraction",
    description: p.address ?? p.name,
    reason: "",
    estimatedTime: "1 小時",
    address: p.address ?? "",
    lat: p.lat,
    lng: p.lng,
    googleMapsUrl: "",
    reasonSource: "template",
    googlePlaceId: p.id,
    photoName: null,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    matchedSelectedCombinationIds: [1, 2],
    sourceCombinationId: 1,
  }));

  const diag = buildMixedItineraryWithDiagnostics(tinyRecs, 6, "2026-08-05", "東京", {
    selectedCombinationIds: [1, 2],
    nearbyExtensions: ["橫濱"],
    pace: "medium",
  });
  assert.equal(diag.candidateInsufficient, true);
  assert.equal(diag.requiredCount, 18);
  assert.ok(diag.availableCount < 18);
  assert.ok(diag.missingCount > 0);
  assert.ok(diag.replanReasons.includes("insufficient_candidates"));
  assert.ok(diag.affectedDays.length > 0);

  // Planner-shaped empty days must not become singletons via redistribute
  const plannerShaped = [
    { date: "2026-08-05", time: "10:00", title: "A", placeName: "A", googlePlaceId: "a" },
    { date: "2026-08-05", time: "12:00", title: "B", placeName: "B", googlePlaceId: "b" },
    { date: "2026-08-05", time: "14:00", title: "C", placeName: "C", googlePlaceId: "c" },
    { date: "2026-08-06", time: "10:00", title: "D", placeName: "D", googlePlaceId: "d" },
    { date: "2026-08-06", time: "12:00", title: "E", placeName: "E", googlePlaceId: "e" },
    { date: "2026-08-06", time: "14:00", title: "F", placeName: "F", googlePlaceId: "f" },
    { date: "2026-08-07", time: "10:00", title: "G", placeName: "G", googlePlaceId: "g" },
    { date: "2026-08-07", time: "12:00", title: "H", placeName: "H", googlePlaceId: "h" },
    { date: "2026-08-07", time: "14:00", title: "I", placeName: "I", googlePlaceId: "i" },
    { date: "2026-08-08", time: "10:00", title: "J", placeName: "J", googlePlaceId: "j" },
    { date: "2026-08-08", time: "12:00", title: "K", placeName: "K", googlePlaceId: "k" },
  ];
  const afterRedistribute = redistributeToFillEmptyDays({
    stops: plannerShaped,
    days: 6,
    startDate: "2026-08-05",
    forbidSingletonFill: true,
    minPerDay: 3,
  });
  const byDate = new Map();
  for (const s of afterRedistribute) {
    const d = s.date;
    byDate.set(d, (byDate.get(d) ?? 0) + 1);
  }
  for (const [date, count] of byDate) {
    assert.notEqual(count, 1, `redistribute must not create singleton on ${date}`);
  }
  assert.equal(byDate.get("2026-08-09") ?? 0, 0, "day5 stays empty");
  assert.equal(byDate.get("2026-08-10") ?? 0, 0, "day6 stays empty");

  const fallback = buildFallbackItineraryFromPlaces(tinyRecs, 6, "2026-08-05", "東京", {
    selectedCombinationIds: [1, 2],
    nearbyExtensions: ["橫濱"],
    pace: "medium",
  });
  const fallbackByDate = new Map();
  for (const s of fallback) {
    const d = s.date;
    fallbackByDate.set(d, (fallbackByDate.get(d) ?? 0) + 1);
  }
  for (const [, count] of fallbackByDate) {
    assert.notEqual(count, 1, "fallback must not invent singleton days");
  }

  // Style ensureEveryDayPopulated must leave empty days when pool insufficient
  const tinyPlaces = tinyRecs.map((r) =>
    place({
      id: r.googlePlaceId,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      address: r.address,
      primaryType: r.type,
      types: [r.type],
    }),
  );
  const seeded = [
    {
      day: 1,
      entries: tinyPlaces.slice(0, 3).map((p, i) => ({
        time: `${10 + i}:00`,
        label: "景點",
        name: p.name,
        place: p,
      })),
    },
    { day: 2, entries: [] },
    { day: 3, entries: [] },
    { day: 4, entries: [] },
    { day: 5, entries: [] },
    { day: 6, entries: [] },
  ];
  const ensured = ensureEveryDayPopulated({
    plans: seeded,
    pool: tinyPlaces,
    days: 6,
    style: "classic_landmarks",
    plannedDate: "2026-08-05",
  });
  assert.ok(ensured.some((p) => p.entries.length === 0), "must leave empty days");
  assert.ok(
    ensured.every((p) => p.entries.length !== 1),
    "must not create singleton days via ensureEveryDayPopulated",
  );
  void redistributePlacesEvenly;
});

// ── Case C persistence: 3,3,3,2,0,0 不得被拆成單點日 ──
test("Case C: empty-day persistence — 3,3,3,2,0,0 must not become singletons", () => {
  const stops = [
    ...[0, 1, 2].flatMap((i) =>
      ["A", "B", "C"].map((letter, j) => ({
        date: `2026-08-0${5 + i}`,
        time: `${10 + j}:00`,
        title: `${letter}${i}`,
        placeName: `${letter}${i}`,
        googlePlaceId: `ChIJ${letter}${i}${j}`,
      })),
    ),
    {
      date: "2026-08-08",
      time: "10:00",
      title: "D0",
      placeName: "D0",
      googlePlaceId: "ChIJD0",
    },
    {
      date: "2026-08-08",
      time: "12:00",
      title: "D1",
      placeName: "D1",
      googlePlaceId: "ChIJD1",
    },
  ];
  const dayCountsBefore = [3, 3, 3, 2, 0, 0];
  const after = redistributeToFillEmptyDays({
    stops,
    days: 6,
    startDate: "2026-08-05",
    forbidSingletonFill: true,
    minPerDay: 3,
  });
  const counts = [];
  for (let i = 0; i < 6; i += 1) {
    const date = `2026-08-${String(5 + i).padStart(2, "0")}`;
    counts.push(after.filter((s) => s.date === date).length);
  }
  assert.deepEqual(
    counts,
    dayCountsBefore,
    `must preserve empty days, got ${counts.join(",")}`,
  );
  assert.ok(counts.every((c) => c !== 1), "no singleton days after persistence path");
});

// ── Case A (mixed path): 組合行程不得 4 天單點；晴空塔不重複；無折返 ──
test("Case A: mixed itinerary Tokyo 6d + Yokohama — capacity / dedup / no fold-back", () => {
  setRecEnginePlannerEnabledOverride(true);
  try {
    const pool = tokyoYokohamaPool();
    // 刻意加入同義晴空塔城
    pool.push(
      place({
        id: "skytree-town",
        name: "東京晴空塔城",
        lat: 35.71025,
        lng: 139.8108,
        address: "東京都墨田区",
        primaryType: "shopping_mall",
        types: ["shopping_mall"],
      }),
    );
    const recs = pool.map((p) => ({
      name: p.name,
      placeName: p.name,
      type: p.primaryType ?? "tourist_attraction",
      description: p.address ?? p.name,
      reason: "",
      estimatedTime: "1 小時",
      address: p.address ?? "",
      lat: p.lat,
      lng: p.lng,
      googleMapsUrl: "",
      reasonSource: "template",
      googlePlaceId: p.id,
      photoName: null,
      rating: p.rating,
      userRatingCount: p.userRatingCount,
      matchedSelectedCombinationIds: [1, 2],
      sourceCombinationId: 1,
    }));

    const stops = buildMixedItineraryFromPlaces(recs, 6, "2026-08-05", "東京", {
      selectedCombinationIds: [1, 2],
      nearbyExtensions: ["橫濱"],
      pace: "medium",
    });

    const byDay = new Map();
    for (const s of stops) {
      const list = byDay.get(s.date) ?? [];
      list.push(s);
      byDay.set(s.date, list);
    }
    const dayCounts = [...byDay.values()].map((list) => list.length);
    assert.ok(dayCounts.length >= 1, "should produce scheduled days");
    for (const count of dayCounts) {
      assert.notEqual(count, 1, `must not keep singleton days, got counts=${dayCounts}`);
      assert.ok(count >= 2, `each scheduled day >=2, got ${count}`);
    }

    const allNames = stops.map((s) => s.placeName ?? s.title);
    const skytreeHits = allNames.filter((n) =>
      /晴空塔|Skytree|ソラマチ|skytree/i.test(n ?? ""),
    );
    assert.ok(skytreeHits.length <= 1, `Skytree family at most once, got ${skytreeHits}`);

    // 橫濱集中
    const yDays = [...byDay.entries()].filter(([, list]) =>
      list.some((s) => /橫濱|横浜|山下|中華|紅磚|未來|みなとみらい/i.test(s.placeName ?? "")),
    );
    assert.ok(yDays.length <= 1, `Yokohama on one day, got ${yDays.length}`);

    // 同日不得 晴空塔 → 上野 → 晴空塔 折返
    for (const [, list] of byDay) {
      const ordered = [...list].sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
      for (let i = 0; i + 2 < ordered.length; i += 1) {
        const a = ordered[i];
        const b = ordered[i + 1];
        const c = ordered[i + 2];
        if (a.lat == null || b.lat == null || c.lat == null) continue;
        const d1 = distanceMeters(
          { lat: a.lat, lng: a.lng },
          { lat: b.lat, lng: b.lng },
        );
        const d2 = distanceMeters(
          { lat: b.lat, lng: b.lng },
          { lat: c.lat, lng: c.lng },
        );
        const dBack = distanceMeters(
          { lat: a.lat, lng: a.lng },
          { lat: c.lat, lng: c.lng },
        );
        const aSky = /晴空塔|Skytree/i.test(a.placeName ?? "");
        const cSky = /晴空塔|Skytree/i.test(c.placeName ?? "");
        if (aSky && cSky && d1 > 3000 && d2 > 3000) {
          assert.fail(`fold-back Skytree→far→Skytree legs=${Math.round(d1)},${Math.round(d2)}`);
        }
        assert.ok(
          !(d1 > 12_000 && d2 > 12_000 && dBack < 800),
          `fold-back pattern on day ${a.date}`,
        );
      }
    }
  } finally {
    setRecEnginePlannerEnabledOverride(null);
  }
});

// ── Case D: Planner output → UI persistence（dayPlan → itinerary）──
test("Case D: themed planner 3/day survives buildItineraryFromDayPlan", () => {
  setRecEnginePlannerEnabledOverride(true);
  try {
    const pool = tokyoYokohamaPool();
    // 補餐飲候選，避免 slot 全被景點耗盡
    const dining = [
      place({
        id: "cafe1",
        name: "下町咖啡",
        lat: 35.712,
        lng: 139.795,
        address: "東京都台東区",
        primaryType: "cafe",
        types: ["cafe"],
      }),
      place({
        id: "rest1",
        name: "淺草定食",
        lat: 35.713,
        lng: 139.794,
        address: "東京都台東区",
        primaryType: "restaurant",
        types: ["restaurant"],
      }),
      place({
        id: "cafe2",
        name: "澀谷咖啡",
        lat: 35.66,
        lng: 139.701,
        address: "東京都渋谷区",
        primaryType: "cafe",
        types: ["cafe"],
      }),
      place({
        id: "rest2",
        name: "新宿拉麵",
        lat: 35.69,
        lng: 139.702,
        address: "東京都新宿区",
        primaryType: "restaurant",
        types: ["restaurant"],
      }),
      place({
        id: "cafe3",
        name: "橫濱咖啡",
        lat: 35.45,
        lng: 139.64,
        address: "横浜市中区",
        primaryType: "cafe",
        types: ["cafe"],
      }),
      place({
        id: "rest3",
        name: "中華街點心",
        lat: 35.443,
        lng: 139.646,
        address: "横浜市中区",
        primaryType: "restaurant",
        types: ["restaurant"],
      }),
    ];
    while (pool.length < 30) {
      const base = pool[pool.length % tokyoYokohamaPool().length];
      pool.push(
        place({
          ...base,
          id: `${base.id}-d${pool.length}`,
          name: `${base.name}側${pool.length}`,
          lat: base.lat + (pool.length % 7) * 0.0015,
          lng: base.lng + (pool.length % 7) * 0.0015,
        }),
      );
    }
    const fullPool = [...pool, ...dining];
    const plans = buildThemedMultiDayPlans({
      places: fullPool,
      days: 6,
      style: "mixed",
      plannedDate: "2026-08-05",
      nearbyExtensions: ["橫濱"],
      pace: "medium",
    });
    const plannerCounts = plans.map((p) => p.entries.length);
    for (const plan of plans) {
      assert.ok(
        plan.entries.length >= 2,
        `planner day ${plan.day} >=2, got ${plan.entries.length}`,
      );
    }

    const dayPlan = composedPlansToAiDayPlan({
      composedPlans: plans,
      destination: "東京",
      days: 6,
      planningSessionId: "verify-p1-step1-case-d",
    });
    const itinerary = buildItineraryFromDayPlan(dayPlan, {
      startDate: "2026-08-05",
      endDate: "2026-08-10",
      dayDates: [
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
        "2026-08-09",
        "2026-08-10",
      ],
    });
    const uiByDay = new Map();
    for (const item of itinerary) {
      const d = (item.dayIndex ?? 0) + 1;
      uiByDay.set(d, (uiByDay.get(d) ?? 0) + 1);
    }
    for (let day = 1; day <= 6; day += 1) {
      const planner = plannerCounts[day - 1] ?? 0;
      const ui = uiByDay.get(day) ?? 0;
      if (planner >= 3) {
        assert.ok(
          ui >= 3,
          `day ${day}: planner=${planner} must persist >=3 in UI, got ${ui}`,
        );
      }
      assert.notEqual(ui, 1, `day ${day}: UI must not collapse to 1 (planner=${planner})`);
    }
  } finally {
    setRecEnginePlannerEnabledOverride(null);
  }
});

test("Style diversity: multi-kind search plan, not single-query limit", () => {
  assert.ok(STYLE_PER_QUERY_KEEP <= 8, "per-query keep must stay modest to force multi-query");
  const kinds = resolveStyleSearchKinds("classic_landmarks", 6);
  assert.ok(kinds.includes("attraction"));
  assert.ok(kinds.includes("restaurant"));
  assert.ok(kinds.includes("cafe"));
  assert.ok(kinds.includes("culture"));
  assert.ok(kinds.includes("nature"));
  assert.ok(kinds.includes("shopping"));
  assert.ok(
    kinds.length > kindsForStyle("classic_landmarks").length,
    "6-day classic must expand beyond primary composition kinds",
  );

  let totalQueries = 0;
  for (const kind of kinds) {
    const attempts = buildAttemptsForStyleKind("東京", kind);
    assert.ok(attempts.length >= 1, `kind ${kind} needs ≥1 query`);
    assert.ok(attempts.length <= 4, `kind ${kind} capped for rate limits`);
    totalQueries += attempts.length;
  }
  assert.ok(
    totalQueries >= 12,
    `expect many distinct Places searches across kinds, got ${totalQueries}`,
  );

  const night = buildNightScenerySearchAttempts("東京");
  assert.ok(night.some((a) => /夜景|night/i.test(a.query)));

  const mixedPool = [
    ...tokyoOnlyPool().slice(0, 4),
    place({
      id: "cafe-x",
      name: "下町咖啡",
      lat: 35.71,
      lng: 139.79,
      primaryType: "cafe",
      types: ["cafe"],
    }),
  ];
  const byKind = countPlacesByPlanKind(mixedPool);
  assert.ok(formatKindCounts(byKind).includes("attraction:"));
  const weak = underrepresentedKinds(mixedPool, kinds, 3);
  assert.ok(weak.includes("restaurant") || weak.includes("shopping"));
});

test("Geo diversity: Tokyo hubs rotate and skip saturated region", () => {
  const hubs = resolveGeoHubsForDestination("東京");
  const labels = hubs.map((h) => h.label);
  assert.ok(labels.includes("淺草") || labels.includes("Asakusa"));
  assert.ok(labels.some((l) => /澀谷|渋谷/.test(l)));
  assert.ok(labels.includes("新宿"));
  assert.ok(labels.includes("銀座"));
  assert.ok(labels.includes("上野"));
  assert.ok(hubs.length >= 5, `need multi-region hubs, got ${hubs.length}`);

  const asakusaHub = hubs.find((h) => /淺草/.test(h.label));
  assert.ok(asakusaHub);

  // All Asakusa-clustered places → that hub saturates
  const asakusaHeavy = Array.from({ length: 10 }, (_, i) =>
    place({
      id: `asa${i}`,
      name: `淺草景點${i}`,
      lat: 35.7148 + i * 0.0003,
      lng: 139.7967 + i * 0.0003,
      address: "東京都台東区浅草",
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
  );
  assert.equal(matchPlaceToGeoHub(asakusaHeavy[0], hubs)?.id, asakusaHub.id);
  assert.equal(
    isGeoHubSaturated(asakusaHeavy, asakusaHub, hubs, GEO_MAX_CLUSTER_SHARE),
    true,
  );

  const picked = pickNextGeoHub({
    hubs,
    places: asakusaHeavy,
    roundIndex: 0,
  });
  assert.ok(picked.hub);
  assert.notEqual(
    picked.hub.id,
    asakusaHub.id,
    "next search must leave saturated Asakusa",
  );
  assert.ok(picked.skippedSaturated.includes(asakusaHub.label));

  const scoped = scopeAttemptToGeoHub(
    { query: "東京 景點", mode: "text", includedTypes: ["tourist_attraction"] },
    hubs.find((h) => h.label === "新宿") ?? hubs[1],
    "東京",
  );
  assert.match(scoped.query, /新宿/);
  assert.doesNotMatch(scoped.query, /^東京/);

  const weak = underrepresentedGeoHubs(asakusaHeavy, hubs, 2);
  assert.ok(weak.every((h) => h.id !== asakusaHub.id));
  assert.ok(weak.length >= 3, "other Tokyo regions should be underrepresented");
});

await testAsync(
  "Case B real path: generateTripPlanFromStyle with short pool → candidateInsufficient, no dayPlan",
  async () => {
    setRecEnginePlannerEnabledOverride(true);
    const sessionId = `verify-p1-style-insufficient-${Date.now()}`;
    resetPlannerSession(sessionId);
    try {
      const shortPool = tokyoOnlyPool().slice(0, 8);
      const searchPlaces = async () => ({ places: shortPool, error: null });
      const searchDestinationPlaces = async () => shortPool;
      const geocodeFn = async () => ({
        location: { lat: 35.6762, lng: 139.6503, label: "東京" },
        error: null,
      });
      const profile = classifyDestinationForPlaceSearch("東京");
      const result = await generateTripPlanFromStyle({
        label: "東京",
        lat: 35.6762,
        lng: 139.6503,
        locale: "zh-Hant",
        searchPlaces,
        weather: null,
        context: {
          destination: "東京",
          days: 6,
          startDate: "2026-08-05",
          nearbyExtensions: ["橫濱"],
          selectedCombinationIds: [1, 2],
        },
        style: "classic_landmarks",
        days: 6,
        caller: "verify.p1.step1.caseB",
        searchContext: { destination: "東京", days: 6 },
        geocodeSucceeded: true,
        searchProfile: profile,
        weatherSearchLabel: "東京",
        templateNameSearchAttempts: () => [],
        searchDestinationPlaces,
        planningSessionId: sessionId,
        geocodeFn,
      });

      assert.ok(
        result.candidateInsufficient?.candidateInsufficient,
        "must report candidateInsufficient on real style path",
      );
      assert.ok(
        (result.candidateInsufficient?.requiredCount ?? 0) >= 18,
        "requiredCount visible",
      );
      assert.ok(
        (result.candidateInsufficient?.availableCount ?? 0) < 18,
        "availableCount below required",
      );
      assert.equal(
        result.dayPlan,
        undefined,
        "must not freeze a fake-complete dayPlan",
      );
      assert.equal(
        result.recommendations.length,
        0,
        "must not render fake-complete cards",
      );
      const counts = (result.composedPlans ?? []).map((p) => p.entries.length);
      assert.ok(
        counts.every((c) => c !== 1),
        `style path must not invent singleton days, got ${counts}`,
      );
    } finally {
      resetPlannerSession(sessionId);
      setRecEnginePlannerEnabledOverride(null);
    }
  },
);

console.info("\n[verify:ai-wiring-p1-step1-day-assembly] all passed");
