import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { applyAdviceResultToSession } from "../src/lib/ai/destination-advice.ts";

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
      pendingQuestion: turn.route?.pendingQuestion ?? route.pendingQuestion,
      lastResolvedPendingQuestion: undefined,
      adviceSelectionThisTurn: undefined,
    },
    turn.advice,
  );
  return { route, turn, merged, session: persisted };
}

// Test 1: Seoul → 5 days
let session = createEmptySession();
let t1 = planningTurn("我想去首爾", session);
assert(t1.turn.advice.reply?.includes("幾天"), "test1 turn1 asks days");
assert(t1.session.pendingQuestion?.type === "ask_days", "test1 pending ask_days");
let t2 = planningTurn("5天", t1.session);
assert(t2.merged.context.days === 5, "test1 days=5");
assert(!t2.turn.advice.reply?.includes("你這趟大概幾天"), "test1 no re-ask days");

// Test 2: Sydney → 6 days
session = createEmptySession();
t1 = planningTurn("我想去雪梨", session);
t2 = planningTurn("6天", t1.session);
assert(t2.merged.context.days === 6, "test2 days=6");
assert(!t2.turn.advice.reply?.includes("你這趟大概幾天"), "test2 no re-ask days");

// Test 3: Mongolia → 都可以
session = createEmptySession();
t1 = planningTurn("我想去蒙古", session);
assert(t1.turn.advice.reply?.includes("蒙古"), "test3 mongolia intro");
const mongoliaStyleSession = {
  ...t1.session,
  pendingQuestion: t1.session.pendingQuestion ?? {
    type: "destination_style_choice",
    options: ["自然景觀草原", "戈壁沙漠", "文化歷史", "蒙古包體驗"],
    baseDestination: "蒙古",
    destinationCountry: "蒙古",
  },
};
t2 = planningTurn("都可以", mongoliaStyleSession);
assert(
  t2.turn.advice.reply?.includes("幾天") ||
    t2.merged.context.useDefaultRecommendation ||
    t2.merged.context.tripPurpose === "destination_style_default",
  "test3 flexible advances",
);

// Test 4: Thailand → city → combo
session = createEmptySession();
t1 = planningTurn("我想去泰國", session);
assert(t1.session.pendingQuestion?.type === "region_choice", "test4 thailand region pending");
t2 = planningTurn("曼谷", t1.session);
assert(t2.merged.context.destination === "曼谷", "test4 city -> bangkok");
const pattayaSession = {
  ...t2.session,
  pendingQuestion: {
    type: "trip_style_choice",
    options: ["海灘放鬆", "跳島", "水上市場", "曼谷＋芭達雅"],
    baseDestination: "芭達雅",
    destinationCountry: "泰國",
  },
};
const comboTurn = planningTurn("曼谷+芭達雅", pattayaSession);
assert(
  comboTurn.merged.context.destination?.includes("芭達雅") ||
    comboTurn.merged.context.destinationCities?.some((city) => city.includes("芭達雅")),
  "test4 combo route",
);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}

// Test 5: date range → skip ask_days, ask trip style
session = createEmptySession();
const dateRangeTurn = planningTurn("我 9/1～9/4 要去台北", session);
assert(dateRangeTurn.turn.advice.reply?.includes("想怎麼安排"), "test5 asks trip style");
assert(dateRangeTurn.session.pendingQuestion?.type === "ask_trip_style", "test5 pending ask_trip_style");
assert(!dateRangeTurn.turn.advice.reply?.includes("玩幾天"), "test5 no ask days");
assert(dateRangeTurn.merged.context.days === 4, "test5 merged days=4");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll planning state machine acceptance checks passed.");
