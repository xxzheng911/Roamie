/**
 * Single-combination mode: dynamic capacity, compact itinerary, Hualien #4 acceptance.
 * Destination-agnostic logic under test; Hualien is one acceptance fixture among globals.
 */
import assert from "node:assert/strict";
import {
  calculateDynamicStopCapacity,
  evaluateTotalRealPlaceValidation,
  buildSelectedThemeProfile,
} from "../src/lib/ai/real-place-supplement.ts";
import {
  clearCombinationPoolMemo,
  planSelectedCombinationCapacity,
  resolveSelectedCombinationPools,
  validateSelectedCombinationIntegrity,
  ensureCombinationProvenanceOnPlaces,
} from "../src/lib/ai/combination-itinerary-integrity.ts";
import {
  getDestinationCombinations,
  parseCombinationSelectionIndices,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import { combinationIdsFromPlace } from "../src/lib/ai/combination-provenance.ts";
import { buildMixedItineraryFromPlaces } from "../src/lib/trip/mixed-itinerary-schedule.ts";
import {
  combinationMappingFailureMessage,
  SINGLE_COMBINATION_MAPPING_FAILED_MESSAGE,
  COMBINATION_MAPPING_FAILED_MESSAGE,
} from "../src/lib/ai/itinerary-place-fetch.ts";

const GLOBAL_SINGLE_CASES = [
  { dest: "花蓮", days: 3 },
  { dest: "台東", days: 4 },
  { dest: "台北", days: 3 },
  { dest: "台中", days: 5 },
  { dest: "宜蘭", days: 4 },
  { dest: "東京", days: 6 },
  { dest: "大阪", days: 5 },
  { dest: "京都", days: 4 },
  { dest: "首爾", days: 5 },
  { dest: "釜山", days: 4 },
  { dest: "巴黎", days: 6 },
  { dest: "倫敦", days: 5 },
  { dest: "曼谷", days: 5 },
  { dest: "新加坡", days: 4 },
];

let failed = 0;
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function mockPlace(name, comboId, i, dest) {
  return {
    name,
    placeName: name,
    googlePlaceId: `ChIJ_single_${comboId}_${i}_${name.length}`,
    address: `${dest} ${name}`,
    lat: 23.9 + (i % 5) * 0.03,
    lng: 121.5 + (i % 4) * 0.03,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1-2h",
    googleMapsUrl: "",
    reasonSource: "template",
    sourceCombinationId: comboId,
    sourceCombinationIds: [comboId],
    matchedSelectedCombinationIds: [comboId],
    rating: 4.4,
    userRatingCount: 500,
    photoName: `photos/p${i}`,
  };
}

console.log("=== verify-single-combination-capacity ===\n");

check("parse single selection '4'", () => {
  assert.deepEqual(parseCombinationSelectionIndices("4", 5), [3]);
});

check("failure message differs for single vs multi total_count", () => {
  assert.equal(
    combinationMappingFailureMessage({
      code: "total_real_place_count_insufficient",
      selectedCombinationCount: 1,
    }),
    SINGLE_COMBINATION_MAPPING_FAILED_MESSAGE,
  );
  assert.equal(
    combinationMappingFailureMessage({
      code: "total_real_place_count_insufficient",
      selectedCombinationCount: 3,
    }),
    COMBINATION_MAPPING_FAILED_MESSAGE,
  );
});

// 花蓮 combo 4 acceptance fixture (theme profile + capacity; discovery may be empty offline)
check("花蓮 3d select 4 — single mode capacity + compact pass", () => {
  clearCombinationPoolMemo();
  const ids = [4];
  const plan = planSelectedCombinationCapacity({
    tripDays: 3,
    selectedCombinationIds: ids,
  });
  assert.equal(plan.minimumViableStops, 5);
  assert.equal(plan.preferredStops, 9);
  assert.equal(plan.minimumRepresentativePerCombination, 1);

  // Offline discovery may be empty; seed theme from product title for combo 4.
  const profile = buildSelectedThemeProfile({
    selectedCombinationIds: ids,
    pools: [{ combinationId: 4, theme: "coast", title: "海岸夕陽組合" }],
  });
  assert.deepEqual(profile.selectedCombinationIds, [4]);
  assert.ok(profile.primaryThemes.includes("coast"));
  assert.ok(profile.primaryThemes.includes("harbor"));
  assert.ok(profile.primaryThemes.includes("sunset"));

  // Simulate: 2 original harbor candidates + same-theme supplement → 5 (compact viable)
  const places = [
    mockPlace("花蓮港景觀橋", 4, 1, "花蓮"),
    mockPlace("花蓮港燈塔", 4, 2, "花蓮"),
    mockPlace("七星潭", 4, 3, "花蓮"),
    mockPlace("北濱公園", 4, 4, "花蓮"),
    mockPlace("鹽寮蔚藍海岸", 4, 5, "花蓮"),
  ];

  const stamped = ensureCombinationProvenanceOnPlaces(places, "花蓮", ids);
  assert.ok(stamped.every((p) => combinationIdsFromPlace(p).includes(4)));

  const validation = evaluateTotalRealPlaceValidation(stamped.length, plan.dynamicCapacity);
  assert.equal(validation.result, "compact");
  assert.equal(validation.compactItineraryMode, true);

  const integrity = validateSelectedCombinationIntegrity({
    destination: "花蓮",
    selectedCombinationIds: ids,
    resolvedPlaces: stamped,
    supplementAttempted: true,
    tripDays: 3,
    capacityPlan: plan,
  });
  assert.equal(integrity.ok, true, integrity.reasons.join("|"));
  assert.notEqual(integrity.failureCode, "total_real_place_count_insufficient");
  assert.deepEqual(integrity.coverage.uncoveredIds, []);

  const stops = buildMixedItineraryFromPlaces(stamped, 3, "2026-08-15", "花蓮", {
    selectedCombinationIds: ids,
  });
  assert.ok(stops.length >= plan.minimumViableStops, `stops=${stops.length}`);
  assert.ok(stops.every((s) => s.googlePlaceId));
  console.log(
    `  hualien#4: originalCandidates=2 resolved=${stamped.length} stops=${stops.length} mode=compact preferred=${plan.preferredStops} minViable=${plan.minimumViableStops}`,
  );
});

check("single select with 2 places fails before supplement (below minimumViable)", () => {
  const plan = planSelectedCombinationCapacity({
    tripDays: 3,
    selectedCombinationIds: [4],
  });
  const places = [
    mockPlace("花蓮港景觀橋", 4, 1, "花蓮"),
    mockPlace("花蓮港燈塔", 4, 2, "花蓮"),
  ];
  const integrity = validateSelectedCombinationIntegrity({
    destination: "花蓮",
    selectedCombinationIds: [4],
    resolvedPlaces: places,
    supplementAttempted: true,
    tripDays: 3,
    capacityPlan: plan,
  });
  assert.equal(integrity.ok, false);
  assert.equal(integrity.failureCode, "total_real_place_count_insufficient");
});

check("single select with 5 places passes compact (fetch preferred=days×3, viable floor leaner)", () => {
  const plan = planSelectedCombinationCapacity({
    tripDays: 3,
    selectedCombinationIds: [1],
  });
  assert.equal(plan.preferredStops, 9);
  assert.equal(plan.minimumViableStops, 5);
  const places = Array.from({ length: 5 }, (_, i) =>
    mockPlace(`景點${i}`, 1, i, "台北"),
  );
  const integrity = validateSelectedCombinationIntegrity({
    destination: "台北",
    selectedCombinationIds: [1],
    resolvedPlaces: places,
    supplementAttempted: true,
    tripDays: 3,
    capacityPlan: plan,
  });
  assert.equal(integrity.ok, true, integrity.reasons.join("|"));
  const v = evaluateTotalRealPlaceValidation(5, plan.dynamicCapacity);
  assert.equal(v.result, "compact");
});

let singlePass = 0;
let singleTotal = 0;

for (const { dest, days } of GLOBAL_SINGLE_CASES) {
  clearCombinationPoolMemo();
  const combos = getDestinationCombinations(dest);
  const comboCount = Math.max(combos.length, 1);
  const maxCombo = Math.min(5, comboCount);

  for (let comboId = 1; comboId <= maxCombo; comboId += 1) {
    singleTotal += 1;
    check(`${dest} ${days}d single select ${comboId}`, () => {
      const ids = [comboId];
      const plan = planSelectedCombinationCapacity({
        tripDays: days,
        selectedCombinationIds: ids,
      });
      assert.equal(plan.selectedIds.length, 1);
      assert.ok(plan.minimumViableStops >= 1);
      assert.ok(plan.preferredStops >= plan.minimumViableStops);
      // Never require fixed days×3
      assert.ok(plan.minimumViableStops < days * 3);

      const pools = resolveSelectedCombinationPools(dest, ids, { forceRefresh: true });
      assert.equal(pools.length, 1);

      const places = [];
      const pool = pools[0];
      const need = plan.minimumViableStops;
      for (let i = 0; i < need; i += 1) {
        const name = pool?.all[i]?.name ?? `${dest}-combo${comboId}-place${i}`;
        places.push(mockPlace(name, comboId, i, dest));
      }

      const integrity = validateSelectedCombinationIntegrity({
        destination: dest,
        selectedCombinationIds: ids,
        resolvedPlaces: places,
        supplementAttempted: true,
        tripDays: days,
        capacityPlan: plan,
      });
      assert.equal(
        integrity.ok,
        true,
        `${dest}#${comboId}: ${integrity.reasons.join("|")}`,
      );
      assert.deepEqual(integrity.coverage.uncoveredIds, []);

      const stops = buildMixedItineraryFromPlaces(places, days, "2026-08-15", dest, {
        selectedCombinationIds: ids,
      });
      assert.ok(stops.length >= 1);
      singlePass += 1;
    });
  }
}

console.log(
  `\n=== single-select pass rate: ${singlePass}/${singleTotal} (${singleTotal ? Math.round((singlePass / singleTotal) * 100) : 0}%) ===`,
);
console.log(`=== summary: passed=${passed} failed=${failed} ===`);
if (failed > 0) process.exit(1);
console.log("All single-combination capacity checks passed.");
