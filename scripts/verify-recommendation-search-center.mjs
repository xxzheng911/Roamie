#!/usr/bin/env node
/**
 * Offline acceptance: Recommendation Search Center + continue scope
 * (destination vs GPS, category inheritance, isNearbyPlaceIntent defined).
 * No Places API calls.
 */
import assert from "node:assert/strict";
import {
  isExplicitDeviceNearbyRequest,
  resolveRecommendationSearchCenter,
  resolveRecommendationSearchScope,
  assertDestinationRequestNotUsingGps,
  restoreContinueRecommendationCategory,
} from "../src/lib/ai/recommendation-search-scope.ts";
import { resolveNearbySearchCenter } from "../src/lib/ai/chat-nearby-search.ts";
import { resolveRefreshNearbyIntent } from "../src/lib/ai/chat-recommendation-refresh.ts";
import { isNearbyPlaceIntent } from "../src/lib/ai/chat-intent.ts";
import { shouldFetchNearbyPlaces } from "../src/lib/ai/chat-dining-flow.ts";
import { resolveChatIntentArbitration } from "../src/lib/ai/recommendation-refinement/arbitrate.ts";
import { resolveDestinationApproxCenter } from "../src/lib/ai/destination-geocode.ts";
import { ensureActiveRecommendationContext } from "../src/lib/ai/recommendation-refinement/session.ts";

const KAOHSIUNG = { lat: 22.6399, lng: 120.2935 };
const HOKKAIDO = resolveDestinationApproxCenter("北海道") ?? {
  lat: 43.0618,
  lng: 141.3545,
};

function shoppingSession(overrides = {}) {
  return {
    recommendedPlaces: [
      { name: "大通公園店", placeId: "p1", googlePlaceId: "gp1" },
      { name: "狸小路", placeId: "p2", googlePlaceId: "gp2" },
    ],
    selectedPlaces: [],
    phase: "recommend",
    discovery: {},
    updatedAt: new Date().toISOString(),
    conversationMode: "destination_planning",
    location: { city: "高雄", ...KAOHSIUNG },
    activeCategoryIntent: "shopping",
    activeChatIntent: undefined,
    recommendationSession: {
      sessionId: "rec_test",
      destination: "北海道",
      topic: "shopping",
      returnedPlaceIds: ["gp1", "gp2"],
      pool: [],
      cursor: 2,
      searchCentroid: { lat: HOKKAIDO.lat, lng: HOKKAIDO.lng },
      activeSearchCity: "札幌",
      searchRegionLabel: "北海道",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    activeRecommendationContext: {
      destinationName: "北海道",
      destinationDisplayName: "北海道",
      countryCode: "日本",
      resolvedSearchCity: "札幌",
      latitude: HOKKAIDO.lat,
      longitude: HOKKAIDO.lng,
      intent: "shopping",
      previousPlaceIds: ["gp1", "gp2"],
      previousCanonicalKeys: [],
      currentResultPlaceIds: ["gp1", "gp2"],
      usedQueries: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    travelContext: {
      destination: "北海道",
      destinationCountry: "日本",
      days: 6,
      interests: ["自然"],
      tripPurpose: "recommend_places",
    },
    tripPlanningContext: {
      destination: "北海道",
      days: 6,
    },
    tripDays: 6,
    pendingQuestion: {
      type: "combination_choice",
      options: ["1", "2", "3", "4"],
      baseDestination: "北海道",
      destinationCountry: "日本",
    },
    ...overrides,
  };
}

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(e);
  }
}

console.log("=== recommendation search center (cases 1–5) ===\n");

