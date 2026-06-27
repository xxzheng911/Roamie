import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ChatMsg } from "@/lib/chat-history";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import {
  isDestinationAdviceText,
  isDestinationSelectionText,
  isKnownCountryLabel,
  isKnownDestinationLabel,
  isKnownScenicLabel,
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
  parseDestinationFromText,
  parseDestinationSelectionFromText,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";
import { isTripAddPlaceSession } from "@/lib/trip/trip-add-place-session";
import {
  inferPendingQuestionFromAdviceReply,
  isAskDaysPending,
  isFlexiblePreferenceReply,
  parseAskDaysFromText,
  parsePendingOptionSelection,
  pendingQuestionForTripPreference,
  pendingQuestionForDestinationStyleChoice,
  pendingQuestionForItineraryAction,
  pendingQuestionForPlanningNextStep,
  USE_DEFAULT_ROUTES,
  isItineraryNextStepPending,
  type PendingQuestion,
} from "@/lib/ai/destination-pending-question";
import { advanceAfterPendingSelection } from "@/lib/ai/chat-turn-engine";
import { logChatContextUpdate, logChatNextStep } from "@/lib/ai/chat-debug-log";
import {
  contextPatchForPreferenceSelection,
  shouldSkipAskingDays,
} from "@/lib/ai/chat-conversation-state";
import { buildCityDaysConfirmedReply } from "@/lib/ai/city-days-planning";
import { buildWeatherConstraintAcknowledgement } from "@/lib/ai/weather-planning-reply";
import { buildScenicMonthPlanningReply } from "@/lib/ai/scenic-month-reply";
import {
  hasUserSpecifiedTravelMonth,
  isBestSeasonQuestion,
} from "@/lib/ai/season-response-guardrail";
import { isBestTravelTimeIntent } from "@/lib/ai/best-travel-time-intent";
import { buildBestTravelTimeReply } from "@/lib/ai/destination-season-reply";
import {
  buildCreateItineraryAckReply,
  isCreateItineraryIntent,
  logChatCreateItineraryTriggered,
  parseActivityPreferencesFromText,
} from "@/lib/ai/chat-context-intent";
import {
  buildDailyRhythmReply,
  buildMustVisitPlacesReply,
  detectMustVisitIntent,
  detectPlaceRecommendationIntent,
  parseMustVisitPlacesIntent,
  parsePlanningFollowUpIntent,
  resolveMustVisitAdvice,
  resolveMustVisitDestination,
} from "@/lib/ai/must-visit-places";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import { logChatWrongFallbackBlocked } from "@/lib/ai/chat-place-flow-log";
import {
  buildItineraryPlanningReply,
  buildDailyRecommendationsReply,
  isReadyForItineraryPlanning,
  parseItineraryPlanModeIntent,
  itineraryGenerationStatusReply,
} from "@/lib/ai/itinerary-planning";
import { parseTripPreferences, type TripInterest } from "@/lib/ai/trip-preference";

export type DestinationAdvicePurpose =
  | "create_itinerary"
  | "best_time_to_visit"
  | "seasonal_destination"
  | "itinerary_planning"
  | "region_selected"
  | "destination_selection"
  | "route_combination_selected"
  | "trip_style_selected"
  | "duration_selected"
  | "option_selected"
  | "must_visit_places"
  | "daily_rhythm"
  | "ready_for_itinerary"
  | "destination_style_default";

export type DestinationAdviceResult = {
  reply: string | null;
  pendingQuestion?: PendingQuestion;
  contextPatch?: Partial<CanonicalTravelContext>;
  recommendations?: RoamieRecommendationItem[];
  recommendationsTitle?: string;
  /** 觸發 Places API + generateItinerary，不可只回文字草稿 */
  triggerItineraryGeneration?: boolean;
};

export function adviceToAssistantChatMsg(advice: DestinationAdviceResult): ChatMsg {
  const content = advice.reply ?? "";
  if (!advice.recommendations?.length) {
    return { role: "assistant", content };
  }
  return {
    role: "assistant",
    content,
    roamie: {
      title: advice.recommendationsTitle ?? "必去推薦",
      summary: content,
      moodTag: "",
      recommendations: advice.recommendations,
      itinerary: [],
    },
  };
}

export function applyAdviceResultToSession(
  session: ChatPlanningSession,
  advice: DestinationAdviceResult,
): ChatPlanningSession {
  if (!advice.contextPatch) return session;
  return {
    ...session,
    travelContext: {
      ...(session.travelContext ?? { interests: [] }),
      ...advice.contextPatch,
    },
  };
}

export { isFlexiblePreferenceReply } from "@/lib/ai/destination-pending-question";

function buildItineraryGenerationAdvice(
  ctx: CanonicalTravelContext,
  extra?: Partial<CanonicalTravelContext>,
): DestinationAdviceResult | null {
  const reply = itineraryGenerationStatusReply(ctx);
  if (!reply) return null;
  const label = ctx.destination ? normalizeDestinationLabel(ctx.destination) : undefined;
  return {
    reply,
    triggerItineraryGeneration: true,
    contextPatch: {
      destination: label ?? ctx.destination,
      days: ctx.days,
      selectedPlanMode: "full_itinerary",
      conversationState: "ready_for_itinerary",
      tripPurpose: "direct_itinerary_generation",
      ...extra,
    },
  };
}

type CountryAdvice = {
  bestTime: string[];
  selection: string[];
  cities: string;
};

const COUNTRY_ADVICE: Record<string, CountryAdvice> = {
  韓國: {
    bestTime: [
      "韓國我會比較推薦 4～5 月或 10～11 月。",
      "4～5 月天氣舒服、櫻花和春季散步感很好；10～11 月有楓葉，拍照和城市散策都很適合。",
      "如果你怕冷，不太建議 12～2 月；如果想省預算，可以看 3 月或 11 月底。",
    ],
    selection: [
      "好，韓國很適合城市散策、美食和季節風景。",
      "首爾適合購物、咖啡廳和夜生活；釜山有海景、海鮮和更慢步調；濟州島適合自然風光和放鬆。",
    ],
    cities: "首爾、釜山，還是濟州島",
  },
  日本: {
    bestTime: [
      "日本我會比較推薦 3～5 月或 10～11 月。",
      "春天有櫻花、天氣舒服；秋天楓葉很美，城市散策和溫泉都很適合。",
      "夏天適合祭典和海邊，但較悶熱；冬天北海道雪景很棒，關西則偏冷乾。",
    ],
    selection: [
      "好，日本可玩的區域很多。",
      "東京適合城市、美食和購物；大阪京都人文感強；北海道偏自然和雪景；沖繩則適合海島放鬆。",
    ],
    cities: "東京、大阪京都，還是北海道",
  },
  泰國: {
    bestTime: [
      "泰國通常 11 月到隔年 2 月比較舒服，天氣較乾、海邊活動也比較穩定。",
      "如果想避開人潮，可以看 5～6 月或 9～10 月，但要注意午後雷陣雨。",
    ],
    selection: [
      "好，泰國很適合想放鬆又有城市探索的人。",
      "曼谷適合美食、按摩和城市散策；清邁比較慢步調；海島像普吉、喀比、蘇梅島適合放空和海邊行程。",
    ],
    cities: "曼谷、清邁，還是海島",
  },
  越南: {
    bestTime: [
      "越南南北氣候差異大，整體來說 11～4 月較乾爽、適合旅行。",
      "河內、峴港這段時間舒服；胡志明則 12～3 月較不悶熱。",
    ],
    selection: [
      "好，越南很適合美食、咖啡文化和海島混搭。",
      "河內偏文化古城；峴港有海灘和中部風景；胡志明則城市感強、夜生活豐富。",
    ],
    cities: "河內、峴港，還是胡志明",
  },
  新加坡: {
    bestTime: [
      "新加坡全年溫暖，6～8 月較多雨，12～2 月相對舒服一點。",
      "若想避開雨季，可以優先看 2～4 月或 9～11 月。",
    ],
    selection: [
      "好，新加坡很適合城市美食、購物和輕鬆短天數旅行。",
      "濱海灣、聖淘沙、小印度和牛車水各有特色，通常 3～4 天就玩得很充實。",
    ],
    cities: "城市美食購物，還是聖淘沙海島放鬆",
  },
  台灣: {
    bestTime: [
      "台灣 3～5 月與 10～11 月通常最舒服，適合環島或城市散策。",
      "夏天較熱多雨，冬天北部偏濕冷，但南部仍算溫暖。",
    ],
    selection: [
      "好，台灣很適合美食、自然和慢步調旅行。",
      "北部有台北基隆；中部台中彰化；南部高雄台南；東部花蓮台東則適合看海和放鬆。",
    ],
    cities: "台北、台中，還是花蓮台東",
  },
  義大利: {
    bestTime: [
      "義大利我會推薦 4～6 月或 9～10 月，天氣舒服、人潮也相對好排。",
      "7～8 月很熱、景點人多；冬天北部偏冷，但米蘭佛羅倫斯仍有城市魅力。",
    ],
    selection: [
      "好，義大利很適合藝術、美食和慢旅行。",
      "羅馬佛羅倫斯人文感強；米蘭時尚購物；威尼斯水都；南部阿瑪菲海岸則適合海邊度假。",
    ],
    cities: "羅馬佛羅倫斯、米蘭威尼斯，還是南部海邊",
  },
  法國: {
    bestTime: [
      "法國 4～6 月與 9～10 月最舒服，適合巴黎散策和南法小鎮。",
      "夏天南部海邊很熱門但人潮多；冬天適合滑雪或城市博物館行程。",
    ],
    selection: [
      "好，法國很適合藝術、美食和浪漫城市旅行。",
      "巴黎經典必訪；普羅旺斯薰衣草與小鎮；蔚藍海岸則適合海邊度假。",
    ],
    cities: "巴黎、普羅旺斯，還是蔚藍海岸",
  },
  蒙古: {
    bestTime: [
      "蒙古 6～9 月最適合旅行，草原綠意足、氣溫舒服，也比較適合露營和長途移動。",
      "冬季極寒但雪景壯觀，適合想體驗極地風光的人；春秋則較冷，移動要預留彈性。",
    ],
    selection: [
      "好，蒙古很適合自然景觀、草原、沙漠和文化體驗。",
      "烏蘭巴托適合城市與文化起點；特勒吉國家公園近郊草原好安排；戈壁沙漠與哈拉和林則適合深度文化自然線。",
    ],
    cities: "烏蘭巴托、戈壁沙漠，還是草原文化體驗",
  },
};

/** 使用者這輪是否在更新/選定目的地（如「我想去芭達雅」「芭達雅」） */
export function isDestinationUpdateText(
  text: string,
  session?: ChatPlanningSession,
): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isFlexiblePreferenceReply(t)) return false;
  if (isDestinationAdviceText(t)) return false;
  if (isDestinationSelectionText(t)) return false;
  if (parseDestinationSelectionFromText(t)) return true;
  if (session && isDestinationAdviceActive(session) && isKnownTouristCityLabel(t)) {
    return true;
  }
  return false;
}

