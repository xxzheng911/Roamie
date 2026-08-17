#!/usr/bin/env node
/**
 * Explicit destination fallback isolation.
 * Builder final=0 for 新北蘆洲 must never surface 南投埔里 / GPS / old session cards.
 */
import assert from "node:assert/strict";
import { restorePlaceIntentAfterGeographicClarification } from "../src/lib/ai/destination-geographic-clarification.ts";
import {
  destinationsShareRecommendationScope,
  evaluateDestinationRecommendationFallback,
  filterRecommendationsForExplicitDestinationScope,
  isolateSessionToExplicitDestination,
  resolveExplicitDestinationFallbackScope,
  shouldBlockCrossScopeRecommendationFallback,
} from "../src/lib/ai/destination-recommendation-fallback-scope.ts";
import { resolveDestinationAreaScope } from "../src/lib/ai/destination-travel-profile.ts";

const LUZHOU_SCOPE = {
  destination: "新北蘆洲",
  parentCity: "新北",
  area: "蘆洲",
  searchScope: "area",
};

const puliCard = {
  name: "台灣第一家鹽酥雞",
  placeName: "台灣第一家鹽酥雞",
  type: "restaurant",
  primaryType: "restaurant",
  types: ["restaurant", "food"],
  description: "",
  reason: "",
  estimatedTime: "",
  address: "南投縣埔里鎮中山路一段",
  lat: 23.96,
  lng: 120.96,
  googleMapsUrl: "",
  reasonSource: "template",
  googlePlaceId: "ChIJ-puli-salt-chicken",
};

const luzhouCard = {
  name: "蘆洲麵店",
  placeName: "蘆洲麵店",
  type: "chinese_restaurant",
  primaryType: "chinese_restaurant",
  types: ["chinese_restaurant", "restaurant"],
  description: "",
  reason: "",
  estimatedTime: "",
  address: "新北市蘆洲區中正路",
  lat: 25.08,
  lng: 121.47,
  googleMapsUrl: "",
  reasonSource: "template",
  googlePlaceId: "ChIJ-luzhou-noodle",
};

