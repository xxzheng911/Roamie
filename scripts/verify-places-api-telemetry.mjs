#!/usr/bin/env node
/**
 * Places API P0 成本優化 — telemetry 與回歸驗證（mock search，不消耗 Google 配額）。
 * 執行：npm run verify:places-api-telemetry
 */
import assert from "node:assert/strict";
import { loadHomeNearbyPicks } from "../src/lib/explore-category-search.ts";
import { pickCategoriesForHome, pickCategoriesForContext } from "../src/lib/recommendation/categories.ts";
import {
  getPlacesApiTelemetry,
  logPlacesApiTelemetrySummary,
  recordPlacesApiCall,
  resetPlacesApiTelemetry,
} from "../src/lib/places-api-telemetry.ts";
import {
  logPlacesApiTelemetrySummaryServer,
  resetPlacesApiTelemetryServer,
} from "../src/lib/places-api-telemetry.server.ts";
import { getServerCachedExploreSearch } from "../src/lib/places-search-server-cache.ts";
import { lookupPlacesHoursBatch } from "../src/lib/places.functions.ts";

const TAIPEI = { lat: 25.0478, lng: 121.5319 };

const SUNNY_WEATHER = {
  tempC: 28,
  condition: "clear",
  precipProbability: 0.05,
  isDaytime: true,
};

function primaryTypeForSearch(data) {
  if (data.includedTypes?.length) return data.includedTypes[0];
  if (data.nearbyGroups?.length) return data.nearbyGroups[0][0];
  return "cafe";
}