export function parseDestinationAdvicePurpose(text: string): DestinationAdvicePurpose | undefined {
  const t = text.trim();
  if (!t) return undefined;

  if (isCreateItineraryIntent(t)) return "create_itinerary";

  if (isBestTravelTimeIntent(t)) return "best_time_to_visit";

  if (
    /[\u4e00-\u9fff]{2,8}\s*(?:\d+|[一二三四五六七八九十百千兩两]+)\s*天.*(怎麼排|行程|規劃|规划|安排)/.test(
      t,
    )
  ) {
    return "itinerary_planning";
  }

  if (/\d{1,2}\s*月/.test(t) && /(適合|适合).*(去哪|哪裡|哪里|推薦|推荐)/.test(t)) {
    return "seasonal_destination";
  }

  if (
    /(幾月|几月|哪個月|什么時候|什麼時候|何时|何時|幾號|几号|哪一天|哪天|哪日|下個月|下个月|這個月|这个月|花季|最佳.{0,4}季|最佳.{0,4}(?:時間|时间|日期))/.test(
      t,
    )
  ) {
    if (isBestSeasonQuestion(t)) return "best_time_to_visit";
    if (
      resolveDestinationFromText(t) &&
      /(?:想)?去/.test(t) &&
      !/(比較好|比较好|你覺得|觉得)/.test(t)
    ) {
      return "region_selected";
    }
    return "best_time_to_visit";
  }

  if (isDestinationSelectionText(t)) {
    return "destination_selection";
  }

  if (parseDestinationSelectionFromText(t) || parseDestinationFromText(t)) {
    return "region_selected";
  }

  return undefined;
}

