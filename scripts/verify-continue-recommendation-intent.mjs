#!/usr/bin/env node
/**
 * Continue Recommendation — unified grammar (not fixed-string only).
 * All listed phrases must map to the same continue intent family.
 */
import assert from "node:assert/strict";
import { matchesContinueRecommendationGrammar } from "../src/lib/ai/continue-recommendation-intent.ts";
import { isRefreshRecommendationsRequest } from "../src/lib/ai/chat-recommendation-refresh.ts";
import { isMoreRecommendationResultsText } from "../src/lib/ai/recommendation-refinement/parser.ts";
import {
  isContinueRecommendationRequest,
  createRecommendationSession,
  continueRecommendation,
  remainingRecommendationPoolCount,
  RECOMMENDATION_BATCH_SIZE,
  isUsableSearchCentroid,
} from "../src/lib/ai/conversation-recommendation-session.ts";
import { resolveChatIntentArbitration } from "../src/lib/ai/recommendation-refinement/arbitrate.ts";
import { createActiveRecommendationContext } from "../src/lib/ai/recommendation-refinement/merge.ts";
import { ensureActiveRecommendationContext } from "../src/lib/ai/recommendation-refinement/session.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import {
  buildMorePlacesContinuationAttempts,
  planMorePlacesContinuationSearch,
} from "../src/lib/ai/destination-place-recommendation.ts";
import { buildCafeSearchAttempts } from "../src/lib/ai/chat-cafe-search.ts";
import { buildRefinementSearchAttempts } from "../src/lib/ai/recommendation-refinement/search.ts";

const CONTINUE_PHRASES = [
  "還有嗎",
  "還有其他嗎",
  "還有推薦嗎",
  "再推薦幾個",
  "有別的嗎",
  "再給我更多",
  "附近還有嗎",
  "還有其他咖啡廳嗎",
  "有其他的嗎",
  "還有其他推薦嗎",
  "還有別的嗎",
  "其他呢",
  "再來幾個",
];

const NON_CONTINUE = [
  "幫我規劃東京五天行程",
  "我想找壽喜燒",
  "天氣如何",
];

