import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { parseTripPreferences } from "../src/lib/ai/trip-preference.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { parseDestinationFromText } from "../src/lib/ai/trip-planning-context.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { isFlexiblePreferenceReply } from "../src/lib/ai/destination-pending-question.ts";

let failed = 0;

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
    activeChatIntent: intent === "destination_advice" ? "destination_advice" : merged.session.activeChatIntent,
    conversationMode:
      intent === "destination_advice" ? "destination_planning" : merged.session.conversationMode,
  };
  return resolveChatRoute(text, merged.context, nextSession, "zh-TW", intent);
}

// 1. Thailand → city → days
let session = createEmptySession();
let route = adviceRoute("我想去泰國", session);
session = {
  ...session,
  activeChatIntent: "destination_advice",
  travelContext: mergeTravelContext(session, "我想去泰國").context,
  pendingQuestion: route.pendingQuestion,
};
const cityRoute = adviceRoute("城市", session);
assert(cityRoute.question?.includes("曼谷"), "case1 city recommends Bangkok");
assert(!cityRoute.question?.includes("好，泰國很適合"), "case1 city does not repeat Thailand intro");

// 2. Korea season → Busan
session = createEmptySession();
route = adviceRoute("韓國幾月去比較好", session);
assert(route.question?.includes("首爾"), "case2 korea season asks regions");
session = {
  ...createEmptySession(),
  activeChatIntent: "destination_advice",
  travelContext: mergeTravelContext(createEmptySession(), "韓國幾月去比較好").context,
  pendingQuestion: route.pendingQuestion,
};
const busanRoute = adviceRoute("釜山", session);
assert(busanRoute.question?.includes("釜山"), "case2 busan extends Busan");
assert(!busanRoute.question?.includes("4～5 月或 10～11 月"), "case2 busan does not repeat korea months");

// 2b. Busan → 都可以
session = {
  ...createEmptySession(),
  activeChatIntent: "destination_advice",
  travelContext: {
    interests: [],
    destination: "釜山",
    destinationCountry: "韓國",
    tripPurpose: "region_selected",
  },
  pendingQuestion: {
    type: "city_style_choice",
    options: ["海邊放鬆", "美食", "城市散策"],
    baseDestination: "釜山",
    destinationCountry: "韓國",
  },
};
const flexRoute = adviceRoute("都可以", session);
assert(flexRoute.mode === "advice", "case2b flexible stays advice");
assert(flexRoute.question?.includes("幾天"), "case2b flexible advances to days");
assert(
  !flexRoute.question?.includes("城市探索、美食，還是海島放鬆"),
  "case2b flexible does not repeat wrong question",
);

// 3. Bangkok 5 days → must visit
session = createEmptySession();
const bangkok5 = mergeTravelContext(session, "曼谷5天");
assert(bangkok5.context.destination === "曼谷", "case3 parses bangkok");
assert(bangkok5.context.days === 5, "case3 parses 5 days");
const mustVisitRoute = adviceRoute("必去點有哪些", {
  ...bangkok5.session,
  activeChatIntent: "destination_advice",
  travelContext: bangkok5.context,
});
assert(mustVisitRoute.question?.includes("大皇宮"), "case3 lists bangkok must visit");

// 4. Interests → itinerary
session = {
  ...createEmptySession(),
  activeChatIntent: "destination_advice",
  travelContext: {
    interests: [],
    destination: "曼谷",
    destinationCountry: "泰國",
    days: 5,
    mustVisitGenerated: true,
  },
};
const prefRoute = adviceRoute("景點跟購物", session);
assert(prefRoute.question?.includes("Day1"), "case4 starts itinerary planning");
assert(
  !prefRoute.question?.includes("我先用目前掌握的需求"),
  "case4 no fallback",
);

// 5. Budget preference parsing
assert(isFlexiblePreferenceReply("都可以"), "flexible reply detected");
assert(parseDestinationFromText("曼谷5天") === "曼谷", "inline destination parse");

// Multi preference
assert(
  JSON.stringify(parseTripPreferences("景點+購物+美食")) ===
    JSON.stringify(["attractions", "shopping", "food"]),
  "multi preference parse",
);

if (failed > 0) process.exit(1);
console.log("\nAll chat state machine checks passed.");