export function isDestinationAdviceActive(
  session: ChatPlanningSession,
  ctx?: CanonicalTravelContext,
): boolean {
  const purpose = ctx?.tripPurpose ?? session.travelContext?.tripPurpose;
  return (
    session.activeChatIntent === "destination_advice" ||
    purpose === "best_time_to_visit" ||
    purpose === "seasonal_destination" ||
    purpose === "itinerary_planning" ||
    purpose === "region_selected" ||
    purpose === "destination_selection" ||
    purpose === "route_combination_selected" ||
    purpose === "trip_style_selected" ||
    purpose === "duration_selected" ||
    purpose === "option_selected" ||
    purpose === "city_style_selected" ||
    purpose === "must_visit_places" ||
    purpose === "daily_rhythm" ||
    purpose === "ready_for_itinerary" ||
    purpose === "destination_style_default" ||
    purpose === "itinerary_draft"
  );
}

function thailandDrySeasonLines(cityLabel?: string): string[] {
  const prefix = cityLabel ? `${cityLabel}的話，` : "泰國通常";
  return [
    `${prefix}11 月到隔年 2 月比較舒服，天氣較乾、海邊活動也比較穩定。`,
    "如果想避開人潮，可以看 5～6 月或 9～10 月，但要注意午後雷陣雨。",
  ];
}

function buildThailandCityReply(city: string): string | null {
  const label = normalizeDestinationLabel(city);

  if (label === "芭達雅") {
    return [
      ...thailandDrySeasonLines("芭達雅"),
      "你這趟比較想排海灘放鬆、跳島、水上市場，還是曼谷＋芭達雅一起玩？",
    ].join("\n");
  }

  if (label === "曼谷") {
    return [
      ...thailandDrySeasonLines("曼谷"),
      "曼谷適合城市美食、寺廟與夜生活。你想偏重美食、購物，還是順便排大皇宮一帶？",
    ].join("\n");
  }

  if (label === "清邁") {
    return [
      ...thailandDrySeasonLines("清邁"),
      "清邁 11～2 月早晚偏涼，適合古城散步與市集。你比較想慢步調、咖啡廳，還是郊區一日遊？",
    ].join("\n");
  }

  if (label === "普吉島" || label === "蘇梅島") {
    return [
      ...thailandDrySeasonLines(label),
      `你比較想在${label}海灘放空、跳島，還是搭配附近小鎮一起排？`,
    ].join("\n");
  }

  return null;
}

function buildKoreaCityReply(city: string): string | null {
  const label = normalizeDestinationLabel(city);

  if (label === "首爾") {
    return [
      "首爾 4～5 月與 10～11 月最舒服，櫻花、楓葉和城市散策都很棒。",
      "適合購物、咖啡廳、韓式美食和夜景。你這趟大概幾天？比較想經典地標還是慢步調探索？",
    ].join("\n");
  }

  if (label === "釜山") {
    return [
      "釜山 4～6 月與 9～11 月很舒服，海景、海鮮和慢步調散策都很適合。",
      "海雲台、甘川文化村、札嘎其市場是經典組合。你比較想偏重海邊放鬆、美食，還是城市散策？",
    ].join("\n");
  }

  if (label === "濟州") {
    return [
      "濟州 4～6 月與 9～11 月天氣舒服，適合自駕、海邊散步和自然風光。",
      "冬天也適合看雪景，但風大偏冷。你比較想海邊放鬆、登山健行，還是咖啡廳慢旅行？",
    ].join("\n");
  }

  return null;
}

function buildJapanCityReply(city: string, userText?: string): string | null {
  if (userText?.trim() && hasCategoryPlaceQuery(userText)) return null;
  const label = normalizeDestinationLabel(city);

  if (label === "東京") {
    return [
      "東京很適合城市美食、購物和文化景點混搭。",
      "通常 3～5 天可以玩得很充實：經典地標、下町散策，再加一天近郊。你比較想偏重美食、購物還是文化？",
    ].join("\n");
  }

  if (label === "大阪" || label === "京都") {
    return [
      `${label}適合人文、美食和慢步調散策，春秋兩季最舒服。`,
      "你這趟大概幾天？比較想經典寺社、街區散步，還是近郊一日遊？",
    ].join("\n");
  }

  if (label === "北海道") {
    return [
      "北海道夏天涼爽、冬天雪景迷人，12～2 月適合滑雪，6～8 月適合自然風光。",
      "你比較想札幌城市美食、小樽函館海景，還是富良野自然風光？",
    ].join("\n");
  }

  return null;
}

