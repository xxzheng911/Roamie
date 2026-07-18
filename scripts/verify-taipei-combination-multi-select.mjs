/**
 * Acceptance: 台北 4 天 → 選 2、3（文創市集 + 夜市商圈）
 * - selectedCombinationIds = [2,3]
 * - merge both combination place pools
 * - schedule with quotas → no empty Day 4
 * - each selected combination appears in itinerary
 */
import {
  buildCombinationSelectionAllowlist,
  parseCombinationSelectionIndices,
  resolveSelectedCombinations,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import {
  annotatePlaceWithCombinationMetadata,
  computeMinimumPerSelectedCombination,
  groupStopsByTripDays,
  mergeSelectedCombinationCandidates,
  selectPlacesWithCombinationQuota,
  validateGeneratedItinerary,
} from "../src/lib/ai/combination-itinerary-integrity.ts";
import { buildFallbackItineraryFromPlaces } from "../src/lib/trip/itinerary-guards.ts";
import { buildMixedItineraryFromPlaces } from "../src/lib/trip/mixed-itinerary-schedule.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

console.log("=== 台北 4 天 選 2、3 多選組合完整性 ===\n");

const inputs = ["2、3", "2,3", "2 3", "2跟3", "第二和第三", "文創加夜市"];
for (const raw of inputs) {
  const allowlist = buildCombinationSelectionAllowlist("台北", raw);
  const ids = allowlist?.selectedCombinationIds ?? [];
  assert(
    JSON.stringify(ids) === JSON.stringify([2, 3]),
    `parse "${raw}" → selectedCombinationIds=${JSON.stringify(ids)}`,
  );
}

assert(
  JSON.stringify(parseCombinationSelectionIndices("2、3", 4)) === JSON.stringify([1, 2]),
  "parseCombinationSelectionIndices 2、3 → 0-based [1,2]",
);

const resolved = resolveSelectedCombinations("台北", "2、3");
assert(resolved?.indexes.join(",") === "1,2", `indexes=${resolved?.indexes}`);
assert(
  resolved?.places.includes("松山文創園區") &&
    resolved?.places.includes("饒河夜市") &&
    resolved?.places.includes("西門町"),
  `merged places include combo2+3: ${resolved?.places?.join("|")}`,
);
assert(
  !resolved?.places.includes("台北101"),
  "does not include unselected combo1 landmarks",
);

const merged = mergeSelectedCombinationCandidates("台北", [2, 3]);
assert(merged.perCombinationBeforeDedup[2] >= 3, `combo2 count=${merged.perCombinationBeforeDedup[2]}`);
assert(merged.perCombinationBeforeDedup[3] >= 3, `combo3 count=${merged.perCombinationBeforeDedup[3]}`);
assert(merged.mergedBeforeDedup >= 6, `mergedBeforeDedup=${merged.mergedBeforeDedup}`);
assert(merged.mergedAfterDedup >= 6, `mergedAfterDedup=${merged.mergedAfterDedup}`);

const mockPlaces = [
  {
    name: "松山文創園區",
    placeName: "松山文創園區",
    googlePlaceId: "ChIJ_songshan",
    address: "台北市信義區",
    lat: 25.0439,
    lng: 121.5606,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1-2 小時",
    googleMapsUrl: "",
    reasonSource: "template",
    sourceCombinationId: 2,
    matchedSelectedCombinationIds: [2],
  },
  {
    name: "華山1914",
    placeName: "華山1914文化創意產業園區",
    googlePlaceId: "ChIJ_huashan",
    address: "台北市中正區",
    lat: 25.0443,
    lng: 121.5293,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1-2 小時",
    googleMapsUrl: "",
    reasonSource: "template",
    sourceCombinationId: 2,
    matchedSelectedCombinationIds: [2],
  },
  {
    name: "迪化街",
    placeName: "迪化街",
    googlePlaceId: "ChIJ_dihua",
    address: "台北市大同區",
    lat: 25.057,
    lng: 121.51,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1-2 小時",
    googleMapsUrl: "",
    reasonSource: "template",
    sourceCombinationId: 2,
    matchedSelectedCombinationIds: [2],
  },
  {
    name: "饒河夜市",
    placeName: "饒河街觀光夜市",
    googlePlaceId: "ChIJ_raohe",
    address: "台北市松山區",
    lat: 25.0508,
    lng: 121.5774,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1-2 小時",
    googleMapsUrl: "",
    reasonSource: "template",
    sourceCombinationId: 3,
    matchedSelectedCombinationIds: [3],
  },
  {
    name: "寧夏夜市",
    placeName: "寧夏夜市",
    googlePlaceId: "ChIJ_ningxia",
    address: "台北市大同區",
    lat: 25.0565,
    lng: 121.5153,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1-2 小時",
    googleMapsUrl: "",
    reasonSource: "template",
    sourceCombinationId: 3,
    matchedSelectedCombinationIds: [3],
  },
  {
    name: "西門町",
    placeName: "西門町",
    googlePlaceId: "ChIJ_ximen",
    address: "台北市萬華區",
    lat: 25.0421,
    lng: 121.508,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1-2 小時",
    googleMapsUrl: "",
    reasonSource: "template",
    sourceCombinationId: 3,
    matchedSelectedCombinationIds: [3],
  },
  {
    name: "信義商圈",
    placeName: "信義商圈",
    googlePlaceId: "ChIJ_xinyi",
    address: "台北市信義區",
    lat: 25.036,
    lng: 121.567,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1-2 小時",
    googleMapsUrl: "",
    reasonSource: "template",
    sourceCombinationId: 3,
    matchedSelectedCombinationIds: [3],
  },
].map((p) => annotatePlaceWithCombinationMetadata(p, "台北", [2, 3]));

const minPer = computeMinimumPerSelectedCombination(8, 2);
assert(minPer >= 1, `minimumPerSelectedCombination=${minPer}`);

const quotaPicked = selectPlacesWithCombinationQuota({
  places: mockPlaces,
  selectedCombinationIds: [2, 3],
  targetPlaceCount: 8,
  destination: "台北",
});
const hasCombo2 = quotaPicked.some((p) => p.matchedSelectedCombinationIds?.includes(2));
const hasCombo3 = quotaPicked.some((p) => p.matchedSelectedCombinationIds?.includes(3));
assert(hasCombo2 && hasCombo3, "quota pick keeps both combinations");

const stops = buildMixedItineraryFromPlaces(mockPlaces, 4, "2026-09-01", "台北", {
  selectedCombinationIds: [2, 3],
});
const grouped = groupStopsByTripDays(stops, 4, "2026-09-01");

console.log("\n--- Day allocation ---");
for (const day of grouped) {
  console.log(
    `Day ${day.date}:`,
    day.places
      .map(
        (s) =>
          `${s.placeName}(src=${(s.matchedSelectedCombinationIds ?? []).join(",") || s.sourceCombinationId})`,
      )
      .join(", ") || "(empty)",
  );
}

assert(grouped.length === 4, `day count=${grouped.length}`);
assert(
  grouped.every((d) => d.places.length > 0),
  "no empty days",
);

const fallback = buildFallbackItineraryFromPlaces(mockPlaces, 4, "2026-09-01", "台北", {
  selectedCombinationIds: [2, 3],
});
const fallbackGrouped = groupStopsByTripDays(fallback, 4, "2026-09-01");
assert(
  fallbackGrouped.every((d) => d.places.length > 0),
  "fallback has no empty days",
);

const placeNames = fallback.map((s) => s.placeName ?? s.title);
assert(
  placeNames.some((n) => /松山|華山|迪化/.test(n ?? "")),
  "includes combo2 creative places",
);
assert(
  placeNames.some((n) => /饒河|寧夏|西門|信義/.test(n ?? "")),
  "includes combo3 night-market/district places",
);

const validation = validateGeneratedItinerary({
  tripDays: 4,
  startDate: "2026-09-01",
  selectedCombinationIds: [2, 3],
  days: fallbackGrouped,
  resolvedPlaces: mockPlaces,
});
assert(validation.ok, `validateGeneratedItinerary ok=${validation.ok} reasons=${validation.reasons.join("|")}`);

// When unique resolved places < trip days, allocation must not invent synthetic
// fillers. Real-place supplement (earlier in the pipeline) is required; empty
// non-free days fail pre-save validation.
const combo2Only = mockPlaces.filter((p) => p.sourceCombinationId === 2);
const combo2Stops = buildFallbackItineraryFromPlaces(combo2Only, 4, "2026-09-01", "台北", {
  selectedCombinationIds: [2],
});
assert(
  combo2Stops.every((s) => Boolean(s.googlePlaceId?.trim())),
  "combo2-only never invents synthetic stops without Place IDs",
);
assert(
  combo2Stops.length === combo2Only.length,
  `combo2-only schedules all resolved places (got ${combo2Stops.length}, expected ${combo2Only.length})`,
);
assert(
  combo2Stops.length < 4,
  "combo2-only with 3 places cannot fill 4 days without real-place supplement",
);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll Taipei 2、3 combination integrity checks passed.");