// Case 1: 北海道 shopping continue — destination anchor, not Kaohsiung GPS
check("Case 1: 有其他的嗎 → MORE_RECOMMENDATIONS shopping @ 北海道", () => {
  const session = shoppingSession();
  const text = "有其他的嗎";
  const arbitration = resolveChatIntentArbitration(text, session);
  assert.equal(arbitration.route, "MORE_RECOMMENDATIONS");

  const center = resolveRecommendationSearchCenter({
    userText: text,
    session,
    context: session.travelContext,
    destinationLatLng: HOKKAIDO,
    destinationName: "北海道",
    deviceLatLng: KAOHSIUNG,
  });
  assert.ok(center);
  assert.equal(center.mode, "destination");
  assert.equal(center.destination, "北海道");
  assert.equal(center.deviceLocationUsed, false);
  assert.ok(Math.abs(center.latitude - HOKKAIDO.lat) < 0.5);
  assert.ok(Math.abs(center.longitude - HOKKAIDO.lng) < 0.5);
  assert.ok(Math.abs(center.latitude - KAOHSIUNG.lat) > 1);

  assert.equal(shouldFetchNearbyPlaces("attraction", session, text), false);

  const nearbyOverride = resolveNearbySearchCenter(session, text, {
    searchMode: "destination",
    destinationLatLng: HOKKAIDO,
    destinationName: "北海道",
  });
  assert.ok(nearbyOverride);
  assert.equal(nearbyOverride.mode, "basePlace");
  assert.ok(Math.abs(nearbyOverride.lat - KAOHSIUNG.lat) > 1);

  const guard = assertDestinationRequestNotUsingGps({
    searchMode: "destination",
    center: { latitude: center.latitude, longitude: center.longitude },
    centerSource: "recommendation_snapshot",
    destination: "北海道",
    category: "shopping",
    radiusMeters: 1500,
  });
  assert.equal(guard.ok, true);

  const gpsMix = assertDestinationRequestNotUsingGps({
    searchMode: "destination",
    center: { latitude: KAOHSIUNG.lat, longitude: KAOHSIUNG.lng },
    centerSource: "gps",
    destination: "北海道",
    category: "shopping",
    radiusMeters: 1500,
  });
  assert.equal(gpsMix.ok, false);
  assert.equal(gpsMix.reason, "destination_request_using_gps");
});

// Case 2: cafe continue inherits cafe
check("Case 2: 還有其他咖啡廳嗎 → cafe + 北海道", () => {
  const session = shoppingSession({
    activeCategoryIntent: "cafe",
    recommendationSession: {
      ...shoppingSession().recommendationSession,
      topic: "cafe",
    },
    activeRecommendationContext: {
      ...shoppingSession().activeRecommendationContext,
      intent: "cafe",
    },
  });
  const text = "還有其他咖啡廳嗎";
  const center = resolveRecommendationSearchCenter({
    userText: text,
    session,
    context: session.travelContext,
    destinationName: "北海道",
    destinationLatLng: HOKKAIDO,
    deviceLatLng: KAOHSIUNG,
  });
  assert.equal(center?.mode, "destination");
  assert.equal(center?.deviceLocationUsed, false);
  const refreshIntent = resolveRefreshNearbyIntent(session, session.travelContext);
  assert.equal(refreshIntent, "cafe");
});

// Case 3: explicit current location → GPS allowed
check("Case 3: 那我現在附近有嗎 → current_location + GPS", () => {
  const session = shoppingSession();
  const text = "那我現在附近有嗎";
  assert.equal(isExplicitDeviceNearbyRequest(text), true);
  const center = resolveRecommendationSearchCenter({
    userText: text,
    session,
    context: session.travelContext,
    destinationName: "北海道",
    destinationLatLng: HOKKAIDO,
    deviceLatLng: KAOHSIUNG,
  });
  assert.ok(center);
  assert.equal(center.mode, "current_location");
  assert.equal(center.deviceLocationUsed, true);
  assert.ok(Math.abs(center.latitude - KAOHSIUNG.lat) < 0.01);
});

