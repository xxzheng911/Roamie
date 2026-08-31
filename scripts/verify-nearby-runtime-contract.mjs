import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildNearbyLocationClarificationCopy,
  createPendingNearbyLocationRequest,
  hasUsableNearbyCoordinates,
  isUsableNearbyClarificationLocation,
  normalizeNearbyClarificationQuery,
  NEARBY_CLARIFICATION_CONTRACT_VERSION,
  NEARBY_LOCATION_CLARIFICATION_COPY,
  resolveChatRouteAuthority,
  shouldAllowNearbyDispatch,
  shouldResolveNearbyCurrentLocation,
} from "../src/lib/ai/nearby-location-clarification.ts";
import { inferNearbyIntentFromContext } from "../src/lib/ai/chat-intent.ts";
import { shouldBlockNearbyRecommendation } from "../src/lib/ai/chat-intent-router.ts";
import { shouldFetchNearbyPlaces } from "../src/lib/ai/chat-dining-flow.ts";
import {
  buildNearbyPlaceRecommendation,
  fetchNearbyPlacesForIntent,
} from "../src/lib/ai/chat-place-recommendation.ts";
import {
  continueRecommendation,
  createRecommendationSession,
} from "../src/lib/ai/conversation-recommendation-session.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

const context = {
  interests: [],
};

for (const [text, expected] of [
  ["想看附近餐廳", "restaurant"],
  ["想找附近的宵夜店", "restaurant"],
  ["想找附近居酒屋", "restaurant"],
  ["想找附近咖啡廳", "cafe"],
]) {
  const session = createEmptySession();
  assert.equal(inferNearbyIntentFromContext(context, text, session), expected, text);
  assert.equal(
    shouldResolveNearbyCurrentLocation({ userText: text }),
    true,
    `${text} must attempt current location before clarification`,
  );
  assert.equal(
    resolveChatRouteAuthority({
      explicitNearbyRequest: true,
      resolvedNearbyIntent: expected,
      categoryPlaceQuery: true,
    }),
    "nearby",
    `${text} must bypass destination-category dispatch`,
  );
}

assert.equal(
  resolveChatRouteAuthority({
    pendingNearbyLocationRequest: true,
    resolvedNearbyIntent: "restaurant",
    categoryPlaceQuery: true,
  }),
  "nearby",
  "a location clarification answer must resume the pending Nearby request",
);

for (const [locationAnswer, originalNearbyText] of [
  ["高雄左營", "想找附近餐廳"],
  ["台北信義區", "想找附近居酒屋"],
]) {
  const resumedSession = {
    ...createEmptySession(),
    activeChatIntent: "restaurant",
    location: { lat: 22.68, lng: 120.29, city: locationAnswer },
  };
  const selectedAuthority = resolveChatRouteAuthority({
    pendingNearbyLocationRequest: true,
    resolvedNearbyIntent: "restaurant",
    categoryPlaceQuery: true,
  });
  const legacyShouldFetch = shouldFetchNearbyPlaces("restaurant", resumedSession, locationAnswer);
  assert.equal(selectedAuthority, "nearby", originalNearbyText);
  assert.equal(shouldBlockNearbyRecommendation(locationAnswer, resumedSession), true);
  assert.equal(legacyShouldFetch, false, "the named-location legacy gate remains unchanged");
  assert.equal(
    shouldAllowNearbyDispatch({
      selectedAuthority,
      nearbyIntent: "restaurant",
      legacyShouldFetch,
    }),
    true,
    `${originalNearbyText} -> ${locationAnswer} must reach authoritative Nearby dispatch`,
  );
}

