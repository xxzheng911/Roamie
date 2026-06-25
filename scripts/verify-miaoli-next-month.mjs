import { mergeTravelContext, isValidContextValue } from "../src/lib/ai/travel-context.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { applyTripIntentToSession } from "../src/lib/recommendation/trip-intent.ts";
import {
  parseDestinationFromText,
  isDestinationAdviceText,
} from "../src/lib/ai/trip-planning-context.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

const text = "我下個月要去苗栗";
const session = createEmptySession();
const withIntent = applyTripIntentToSession(text, session);
const merged = mergeTravelContext(withIntent, text);
const ctx = merged.context;

assert(parseDestinationFromText(text) === "苗栗", "parses 苗栗 from text");
assert(!isDestinationAdviceText(text), "not season advice text");
assert(detectChatIntent(text) === "trip_planning", "intent is trip_planning");
assert(ctx.destination === "苗栗", "ctx.destination is 苗栗");
assert(isValidContextValue(ctx.destination), "destination is valid context value");
assert(Boolean(ctx.travelMonth), "ctx.travelMonth is set");
assert(/\d+月/.test(ctx.travelMonth ?? ""), "travelMonth is numeric month label");

const advice = resolveDestinationAdvice(ctx, withIntent, text);
assert(Boolean(advice.reply), "has advice reply");
assert(advice.reply.includes("苗栗"), "reply mentions 苗栗");
assert(advice.reply.includes("下個月"), "reply mentions 下個月");
assert(
  advice.reply.includes("天氣") && advice.reply.includes("節奏"),
  "reply covers weather and pacing",
);
assert(
  advice.reply.includes("必去景點") || advice.reply.includes("排"),
  "asks must-visit vs itinerary",
);
assert(advice.pendingQuestion?.type === "activity_choice", "pending activity choice");

// Second merge must not wipe destination with empty parse
const remerged = mergeTravelContext(merged.session, "都可以");
assert(remerged.context.destination === "苗栗", "destination retained after follow-up merge");

// Regression: 阿里山 still works
const alishan = "下個月想去阿里山";
const alishanMerged = mergeTravelContext(createEmptySession(), alishan);
assert(alishanMerged.context.destination === "阿里山", "阿里山 destination preserved");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll miaoli next-month checks passed");
