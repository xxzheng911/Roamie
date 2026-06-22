import type { ChatPlanningSession } from "@/lib/chat-session";
import type { TripLocation } from "@/lib/location/types";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { detectChatIntent, isNearbyPlaceIntent } from "@/lib/ai/chat-intent";
import { parseDestinationAdvicePurpose } from "@/lib/ai/destination-advice";
import type { TripIntentMissingKey } from "@/lib/recommendation/trip-intent";
import {
  isTripAddPlaceSession,
  reinforceTripAddPlaceSession,
} from "@/lib/trip/trip-add-place-session";

/** A 附近探索 | B 目的地規劃 | C 特定地點 | D 心情推薦 */
export type ChatConversationMode =
  | "nearby_explore"
  | "destination_planning"
  | "place_focus"
  | "mood_recommend"
  | "trip_add_place"
  | "general";

export type TripPlanningContext = {
  destination?: string;
  origin?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  budget?: string;
  travelStyle?: string;
  transportation?: string;
  peopleCount?: number;
  travelMonth?: string;
  selectedPlaces: string[];
  intent: ChatConversationMode;
};

export const EMPTY_TRIP_PLANNING_CONTEXT: TripPlanningContext = {
  selectedPlaces: [],
  intent: "general",
};

const KNOWN_CITIES =
  /^(台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|嘉義|花蓮|台東|臺東|宜蘭|澎湖|金門|馬祖|京都|大阪|東京|橫濱|名古屋|福岡|首爾|釜山|香港|澳門|新加坡|曼谷|清邁|巴黎|倫敦|紐約|洛杉磯|舊金山|雪梨|墨爾本)(市|縣|都|府)?$/i;

/** 熱門旅遊城市（含泰國海島等） */
const KNOWN_TOURIST_CITIES =
  /^(芭達雅|帕塔雅|普吉島|普吉|蘇梅島|蘇梅|清邁|清迈|河內|胡志明|峴港|金邊|吳哥窟|吉隆坡|檳城|槟城|峇里島|巴厘岛|宿霧|長灘島|長灘|札幌|北海道|沖繩|冲绳|廣島|奈良|神戶|箱根|鎌倉|濟州|濟州島)(市|府|島|县)?$/i;

const DESTINATION_ALIASES: Record<string, string> = {
  帕塔雅: "芭達雅",
  清迈: "清邁",
  普吉: "普吉島",
  苏梅: "蘇梅島",
  苏梅岛: "蘇梅島",
  巴厘岛: "峇里島",
  冲绳: "沖繩",
  槟城: "檳城",
  長灘: "長灘島",
  濟州島: "濟州",
};

export function normalizeDestinationLabel(name: string): string {
  const n = normalizeCityLabel(name.trim());
  return DESTINATION_ALIASES[n] ?? n;
}

export function isKnownTouristCityLabel(name: string): boolean {
  const n = normalizeDestinationLabel(name);
  return KNOWN_CITIES.test(n) || KNOWN_TOURIST_CITIES.test(n);
}

export function isKnownDestinationLabel(name: string): boolean {
  return isKnownTouristCityLabel(name) || isKnownCountryLabel(name);
}

export const KNOWN_COUNTRIES =
  /^(泰國|泰国|日本|韓國|韩国|中國|中国|台灣|台湾|馬來西亞|马来西亚|越南|印尼|印度尼西亞|菲律宾|菲律賓|新加坡|柬埔寨|寮國|老挝|緬甸|缅甸|美國|美国|加拿大|英國|英国|法國|法国|德國|德国|義大利|意大利|澳洲|澳大利亚|紐西蘭|新西兰)(國|国)?$/i;

export function isKnownCountryLabel(name: string): boolean {
  const n = normalizeCityLabel(name);
  return KNOWN_COUNTRIES.test(n);
}

