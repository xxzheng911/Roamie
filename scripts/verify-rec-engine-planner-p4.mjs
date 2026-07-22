#!/usr/bin/env node
/**
 * Priority 2 / P4.1 — Recommendation Validator 實際接線
 *
 * - Flag 預設 OFF = pass-through
 * - Flag ON = 品質閘門（不重排）+ 不足診斷
 * - 不開 Itinerary Validator / PIE Search / 新權重
 *
 * 執行：npm run verify:rec-engine-planner-p4
 */
import assert from "node:assert/strict";
import {
  getLastRecommendationValidationStats,
  getLastRecommendationValidationSummary,
  isRecEngineValidatorEnabled,
  resetRecommendationValidationStats,
  runRecommendationPipeline,
  setRecEngineValidatorEnabledOverride,
  validateRecommendations,
  validateRecommendationsDetailed,
} from "../src/lib/recommendation/engine/index.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function scored(partial) {
  const candidate = {
    placeId: "ChIJ_ok",
    name: "Good Place",
    lat: 25.03,
    lng: 121.56,
    rating: 4.5,
    userRatingCount: 100,
    primaryType: "cafe",
    types: ["cafe"],
    source: "planner",
    raw: { businessStatus: "OPERATIONAL" },
    ...partial.candidate,
  };
  return {
    candidate,
    score: partial.score ?? 1,
    reasons: [],
    scoreBreakdown: { total: partial.score ?? 1 },
    breakdown: { total: partial.score ?? 1 },
  };
}

function tokyoPool() {
  const base = [
    ["skytree", "晴空塔", "tourist_attraction", 35.71, 139.81],
    ["skytree-town", "晴空塔城", "shopping_mall", 35.71, 139.8105],
    ["sensoji", "淺草寺", "place_of_worship", 35.714, 139.796],
    ["meiji", "明治神宮", "place_of_worship", 35.676, 139.699],
    ["ueno", "上野公園", "park", 35.715, 139.773],
    ["teamlab", "teamLab Planets", "museum", 35.649, 139.79],
    ["ginza", "銀座", "tourist_attraction", 35.671, 139.765],
    ["shibuya", "澀谷十字路口", "tourist_attraction", 35.659, 139.7],
    ["yoyogi", "代代木公園", "park", 35.671, 139.695],
    ["tsukiji", "築地市場", "market", 35.665, 139.77],
    ["ramen1", "一蘭拉麵", "restaurant", 35.693, 139.701],
    ["sushi1", "壽司大", "restaurant", 35.6655, 139.7705],
    ["cafe1", "藍瓶咖啡", "cafe", 35.66, 139.7],
    ["cafe2", "% Arabica", "cafe", 35.67, 139.76],
    ["museum2", "國立西洋美術館", "museum", 35.716, 139.776],
    ["yokohama1", "橫濱紅磚倉庫", "tourist_attraction", 35.452, 139.643],
    ["yokohama2", "橫濱中華街", "tourist_attraction", 35.443, 139.646],
    ["yokohama3", "山下公園", "park", 35.445, 139.65],
    ["bar1", "非日常居酒屋", "bar", 35.66, 139.7],
    ["mall1", "澀谷 Parco", "shopping_mall", 35.661, 139.698],
    ["super1", "成城石井超市", "supermarket", 35.66, 139.7],
    ["cem1", "青山靈園", "cemetery", 35.665, 139.72],
    ["closed1", "已歇業商店", "store", 35.66, 139.7],
    ["hotel1", "東京飯店", "lodging", 35.68, 139.76],
    ["parking1", "市府停車場", "parking", 35.68, 139.75],
  ];
  return base.map(([id, name, type, lat, lng], i) =>
    scored({
      score: 100 - i,
      candidate: {
        placeId: `ChIJ${id}`,
        name,
        primaryType: type,
        types: [type],
        lat,
        lng,
        raw: {
          id: `ChIJ${id}`,
          name,
          primaryType: type,
          types: [type],
          lat,
          lng,
          businessStatus: id === "closed1" ? "CLOSED_PERMANENTLY" : "OPERATIONAL",
        },
      },
    }),
  );
}

console.info("[verify:rec-engine-planner-p4] Recommendation Validator Priority 2\n");

test("flag override OFF/ON works (env may be ON for Priority 2 local)", () => {
  setRecEngineValidatorEnabledOverride(false);
  assert.equal(isRecEngineValidatorEnabled(), false);
  setRecEngineValidatorEnabledOverride(true);
  assert.equal(isRecEngineValidatorEnabled(), true);
  setRecEngineValidatorEnabledOverride(null);
});

