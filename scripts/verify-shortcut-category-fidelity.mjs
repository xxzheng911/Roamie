import assert from "node:assert/strict";
import { applyQuickChipContext } from "../src/lib/ai/chat-intent.ts";
import {
  isPlaceEligibleForShortcutScene,
  RELAX_WALK_INCLUDED_TYPES,
} from "../src/lib/ai/shortcut-category-fidelity.ts";
import { recommendationToPlaceSnapshot } from "../src/lib/recommendation-place-handoff.ts";
import {
  resolveShortcutRecommendationFailureStage,
} from "../src/lib/ai/shortcut-recommendation-telemetry.ts";

const session = { phase: "INITIAL", selectedPlaces: [], recommendedPlaces: [] };

const quiet = applyQuickChipContext("想找安靜的咖啡廳", session);
assert.deepEqual(quiet.shortcutContext, {
  shortcutId: "quiet_cafe",
  shortcutLabel: "想找安靜的咖啡廳",
  categoryIntent: "cafe",
  mood: "quiet",
  scene: "quiet_cafe",
});
assert.equal(
  isPlaceEligibleForShortcutScene({ primaryType: "cafe", types: ["cafe"] }, "quiet_cafe"),
  true,
);
assert.equal(
  isPlaceEligibleForShortcutScene({ primaryType: "museum", name: "佛光緣美術館" }, "quiet_cafe"),
  false,
);
assert.equal(
  isPlaceEligibleForShortcutScene({ primaryType: "tourist_attraction", name: "光雕橋" }, "quiet_cafe"),
  false,
);
assert.equal(
  isPlaceEligibleForShortcutScene({ primaryType: "park", name: "凹子底森林公園" }, "quiet_cafe"),
  false,
);

const relax = applyQuickChipContext("今天想放鬆走走", session);
assert.equal(relax.shortcutContext?.scene, "relax_walk");
assert.deepEqual([...RELAX_WALK_INCLUDED_TYPES], [
  "park",
  "garden",
  "museum",
  "art_gallery",
]);
for (const primaryType of ["shopping_mall", "cafe", "restaurant"]) {
  assert.equal(
    isPlaceEligibleForShortcutScene({ primaryType, types: [primaryType] }, "relax_walk"),
    false,
    `${primaryType} must be rejected for relax_walk`,
  );
}
for (const primaryType of ["park", "museum", "art_gallery"]) {
  assert.equal(
    isPlaceEligibleForShortcutScene({ primaryType, types: [primaryType] }, "relax_walk"),
    true,
    `${primaryType} may remain eligible for relax_walk`,
  );
}
assert.equal(
  isPlaceEligibleForShortcutScene({ primaryType: "shopping_mall" }, "rainy_indoor"),
  true,
  "rainy policy is unchanged",
);

const recommendation = {
  name: "Canonical museum",
  type: "景點",
  primaryType: "museum",
  types: ["museum", "tourist_attraction", "establishment"],
  description: "",
  reason: "符合這次想找的文化景點。",
  estimatedTime: "",
  address: "Test address",
  lat: 22.9,
  lng: 120.2,
  googleMapsUrl: "",
  placeName: "Canonical museum",
  reasonSource: "template",
  googlePlaceId: "place-1",
};
const snapshot = recommendationToPlaceSnapshot(recommendation);
assert.equal(snapshot.primaryType, "museum");
assert.deepEqual(snapshot.types, recommendation.types);
assert.notEqual(snapshot.displayCategory, recommendation.type, "display category is canonical");

const telemetryBase = {
  shortcut: quiet.shortcutContext,
  searchScope: "nearby",
  includedTypes: ["cafe", "coffee_shop", "bakery"],
  excludedTypes: [],
  attemptCount: 1,
  requestsSent: 1,
  rawCount: 3,
  afterDestinationOrNearbyScopeCount: 3,
  afterExclusionCount: 3,
  afterCanonicalIdCount: 3,
  afterCategoryGuardCount: 3,
  afterQualityCount: 3,
  afterAlreadyRecommendedCount: 0,
  renderableCount: 0,
  finalCardCount: 0,
};
assert.equal(
  resolveShortcutRecommendationFailureStage(telemetryBase),
  "already_recommended_empty",
);
assert.equal(
  resolveShortcutRecommendationFailureStage({
    ...telemetryBase,
    afterAlreadyRecommendedCount: 3,
    renderableCount: 3,
    finalCardCount: 3,
  }),
  "success",
);

console.info("[verify:shortcut-category-fidelity] all passed");