const KNOWN_COUNTRY_NAMES = [
  "印度尼西亞",
  "馬來西亞",
  "菲律宾",
  "菲律賓",
  "紐西蘭",
  "新西兰",
  "澳大利亚",
  "澳洲",
  "意大利",
  "義大利",
  "德国",
  "德國",
  "法国",
  "法國",
  "英国",
  "英國",
  "美国",
  "美國",
  "加拿大",
  "新加坡",
  "柬埔寨",
  "缅甸",
  "緬甸",
  "老挝",
  "寮國",
  "越南",
  "印尼",
  "泰国",
  "泰國",
  "韩国",
  "韓國",
  "中国",
  "中國",
  "台湾",
  "台灣",
  "日本",
] as const;

function matchLeadingKnownDestination(text: string): string | undefined {
  const sorted = [...KNOWN_COUNTRY_NAMES].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (text.startsWith(name)) {
      const normalized = normalizeDestinationLabel(name);
      if (isKnownCountryLabel(normalized)) return normalized;
    }
  }

  const prefix = text.match(/^[\u4e00-\u9fff]{2,8}/)?.[0];
  if (prefix) {
    for (let len = Math.min(8, prefix.length); len >= 2; len -= 1) {
      const candidate = normalizeDestinationLabel(prefix.slice(0, len));
      if (isKnownTouristCityLabel(candidate)) return candidate;
    }
  }

  return undefined;
}

/** 從「泰國幾月去比較好」「日本11月適合去哪」等句首擷取目的地 */
export function parseLeadingDestinationLabel(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;

  if (/(幾月|哪個月|什麼時候|何时|何時|最佳|好玩)/.test(t)) {
    const prefix = matchLeadingKnownDestination(t);
    if (prefix && isValidParsedDestinationLabel(prefix)) return prefix;
  }

  const countryMonth =
    t.match(/^([\u4e00-\u9fff]{2,8})(?:的)?(?:幾月|哪個月|什麼時候|何时|何時)/) ??
    t.match(/^([\u4e00-\u9fff]{2,8})(\d{1,2})\s*月/);
  if (countryMonth?.[1]) {
    const label = normalizeCityLabel(countryMonth[1]);
    if (
      isValidParsedDestinationLabel(label) &&
      (isKnownCountryLabel(label) || KNOWN_CITIES.test(label))
    ) {
      return label;
    }
  }

  const cityDays = t.match(/^([\u4e00-\u9fff]{2,8})\s*(?:\d+|[一二三四五六七八九十百千兩两]+)\s*天/);
  if (cityDays?.[1]) {
    const label = normalizeCityLabel(cityDays[1]);
    if (
      isValidParsedDestinationLabel(label) &&
      (KNOWN_CITIES.test(label) || isKnownCountryLabel(label))
    ) {
      return label;
    }
  }

  return undefined;
}

