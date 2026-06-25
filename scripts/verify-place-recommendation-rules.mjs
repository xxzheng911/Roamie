import {
  normalizePlaceName,
  isSameCorePlace,
} from "../src/lib/place-planning-memory.ts";
import {
  filterPlacesForAttractionRecommendation,
  isGenericParkPlace,
  NO_MORE_RECOMMENDATIONS_MESSAGE,
} from "../src/lib/ai/place-recommendation-rules.ts";
import { isRefreshRecommendationsRequest } from "../src/lib/ai/chat-recommendation-refresh.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

assert(normalizePlaceName("象山公園") === "象山", "象山公園 → 象山");
assert(normalizePlaceName("象山步道") === "象山", "象山步道 → 象山");
assert(normalizePlaceName("台北 101 觀景台") === "台北101", "台北101觀景台");
assert(normalizePlaceName("101 觀景台") === "台北101", "101觀景台");
assert(normalizePlaceName("愛河親水公園") === "愛河", "愛河親水公園");
assert(normalizePlaceName("富士山廣場") === "富士山", "富士山廣場");
assert(normalizePlaceName("富士山五合目") === "富士山", "富士山五合目");

assert(
  isSameCorePlace({ name: "象山" }, { name: "象山公園" }),
  "象山 vs 象山公園 same core",
);
assert(
  isSameCorePlace({ name: "台北101" }, { name: "101觀景台" }),
  "台北101 vs 101觀景台 same core",
);

assert(
  isGenericParkPlace({ name: "中山公園", types: ["park"] }, false),
  "中山公園 excluded",
);
assert(
  isGenericParkPlace({ name: "象山公園", types: ["park"] }, false),
  "象山公園 excluded",
);
assert(
  !isGenericParkPlace({ name: "中山公園", types: ["park"] }, true),
  "park allowed when user wants parks",
);

const blocked = filterPlacesForAttractionRecommendation(
  [
    { name: "象山公園", placeId: "a", types: ["park"] },
    { name: "國立故宮博物院", placeId: "b", types: ["museum"] },
    { name: "象山", placeId: "c", types: ["tourist_attraction"] },
    { name: "象山步道", placeId: "d", types: ["tourist_attraction"] },
  ],
  {
    allowParks: false,
    blockedCoreNames: ["象山", "台北101", "愛河", "富士山"],
  },
);

assert(blocked.length === 1, "only museum passes filters");
assert(blocked[0]?.name === "國立故宮博物院", "museum kept");

assert(isRefreshRecommendationsRequest("還有其他的嗎"), "還有其他的嗎 triggers refresh");
assert(isRefreshRecommendationsRequest("還有別的嗎"), "還有別的嗎 triggers refresh");
assert(
  NO_MORE_RECOMMENDATIONS_MESSAGE.includes("美食"),
  "fallback message suggests alternatives",
);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll place recommendation rule checks passed");
