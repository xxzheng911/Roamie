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
} from "../src/lib/ai/conversation-recommendation-session.ts";
import { resolveChatIntentArbitration } from "../src/lib/ai/recommendation-refinement/arbitrate.ts";
import { createActiveRecommendationContext } from "../src/lib/ai/recommendation-refinement/merge.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import {
  buildMorePlacesContinuationAttempts,
  planMorePlacesContinuationSearch,
} from "../src/lib/ai/destination-place-recommendation.ts";

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
assert.ok(cafeAttempts.every((attempt) => /咖啡|coffee|cafe/i.test(attempt.query)));

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

console.log("\nverify-continue-recommendation-intent: ok");
