#!/usr/bin/env node
import assert from "node:assert/strict";
import { resetTripPlanningContext } from "../src/lib/ai/trip-planning-session-reset.ts";
import { resolveRecommendationSearchCenter } from "../src/lib/ai/recommendation-search-scope.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

console.log("\n[verify:destination-reset-recommendation-context]\n");

test("destination reset clears recommendation continuation state", () => {
  const session = {
    planningSessionId: "plan-old",
    phase: "done",
    planVersion: 1,
    travelContext: { interests: [], destination: "東京" },
    activeCategoryIntent: "cafe",
    activeRecommendationContext: {
      destinationName: "東京",
      destinationDisplayName: "東京",
      latitude: 35.68,
      longitude: 139.76,
    },
    recommendationSession: {
      sessionId: "rec-old",
      destination: "東京",
      searchCentroid: { lat: 35.68, lng: 139.76 },
    },
    foodPreference: { cuisine: "ramen" },
  };

  const next = resetTripPlanningContext(session, {
    reason: "destination_changed",
    incomingDestination: "台東",
    userText: "我想改去台東",
  });

  assert.equal(next.activeRecommendationContext, undefined);
  assert.equal(next.recommendationSession, undefined);
  assert.equal(next.activeCategoryIntent, undefined);
  assert.equal(next.foodPreference, undefined);
});

test("search center does not reuse snapshot from old destination", () => {
  const session = {
    location: { city: "台東", lat: 22.75, lng: 121.15 },
    activeRecommendationContext: {
      destinationName: "東京",
      destinationDisplayName: "東京",
      latitude: 35.68,
      longitude: 139.76,
    },
    recommendationSession: {
      destination: "東京",
      searchCentroid: { lat: 35.68, lng: 139.76 },
    },
    travelContext: { destination: "台東", interests: [] },
  };

  const center = resolveRecommendationSearchCenter({
    userText: "還有嗎",
    session,
    context: session.travelContext,
    destinationName: "台東",
    destinationLatLng: { lat: 22.75, lng: 121.15 },
  });

  assert.ok(center);
  assert.notEqual(center?.source, "recommendation_snapshot");
  assert.notEqual(center?.destination, "東京");
});

console.log("\n[verify:destination-reset-recommendation-context] OK\n");
