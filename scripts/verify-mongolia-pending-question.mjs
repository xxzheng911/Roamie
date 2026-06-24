import assert from "node:assert/strict";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import {
  buildDestinationStyleChoiceQuestion,
  buildDefaultRoutesReply,
  getDestinationStyleGuide,
} from "../src/lib/ai/destination-style-guide.ts";
import {
  parsePendingOptionSelection,
  pendingQuestionForDestinationStyleChoice,
  USE_DEFAULT_ROUTES,
  buildNextStepAfterAdviceSelection,
} from "../src/lib/ai/destination-pending-question.ts";
import { buildDestinationPlanningClarify } from "../src/lib/ai/trip-planning-context.ts";
import { parseDestinationFromText } from "../src/lib/ai/trip-planning-context.ts";

assert.equal(parseDestinationFromText("我想去蒙古"), "蒙古");

const mongoliaGuide = getDestinationStyleGuide("蒙古");
assert.ok(!mongoliaGuide.styleOptions.includes("動漫購物"));
assert.ok(mongoliaGuide.hotRoutes.includes("烏蘭巴托"));
assert.ok(mongoliaGuide.hotRoutes.includes("戈壁沙漠"));

const mongoliaQuestion = buildDestinationStyleChoiceQuestion("蒙古");
assert.match(mongoliaQuestion, /自然景觀草原/);
assert.doesNotMatch(mongoliaQuestion, /動漫購物/);

const clarify = buildDestinationPlanningClarify(
  { interests: [], destination: "蒙古" },
  { travelContext: { interests: [], destination: "蒙古" }, tripPlanningContext: { destination: "蒙古", intent: "destination_planning" } },
  "vibe",
);
assert.doesNotMatch(clarify, /動漫購物/);

const sessionAfterAsk = {
  travelContext: { interests: [], destination: "蒙古", destinationCountry: "蒙古" },
  tripPlanningContext: { destination: "蒙古", intent: "destination_planning" },
  conversationMode: "destination_planning",
  pendingQuestion: pendingQuestionForDestinationStyleChoice("蒙古", "蒙古"),
};

const selected = parsePendingOptionSelection("都可以", sessionAfterAsk.pendingQuestion);
assert.equal(selected, USE_DEFAULT_ROUTES);

const next = buildNextStepAfterAdviceSelection(
  USE_DEFAULT_ROUTES,
  sessionAfterAsk.pendingQuestion,
  { interests: [], destination: "蒙古", destinationCountry: "蒙古" },
);
assert.match(next.reply, /如果都可以，我會先用蒙古經典熱門路線/);
assert.match(next.reply, /烏蘭巴托/);
assert.match(next.reply, /戈壁沙漠/);
assert.match(next.reply, /幾天/);
assert.doesNotMatch(next.reply, /我先用目前掌握的需求/);

const advice = resolveDestinationAdvice(
  { interests: [], destination: "蒙古", destinationCountry: "蒙古" },
  sessionAfterAsk,
  "都可以",
);
assert.ok(advice.reply);
assert.match(advice.reply, /蒙古/);
assert.doesNotMatch(advice.reply, /我先用目前掌握的需求/);
assert.equal(advice.contextPatch?.useDefaultRecommendation, true);

const merged = mergeTravelContext(sessionAfterAsk, "都可以");
const route = resolveChatRoute(
  "都可以",
  merged.context,
  merged.session,
  "zh-TW",
  "general",
);
assert.equal(route.mode, "advice");
assert.match(route.question ?? "", /蒙古/);

const recoverySession = {
  travelContext: { interests: [], destination: "蒙古" },
  tripPlanningContext: { destination: "蒙古", intent: "destination_planning" },
  conversationMode: "destination_planning",
  askedClarifyKeys: ["vibe"],
};
const recoveryAdvice = resolveDestinationAdvice(
  { interests: [], destination: "蒙古" },
  recoverySession,
  "都可以",
);
assert.ok(recoveryAdvice.reply);
assert.match(recoveryAdvice.reply, /熱門路線/);
assert.doesNotMatch(recoveryAdvice.reply, /我先用目前掌握的需求/);

const defaultRoutes = buildDefaultRoutesReply("蒙古");
assert.match(defaultRoutes.reply, /特勒吉國家公園/);

console.log("verify-mongolia-pending-question: ok");