test("Flag OFF: pass-through keeps closed / cemetery / duplicates", () => {
  setRecEngineValidatorEnabledOverride(false);
  resetRecommendationValidationStats();
  const ranked = [
    scored({
      score: 3,
      candidate: {
        placeId: "dup",
        name: "A",
        primaryType: "cafe",
        types: ["cafe"],
      },
    }),
    scored({
      score: 2,
      candidate: {
        placeId: "dup",
        name: "A copy",
        primaryType: "cafe",
        types: ["cafe"],
      },
    }),
    scored({
      score: 1,
      candidate: {
        placeId: "cem",
        name: "某墓園",
        primaryType: "cemetery",
        types: ["cemetery"],
      },
    }),
  ];
  const out = validateRecommendations(ranked);
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((r) => r.placeId),
    ["dup", "dup", "cem"],
  );
  assert.equal(getLastRecommendationValidationStats().path, "pass_through");
});

test("Flag ON: rejects closed, cemetery, retail, lodging, parking, duplicates; preserves order", () => {
  setRecEngineValidatorEnabledOverride(true);
  resetRecommendationValidationStats();
  const ranked = [
    scored({
      score: 5,
      candidate: {
        placeId: "keep-1",
        name: "First Cafe",
        primaryType: "cafe",
        types: ["cafe"],
        rating: 4.6,
        userRatingCount: 80,
      },
    }),
    scored({
      score: 4,
      candidate: {
        placeId: "closed",
        name: "Gone Shop",
        primaryType: "store",
        types: ["store"],
        raw: { businessStatus: "CLOSED_PERMANENTLY" },
      },
    }),
    scored({
      score: 3,
      candidate: {
        placeId: "cem",
        name: "City Cemetery",
        primaryType: "cemetery",
        types: ["cemetery"],
      },
    }),
    scored({
      score: 2,
      candidate: {
        placeId: "super",
        name: "Big Mart",
        primaryType: "supermarket",
        types: ["supermarket"],
      },
    }),
    scored({
      score: 1.8,
      candidate: {
        placeId: "hotel",
        name: "City Hotel",
        primaryType: "lodging",
        types: ["lodging"],
      },
    }),
    scored({
      score: 1.6,
      candidate: {
        placeId: "park-lot",
        name: "Station Parking",
        primaryType: "parking",
        types: ["parking"],
      },
    }),
    scored({
      score: 1.5,
      candidate: {
        placeId: "keep-1",
        name: "First Cafe Dup",
        primaryType: "cafe",
        types: ["cafe"],
      },
    }),
    scored({
      score: 1,
      candidate: {
        placeId: "keep-2",
        name: "Second Museum",
        primaryType: "museum",
        types: ["museum"],
        rating: 4.8,
        userRatingCount: 200,
      },
    }),
  ];
  const out = validateRecommendations(ranked, {
    surface: "planner",
    surfaceOptions: { requiredCount: 2, style: "mixed" },
  });
  assert.deepEqual(
    out.map((r) => r.placeId),
    ["keep-1", "keep-2"],
  );
  assert.equal(out[0].score, 5);
  assert.equal(out[1].score, 1);

  const stats = getLastRecommendationValidationStats();
  assert.equal(stats.path, "validator");
  assert.equal(stats.passed, 2);
  assert.ok((stats.byReason.closed_permanently ?? 0) >= 1);
  assert.ok((stats.byReason.burial_or_funeral ?? 0) >= 1);
  assert.ok((stats.byReason.excluded_retail ?? 0) >= 1);
  assert.ok((stats.byReason.excluded_lodging ?? 0) >= 1);
  assert.ok((stats.byReason.excluded_parking ?? 0) >= 1);
  assert.ok((stats.byReason.duplicate_place_id ?? 0) >= 1);
});

test("Flag ON: shopping keeps mall, still rejects supermarket", () => {
  setRecEngineValidatorEnabledOverride(true);
  const ranked = [
    scored({
      candidate: {
        placeId: "mall1",
        name: "Shibuya Parco",
        primaryType: "shopping_mall",
        types: ["shopping_mall"],
        rating: 4.3,
        userRatingCount: 200,
        lat: 35.66,
        lng: 139.7,
      },
    }),
    scored({
      candidate: {
        placeId: "super1",
        name: "Local Mart",
        primaryType: "supermarket",
        types: ["supermarket"],
        rating: 4.2,
        userRatingCount: 40,
        lat: 35.661,
        lng: 139.701,
      },
    }),
  ];
  const summary = validateRecommendationsDetailed(ranked, {
    surface: "planner",
    categoryHint: "shopping",
    surfaceOptions: {
      requiredCount: 1,
      style: "local_life",
      userText: "想逛街購物",
    },
  });
  assert.equal(summary.recommendationInsufficient, false);
  assert.deepEqual(
    summary.acceptedCandidates.map((r) => r.placeId),
    ["mall1"],
  );
  assert.ok((summary.failedRuleCounts.excluded_retail ?? 0) >= 1);
});

