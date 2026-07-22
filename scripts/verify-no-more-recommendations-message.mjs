/**
 * Guards: NO_MORE_RECOMMENDATIONS_MESSAGE is a single exported constant;
 * pool exhaustion must not throw ReferenceError and must preserve session.
 */
import assert from "node:assert/strict";
import {
  createRecommendationSession,
  continueRecommendation,
  isContinueRecommendationRequest,
  RECOMMENDATION_BATCH_SIZE,
} from "../src/lib/ai/conversation-recommendation-session.ts";
import { NO_MORE_RECOMMENDATIONS_MESSAGE } from "../src/lib/ai/place-recommendation-rules.ts";

assert.equal(typeof NO_MORE_RECOMMENDATIONS_MESSAGE, "string");
assert.ok(NO_MORE_RECOMMENDATIONS_MESSAGE.length > 0);

const pool = [
  {
    name: "狸小路商店街",
    type: "shopping_mall",
    description: "",
    reason: "",
    estimatedTime: "1-2 小時",
    address: "札幌",
    lat: 43.05,
    lng: 141.35,
    googleMapsUrl: "",
    placeName: "狸小路商店街",
    reasonSource: "template",
    googlePlaceId: "place_1",
  },
];

const { session } = createRecommendationSession({
  destination: "北海道",
  topic: "shopping",
  pool,
  batchSize: RECOMMENDATION_BATCH_SIZE,
});

assert.equal(session.cursor, 1);
assert.equal(session.topic, "shopping");

const exhausted = continueRecommendation(session, RECOMMENDATION_BATCH_SIZE);
assert.equal(exhausted.batch.length, 0);
assert.equal(exhausted.exhausted, true);

// Soft no-more path: evaluating the constant must never throw.
assert.doesNotThrow(() => {
  void NO_MORE_RECOMMENDATIONS_MESSAGE;
});

const planningSession = {
  recommendationSession: session,
  activeCategoryIntent: "shopping",
  travelContext: { destination: "北海道", interests: [] },
  recommendedPlaces: pool,
  selectedPlaces: [],
  plannedStops: [],
};

assert.equal(isContinueRecommendationRequest("還有嗎", planningSession), true);

// Session preserved after exhaustion.
assert.equal(exhausted.session.topic, "shopping");
assert.equal(exhausted.session.destination, "北海道");
assert.equal(exhausted.session.cursor, session.cursor);

// Chat route must import the constant (static string check).
import { readFileSync } from "node:fs";
import path from "node:path";
const chatSrc = readFileSync(
  path.resolve(import.meta.dirname, "../src/routes/_app.chat.tsx"),
  "utf8",
);
assert.match(
  chatSrc,
  /import\s*\{\s*NO_MORE_RECOMMENDATIONS_MESSAGE\s*\}\s*from\s*["']@\/lib\/ai\/place-recommendation-rules["']/,
);
assert.ok(!chatSrc.includes("globalThis.NO_MORE_RECOMMENDATIONS_MESSAGE"));

console.log("verify-no-more-recommendations-message: ok");
