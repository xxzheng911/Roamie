import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveChatRoute } from "../src/lib/ai/chat-router.ts";
import {
  isDestinationAdviceText,
  isDestinationSelectionText,
  parseDestinationFromText,
} from "../src/lib/ai/trip-planning-context.ts";
import { inferPendingQuestionFromAdviceReply } from "../src/lib/ai/destination-pending-question.ts";
import { parseMustVisitPlacesIntent } from "../src/lib/ai/must-visit-places.ts";
import { parseTripPreferences } from "../src/lib/ai/trip-preference.ts";
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
  routeThaiGo.question?.includes("城市、美食按摩，還是海島放鬆"),
  "Thailand selection asks trip style",
);
assert(
  routeThaiGo.pendingQuestion?.type === "trip_style_choice",
  "Thailand selection stores pending trip style options",
);
assert(
  JSON.stringify(routeThaiGo.pendingQuestion?.options) ===
    JSON.stringify(["城市", "美食按摩", "海島放鬆"]),
  "Thailand pending options are city/food/island",
);
assert(
  !routeThaiGo.question?.includes("我先用目前掌握的需求"),
  "Thailand selection is not generic fallback",
);

const afterThaiStylePrompt = {
  ...mergedThaiGo.session,
  activeChatIntent: "destination_advice",
  travelContext: mergedThaiGo.context,
  pendingQuestion:
    routeThaiGo.pendingQuestion ??
    inferPendingQuestionFromAdviceReply(
      routeThaiGo.question ?? "",
      mergedThaiGo.context,
      mergedThaiGo.session,
    ),
};

const cityTurn = mergeTravelContext(afterThaiStylePrompt, "城市");
assert(cityTurn.context.destination === "曼谷", "city selection updates destination to Bangkok");
assert(cityTurn.context.destinationCountry === "泰國", "city selection keeps Thailand country");
assert(
  JSON.stringify(cityTurn.context.destinationCities) === JSON.stringify(["曼谷"]),
  "city selection sets Bangkok as suggested city",
);
assert(cityTurn.context.selectedTripStyle === "城市", "city selection sets trip style");
assert(cityTurn.context.tripPurpose === "trip_style_selected", "city selection sets trip purpose");
assert(cityTurn.session.adviceSelectionThisTurn === "城市", "city marks selection this turn");
assert(!cityTurn.session.pendingQuestion, "pending question cleared after city selection");

const routeCity = resolveChatRoute(
  "城市",
  cityTurn.context,
  cityTurn.session,
  "zh-TW",
  "destination_advice",
);
assert(routeCity.mode === "advice", "city follow-up stays advice");
assert(routeCity.question?.includes("曼谷"), "city follow-up recommends Bangkok");
assert(routeCity.question?.includes("幾天"), "city follow-up asks about duration");
assert(
  !routeCity.question?.includes("好，泰國很適合想放鬆又有城市探索的人"),
  "city follow-up does not repeat Thailand country intro",
);
assert(
  !routeCity.question?.includes("城市、美食按摩，還是海島放鬆"),
  "city follow-up does not repeat style question",
);

const islandTurn = mergeTravelContext(afterThaiStylePrompt, "海島");
assert(islandTurn.context.destination === "普吉島", "island selection updates destination");
assert(islandTurn.context.selectedTripStyle === "海島放鬆", "island normalizes to 海島放鬆");
const routeIsland = resolveChatRoute(
  "海島",
  islandTurn.context,
  islandTurn.session,
  "zh-TW",
  "destination_advice",
);
assert(routeIsland.mode === "advice", "island follow-up stays advice");
assert(routeIsland.question?.includes("普吉"), "island follow-up mentions Phuket");
assert(
  !routeIsland.question?.includes("好，泰國很適合想放鬆又有城市探索的人"),
  "island follow-up does not repeat Thailand intro",
);

const foodTurn = mergeTravelContext(afterThaiStylePrompt, "美食按摩");
assert(foodTurn.context.destination === "曼谷", "food/massage selection keeps Bangkok");
const routeFood = resolveChatRoute(
  "美食按摩",
  foodTurn.context,
  foodTurn.session,
  "zh-TW",
  "destination_advice",
);
assert(routeFood.mode === "advice", "food/massage follow-up stays advice");
assert(routeFood.question?.includes("美食"), "food/massage follow-up mentions food");
assert(
  !routeFood.question?.includes("好，泰國很適合想放鬆又有城市探索的人"),
  "food/massage follow-up does not repeat Thailand intro",
);

const bangkokSession = {
  ...createEmptySession(),
  activeChatIntent: "destination_advice",
  travelContext: {
    interests: [],
    destination: "曼谷",
    destinationCountry: "泰國",
    days: 5,
    tripPurpose: "duration_selected",
  },
};

assert(parseMustVisitPlacesIntent("必去點有哪些"), "parses must visit places intent");
assert(parseMustVisitPlacesIntent("推薦景點"), "parses recommend attractions intent");
assert(parseMustVisitPlacesIntent("先列必去點"), "parses list must visit intent");
assert(!parseMustVisitPlacesIntent("5天"), "day count is not must visit intent");

const afterBangkokDays = {
  ...bangkokSession,
  pendingQuestion: {
    type: "activity_choice",
    options: ["must_visit_places", "daily_rhythm"],
    baseDestination: "曼谷",
    destinationCountry: "泰國",
  },
};