test("Flag ON: nightlife keeps bar", () => {
  setRecEngineValidatorEnabledOverride(true);
  const ranked = [
    scored({
      candidate: {
        placeId: "bar1",
        name: "居酒屋一番",
        primaryType: "bar",
        types: ["bar"],
        rating: 4.4,
        userRatingCount: 90,
      },
    }),
  ];
  const out = validateRecommendations(ranked, {
    surface: "planner",
    categoryHint: "night",
    surfaceOptions: { requiredCount: 1, style: "local_life", userText: "想要夜生活" },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].placeId, "bar1");
});

test("Flag ON: exclusions reject hotpot / italian / park", () => {
  setRecEngineValidatorEnabledOverride(true);
  const ranked = [
    scored({
      candidate: {
        placeId: "ok",
        name: "Keep Museum",
        primaryType: "museum",
        types: ["museum"],
      },
    }),
    scored({
      candidate: {
        placeId: "hotpot",
        name: "麻辣火鍋店",
        primaryType: "restaurant",
        types: ["restaurant"],
      },
    }),
    scored({
      candidate: {
        placeId: "italian",
        name: "義式餐廳 Pasta",
        primaryType: "restaurant",
        types: ["restaurant"],
      },
    }),
    scored({
      candidate: {
        placeId: "park1",
        name: "中央公園",
        primaryType: "park",
        types: ["park"],
      },
    }),
  ];
  const summary = validateRecommendationsDetailed(ranked, {
    surface: "planner",
    surfaceOptions: {
      requiredCount: 1,
      style: "mixed",
      excludedCategories: ["火鍋", "hotpot", "義式", "italian", "公園", "park"],
    },
  });
  assert.deepEqual(
    summary.acceptedCandidates.map((r) => r.placeId),
    ["ok"],
  );
  assert.ok((summary.failedRuleCounts.excluded_by_context ?? 0) >= 2);
  assert.ok((summary.failedRuleCounts.excluded_park ?? 0) >= 1);
});

test("Flag ON: duplicate canonicalLandmarkKey rejected", () => {
  setRecEngineValidatorEnabledOverride(true);
  const ranked = [
    scored({
      score: 2,
      candidate: {
        placeId: "a1",
        name: "晴空塔",
        primaryType: "tourist_attraction",
        types: ["tourist_attraction"],
        lat: 35.71,
        lng: 139.81,
        raw: {
          id: "a1",
          name: "晴空塔",
          primaryType: "tourist_attraction",
          types: ["tourist_attraction"],
          lat: 35.71,
          lng: 139.81,
        },
      },
    }),
    scored({
      score: 1,
      candidate: {
        placeId: "a2",
        name: "Tokyo Skytree",
        primaryType: "tourist_attraction",
        types: ["tourist_attraction"],
        lat: 35.7102,
        lng: 139.8103,
        raw: {
          id: "a2",
          name: "Tokyo Skytree",
          primaryType: "tourist_attraction",
          types: ["tourist_attraction"],
          lat: 35.7102,
          lng: 139.8103,
        },
      },
    }),
  ];
  const summary = validateRecommendationsDetailed(ranked, {
    surface: "planner",
    surfaceOptions: { requiredCount: 1, style: "classic_landmarks" },
  });
  assert.equal(summary.acceptedCandidates.length, 1);
  assert.ok((summary.failedRuleCounts.duplicate_canonical ?? 0) >= 1);
});

test("Flag ON: insufficient pool blocks delivery (Case E)", () => {
  setRecEngineValidatorEnabledOverride(true);
  const ranked = [
    scored({
      candidate: {
        placeId: "only1",
        name: "Only Cafe",
        primaryType: "cafe",
        types: ["cafe"],
      },
    }),
    scored({
      candidate: {
        placeId: "super",
        name: "Big Mart",
        primaryType: "supermarket",
        types: ["supermarket"],
      },
    }),
  ];
  const summary = validateRecommendationsDetailed(ranked, {
    surface: "planner",
    surfaceOptions: { requiredCount: 5, style: "mixed" },
  });
  assert.equal(summary.recommendationInsufficient, true);
  assert.equal(summary.pass, false);
  assert.equal(summary.acceptedCandidates.length, 0);
  assert.equal(summary.availableCount, 1);
  assert.equal(summary.requiredCount, 5);
  assert.equal(summary.missingCount, 4);
  assert.ok(summary.rejectedCount >= 1);
});