// Case 4: explicit Osaka switch
check("Case 4: 有大阪的嗎 → destination 大阪", () => {
  const session = shoppingSession();
  const text = "大阪有逛街點推薦嗎";
  const scope = resolveRecommendationSearchScope({
    userText: text,
    session,
    context: session.travelContext,
  });
  assert.equal(scope?.source, "explicit_user_destination");
  assert.equal(scope?.destinationName, "大阪");

  const osakaApprox = resolveDestinationApproxCenter("大阪");
  assert.ok(osakaApprox);
  const center = resolveRecommendationSearchCenter({
    userText: text,
    session,
    context: session.travelContext,
    destinationName: "大阪",
    destinationLatLng: osakaApprox,
    deviceLatLng: KAOHSIUNG,
  });
  assert.equal(center?.mode, "destination");
  assert.equal(center?.destination, "大阪");
  assert.equal(center?.deviceLocationUsed, false);
  assert.ok(Math.abs((center?.latitude ?? 0) - KAOHSIUNG.lat) > 1);
});

check("Case 4b: explicit destination replaces stale context and centroid", () => {
  const previous = shoppingSession({
    activeCategoryIntent: "cafe",
    recommendationSession: {
      ...shoppingSession().recommendationSession,
      destination: "台南安平",
      topic: "cafe",
      pool: [{ name: "安平咖啡", googlePlaceId: "anping_1" }],
      cursor: 1,
      exhausted: true,
      searchCentroid: { lat: 22.9997, lng: 120.1608 },
    },
    activeRecommendationContext: {
      ...shoppingSession().activeRecommendationContext,
      destinationName: "台南安平",
      destinationDisplayName: "台南安平",
      resolvedSearchCity: "台南",
      latitude: 22.9997,
      longitude: 120.1608,
      intent: "cafe",
      exhausted: true,
    },
  });
  const scope = resolveRecommendationSearchScope({
    userText: "高雄鹽埕有什麼咖啡廳推薦",
    session: previous,
    context: previous.travelContext,
  });
  assert.equal(scope?.source, "explicit_user_destination");
  assert.equal(scope?.destinationName, "高雄鹽埕");
  assert.equal(scope?.resolvedSearchCity, "高雄");
  assert.equal(scope?.destinationArea, "鹽埕");
  assert.notEqual(scope?.latitude, previous.activeRecommendationContext.latitude);
  assert.notEqual(scope?.longitude, previous.activeRecommendationContext.longitude);

  const next = ensureActiveRecommendationContext(previous, {
    destination: "高雄鹽埕",
    intent: "cafe",
    places: [{ name: "鹽埕咖啡", googlePlaceId: "yancheng_1" }],
    resolvedSearchCity: "高雄",
    latitude: scope?.latitude,
    longitude: scope?.longitude,
  });
  assert.equal(next.destinationName, "高雄鹽埕");
  assert.equal(next.resolvedSearchCity, "高雄");
  assert.deepEqual(next.previousPlaceIds, ["yancheng_1"]);
  assert.notEqual(next.exhausted, true);
});

check("Case 4c: same-city area replacement does not retain the old area", () => {
  const previous = shoppingSession({
    activeCategoryIntent: "cafe",
    activeRecommendationContext: {
      ...shoppingSession().activeRecommendationContext,
      destinationName: "台南安平",
      destinationDisplayName: "台南安平",
      resolvedSearchCity: "台南",
      latitude: 22.9997,
      longitude: 120.1608,
      intent: "cafe",
      exhausted: true,
    },
  });
  const scope = resolveRecommendationSearchScope({
    userText: "台南中西區有什麼咖啡廳推薦",
    session: previous,
    context: previous.travelContext,
  });
  assert.equal(scope?.destinationName, "台南中西區");
  assert.equal(scope?.resolvedSearchCity, "台南");
  assert.equal(scope?.destinationArea, "中西區");
  assert.notEqual(scope?.latitude, previous.activeRecommendationContext.latitude);
});

check("Case 4d: continuation keeps the existing recommendation scope", () => {
  const session = shoppingSession();
  const scope = resolveRecommendationSearchScope({
    userText: "還有嗎",
    session,
    context: session.travelContext,
  });
  assert.equal(scope?.source, "conversation_trip_destination");
  assert.equal(scope?.destinationName, "北海道");
  assert.equal(scope?.latitude, HOKKAIDO.lat);
  assert.equal(scope?.longitude, HOKKAIDO.lng);
});

