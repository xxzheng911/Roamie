/**
 * Acceptance: Places mapping queue + 「可以幫我生成」 selectionSource + core place gate.
 */
import {
  isUserAllOrAutoCombinationReply,
  buildCombinationSelectionAllowlist,
  parseCombinationSelectionIndices,
  flattenDestinationCombinationPlaces,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import { isResolvedCorePlace } from "../src/lib/ai/planning-real-place.ts";
import {
  computeFirstRoundPlaceMapCap,
  computeItineraryResolvedTarget,
  PLACE_MAP_MAX_CONCURRENCY,
  mapWithConcurrencyLimit,
} from "../src/lib/ai/place-map-queue.ts";
import { parsePendingOptionSelection } from "../src/lib/ai/destination-pending-question.ts";
import { PLACES_API_MAX_CONCURRENT } from "../src/lib/places-api-guard.ts";

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

console.log("=== Combination all-or-auto ===\n");
assert(isUserAllOrAutoCombinationReply("可以幫我生成"), "可以幫我生成 → all");
assert(isUserAllOrAutoCombinationReply("幫我生成"), "幫我生成 → all");
assert(isUserAllOrAutoCombinationReply("都可以"), "都可以 → all");
assert(isUserAllOrAutoCombinationReply("你決定"), "你決定 → all");
assert(isUserAllOrAutoCombinationReply("Roamie 幫我安排"), "Roamie 幫我安排 → all");
assert(!isUserAllOrAutoCombinationReply("随便看看吧好吗"), "ambiguous not all");
assert(
  JSON.stringify(parseCombinationSelectionIndices("可以幫我生成", 4)) === "[0,1,2,3]",
  "indices all four",
);

const al = buildCombinationSelectionAllowlist("台中", "可以幫我生成");
assert(al?.selectionSource === "user_all_or_auto", `selectionSource=${al?.selectionSource}`);
assert(
  JSON.stringify(al?.selectedCombinationIds) === "[1,2,3,4]",
  `ids=${JSON.stringify(al?.selectedCombinationIds)}`,
);

const unique = flattenDestinationCombinationPlaces("台中");
assert(unique.length <= 18, `taichung unique places=${unique.length} (<=18)`);
assert(unique.length >= 10, `taichung unique places=${unique.length} (>=10)`);

const selected = parsePendingOptionSelection("可以幫我生成", {
  type: "combination_choice",
  options: ["文創慢逛組合", "商圈夜市組合", "經典地標組合", "近郊自然組合"],
  baseDestination: "台中",
});
assert(
  Boolean(selected && selected.split("|").length === 4),
  `pending titles count=${selected?.split("|").length}`,
);

const amb = parsePendingOptionSelection("哈哈亂講", {
  type: "combination_choice",
  options: ["文創慢逛組合", "商圈夜市組合"],
  baseDestination: "台中",
});
assert(amb === null, "ambiguous → null (no silent all)");

console.log("\n=== Candidate cap + concurrency ===\n");
assert(computeFirstRoundPlaceMapCap(4) === 16, `cap4=${computeFirstRoundPlaceMapCap(4)}`);
assert(computeItineraryResolvedTarget(4) === 12, `target4=${computeItineraryResolvedTarget(4)}`);
assert(PLACE_MAP_MAX_CONCURRENCY === 2, "place map concurrency 2");
assert(PLACES_API_MAX_CONCURRENT === 2, "places api concurrency 2");

let maxInFlight = 0;
let inFlight = 0;
const order = await mapWithConcurrencyLimit(
  [1, 2, 3, 4, 5, 6],
  async (n) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 30));
    inFlight -= 1;
    return n * 10;
  },
  { concurrency: 2, batchGapMs: 0 },
);
assert(maxInFlight <= 2, `maxInFlight=${maxInFlight}`);
assert(JSON.stringify(order) === "[10,20,30,40,50,60]", `order=${JSON.stringify(order)}`);

console.log("\n=== resolvedCorePlace ===\n");
assert(
  isResolvedCorePlace({
    googlePlaceId: "ChIJbYl7d2F2BjQRnFdvyMBuZfI",
    name: "台中公園",
    lat: 24.14,
    lng: 120.68,
    address: "台中市北區",
    destinationMatch: true,
  }) === true,
  "core with address accepted",
);
assert(
  isResolvedCorePlace({
    googlePlaceId: "ChIJbYl7d2F2BjQRnFdvyMBuZfI",
    name: "台中公園",
    lat: 24.14,
    lng: 120.68,
    destinationMatch: true,
  }) === false,
  "core without address rejected",
);
assert(
  isResolvedCorePlace({
    googlePlaceId: "session:foo",
    name: "台中公園",
    lat: 24.14,
    lng: 120.68,
    address: "台中",
  }) === false,
  "session id rejected",
);

console.log("\n=== Summary ===");
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("All place-map / combination acceptance checks passed.");
