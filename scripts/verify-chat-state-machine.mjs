import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { parseTripPreferences } from "../src/lib/ai/trip-preference.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { parseDestinationFromText } from "../src/lib/ai/trip-planning-context.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { isFlexiblePreferenceReply } from "../src/lib/ai/destination-pending-question.ts";
import {
  shouldFetchDestinationPlaces,
  mergeContextForPlaceFetch,
  isGenericTemplatePlaceName,
  buildNamedFallbackRecommendations,
} from "../src/lib/ai/must-visit-places.ts";
import { buildDestinationGeocodeQueries } from "../src/lib/ai/destination-geocode.ts";
import { resolveConversationStage } from "../src/lib/ai/conversation-stage.ts";
import { recommendationsForChatDisplay } from "../src/lib/chat-display-recommendations.ts";

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

// 6. 阿里山必去點 — 直接列出實際地點
const alishanCtx = mergeTravelContext(createEmptySession(), "阿里山必去點");
const alishanAdvice = resolveDestinationAdvice(
  alishanCtx.context,
  { ...alishanCtx.session, activeChatIntent: "destination_advice" },
  "阿里山必去點",
);
assert(alishanAdvice.reply?.includes("祝山觀日平台"), "case6 alishan lists zhushan");
assert(alishanAdvice.reply?.includes("姊妹潭"), "case6 alishan lists sister pond");
assert(
  !alishanAdvice.reply?.includes("你比較想"),
  "case6 alishan does not re-ask preference",
);
assert(
  (alishanAdvice.recommendations?.length ?? 0) >= 3,
  "case6 alishan has recommendation cards",
);

// 7. 下個月阿里山必去景點 — 不可再追問
const alishanMonthCtx = mergeTravelContext(
  createEmptySession(),
  "下個月想去阿里山，有哪些必去景點",
);
const alishanMonthAdvice = resolveDestinationAdvice(
  alishanMonthCtx.context,
  { ...alishanMonthCtx.session, activeChatIntent: "destination_advice" },
  "下個月想去阿里山，有哪些必去景點",
);
assert(alishanMonthAdvice.reply?.includes("阿里山森林遊樂區"), "case7 month query lists places");
assert(
  !alishanMonthAdvice.pendingQuestion,
  "case7 month query no pending re-ask",
);
assert(
  alishanMonthAdvice.contextPatch?.planningStage === "recommendations_generated",
  "case7 reaches recommendations_generated",
);

// 8. must-visit 應觸發 Places fetch gate
assert(
  shouldFetchDestinationPlaces("阿里山必去點", { interests: [] }),
  "case8 alishan must visit triggers place fetch",
);
assert(
  shouldFetchDestinationPlaces("下個月想去阿里山，有哪些必去景點", { interests: [] }),
  "case8b month must visit triggers place fetch",
);

// 9. 合併 session context 後仍能解析目的地
const mergedPlaceCtx = mergeContextForPlaceFetch(
  { interests: [], destination: "阿里山" },
  createEmptySession(),
);
assert(
  shouldFetchDestinationPlaces("有哪些必去景點", mergedPlaceCtx),
  "case9 context destination enables place fetch",
);

// 10. must-visit 對話階段允許顯示卡片
const mustVisitStage = resolveConversationStage(
  { ...createEmptySession(), phase: "discover" },
  "阿里山必去點",
);
assert(mustVisitStage === "recommend", "case10 must visit stage is recommend");
const mustVisitCards = recommendationsForChatDisplay(
  {
    ...createEmptySession(),
    travelContext: { interests: [], tripPurpose: "must_visit_places" },
  },
  "阿里山必去點",
  [{ name: "祝山觀日平台", placeName: "祝山觀日平台", type: "景點" }],
);
assert(mustVisitCards.length === 1, "case10 must visit cards not filtered");

// 11. 嘉義 geocode 查詢正規化
const chiayiQueries = buildDestinationGeocodeQueries("嘉義", "zh-TW");
assert(chiayiQueries.includes("嘉義市, 台灣"), "case11 chiayi city query");
assert(chiayiQueries.includes("Chiayi City, Taiwan"), "case11 chiayi english query");

// 12. 不可 render 泛用模板名稱
assert(isGenericTemplatePlaceName("嘉義經典地標", "嘉義"), "case12 generic template detected");
assert(!isGenericTemplatePlaceName("檜意森活村", "嘉義"), "case12 real place not generic");

// 13. 嘉義 named fallback 有真實地點
const chiayiFallback = buildNamedFallbackRecommendations("嘉義");
assert(chiayiFallback.length >= 3, "case13 chiayi named fallback");
assert(
  chiayiFallback.some((r) => r.name.includes("檜意森活村")),
  "case13 chiayi has hinoki village",
);
assert(
  chiayiFallback.every((r) => r.reasonSource === "fallback"),
  "case13 fallback source marked",
);

if (failed > 0) process.exit(1);
console.log("\nAll chat state machine checks passed.");
