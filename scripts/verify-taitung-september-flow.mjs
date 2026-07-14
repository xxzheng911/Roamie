/**
 * Verify: 台東 9 月 → 季節建議 → 3 天 → 組合 → 1、2、3 → 觸發行程生成
 */
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { applyAdviceResultToSession } from "../src/lib/ai/destination-advice.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

function planningTurn(text, session) {
  const merged = mergeTravelContext(session, text);
  const intent = detectChatIntent(text);
  const nextSession = {
    ...merged.session,
    activeChatIntent:
      intent === "destination_advice" ? "destination_advice" : merged.session.activeChatIntent,
    conversationMode:
      intent === "destination_advice" ? "destination_planning" : merged.session.conversationMode,
  };
  const route = resolveChatRoute(text, merged.context, nextSession, "zh-TW", intent);
  const turn = processAdviceTurn(text, nextSession, merged.context);
  const persisted = applyAdviceResultToSession(
    {
      ...turn.session,
      pendingQuestion: turn.route?.pendingQuestion ?? turn.advice?.pendingQuestion ?? route.pendingQuestion,
      lastResolvedPendingQuestion: undefined,
      adviceSelectionThisTurn: undefined,
    },
    turn.advice,
  );
  return { route, turn, merged, session: persisted, advice: turn.advice };
}

console.log("=== 台東 9 月 3 天 組合流程 ===\n");

let session = createEmptySession();
let t1 = planningTurn("我 9 月想去台東", session);
assert(Boolean(t1.advice.reply), "turn1 has reply");
assert(
  /炎熱|雷陣雨|颱風|中下旬|氣候|天氣/.test(t1.advice.reply ?? ""),
  "turn1 mentions climate/season",
);
assert(
  !/一日遊|2天1夜|預計去.?玩幾天/.test(t1.advice.reply ?? ""),
  "turn1 does NOT only ask days list",
);
assert(
  /日期或天數|旅行日期|天數/.test(t1.advice.reply ?? ""),
  "turn1 asks for date or days",
);
assert(t1.session.pendingQuestion?.type === "ask_days", "turn1 pending ask_days");
assert(
  t1.session.travelContext?.tripPurpose === "travel_window_suggested" ||
    t1.merged.context.travelMonth,
  "turn1 month/window saved",
);
assert(
  /9\s*月/.test(t1.merged.context.travelMonth ?? "") ||
    t1.session.travelContext?.travelMonth,
  "turn1 travelMonth parsed",
);

session = t1.session;
let t2 = planningTurn("3天", session);
assert(Boolean(t2.advice.reply), "turn2 has reply");
assert(
  /海岸公路|市區文化|縱谷/.test(t2.advice.reply ?? ""),
  "turn2 shows combinations",
);
assert(
  !/出發：2026-09(?!\d)/.test(t2.advice.reply ?? ""),
  "turn2 no incomplete 出發：2026-09",
);
assert(
  t2.session.pendingQuestion?.type === "combination_choice",
  `turn2 pending combination_choice (got ${t2.session.pendingQuestion?.type})`,
);
assert(
  (t2.merged.context.days ?? t2.session.travelContext?.days) === 3 ||
    t2.session.tripDays === 3,
  "turn2 days=3",
);

session = t2.session;
let t3 = planningTurn("1、2、3", session);
assert(Boolean(t3.advice.reply), "turn3 has reply");
assert(
  !/以下是台東的建議組合/.test(t3.advice.reply ?? ""),
  "turn3 does NOT re-list combinations",
);
assert(
  /海岸|市區|縱谷|正在確認|安排/.test(t3.advice.reply ?? ""),
  "turn3 acknowledges selection / generating",
);
assert(
  t3.advice.triggerItineraryGeneration === true,
  "turn3 triggers itinerary generation",
);
assert(
  !t3.session.pendingQuestion || t3.advice.pendingQuestion == null,
  "turn3 clears combination pending",
);

console.log("\n=== Summary ===");
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("All Taitung September flow checks passed.");