for (const text of ["高雄三民區有哪些餐廳", "東京推薦咖啡廳"]) {
  const selectedAuthority = resolveChatRouteAuthority({
    explicitNearbyRequest: false,
    resolvedNearbyIntent: text.includes("咖啡") ? "cafe" : "restaurant",
    categoryPlaceQuery: true,
  });
  assert.equal(
    selectedAuthority,
    "destination_category",
    `${text} must retain destination-category authority`,
  );
  assert.equal(
    shouldAllowNearbyDispatch({
      selectedAuthority,
      nearbyIntent: text.includes("咖啡") ? "cafe" : "restaurant",
      legacyShouldFetch: false,
    }),
    false,
    `${text} must not gain a Nearby bypass`,
  );
}
assert.equal(
  shouldAllowNearbyDispatch({
    selectedAuthority: "other",
    nearbyIntent: "restaurant",
    legacyShouldFetch: false,
  }),
  false,
  "generic dispatch must preserve a false legacy fetch decision",
);
assert.equal(
  shouldAllowNearbyDispatch({
    selectedAuthority: "other",
    nearbyIntent: "restaurant",
    legacyShouldFetch: true,
  }),
  true,
  "generic dispatch must preserve a true legacy fetch decision",
);
assert.equal(
  resolveChatRouteAuthority({
    structuredShortcut: true,
    resolvedNearbyIntent: "attraction",
    categoryPlaceQuery: true,
  }),
  "shortcut",
  "structured shortcut authority must remain intact",
);

const pending = createPendingNearbyLocationRequest("restaurant", "想看附近餐廳");
assert.deepEqual(
  {
    intent: pending.intent,
    category: pending.category,
    originalUserText: pending.originalUserText,
    originalQuery: pending.originalQuery,
    nearbyIntent: pending.nearbyIntent,
    requestedScope: pending.requestedScope,
    originalAuthority: pending.originalAuthority,
    originalSearchMode: pending.originalSearchMode,
  },
  {
    intent: "restaurant",
    category: "restaurant",
    originalUserText: "想看附近餐廳",
    originalQuery: "想看附近餐廳",
    nearbyIntent: "restaurant",
    requestedScope: "nearby",
    originalAuthority: "nearby",
    originalSearchMode: "location_clarification",
  },
);
const breakfastPending = createPendingNearbyLocationRequest(
  "restaurant",
  "我想找附近早餐店",
);
assert.equal(breakfastPending.queryCategory, "早餐店");
assert.equal(breakfastPending.subtype, "breakfast");
assert.equal(breakfastPending.mealSlot, "breakfast");
const lateNightPending = createPendingNearbyLocationRequest(
  "restaurant",
  "我想找附近宵夜店",
);
assert.equal(lateNightPending.mealSlot, "late_night");
assert.equal(lateNightPending.originalQuery, "我想找附近宵夜店");
assert.deepEqual(
  buildNearbyLocationClarificationCopy("我想找附近早餐店", "restaurant"),
  { categoryLabel: "早餐店", renderedCopy: "你是指哪個地區的呢？" },
);
assert.equal(
  buildNearbyLocationClarificationCopy("想找附近居酒屋", "restaurant").categoryLabel,
  "居酒屋",
);
for (const [query, intent] of [
  ["附近餐廳", "restaurant"],
  ["附近咖啡廳", "cafe"],
  ["附近早餐店", "restaurant"],
  ["附近居酒屋", "restaurant"],
]) {
  assert.equal(
    buildNearbyLocationClarificationCopy(query, intent).renderedCopy,
    "你是指哪個地區的呢？",
  );
}
assert.equal(NEARBY_LOCATION_CLARIFICATION_COPY, "你是指哪個地區的呢？");
assert.equal(NEARBY_CLARIFICATION_CONTRACT_VERSION, "nearby-clarification-v2");
assert.equal(normalizeNearbyClarificationQuery(" 台北， 信義區 "), "台北 信義區");
assert.equal(
  isUsableNearbyClarificationLocation({
    placeId: "google:district",
    country: "台灣",
    city: "高雄市左營區",
    lat: 22.6877,
    lng: 120.2946,
  }),
  true,
);
assert.equal(
  isUsableNearbyClarificationLocation({
    placeId: "approx:高雄左營",
    country: "台灣",
    city: "高雄左營",
    lat: 23.9739,
    lng: 120.9823,
  }),
  false,
  "an approximate/default center is not a successful clarification geocode",
);
for (const [originalQuery, locationAnswer, intent] of [
  ["想找附近咖啡廳", "高雄左營", "cafe"],
  ["想找附近餐廳", "台北信義區", "restaurant"],
  ["想找附近居酒屋", "京都祇園", "restaurant"],
]) {
  const persistedSession = JSON.parse(
    JSON.stringify({
      ...createEmptySession(),
      pendingNearbyLocationRequest: createPendingNearbyLocationRequest(intent, originalQuery),
    }),
  );
  assert.equal(persistedSession.pendingNearbyLocationRequest.originalQuery, originalQuery);
  assert.equal(persistedSession.pendingNearbyLocationRequest.nearbyIntent, intent);
  assert.equal(
    resolveChatRouteAuthority({
      pendingNearbyLocationRequest: true,
      resolvedNearbyIntent: persistedSession.pendingNearbyLocationRequest.nearbyIntent,
      categoryPlaceQuery: true,
    }),
    "nearby",
    `${originalQuery} -> ${locationAnswer} must survive persistence and retain Nearby authority`,
  );
}
assert.equal(hasUsableNearbyCoordinates({ lat: 22.65, lng: 120.31 }), true);
assert.equal(hasUsableNearbyCoordinates({ lat: 0, lng: 0 }), false);

