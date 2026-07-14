/**
 * Acceptance: 宜蘭 4 天 → 選 2、3、4
 * Places-first pools (primary+fallback), quality rejection, theme refill,
 * retry stats, travel-profile memoization.
 */
import {
  clearDiscoveredCombinationsCache,
  discoverDestinationCombinations,
  setCachedDiscoveredCombinations,
} from "../src/lib/ai/destination-combination-discovery.ts";
import {
  resolveSelectedCombinationPools,
  clearCombinationPoolMemo,
  computeMinimumResolvedPerCombination,
  computeMinimumResolvedPlaces,
  buildCombinationPlaceMappingStats,
  expandAllowlistNamesFromPools,
} from "../src/lib/ai/combination-itinerary-integrity.ts";
import {
  validateCandidateIntent,
  themeSearchQueries,
  resolveThemeKeyFromTitle,
} from "../src/lib/ai/combination-candidate-quality.ts";
import {
  resolveDestinationTravelProfile,
  beginDestinationTravelProfileSession,
  clearDestinationTravelProfileMemo,
} from "../src/lib/ai/destination-travel-profile.ts";
import {
  COMBINATION_MAPPING_FAILED_MESSAGE,
  COMBINATION_MAPPING_AUTO_RETRY_MESSAGE,
} from "../src/lib/ai/itinerary-place-fetch.ts";

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

clearDiscoveredCombinationsCache();
clearCombinationPoolMemo();
clearDestinationTravelProfileMemo();

const mockPlaces = [
  // market / 商圈
  { id: "ChIJ_m1", name: "羅東夜市", lat: 24.677, lng: 121.767, types: ["market", "tourist_attraction"], primaryType: "market", rating: 4.3, address: "宜蘭縣羅東鎮" },
  { id: "ChIJ_m2", name: "宜蘭東門夜市", lat: 24.757, lng: 121.754, types: ["market"], primaryType: "market", rating: 4.1, address: "宜蘭市" },
  { id: "ChIJ_m3", name: "五結市場", lat: 24.685, lng: 121.79, types: ["market"], primaryType: "market", rating: 4.0, address: "宜蘭縣五結鄉" },
  { id: "ChIJ_m4", name: "幾米廣場", lat: 24.755, lng: 121.758, types: ["tourist_attraction"], primaryType: "tourist_attraction", rating: 4.4, address: "宜蘭市" },
  { id: "ChIJ_m5", name: "宜蘭新月廣場", lat: 24.753, lng: 121.752, types: ["shopping_mall"], primaryType: "shopping_mall", rating: 4.0, address: "宜蘭市" },
  // culture / 藝文博物館 — good places + bad noise
  { id: "ChIJ_c1", name: "蘭陽博物館", lat: 24.86, lng: 121.83, types: ["museum"], primaryType: "museum", rating: 4.5, address: "宜蘭縣頭城鎮" },
  { id: "ChIJ_c2", name: "國立傳統藝術中心", lat: 24.687, lng: 121.824, types: ["museum", "tourist_attraction"], primaryType: "museum", rating: 4.4, address: "宜蘭縣五結鄉" },
  { id: "ChIJ_c3", name: "宜蘭文學館", lat: 24.76, lng: 121.75, types: ["museum"], primaryType: "museum", rating: 4.2, address: "宜蘭市" },
  { id: "ChIJ_c4", name: "中興文化創意園區", lat: 24.745, lng: 121.78, types: ["tourist_attraction", "art_gallery"], primaryType: "tourist_attraction", rating: 4.3, address: "宜蘭縣五結鄉" },
  { id: "ChIJ_c5", name: "畫框博物館", lat: 24.67, lng: 121.78, types: ["museum"], primaryType: "museum", rating: 4.0, address: "宜蘭縣羅東鎮" },
  { id: "ChIJ_bad1", name: "台灣創價學會", lat: 24.75, lng: 121.75, types: ["establishment"], primaryType: "establishment", rating: 3.0, address: "宜蘭市" },
  { id: "ChIJ_bad2", name: "創價美術館 宜蘭館", lat: 24.75, lng: 121.751, types: ["art_gallery"], primaryType: "art_gallery", rating: 3.5, address: "宜蘭市" },
  { id: "ChIJ_bad3", name: "美拍玩很大OMG", lat: 24.76, lng: 121.76, types: ["point_of_interest"], primaryType: "point_of_interest", rating: 3.2, address: "宜蘭市" },
  // historic / 舊城
  { id: "ChIJ_h1", name: "宜蘭城隍廟", lat: 24.758, lng: 121.753, types: ["place_of_worship"], primaryType: "place_of_worship", rating: 4.4, address: "宜蘭市" },
  { id: "ChIJ_h2", name: "宜蘭設治紀念館", lat: 24.757, lng: 121.752, types: ["museum", "tourist_attraction"], primaryType: "museum", rating: 4.3, address: "宜蘭市" },
  { id: "ChIJ_h3", name: "宜蘭酒廠", lat: 24.76, lng: 121.75, types: ["tourist_attraction"], primaryType: "tourist_attraction", rating: 4.2, address: "宜蘭市" },
  { id: "ChIJ_h4", name: "宜蘭火車站前舊城區", lat: 24.754, lng: 121.757, types: ["tourist_attraction"], primaryType: "tourist_attraction", rating: 4.0, address: "宜蘭市" },
  { id: "ChIJ_h5", name: "碧霞宮", lat: 24.759, lng: 121.754, types: ["place_of_worship"], primaryType: "place_of_worship", rating: 4.1, address: "宜蘭市" },
  // fillers so discovery has density
  { id: "ChIJ_n1", name: "冬山河親水公園", lat: 24.66, lng: 121.81, types: ["park"], primaryType: "park", rating: 4.5, address: "宜蘭縣五結鄉" },
  { id: "ChIJ_n2", name: "礁溪溫泉公園", lat: 24.83, lng: 121.77, types: ["park"], primaryType: "park", rating: 4.3, address: "宜蘭縣礁溪鄉" },
];