/** 「幾月去比較好」「11月適合去哪」「東京五天怎麼排」等 — 非附近推薦 */
export function isDestinationAdviceText(text: string): boolean {
  const t = text.trim();
  if (!t || isNearbyExploreText(text)) return false;

  if (
    /(幾月|哪個月|什麼時候|何时|何時|最佳.{0,4}季)/.test(t) &&
    /(比較好|比较好|適合|适合|去|旅遊|旅游|好玩)/.test(t)
  ) {
    return true;
  }

  if (/\d{1,2}\s*月/.test(t) && /(適合|适合).*(去哪|哪裡|哪里|推薦|推荐)/.test(t)) {
    return true;
  }

  if (
    /[\u4e00-\u9fff]{2,8}\s*(?:\d+|[一二三四五六七八九十百千兩两]+)\s*天.*(怎麼排|行程|規劃|规划|安排)/.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

/** 「我想去泰國」「我想去東京」— 選定目的地、非季節諮詢 */
export function isDestinationSelectionText(text: string): boolean {
  const t = text.trim();
  if (!t || isNearbyExploreText(text) || isDestinationAdviceText(text)) return false;
  if (!/^(?:我)?(?:想)?去/.test(t)) return false;
  return Boolean(parseDestinationFromText(t) || parseDestinationSelectionFromText(t));
}

export function isDestinationAdviceActive(session: ChatPlanningSession): boolean {
  const purpose = session.travelContext?.tripPurpose;
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

const NON_DESTINATION_LABELS = new Set([
  "哪裡",
  "哪里",
  "哪兒",
  "哪儿",
  "何處",
  "何处",
  "附近",
  "這裡",
  "这里",
  "那裡",
  "那里",
  "這邊",
  "这边",
  "那邊",
  "那边",
  "什麼地方",
  "什么地方",
  "去哪裡",
  "去哪里",
  "去哪",
  "去哪兒",
  "去哪儿",
  "適合",
  "适合",
  "看看",
  "推薦",
  "推荐",
  "幫我",
  "帮我",
  "比較好",
  "比较好",
  "好不好",
  "幾月",
  "何时",
  "何時",
  "什麼時候",
  "什么时候",
]);

export function normalizeCityLabel(name: string): string {
  return name.trim().replace(/(市|縣|都|府)$/, "");
}

/** 提問語、代詞、動詞片語 — 不可當目的地 */
export function isValidParsedDestinationLabel(name: string): boolean {
  const n = name.trim();
  if (n.length < 2) return false;
  if (NON_DESTINATION_LABELS.has(n)) return false;
  if (/^(哪|什麼|什么|何人|何處|何处|附近|這|这|那|幾|何時|何时|怎麼|怎么|如何)/.test(n)) {
    return false;
  }
  if (/哪裡|哪里|什麼地方|什么地方|去哪|適合|适合|推薦|推荐/.test(n)) return false;
  return true;
}

function acceptParsedDestination(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const normalized = normalizeDestinationLabel(candidate);
  if (!isValidParsedDestinationLabel(normalized)) return undefined;
  if (!isKnownDestinationLabel(normalized)) return undefined;
  return normalized;
}

/** 使用者回覆區域選擇（如「芭達雅」「我想去芭達雅」） */
export function parseDestinationSelectionFromText(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;

  const fromWantGo = t.match(/(?:我)?(?:想)?去([\u4e00-\u9fffA-Za-z]{2,10})(?:[啊呀呢吧]|$|，|。|\s)/);
  if (fromWantGo?.[1]) {
    const accepted = acceptParsedDestination(fromWantGo[1]);
    if (accepted) return accepted;
  }

  if (t.length <= 12 && !/(幾月|什麼時候|比較好|適合)/.test(t)) {
    const bare = acceptParsedDestination(normalizeDestinationLabel(t));
    if (bare && isKnownTouristCityLabel(bare)) return bare;
  }

  return undefined;
}

export function isMoodRecommendationSession(session: ChatPlanningSession): boolean {
  return Boolean(
    session.fromMoodFlow ||
      session.fromMoodCard ||
      session.homeMoodShortcutEntry ||
      session.conversationMode === "mood_recommend",
  );
}

export function parseDestinationFromText(text: string): string | undefined {
  try {
    const t = text.trim();
    if (!t) return undefined;

    const leading = parseLeadingDestinationLabel(t);
    if (leading) return leading;

    const withDays = t.match(/我想?去([\u4e00-\u9fff]{2,8})(?:\d+|[一二三四五六七八九十百千兩两]+)\s*天/);
    if (withDays?.[1]) return acceptParsedDestination(withDays[1]);

    const cityDays = t.match(
      /(?:^|(?<=[^去]))([\u4e00-\u9fff]{2,8})\s*(?:\d+|[一二三四五六七八九十百千兩两]+)\s*天/,
    );
    if (cityDays?.[1] && (KNOWN_CITIES.test(cityDays[1]) || isKnownCountryLabel(cityDays[1]))) {
      return acceptParsedDestination(cityDays[1]);
    }

    const monthDest = t.match(/(\d{1,2})\s*月\s*(?:想)?去([\u4e00-\u9fff]{2,10})/);
    if (monthDest?.[2]) return acceptParsedDestination(monthDest[2]);

    const destMonth = t.match(/([\u4e00-\u9fff]{2,10})(\d{1,2})\s*月/);
    if (destMonth?.[1]) return acceptParsedDestination(destMonth[1]);

    const destMonthGo = t.match(/(?:想)?去([\u4e00-\u9fff]{2,10})\s*(\d{1,2})\s*月/);
    if (destMonthGo?.[1]) return acceptParsedDestination(destMonthGo[1]);

    const wantGo = t.match(/(?:我)?(?:想)?去([\u4e00-\u9fffA-Za-z]{2,10})(?:[啊呀呢吧]|$|，|。)/);
    if (wantGo?.[1]) {
      const accepted = acceptParsedDestination(wantGo[1]);
      if (accepted) return accepted;
    }

    const patterns = [
      /(?:我想?去|要去|想去|幫我規劃|規劃|安排)([\u4e00-\u9fffA-Za-z]{2,10})(?:走走|逛逛|玩|旅行|旅遊|，|。|$)/,
      /去([\u4e00-\u9fffA-Za-z]{2,10})(?:走走|逛逛|玩|，|。|$)/,
    ];

    for (const re of patterns) {
      const m = t.match(re);
      const city = m?.[1];
      if (city && isKnownDestinationLabel(city)) {
        const accepted = acceptParsedDestination(city);
        if (accepted) return accepted;
      }
    }

    const selection = parseDestinationSelectionFromText(t);
    if (selection) return selection;

    const bare = t.match(KNOWN_CITIES);
    if (bare) return acceptParsedDestination(`${bare[1]}${bare[2] ?? ""}`);

    const touristBare = t.match(KNOWN_TOURIST_CITIES);
    if (touristBare) return acceptParsedDestination(touristBare[1]);

    const countryBare = t.match(KNOWN_COUNTRIES);
    if (countryBare) return acceptParsedDestination(countryBare[1]);

    return undefined;
  } catch (e) {
    console.warn("[trip-planning] parseDestinationFromText failed", e);
    return undefined;
  }
}

export function isNearbyExploreText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (parseDestinationFromText(t) && !/(附近|這一帶|現在|今天)/.test(t)) return false;
  return /(附近|這一帶|現在|今天|當下|離我|我這邊|我附近)/.test(t);
}

export function isDestinationPlanningText(text: string, session: ChatPlanningSession): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isDestinationAdviceText(t)) return true;
  if (detectChatIntent(t) === "trip_planning") return true;
  if (detectChatIntent(t) === "destination_advice") return true;
  if (/(我想?去|要去|想去|幫我規劃|規劃.*行程|安排.*行程)/.test(t) && parseDestinationFromText(t)) {
    return true;
  }
  if (/\d+\s*天/.test(t) && parseDestinationFromText(t)) return true;
  if (/\d+\s*月/.test(t) && (parseDestinationFromText(t) || session.travelContext?.destination)) {
    return true;
  }
  if (/(走走|逛逛|玩)/.test(t) && parseDestinationFromText(t) && !isNearbyExploreText(t)) {
    return true;
  }
  return false;
}

