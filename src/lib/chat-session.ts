import { normalizeRecommendationItem, type RoamieRecommendationItem } from "@/lib/ai/types";
import type { RoamieLocation } from "@/lib/ai/context";
import type { WeatherSummary } from "@/lib/weather.functions";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { ChatMsg } from "@/lib/chat-history";
import { buildPlaceMapsUrl } from "@/lib/maps-navigation";
import type { PlaceResult } from "@/lib/places.functions";
import { buildTemplateReason } from "@/lib/place-reason";

const SESSION_KEY = "roamie:chat-planning";

export type ChatPhase =
  | "recommend"
  | "followup"
  | "collect"
  | "ready"
  | "generating"
  | "done";

export type ChatPlaceItem = RoamieRecommendationItem & {
  lat?: number | null;
  lng?: number | null;
  googleMapsUrl?: string;
  placeName?: string;
  reasonSource?: "template" | "ai";
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
  preferences?: TravelPreferences;
  location?: RoamieLocation;
  weather?: WeatherSummary | null;
  recommendedPlaces: ChatPlaceItem[];
  selectedPlaces: ChatPlaceItem[];
  transportation?: string;
  budget?: string;
  pace?: string;
  travelDate?: string;
  startTime?: string;
  endTime?: string;
  phase: ChatPhase;
  recommendationId?: string;
  conversationSummary?: string;
  recommendationTitle?: string;
  /** 從推薦頁進入後需產生情境開場 */
  pendingHandoff?: boolean;
  lastGeneratedTripId?: string;
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
    phase: "recommend",
    updatedAt: new Date().toISOString(),
  };
}

export function loadChatSession(): ChatPlanningSession {
  if (typeof window === "undefined") return createEmptySession();
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return createEmptySession();
    return { ...createEmptySession(), ...JSON.parse(raw) } as ChatPlanningSession;
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
  ctx: { mood?: string; weather?: WeatherSummary | null },
): ChatPlaceItem {
  const lat = p.lat ?? undefined;
  const lng = p.lng ?? undefined;
  const googleMapsUrl =
    lat != null && lng != null ? buildPlaceMapsUrl(lat, lng, p.name) : undefined;
  const reason = buildTemplateReason({
    mood: ctx.mood,
    weather: ctx.weather,
    primaryType: p.primaryType,
    categoryLabel: p.primaryType ?? undefined,
  });
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
  });
}

export function roamieRecToChatItem(rec: RoamieRecommendationItem): ChatPlaceItem {
  const normalized = normalizeRecommendationItem(rec);
  const lat = normalized.lat;
  const lng = normalized.lng;
  return {
    ...normalized,
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
  const recs = (data.recommendations ?? []).map(roamieRecToChatItem);
  return {
    ...session,
    mood: data.moodTag || session.mood,
    recommendedPlaces: recs.length ? recs : session.recommendedPlaces,
    phase,
    conversationSummary: data.summary || session.conversationSummary,
  };
}

export function addSelectedPlace(session: ChatPlanningSession, place: ChatPlaceItem): ChatPlanningSession {
  const exists = session.selectedPlaces.some((p) => p.name === place.name);
  return {
    ...session,
    selectedPlaces: exists ? session.selectedPlaces : [...session.selectedPlaces, place],
    phase: session.phase === "recommend" ? "followup" : session.phase,
  };
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

/** 推薦頁進聊天前的靜態開場（AI 失敗時 fallback） */
export function buildHandoffOpeningFallback(session: ChatPlanningSession): string {
  const mood = session.mood ? `承接你「${session.mood}」的心情，` : "";
  const title = session.recommendationTitle ? `關於「${session.recommendationTitle}」，` : "";

  if (session.selectedPlaces.length > 0) {
    const names = session.selectedPlaces.map((p) => placeDisplayName(p)).join("、");
    return `${mood}${title}我看到你選了 ${names}。我們可以把它排成一趟不趕路的行程。你想偏放鬆、多拍拍照，還是順便安排吃的？還有沒有其他地方想一起去？`;
  }

  const candidates = session.recommendedPlaces.map((p) => placeDisplayName(p)).join("、");
  return `${mood}${title}我整理了幾個地方：${candidates}。你想先從哪一個開始安排？也可以跟我說想要的節奏、交通方式或預算。`;
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
  const t = text.trim();
  let next = { ...session };

  const transportMatch = t.match(/(開車|走路|步行|捷運|公車|地鐵|騎車|單車|計程車|Uber)/);
  if (transportMatch) next.transportation = transportMatch[1];

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

  if (next.selectedPlaces.length >= 1 && (next.transportation || next.budget || next.pace)) {
    if (next.phase === "followup" || next.phase === "collect") next.phase = "collect";
  }

  if (
    /完成了|幫我排|生成行程|確認行程|整理成.+行程|好，.+排/.test(t) &&
    next.selectedPlaces.length >= 1
  ) {
    next.phase = "ready";
  }

  return next;
}

export function canGenerateItinerary(session: ChatPlanningSession): boolean {
  if (session.selectedPlaces.length < 1) return false;
  if (session.phase === "generating" || session.phase === "done") return false;
  return session.phase === "ready" || session.phase === "collect" || session.phase === "followup";
}

export function buildConversationSummary(session: ChatPlanningSession, msgs: ChatMsg[]): string {
  const recent = msgs
    .filter((m) => m.content.trim())
    .slice(-8)
    .map((m) => `${m.role === "user" ? "使用者" : "Roamie"}：${m.content.slice(0, 200)}`)
    .join("\n");
  const parts = [
    session.conversationSummary,
    session.mood ? `心情：${session.mood}` : "",
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

export function initSessionFromRecommendation(payload: {
  moodTag?: string;
  summary?: string;
  title?: string;
  recommendations: RoamieRecommendationItem[];
  selectedPlaces?: RoamieRecommendationItem[];
  recommendationId?: string;
  location?: RoamieLocation;
  weather?: WeatherSummary | null;
  preferences?: TravelPreferences;
}): ChatPlanningSession {
  const recommended = payload.recommendations.map(roamieRecToChatItem);
  const selected = (payload.selectedPlaces ?? []).map(roamieRecToChatItem);
  return {
    ...createEmptySession(),
    mood: payload.moodTag,
    conversationSummary: payload.summary,
    recommendationTitle: payload.title,
    recommendedPlaces: recommended,
    selectedPlaces: selected,
    phase: "collect",
    recommendationId: payload.recommendationId,
    location: payload.location,
    weather: payload.weather,
    preferences: payload.preferences,
    pendingHandoff: true,
  };
}

export function buildHandoffRoamiePayload(session: ChatPlanningSession, summary: string) {
  return {
    title: session.recommendationTitle ?? session.mood ?? "你的慢旅行",
    summary,
    moodTag: session.mood ?? "",
    recommendations: session.recommendedPlaces,
    itinerary: [] as [],
  };
}