test("Case A fixture: Tokyo-like pool filters junk and keeps diversity", () => {
  setRecEngineValidatorEnabledOverride(true);
  const ranked = tokyoPool();
  const summary = validateRecommendationsDetailed(ranked, {
    surface: "planner",
    categoryHint: "general",
    surfaceOptions: {
      requiredCount: 18,
      style: "mixed",
      userText: "購物 夜生活",
    },
  });

  const ids = summary.acceptedCandidates.map((r) => r.placeId);
  const names = summary.acceptedCandidates.map((r) => r.candidate.name);
  assert.ok(!ids.some((id) => String(id).includes("super")));
  assert.ok(!ids.some((id) => String(id).includes("cem")));
  assert.ok(!ids.some((id) => String(id).includes("closed")));
  assert.ok(!ids.some((id) => String(id).includes("hotel")));
  assert.ok(!ids.some((id) => String(id).includes("parking")));
  assert.ok(!names.some((n) => /超市|靈園|飯店|停車場|已歇業/.test(n ?? "")));

  // Skytree family: at most one canonical
  const skytreeAccepted = names.filter((n) => /晴空塔|skytree/i.test(n ?? ""));
  assert.ok(skytreeAccepted.length <= 1);

  // Shopping + nightlife intents keep mall / bar
  assert.ok(ids.includes("ChIJmall1") || names.some((n) => /Parco/i.test(n ?? "")));
  assert.ok(ids.includes("ChIJbar1") || names.some((n) => /居酒屋/.test(n ?? "")));

  console.log(
    `    [Case A diag] input=${summary.inputCount} accepted=${summary.acceptedCount}` +
      ` rejected=${summary.rejectedCount} available=${summary.availableCount}` +
      ` required=${summary.requiredCount} insufficient=${summary.recommendationInsufficient}` +
      ` categoryBefore=${JSON.stringify(summary.categoryBefore)}` +
      ` categoryAfter=${JSON.stringify(summary.categoryAfter)}` +
      ` clusterBefore=${summary.clusterBefore} clusterAfter=${summary.clusterAfter}` +
      ` canonicalBefore=${summary.canonicalBefore} canonicalAfter=${summary.canonicalAfter}`,
  );

  // Fixture is intentionally smaller than 18 unique after filters — expect insufficient block
  // or enough if pool grows; either way must not silently under-deliver.
  if (summary.availableCount < summary.requiredCount) {
    assert.equal(summary.recommendationInsufficient, true);
    assert.equal(summary.acceptedCandidates.length, 0);
  } else {
    assert.equal(summary.recommendationInsufficient, false);
    assert.ok(summary.acceptedCandidates.length >= 18);
  }
});

test("pipeline validate stage receives ctx (exclusions)", () => {
  setRecEngineValidatorEnabledOverride(true);
  resetRecommendationValidationStats();
  const results = runRecommendationPipeline({
    ctx: {
      surface: "planner",
      exclusions: { placeIds: ["x1"], names: [], rejectedNames: [] },
      surfaceOptions: { requiredCount: 1, style: "mixed" },
    },
    inputs: [
      {
        placeId: "x1",
        name: "Excluded",
        lat: 1,
        lng: 1,
        rating: 4.5,
        userRatingCount: 10,
        primaryType: "cafe",
        types: ["cafe"],
        raw: { id: "x1", name: "Excluded", businessStatus: "OPERATIONAL" },
      },
      {
        placeId: "y1",
        name: "Keep Cafe",
        lat: 1,
        lng: 1,
        rating: 4.5,
        userRatingCount: 10,
        primaryType: "cafe",
        types: ["cafe"],
        raw: { id: "y1", name: "Keep Cafe", businessStatus: "OPERATIONAL" },
      },
    ],
    source: "planner",
    scoreFn: (candidates) =>
      candidates.map((c, i) => ({
        candidate: c,
        score: 10 - i,
        reasons: [],
        scoreBreakdown: { total: 10 - i },
        breakdown: { total: 10 - i },
      })),
  });
  assert.deepEqual(
    results.map((r) => r.placeId),
    ["y1"],
  );
  assert.equal(getLastRecommendationValidationStats().path, "validator");
});

test("structured summary shape", () => {
  setRecEngineValidatorEnabledOverride(true);
  const summary = validateRecommendationsDetailed(
    [
      scored({
        candidate: { placeId: "p1", name: "Park A", primaryType: "park", types: ["park"] },
      }),
    ],
    { surface: "planner", surfaceOptions: { requiredCount: 1, style: "slow_nature" } },
  );
  assert.equal(typeof summary.pass, "boolean");
  assert.equal(typeof summary.recommendationInsufficient, "boolean");
  assert.ok(Array.isArray(summary.acceptedCandidates));
  assert.ok(Array.isArray(summary.rejectedCandidates));
  assert.ok(summary.rejectedCandidates.every((r) => Array.isArray(r.failedRules)));
  assert.equal(getLastRecommendationValidationSummary().path, "recommendation_validator");
});

setRecEngineValidatorEnabledOverride(null);
console.info("\n[verify:rec-engine-planner-p4] Priority 2 Recommendation Validator passed\n");