export function isUserAtDestination(
  session: ChatPlanningSession,
  destination?: string,
): boolean {
  if (!destination?.trim()) return false;
  const current =
    session.location?.city ??
    session.travelContext?.currentLocation ??
    session.travelContext?.destination;
  if (!current?.trim()) return false;
  return normalizeCityLabel(current) === normalizeCityLabel(destination);
}

export function resolveConversationMode(
  text: string,
  session: ChatPlanningSession,
): ChatConversationMode {
  if (isTripAddPlaceSession(session)) {
    return "trip_add_place";
  }
  if (session.homeMoodShortcutEntry && !session.homeMoodShortcutEngaged) {
    return "mood_recommend";
  }
  if (session.fromMoodFlow || session.fromMoodCard) {
    return "mood_recommend";
  }
  if (
    session.placeDetailFocus ||
    session.selectedPlaceFromMood ||
    (session.phase === "followup" && session.selectedPlaces.length > 0 && !isDestinationPlanningText(text, session))
  ) {
    return "place_focus";
  }

  const persisted = session.tripPlanningContext?.intent;
  if (
    (persisted === "destination_planning" || isDestinationAdviceActive(session)) &&
    !isNearbyExploreText(text)
  ) {
    return "destination_planning";
  }
  if (persisted === "nearby_explore" && isNearbyExploreText(text)) {
    return "nearby_explore";
  }

  const dest =
    parseDestinationFromText(text) ??
    session.travelContext?.destination ??
    session.preferredArea;

  if (isNearbyExploreText(text) || (dest && isUserAtDestination(session, dest) && /(走走|逛逛)/.test(text))) {
    return "nearby_explore";
  }

  if (isDestinationPlanningText(text, session) || session.conversationMode === "destination_planning") {
    return "destination_planning";
  }

  if (isNearbyPlaceIntent(detectChatIntent(text))) {
    return "nearby_explore";
  }

  return persisted ?? session.conversationMode ?? "general";
}