function puliSession(overrides = {}) {
  return {
    recommendedPlaces: [puliCard],
    selectedPlaces: [],
    phase: "recommend",
    discovery: {},
    updatedAt: new Date().toISOString(),
    activeCategoryIntent: "restaurant",
    activeChatIntent: "restaurant",
    recommendationSession: {
      sessionId: "rec_puli",
      destination: "南投埔里",
      topic: "restaurant",
      returnedPlaceIds: ["ChIJ-puli-salt-chicken"],
      pool: [puliCard],
      cursor: 1,
      searchCentroid: { lat: 23.965, lng: 120.968 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    activeRecommendationContext: {
      destinationName: "南投埔里",
      destinationDisplayName: "南投縣埔里鎮",
      resolvedSearchCity: "埔里",
      latitude: 23.965,
      longitude: 120.968,
      intent: "restaurant",
      previousPlaceIds: ["ChIJ-puli-salt-chicken"],
      previousCanonicalKeys: [],
      currentResultPlaceIds: ["ChIJ-puli-salt-chicken"],
      usedQueries: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    travelContext: {
      destination: "南投埔里",
      interests: [],
    },
    tripPlanningContext: { destination: "南投埔里" },
    pendingClarification: {
      kind: "destination_area",
      rawGeographicLabel: "蘆洲",
      parentIntent: "place_recommendation",
      categoryIntent: "restaurant",
      originatingRoute: "destination_category",
      originalUserText: "蘆洲有什麼餐廳推薦嗎",
    },
    ...overrides,
  };
}

{
  const luzhou = resolveDestinationAreaScope("新北蘆洲有什麼餐廳推薦嗎");
  assert.ok(luzhou, "新北蘆洲 must resolve as an area scope");
  assert.equal(luzhou.parentCity, "新北");
  assert.equal(luzhou.area, "蘆洲");
  console.log("  ✓ 新北蘆洲 area scope");
}

{
  assert.equal(
    destinationsShareRecommendationScope("新北蘆洲", "南投埔里"),
    false,
  );
  assert.equal(destinationsShareRecommendationScope("新北蘆洲", "台北"), false);
  assert.equal(destinationsShareRecommendationScope("新北蘆洲", "新北蘆洲"), true);
  console.log("  ✓ destination scope comparison");
}

{
  const restored = restorePlaceIntentAfterGeographicClarification(
    puliSession().pendingClarification,
    "新北",
  );
  assert.ok(restored);
  assert.equal(restored.destinationLabel, "新北蘆洲");
  assert.equal(restored.parentCity, "新北");
  assert.equal(restored.area, "蘆洲");
  const scope = resolveExplicitDestinationFallbackScope({
    userText: restored.restoredUserText,
    session: puliSession(),
    restored,
  });
  assert.ok(scope);
  assert.equal(scope.destination, "新北蘆洲");
  assert.equal(scope.searchScope, "area");
  console.log("  ✓ clarification restore yields 新北蘆洲 explicit scope");
}

{
  const session = puliSession();
  const isolated = isolateSessionToExplicitDestination(session, LUZHOU_SCOPE);
  assert.equal(isolated.travelContext.destination, "新北蘆洲");
  assert.equal(isolated.recommendationSession, undefined);
  assert.equal(isolated.activeRecommendationContext, undefined);
  assert.equal(isolated.recommendedPlaces.length, 0);
  console.log("  ✓ isolating to 新北蘆洲 drops 埔里 session/pool/cards");
}

{
  const decision = evaluateDestinationRecommendationFallback({
    explicit: LUZHOU_SCOPE,
    sourcePath: "local-recommendation-fallback",
    fallbackDestination: "南投埔里",
    candidatePlaceId: puliCard.googlePlaceId,
    candidateName: puliCard.name,
    candidateAddress: puliCard.address,
  });
  assert.equal(decision.accepted, false);
  assert.equal(decision.reason, "cross_scope_destination");
  console.log("  ✓ Puli local-recommendation-fallback rejected");
}

{
  assert.equal(
    shouldBlockCrossScopeRecommendationFallback({
      explicit: LUZHOU_SCOPE,
      sourcePath: "old_recommendation_session",
      fallbackDestination: "南投埔里",
    }),
    true,
  );
  assert.equal(
    shouldBlockCrossScopeRecommendationFallback({
      explicit: LUZHOU_SCOPE,
      sourcePath: "current-location-nearby",
      fallbackDestination: "新北蘆洲",
    }),
    true,
  );
  assert.equal(
    shouldBlockCrossScopeRecommendationFallback({
      explicit: LUZHOU_SCOPE,
      sourcePath: "generic-chat-fallback",
      fallbackDestination: "台北",
    }),
    true,
  );
  assert.equal(
    shouldBlockCrossScopeRecommendationFallback({
      explicit: LUZHOU_SCOPE,
      sourcePath: "local-recommendation-fallback",
      fallbackDestination: "新北蘆洲",
    }),
    false,
  );
  console.log("  ✓ GPS / old session / Taipei blocked; same-scope Luzhou allowed");
}

{
  const filtered = filterRecommendationsForExplicitDestinationScope(
    [puliCard, luzhouCard],
    LUZHOU_SCOPE,
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].googlePlaceId, luzhouCard.googlePlaceId);
  console.log("  ✓ Puli card filtered out of Luzhou explicit destination pool");
}

{
  const builderFinalZero = [];
  const fallbackFromOldSession = filterRecommendationsForExplicitDestinationScope(
    [puliCard],
    LUZHOU_SCOPE,
  );
  assert.equal(builderFinalZero.length, 0);
  assert.equal(fallbackFromOldSession.length, 0);
  console.log("  ✓ builder final=0 + old Puli session → no Puli card");
}

console.info("verify-explicit-destination-fallback-isolation: ok");
