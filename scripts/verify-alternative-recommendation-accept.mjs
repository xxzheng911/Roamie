import assert from "node:assert/strict";
import { resolveMustVisitAdvice } from "../src/lib/ai/must-visit-places.ts";
import {
  shouldAcceptAlternativeRecommendations,
  isAcceptAlternativeRecommendationReply,
  isAlternativeRecommendationOffer,
  buildAlternativeRecommendationSummary,
} from "../src/lib/ai/chat-recommendation-refresh.ts";
import { NO_MORE_RECOMMENDATIONS_MESSAGE } from "../src/lib/ai/place-recommendation-rules.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

const affirmatives = ["好", "可以", "好的", "OK", "嗯", "對"];

for (const reply of affirmatives) {
  assert(
    isAcceptAlternativeRecommendationReply(reply),
    `accept alternative: ${reply}`,
  );
}

assert(
  isAlternativeRecommendationOffer(NO_MORE_RECOMMENDATIONS_MESSAGE),
  "detect NO_MORE offer message",
);

const msgs = [{ role: "assistant", content: NO_MORE_RECOMMENDATIONS_MESSAGE }];
assert(
  shouldAcceptAlternativeRecommendations(msgs, "好"),
  "should accept alternative after NO_MORE message",
);
assert(
  !shouldAcceptAlternativeRecommendations(msgs, "不要"),
  "should not accept negative reply",
);

const mustVisitAfterAffirmative = resolveMustVisitAdvice(
  { interests: [], destination: "九份", mustVisitGenerated: true },
  "好",
);
assert(
  mustVisitAfterAffirmative === null,
  "resolveMustVisitAdvice does not re-run on bare affirmative",
);

const planningTurn = processAdviceTurn(
  "好",
  {
    ...createEmptySession(),
    conversationMode: "destination_planning",
    travelContext: {
      interests: [],
      destination: "九份",
      mustVisitGenerated: true,
      tripPurpose: "refresh_recommendations",
    },
  },
  {
    interests: [],
    destination: "九份",
    mustVisitGenerated: true,
    tripPurpose: "refresh_recommendations",
  },
);
assert(
  planningTurn.advice.reply === null || typeof planningTurn.advice.reply === "string",
  "processAdviceTurn does not throw on affirmative after refresh",
);

const summary = buildAlternativeRecommendationSummary([
  { name: "阿妹茶樓" },
  { name: "升平咖啡" },
]);
assert(summary.includes("美食、咖啡廳和室內景點"), "alternative summary mentions categories");

console.log("verify-alternative-recommendation-accept: ok");