const mustVisitTurn = mergeTravelContext(afterBangkokDays, "必去點有哪些");
assert(mustVisitTurn.context.tripPurpose === "must_visit_places", "must visit sets trip purpose");
assert(mustVisitTurn.session.adviceSelectionThisTurn === "must_visit_places", "must visit marks selection");
assert(!mustVisitTurn.session.pendingQuestion, "must visit clears pending question");

const routeMustVisit = resolveChatRoute(
  "必去點有哪些",
  mustVisitTurn.context,
  mustVisitTurn.session,
  "zh-TW",
  "destination_advice",
);
assert(routeMustVisit.mode === "advice", "must visit follow-up stays advice");
assert(routeMustVisit.question?.includes("大皇宮"), "must visit lists Grand Palace");
assert(routeMustVisit.question?.includes("鄭王廟"), "must visit lists Wat Arun");
assert(routeMustVisit.question?.includes("5 天"), "must visit reply considers 5 days");
assert(
  !routeMustVisit.question?.includes("我先用目前掌握的需求"),
  "must visit does not use generic fallback",
);
assert(
  !routeMustVisit.question?.includes("先定總天數節奏，還是先列出必去點"),
  "must visit does not repeat planning question",
);

const mustVisitWithoutPending = resolveChatRoute(
  "必去點有哪些",
  bangkokSession.travelContext,
  bangkokSession,
  "zh-TW",
  "destination_advice",
);
assert(mustVisitWithoutPending.mode === "advice", "must visit without pending still advice");
assert(mustVisitWithoutPending.question?.includes("曼谷"), "must visit without pending uses Bangkok");

const daysPromptSession = {
  ...createEmptySession(),
  activeChatIntent: "destination_advice",
  travelContext: {
    interests: [],
    destination: "曼谷",
    destinationCountry: "泰國",
    tripPurpose: "trip_style_selected",
  },
  pendingQuestion: {
    type: "duration_choice",
    options: ["4 天", "5 天", "6 天"],
    baseDestination: "曼谷",
    destinationCountry: "泰國",
  },
};

const fiveDayTurn = mergeTravelContext(daysPromptSession, "5天");
assert(fiveDayTurn.context.days === 5, "parses 5 days from reply");
const routeFiveDays = resolveChatRoute(
  "5天",
  fiveDayTurn.context,
  fiveDayTurn.session,
  "zh-TW",
  "destination_advice",
);
assert(routeFiveDays.mode === "advice", "5-day follow-up stays advice");
assert(
  routeFiveDays.question?.includes("先定總天數節奏，還是先列出必去點"),
  "5-day follow-up asks rhythm or must visit",
);
assert(
  routeFiveDays.pendingQuestion?.type === "activity_choice",
  "5-day follow-up stores planning pending question",
);

const bangkokMustVisitSession = {
  ...createEmptySession(),
  activeChatIntent: "destination_advice",
  travelContext: {
    interests: [],
    destination: "曼谷",
    destinationCountry: "泰國",
    days: 5,
    mustVisitGenerated: true,
    tripPurpose: "must_visit_places",
  },
  pendingQuestion: {
    type: "preference_choice",
    options: ["attractions", "shopping", "food", "night_market"],
    baseDestination: "曼谷",
    destinationCountry: "泰國",
  },
};

assert(
  JSON.stringify(parseTripPreferences("景點跟購物")) === JSON.stringify(["attractions", "shopping"]),
  "parses attractions + shopping preferences",
);
assert(
  JSON.stringify(parseTripPreferences("景點+購物")) === JSON.stringify(["attractions", "shopping"]),
  "parses attractions + shopping with plus sign",
);
assert(
  JSON.stringify(parseTripPreferences("文化景點跟購物")) === JSON.stringify(["attractions", "shopping"]),
  "parses culture attractions + shopping",
);
assert(
  JSON.stringify(parseTripPreferences("景點+購物+美食")) ===
    JSON.stringify(["attractions", "shopping", "food"]),
  "parses triple preference selection",
);

const preferenceTurn = mergeTravelContext(bangkokMustVisitSession, "景點跟購物");
assert(
  JSON.stringify(preferenceTurn.context.selectedInterests) ===
    JSON.stringify(["attractions", "shopping"]),
  "preference turn stores selected interests",
);
assert(
  preferenceTurn.context.conversationState === "ready_for_itinerary",
  "preference turn switches to ready_for_itinerary",
);
assert(
  preferenceTurn.context.tripPurpose === "ready_for_itinerary",
  "preference turn sets ready_for_itinerary purpose",
);
assert(!preferenceTurn.session.pendingQuestion, "preference turn clears pending question");

const routePreference = resolveChatRoute(
  "景點跟購物",
  preferenceTurn.context,
  preferenceTurn.session,
  "zh-TW",
  "destination_advice",
);
assert(routePreference.mode === "advice", "preference follow-up stays advice");
assert(routePreference.question?.includes("曼谷 5 天"), "preference reply uses Bangkok 5 days");
assert(routePreference.question?.includes("Day1"), "preference reply includes day plan");
assert(routePreference.question?.includes("大皇宮"), "preference reply includes Grand Palace");
assert(routePreference.question?.includes("ICONSIAM"), "preference reply includes shopping");
assert(
  !routePreference.question?.includes("我先用目前掌握的需求"),
  "preference reply does not fallback",
);
assert(
  !routePreference.question?.includes("我會先抓這些必去點"),
  "preference reply does not repeat must visit list",
);
assert(
  !routePreference.question?.includes("城市、美食按摩，還是海島放鬆"),
  "preference reply does not repeat Thailand style question",
);
assert(
  routePreference.contextPatch?.conversationState === "ready_for_itinerary",
  "preference route marks ready_for_itinerary",
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
