/**
 * 估算一次 AI 推薦的 Places API 呼叫量（依分類定義與 sequential primary/fallback 策略）。
 * 執行：npx vite-node scripts/estimate-ai-place-api-calls.mjs
 */
import {
  AI_MIN_CANDIDATES_TARGET,
  AI_PRIMARY_CATEGORY_COUNT,
  estimateCategoryListApiCalls,
} from "../src/lib/recommendation/ai-places-cache.ts";
import {
  pickCategoriesForContext,
  RECOMMENDATION_CATEGORY_DEFS,
} from "../src/lib/recommendation/categories.ts";

const SCENARIOS = [
  {
    label: "台北・晴天・白天・無心情",
    weather: {
      tempC: 28,
      precipProbability: 10,
      condition: "Clear",
      isDaytime: true,
      city: "Taipei",
    },
    mood: undefined,
    time: "2026-06-14T14:00:00+08:00",
  },
  {
    label: "台北・雨天・白天",
    weather: {
      tempC: 22,
      precipProbability: 80,
      condition: "Rain",
      isDaytime: true,
      city: "Taipei",
    },
    mood: "下雨天",
    time: "2026-06-14T11:00:00+08:00",
  },
  {
    label: "台北・夜晚・深夜散步",
    weather: {
      tempC: 24,
      precipProbability: 20,
      condition: "Clouds",
      isDaytime: false,
      city: "Taipei",
    },
    mood: "深夜散步",
    time: "2026-06-14T23:30:00+08:00",
  },
];

function estimateForScenario(scenario) {
  const categories = pickCategoriesForContext({
    weather: scenario.weather,
    mood: scenario.mood,
    max: 6,
  });

  const primary = categories.slice(0, AI_PRIMARY_CATEGORY_COUNT);
  const fallback = categories.slice(AI_PRIMARY_CATEGORY_COUNT);

  const primaryCalls = estimateCategoryListApiCalls(primary);
  const fallbackCalls = estimateCategoryListApiCalls(fallback);

  const primaryMaxCandidates = primary.length * 4;
  const needsFallback = primaryMaxCandidates < AI_MIN_CANDIDATES_TARGET;

  const candidateFetch = needsFallback
    ? {
        nearby: primaryCalls.nearby + fallbackCalls.nearby,
        text: primaryCalls.text + fallbackCalls.text,
        categoriesRun: primary.length + fallback.length,
      }
    : {
        nearby: primaryCalls.nearby,
        text: primaryCalls.text,
        categoriesRun: primary.length,
      };

  const enrichTextPerRec = 5;

  return {
    scenario: scenario.label,
    categoryOrder: categories.map((c) => c.id),
    primaryCategories: primary.map((c) => c.id),
    fallbackCategories: fallback.map((c) => c.id),
    needsFallback,
    candidateFetch,
    enrich: { text: enrichTextPerRec },
    total: {
      nearby: candidateFetch.nearby,
      text: candidateFetch.text + enrichTextPerRec,
      details: 0,
      photo: 0,
    },
    beforeFix: {
      nearby: estimateCategoryListApiCalls(categories).nearby,
      text: estimateCategoryListApiCalls(categories).text + enrichTextPerRec,
      parallelCategories: categories.length,
    },
  };
}

console.log("=== AI Places API 估算（修正後 sequential + cache miss）===\n");

for (const scenario of SCENARIOS) {
  const result = estimateForScenario(scenario);
  console.log(`【${result.scenario}】`);
  console.log(`  分類順序: ${result.categoryOrder.join(" → ")}`);
  console.log(`  Primary (${AI_PRIMARY_CATEGORY_COUNT}): ${result.primaryCategories.join(", ")}`);
  if (result.fallbackCategories.length) {
    console.log(`  Fallback: ${result.fallbackCategories.join(", ")} (needsFallback=${result.needsFallback})`);
  }
  console.log(`  候選搜尋 (${result.candidateFetch.categoriesRun} 分類):`);
  console.log(`    Nearby: ${result.candidateFetch.nearby}`);
  console.log(`    Text:   ${result.candidateFetch.text}`);
  console.log(`  Enrich 營業時間 (AI 回 5 筆): Text ${result.enrich.text}`);
  console.log(`  合計: Nearby=${result.total.nearby} Text=${result.total.text} Details=${result.total.details} Photo=${result.total.photo}`);
  console.log(`  修正前 (6 分類 parallel): Nearby=${result.beforeFix.nearby} Text=${result.beforeFix.text}`);
  console.log("");
}

console.log("分類 HTTP 對照表:");
for (const def of RECOMMENDATION_CATEGORY_DEFS) {
  const calls = estimateCategoryListApiCalls([def]);
  console.log(`  ${def.id.padEnd(8)} mode=${def.mode.padEnd(6)} nearby=${calls.nearby} text=${calls.text}`);
}
