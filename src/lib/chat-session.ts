import {
  normalizeRecommendationItem,
  type RoamiePayloadV2,
  type RoamieRecommendationItem,
} from "@/lib/ai/types";
import type { RoamieLocation } from "@/lib/ai/context";
import type { TripLocation } from "@/lib/location/types";
import type { Locale } from "@/lib/i18n/types";
import type { WeatherSummary } from "@/lib/weather.functions";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { ChatMsg } from "@/lib/chat-history";
import { buildPlaceMapsUrl } from "@/lib/maps-navigation";
import type { PlaceResult } from "@/lib/place-result";
import {
  buildPlaceRecommendationReason,
  type UserProfileForReason,
} from "@/lib/build-place-recommendation-reason";
import {
  buildContextualMoodHandoffOpening,
  buildHandoffRoamiePayload,
  buildInitialChatContext,
  prepareMoodFlowSession,
  enrichPlacesWithDistance,
  type MoodFlowHandoffInput,
} from "@/lib/mood-chat-handoff";
import {
  mergeRecommendationsWithSelected,
  syncSessionPlaceMemory,
} from "@/lib/place-planning-memory";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { TripIntentMissingKey } from "@/lib/recommendation/trip-intent";

export {
  buildContextualMoodHandoffOpening,
  buildHandoffRoamiePayload,
  buildInitialChatContext,
  prepareMoodFlowSession,
};
export type { MoodFlowHandoffInput };

const SESSION_KEY = "roamie:chat-planning";

export type ChatPhase =
  | "discover"
  | "recommend"
  | "followup"
  | "collect"
  | "ready"
  | "generating"
  | "done";

/** 聊天開場收集：今天想怎麼過、跟誰、室內外、必去點 */
export type ChatDiscovery = {
  vibe?: string;
  companionship?: string;
  setting?: string;
  mustVisit?: string;
};

export type ChatPlaceItem = RoamieRecommendationItem & {
  lat?: number | null;
  lng?: number | null;
  googleMapsUrl?: string;
  placeName?: string;
  placeId?: string;
  photoName?: string | null;
  rating?: number | null;
  reasonSource?: "template" | "ai";
  distanceMeters?: number | null;
  distanceLabel?: string;
};

/** 規劃用標準地點欄位（地圖、導航、行程） */
export type SelectedPlaceRecord = {
  name: string;
  category: string;
  address: string;
  lat: number | null;
  lng: number | null;
  estimatedDuration: string;
  description: string;
  reason?: string;
  googleMapsUrl?: string;
};

export type ChatPlanningSession = {
  mood?: string;
  /** 心情卡片類別（與 mood 相同或延伸標籤） */
  selectedCategory?: string;
  discovery?: ChatDiscovery;
  preferences?: TravelPreferences;
  location?: RoamieLocation;
  weather?: WeatherSummary | null;
  recommendedPlaces: ChatPlaceItem[];
  selectedPlaces: ChatPlaceItem[];
  selectedPlaceIds?: string[];
  selectedPlaceNames?: string[];
  /** 使用者拒絕的地點名稱 */
  rejectedPlaceNames?: string[];
  /** 已選 + 聊天中新增，用於行程 */
  plannedStops?: ChatPlaceItem[];
  /** 從心情推薦頁勾選的主要地點 */
  selectedPlaceFromMood?: ChatPlaceItem;
  transportation?: string;
  budget?: string;
  pace?: string;
  travelDate?: string;
  startTime?: string;
  endTime?: string;
  phase: ChatPhase;
  /** Canonical AI travel context (merged each turn) */
  travelContext?: CanonicalTravelContext;
  /** Clarifying keys already asked — avoid repeat questions */
  askedClarifyKeys?: TripIntentMissingKey[];
  recommendationId?: string;
  conversationSummary?: string;
  recommendationTitle?: string;
  /** 從心情卡片 → 推薦頁 → 聊天 */
  fromMoodCard?: boolean;
  /** 心情卡片完整流程進聊天 */
  fromMoodFlow?: boolean;
  /** 首頁 Plus「個人化旅遊中心」→ 聊天 */
  fromPlusHome?: boolean;
  /** Plus 首頁動態一句描述（handoff 用） */
  plusHomeInsight?: string;
  /** Plus 首頁情境開場已完成 */
  plusHomeHandoffDone?: boolean;
  selectedMood?: string;
  /** 進聊天時注入 AI 的結構化上下文 */
  initialChatContext?: string;
  /** 已完成情境開場，避免刷新重複 */
  moodHandoffDone?: boolean;
  /** 深夜模式（22:00–04:59） */
  lateNightMode?: boolean;
  /** 使用者不想去的類型／氛圍 */
  avoidTypes?: string[];
  /** 想去的區域或「附近」 */
  preferredArea?: string;
  /** 明確拒絕的地點名稱 */
  rejectedPlaceNames?: string[];
  /** 最後一則使用者訊息（規劃用） */
  lastUserIntent?: string;
  /** 從推薦頁進入後需產生情境開場 */
  pendingHandoff?: boolean;
  /** AI 產生的行程草稿（未寫入收藏） */
  draftTrip?: RoamiePayloadV2;
  /** 已確認儲存至收藏的行程 id */
  lastGeneratedTripId?: string;
  /** 規劃表單選定的旅遊目的地 */
  tripDestination?: TripLocation;
  /** 規劃表單出發地 */
  tripOrigin?: TripLocation | null;
  /** 從「規劃新行程」進入聊天 */
  fromPlanForm?: boolean;
  /** 規劃表單開場已完成 */
  planHandoffDone?: boolean;
  tripStartDate?: string;
  tripEndDate?: string;
  tripDays?: number;
  tripStyles?: string;
  /** 規劃表單旅伴人數 */
  tripCompanionCount?: number;
  updatedAt: string;
};

