/**
 * Global combination-coverage contract (destination-agnostic).
 *
 * Verifies capacity-first planning, theme-representative coverage (≥1),
 * provenance merge, supplement-before-fail, and multi-select parse formats.
 * Does not call live Places APIs.
 */
import assert from "node:assert/strict";
import {
  parseCombinationSelectionIndices,
  buildCombinationSelectionAllowlist,
  getDestinationCombinations,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import {
  clearCombinationPoolMemo,
  ensureCombinationProvenanceOnPlaces,
  mergeSelectedCombinationCandidates,
  planSelectedCombinationCapacity,
  resolveSelectedCombinationPools,
  validateSelectedCombinationIntegrity,
  buildMultiCombinationCoverageReport,
  computeMinimumResolvedPerCombination,
} from "../src/lib/ai/combination-itinerary-integrity.ts";
import { calculateDynamicStopCapacity } from "../src/lib/ai/real-place-supplement.ts";
import {
  combinationIdsFromPlace,
  mergePlaceProvenance,
} from "../src/lib/ai/combination-provenance.ts";
import { buildMixedItineraryFromPlaces } from "../src/lib/trip/mixed-itinerary-schedule.ts";

const CASES = [
  // Taiwan
  { dest: "台北", days: 3 },
  { dest: "台中", days: 5 },
  { dest: "桃園", days: 3 },
  { dest: "台東", days: 4 },
  { dest: "屏東", days: 3 },
  { dest: "宜蘭", days: 4 },
  // Japan
  { dest: "東京", days: 6 },
  { dest: "大阪", days: 5 },
  { dest: "京都", days: 4 },
  { dest: "札幌", days: 5 },
  // Korea
  { dest: "首爾", days: 5 },
  { dest: "釜山", days: 4 },
  { dest: "濟州", days: 4 },
  // SEA
  { dest: "曼谷", days: 5 },
  { dest: "清邁", days: 4 },
  { dest: "宿霧", days: 5 },
  { dest: "新加坡", days: 4 },
  // Europe
  { dest: "巴黎", days: 6 },
  { dest: "倫敦", days: 6 },
  { dest: "愛丁堡", days: 4 },
  { dest: "羅馬", days: 5 },
  // Australia
  { dest: "雪梨", days: 5 },
  { dest: "墨爾本", days: 5 },
  { dest: "布里斯本", days: 4 },
];

const SELECTION_RAW = {
  single: ["1", "１"],
  dual: ["1、2", "1,2", "1 2"],
  triple: ["1、2、4", "1,2,4", "1 2 4"],
  all: ["都不錯", "全部", "1、2、3、4"],
};

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

function mockPlace(name, comboIds, i) {
  const latBase = 24.1 + (i % 7) * 0.02;
  const lngBase = 120.6 + (i % 5) * 0.02;
  return {
    name,
    placeName: name,
    googlePlaceId: `ChIJ_mock_${comboIds.join("_")}_${i}_${name.length}`,
    address: `${name} address`,
    lat: latBase,
    lng: lngBase,
    type: "景點",
    description: "",
    reason: "",
    estimatedTime: "1h",
    googleMapsUrl: "",
    reasonSource: "template",
    sourceCombinationId: comboIds[0],
    sourceCombinationIds: comboIds,
    matchedSelectedCombinationIds: comboIds,
    rating: 4.3,
    userRatingCount: 800,
    photoName: `photos/p${i}`,
  };
}

console.log("=== global combination coverage contract ===\n");

check("hard floor per combo is always 1", () => {
  assert.equal(computeMinimumResolvedPerCombination(3), 1);
  assert.equal(computeMinimumResolvedPerCombination(10), 1);
});

check("parse formats: ideographic / comma / space", () => {
  for (const raw of ["1、2、4", "1,2,4", "1 2 4", "1・2・4"]) {
    assert.deepEqual(parseCombinationSelectionIndices(raw, 4), [0, 1, 3]);
  }
});

for (const { dest, days } of CASES) {
  clearCombinationPoolMemo();
  const combos = getDestinationCombinations(dest);
  const comboCount = Math.max(combos.length, 1);

  check(`${dest} has combination pool (≥1)`, () => {
    assert.ok(comboCount >= 1, `${dest} combos=${comboCount}`);
  });

  const pickIds = (mode) => {
    if (mode === "single") return [1];
    if (mode === "dual") return [1, Math.min(2, comboCount)].filter((v, i, a) => a.indexOf(v) === i);
    if (mode === "triple") {
      const ids = [1, 2, Math.min(4, comboCount)].filter((id) => id <= comboCount);
      return [...new Set(ids)];
    }
    return Array.from({ length: comboCount }, (_, i) => i + 1);
  };

  for (const mode of ["single", "dual", "triple", "all"]) {
    const ids = pickIds(mode);
    if (ids.length === 0) continue;

    check(`${dest} ${days}d ${mode} ids=[${ids.join(",")}] capacity+coverage`, () => {
      const plan = planSelectedCombinationCapacity({
        tripDays: days,
        selectedCombinationIds: ids,
      });
      assert.equal(plan.minimumRepresentativePerCombination, 1);
      assert.ok(plan.availableStopCapacity >= ids.length);

      const pools = resolveSelectedCombinationPools(dest, ids, { forceRefresh: true });
      assert.equal(pools.length, ids.length);

      // One representative per combo is enough for theme coverage.
      const places = ids.map((id, i) => {
        const pool = pools.find((p) => p.combinationId === id);
        const name = pool?.all[0]?.name ?? `${dest}-combo-${id}-place`;
        return mockPlace(name, [id], i);
      });

      // Pad to dynamic minimumViable (not a fixed days×3).
      const capacity = calculateDynamicStopCapacity({
        tripDays: days,
        selectedCombinationCount: ids.length,
      });
      let pad = 0;
      while (places.length < capacity.minimumViableStops) {
        const pool = pools[pad % pools.length];
        const comboId = pool?.combinationId ?? ids[0] ?? 1;
        const candidate = pool?.all[1 + Math.floor(pad / Math.max(pools.length, 1))];
        const name = candidate?.name ?? `${dest}-pad-${pad}-${comboId}`;
        places.push(mockPlace(name, [comboId], 200 + pad));
        pad += 1;
      }

      const stamped = ensureCombinationProvenanceOnPlaces(places, dest, ids);
      for (const id of ids) {
        assert.ok(
          stamped.some((p) => combinationIdsFromPlace(p).includes(id)),
          `${dest} combo ${id} missing provenance`,
        );
      }

      const integrity = validateSelectedCombinationIntegrity({
        destination: dest,
        selectedCombinationIds: ids,
        resolvedPlaces: stamped,
        supplementAttempted: true,
        tripDays: days,
        capacityPlan: plan,
      });
      assert.equal(
        integrity.ok,
        true,
        `${dest} ${mode} integrity: ${integrity.reasons.join("|")}`,
      );
      assert.deepEqual(integrity.coverage.uncoveredIds, []);

      // Never fail for fixed-per-combo count when each has ≥1.
      assert.ok(
        !integrity.reasons.some((r) => /minPer|fixed|quota/i.test(r)),
      );

      const stops = buildMixedItineraryFromPlaces(stamped, days, "2026-08-15", dest, {
        selectedCombinationIds: ids,
      });
      assert.ok(stops.length >= Math.min(ids.length, days), `stops=${stops.length}`);
      assert.ok(
        stops.every((s) => s.googlePlaceId),
        "every scheduled stop has place id",
      );
    });
  }

  // Parse raw selection strings against destination allowlist when curated.
  for (const raw of SELECTION_RAW.triple) {
    check(`${dest} parse "${raw}"`, () => {
      const indices = parseCombinationSelectionIndices(raw, Math.max(comboCount, 4));
      assert.ok(indices.includes(0) && indices.includes(1));
      const allowlist = buildCombinationSelectionAllowlist(dest, raw);
      if (allowlist) {
        assert.ok(allowlist.selectedCombinationIds.length >= 2);
      }
    });
  }
}

// Provenance merge across destinations (shared place covering two combos)
check("dedupe keeps multi sourceCombinationIds", () => {
  const a = mockPlace("Shared Landmark", [1], 1);
  const b = mockPlace("Shared Landmark", [2], 1);
  b.googlePlaceId = a.googlePlaceId;
  const merged = mergePlaceProvenance(a, b);
  assert.deepEqual(combinationIdsFromPlace(merged).sort(), [1, 2]);
  const report = buildMultiCombinationCoverageReport({
    destination: "桃園",
    selectedCombinationIds: [1, 2],
    resolvedPlaces: [merged],
    supplementAttempted: true,
    tripDays: 3,
  });
  assert.ok(report.uncoveredIds.length === 0);
  assert.ok(
    report.combinations["1"] && report.combinations["2"],
  );
});

// Taoyuan acceptance case from product bug report
check("桃園 3d select 1、2、4 acceptance", () => {
  clearCombinationPoolMemo();
  const ids = [1, 2, 4];
  const plan = planSelectedCombinationCapacity({ tripDays: 3, selectedCombinationIds: ids });
  assert.ok(plan.availableStopCapacity >= 3);
  for (const id of ids) {
    assert.ok(plan.targetPerCombination[id] >= 1);
  }

  const merged = mergeSelectedCombinationCandidates("桃園", ids);
  assert.ok(merged.perCombinationBeforeDedup[1] > 0);
  assert.ok(merged.perCombinationBeforeDedup[2] > 0);
  assert.ok(merged.perCombinationBeforeDedup[4] > 0);

  const pools = resolveSelectedCombinationPools("桃園", ids, { forceRefresh: true });
  const places = [];
  for (const pool of pools) {
    // Only 1–2 places each — must still pass (no fixed 3/combo).
    const take = pool.all.slice(0, Math.min(2, pool.all.length));
    for (let i = 0; i < take.length; i += 1) {
      places.push(mockPlace(take[i].name, [pool.combinationId], pool.combinationId * 10 + i));
    }
  }

  const integrity = validateSelectedCombinationIntegrity({
    destination: "桃園",
    selectedCombinationIds: ids,
    resolvedPlaces: places,
    supplementAttempted: true,
    tripDays: 3,
    capacityPlan: plan,
  });
  assert.equal(integrity.ok, true, integrity.reasons.join("|"));
  assert.deepEqual(integrity.coverage.uncoveredIds, []);
  assert.notEqual(integrity.failureCode, "combination_coverage_insufficient");
});

// Must not return combination_uncovered without supplement
check("fail gate requires supplementAttempted", () => {
  const integrity = validateSelectedCombinationIntegrity({
    destination: "桃園",
    selectedCombinationIds: [1, 2],
    resolvedPlaces: [
      mockPlace("虎頭山公園", [1], 1),
    ],
    supplementAttempted: false,
    tripDays: 3,
  });
  assert.equal(integrity.ok, false);
  assert.equal(integrity.failureCode, "supplement_required");
});

console.log(`\n=== summary: passed=${passed} failed=${failed} ===`);
if (failed > 0) process.exit(1);
console.log("All global combination coverage contract checks passed.");
