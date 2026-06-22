import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import {
  isDestinationAdviceText,
  isDestinationSelectionText,
  parseDestinationFromText,
} from "../src/lib/ai/trip-planning-context.ts";
import { inferPendingQuestionFromAdviceReply } from "../src/lib/ai/destination-pending-question.ts";
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

const thailandQ = "泰國幾月去比較好";
assert(isDestinationAdviceText(thailandQ), "detect destination advice text for Thailand season");
assert(parseDestinationFromText(thailandQ) === "泰國", "parse 泰國 from season question");
assert(parseDestinationFromText(thailandQ) !== "比較好", "do not parse 比較好 as destination");
assert(detectChatIntent(thailandQ) === "destination_advice", "intent is destination_advice");

const session = createEmptySession();
const merged1 = mergeTravelContext(session, thailandQ);
assert(merged1.context.destination === "泰國", "travel context destination is 泰國");
assert(
  merged1.context.tripPurpose === "best_time_to_visit",
  "tripPurpose is best_time_to_visit",
);

const route1 = resolveChatRoute(thailandQ, merged1.context, merged1.session, "zh-TW", "destination_advice");
assert(route1.mode === "advice", "route mode is advice for Thailand season question");
assert(route1.question?.includes("11 月"), "Thailand advice mentions dry season months");
assert(route1.question?.includes("曼谷"), "Thailand advice asks about regions");

const japanQ = "日本11月適合去哪";
assert(parseDestinationFromText(japanQ) === "日本", "parse 日本 from month suitability question");
assert(detectChatIntent(japanQ) === "destination_advice", "Japan month question is destination_advice");
const mergedJapan = mergeTravelContext(session, japanQ);
const routeJapan = resolveChatRoute(
  japanQ,
  mergedJapan.context,
  mergedJapan.session,
  "zh-TW",
  "destination_advice",
);
assert(routeJapan.mode === "advice", "Japan month route is advice");
assert(routeJapan.question?.includes("11"), "Japan advice mentions month");

const tokyoQ = "東京五天怎麼排";
assert(parseDestinationFromText(tokyoQ) === "東京", "parse 東京 from 5-day planning");
assert(
  detectChatIntent(tokyoQ) === "destination_advice" || detectChatIntent(tokyoQ) === "trip_planning",
  "Tokyo itinerary question is planning-related",
);

const afterAdvice = {
  ...merged1.session,
  activeChatIntent: "destination_advice",
  travelContext: merged1.context,
  tripPlanningContext: {
    destination: "泰國",
    selectedPlaces: [],
    intent: "destination_planning",
  },
};
const flexible = mergeTravelContext(afterAdvice, "都可以");
assert(flexible.context.destination === "泰國", "都可以 keeps Thailand destination");
assert(flexible.context.mood !== "混合", "都可以 does not become mixed mood");
assert(flexible.context.vibe !== "混合", "都可以 does not become mixed vibe");

const afterThailand = {
  ...createEmptySession(),
  activeChatIntent: "destination_advice",
  travelContext: {
    interests: [],
    destination: "泰國",
    destinationCountry: "泰國",
    tripPurpose: "best_time_to_visit",
  },
};

const pattayaTurn = mergeTravelContext(afterThailand, "我想去芭達雅");
assert(pattayaTurn.context.destination === "芭達雅", "updates destination to Pattaya");
assert(pattayaTurn.context.destinationCountry === "泰國", "keeps Thailand as country");
assert(parseDestinationFromText("我想去芭達雅") === "芭達雅", "parses Pattaya from want-go phrase");

const routePattaya = resolveChatRoute(
  "我想去芭達雅",
  pattayaTurn.context,
  pattayaTurn.session,
  "zh-TW",
  "destination_advice",
);
assert(routePattaya.mode === "advice", "Pattaya follow-up stays advice mode");
assert(routePattaya.question?.includes("芭達雅"), "Pattaya reply mentions Pattaya");
assert(!routePattaya.question?.includes("曼谷、清邁，還是海島"), "does not repeat country region question");
assert(
  routePattaya.question?.includes("海灘") || routePattaya.question?.includes("跳島"),
  "Pattaya reply asks about activities",
);
assert(routePattaya.pendingQuestion?.type === "trip_style_choice", "Pattaya reply stores pending options");

const afterPattayaPrompt = {
  ...pattayaTurn.session,
  activeChatIntent: "destination_advice",
  travelContext: pattayaTurn.context,
  pendingQuestion:
    routePattaya.pendingQuestion ??
    inferPendingQuestionFromAdviceReply(routePattaya.question ?? "", pattayaTurn.context, pattayaTurn.session),
};

const comboTurn = mergeTravelContext(afterPattayaPrompt, "曼谷＋芭達雅好像不錯");
assert(comboTurn.context.destination === "曼谷＋芭達雅", "combo selection updates destination");
assert(comboTurn.context.destinationCountry === "泰國", "combo keeps Thailand country");
assert(
  JSON.stringify(comboTurn.context.destinationCities) === JSON.stringify(["曼谷", "芭達雅"]),
  "combo sets destination cities",
);
assert(comboTurn.context.tripPurpose === "route_combination_selected", "combo sets route purpose");
assert(comboTurn.context.selectedTripStyle === "曼谷＋芭達雅", "combo sets trip style");
assert(comboTurn.session.adviceSelectionThisTurn === "曼谷＋芭達雅", "combo marks selection this turn");
assert(!comboTurn.session.pendingQuestion, "pending question cleared after selection");