export function toSelectedPlaceRecord(p: ChatPlaceItem): SelectedPlaceRecord {
  return {
    name: p.name,
    category: p.type,
    address: p.address,
    lat: p.lat ?? null,
    lng: p.lng ?? null,
    estimatedDuration: p.estimatedTime,
    description: p.description,
    reason: p.reason,
    googleMapsUrl: p.googleMapsUrl,
  };
}

const REC_PICKS_PREFIX = "roamie:rec-picks:";

export function loadRecPagePicks(recommendationId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(`${REC_PICKS_PREFIX}${recommendationId}`);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveRecPagePicks(recommendationId: string, names: string[]): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(`${REC_PICKS_PREFIX}${recommendationId}`, JSON.stringify(names));
}

export function createEmptySession(): ChatPlanningSession {
  return {
    recommendedPlaces: [],
    selectedPlaces: [],
    phase: "discover",
    discovery: {},
    updatedAt: new Date().toISOString(),
  };
}

const DISCOVERY_KEYS: (keyof ChatDiscovery)[] = ["vibe", "companionship", "setting"];

export function nextMissingDiscoveryKey(discovery?: ChatDiscovery): keyof ChatDiscovery | null {
  const d = discovery ?? {};
  for (const key of DISCOVERY_KEYS) {
    if (!d[key]?.trim()) return key;
  }
  return null;
}

function sessionHasTripDestination(session: ChatPlanningSession): boolean {
  return Boolean(
    session.tripDestination?.displayLabel?.trim() ||
      session.tripDestination?.city?.trim() ||
      session.location?.city?.trim() ||
      session.preferredArea?.trim(),
  );
}

export function isDiscoveryComplete(session: ChatPlanningSession): boolean {
  if (session.selectedPlaces.length > 0 && session.mood) return true;
  if (session.fromMoodCard || session.fromMoodFlow) return true;
  const d = session.discovery ?? {};
  const moodLabel = session.selectedMood ?? session.mood;
  const hasVibe = Boolean(d.vibe?.trim() || moodLabel?.trim() || session.travelContext?.vibe);
  const hasCompanionship = Boolean(
    d.companionship?.trim() || session.travelContext?.companion?.trim(),
  );
  const hasSetting = Boolean(
    d.setting?.trim() ||
      session.travelContext?.setting ||
      /散步|咖啡|雨|海/.test(moodLabel ?? ""),
  );
  // 跨城市旅行：有目的地 + 心情 + 旅伴即可推薦（室內外可稍後再細調）
  if (sessionHasTripDestination(session)) {
    return hasVibe && hasCompanionship;
  }
  const hasGps =
    session.location?.lat != null &&
    session.location?.lng != null &&
    moodLabel &&
    hasCompanionship;
  if (hasGps && hasVibe) return true;
  return hasVibe && hasCompanionship && hasSetting;
}

export function discoveryLabel(key: keyof ChatDiscovery): string {
  switch (key) {
    case "vibe":
      return "今天想放鬆、探索還是拍照";
    case "companionship":
      return "一個人還是朋友／情侶";
    case "setting":
      return "想室內還是室外";
    case "mustVisit":
      return "有沒有特別想去的地點";
    default:
      return "";
  }
}

