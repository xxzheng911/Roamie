import type { RoamieRecommendationItem } from "@/lib/ai/types";
import {
  BUDGET_MODE_LABELS,
  resolveBudgetMode,
  type TravelPreferences,
} from "@/lib/preferences-storage";
import type { WeatherSummary } from "@/lib/weather.functions";
import { formatTemporalWeatherBlock } from "@/lib/weather-context";

export type RoamieLocation = {
  lat: number;
  lng: number;
  city?: string;
};

export type RoamieChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RoamieAIMode = "chat" | "recommend" | "itinerary";

export type ChatPhase =
  | "recommend"
  | "followup"
  | "collect"
  | "ready"
  | "enrich"
  | "handoff"
  | "expand"
  | "confirm";

export type ChatPlanningHints = {
  transportation?: string;
  budget?: string;
  pace?: string;
  travelDate?: string;
  startTime?: string;
  endTime?: string;
  conversationSummary?: string;
};

export type RoamieItineraryRequest = {
  destination: string;
  days: number;
  budget: "low" | "medium" | "high";
  style?: string;
  mood?: string;
  interests?: string;
  startDate?: string;
  endDate?: string;
  origin?: string;
  travelers?: number;
  transport?: string;
  selectedPlaces?: RoamieRecommendationItem[];
};

export type RoamieRequestContext = {
  mode: RoamieAIMode;
  mood?: string;
  preferences?: TravelPreferences;
  location?: RoamieLocation;
  weather?: WeatherSummary | null;
  time?: string;
  chatInput?: string;
  messages?: RoamieChatMessage[];
  itineraryRequest?: RoamieItineraryRequest;
  /** Chat planning flow phase */
  chatPhase?: ChatPhase;
  focusedPlace?: RoamieRecommendationItem;
  selectedPlaces?: RoamieRecommendationItem[];
  /** 心情推薦頁帶入的完整候選清單 */
  recommendedPlaces?: RoamieRecommendationItem[];
  planningHints?: ChatPlanningHints;
  /** 近期已推薦過的地名，避免重複 */
  recentRecommendationNames?: string[];
  /** 使用者收藏地點名稱 */
  savedPlaceNames?: string[];
};

const paceLabel: Record<string, string> = { slow: "慢", medium: "中等", active: "想多看" };
const vibeLabel: Record<string, string> = { quiet: "安靜", either: "都可以", lively: "熱鬧" };
const budgetLabel: Record<string, string> = {
  shoestring: "省一點",
  comfortable: "剛剛好",
  premium: "舒服一點",
  low: "省錢",
  medium: "適中",
  high: "舒適",
};

export function formatPreferences(prefs?: TravelPreferences): string {
  if (!prefs) return "（尚未設定旅行偏好）";
  const parts: string[] = [];
  if (prefs.pace) parts.push(`步調：${paceLabel[prefs.pace] ?? prefs.pace}`);
  if (prefs.vibe) parts.push(`氛圍：${vibeLabel[prefs.vibe] ?? prefs.vibe}`);
  const bm = resolveBudgetMode(prefs);
  parts.push(`預算模式：${BUDGET_MODE_LABELS[bm]}（餐飲/咖啡/景點/住宿需符合此範圍）`);
  if (prefs.avoid?.length) parts.push(`想避開：${prefs.avoid.join("、")}`);
  if (prefs.interests?.length) parts.push(`興趣：${prefs.interests.join("、")}`);
  return parts.length ? parts.join("；") : "（尚未設定旅行偏好）";
}

export function formatWeather(weather?: WeatherSummary | null): string {
  if (!weather) return "（天氣資料未取得）";
  const temp =
    weather.tempC !== null && weather.tempC !== undefined ? `${Math.round(weather.tempC)}°C` : "";
  const precip =
    weather.precipProbability !== null && weather.precipProbability !== undefined
      ? `、降雨機率 ${weather.precipProbability}%`
      : "";
  return `${weather.city || "目前位置"} · ${weather.condition}${temp ? ` · ${temp}` : ""}${precip} · ${weather.recommendationText}`;
}