function buildCountryBestTimeReply(country: string): string | null {
  const advice = COUNTRY_ADVICE[country];
  if (!advice) return null;
  return [...advice.bestTime, `你比較想去${advice.cities}？`].join("\n");
}

function buildCountrySelectionReply(country: string): string | null {
  const advice = COUNTRY_ADVICE[country];
  if (!advice) return null;
  const styleQuestion =
    country === "泰國"
      ? "你這趟比較想偏城市、美食按摩，還是海島放鬆？"
      : `你比較想去${advice.cities}？`;
  return [...advice.selection, styleQuestion].join("\n");
}

function buildScenicAdviceReply(
  spot: string,
  userText: string,
  ctx?: CanonicalTravelContext,
  weather?: CanonicalTravelContext["weather"],
): string | null {
  if (detectMustVisitIntent(userText) || detectPlaceRecommendationIntent(userText)) {
    return null;
  }

  const label = normalizeDestinationLabel(spot);

  if (
    ctx &&
    hasUserSpecifiedTravelMonth(ctx, userText) &&
    !isBestSeasonQuestion(userText)
  ) {
    return buildScenicMonthPlanningReply({
      destination: label,
      context: { ...ctx, destination: label },
      userText,
      weather: weather ?? ctx.weather ?? null,
    });
  }

  if (label === "阿里山") {
    const lines = [
      "阿里山以日出、雲海、森林鐵道與神木步道聞名，海拔高、早晚溫差大。",
      "3～4 月櫻花季、10～11 月楓紅期是熱門時段；若想看日出，建議前一晚住阿里山或搭下午上山火車，避開週末與連假人潮。",
      "你預計去幾天？會開車還是搭大眾運輸？比較想看日出、森林步道，還是順便排奋起湖？",
    ];
    return lines.join("\n");
  }

  if (label === "日月潭") {
    return [
      "日月潭全年皆可，9～12 月秋景與騎行較舒適；春節與連假人潮較多。",
      "建議避開週六中午入湖時段，平日或住一晚看晨霧更愜意。",
      "你預計去幾天？會環湖騎車還是以纜車＋步道為主？",
    ].join("\n");
  }

  if (label === "太魯閣") {
    return [
      "太魯閣 10～4 月較乾爽適合步道；梅雨季（5～6 月）需注意落石與部分步道管制。",
      "平日較少人潮，建議一早入山。你預計停留幾天？會自駕還是搭公車？",
    ].join("\n");
  }

  if (label === "富士山") {
    return [
      "富士山登山季約 7～9 月；若只是河口湖周邊，4～5 月與 10～11 月天氣與景色都很穩。",
      "週末與日本連假人潮多，平日較從容。你想登山還是湖區散策？",
    ].join("\n");
  }

  return null;
}

function buildCityAdviceReply(city: string, country?: string, userText?: string): string | null {
  const label = normalizeDestinationLabel(city);

  if (userText?.trim() && hasCategoryPlaceQuery(userText)) return null;

  if (country === "泰國" || (!country && buildThailandCityReply(label))) {
    const thai = buildThailandCityReply(label);
    if (thai) return thai;
  }

  if (country === "韓國" || (!country && buildKoreaCityReply(label))) {
    const korea = buildKoreaCityReply(label);
    if (korea) return korea;
  }

  if (country === "日本" || (!country && buildJapanCityReply(label, userText))) {
    const japan = buildJapanCityReply(label, userText);
    if (japan) return japan;
  }

  return null;
}

function resolvePlanningFollowUpReply(
  ctx: CanonicalTravelContext,
  userText: string,
): DestinationAdviceResult | null {
  const followUp = parsePlanningFollowUpIntent(userText);
  if (!followUp) return null;

  const destination = resolveMustVisitDestination(ctx, userText);
  if (!destination) return null;

  if (followUp === "full_itinerary") {
    const gen = buildItineraryGenerationAdvice({ ...ctx, destination });
    if (gen) return gen;
  }

  if (followUp === "must_visit_places") {
    const mustVisit = resolveMustVisitAdvice({ ...ctx, destination }, userText);
    if (!mustVisit) return null;
    return {
      reply: mustVisit.reply,
      recommendations: mustVisit.recommendations,
      recommendationsTitle: `${normalizeDestinationLabel(destination)}必去推薦`,
      contextPatch: mustVisit.contextPatch,
    };
  }

  return {
    reply: buildDailyRhythmReply({ ...ctx, destination }) ?? null,
  };
}

function resolveTripPreferenceReply(
  ctx: CanonicalTravelContext,
  userText: string,
  preferencePending = false,
): DestinationAdviceResult | null {
  const preferences = parseTripPreferences(userText);
  if (preferences.length === 0) return null;
  if (!isReadyForItineraryPlanning(ctx, { preferencePending })) return null;

  const destination =
    ctx.destination ??
    (ctx.destinationCities?.length ? ctx.destinationCities[0] : undefined);
  if (!destination || !ctx.days) return null;

  const reply = buildItineraryPlanningReply(
    { ...ctx, destination },
    preferences as TripInterest[],
  );
  if (!reply) return null;

  return {
    reply,
    pendingQuestion: pendingQuestionForItineraryAction(destination, ctx.destinationCountry),
    contextPatch: {
      selectedInterests: preferences,
      interests: preferences.map((interest) =>
        interest === "attractions"
          ? "景點"
          : interest === "shopping"
            ? "購物"
            : interest === "food"
              ? "美食"
              : interest === "night_market"
                ? "夜市"
                : interest,
      ),
      conversationState: "ready_for_itinerary",
      tripPurpose: "ready_for_itinerary",
    },
  };
}

