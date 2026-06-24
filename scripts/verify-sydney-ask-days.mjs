import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { parseAskDaysFromText } from "../src/lib/ai/destination-pending-question.ts";
import { applyAdviceResultToSession } from "../src/lib/ai/destination-advice.ts";

let failed = 0;
const logs = [];

const originalInfo = console.info;
console.info = (...args) => {
  logs.push(args.join(" "));
  originalInfo(...args);
};

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

function adviceRoute(text, session) {
  const merged = mergeTravelContext(session, text);
  const intent = detectChatIntent(text);
  const nextSession = {
    ...merged.session,
    activeChatIntent:
      intent === "destination_advice" ? "destination_advice" : merged.session.activeChatIntent,
    conversationMode:
      intent === "destination_advice" ? "destination_planning" : merged.session.conversationMode,
  };
  return {
    route: resolveChatRoute(text, merged.context, nextSession, "zh-TW", intent),
    merged,
    nextSession,
  };
}

// Day parsers
for (const [input, expected] of [
  ["6天", 6],
  ["六天", 6],
  ["5天", 5],
  ["七天", 7],
  ["8天", 8],
  ["十天", 10],
]) {
  assert(parseAskDaysFromText(input) === expected, `parse ${input} -> ${expected}`);
}

// Turn 1: 我想去雪梨
let session = createEmptySession();
const turn1 = adviceRoute("我想去雪梨", session);
assert(turn1.route.mode === "advice", "turn1 routes to advice");
assert(turn1.route.question?.includes("你這趟大概幾天"), "turn1 asks days");
assert(turn1.route.pendingQuestion?.type === "ask_days", "turn1 pending is ask_days");

session = applyAdviceResultToSession(
  {
    ...turn1.nextSession,
    activeChatIntent: "destination_advice",
    conversationMode: "destination_planning",
    pendingQuestion: turn1.route.pendingQuestion,
    travelContext: {
      ...turn1.merged.context,
      destination: "雪梨",
      tripPurpose: "destination_selection",
    },
  },
  { reply: turn1.route.question, contextPatch: turn1.route.contextPatch },
);

// Turn 2: 6天
logs.length = 0;
const turn2 = adviceRoute("6天", session);
assert(turn2.route.mode === "advice", "turn2 routes to advice");
assert(turn2.route.question?.includes("我先記下"), "turn2 acknowledges context");
assert(turn2.route.question?.includes("天數：6天"), "turn2 shows 6 days");
assert(turn2.route.question?.includes("邦代海灘"), "turn2 shows Sydney outline");
assert(turn2.route.question?.includes("A. 經典景點"), "turn2 asks preference");
assert(!turn2.route.question?.includes("你這趟大概幾天"), "turn2 does not re-ask days");
assert(turn2.route.pendingQuestion?.type === "ask_preference", "turn2 pending is ask_preference");
assert(
  logs.some((line) => line.includes("[CHAT_CONTEXT_UPDATE]") && line.includes("days=6")),
  "turn2 logs context update",
);
assert(logs.some((line) => line.includes("[CHAT_NEXT_STEP]") && line.includes("ask_preference")), "turn2 logs next step");

assert(turn2.merged.context.days === 6, "turn2 context days=6");
assert(turn2.merged.context.destination === "雪梨", "turn2 context destination=雪梨");

console.info = originalInfo;
if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll Sydney ask_days checks passed.");