const searchPlaces = async ({ data }) => {
  const q = (data?.query ?? "").toLowerCase();
  let places = mockPlaces;
  if (/博物|美術|museum|gallery|文化/.test(q)) {
    places = mockPlaces.filter((p) =>
      /museum|art_gallery|文化|博物|美術|文學|傳統藝術|畫框|中興|創價|美拍/.test(
        `${p.name} ${(p.types ?? []).join(" ")} ${p.primaryType}`,
      ),
    );
  } else if (/夜市|市場|商圈|market/.test(q)) {
    places = mockPlaces.filter((p) =>
      /market|shopping|夜市|廣場|市集/.test(`${p.name} ${(p.types ?? []).join(" ")}`),
    );
  } else if (/古蹟|廟|老街|historic|temple/.test(q)) {
    places = mockPlaces.filter((p) =>
      /place_of_worship|廟|紀念|酒廠|舊城/.test(`${p.name} ${(p.types ?? []).join(" ")}`),
    );
  }
  return { places, error: null };
};

console.log("=== 宜蘭 4 天 選 2、3、4 ===\n");

const discovered = await discoverDestinationCombinations({
  destination: "宜蘭",
  searchPlaces,
});
assert(Boolean(discovered && discovered.length >= 3), `discovery combos=${discovered?.length}`);

if (discovered) {
  setCachedDiscoveredCombinations("宜蘭", discovered);
  console.log("\nDiscovered combinations:");
  for (const [i, c] of discovered.entries()) {
    console.log(
      `  ${i + 1}. ${c.title} [${c.theme}] primary=${(c.primaryCandidates ?? c.placeCandidates.slice(0, 3)).map((p) => p.name).join("|")} fallback=${(c.fallbackCandidates ?? []).map((p) => p.name).join("|")}`,
    );
  }
}

// Quality: reject association / soka / low-intent names
const bad1 = validateCandidateIntent(
  { name: "台灣創價學會", types: ["establishment"] },
  { theme: "culture", title: "藝文博物館組合" },
  "宜蘭",
);
assert(bad1.ok === false, `reject 台灣創價學會 reason=${bad1.reason}`);

const bad2 = validateCandidateIntent(
  { name: "創價美術館 宜蘭館", types: ["art_gallery"] },
  { theme: "culture", title: "藝文博物館組合" },
  "宜蘭",
);
assert(bad2.ok === false, `reject 創價美術館 reason=${bad2.reason}`);

const good = validateCandidateIntent(
  {
    name: "蘭陽博物館",
    types: ["museum"],
    primaryType: "museum",
    address: "宜蘭縣頭城鎮",
    lat: 24.86,
    lng: 121.83,
  },
  { theme: "culture", title: "藝文博物館組合" },
  "宜蘭",
  { center: { lat: 24.75, lng: 121.75 }, requireTourismType: true },
);
assert(good.ok === true, "accept 蘭陽博物館");

// Find market/culture/historic ids matching titles 2,3,4 if order differs
const titleIndex = (re) => {
  const idx = discovered?.findIndex((c) => re.test(c.title));
  return idx != null && idx >= 0 ? idx + 1 : -1;
};
const idMarket = titleIndex(/商圈|市集|夜市/);
const idCulture = titleIndex(/藝文|博物/);
const idHistoric = titleIndex(/舊城|古蹟|文化/);
console.log(`\nMapped ids: market=${idMarket} culture=${idCulture} historic=${idHistoric}`);

