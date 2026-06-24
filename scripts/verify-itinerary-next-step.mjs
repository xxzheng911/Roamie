import assert from "node:assert/strict";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import {
  parsePendingOptionSelection,
  parseItineraryNextStepSelection,
  pendingQuestionForItineraryAction,
  buildNextStepAfterAdviceSelection,
} from "../src/lib/ai/destination-pending-question.ts";
import { buildFullItineraryDraftReply, buildDailyRecommendationsReply } from "../src/lib/ai/itinerary-planning.ts";

const ctx = {
  interests: [],
  destination: "釜山",
  destinationCountry: "韓國",
  days: 5,
  conversationState: "ready_for_itinerary",
  tripPurpose: "ready_for_itinerary",
  selectedInterests: ["attractions", "food"],
};

const pending = pendingQuestionForItineraryAction("釜山", "韓國");
assert.equal(pending.type, "itinerary_next_step");

assert.equal(parseItineraryNextStepSelection("排完整5天"), "full_itinerary");
assert.equal(parseItineraryNextStepSelection("先列必去點"), "daily_recommendations");
assert.equal(parseItineraryNextStepSelection("A"), "full_itinerary");
assert.equal(parseItineraryNextStepSelection("B"), "daily_recommendations");
assert.equal(parsePendingOptionSelection("先列必去點", pending), "daily_recommendations");
assert.equal(parsePendingOptionSelection("排完整5天", pending), "full_itinerary");

const fullNext = buildNextStepAfterAdviceSelection("full_itinerary", pending, ctx);
assert.match(fullNext.reply, /釜山 5 天節奏/);
assert.match(fullNext.reply, /海雲台/);
assert.match(fullNext.reply, /甘川文化村/);
assert.doesNotMatch(fullNext.reply, /full_itinerary|daily_recommendations|itinerary_next_step/);
assert.doesNotMatch(fullNext.reply, /你這趟大概幾天/);

const dailyNext = buildNextStepAfterAdviceSelection("daily_recommendations", pending, ctx);
assert.match(dailyNext.reply, /釜山 5 天每天值得去/);
assert.match(dailyNext.reply, /札嘎其/);
assert.doesNotMatch(dailyNext.reply, /full_itinerary|daily_recommendations/);

const sessionWithPending = {
  travelContext: ctx,
  pendingQuestion: pending,
  conversationMode: "destination_planning",
};

const fullAdvice = resolveDestinationAdvice(ctx, sessionWithPending, "排完整5天");
assert.ok(fullAdvice.reply);
assert.match(fullAdvice.reply, /釜山/);
assert.doesNotMatch(fullAdvice.reply, /full_itinerary/);

const dailyAdvice = resolveDestinationAdvice(ctx, sessionWithPending, "先列必去點");
assert.ok(dailyAdvice.reply);
assert.match(dailyAdvice.reply, /每天值得去/);
assert.doesNotMatch(dailyAdvice.reply, /必去點有哪些|大皇宮/);

const mergedFull = mergeTravelContext(sessionWithPending, "排完整5天");
const routeFull = resolveChatRoute(
  "排完整5天",
  mergedFull.context,
  mergedFull.session,
  "zh-TW",
  "general",
);
assert.equal(routeFull.mode, "advice");

const mergedDaily = mergeTravelContext(sessionWithPending, "先列必去點");
const routeDaily = resolveChatRoute(
  "先列必去點",
  mergedDaily.context,
  mergedDaily.session,
  "zh-TW",
  "general",
);
assert.equal(routeDaily.mode, "advice");

const busanDraft = buildFullItineraryDraftReply(ctx);
const busanDaily = buildDailyRecommendationsReply(ctx);
assert.match(busanDraft, /釜山/);
assert.match(busanDaily, /釜山/);

console.log("verify-itinerary-next-step: ok");