/** 從自然語句擷取開場四問的答案 */
export function extractDiscoveryFromText(
  text: string,
  session: ChatPlanningSession,
): ChatPlanningSession {
  const t = text.trim();
  if (!t) return session;
  const discovery: ChatDiscovery = { ...session.discovery };

  if (
    !discovery.vibe &&
    /(放鬆|放空|休息|慢下來|療癒|靜一靜)/.test(t)
  ) {
    discovery.vibe = "放鬆";
  } else if (!discovery.vibe && /(探索|發現|走走看看|亂逛|挖寶|新鮮)/.test(t)) {
    discovery.vibe = "探索";
  } else if (!discovery.vibe && /(拍照|攝影|打卡|取景|網美|拍美照)/.test(t)) {
    discovery.vibe = "拍照";
  } else if (!discovery.vibe && /(都有|都可以|都行|混合|都想要)/.test(t)) {
    discovery.vibe = "混合";
  }

  if (!discovery.companionship && /(一個人|獨自|自己|solo)/i.test(t)) {
    discovery.companionship = "一個人";
  } else if (!discovery.companionship && /(朋友|閨蜜|同學|同事|兄弟|姐妹)/.test(t)) {
    discovery.companionship = "朋友";
  } else if (
    !discovery.companionship &&
    /(情侶|另一半|約會|兩人世界|男朋友|女朋友|女友|男友|跟女友|和女友|跟男友|和男友)/.test(t)
  ) {
    discovery.companionship = "情侶";
  } else if (!discovery.companionship && /(家人|爸媽|父母|小孩|孩子|親子)/.test(t)) {
    discovery.companionship = "家人";
  }

  if (!discovery.setting && /(室內|室內的|不想曬|怕熱|下雨|雨)/.test(t)) {
    discovery.setting = "室內";
  } else if (!discovery.setting && /(室外|戶外|外面|曬太陽|海邊|公園|散步)/.test(t)) {
    discovery.setting = "室外";
  } else if (!discovery.setting && /(都可以|都行|都有|看情況)/.test(t)) {
    discovery.setting = "都可以";
  }

  const mustVisitMatch = t.match(
    /(?:想去|想去一下|想去看看|一定要去|想去的是|有想去的|想去的地方)[：:]?\s*(.+)/,
  );
  if (mustVisitMatch?.[1]) {
    discovery.mustVisit = mustVisitMatch[1].trim().slice(0, 120);
  } else if (
    !discovery.mustVisit &&
    /(沒有特別|沒有想|沒有一定要|隨意|都可以|你推)/.test(t)
  ) {
    discovery.mustVisit = "沒有特別";
  }

  let phase = session.phase;
  if (phase === "discover" && isDiscoveryComplete({ ...session, discovery })) {
    phase = "recommend";
  }

  return { ...session, discovery, phase };
}

/** 使用者明確表示可以排完整行程 */
export function isUserConfirmingItinerary(text: string): boolean {
  const t = text.trim();
  return /(就這樣吧|就這樣|可以開始安排|開始安排吧|幫我排行程|生成行程|確認行程|整理成.+行程|差不多了|就這些|好，排|好，幫我排|完成了|可以了|就這幾個)/.test(
    t,
  );
}

export function loadChatSession(): ChatPlanningSession {
  if (typeof window === "undefined") return createEmptySession();
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return createEmptySession();
    return syncSessionPlaceMemory({
      ...createEmptySession(),
      ...JSON.parse(raw),
    } as ChatPlanningSession);
  } catch {
    return createEmptySession();
  }
}

export function saveChatSession(session: ChatPlanningSession): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ ...session, updatedAt: new Date().toISOString() }),
  );
}

export function clearChatSession(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
}

export function placeDisplayName(p: ChatPlaceItem | RoamieRecommendationItem): string {
  return ("placeName" in p && p.placeName) || p.name;
}

export function mapPlaceResultToChatItem(
  p: PlaceResult,
  ctx: {
    mood?: string;
    weather?: WeatherSummary | null;
    userProfile?: UserProfileForReason | null;
    categoryLabel?: string;
    distanceMeters?: number;
    isSavedFavorite?: boolean;
    currentTime?: Date;
    locale?: Locale;
  },
): ChatPlaceItem {
  const lat = p.lat ?? undefined;
  const lng = p.lng ?? undefined;
  const googleMapsUrl =
    lat != null && lng != null ? buildPlaceMapsUrl(lat, lng, p.name) : undefined;
  const reason = buildPlaceRecommendationReason(
    p,
    ctx.userProfile ?? null,
    ctx.weather,
    ctx.currentTime,
    {
      mood: ctx.mood,
      categoryLabel: ctx.categoryLabel,
      distanceMeters: ctx.distanceMeters,
      isSavedFavorite: ctx.isSavedFavorite,
    },
    ctx.locale,
  );
  return normalizeRecommendationItem({
    name: p.name,
    placeName: p.name,
    type: p.primaryType ?? "地點",
    description: p.address ?? "附近推薦",
    reason,
    reasonSource: "template",
    estimatedTime: "1-2 小時",
    address: p.address ?? "",
    lat: lat ?? null,
    lng: lng ?? null,
    googleMapsUrl: googleMapsUrl ?? "",
    openStatusLabel: p.openStatusLabel || undefined,
    todayHoursLabel: p.todayHoursLabel || undefined,
    closingSoonNote: p.closingSoonNote || undefined,
    nextOpenHint: p.nextOpenHint || undefined,
  });
}