const selected = [idMarket, idCulture, idHistoric].filter((id) => id > 0);
assert(selected.length === 3, `selected combination ids for 商圈/藝文/舊城 = ${selected.join(",")}`);

clearCombinationPoolMemo();
const pools = resolveSelectedCombinationPools("宜蘭", selected, { forceRefresh: true });

for (const pool of pools) {
  assert(pool.primary.length >= 1, `combo ${pool.combinationId} has primary candidates`);
  assert(
    pool.all.length >= pool.primary.length,
    `combo ${pool.combinationId} all >= primary (${pool.all.length}>=${pool.primary.length})`,
  );
  assert(
    !pool.primary.some((p) => /創價學會|美拍玩很大/.test(p.name)),
    `combo ${pool.combinationId} primary excludes low-quality`,
  );
  console.log(
    `\n[POOL] id=${pool.combinationId} theme=${pool.theme}`,
    `\n  primary: ${pool.primary.map((p) => p.name).join("、")}`,
    `\n  fallback: ${pool.fallback.map((p) => p.name).join("、")}`,
  );
  const queries = themeSearchQueries(pool.theme, "宜蘭");
  assert(queries.length >= 3, `theme queries for ${pool.theme}`);
  console.log(`  queries: ${queries.slice(0, 4).join(" | ")}`);
}

const minPer = computeMinimumResolvedPerCombination(4);
const minTotal = computeMinimumResolvedPlaces({ tripDays: 4, selectedCombinationCount: 3 });
assert(minPer === 2, `minPerCombo=2 got=${minPer}`);
assert(minTotal >= 6, `minTotal>=6 got=${minTotal}`);

const expanded = expandAllowlistNamesFromPools("宜蘭", selected);
assert(
  expanded.length >= selected.length * 2,
  `expanded allowlist names=${expanded.length}`,
);

// Simulate mapping: culture resolved via theme places
const resolvedMock = [
  { name: "羅東夜市", sourceCombinationId: idMarket, matchedSelectedCombinationIds: [idMarket] },
  { name: "宜蘭東門夜市", sourceCombinationId: idMarket, matchedSelectedCombinationIds: [idMarket] },
  { name: "蘭陽博物館", sourceCombinationId: idCulture, matchedSelectedCombinationIds: [idCulture] },
  { name: "國立傳統藝術中心", sourceCombinationId: idCulture, matchedSelectedCombinationIds: [idCulture] },
  { name: "宜蘭城隍廟", sourceCombinationId: idHistoric, matchedSelectedCombinationIds: [idHistoric] },
  { name: "宜蘭設治紀念館", sourceCombinationId: idHistoric, matchedSelectedCombinationIds: [idHistoric] },
];
const stats = buildCombinationPlaceMappingStats({
  destination: "宜蘭",
  selectedCombinationIds: selected,
  resolvedPlaces: resolvedMock,
  mappingMeta: {
    [idCulture]: {
      primaryCandidates: 3,
      fallbackCandidatesUsed: 2,
      searchRequests: 3,
      searchRetries: 2,
    },
  },
});
for (const s of stats) {
  assert(s.resolvedCount >= 1, `combo ${s.combinationId} resolved>=1 (got ${s.resolvedCount})`);
  if (s.combinationId === idCulture) {
    assert(s.searchRetries === 2, `culture searchRetries recorded (=${s.searchRetries})`);
    assert(s.fallbackCandidatesUsed === 2, `culture fallback used (=${s.fallbackCandidatesUsed})`);
  }
}

// Profile memoization
beginDestinationTravelProfileSession("gen_test_yilan");
clearDestinationTravelProfileMemo();
beginDestinationTravelProfileSession("gen_test_yilan");
const p1 = resolveDestinationTravelProfile("宜蘭");
const p2 = resolveDestinationTravelProfile("宜蘭");
const p3 = resolveDestinationTravelProfile("宜蘭");
assert(p1 === p2 && p2 === p3, "same generationRequestId reuses memoized profile object");
assert(p1.source === "discovered" || p1.themes.length >= 3, `profile source=${p1.source}`);

assert(
  !COMBINATION_MAPPING_FAILED_MESSAGE.includes("補查一次"),
  "failure copy no longer says auto-retry while asking regenerate",
);
assert(
  COMBINATION_MAPPING_AUTO_RETRY_MESSAGE.includes("正在重新搜尋"),
  "auto-retry copy available for in-progress state",
);
assert(
  resolveThemeKeyFromTitle("藝文博物館組合") === "culture",
  "theme from title=culture",
);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll 宜蘭 combination mapping checks passed.");
