/**
 * Paris 7-day combination acceptance: 「都不錯」locks all; 「幫我生成」uses selection.
 */
import {
  buildCombinationSelectionAllowlist,
  buildOfferedCombinationsForSession,
  isSoftAcceptAllCombinationsReply,
  isUserAllOrAutoCombinationReply,
  resolveSelectedCombinations,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import { normalizeWeather } from "../src/services/weatherService.ts";
import { weatherDisplayEmoji } from "../src/lib/outfit/weather-icons.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

console.log("=== 巴黎 7 天 組合選擇 / 天氣正規化 ===\n");

assert(isSoftAcceptAllCombinationsReply("都不錯"), "都不錯 is soft accept-all");
assert(isUserAllOrAutoCombinationReply("都不錯"), "都不錯 is all-or-auto");
assert(isUserAllOrAutoCombinationReply("幫我生成"), "幫我生成 is all-or-auto");

const resolved = resolveSelectedCombinations("巴黎", "都不錯");
assert(resolved?.indexes?.join(",") === "0,1,2,3", `indexes=${resolved?.indexes}`);
assert(
  resolved?.selectionSource === "all_selected_by_user",
  `selectionSource=${resolved?.selectionSource}`,
);

const allowlist = buildCombinationSelectionAllowlist("巴黎", "都不錯");
assert(
  JSON.stringify(allowlist?.selectedCombinationIds) === JSON.stringify([1, 2, 3, 4]),
  `selectedCombinationIds=${JSON.stringify(allowlist?.selectedCombinationIds)}`,
);
assert(
  (allowlist?.allowedPlaceNames?.length ?? 0) >= 8,
  `allowedPlaceNames count=${allowlist?.allowedPlaceNames?.length}`,
);
assert(
  allowlist?.allowedPlaceNames?.includes("艾菲爾鐵塔") &&
    allowlist?.allowedPlaceNames?.includes("羅浮宮"),
  "allowlist includes classic + museum places",
);

const offered = buildOfferedCombinationsForSession("巴黎");
assert(offered.length === 4, `offeredCombinations length=${offered.length}`);
assert(
  offered.every((c) => c.places.every((p) => p.resolutionStatus === "named" && p.searchQuery)),
  "each offered place has searchQuery + named status",
);

const brokenWeather = normalizeWeather({
  city: "巴黎",
  tempC: null,
  feelsLikeC: null,
  condition: undefined,
  iconType: "",
  isDaytime: true,
  precipProbability: null,
  humidityPercent: null,
  windSpeedKmh: null,
  cloudCoverPercent: null,
  uvi: null,
  sunrise: null,
  sunset: null,
  recommendation: "indoor",
  recommendationText: "",
  source: "unavailable",
  fetchedAt: new Date().toISOString(),
  available: false,
});
assert(
  typeof brokenWeather.condition === "string",
  `normalizeWeather coerces undefined condition → "${brokenWeather.condition}"`,
);

try {
  const emoji = weatherDisplayEmoji({
    condition: undefined,
    tempHighC: 18,
    tempLowC: 10,
    precipProbability: null,
    diurnalRangeC: 8,
  });
  assert(typeof emoji === "string" && emoji.length > 0, `weatherDisplayEmoji=${emoji}`);
} catch (e) {
  console.error("FAIL weatherDisplayEmoji threw", e);
  failed += 1;
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll Paris combination selection checks passed.");
