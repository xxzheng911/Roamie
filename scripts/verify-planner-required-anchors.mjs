/**
 * Smoke checks for AI Planner P0: required anchors, parent collapse, integrity.
 */
import assert from "node:assert/strict";
import {
  buildRequiredAnchorPlaces,
  buildSelectedPlaceLock,
  recommendationIntegrityCheck,
  plannerDeliveryCheck,
  resolvePlannerPaceFromProfile,
  suggestStayDurationForPace,
  isPlaceLocked,
} from "../src/lib/ai/required-anchor-runtime.ts";
import {
  collapseParentLandmarkCandidates,
  resolveParentLandmarkKey,
} from "../src/lib/ai/ai-parent-landmark-dedup.ts";

// 1) Required anchors cover every selected place
{
  const names = ["觀稼樓", "津渡橋", "方鑑齋"];
  const anchors = buildRequiredAnchorPlaces({ selectedPlaceNames: names });
  assert.equal(anchors.length, 3);
  const lock = buildSelectedPlaceLock({ anchors });
  assert.ok(isPlaceLocked({ name: "津渡橋" }, lock));
  const missing = recommendationIntegrityCheck({
    selectedPlaces: names,
    anchors,
    scheduledPlaceNames: ["津渡橋"],
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.coveragePercent < 100, true);
  assert.ok(missing.missingPlaces.includes("觀稼樓"));

  const full = recommendationIntegrityCheck({
    selectedPlaces: names,
    anchors,
    scheduledPlaceNames: names,
  });
  assert.equal(full.ok, true);
  assert.equal(full.coveragePercent, 100);

  const delivery = plannerDeliveryCheck({ integrity: full, validatorOk: true });
  assert.equal(delivery.ok, true);
  assert.equal(delivery.deliveryResult, "deliver");
}

// 2) Parent complex key recognizes gardens / palaces globally
{
  assert.ok(resolveParentLandmarkKey("林本源園邸"));
  assert.ok(resolveParentLandmarkKey("京都御苑"));
  assert.ok(resolveParentLandmarkKey("大阪城公園") || resolveParentLandmarkKey("大阪城"));
}

// 3) Parent collapse: parent + children → keep parent
{
  const { kept, dropped } = collapseParentLandmarkCandidates([
    { name: "林本源園邸", lat: 25.002, lng: 121.455, rating: 4.5, userRatingCount: 8000 },
    { name: "觀稼樓", lat: 25.0021, lng: 121.4551, rating: 4.2, userRatingCount: 200 },
    { name: "津渡橋", lat: 25.0022, lng: 121.4552, rating: 4.0, userRatingCount: 100 },
  ]);
  assert.ok(kept.some((k) => k.name.includes("林本源")));
  assert.ok(dropped.length >= 1);
}

// 4) Child-only cluster collapses to one representative
{
  const { kept } = collapseParentLandmarkCandidates([
    { name: "觀稼樓", rating: 4.2, userRatingCount: 200 },
    { name: "津渡橋", rating: 4.0, userRatingCount: 100 },
    { name: "方鑑齋", rating: 4.1, userRatingCount: 150 },
  ]);
  assert.equal(kept.length, 1);
}

// 5) Plus quiz pace wiring helpers
{
  assert.equal(resolvePlannerPaceFromProfile({ style: "mixed", quizPace: "slow" }), "slow");
  assert.equal(resolvePlannerPaceFromProfile({ style: "slow_nature" }), "slow");
  assert.equal(suggestStayDurationForPace("slow"), "2-3 小時");
  assert.equal(suggestStayDurationForPace("active"), "45-90 分鐘");
}

console.log("verify-planner-required-anchors: ok");