check("Case 4e: cross-country area replacement rebuilds scope", () => {
  const previous = shoppingSession({
    activeCategoryIntent: "cafe",
    activeRecommendationContext: {
      ...shoppingSession().activeRecommendationContext,
      destinationName: "台南安平",
      destinationDisplayName: "台南安平",
      resolvedSearchCity: "台南",
      latitude: 22.9997,
      longitude: 120.1608,
      intent: "cafe",
    },
  });
  const scope = resolveRecommendationSearchScope({
    userText: "東京上野有什麼咖啳推薦",
    session: previous,
    context: previous.travelContext,
  });
  assert.equal(scope?.destinationName, "東京上野");
  assert.equal(scope?.resolvedSearchCity, "東京");
  assert.equal(scope?.destinationArea, "上野");
  assert.notEqual(scope?.latitude, previous.activeRecommendationContext.latitude);
  assert.notEqual(scope?.longitude, previous.activeRecommendationContext.longitude);
});

// Case 5: isNearbyPlaceIntent is defined (no ReferenceError) + scope runtime
check("Case 5: isNearbyPlaceIntent defined; shopping refresh ≠ attraction GPS", () => {
  assert.equal(typeof isNearbyPlaceIntent, "function");
  assert.equal(isNearbyPlaceIntent("cafe"), true);
  assert.equal(isNearbyPlaceIntent("attraction"), true);
  assert.equal(isNearbyPlaceIntent("destination_advice"), false);

  const session = shoppingSession();
  const refresh = resolveRefreshNearbyIntent(session, session.travelContext);
  // shopping stays off nearby GPS path
  assert.equal(refresh, null);

  const restored = restoreContinueRecommendationCategory({
    resolvedRoute: "MORE_RECOMMENDATIONS",
    requestCategory: "attraction",
    snapshotCategory: "shopping",
  });
  assert.equal(restored, "shopping");
});

check("Case 6: Tokyo Shibuya cafe must not inherit Shinjuku shopping centroid", () => {
  const next = ensureActiveRecommendationContext(
    {
      recommendedPlaces: [],
      selectedPlaces: [],
      phase: "recommend",
    },
    {
      destination: "東京澀谷",
      intent: "cafe",
      parentCity: "東京",
      area: "澀谷",
      searchScope: "area",
      latitude: 35.6581,
      longitude: 139.7016,
    },
  );
  assert.ok(Math.abs(next.latitude - 35.6581) < 0.001);
  assert.ok(Math.abs(next.longitude - 139.7016) < 0.001);
  assert.ok(Math.abs(next.latitude - 35.6896) > 0.02, "must not snap to Shinjuku cluster");

  const missing = ensureActiveRecommendationContext(
    {
      recommendedPlaces: [],
      selectedPlaces: [],
      phase: "recommend",
    },
    {
      destination: "東京澀谷",
      intent: "cafe",
      parentCity: "東京",
      area: "澀谷",
      searchScope: "area",
    },
  );
  assert.equal(missing.latitude, undefined);
  assert.equal(missing.longitude, undefined);
});

check("Case 7: 台中東區 explicit district stays area-scoped", () => {
  const scope = resolveRecommendationSearchScope({
    userText: "台中東區有什麼咖啡廳推薦嗎",
    session: {
      recommendedPlaces: [],
      selectedPlaces: [],
      phase: "discover",
      discovery: {},
      updatedAt: new Date().toISOString(),
    },
  });
  assert.ok(scope);
  assert.equal(scope.destinationName, "台中東區");
  assert.equal(scope.destinationArea, "東區");
  assert.equal(scope.resolvedSearchCity, "台中");
  assert.equal(scope.searchScope, "area");
  const cityWide = resolveRecommendationSearchScope({
    userText: "台中有什麼咖啡廳推薦嗎",
    session: {
      recommendedPlaces: [],
      selectedPlaces: [],
      phase: "discover",
      discovery: {},
      updatedAt: new Date().toISOString(),
    },
  });
  assert.equal(cityWide?.destinationName, "台中");
  assert.equal(cityWide?.searchScope, "city");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("verify-recommendation-search-center: ok (no Places API)");