const routeCombo = resolveChatRoute(
  "曼谷＋芭達雅好像不錯",
  comboTurn.context,
  comboTurn.session,
  "zh-TW",
  "destination_advice",
);
assert(routeCombo.mode === "advice", "combo follow-up stays advice");
assert(routeCombo.question?.includes("5～6 天") || routeCombo.question?.includes("5~6 天"), "combo asks about duration");
assert(routeCombo.question?.includes("曼谷"), "combo reply mentions Bangkok segment");
assert(routeCombo.question?.includes("芭達雅"), "combo reply mentions Pattaya segment");
assert(
  !routeCombo.question?.includes("11 月到隔年 2 月"),
  "combo does not repeat Pattaya season intro",
);
assert(
  !routeCombo.question?.includes("海灘放鬆、跳島、水上市場，還是曼谷＋芭達雅"),
  "combo does not repeat style question",
);

const routeFlexible = resolveChatRoute(
  "都可以",
  flexible.context,
  { ...afterAdvice, travelContext: flexible.context },
  "zh-TW",
  "destination_advice",
);
assert(routeFlexible.mode === "advice", "都可以 in advice flow stays advice mode");
assert(routeFlexible.mode !== "recommend", "都可以 does not trigger nearby recommendation");

const koreaQ = "韓國你覺得幾月去比較好";
assert(isDestinationAdviceText(koreaQ), "Korea season question is advice text");
assert(parseDestinationFromText(koreaQ) === "韓國", "parse 韓國 from flexible season question");
const mergedKorea = mergeTravelContext(session, koreaQ);
assert(mergedKorea.context.destination === "韓國", "Korea destination in context");
const routeKorea = resolveChatRoute(
  koreaQ,
  mergedKorea.context,
  mergedKorea.session,
  "zh-TW",
  "destination_advice",
);
assert(routeKorea.mode === "advice", "Korea season route is advice");
assert(routeKorea.question?.includes("4"), "Korea advice mentions spring months");
assert(routeKorea.question?.includes("首爾"), "Korea advice asks about cities");
assert(
  !routeKorea.question?.includes("你想去哪個城市或地區"),
  "Korea season does not ask generic destination clarify",
);

const thailandGo = "我想去泰國";
assert(isDestinationSelectionText(thailandGo), "我想去泰國 is destination selection");
assert(parseDestinationFromText(thailandGo) === "泰國", "parse 泰國 from want-go");
assert(detectChatIntent(thailandGo) === "destination_advice", "want-go Thailand is destination_advice");
const mergedThaiGo = mergeTravelContext(session, thailandGo);
assert(
  mergedThaiGo.context.tripPurpose === "destination_selection",
  "tripPurpose is destination_selection",
);
const routeThaiGo = resolveChatRoute(
  thailandGo,
  mergedThaiGo.context,
  mergedThaiGo.session,
  "zh-TW",
  "destination_advice",
);
assert(routeThaiGo.mode === "advice", "want-go Thailand route is advice");
assert(routeThaiGo.question?.includes("曼谷"), "Thailand selection mentions Bangkok");
assert(routeThaiGo.question?.includes("清邁"), "Thailand selection mentions Chiang Mai");
assert(
  !routeThaiGo.question?.includes("我先用目前掌握的需求"),
  "Thailand selection is not generic fallback",
);

const japanSeasonQ = "日本幾月去比較好";
assert(parseDestinationFromText(japanSeasonQ) === "日本", "parse 日本 from season question");
const routeJapanSeason = resolveChatRoute(
  japanSeasonQ,
  mergeTravelContext(session, japanSeasonQ).context,
  session,
  "zh-TW",
  "destination_advice",
);
assert(routeJapanSeason.mode === "advice", "Japan season route is advice");
assert(routeJapanSeason.question?.includes("東京"), "Japan season asks about cities");

const afterKorea = {
  ...createEmptySession(),
  activeChatIntent: "destination_advice",
  travelContext: {
    interests: [],
    destination: "韓國",
    destinationCountry: "韓國",
    tripPurpose: "best_time_to_visit",
  },
};
const busanTurn = mergeTravelContext(afterKorea, "我想去釜山");
assert(busanTurn.context.destination === "釜山", "updates destination to Busan");
assert(busanTurn.context.destinationCountry === "韓國", "keeps Korea as country");
const routeBusan = resolveChatRoute(
  "我想去釜山",
  busanTurn.context,
  busanTurn.session,
  "zh-TW",
  "destination_advice",
);
assert(routeBusan.mode === "advice", "Busan follow-up stays advice mode");
assert(routeBusan.question?.includes("釜山"), "Busan reply mentions Busan");
assert(!routeBusan.question?.includes("4～5 月或 10～11 月"), "Busan does not repeat Korea country months");

const tokyoGo = "我想去東京";
const routeTokyo = resolveChatRoute(
  tokyoGo,
  mergeTravelContext(session, tokyoGo).context,
  session,
  "zh-TW",
  "destination_advice",
);
assert(routeTokyo.mode === "advice", "want-go Tokyo route is advice");
assert(routeTokyo.question?.includes("東京"), "Tokyo selection mentions Tokyo");

if (failed > 0) {
  process.exit(1);
}

console.log("\nAll destination advice intent checks passed.");
