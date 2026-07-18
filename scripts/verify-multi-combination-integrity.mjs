/**
 * Multi-combination parse / provenance merge / coverage integrity (generic).
 */
import assert from "node:assert/strict";
import {
  buildCombinationSelectionAllowlist,
  parseCombinationSelectionIndices,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import {
  annotatePlaceWithCombinationMetadata,
  buildMultiCombinationCoverageReport,
  mergeSelectedCombinationCandidates,
  planSelectedCombinationCapacity,
  validateSelectedCombinationIntegrity,
} from "../src/lib/ai/combination-itinerary-integrity.ts";
import {
  combinationIdsFromPlace,
  mergePlaceProvenance,
} from "../src/lib/ai/combination-provenance.ts";
import { classifyCombinationCandidate } from "../src/lib/ai/region-candidate-expand.ts";

console.log("=== multi-combination integrity ===\n");

for (const raw of ["1、2、5", "1,2,5", "1 2 5", "1・2・5", "1/2/5", "1、 2、 5"]) {
  const indices = parseCombinationSelectionIndices(raw, 5);
  assert.deepEqual(
    indices,
    [0, 1, 4],
    `parse indices "${raw}" → ${JSON.stringify(indices)}`,
  );
  console.log(`OK parse indices "${raw}" → [0,1,4]`);
}

// Taipei curated: verify multi-id allowlist still works with ideographic comma
{
  const allowlist = buildCombinationSelectionAllowlist("台北", "2、3");
  assert.deepEqual(allowlist?.selectedCombinationIds, [2, 3]);
  console.log("OK 台北 2、3 selectedCombinationIds=[2,3]");
  const merged = mergeSelectedCombinationCandidates("台北", [2, 3]);
  assert.ok(merged.perCombinationBeforeDedup[2] > 0, "combo2 pool");
  assert.ok(merged.perCombinationBeforeDedup[3] > 0, "combo3 pool");
  console.log("OK per-combination pools built");
}

// Provenance merge on dedupe
{
  const a = {
    name: "上野阿美橫商店街",
    placeName: "上野阿美橫商店街",
    googlePlaceId: "ChIJ_ameyoko",
    sourceCombinationId: 1,
    matchedSelectedCombinationIds: [1],
  };
  const b = {
    name: "阿美橫町",
    placeName: "阿美橫町",
    googlePlaceId: "ChIJ_ameyoko",
    sourceCombinationId: 2,
    matchedSelectedCombinationIds: [2],
  };
  const merged = mergePlaceProvenance(a, b, {
    representativeName: a.name,
    otherName: b.name,
  });
  assert.deepEqual(combinationIdsFromPlace(merged), [1, 2]);
  assert.deepEqual(merged.sourceCombinationIds, [1, 2]);
  assert.deepEqual(merged.matchedSelectedCombinationIds, [1, 2]);
  console.log("OK dedupe merges sourceCombinationIds [1,2]");
}

// annotate unions matches
{
  const place = annotatePlaceWithCombinationMetadata(
    {
      name: "饒河夜市",
      placeName: "饒河夜市",
      googlePlaceId: "ChIJ_raohe",
      sourceCombinationId: 3,
    },
    "台北",
    [2, 3],
  );
  assert.ok(combinationIdsFromPlace(place).includes(3));
  console.log("OK annotate keeps/extends combination ids", combinationIdsFromPlace(place));
}

// Region classification (generic — not Tokyo-hardcoded)
{
  assert.equal(
    classifyCombinationCandidate("鎌倉", "東京"),
    "city_or_region",
    "鎌倉 vs 東京 → region",
  );
  assert.equal(
    classifyCombinationCandidate("淺草寺", "東京"),
    "place",
    "淺草寺 → place",
  );
  assert.equal(
    classifyCombinationCandidate("箱根", "東京"),
    "city_or_region",
    "箱根 → region",
  );
  console.log("OK region vs place classification");
}

// Coverage: combo covered by merge / region, not fixed 3–4 quota
{
  const places = [
    {
      name: "A",
      placeName: "A",
      googlePlaceId: "ChIJ_a",
      sourceCombinationIds: [1],
      matchedSelectedCombinationIds: [1],
    },
    {
      name: "B",
      placeName: "B",
      googlePlaceId: "ChIJ_b",
      sourceCombinationIds: [1, 2],
      matchedSelectedCombinationIds: [1, 2],
    },
    {
      name: "C",
      placeName: "C",
      googlePlaceId: "ChIJ_c",
      sourceCombinationIds: [5],
      matchedSelectedCombinationIds: [5],
      sourceRegionCandidate: "鎌倉",
    },
  ];
  const report = buildMultiCombinationCoverageReport({
    destination: "台北",
    selectedCombinationIds: [1, 2, 5],
    resolvedPlaces: places,
    regionExpansion: {
      5: { regions: ["鎌倉"], expandedPlaces: 1, selectedRegion: "鎌倉" },
    },
    supplementAttempted: true,
    tripDays: 6,
  });
  assert.ok(
    report.combinations["1"]?.status === "covered" ||
      report.combinations["1"]?.status === "covered_by_merge" ||
      report.combinations["1"]?.status === "partially_covered",
  );
  assert.ok(
    report.combinations["2"]?.status === "covered" ||
      report.combinations["2"]?.status === "covered_by_merge" ||
      report.combinations["2"]?.status === "partially_covered",
  );
  assert.equal(report.combinations["5"]?.status, "covered_by_region_selection");
  console.log("OK coverage report statuses", report.combinations);

  const integrity = validateSelectedCombinationIntegrity({
    destination: "台北",
    selectedCombinationIds: [1, 2, 5],
    resolvedPlaces: places,
    regionExpansion: {
      5: { regions: ["鎌倉"], expandedPlaces: 1, selectedRegion: "鎌倉" },
    },
    supplementAttempted: true,
    tripDays: 3,
  });
  // 3 places for 3-day trip with 3 combos covered → ok
  assert.equal(integrity.ok, true, `integrity reasons=${integrity.reasons.join("|")}`);
  console.log("OK validateSelectedCombinationIntegrity passes when all covered");
}

// Uncovered combo after supplement → fail with differentiated code
{
  const integrity = validateSelectedCombinationIntegrity({
    destination: "台北",
    selectedCombinationIds: [1, 2],
    resolvedPlaces: [
      {
        name: "A",
        placeName: "A",
        googlePlaceId: "ChIJ_a",
        sourceCombinationIds: [1],
        matchedSelectedCombinationIds: [1],
      },
    ],
    supplementAttempted: true,
    tripDays: 2,
  });
  assert.equal(integrity.ok, false);
  assert.equal(integrity.failureCode, "combination_uncovered");
  console.log("OK uncovered combo → combination_uncovered");
}

// Cannot fail uncovered without supplementAttempted
{
  const integrity = validateSelectedCombinationIntegrity({
    destination: "台北",
    selectedCombinationIds: [1, 2],
    resolvedPlaces: [
      {
        name: "A",
        placeName: "A",
        googlePlaceId: "ChIJ_a",
        sourceCombinationIds: [1],
        matchedSelectedCombinationIds: [1],
      },
    ],
    supplementAttempted: false,
    tripDays: 2,
  });
  assert.equal(integrity.ok, false);
  assert.equal(integrity.failureCode, "supplement_required");
  console.log("OK uncovered without supplement → supplement_required (not hard uncovered)");
}

// Partial coverage (1 of soft target) is accepted
{
  const plan = planSelectedCombinationCapacity({
    tripDays: 3,
    selectedCombinationIds: [1, 2, 4],
  });
  assert.equal(plan.minimumRepresentativePerCombination, 1);
  assert.ok(plan.availableStopCapacity >= 3);
  const places = [
    {
      name: "桃園忠烈祠暨神社文化園區",
      placeName: "桃園忠烈祠暨神社文化園區",
      googlePlaceId: "ChIJ_c1",
      sourceCombinationIds: [1],
      matchedSelectedCombinationIds: [1],
    },
    {
      name: "大溪老街",
      placeName: "大溪老街",
      googlePlaceId: "ChIJ_c2",
      sourceCombinationIds: [2],
      matchedSelectedCombinationIds: [2],
    },
    {
      name: "石門水庫",
      placeName: "石門水庫",
      googlePlaceId: "ChIJ_c4",
      sourceCombinationIds: [4],
      matchedSelectedCombinationIds: [4],
    },
  ];
  const integrity = validateSelectedCombinationIntegrity({
    destination: "桃園",
    selectedCombinationIds: [1, 2, 4],
    resolvedPlaces: places,
    supplementAttempted: true,
    tripDays: 3,
    capacityPlan: plan,
  });
  assert.equal(
    integrity.ok,
    true,
    `桃園 1,2,4 with 1 each should pass: ${integrity.reasons.join("|")}`,
  );
  assert.ok(
    integrity.coverage.partiallyCoveredIds.length +
      integrity.coverage.coveredIds.length ===
      3,
  );
  assert.deepEqual(integrity.coverage.uncoveredIds, []);
  console.log("OK 桃園 1、2、4 with one representative each → pass");
}

console.log("\nAll multi-combination integrity checks passed.");