export function resolveDestinationAdvice(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText: string,
): DestinationAdviceResult {
  if (isTripAddPlaceSession(session)) return { reply: null };

  if (hasCategoryPlaceQuery(userText) && resolveDestinationFromText(userText)) {
    logChatWrongFallbackBlocked("category_place_advice_blocked");
    return { reply: null };
  }

  if (
    ctx.destination?.trim() &&
    /(不要太熱|怕熱|不要曬|不想曬|太熱|不要太冷|怕雨|不要下雨)/.test(userText.trim())
  ) {
    const ack = buildWeatherConstraintAcknowledgement(
      ctx,
      ctx.weather ?? session.weather ?? null,
    );
    if (ack) {
      return {
        reply: ack,
        pendingQuestion: pendingQuestionForPlanningNextStep(
          ctx.destination,
          ctx.destinationCountry,
        ),
        contextPatch: {
          tripPurpose: "ready_for_itinerary",
          conversationState: "ready_for_itinerary",
        },
      };
    }
  }

  if (detectMustVisitIntent(userText) || detectPlaceRecommendationIntent(userText)) {
    const mustVisit = resolveMustVisitAdvice(ctx, userText);
    if (mustVisit) {
      const dest = resolveMustVisitDestination(ctx, userText) ?? ctx.destination;
      return {
        reply: mustVisit.reply,
        recommendations: mustVisit.recommendations,
        recommendationsTitle: dest ? `${normalizeDestinationLabel(dest)}必去推薦` : "必去推薦",
        contextPatch: mustVisit.contextPatch,
      };
    }
  }

  if (session.adviceSelectionThisTurn && session.lastResolvedPendingQuestion) {
    if (session.adviceSelectionThisTurn === "full_itinerary") {
      const gen = buildItineraryGenerationAdvice(ctx, {
        destination:
          session.lastResolvedPendingQuestion.baseDestination ?? ctx.destination,
        destinationCountry:
          session.lastResolvedPendingQuestion.destinationCountry ?? ctx.destinationCountry,
        days: ctx.days ?? parseDayCountFromText(userText),
      });
      if (gen) return gen;
    }

    const next = advanceAfterPendingSelection(
      session.adviceSelectionThisTurn,
      session.lastResolvedPendingQuestion,
      ctx,
    );
    const dest =
      session.lastResolvedPendingQuestion.baseDestination ?? ctx.destination;
    const mustVisit =
      session.adviceSelectionThisTurn === "must_visit_places" && dest
        ? resolveMustVisitAdvice({ ...ctx, destination: dest }, userText)
        : null;
    return {
      reply: next.reply,
      pendingQuestion: next.pendingQuestion,
      recommendations: mustVisit?.recommendations,
      recommendationsTitle: mustVisit && dest ? `${normalizeDestinationLabel(dest)}必去推薦` : undefined,
      contextPatch:
        session.lastResolvedPendingQuestion.type === "preference_choice"
          ? {
              selectedInterests: session.adviceSelectionThisTurn.split(",") as TripInterest[],
              conversationState: "ready_for_itinerary",
              tripPurpose: "ready_for_itinerary",
            }
          : session.lastResolvedPendingQuestion.type === "activity_choice" &&
              session.adviceSelectionThisTurn === "must_visit_places"
            ? {
                mustVisitGenerated: true,
                tripPurpose: "must_visit_places",
                planningStage: "recommendations_generated",
              }
            : session.adviceSelectionThisTurn === "full_itinerary"
              ? {
                  selectedPlanMode: "full_itinerary",
                  conversationState: "itinerary_draft",
                  tripPurpose: "itinerary_draft",
                  destination:
                    session.lastResolvedPendingQuestion.baseDestination ?? ctx.destination,
                  destinationCountry:
                    session.lastResolvedPendingQuestion.destinationCountry ??
                    ctx.destinationCountry,
                  days: ctx.days ?? parseDayCountFromText(userText),
                }
            : session.lastResolvedPendingQuestion.type === "ask_preference"
              ? contextPatchForPreferenceSelection(
                  session.adviceSelectionThisTurn,
                  session.lastResolvedPendingQuestion,
                )
            : session.lastResolvedPendingQuestion.type === "ask_days"
              ? {
                  days:
                    Number(session.adviceSelectionThisTurn) ||
                    parseDayCountFromText(session.adviceSelectionThisTurn),
                  destination:
                    session.lastResolvedPendingQuestion.baseDestination ?? ctx.destination,
                  destinationCountry:
                    session.lastResolvedPendingQuestion.destinationCountry ??
                    ctx.destinationCountry,
                  tripPurpose: "duration_selected",
                }
              : session.adviceSelectionThisTurn === "daily_recommendations"
                ? {
                    selectedPlanMode: "daily_recommendations",
                    conversationState: "itinerary_draft",
                    tripPurpose: "itinerary_draft",
                    destination:
                      session.lastResolvedPendingQuestion.baseDestination ?? ctx.destination,
                    destinationCountry:
                      session.lastResolvedPendingQuestion.destinationCountry ??
                      ctx.destinationCountry,
                  }
                : undefined,
    };
  }

  const pending = session.pendingQuestion;
  if (pending) {
    const selected = parsePendingOptionSelection(userText, pending);
    if (selected) {
      if (selected === "full_itinerary") {
        const gen = buildItineraryGenerationAdvice(
          {
            ...ctx,
            destination: pending.baseDestination ?? ctx.destination,
            days: ctx.days ?? parseDayCountFromText(userText),
          },
          {
            destination: pending.baseDestination ?? ctx.destination,
            destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
          },
        );
        if (gen) return gen;
      }

      if (
        selected === "must_visit_places" ||
        parsePlanningFollowUpIntent(userText) === "must_visit_places"
      ) {
        const dest = pending.baseDestination ?? ctx.destination;
        const mustVisit = resolveMustVisitAdvice({ ...ctx, destination: dest }, userText);
        if (mustVisit) {
          return {
            reply: mustVisit.reply,
            recommendations: mustVisit.recommendations,
            recommendationsTitle: dest ? `${normalizeDestinationLabel(dest)}必去推薦` : "必去推薦",
            contextPatch: {
              ...mustVisit.contextPatch,
              ...(pending.type === "preference_choice"
                ? {
                    selectedInterests: selected.split(",") as TripInterest[],
                    conversationState: "ready_for_itinerary" as const,
                    tripPurpose: "ready_for_itinerary",
                  }
                : {}),
            },
          };
        }
      }

      const next = advanceAfterPendingSelection(selected, pending, ctx);
      return {
        reply: next.reply,
        pendingQuestion: next.pendingQuestion,
        contextPatch:
          pending.type === "preference_choice"
            ? {
                selectedInterests: selected.split(",") as TripInterest[],
                conversationState: "ready_for_itinerary",
                tripPurpose: "ready_for_itinerary",
              }
            : selected === USE_DEFAULT_ROUTES
              ? {
                  useDefaultRecommendation: true,
                  vibe: "混合",
                  travelStyle: "熱門路線",
                  tripPurpose: "destination_style_default",
                  destination: pending.baseDestination ?? ctx.destination,
                  destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
                }
              : selected === "must_visit_places"
              ? {
                  mustVisitGenerated: true,
                  tripPurpose: "must_visit_places",
                  planningStage: "recommendations_generated",
                }
              : pending.type === "destination_style_choice"
                ? {
                    vibe: selected,
                    travelStyle: selected,
                    tripPurpose: "trip_style_selected",
                    destination: pending.baseDestination ?? ctx.destination,
                    destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
                  }
                : selected === "full_itinerary"
                  ? {
                      selectedPlanMode: "full_itinerary",
                      conversationState: "itinerary_draft",
                      tripPurpose: "itinerary_draft",
                      destination: pending.baseDestination ?? ctx.destination,
                      destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
                      days: ctx.days ?? parseDayCountFromText(userText),
                    }
              : pending.type === "ask_preference"
                ? contextPatchForPreferenceSelection(selected, pending)
              : pending.type === "ask_days"
                ? {
                    days: Number(selected) || parseDayCountFromText(selected),
                    destination: pending.baseDestination ?? ctx.destination,
                    destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
                    tripPurpose: "duration_selected",
                  }
                : selected === "daily_recommendations"
                    ? {
                        selectedPlanMode: "daily_recommendations",
                        conversationState: "itinerary_draft",
                        tripPurpose: "itinerary_draft",
                        destination: pending.baseDestination ?? ctx.destination,
                        destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
                      }
                    : undefined,
      };
    }
    if (isAskDaysPending(pending)) {
      const parsedDays = parseAskDaysFromText(userText);
      if (parsedDays) {
        const next = advanceAfterPendingSelection(String(parsedDays), pending, ctx);
        return {
          reply: next.reply,
          pendingQuestion: next.pendingQuestion,
          contextPatch: {
            days: parsedDays,
            destination: pending.baseDestination ?? ctx.destination,
            destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
            tripPurpose: "duration_selected",
          },
        };
      }
      const dest = pending.baseDestination ?? ctx.destination ?? "這趟";
      return {
        reply: `好，${dest}是很好的選擇。你這趟大概幾天？例如 5天、6天 都可以。`,
        pendingQuestion: pending,
      };
    }
    if (isItineraryNextStepPending(pending)) {
      return { reply: null };
    }
    const followUpReply = resolvePlanningFollowUpReply(ctx, userText);
    if (followUpReply?.reply) {
      return followUpReply;
    }
    const preferenceReply = resolveTripPreferenceReply(
      ctx,
      userText,
      pending.type === "preference_choice",
    );
    if (preferenceReply?.reply) {
      return preferenceReply;
    }
    return { reply: null };
  }

  const planMode = parseItineraryPlanModeIntent(userText);
  if (
    (isCreateItineraryIntent(userText) || planMode === "full_itinerary") &&
    !session.pendingQuestion
  ) {
    const dest =
      ctx.destination?.trim() ??
      session.tripPlanningContext?.destination?.trim() ??
      session.tripDestination?.city?.trim() ??
      resolveDestinationFromText(userText);
    const days = ctx.days ?? session.tripDays ?? parseDayCountFromText(userText);
    if (dest && days) {
      const prefs = parseActivityPreferencesFromText(userText);
      const label = normalizeDestinationLabel(dest);
      logChatCreateItineraryTriggered(label, days);
      const reply = buildCreateItineraryAckReply({
        destination: label,
        days,
        preferences: prefs.length ? prefs : ctx.interests,
      });
      return {
        reply,
        triggerItineraryGeneration: true,
        contextPatch: {
          destination: label,
          days,
          interests: [...new Set([...ctx.interests, ...prefs])],
          selectedPlanMode: "full_itinerary",
          conversationState: "ready_for_itinerary",
          tripPurpose: "create_itinerary",
          lastIntent: "create_itinerary",
        },
      };
    }
  }

  if (
    planMode === "full_itinerary" &&
    ctx.destination?.trim() &&
    ctx.days &&
    !session.pendingQuestion
  ) {
    const gen = buildItineraryGenerationAdvice(ctx);
    if (gen) return gen;
  }
  if (
    planMode === "daily_recommendations" &&
    ctx.destination?.trim() &&
    ctx.days &&
    !session.pendingQuestion
  ) {
    const reply = buildDailyRecommendationsReply(ctx, ctx.selectedInterests as TripInterest[] | undefined);
    if (reply) {
      return {
        reply,
        contextPatch: {
          selectedPlanMode: "daily_recommendations",
          conversationState: "itinerary_draft",
          tripPurpose: "itinerary_draft",
        },
      };
    }
  }

  const planningDestination =
    ctx.destination ??
    session.tripPlanningContext?.destination ??
    session.tripDestination?.city;
  const isDestinationPlanning =
    session.conversationMode === "destination_planning" ||
    session.tripPlanningContext?.intent === "destination_planning";

  if (
    isFlexiblePreferenceReply(userText) &&
    isDestinationPlanning &&
    planningDestination?.trim()
  ) {
    const syntheticPending = pendingQuestionForDestinationStyleChoice(
      planningDestination,
      ctx.destinationCountry ?? session.travelContext?.destinationCountry,
    );
    const selected = USE_DEFAULT_ROUTES;
    const next = advanceAfterPendingSelection(selected, syntheticPending, ctx);
    return {
      reply: next.reply,
      pendingQuestion: next.pendingQuestion,
      contextPatch: {
        useDefaultRecommendation: true,
        vibe: "混合",
        travelStyle: "熱門路線",
        tripPurpose: "destination_style_default",
        destination: planningDestination,
        destinationCountry:
          ctx.destinationCountry ?? session.travelContext?.destinationCountry,
      },
    };
  }

  const followUpReply = resolvePlanningFollowUpReply(ctx, userText);
  if (followUpReply?.reply) {
    return followUpReply;
  }

  const preferenceReply = resolveTripPreferenceReply(ctx, userText, false);
  if (preferenceReply?.reply) {
    return preferenceReply;
  }

  const scenicDest =
    ctx.destination ??
    resolveDestinationFromText(userText) ??
    session.tripPlanningContext?.destination ??
    session.tripDestination?.city;
  const scenicLabel = scenicDest ? normalizeDestinationLabel(scenicDest) : undefined;

  if (
    scenicLabel &&
    isKnownDestinationLabel(scenicLabel) &&
    hasUserSpecifiedTravelMonth(ctx, userText) &&
    !isBestSeasonQuestion(userText) &&
    !session.adviceSelectionThisTurn &&
    ctx.tripPurpose !== "route_combination_selected" &&
    ctx.tripPurpose !== "duration_selected"
  ) {
    const monthReply = buildScenicMonthPlanningReply({
      destination: scenicLabel,
      context: { ...ctx, destination: scenicLabel },
      userText,
      weather: ctx.weather ?? session.weather ?? null,
    });
    return {
      reply: monthReply,
      pendingQuestion: pendingQuestionForPlanningNextStep(
        scenicLabel,
        ctx.destinationCountry ?? session.travelContext?.destinationCountry,
      ),
      contextPatch: {
        destination: scenicLabel,
        tripPurpose: "region_selected",
        conversationState: "ready_for_itinerary",
      },
    };
  }

  const reply = buildDestinationAdviceReplyBody(ctx, session, userText);
  if (!reply) return { reply: null };

  return {
    reply,
    pendingQuestion: inferPendingQuestionFromAdviceReply(reply, ctx, session),
    contextPatch: reply.includes("我幫你整理幾個") || reply.includes("我會先抓這些必去點")
      ? {
          mustVisitGenerated: true,
          tripPurpose: "must_visit_places",
          planningStage: "recommendations_generated",
        }
      : undefined,
  };
}