export function tripLocationFromCity(city: string): TripLocation {
  const label = city.trim();
  return {
    placeId: "",
    country: "",
    city: label,
    lat: 0,
    lng: 0,
    formattedName: label,
    displayLabel: label,
  };
}

export function mergeTripPlanningContext(
  text: string,
  session: ChatPlanningSession,
  travelCtx: CanonicalTravelContext,
): { context: TripPlanningContext; session: ChatPlanningSession } {
  try {
    if (isTripAddPlaceSession(session)) {
      const ctx = session.tripAddPlaceContext!;
      const prev = session.tripPlanningContext ?? EMPTY_TRIP_PLANNING_CONTEXT;
      const reinforced = reinforceTripAddPlaceSession(session, text);
      const context: TripPlanningContext = {
        ...prev,
        destination: ctx.destination,
        days: ctx.tripDates.dayCount ?? prev.days,
        intent: "trip_add_place",
      };
      return { context, session: reinforced };
    }

    const mode = resolveConversationMode(text, session);
    const prev = session.tripPlanningContext ?? EMPTY_TRIP_PLANNING_CONTEXT;
    const skipDestParse = mode === "mood_recommend" || isMoodRecommendationSession(session);
    const parsedDest = skipDestParse ? undefined : parseDestinationFromText(text);

    const destination =
      parsedDest ??
      (skipDestParse ? undefined : travelCtx.destination) ??
      prev.destination ??
      session.tripDestination?.city ??
      (skipDestParse ? undefined : session.preferredArea);

    const days = travelCtx.days ?? session.tripDays ?? prev.days;
    const travelMonth = travelCtx.travelMonth ?? prev.travelMonth;
    const travelStyle =
      travelCtx.travelStyle ??
      travelCtx.vibe ??
      session.discovery?.vibe ??
      prev.travelStyle;

    const context: TripPlanningContext = {
      destination,
      origin: session.tripOrigin?.displayLabel ?? session.tripOrigin?.city ?? prev.origin,
      startDate: travelCtx.startDate ?? session.tripStartDate ?? prev.startDate,
      endDate: travelCtx.endDate ?? session.tripEndDate ?? prev.endDate,
      days,
      budget: travelCtx.budgetLevel ?? session.budget ?? prev.budget,
      travelStyle,
      transportation: travelCtx.transportMode ?? session.transportation ?? prev.transportation,
      peopleCount: prev.peopleCount,
      travelMonth,
      selectedPlaces: session.selectedPlaces.map((p) => p.name),
      intent: mode,
    };

    let nextSession: ChatPlanningSession = {
      ...session,
      tripPlanningContext: context,
      conversationMode: mode,
      preferredArea: destination ?? session.preferredArea,
    };

    if (destination && mode === "destination_planning" && !session.tripDestination?.city) {
      nextSession = {
        ...nextSession,
        tripDestination: tripLocationFromCity(destination),
      };
    }

    if (mode === "destination_planning") {
      nextSession = {
        ...nextSession,
        activeChatIntent: undefined,
        phase: nextSession.phase === "discover" ? "recommend" : nextSession.phase,
      };
    }

    return { context, session: nextSession };
  } catch (e) {
    console.warn("[trip-planning] mergeTripPlanningContext failed", e);
    return {
      context: session.tripPlanningContext ?? EMPTY_TRIP_PLANNING_CONTEXT,
      session,
    };
  }
}

