/**
 * Verify Taoyuan September flow:
 * 1) month+destination → natural climate + ask date/days
 * 2) exact date range → combinations (not legacy trip summary / direct-or-recommend)
 */
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { applyAdviceResultToSession } from "../src/lib/ai/destination-advice.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { buildScenicMonthPlanningResult } from "../src/lib/ai/scenic-month-reply.ts";
import { getDestinationCombinations } from "../src/lib/ai/destination-combination-suggestions.ts";

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

console.log("=== 桃園 9 月 → 日期 → 組合 ===\n");

const unit = buildScenicMonthPlanningResult({
  destination: "桃園",
  context: { interests: [], destination: "桃園", travelMonth: "9月" },
  userText: "我 9 月要去桃園",
});
assert(/偏熱|雷陣雨|早上或傍晚|雨具/.test(unit.reply), "unit climate is concrete");
assert(!/氣候較適合安排步行與一日區域動線|抓比較舒服的時段|上旬、下旬也都可以|看你行程彈性|當年度天氣略有差異/.test(unit.reply), "unit has no stiff fillers");
assert(/你目前有預計的旅行日期或天數嗎？/.test(unit.reply), "unit ends with date/days ask");
assert(!/金針|楓葉|櫻花|雪祭/.test(unit.reply), "unit does not invent festivals for Taoyuan");

assert(getDestinationCombinations("桃園").length >= 3, "桃園 has curated combinations");

let session = createEmptySession();
let t1 = planningTurn("我 9 月要去桃園", session);
console.log("\n--- turn1 reply ---\n", t1.advice.reply, "\n");
assert(Boolean(t1.advice.reply), "turn1 has reply");
assert(/偏熱|雷陣雨|早上或傍晚|雨具/.test(t1.advice.reply ?? ""), "turn1 natural climate");
assert(
  !/氣候較適合安排步行與一日區域動線|抓比較舒服的時段|上旬、下旬也都可以|看你行程彈性/.test(
    t1.advice.reply ?? "",
  ),
  "turn1 no stiff fillers",
);
assert(/你目前有預計的旅行日期或天數嗎？/.test(t1.advice.reply ?? ""), "turn1 asks date or days");
assert(t1.session.pendingQuestion?.type === "ask_days", "turn1 pending ask_days");

session = t1.session;
let t2 = planningTurn("可能是 9/6～9/9", session);
console.log("\n--- turn2 reply ---\n", t2.advice.reply, "\n");
assert(Boolean(t2.advice.reply), "turn2 has reply");
assert(
  (t2.merged.context.startDate ?? t2.session.travelContext?.startDate ?? t2.session.tripStartDate) ===
    "2026-09-06",
  "turn2 startDate=2026-09-06",
);
assert(
  (t2.merged.context.endDate ?? t2.session.travelContext?.endDate ?? t2.session.tripEndDate) ===
    "2026-09-09",
  "turn2 endDate=2026-09-09",
);
assert(
  (t2.merged.context.days ?? t2.session.travelContext?.days ?? t2.session.tripDays) === 4,
  "turn2 tripDays=4",
);
assert(
  /城市文化|老街美食|親子休閒|山區自然|組合/.test(t2.advice.reply ?? ""),
  "turn2 shows Taoyuan combinations",
);
assert(/旅行日期：2026\/09\/06～2026\/09\/09/.test(t2.advice.reply ?? ""), "turn2 full date range");
assert(/回覆你比較有興趣的組合/.test(t2.advice.reply ?? ""), "turn2 combination CTA");
assert(
  !/這幾天.*適合散步|可以安排：|早上.*經典地標|你想直接排完整行程|先推薦必去景點|好，我先記下：/.test(
    t2.advice.reply ?? "",
  ),
  "turn2 no legacy trip summary",
);
assert(
  t2.session.pendingQuestion?.type === "combination_choice",
  `turn2 pending combination_choice (got ${t2.session.pendingQuestion?.type})`,
);
assert(
  t2.session.travelContext?.tripPurpose === "combination_suggestions_offered" ||
    t2.advice.contextPatch?.tripPurpose === "combination_suggestions_offered",
  "turn2 tripPurpose=combination_suggestions_offered",
);

console.log("\n=== Summary ===");
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("All Taoyuan September flow checks passed.");