export function roamieRecToChatItem(rec: RoamieRecommendationItem): ChatPlaceItem {
  const normalized = normalizeRecommendationItem(rec);
  const lat = normalized.lat;
  const lng = normalized.lng;
  const ext = rec as RoamieRecommendationItem & {
    googlePlaceId?: string;
    photoName?: string | null;
    rating?: number | null;
  };
  return {
    ...normalized,
    photoName: ext.photoName ?? undefined,
    rating: ext.rating ?? undefined,
    placeId: ext.googlePlaceId,
    googleMapsUrl:
      normalized.googleMapsUrl ||
      (lat != null && lng != null ? buildPlaceMapsUrl(lat, lng, normalized.name) : ""),
  };
}

export function mergeSessionFromRoamie(
  session: ChatPlanningSession,
  data: { moodTag?: string; recommendations?: RoamieRecommendationItem[]; summary?: string },
  phase: ChatPhase = session.phase,
): ChatPlanningSession {
  const aiRecs = (data.recommendations ?? []).map(roamieRecToChatItem);
  const mergedRecs =
    session.selectedPlaces.length > 0
      ? mergeRecommendationsWithSelected(session.selectedPlaces, aiRecs, {
          maxNew: 4,
          location: session.location ?? null,
        })
      : aiRecs.length
        ? (() => {
            const map = new Map(session.recommendedPlaces.map((p) => [p.name, p]));
            for (const r of aiRecs) map.set(r.name, map.has(r.name) ? { ...map.get(r.name)!, ...r } : r);
            return [...map.values()];
          })()
        : session.recommendedPlaces;

  return syncSessionPlaceMemory({
    ...session,
    mood: data.moodTag || session.mood,
    recommendedPlaces: mergedRecs,
    phase,
    conversationSummary: data.summary || session.conversationSummary,
  });
}

export function addSelectedPlace(session: ChatPlanningSession, place: ChatPlaceItem): ChatPlanningSession {
  const exists = session.selectedPlaces.some((p) => p.name === place.name);
  return syncSessionPlaceMemory({
    ...session,
    selectedPlaces: exists ? session.selectedPlaces : [...session.selectedPlaces, place],
    phase: session.phase === "recommend" ? "followup" : session.phase,
  });
}

export function toggleSelectedPlace(
  session: ChatPlanningSession,
  place: ChatPlaceItem,
): ChatPlanningSession {
  const exists = session.selectedPlaces.some((p) => p.name === place.name);
  return {
    ...session,
    selectedPlaces: exists
      ? session.selectedPlaces.filter((p) => p.name !== place.name)
      : [...session.selectedPlaces, place],
  };
}

/** @deprecated 請用 buildContextualMoodHandoffOpening */
export function buildHandoffOpeningFallback(session: ChatPlanningSession): string {
  return buildContextualMoodHandoffOpening(session);
}

export function updateSelectedPlaceReason(
  session: ChatPlanningSession,
  placeName: string,
  reason: string,
): ChatPlanningSession {
  const patch = (p: ChatPlaceItem) =>
    p.name === placeName ? { ...p, reason, reasonSource: "ai" as const } : p;
  return {
    ...session,
    selectedPlaces: session.selectedPlaces.map(patch),
    recommendedPlaces: session.recommendedPlaces.map(patch),
  };
}