function cafeSession() {
  const ctx = createActiveRecommendationContext({
    destinationName: "東京",
    destinationDisplayName: "東京",
    resolvedSearchCity: "東京",
    countryCode: "JP",
    latitude: 35.66,
    longitude: 139.7,
    radius: 8000,
    intent: "cafe",
    placeIds: ["ChIJaaaaaaaaaaaaaaaaaaa", "ChIJbbbbbbbbbbbbbbbbbbb"],
    canonicalKeys: ["id:a", "id:b"],
  });
  return {
    recommendedPlaces: [
      { name: "Fuglen Tokyo", googlePlaceId: "ChIJaaaaaaaaaaaaaaaaaaa" },
    ],
    selectedPlaces: [],
    phase: "recommend",
    activeCategoryIntent: "cafe",
    activeChatIntent: "cafe",
    recommendationSession: {
      sessionId: "rec_cafe",
      destination: "東京",
      topic: "cafe",
      returnedPlaceIds: ["ChIJaaaaaaaaaaaaaaaaaaa"],
      pool: [],
      cursor: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    activeRecommendationContext: ctx,
    conversationMode: "destination_planning",
    travelContext: { destination: "東京", interests: [] },
  };
}

console.log("=== continue recommendation grammar ===\n");

for (const phrase of CONTINUE_PHRASES) {
  assert.equal(
    matchesContinueRecommendationGrammar(phrase),
    true,
    `grammar: ${phrase}`,
  );
  assert.equal(isRefreshRecommendationsRequest(phrase), true, `refresh: ${phrase}`);
  assert.equal(isMoreRecommendationResultsText(phrase), true, `more: ${phrase}`);
  assert.equal(
    isContinueRecommendationRequest(phrase, cafeSession()),
    true,
    `continue: ${phrase}`,
  );
  const arb = resolveChatIntentArbitration(phrase, cafeSession());
  assert.equal(
    arb.route,
    "MORE_RECOMMENDATIONS",
    `arbitration ${phrase} → ${arb.route} (${arb.reason})`,
  );
  assert.equal(
    detectChatIntent(phrase),
    "refine_recommendations",
    `legacy intent: ${phrase}`,
  );
  console.log(`  ✓ ${phrase}`);
}

for (const phrase of NON_CONTINUE) {
  assert.equal(
    matchesContinueRecommendationGrammar(phrase),
    false,
    `non-continue: ${phrase}`,
  );
}
console.log("  ✓ non-continue phrases rejected");

const cafeAttempts = buildMorePlacesContinuationAttempts("台南安平", "cafe");
assert.ok(cafeAttempts.length >= 2, "cafe continuation has expandable strategies");
assert.ok(
  cafeAttempts.every((attempt) =>
    (attempt.includedTypes ?? []).every((type) => type === "cafe" || type === "coffee_shop"),
  ),
  "cafe continuation never uses attraction/restaurant candidates",
);
assert.ok(cafeAttempts.every((attempt) => /咖啡|咖啡廳|coffee|cafe|カフェ/i.test(attempt.query)));

const restaurantAttempts = buildMorePlacesContinuationAttempts("高雄鹽埕", "restaurant");
assert.ok(restaurantAttempts.length >= 2);
assert.ok(
  restaurantAttempts.every((attempt) =>
    (attempt.includedTypes ?? []).every((type) => type === "restaurant"),
  ),
);
console.log("  ✓ continuation strategies preserve category fidelity");

const firstPlan = planMorePlacesContinuationSearch({
  destination: "台南安平",
  category: "cafe",
});
assert.equal(firstPlan.remainingStrategyCount, cafeAttempts.length);
const firstAttempt = firstPlan.attempts[0];
const firstAttemptId = [
  firstAttempt.mode,
  firstAttempt.query.trim().toLocaleLowerCase(),
  [...(firstAttempt.includedTypes ?? [])].sort().join(","),
].join("|");
const secondPlan = planMorePlacesContinuationSearch({
  destination: "台南安平",
  category: "cafe",
  usedAttemptIds: [firstAttemptId],
});
assert.equal(secondPlan.remainingStrategyCount, cafeAttempts.length - 1);
assert.ok(secondPlan.attempts.length > 0, "one empty strategy must not imply no-more");
const exhaustedPlan = planMorePlacesContinuationSearch({
  destination: "台南安平",
  category: "cafe",
  usedAttemptIds: cafeAttempts.map((attempt) => [
    attempt.mode,
    attempt.query.trim().toLocaleLowerCase(),
    [...(attempt.includedTypes ?? [])].sort().join(","),
  ].join("|")),
});
assert.equal(exhaustedPlan.remainingStrategyCount, 0);
assert.deepEqual(exhaustedPlan.attempts, []);
console.log("  ✓ no-more requires all category strategies to be exhausted");

console.log("\n=== Tokyo Shibuya cafe continuation pool + provider parity ===\n");
{
  const usable = Array.from({ length: 6 }, (_, index) => ({
    name: `澀谷咖啡 ${index + 1}`,
    googlePlaceId: `ChIJshibuya_cafe_${index + 1}`,
    address: "東京都渋谷区道玄坂1-1",
  }));
  const { session, batch } = createRecommendationSession({
    destination: "東京澀谷",
    parentCity: "東京",
    area: "澀谷",
    searchScope: "area",
    topic: "cafe",
    pool: usable,
    batchSize: RECOMMENDATION_BATCH_SIZE,
    searchCentroid: { lat: 35.658, lng: 139.7016 },
    usedQueries: ["東京澀谷 coffee shop", "東京澀谷 cafe"],
  });
  assert.equal(session.pool.length, 6, "initial session retains all usable candidates");
  assert.equal(batch.length, 4, "first display is the session batch, not the full pool");
  assert.equal(remainingRecommendationPoolCount(session), 2);
  assert.equal(session.cursor, 4);

  const firstMore = continueRecommendation(session, RECOMMENDATION_BATCH_SIZE);
  assert.equal(firstMore.batch.length, 2, "還有嗎 consumes remaining stored candidates");
  assert.deepEqual(
    firstMore.batch.map((item) => item.googlePlaceId),
    ["ChIJshibuya_cafe_5", "ChIJshibuya_cafe_6"],
  );
  assert.equal(firstMore.exhausted, true);
  assert.equal(remainingRecommendationPoolCount(firstMore.session), 0);
  console.log("  ✓ first 還有嗎 consumes remaining stored pool (no Places required)");

  const secondMore = continueRecommendation(firstMore.session, RECOMMENDATION_BATCH_SIZE);
  assert.equal(secondMore.batch.length, 0);
  assert.equal(secondMore.exhausted, true);
  console.log("  ✓ second 還有嗎 finds stored pool exhausted");

  const cafeContract = buildCafeSearchAttempts("東京澀谷");
  const continuation = planMorePlacesContinuationSearch({
    destination: "東京澀谷",
    category: "cafe",
    usedQueries: session.usedQueries,
  });
  assert.ok(continuation.attempts.length > 0, "pool exhausted still has unused legal cafe strategies");
  assert.equal(
    continuation.attempts.some((attempt) =>
      session.usedQueries.includes(attempt.query),
    ),
    false,
    "next Places round must skip already-executed cafe queries",
  );
  assert.ok(
    continuation.attempts.every((attempt) =>
      (attempt.includedTypes ?? []).every((type) => type === "cafe" || type === "coffee_shop"),
    ),
  );
  const authoritativeQueries = [...cafeContract.primary, ...cafeContract.fallback].map(
    (attempt) => attempt.query,
  );
  assert.ok(
    continuation.attempts.every((attempt) => authoritativeQueries.includes(attempt.query)),
    "continuation must reuse the destination-category cafe query contract",
  );
  const refinementQueries = buildRefinementSearchAttempts(
    {
      intent: "cafe",
      destinationName: "東京澀谷",
      destinationDisplayName: "東京澀谷",
      parentCity: "東京",
      area: "澀谷",
      searchScope: "area",
      previousPlaceIds: [],
      previousCanonicalKeys: [],
      currentResultPlaceIds: [],
      usedQueries: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    "東京澀谷",
  ).map((attempt) => attempt.query);
  assert.notDeepEqual(
    continuation.attempts.map((attempt) => attempt.query),
    refinementQueries,
    "bare 還有嗎 must not fall back to the weaker refinement query list",
  );
  console.log("  ✓ pool exhausted → next legal destination-category cafe strategy");

  const cafeCtx = ensureActiveRecommendationContext(
    { recommendedPlaces: [], selectedPlaces: [], phase: "recommend" },
    { destination: "東京澀谷", intent: "cafe" },
  );
  assert.equal(
    cafeCtx.latitude,
    undefined,
    "cafe snapshot must not inherit Tokyo shopping-cluster (Shinjuku) centroid",
  );
  assert.equal(cafeCtx.longitude, undefined);
  assert.equal(isUsableSearchCentroid({ lat: 0, lng: 0 }), false);
  assert.equal(isUsableSearchCentroid({ lat: 35.658, lng: 139.7016 }), true);
  console.log("  ✓ cafe search center is not the Shinjuku shopping fallback");
}

console.log("\nverify-continue-recommendation-intent: ok");
