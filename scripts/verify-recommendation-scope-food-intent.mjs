#!/usr/bin/env node
/**
 * Cases A–H: destination-first recommendation scope + food subtype intent.
 */
import assert from "node:assert/strict";
import {
  isExplicitDeviceNearbyRequest,
  resolveRecommendationSearchScope,
} from "../src/lib/ai/recommendation-search-scope.ts";
import {
  parsePlaceRecommendationIntent,
  hasExplicitPlaceRecommendationIntent,
  buildPlaceRecommendationQueries,
  resolvePlaceRecommendationDestination,
  shouldBypassCombinationPending,
} from "../src/lib/ai/place-recommendation-intent/index.ts";
import {
  matchesFoodIntent,
  placeMatchesCuisineRelevance,
} from "../src/lib/ai/recommendation-refinement/search.ts";
import { resolveChatPlaceSearchMode } from "../src/lib/ai/chat-place-search-context.ts";
import { shouldFetchNearbyPlaces } from "../src/lib/ai/chat-dining-flow.ts";
import { shouldFetchDestinationCategoryPlaces } from "../src/lib/ai/chat-place-intent.ts";
import { foodPreferenceSearchQuery } from "../src/lib/ai/chat-dining-flow.ts";

function tripSession(destination, overrides = {}) {
  return {
    recommendedPlaces: [],
    selectedPlaces: [],
    phase: "discover",
    discovery: {},
    updatedAt: new Date().toISOString(),
    conversationMode: "destination_planning",
    location: { city: "台北", lat: 25.03, lng: 121.56 },
    pendingQuestion: {
      type: "combination_choice",
      options: ["1", "2", "3", "4"],
      baseDestination: destination,
      destinationCountry: "日本",
    },
    tripPlanningContext: {
      destination,
      days: 6,
      startDate: "2026-08-05",
      endDate: "2026-08-10",
    },
    travelContext: {
      destination,
      days: 6,
      startDate: "2026-08-05",
      endDate: "2026-08-10",
      interests: [],
      tripPurpose: "combination_suggestions_offered",
      planningDaysConfirmed: true,
    },
    tripDays: 6,
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

console.log("=== recommendation scope + food intent (A–H) ===\n");

// Case A: Nagoya + sukiyaki → Nagoya scope, not device
check("Case A: Nagoya sukiyaki uses trip destination", () => {
  const session = tripSession("名古屋");
  const msg = "有壽喜燒店推薦";
  const scope = resolveRecommendationSearchScope({
    userText: msg,
    session,
    context: session.travelContext,
  });
  assert.ok(scope);
  assert.equal(scope.destinationName, "名古屋");
  assert.equal(scope.source, "conversation_trip_destination");
  assert.equal(scope.deviceLocationIgnored, true);
  assert.equal(isExplicitDeviceNearbyRequest(msg), false);

  const mode = resolveChatPlaceSearchMode(session.travelContext, session, msg);
  assert.equal(mode, "destination");

  assert.equal(shouldFetchNearbyPlaces("restaurant", session, msg), false);
  assert.equal(
    shouldFetchDestinationCategoryPlaces(msg, session.travelContext, session),
    true,
  );

  const parsed = parsePlaceRecommendationIntent(msg);
  assert.ok(parsed);
  assert.equal(parsed.primaryType, "restaurant");
  assert.ok(parsed.subtypes.includes("sukiyaki"));

  const queries = buildPlaceRecommendationQueries({
    destination: "名古屋",
    primaryType: "restaurant",
    subtypes: ["sukiyaki"],
  });
  assert.ok(queries.some((q) => /壽喜燒|すき焼き|sukiyaki/i.test(q.query)));
  assert.ok(queries.every((q) => /名古屋|Nagoya/i.test(q.query)));

  assert.equal(
    placeMatchesCuisineRelevance(
      { name: "味真好烤鴨", types: ["restaurant"], primaryType: "restaurant" },
      ["sukiyaki"],
    ),
    false,
  );
  assert.equal(
    placeMatchesCuisineRelevance(
      { name: "阿梅早點", types: ["restaurant"], primaryType: "restaurant" },
      ["sukiyaki"],
    ),
    false,
  );
  assert.equal(
    matchesFoodIntent(
      { name: "名古屋壽喜燒本店", types: ["restaurant"], primaryType: "restaurant" },
      { dishType: "sukiyaki" },
    ),
    true,
  );
  assert.ok(foodPreferenceSearchQuery("sukiyaki")?.includes("壽喜燒"));
});

// Case B: Osaka ramen
check("Case B: Osaka ramen", () => {
  const session = tripSession("大阪");
  const msg = "有拉麵店嗎";
  const scope = resolveRecommendationSearchScope({
    userText: msg,
    session,
    context: session.travelContext,
  });
  assert.equal(scope?.destinationName, "大阪");
  assert.equal(scope?.deviceLocationIgnored, true);
  const parsed = parsePlaceRecommendationIntent(msg);
  assert.ok(parsed?.subtypes.includes("ramen"));
});

// Case C: Seoul bbq
check("Case C: Seoul yakiniku", () => {
  const session = tripSession("首爾");
  const msg = "想吃燒肉";
  const scope = resolveRecommendationSearchScope({
    userText: msg,
    session,
    context: session.travelContext,
  });
  assert.equal(scope?.destinationName, "首爾");
  const parsed = parsePlaceRecommendationIntent(msg);
  assert.ok(parsed?.subtypes.includes("bbq"));
});

// Case D: Tainan quiet cafe with sockets
check("Case D: Tainan quiet cafe + sockets", () => {
  const session = tripSession("台南", {
    pendingQuestion: undefined,
    travelContext: {
      destination: "台南",
      days: 3,
      interests: [],
      tripPurpose: "destination_selected",
    },
  });
  const msg = "有安靜又有插座的咖啡廳嗎";
  const scope = resolveRecommendationSearchScope({
    userText: msg,
    session,
    context: session.travelContext,
  });
  assert.equal(scope?.destinationName, "台南");
  const parsed = parsePlaceRecommendationIntent(msg);
  assert.equal(parsed?.primaryType, "cafe");
  assert.ok(
    parsed?.preferredFeatures?.includes("quiet") ||
      parsed?.preferredFeatures?.includes("sockets") ||
      parsed?.atmosphere?.length ||
      parsed?.preferredFeatures?.length,
  );
});

// Case E: Tokyo department store explicit in message
check("Case E: Tokyo department store from message", () => {
  const session = tripSession("名古屋");
  const msg = "東京有百貨公司嗎";
  const scope = resolveRecommendationSearchScope({
    userText: msg,
    session,
    context: session.travelContext,
  });
  assert.equal(scope?.destinationName, "東京");
  assert.equal(scope?.source, "explicit_user_destination");
  const dest = resolvePlaceRecommendationDestination({
    userText: msg,
    session,
    context: session.travelContext,
  });
  assert.equal(dest?.destinationDisplayName, "東京");
  assert.equal(dest?.source, "message");
});

// Case F: explicit device nearby
check("Case F: explicit device nearby allowed", () => {
  const session = tripSession("名古屋");
  const msg = "我現在附近有壽喜燒嗎";
  assert.equal(isExplicitDeviceNearbyRequest(msg), true);
  const scope = resolveRecommendationSearchScope({
    userText: msg,
    session,
    context: session.travelContext,
  });
  assert.equal(scope?.source, "current_device_location");
  assert.equal(scope?.deviceLocationIgnored, false);
  const mode = resolveChatPlaceSearchMode(session.travelContext, session, msg);
  assert.equal(mode, "nearby");
});

// Case G: Taipei override while Nagoya context
check("Case G: Taipei override in message", () => {
  const session = tripSession("名古屋");
  const msg = "台北有壽喜燒嗎";
  const scope = resolveRecommendationSearchScope({
    userText: msg,
    session,
    context: session.travelContext,
  });
  assert.equal(scope?.destinationName, "台北");
  assert.equal(scope?.source, "explicit_user_destination");
});

// Case H: exclude hotpot, want bbq
check("Case H: exclude hotpot want bbq", () => {
  const session = tripSession("名古屋");
  const msg = "不要火鍋，想吃燒肉";
  const parsed = parsePlaceRecommendationIntent(msg);
  assert.ok(parsed);
  assert.ok(parsed.subtypes.includes("bbq"));
  assert.ok(
    parsed.excludedFeatures?.some((f) => /火鍋|hotpot/i.test(f)) ||
      !parsed.subtypes.includes("hotpot"),
  );
});

// Combination pending bypass
check("combination pending: sukiyaki bypasses", () => {
  const msg = "有壽喜燒店推薦";
  assert.equal(hasExplicitPlaceRecommendationIntent(msg), true);
  const bypass = shouldBypassCombinationPending(msg);
  assert.equal(bypass.bypass, true);
});

// Bare「附近」with trip destination → still destination mode
check("bare 附近 keeps trip destination", () => {
  const session = tripSession("名古屋");
  const msg = "附近有什麼景點";
  assert.equal(isExplicitDeviceNearbyRequest(msg), false);
  const mode = resolveChatPlaceSearchMode(session.travelContext, session, msg);
  assert.equal(mode, "destination");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
