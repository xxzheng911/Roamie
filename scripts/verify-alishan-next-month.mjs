import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
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

const text = "下個月想去阿里山";
const session = createEmptySession();
const merged = mergeTravelContext(session, text);
const ctx = merged.context;

assert(parseDestinationFromText(text) === "阿里山", "parses 阿里山");
assert(!isDestinationAdviceText(text), "not season advice text");
assert(detectChatIntent(text) === "trip_planning", "intent is trip_planning");
assert(ctx.destination === "阿里山", "ctx.destination is 阿里山");
assert(Boolean(ctx.travelMonth), "ctx.travelMonth is set");

const advice = resolveDestinationAdvice(ctx, session, text);
assert(Boolean(advice.reply), "has reply");
assert(advice.reply.includes("阿里山"), "reply mentions 阿里山");
assert(advice.reply.includes("下個月"), "reply mentions 下個月");
assert(!advice.reply.includes("櫻花"), "no cherry season when month specified");
assert(!advice.reply.includes("楓紅"), "no maple season when month specified");
assert(
  advice.reply.includes("先看必去景點") || advice.reply.includes("直接排"),
  "asks must-visit vs itinerary",
);
assert(advice.pendingQuestion?.type === "activity_choice", "pending activity choice");

// Regression: 台北明天
const taipei = "我明天要去台北有推薦景點嗎";
const taipeiMerged = mergeTravelContext(createEmptySession(), taipei);
assert(parseDestinationFromText(taipei) === "台北", "台北 still parses");
assert(detectChatIntent(taipei) === "destination_advice", "台北 intent destination_advice");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll alishan next-month checks passed");
