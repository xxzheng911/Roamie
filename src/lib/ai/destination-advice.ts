import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import {
  isDestinationAdviceText,
  isDestinationSelectionText,
  isKnownCountryLabel,
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
  parseDestinationFromText,
  parseDestinationSelectionFromText,
} from "@/lib/ai/trip-planning-context";
import { isTripAddPlaceSession } from "@/lib/trip/trip-add-place-session";
import {
  buildNextStepAfterAdviceSelection,
  inferPendingQuestionFromAdviceReply,
  parsePendingOptionSelection,
  type PendingQuestion,
} from "@/lib/ai/destination-pending-question";

export type DestinationAdvicePurpose =
  | "best_time_to_visit"
  | "seasonal_destination"
  | "itinerary_planning"
  | "region_selected"
  | "destination_selection"
  | "route_combination_selected"
  | "trip_style_selected"
  | "duration_selected"
  | "option_selected";

export type DestinationAdviceResult = {
  reply: string | null;
  pendingQuestion?: PendingQuestion;
};

const FLEXIBLE_REPLY_RE =
  /^(都可以|都行|不限|沒特別|沒有特別|隨意|你推|都行吧|隨便|任何|沒有偏好|沒偏好)$/;

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
};

export function isFlexiblePreferenceReply(text: string): boolean {
  return FLEXIBLE_REPLY_RE.test(text.trim());
}

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

  if (/(幾月|哪個月|什麼時候|何时|何時|最佳.{0,4}季)/.test(t)) {
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
    purpose === "option_selected"
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

function buildJapanCityReply(city: string): string | null {
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

function buildCityAdviceReply(city: string, country?: string): string | null {
  const label = normalizeDestinationLabel(city);

  if (country === "泰國" || (!country && buildThailandCityReply(label))) {
    const thai = buildThailandCityReply(label);
    if (thai) return thai;
  }

  if (country === "韓國" || (!country && buildKoreaCityReply(label))) {
    const korea = buildKoreaCityReply(label);
    if (korea) return korea;
  }

  if (country === "日本" || (!country && buildJapanCityReply(label))) {
    const japan = buildJapanCityReply(label);
    if (japan) return japan;
  }

  return null;
}

export function resolveDestinationAdvice(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText: string,
): DestinationAdviceResult {
  if (isTripAddPlaceSession(session)) return { reply: null };

  if (session.adviceSelectionThisTurn && session.lastResolvedPendingQuestion) {
    const next = buildNextStepAfterAdviceSelection(
      session.adviceSelectionThisTurn,
      session.lastResolvedPendingQuestion,
      ctx,
    );
    return {
      reply: next.reply,
      pendingQuestion: next.pendingQuestion,
    };
  }

  const pending = session.pendingQuestion;
  if (pending) {
    const selected = parsePendingOptionSelection(userText, pending);
    if (selected) {
      const next = buildNextStepAfterAdviceSelection(selected, pending, ctx);
      return {
        reply: next.reply,
        pendingQuestion: next.pendingQuestion,
      };
    }
  }

  const reply = buildDestinationAdviceReplyBody(ctx, session, userText);
  if (!reply) return { reply: null };

  return {
    reply,
    pendingQuestion: inferPendingQuestionFromAdviceReply(reply, ctx, session),
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
    (isDestinationUpdateText(userText, session)
      ? "region_selected"
      : undefined) ??
    (ctx.tripPurpose as DestinationAdvicePurpose | undefined) ??
    parseDestinationAdvicePurpose(userText) ??
    (session.travelContext?.tripPurpose as DestinationAdvicePurpose | undefined);

  if (isFlexiblePreferenceReply(userText) && isDestinationAdviceActive(session, ctx) && dest) {
    if (purpose === "best_time_to_visit" || purpose === "region_selected") {
      if (destLabel && isKnownTouristCityLabel(destLabel)) {
        return `好的，我會以${destLabel}為主往下排。你想偏重海灘放鬆、美食，還是城市＋海島混搭？`;
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
      return `好的，我們以 ${dest} 為主。你比較想城市探索、美食，還是海島放鬆？`;
    }
    return `好的，我會依你剛才說的 ${dest} 方向繼續幫你規劃。`;
  }

  const month = ctx.travelMonth;
  const days = ctx.days ?? session.tripDays ?? parseDayCountFromText(userText);

  // 城市層級回覆（優先於國家通用模板）
  // 若使用者已選定路線組合或行程風格，不再重複城市開場模板
  if (
    destLabel &&
    isKnownTouristCityLabel(destLabel) &&
    ctx.tripPurpose !== "route_combination_selected" &&
    ctx.tripPurpose !== "trip_style_selected" &&
    ctx.tripPurpose !== "duration_selected" &&
    !session.adviceSelectionThisTurn
  ) {
    const cityReply = buildCityAdviceReply(destLabel, country);
    if (cityReply) return cityReply;

    if (purpose === "destination_selection" || purpose === "region_selected") {
      return [
        `好，${destLabel}是很好的選擇。`,
        "你這趟大概幾天？比較想經典地標、美食，還是慢步調散策？",
      ].join("\n");
    }
  }

  // 國家層級：最佳月份
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
    (purpose === "destination_selection" || purpose === "region_selected")
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
    const cityReply = buildCityAdviceReply(destLabel, country);
    if (cityReply) return cityReply;
    return [
      `好的，我們以 ${destLabel} 為主。`,
      "你比較想排海灘放鬆、城市美食，還是近郊一日遊？",
    ].join("\n");
  }

  return null;
}
