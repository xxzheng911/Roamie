import assert from "node:assert/strict";
import {
  parseItineraryPlanModeIntent,
  buildFullItineraryDraftReply,
  planModeHumanLabel,
} from "../src/lib/ai/itinerary-planning.ts";
import {
  parsePendingOptionSelection,
  buildNextStepAfterAdviceSelection,
  pendingQuestionForItineraryAction,
} from "../src/lib/ai/destination-pending-question.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";

const ctx = {
  interests: [],
  destination: "曼谷",
  destinationCountry: "泰國",
  days: 5,
  conversationState: "ready_for_itinerary",
  tripPurpose: "ready_for_itinerary",
  selectedInterests: ["attractions", "shopping"],
};

const pending = pendingQuestionForItineraryAction("曼谷", "泰國");

const phrases = [
  "你幫我排完整5天行程",
  "幫我排完整5天",
  "直接排",
  "A",
];

for (const phrase of phrases) {
  assert.equal(parseItineraryPlanModeIntent(phrase), "full_itinerary", phrase);
  assert.equal(parsePendingOptionSelection(phrase, pending), "full_itinerary", phrase);
}

const acceptance = "你幫我排完整5天行程";
const selected = parsePendingOptionSelection(acceptance, pending);
assert.equal(selected, "full_itinerary");

const next = buildNextStepAfterAdviceSelection(selected, pending, ctx);
assert.ok(next.reply);
assert.match(next.reply, /曼谷 5 天節奏/);
assert.match(next.reply, /Day 1：市區寺廟與河岸/);
assert.match(next.reply, /大皇宮＋玉佛寺/);
assert.match(next.reply, /Day 5：補買伴手禮與輕鬆收尾/);
assert.match(next.reply, /早中晚順序/);
assert.doesNotMatch(next.reply, /full_itinerary/);
assert.doesNotMatch(next.reply, /你這趟大概幾天/);

const advice = resolveDestinationAdvice(
  ctx,
  {
    travelContext: ctx,
    pendingQuestion: pending,
    conversationMode: "destination_planning",
  },
  acceptance,
);
assert.ok(advice.reply);
assert.doesNotMatch(advice.reply, /full_itinerary/);
assert.doesNotMatch(advice.reply, /你這趟大概幾天/);
assert.equal(advice.contextPatch?.selectedPlanMode, "full_itinerary");
assert.equal(advice.contextPatch?.days ?? ctx.days, 5);

const merged = mergeTravelContext(
  {
    travelContext: ctx,
    pendingQuestion: pending,
    conversationMode: "destination_planning",
  },
  acceptance,
);
const route = resolveChatRoute(acceptance, merged.context, merged.session, "zh-TW", "general");
assert.equal(route.mode, "advice");
assert.doesNotMatch(route.question ?? "", /full_itinerary/);

assert.equal(planModeHumanLabel("full_itinerary", 5), "完整 5 天行程");
assert.equal(planModeHumanLabel("daily_recommendations"), "每天值得去的地點");

const draft = buildFullItineraryDraftReply(ctx, ["attractions", "shopping"]);
assert.ok(draft);
assert.doesNotMatch(draft, /must_visit_places|destination_advice|trip_add_place/);

console.log("verify-full-itinerary-draft: ok");