export function hasRemoteDestination(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): boolean {
  const dest =
    ctx.destination ??
    session.tripPlanningContext?.destination ??
    session.preferredArea ??
    session.tripDestination?.city;
  if (!dest?.trim()) return false;
  return !isUserAtDestination(session, dest);
}

export function missingDestinationPlanningKeys(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): TripIntentMissingKey[] {
  const planning = session.tripPlanningContext;
  const dest =
    ctx.destination ?? planning?.destination ?? session.tripDestination?.city;
  const missing: TripIntentMissingKey[] = [];

  if (!dest?.trim()) missing.push("destination");

  const hasStyle = Boolean(
    ctx.vibe?.trim() ||
      ctx.travelStyle?.trim() ||
      planning?.travelStyle?.trim() ||
      session.discovery?.vibe?.trim(),
  );
  if (dest && !hasStyle) missing.push("vibe");

  return missing;
}

export function buildDestinationPlanningClarify(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  key: TripIntentMissingKey,
): string {
  const dest = ctx.destination ?? session.tripPlanningContext?.destination ?? "這趟";
  const days = ctx.days ?? session.tripDays ?? session.tripPlanningContext?.days;
  const daysLabel = days ? ` ${days} 天` : "";
  const month = ctx.travelMonth ?? session.tripPlanningContext?.travelMonth;

  switch (key) {
    case "destination":
      return "你想去哪個城市或地區呢？跟我說目的地，我幫你往下規劃。";
    case "vibe":
      return [
        `好，我先幫你抓${dest}${daysLabel}${month ? `（${month}）` : ""}的方向。`,
        "你想要偏向：",
        "1. 經典景點",
        "2. 美食咖啡",
        "3. 動漫購物",
        "4. 慢步調散策",
        "",
        "也可以直接跟我說偏好，或回「都可以」讓我依熱門路線推薦。",
      ].join("\n");
    case "date":
      if (days && !ctx.startDate && !month) {
        return `好的，${dest}${daysLabel}。大概什麼時候出發呢？有月份或日期都可以跟我說。`;
      }
      return `大概什麼時候出發呢？有月份或具體日期都可以。`;
    case "companionship":
      return "這次是獨自、情侶、朋友還是家人一起呢？";
    case "setting":
      return "比較想室內慢慢逛，還是戶外走走？";
    default:
      return `跟我多說一點${dest}這趟想怎麼玩吧。`;
  }
}

export function formatTripPlanningContextForAi(ctx: TripPlanningContext): string {
  const lines = ["【Trip Planning Context】", `mode: ${ctx.intent}`];
  if (ctx.destination) lines.push(`destination: ${ctx.destination}`);
  if (ctx.origin) lines.push(`origin: ${ctx.origin}`);
  if (ctx.startDate) lines.push(`startDate: ${ctx.startDate}`);
  if (ctx.endDate) lines.push(`endDate: ${ctx.endDate}`);
  if (ctx.days) lines.push(`days: ${ctx.days}`);
  if (ctx.travelMonth) lines.push(`travelMonth: ${ctx.travelMonth}`);
  if (ctx.budget) lines.push(`budget: ${ctx.budget}`);
  if (ctx.travelStyle) lines.push(`travelStyle: ${ctx.travelStyle}`);
  if (ctx.transportation) lines.push(`transportation: ${ctx.transportation}`);
  if (ctx.peopleCount) lines.push(`peopleCount: ${ctx.peopleCount}`);
  if (ctx.selectedPlaces.length) lines.push(`selectedPlaces: ${ctx.selectedPlaces.join("、")}`);
  return lines.join("\n");
}