const chatRouteSource = fs.readFileSync(
  new URL("../src/routes/_app.chat.tsx", import.meta.url),
  "utf8",
);
assert.match(chatRouteSource, /const rawCategoryPlaceQuery = shouldFetchDestinationCategoryPlaces/);
assert.match(
  chatRouteSource,
  /const categoryPlaceQuery = selectedRouteAuthority === "destination_category"/,
);
assert.match(
  chatRouteSource,
  /if \(categoryPlaceQuery\) \{[\s\S]*?pushDestinationCategoryPlaceRecommendation/,
);
assert.match(chatRouteSource, /\[CHAT_ROUTE_AUTHORITY\]/);
assert.match(chatRouteSource, /\[AFTER_ROUTE_AUTHORITY\]/);
assert.match(chatRouteSource, /\[ENTER_NEARBY_PIPELINE\]/);
assert.match(chatRouteSource, /\[BEFORE_PUSH_NEARBY\]/);
assert.match(chatRouteSource, /\[SKIP_NEARBY_PIPELINE\]/);
assert.match(
  chatRouteSource,
  /shouldAllowNearbyDispatch\(\{[\s\S]*?selectedAuthority: selectedRouteAuthority,[\s\S]*?nearbyIntent,[\s\S]*?legacyShouldFetch: legacyShouldFetchNearby/,
  "resolved Nearby authority must wrap the legacy fetch result at dispatch",
);
const sendRuntimeIndex = chatRouteSource.indexOf("[CHAT_SEND_RUNTIME_VERSION]");
const pendingCheckIndex = chatRouteSource.indexOf("[CHAT_PENDING_NEARBY_CHECK]");
const applyTripIntentIndex = chatRouteSource.indexOf(
  "applyTripIntentToSession(trimmed, session)",
  pendingCheckIndex,
);
assert.ok(sendRuntimeIndex >= 0 && sendRuntimeIndex < applyTripIntentIndex);
assert.ok(pendingCheckIndex >= 0 && pendingCheckIndex < applyTripIntentIndex);
assert.match(chatRouteSource, /\[CHAT_PENDING_NEARBY_CREATED\]/);
assert.match(chatRouteSource, /\[NEARBY_LOCATION_GEOCODE_START\]/);
assert.match(chatRouteSource, /\[PLANNER_BYPASSED_FOR_PENDING_NEARBY\]/);
assert.match(chatRouteSource, /\[NEARBY_LOCATION_GEOCODE_ATTEMPT\]/);
assert.match(chatRouteSource, /\[CLARIFICATION_COPY_RESOLVED\]/);
assert.match(chatRouteSource, /\[NEARBY_CLARIFICATION_RUNTIME_VERSION\]/);
assert.match(chatRouteSource, /\[NEARBY_SEARCH_CENTER_AUTHORITY\]/);
assert.match(chatRouteSource, /\[NEARBY_SEARCH_CENTER_MISMATCH\]/);
assert.match(chatRouteSource, /\[GENERIC_NEARBY_POOL_COMMIT_DECISION\]/);
assert.match(chatRouteSource, /\[GENERIC_NEARBY_POOL_COMMIT_RESULT\]/);
assert.match(chatRouteSource, /\[GENERIC_NEARBY_POOL_COMMIT_ERROR\]/);
const genericPoolDeclarationMatches = chatRouteSource.match(
  /const shouldCommitGenericNearbyPool\s*=/g,
);
assert.equal(
  genericPoolDeclarationMatches?.length,
  1,
  "Generic Nearby pool ownership must have exactly one declaration",
);
const genericPoolDeclarationIndex = chatRouteSource.indexOf(
  "const shouldCommitGenericNearbyPool =",
);
const genericPoolUseIndex = chatRouteSource.indexOf(
  "shouldCommitGenericNearbyPool ? continuationRecommendations",
);
assert.ok(
  genericPoolDeclarationIndex >= 0 && genericPoolDeclarationIndex < genericPoolUseIndex,
  "Generic Nearby pool decision must be declared in the same pipeline before commit",
);
assert.match(
  chatRouteSource,
  /nearbyProviderCompleted[\s\S]*?recommendation_processing_failure[\s\S]*?provider_zero/,
  "post-provider processing failures must not be classified as provider_zero",
);
assert.match(
  chatRouteSource,
  /pushNearbyPlaceRecommendation\([\s\S]*?pendingNearbyLocation\.intent,[\s\S]*?\{ authoritativeSearchCenter \}/,
  "pending resume must pass its geocoded center as turn-scoped authority",
);
assert.match(
  chatRouteSource,
  /const merged = authoritativeCenter[\s\S]*?context: activeSession\.travelContext[\s\S]*?session: activeSession/,
  "authoritative pending resume must bypass a fresh travel-context merge",
);
assert.match(
  chatRouteSource,
  /reason === "center_mismatch"[\s\S]*?reason: "search_center_mismatch"/,
  "a center mismatch must not be reported as genuine zero results",
);
assert.match(chatRouteSource, /hasGeocodeFallback: true/);
assert.match(chatRouteSource, /copyVersion: "simple-location-question"/);
assert.match(
  chatRouteSource,
  /if \(userExplicitlyWantsNearbyPlaces\(userText\)\) return false;[\s\S]*?extractProvisionalDestinationAreaCandidate\(userText\)/,
  "explicit Nearby must not enter destination-category provisional-area clarification",
);
const plannerBypassIndex = chatRouteSource.indexOf("[PLANNER_BYPASSED_FOR_PENDING_NEARBY]");
assert.ok(plannerBypassIndex > pendingCheckIndex && plannerBypassIndex < applyTripIntentIndex);
assert.match(
  chatRouteSource,
  /earlyRouteAuthority === "nearby" \? earlyNearbyIntent : null;[\s\S]*?pendingNearbyLocationRequest: createPendingNearbyLocationRequest\([\s\S]*?persistSession\(pendingSession, next\);[\s\S]*?\[CHAT_PENDING_NEARBY_CREATED\]/,
  "authoritative Nearby clarification must persist pending state before rendering the reply",
);
assert.match(
  chatRouteSource,
  /pendingClarification: undefined,[\s\S]*?pushNearbyPlaceRecommendation\([\s\S]*?pendingNearbyLocation\.originalUserText/,
);
assert.match(
  chatRouteSource,
  /if \(earlyRouteAuthority === "destination_category"\) \{[\s\S]*?pushDestinationCategoryPlaceRecommendation/,
);

const origin = { lat: 22.65, lng: 120.31 };
let mismatchedCenterProviderCalls = 0;
const mismatchedCenterResults = await fetchNearbyPlacesForIntent(
  "restaurant",
  24.1320588,
  120.6633253,
  "zh-TW",
  async () => {
    mismatchedCenterProviderCalls += 1;
    return { places: [], error: null };
  },
  undefined,
  context,
  [],
  {
    userText: "我想找附近宵夜店",
    searchCenterAuthority: {
      lat: 22.6877358,
      lng: 120.2916524,
      displayLabel: "台灣高雄市左營區",
      source: "clarification_geocode",
      originalQuery: "我想找附近宵夜店",
      selectedAuthority: "nearby",
    },
  },
);
assert.deepEqual(mismatchedCenterResults, []);
assert.equal(
  mismatchedCenterProviderCalls,
  0,
  "a mismatched authoritative center must fail before any Places request",
);
const validRestaurant = (id, name) => ({
  id,
  name,
  address: "高雄市三民區",
  lat: origin.lat + 0.001,
  lng: origin.lng + 0.001,
  rating: 4.3,
  userRatingCount: 120,
  photoName: "places/photo",
  primaryType: "restaurant",
  types: ["restaurant", "food"],
  businessStatus: "OPERATIONAL",
});

const expanded = await fetchNearbyPlacesForIntent(
  "restaurant",
  origin.lat,
  origin.lng,
  "zh-TW",
  async ({ data }) => ({
    places:
      (data.radius ?? 0) <= 1_500
        ? [
            {
              ...validRestaurant("invalid-attraction", "一般景點"),
              primaryType: "tourist_attraction",
              types: ["tourist_attraction"],
            },
          ]
        : [validRestaurant("restaurant-expanded", "三民深夜食堂")],
    error: null,
  }),
  undefined,
  context,
  [],
  { userText: "想找附近的宵夜店" },
);
assert.equal(expanded[0]?.id, "restaurant-expanded", "eligible-empty first wave must expand");

await assert.rejects(
  fetchNearbyPlacesForIntent(
    "restaurant",
    origin.lat,
    origin.lng,
    "zh-TW",
    async () => ({ places: [], error: "upstream_unavailable" }),
    undefined,
    context,
    [],
    { userText: "想看附近餐廳" },
  ),
  /places_search_failed:upstream_unavailable/,
  "provider failure must not be represented as genuine zero results",
);

const nearbyPoolPlaces = Array.from({ length: 8 }, (_, index) => ({
  ...validRestaurant(`nearby-pool-${index + 1}`, `附近餐廳 ${index + 1}`),
  lat: origin.lat + (index + 1) * 0.0001,
  lng: origin.lng + (index + 1) * 0.0001,
}));
const nearbyFirstTurn = await buildNearbyPlaceRecommendation({
  intent: "restaurant",
  lat: origin.lat,
  lng: origin.lng,
  locale: "zh-TW",
  context,
  userText: "想看附近餐廳",
  searchPlaces: async () => ({ places: nearbyPoolPlaces, error: null }),
});
assert.ok(
  nearbyFirstTurn.continuationRecommendations.length > nearbyFirstTurn.recommendations.length,
  "Generic Nearby must preserve eligible candidates beyond the first displayed batch",
);
const displayed = nearbyFirstTurn.recommendations;
const createdNearbyPool = createRecommendationSession({
  destination: "附近",
  topic: "restaurant",
  pool: nearbyFirstTurn.continuationRecommendations,
  batchSize: displayed.length,
});
const storedNearbySession = {
  ...createdNearbyPool.session,
  displayBatchSize: 3,
};
const nearbyContinuation = continueRecommendation(storedNearbySession);
assert.ok(nearbyContinuation.batch.length > 0, "Nearby follow-up must consume stored pool");
assert.equal(
  nearbyContinuation.batch.some((candidate) =>
    displayed.some(
      (shown) =>
        (shown.googlePlaceId ?? shown.placeId) === (candidate.googlePlaceId ?? candidate.placeId),
    ),
  ),
  false,
  "Nearby stored-pool continuation must not repeat the first displayed Place IDs",
);

console.log("verify:nearby-runtime-contract passed");
