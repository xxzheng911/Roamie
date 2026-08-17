#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createDestinationCategoryPlaceSearchDiagnostics,
  resolveDestinationCategoryPlaceSearchFailureStage,
} from "../src/lib/ai/destination-category-place-search-telemetry.ts";
import {
  filterChatCategoryPlaces,
  isSubPlaceOfDestination,
  resolveChatCategoryBaseEligibilityRejection,
} from "../src/lib/ai/chat-destination-place-filter.ts";
import { isCafePlace } from "../src/lib/ai/chat-category-place-guard.ts";

function fixture(overrides) {
  return Object.assign(
    createDestinationCategoryPlaceSearchDiagnostics("台南", "cafe"),
    {
      includedTypes: new Set(["cafe", "coffee_shop"]),
      attemptCount: 1,
      requestsSent: 1,
      rawCount: 3,
      afterDestinationFilterCount: 3,
      afterExclusionCount: 3,
      afterCanonicalIdCount: 3,
      afterBaseEligibilityCount: 3,
      afterCategoryGuardCount: 3,
      afterQualityCount: 3,
      afterMealFilterCount: 3,
      afterMappedRecommendationCount: 3,
      renderableCount: 3,
      finalRecommendationCount: 3,
    },
    overrides,
  );
}

assert.equal(resolveDestinationCategoryPlaceSearchFailureStage(fixture({})), "success");
assert.equal(
  resolveDestinationCategoryPlaceSearchFailureStage(
    fixture({
      requestsSent: 0,
      rateLimitedBeforeRequest: true,
      rawCount: 0,
      renderableCount: 0,
      finalRecommendationCount: 0,
    }),
  ),
  "rate_limited_before_request",
);
assert.equal(
  resolveDestinationCategoryPlaceSearchFailureStage(
    fixture({
      requestsSent: 1,
      rateLimitedBeforeRequest: true,
      rawCount: 0,
      finalRecommendationCount: 0,
      renderableCount: 0,
    }),
  ),
  "rate_limited_before_request",
);
assert.equal(
  resolveDestinationCategoryPlaceSearchFailureStage(fixture({ rawCount: 0 })),
  "provider_empty",
);
assert.equal(
  resolveDestinationCategoryPlaceSearchFailureStage(
    fixture({ afterDestinationFilterCount: 0 }),
  ),
  "destination_filter_empty",
);
assert.equal(
  resolveDestinationCategoryPlaceSearchFailureStage(
    fixture({ afterExclusionCount: 0 }),
  ),
  "exclusion_empty",
);
assert.equal(
  resolveDestinationCategoryPlaceSearchFailureStage(
    fixture({ afterCanonicalIdCount: 0 }),
  ),
  "missing_canonical_id",
);
assert.equal(
  resolveDestinationCategoryPlaceSearchFailureStage(
    fixture({ afterBaseEligibilityCount: 0, afterCategoryGuardCount: 0 }),
  ),
  "base_eligibility_empty",
);
assert.equal(
  resolveDestinationCategoryPlaceSearchFailureStage(
    fixture({ afterCategoryGuardCount: 0 }),
  ),
  "category_guard_empty",
);
assert.equal(
  resolveDestinationCategoryPlaceSearchFailureStage(
    fixture({ afterQualityCount: 0, afterMealFilterCount: 0 }),
  ),
  "quality_filter_empty",
);
assert.equal(
  resolveDestinationCategoryPlaceSearchFailureStage(
    fixture({ afterMealFilterCount: 0, renderableCount: 0, finalRecommendationCount: 0 }),
  ),
  "meal_filter_empty",
);
assert.equal(
  resolveDestinationCategoryPlaceSearchFailureStage(
    fixture({
      afterMappedRecommendationCount: 0,
      renderableCount: 0,
      finalRecommendationCount: 0,
    }),
  ),
  "render_guard_empty",
);
assert.equal(
  resolveDestinationCategoryPlaceSearchFailureStage(
    fixture({ renderableCount: 0, finalRecommendationCount: 0 }),
  ),
  "render_guard_empty",
);

function place(overrides = {}) {
  return {
    id: "place-default",
    name: "Example Cafe",
    address: "",
    lat: 22.99,
    lng: 120.2,
    rating: 4.5,
    userRatingCount: 100,
    photoName: null,
    primaryType: "cafe",
    types: ["cafe", "coffee_shop", "food", "establishment"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    ...overrides,
  };
}

const cityProfile = { kind: "city", label: "台南", nearestCity: "台南" };
const tainanCafe = place({ id: "tainan-cafe", name: "台南-秘氏咖啡" });
assert.equal(isSubPlaceOfDestination(tainanCafe, "台南", cityProfile), false);
assert.equal(
  resolveChatCategoryBaseEligibilityRejection(tainanCafe, {
    destination: "台南",
    profile: cityProfile,
    requireOpenNow: false,
  }),
  null,
);
assert.equal(
  filterChatCategoryPlaces([tainanCafe], {
    intent: "cafe",
    destination: "台南",
    profile: cityProfile,
  }).length,
  1,
);

const englishCityCafe = place({
  id: "tainan-coffee-roasters",
  name: "Tainan Coffee Roasters",
  primaryType: "coffee_shop",
  types: ["coffee_shop", "cafe"],
});
assert.equal(
  isSubPlaceOfDestination(
    englishCityCafe,
    "Tainan City",
    { kind: "city", label: "Tainan City", nearestCity: "Tainan City" },
  ),
  false,
);

const landmarkCafe = place({
  id: "landmark-cafe",
  name: "大型地標內部咖啡館",
});
assert.equal(
  isSubPlaceOfDestination(
    landmarkCafe,
    "大型地標",
    { kind: "landmark", label: "大型地標", parentLandmark: "大型地標" },
  ),
  true,
);

assert.equal(
  isCafePlace(place({ name: "秘氏", primaryType: "cafe", types: ["cafe"] })),
  true,
);
assert.equal(
  isCafePlace(
    place({
      name: "咖啡風格服飾店",
      primaryType: "clothing_store",
      types: ["clothing_store", "store"],
    }),
  ),
  false,
);

const boundaryCandidates = [
  place({ id: "missing-name", name: "" }),
  place({ id: "school", name: "台南大學", primaryType: "university", types: ["university"] }),
  place({ id: "not-cafe", name: "普通服飾店", primaryType: "clothing_store", types: ["clothing_store"] }),
  place({ id: "cafe-1", name: "秘氏", primaryType: "cafe", types: ["cafe"] }),
  place({ id: "cafe-2", name: "Coffee Lab", primaryType: "coffee_shop", types: ["coffee_shop"] }),
];
let boundaryDiagnostics;
const boundaryResult = filterChatCategoryPlaces(boundaryCandidates, {
  intent: "cafe",
  destination: "台南",
  profile: cityProfile,
  onDiagnostics: (counts) => {
    boundaryDiagnostics = counts;
  },
});
assert.equal(boundaryDiagnostics.afterCanonicalIdCount, 5);
assert.equal(boundaryDiagnostics.afterBaseEligibilityCount, 3);
assert.equal(boundaryDiagnostics.afterCategoryGuardCount, 2);
assert.equal(boundaryDiagnostics.baseEligibilityRejections.missing_identity, 1);
assert.equal(boundaryDiagnostics.baseEligibilityRejections.school_or_office, 1);
assert.equal(boundaryResult.length, 2);

console.log("verify-destination-category-place-search-telemetry: ok");
