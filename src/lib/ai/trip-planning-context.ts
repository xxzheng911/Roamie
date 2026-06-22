import type { ChatPlanningSession } from "@/lib/chat-session";
import type { TripLocation } from "@/lib/location/types";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { detectChatIntent, isNearbyPlaceIntent } from "@/lib/ai/chat-intent";
import type { TripIntentMissingKey } from "@/lib/recommendation/trip-intent";

/** A 附近探索 | B 目的地規劃 | C 特定地點 | D 心情推薦 */
export type ChatConversationMode =
  | "nearby_explore"
  | "destination_planning"
  | "place_focus"
  | "mood_recommend"
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

export function normalizeCityLabel(name: string): string {
  return name.trim().replace(/(市|縣|都|府)$/, "");
}

export function parseDestinationFromText(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;

  const withDays = t.match(/我想?去([\u4e00-\u9fff]{2,8})(\d+)\s*天/);
  if (withDays?.[1]) return normalizeCityLabel(withDays[1]);

  const cityDays = t.match(/([\u4e00-\u9fff]{2,8})\s*(\d+)\s*天/);
  if (cityDays?.[1] && KNOWN_CITIES.test(cityDays[1])) {
    return normalizeCityLabel(cityDays[1]);
  }

  const monthDest = t.match(/(\d{1,2})\s*月\s*(?:想)?去([\u4e00-\u9fff]{2,10})/);
  if (monthDest?.[2]) return normalizeCityLabel(monthDest[2]);

  const destMonth = t.match(/(?:想)?去([\u4e00-\u9fff]{2,10})\s*(\d{1,2})\s*月/);
  if (destMonth?.[1]) return normalizeCityLabel(destMonth[1]);

  const patterns = [
    /(?:我想?去|要去|想去|幫我規劃|規劃|安排)([\u4e00-\u9fffA-Za-z]{2,10})(?:走走|逛逛|玩|旅行|旅遊|，|。|$)/,
    /去([\u4e00-\u9fffA-Za-z]{2,10})(?:走走|逛逛|玩|，|。|$)/,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    const city = m?.[1];
    if (city && (KNOWN_CITIES.test(city) || city.length >= 2)) {
      return normalizeCityLabel(city);
    }
  }

  const bare = t.match(KNOWN_CITIES);
  if (bare) return normalizeCityLabel(`${bare[1]}${bare[2] ?? ""}`);
  return undefined;
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
  if (detectChatIntent(t) === "trip_planning") return true;
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
  if (session.homeMoodShortcutEntry && !session.homeMoodShortcutEngaged) {
    return "mood_recommend";
  }
  if (session.fromMoodFlow || session.fromMoodCard) {
    return "mood_recommend";
  }
  if (
    session.selectedPlaceFromMood ||
    (session.phase === "followup" && session.selectedPlaces.length > 0 && !isDestinationPlanningText(text, session))
  ) {
    return "place_focus";
  }

  const persisted = session.tripPlanningContext?.intent;
  if (persisted === "destination_planning" && !isNearbyExploreText(text)) {
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
  const mode = resolveConversationMode(text, session);
  const prev = session.tripPlanningContext ?? EMPTY_TRIP_PLANNING_CONTEXT;
  const parsedDest = parseDestinationFromText(text);

  const destination =
    parsedDest ??
    travelCtx.destination ??
    prev.destination ??
    session.tripDestination?.city ??
    session.preferredArea;

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