export function formatLocation(loc?: RoamieLocation): string {
  if (!loc) return "（位置未取得）";
  return loc.city
    ? `${loc.city}（${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}）`
    : `緯度 ${loc.lat.toFixed(4)}, 經度 ${loc.lng.toFixed(4)}`;
}

export function formatTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString("zh-TW", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Taipei",
  });
}

export function formatSelectedPlaces(places?: RoamieRecommendationItem[]): string {
  if (!places?.length) return "（無先前推薦地點，請依目的地規劃）";
  return places
    .map((p, i) => {
      const coords =
        p.lat != null && p.lng != null ? `｜座標：${p.lat}, ${p.lng}` : "";
      return `${i + 1}. ${p.placeName ?? p.name}｜類型：${p.type}｜${p.description}｜理由：${p.reason}｜地址：${p.address}｜建議停留：${p.estimatedTime}${coords}`;
    })
    .join("\n");
}

export function formatPlanningHints(hints?: ChatPlanningHints): string {
  if (!hints) return "（尚未收集交通/預算/時間）";
  const lines: string[] = [];
  if (hints.transportation) lines.push(`交通：${hints.transportation}`);
  if (hints.budget) lines.push(`預算：${hints.budget}`);
  if (hints.pace) lines.push(`節奏：${hints.pace}`);
  if (hints.travelDate) lines.push(`日期：${hints.travelDate}`);
  if (hints.startTime || hints.endTime)
    lines.push(`時段：${hints.startTime ?? "?"} - ${hints.endTime ?? "?"}`);
  if (hints.conversationSummary) lines.push(`對話摘要：${hints.conversationSummary.slice(0, 400)}`);
  return lines.length ? lines.join("\n") : "（尚未收集交通/預算/時間）";
}

export function buildContextBlock(ctx: RoamieRequestContext): string {
  const lines = [
    formatTemporalWeatherBlock(ctx.weather, ctx.time),
    `【心情】${ctx.mood?.trim() || "（未指定，請從對話推測）"}`,
    `【旅行偏好】${formatPreferences(ctx.preferences)}`,
    `【位置】${formatLocation(ctx.location)}`,
    `【天氣摘要】${formatWeather(ctx.weather)}`,
  ];
  if (ctx.chatInput?.trim()) lines.push(`【使用者輸入】${ctx.chatInput.trim()}`);
  if (ctx.chatPhase) lines.push(`【對話階段】${ctx.chatPhase}`);
  if (ctx.focusedPlace)
    lines.push(
      `【使用者剛選的地點】${ctx.focusedPlace.placeName ?? ctx.focusedPlace.name}（${ctx.focusedPlace.type}）— ${ctx.focusedPlace.reason}`,
    );
  if (ctx.selectedPlaces?.length)
    lines.push(`【已選地點（優先規劃）】\n${formatSelectedPlaces(ctx.selectedPlaces)}`);
  if (ctx.recommendedPlaces?.length)
    lines.push(`【本頁推薦候選】\n${formatSelectedPlaces(ctx.recommendedPlaces)}`);
  if (ctx.planningHints) lines.push(`【規劃資訊】\n${formatPlanningHints(ctx.planningHints)}`);
  if (ctx.recentRecommendationNames?.length)
    lines.push(`【近期已推薦過，請避免重複】${ctx.recentRecommendationNames.join("、")}`);
  if (ctx.savedPlaceNames?.length)
    lines.push(`【使用者收藏地點】${ctx.savedPlaceNames.join("、")}`);
  return lines.join("\n");
}

export function budgetModeToItineraryTier(
  mode: ReturnType<typeof resolveBudgetMode>,
): "low" | "medium" | "high" {
  if (mode === "budget") return "low";
  if (mode === "luxury") return "high";
  return "medium";
}