export function buildDestinationAdviceReply(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText: string,
): string | null {
  return resolveDestinationAdvice(ctx, session, userText).reply;
}

function buildDestinationAdviceReplyBody(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText: string,
): string | null {
  if (isTripAddPlaceSession(session)) return null;

  if (hasCategoryPlaceQuery(userText) && resolveDestinationFromText(userText)) {
    logChatWrongFallbackBlocked("category_place_advice_body_blocked");
    return null;
  }

  if (
    ctx.conversationState === "ready_for_itinerary" ||
    ctx.tripPurpose === "ready_for_itinerary"
  ) {
    return null;
  }

  if (parseMustVisitPlacesIntent(userText)) {
    const mustVisit = resolveMustVisitAdvice(ctx, userText);
    if (mustVisit) return mustVisit.reply;
  }

  const dest =
    ctx.destination ??
    session.tripPlanningContext?.destination ??
    session.tripDestination?.city ??
    session.preferredArea;
  const destLabel = dest ? normalizeDestinationLabel(dest) : undefined;
  const country = ctx.destinationCountry
    ? normalizeDestinationLabel(ctx.destinationCountry)
    : undefined;

  const purpose =
    (isCreateItineraryIntent(userText) ? "create_itinerary" : undefined) ??
    (isDestinationUpdateText(userText, session) ? "region_selected" : undefined) ??
    parseDestinationAdvicePurpose(userText) ??
    (ctx.tripPurpose as DestinationAdvicePurpose | undefined) ??
    (session.travelContext?.tripPurpose as DestinationAdvicePurpose | undefined);

  const resolvedDest =
    destLabel ??
    resolveDestinationFromText(userText) ??
    parseDestinationFromText(userText);

  if (purpose === "best_time_to_visit" && resolvedDest && !isCreateItineraryIntent(userText)) {
    return buildBestTravelTimeReply(resolvedDest);
  }

  if (isFlexiblePreferenceReply(userText) && isDestinationAdviceActive(session, ctx) && dest) {
    if (session.pendingQuestion) return null;
    if (
      ctx.tripPurpose === "city_style_selected" ||
      ctx.tripPurpose === "duration_selected" ||
      ctx.tripPurpose === "ready_for_itinerary" ||
      ctx.tripPurpose === "must_visit_places"
    ) {
      return null;
    }
    if (purpose === "best_time_to_visit" || purpose === "region_selected") {
      if (destLabel && isKnownTouristCityLabel(destLabel)) {
        return null;
      }
      return [
        `好的，${dest}可以玩的區域很多。`,
        "你可以跟我說比較想去城市、海島還是自然風光，我再幫你往下細排。",
      ].join("\n");
    }
    if (purpose === "seasonal_destination") {
      return `沒問題，我會依 ${ctx.travelMonth ?? "這個月份"} 幫你整理 ${dest} 適合的區域方向。想偏重城市、自然還是海島？`;
    }
    if (purpose === "destination_selection") {
      return null;
    }
    return `好的，我會依你剛才說的 ${dest} 方向繼續幫你規劃。`;
  }

  const month = ctx.travelMonth;
  const days = ctx.days ?? session.tripDays ?? parseDayCountFromText(userText);

  // 景點／風景區（阿里山、日月潭等）
  if (
    destLabel &&
    isKnownScenicLabel(destLabel) &&
    ctx.tripPurpose !== "route_combination_selected" &&
    ctx.tripPurpose !== "trip_style_selected" &&
    ctx.tripPurpose !== "duration_selected" &&
    !session.adviceSelectionThisTurn
  ) {
    const scenicReply = buildScenicAdviceReply(
      destLabel,
      userText,
      ctx,
      ctx.weather ?? session.weather ?? null,
    );
    if (scenicReply) return scenicReply;
  }

  // 城市層級回覆（優先於國家通用模板）
  // 若使用者已選定路線組合或行程風格，不再重複城市開場模板
  if (
    destLabel &&
    isKnownTouristCityLabel(destLabel) &&
    ctx.tripPurpose !== "route_combination_selected" &&
    ctx.tripPurpose !== "trip_style_selected" &&
    ctx.tripPurpose !== "duration_selected" &&
    ctx.tripPurpose !== "city_style_selected" &&
    !session.adviceSelectionThisTurn
  ) {
    const cityReply = buildCityAdviceReply(destLabel, country, userText);
    if (cityReply) return cityReply;

    if (purpose === "destination_selection" || purpose === "region_selected") {
      const resolvedDays = days ?? ctx.days;
      if (resolvedDays && shouldSkipAskingDays({ ...ctx, days: resolvedDays })) {
        logChatContextUpdate({ destination: destLabel, days: resolvedDays });
        logChatNextStep("ask_preference");
        return buildCityDaysConfirmedReply(destLabel, resolvedDays, country, {
          weather: ctx.weather,
          context: ctx,
        }).reply;
      }
      if (!resolvedDays) {
        return [
          `好，${destLabel}是很好的選擇。`,
          "你這趟大概幾天？比較想經典地標、美食，還是慢步調散策？",
        ].join("\n");
      }
    }
  }

  // 國家層級：最佳月份（legacy — 已由通用 entity 回覆覆蓋，保留為後備）
  if (
    destLabel &&
    isKnownCountryLabel(destLabel) &&
    purpose === "best_time_to_visit"
  ) {
    const reply = buildCountryBestTimeReply(destLabel);
    if (reply) return reply;
  }

  // 國家層級：我想去 + 國家
  if (
    destLabel &&
    isKnownCountryLabel(destLabel) &&
    (purpose === "destination_selection" || purpose === "region_selected") &&
    ctx.tripPurpose !== "trip_style_selected" &&
    ctx.tripPurpose !== "route_combination_selected" &&
    ctx.tripPurpose !== "duration_selected" &&
    ctx.tripPurpose !== "must_visit_places" &&
    ctx.tripPurpose !== "ready_for_itinerary" &&
    !session.pendingQuestion
  ) {
    const reply = buildCountrySelectionReply(destLabel);
    if (reply) return reply;
  }

  if (destLabel === "日本" && purpose === "seasonal_destination") {
    const monthLabel = month ?? "這個月份";
    return [
      `日本 ${monthLabel} 很適合賞楓、溫泉與城市散策。`,
      "關西（京都・大阪）人文感強，北海道則偏雪景與自然。",
      "你比較想偏重城市文化，還是自然風光？",
    ].join("\n");
  }

  if (
    (destLabel === "東京" || destLabel === "大阪" || destLabel === "京都") &&
    purpose === "itinerary_planning" &&
    days
  ) {
    return [
      `${destLabel} ${days} 天很充裕！通常會拆成經典地標、購物街區，再加一天近郊一日遊。`,
      "你比較想偏重美食、購物還是文化景點？",
    ].join("\n");
  }

  if (destLabel && purpose === "seasonal_destination") {
    return [
      `${destLabel} ${month ?? ""} 可玩的區域很多，會依你想偏重城市、自然還是海島而不同。`,
      "你比較想往哪個方向？",
    ].join("\n");
  }

  if (destLabel && purpose === "region_selected" && isKnownTouristCityLabel(destLabel)) {
    if (
      ctx.tripPurpose === "route_combination_selected" ||
      ctx.tripPurpose === "trip_style_selected"
    ) {
      return null;
    }
    const cityReply = buildCityAdviceReply(destLabel, country, userText);
    if (cityReply) return cityReply;
    return [
      `好的，我們以 ${destLabel} 為主。`,
      "你比較想排海灘放鬆、城市美食，還是近郊一日遊？",
    ].join("\n");
  }

  return null;
}