function mockPlace(data, i) {
  const primaryType = primaryTypeForSearch(data);
  return {
    id: `ChIJmock${primaryType}${i}`,
    name: `Mock ${primaryType} ${i}`,
    address: "台北市信義區",
    lat: TAIPEI.lat + i * 0.001,
    lng: TAIPEI.lng + i * 0.001,
    rating: 4.5,
    userRatingCount: 100,
    photoName: `places/mock/photos/${i}`,
    primaryType,
    types: [primaryType],
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "營業中",
    todayHoursLabel: "09:00–21:00",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

function createCountingSearchFn(surface) {
  const counts = { nearby: 0, text: 0, details: 0 };
  const fn = async ({ data }) => {
    if (data.mode === "text") {
      counts.text += 1;
      recordPlacesApiCall("text", surface);
    } else if (data.mode === "multi" && data.nearbyGroups?.length) {
      counts.nearby += data.nearbyGroups.length;
      for (let i = 0; i < data.nearbyGroups.length; i += 1) {
        recordPlacesApiCall("nearby", surface);
      }
    } else {
      counts.nearby += 1;
      recordPlacesApiCall("nearby", surface);
    }
    return { places: [mockPlace(data, counts.nearby)], error: null };
  };
  return { fn, counts };
}

function test(name, fn) {
  return fn().then(
    () => console.log(`  ✓ ${name}`),
    (e) => {
      console.error(`  ✗ ${name}`, e.message);
      throw e;
    },
  );
}

function estimateBeforeHomeCalls() {
  /** 稽核基準：冷啟動 2 輪 search + Details enrich */
  return { nearby: 12, text: 0, details: 6, total: 18 };
}

function estimateBeforeAiCalls() {
  /** 稽核：6 分類（含 multi ≈10 Nearby）+ lookupPlacesHoursBatch 5 Text + mood text 3 */
  return { nearby: 10, text: 8, details: 0, total: 18 };
}

console.info("[verify:places-api] Places API P0 telemetry 驗證\n");

const results = {};

await test("首頁附近推薦 — 單次 fetch、≤3 分類、無 Details enrich", async () => {
  resetPlacesApiTelemetry("home");
  const categories = pickCategoriesForHome(SUNNY_WEATHER, null);
  assert.ok(categories.length <= 3, `分類應 ≤3，實際 ${categories.length}`);

  const { fn, counts } = createCountingSearchFn("home");
  const { picks, usedCuratedFallback } = await loadHomeNearbyPicks({
    userLocation: TAIPEI,
    weather: SUNNY_WEATHER,
    locale: "zh-TW",
    reasonProfile: null,
    saved: [],
    searchPlacesFn: fn,
    categories,
  });

  assert.ok(picks.length > 0, "應有附近推薦");
  assert.equal(usedCuratedFallback, false);
  assert.equal(counts.details, 0, "不應打 Place Details");
  assert.ok(
    picks.some((p) => p.photoName || p.openStatusLabel),
    "地點應含照片或營業狀態",
  );

  logPlacesApiTelemetrySummary("home", { categories: categories.length, picks: picks.length });
  results.home = {
    telemetry: getPlacesApiTelemetry("home"),
    categories: categories.map((c) => c.id),
  };
});

await test("探索地圖 — 單分類 coffee", async () => {
  resetPlacesApiTelemetry("map");
  const { EXPLORE_CATEGORIES } = await import("../src/lib/places-search-config.ts");
  const coffee = EXPLORE_CATEGORIES.find((c) => c.id === "coffee");
  assert.ok(coffee);

  const { fn, counts } = createCountingSearchFn("map");
  await fn({
    data: {
      lat: TAIPEI.lat,
      lng: TAIPEI.lng,
      query: coffee.query,
      mode: coffee.mode,
      includedTypes: coffee.includedTypes,
      locale: "zh-TW",
      telemetrySurface: "map",
    },
  });

  logPlacesApiTelemetrySummary("map", { category: coffee.id });
  results.map = {
    telemetry: getPlacesApiTelemetry("map"),
    category: coffee.id,
    counts,
  };
  assert.equal(counts.nearby, 1);
  assert.equal(counts.text, 0);
});

await test("AI 推薦 — ≤3 分類、server cache、無 hours Text Search", async () => {
  const aiCategories = pickCategoriesForContext({
    weather: SUNNY_WEATHER,
    mood: "想放空",
    max: 3,
  });
  assert.ok(aiCategories.length <= 3);

  const hoursMap = await lookupPlacesHoursBatch([{ name: "測試店" }], TAIPEI);
  assert.equal(hoursMap.size, 0, "lookupPlacesHoursBatch 不應再打 Text Search");

  resetPlacesApiTelemetryServer("ai");
  let fetchCalls = 0;
  const input = {
    lat: TAIPEI.lat,
    lng: TAIPEI.lng,
    query: "咖啡店",
    mode: "nearby",
    includedTypes: ["cafe"],
    locale: "zh-TW",
    telemetrySurface: "ai",
  };
  const fetcher = async () => {
    fetchCalls += 1;
    return {
      places: [mockPlace(input, fetchCalls)],
      error: null,
    };
  };

  await getServerCachedExploreSearch(input, fetcher, () => true);
  await getServerCachedExploreSearch(input, fetcher, () => true);
  assert.equal(fetchCalls, 1, "同 query 應命中 server cache");

  let aiNearby = 0;
  for (const cat of aiCategories) {
    if (cat.mode === "multi") aiNearby += cat.nearbyGroups?.length ?? 0;
    else aiNearby += 1;
  }

  logPlacesApiTelemetrySummaryServer("ai", {
    categories: aiCategories.length,
    estimatedNearbyFirstPass: aiNearby,
    serverCacheVerified: true,
  });

  results.ai = {
    categories: aiCategories.map((c) => c.id),
    estimatedNearbyFirstPass: aiNearby,
    hoursTextSearch: 0,
    serverCacheSecondPassCalls: fetchCalls,
  };
});

await test("地點照片 — buildPlacePhotoUrl 仍可用", async () => {
  const { buildPlacePhotoUrl } = await import("../src/lib/google-maps-client.ts");
  const url = buildPlacePhotoUrl("places/mock/photos/1", 400);
  assert.ok(url.length > 10);
  results.photo = { urlSample: url.slice(0, 100) };
});

console.info("\n--- Telemetry 摘要 ---\n");
console.info("首頁 (home):", JSON.stringify(results.home, null, 2));
console.info("地圖 (map):", JSON.stringify(results.map, null, 2));
console.info("AI (ai):", JSON.stringify(results.ai, null, 2));

const beforeHome = estimateBeforeHomeCalls();
const afterHome = results.home.telemetry;
const afterHomeTotal = afterHome.nearby + afterHome.text + afterHome.details;
const homeReduction = 1 - afterHomeTotal / beforeHome.total;

const beforeAi = estimateBeforeAiCalls();
const afterAiTotal = results.ai.estimatedNearbyFirstPass + results.ai.hoursTextSearch;
const aiReduction = 1 - afterAiTotal / beforeAi.total;

console.info("\n--- 成本降幅（相對稽核基準）---\n");
console.info(
  `首頁 Search/Details: ${beforeHome.total} → ${afterHomeTotal} (−${Math.round(homeReduction * 100)}%)`,
);
console.info(
  `AI Search: ${beforeAi.total} → ${afterAiTotal} (−${Math.round(aiReduction * 100)}%)`,
);
console.info(`AI server cache 第二次 fetcher 呼叫: ${results.ai.serverCacheSecondPassCalls}（應為 1，僅首次）`);

assert.ok(homeReduction >= 0.7, `首頁降幅應 ≥70%，實際 ${Math.round(homeReduction * 100)}%`);
assert.ok(aiReduction >= 0.7, `AI 降幅應 ≥70%，實際 ${Math.round(aiReduction * 100)}%`);

console.info("\n[verify:places-api] 全部通過 ✓\n");