/** Heuristic: extract planning hints from user text */
export function extractPlanningHintsFromText(
  text: string,
  session: ChatPlanningSession,
): ChatPlanningSession {
  let next = extractDiscoveryFromText(text, session);
  const t = text.trim();

  const transportMatch = t.match(/(開車|走路|步行|捷運|公車|地鐵|騎車|單車|計程車|Uber)/);
  if (transportMatch) next.transportation = transportMatch[1];

  const travelersMatch = t.match(/(\d+)\s*(?:人|位)/);
  if (travelersMatch) {
    next.discovery = { ...next.discovery, companionship: `${travelersMatch[1]} 人` };
  }

  const budgetMatch = t.match(/(預算|花費|花費|大概|約)?\s*(\d{3,5})\s*(元|塊|NT)?/);
  if (budgetMatch) next.budget = budgetMatch[2] + " 元左右";

  if (/悠閒|慢慢|放空|不趕|少排/.test(t)) next.pace = "悠閒";
  if (/排滿|緊湊|多跑|多逛/.test(t)) next.pace = "排滿";

  const timeRange = t.match(/(\d{1,2})[:：](\d{2})\s*[-–~到]\s*(\d{1,2})[:：](\d{2})/);
  if (timeRange) {
    next.startTime = `${timeRange[1].padStart(2, "0")}:${timeRange[2]}`;
    next.endTime = `${timeRange[3].padStart(2, "0")}:${timeRange[4]}`;
  }

  if (/\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = t.match(/\d{4}-\d{2}-\d{2}/);
    if (d) next.travelDate = d[0];
  }

  if (isUserConfirmingItinerary(t)) {
    next.phase = next.selectedPlaces.length >= 1 ? "ready" : next.phase;
  }

  return next;
}

export function canGenerateItinerary(session: ChatPlanningSession): boolean {
  if (session.selectedPlaces.length < 1) return false;
  if (session.phase === "generating" || session.phase === "done") return false;
  return session.phase === "ready";
}

export function buildConversationSummary(session: ChatPlanningSession, msgs: ChatMsg[]): string {
  const recent = msgs
    .filter((m) => m.content.trim())
    .slice(-8)
    .map((m) => `${m.role === "user" ? "使用者" : "Roamie"}：${m.content.slice(0, 200)}`)
    .join("\n");
  const d = session.discovery;
  const parts = [
    session.conversationSummary,
    session.initialChatContext?.slice(0, 600),
    session.mood ? `心情：${session.mood}` : "",
    session.selectedMood ? `selectedMood：${session.selectedMood}` : "",
    session.selectedPlaces.length
      ? `已選地點：${session.selectedPlaces.map((p) => placeDisplayName(p)).join("、")}`
      : "",
    d?.vibe ? `今天想：${d.vibe}` : "",
    d?.companionship ? `旅伴：${d.companionship}` : "",
    d?.setting ? `室內外：${d.setting}` : "",
    d?.mustVisit ? `必去：${d.mustVisit}` : "",
    session.transportation ? `交通：${session.transportation}` : "",
    session.budget ? `預算：${session.budget}` : "",
    session.pace ? `節奏：${session.pace}` : "",
    session.travelDate ? `日期：${session.travelDate}` : "",
    session.startTime || session.endTime
      ? `時間：${session.startTime ?? "?"} - ${session.endTime ?? "?"}`
      : "",
    recent,
  ].filter(Boolean);
  return parts.join("\n");
}

/** @deprecated 請用 prepareMoodFlowSession（需完整 record + bundle） */
export function initSessionFromRecommendation(payload: {
  moodTag?: string;
  selectedCategory?: string;
  summary?: string;
  title?: string;
  recommendations: RoamieRecommendationItem[];
  selectedPlaces?: RoamieRecommendationItem[];
  recommendationId?: string;
  location?: RoamieLocation;
  weather?: WeatherSummary | null;
  preferences?: TravelPreferences;
  fromMoodCard?: boolean;
  lateNightMode?: boolean;
}): ChatPlanningSession {
  const recommended = payload.recommendations.map(roamieRecToChatItem);
  const selected = enrichPlacesWithDistance(
    payload.selectedPlaces ?? [],
    payload.location ?? null,
  );
  const session: ChatPlanningSession = {
    ...createEmptySession(),
    mood: payload.moodTag,
    selectedMood: payload.moodTag,
    selectedCategory: payload.selectedCategory ?? payload.moodTag,
    conversationSummary: payload.summary,
    recommendationTitle: payload.title,
    recommendedPlaces: recommended,
    selectedPlaces: selected,
    selectedPlaceFromMood: selected[0],
    phase: selected.length ? "followup" : "collect",
    discovery: payload.moodTag ? { vibe: payload.moodTag } : {},
    recommendationId: payload.recommendationId,
    location: payload.location,
    weather: payload.weather,
    preferences: payload.preferences,
    fromMoodCard: payload.fromMoodCard ?? true,
    fromMoodFlow: true,
    lateNightMode: payload.lateNightMode,
    pendingHandoff: true,
    moodHandoffDone: false,
  };
  session.initialChatContext = buildInitialChatContext(session);
  return session;
}

