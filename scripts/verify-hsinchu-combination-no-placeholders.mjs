/**
 * Verify Hsinchu (and other non-curated cities) never surface destination+category placeholders.
 */
import {
  getDestinationCombinations,
  buildDestinationCombinationSuggestionsReply,
  isGenericDestinationPlaceholder,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import {
  validateCombinationOptions,
  setCachedDiscoveredCombinations,
  clearDiscoveredCombinationsCache,
  resolveDestinationForCombinations,
} from "../src/lib/ai/destination-combination-discovery.ts";
import { buildDynamicDestinationCombinations } from "../src/lib/ai/destination-travel-profile.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

const BANNED = [
  "新竹人氣景點",
  "新竹必去地標",
  "新竹特色商圈",
  "新竹夜市或市集",
  "新竹公園綠地",
  "新竹博物館",
];

console.log("=== Generic placeholder detection ===\n");
for (const name of BANNED) {
  assert(isGenericDestinationPlaceholder(name, "新竹"), `blocks ${name}`);
}
assert(!isGenericDestinationPlaceholder("新竹都城隍廟", "新竹"), "allows 新竹都城隍廟");
assert(!isGenericDestinationPlaceholder("南寮漁港", "新竹"), "allows 南寮漁港");
assert(!isGenericDestinationPlaceholder("玻璃工藝博物館", "新竹"), "allows 玻璃工藝博物館");

console.log("\n=== Destination resolution for 新竹 ===\n");
const resolution = resolveDestinationForCombinations("新竹");
assert(resolution.displayName === "新竹", "displayName=新竹");
assert(resolution.searchAreas.includes("新竹市"), `searchAreas include 新竹市 (${resolution.searchAreas.join("|")})`);
assert(Boolean(resolution.coordinates), "has approx coordinates");

console.log("\n=== Sync path must NOT invent placeholders for 新竹 ===\n");
clearDiscoveredCombinationsCache("新竹");
const syncCombos = buildDynamicDestinationCombinations("新竹");
const allSyncPlaces = syncCombos.flatMap((c) => c.places);
assert(
  allSyncPlaces.every((p) => !isGenericDestinationPlaceholder(p, "新竹")),
  "sync synthesis has no generic placeholders",
);
assert(
  !BANNED.some((b) => allSyncPlaces.includes(b)),
  "banned placeholder names absent from sync pool",
);

const reply = buildDestinationCombinationSuggestionsReply("新竹", 4, {
  startDate: "2026-09-01",
});
assert(
  reply == null || !BANNED.some((b) => reply.includes(b)),
  "combination reply never contains banned placeholders",
);
if (syncCombos.length < 3) {
  assert(reply == null, "empty/insufficient sync combos → null reply (no fake fill)");
}

console.log("\n=== Discovered cache path yields real places ===\n");
clearDiscoveredCombinationsCache("新竹");
setCachedDiscoveredCombinations("新竹", [
  {
    combinationId: "hsinchu:1",
    title: "舊城文化組合",
    theme: "historic",
    placeCandidates: [
      { name: "新竹都城隍廟", searchCandidateId: "a", types: ["place_of_worship"] },
      { name: "新竹州廳", searchCandidateId: "b", types: ["tourist_attraction"] },
      { name: "東門市場", searchCandidateId: "c", types: ["market"] },
    ],
  },
  {
    combinationId: "hsinchu:2",
    title: "城市慢遊組合",
    theme: "nature",
    placeCandidates: [
      { name: "新竹公園", searchCandidateId: "d", types: ["park"] },
      { name: "新竹市立動物園", searchCandidateId: "e", types: ["zoo"] },
      { name: "麗池公園", searchCandidateId: "f", types: ["park"] },
    ],
  },
  {
    combinationId: "hsinchu:3",
    title: "海岸夕陽組合",
    theme: "coast",
    placeCandidates: [
      { name: "南寮漁港", searchCandidateId: "g", types: ["tourist_attraction"] },
      { name: "香山濕地", searchCandidateId: "h", types: ["natural_feature"] },
      { name: "十七公里海岸線", searchCandidateId: "i", types: ["tourist_attraction"] },
    ],
  },
  {
    combinationId: "hsinchu:4",
    title: "近郊自然組合",
    theme: "suburb",
    placeCandidates: [
      { name: "青青草原", searchCandidateId: "j", types: ["park"] },
      { name: "十八尖山", searchCandidateId: "k", types: ["natural_feature"] },
      { name: "北埔老街", searchCandidateId: "l", types: ["tourist_attraction"] },
    ],
  },
]);

const discovered = getDestinationCombinations("新竹");
assert(discovered.length >= 3, `discovered >=3 (got ${discovered.length})`);
const placeBlob = discovered.flatMap((c) => c.places).join("、");
assert(/都城隍廟|南寮|新竹公園|十八尖山/.test(placeBlob), `has real Hsinchu places: ${placeBlob}`);
assert(!BANNED.some((b) => placeBlob.includes(b)), "no banned placeholders in discovered");

const discoveredReply = buildDestinationCombinationSuggestionsReply("新竹", 4, {
  startDate: "2026-09-01",
});
assert(Boolean(discoveredReply), "discovered reply built");
assert(
  /2026[\/\-]09[\/\-]01/.test(discoveredReply ?? ""),
  "includes start date",
);
assert(!BANNED.some((b) => (discoveredReply ?? "").includes(b)), "reply clean of placeholders");

const validation = validateCombinationOptions(
  [
    {
      combinationId: "bad",
      title: "假組合",
      theme: "x",
      placeCandidates: [
        { name: "新竹人氣景點", types: [] },
        { name: "新竹必去地標", types: [] },
      ],
    },
  ],
  "新竹",
);
assert(!validation.ok, "validation rejects generic placeholders");
// genericPlaceNames may be empty when validation fails for too_few_combinations first
assert(
  !validation.ok &&
    (validation.genericPlaceNames.length >= 1 ||
      /generic|too_few|placeholder/i.test(validation.reason ?? "")),
  "validation rejects generic / insufficient combo",
);

console.log("\n=== Curated cities still work ===\n");
for (const city of ["台中", "台南", "台北", "東京"]) {
  const combos = getDestinationCombinations(city);
  assert(combos.length >= 3, `${city} still has >=3 combinations`);
  assert(
    combos.every((c) => c.places.every((p) => !isGenericDestinationPlaceholder(p, city))),
    `${city} places not placeholders`,
  );
}

clearDiscoveredCombinationsCache("新竹");

console.log("\n=== Summary ===");
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("All Hsinchu combination checks passed.");
