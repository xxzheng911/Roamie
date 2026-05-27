import type { RoamieRecommendationItem } from "@/lib/ai/types";
import {
  BUDGET_MODE_LABELS,
  resolveBudgetMode,
  type TravelPreferences,
} from "@/lib/preferences-storage";
import type { WeatherSummary } from "@/lib/weather-types";
import { formatTemporalWeatherBlock } from "@/lib/weather-context";
import type { Locale } from "@/lib/i18n/types";
import type { PlanTier } from "@/lib/plan-tier/types";
import type { ConversationStage } from "@/lib/ai/conversation-stage";
import type { EmotionSignals } from "@/lib/ai/emotion-inference";
import type {
  LongTermMemorySnapshot,
  SessionMemorySnapshot,
} from "@/lib/ai/memory/types";
import { formatEmotionSignalsForPrompt } from "@/lib/ai/emotion-inference";
import { formatSessionMemoryForPrompt } from "@/lib/ai/memory/session-memory";
import { formatLongTermMemoryForPrompt } from "@/lib/ai/memory/long-term-memory";
import { conversationStageLabel } from "@/lib/ai/conversation-stage";

export type RoamieLocation = {
  lat: number;
  lng: number;
  city?: string;
  country?: string;
  placeId?: string;
  /** 顯示用，例如 日本・大阪 */
  displayLabel?: string;
  address?: string;
  timezone?: string;
  utcOffsetMinutes?: number | null;
};

export type RoamieChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RoamieAIMode = "chat" | "recommend" | "itinerary";

export type ChatPhase =
  | "discover"
  | "recommend"
  | "followup"
  | "collect"
  | "ready"
  | "enrich"
  | "handoff"
  | "expand"
  | "confirm";

export type ChatPlanningHints = {
  vibe?: string;
  companionship?: string;
  setting?: string;
  mustVisit?: string;
  transportation?: string;
  budget?: string;
  pace?: string;
  travelDate?: string;
  startTime?: string;
  endTime?: string;
  conversationSummary?: string;
  fromMoodCard?: boolean;
  selectedCategory?: string;
  lateNightMode?: boolean;
  avoidTypes?: string[];
  preferredArea?: string;
  rejectedPlaceNames?: string[];
  lastUserIntent?: string;
  initialChatContext?: string;
  fromMoodFlow?: boolean;
  selectedMood?: string;
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
  selectedPlaceIds?: string[];
  selectedPlaceNames?: string[];
  /** 已選 + 聊天中納入的停靠點 */
  plannedStops?: RoamieRecommendationItem[];
  /** 使用者收藏地點名稱 */
  savedPlaceNames?: string[];
  /** 從心情卡片推薦頁進入聊天 */
  fromMoodCard?: boolean;
  selectedCategory?: string;
  lateNightMode?: boolean;
  avoidTypes?: string[];
  preferredArea?: string;
  rejectedPlaceNames?: string[];
  lastUserIntent?: string;
  /** 心情卡片進聊天的結構化上下文 */
  initialChatContext?: string;
  fromMoodFlow?: boolean;
  selectedMood?: string;
  fromPlanForm?: boolean;
  locale?: Locale;
  /** AI 陪伴深度：free 基本 / plus 深度個人化 */
  planTier?: PlanTier;
  /** Roamie 六段對話階段 */
  conversationStage?: ConversationStage;
  emotionSignals?: EmotionSignals;
  sessionMemory?: SessionMemorySnapshot;
  longTermMemory?: LongTermMemorySnapshot;
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
  if (!prefs.onboarded) {
    return "（尚未完成旅行偏好測驗；可先依位置與天氣提供通用推薦，若使用者想更個人化可輕柔引導至偏好測驗）";
  }
  const parts: string[] = [];
  if (prefs.personalityType) parts.push(`旅行人格：${prefs.personalityType}`);
  if (prefs.pace) parts.push(`步調：${paceLabel[prefs.pace] ?? prefs.pace}`);
  if (prefs.vibe) parts.push(`氛圍：${vibeLabel[prefs.vibe] ?? prefs.vibe}`);
  const bm = resolveBudgetMode(prefs);
  parts.push(`預算模式：${BUDGET_MODE_LABELS[bm]}（餐飲/咖啡/景點/住宿需符合此範圍）`);
  if (prefs.avoid?.length) parts.push(`想避開：${prefs.avoid.join("、")}`);
  if (prefs.personalitySummary) parts.push(`測驗摘要：${prefs.personalitySummary}`);
  if (prefs.interests?.length) parts.push(`興趣：${prefs.interests.join("、")}`);
  return parts.length ? parts.join("；") : "（尚未設定旅行偏好）";
}

export function formatWeather(weather?: WeatherSummary | null): string {
  if (!weather) return "（天氣資料未取得）";
  if (!weather.available) return weather.recommendationText;
  const temp =
    weather.tempC !== null && weather.tempC !== undefined ? `${Math.round(weather.tempC)}°C` : "";
  const feels =
    weather.feelsLikeC != null && Math.abs(weather.feelsLikeC - (weather.tempC ?? 0)) >= 2
      ? `、體感 ${Math.round(weather.feelsLikeC)}°C`
      : "";
  const precip =
    weather.precipProbability !== null && weather.precipProbability !== undefined
      ? `、降雨機率 ${weather.precipProbability}%`
      : "";
  const clouds =
    weather.cloudCoverPercent != null ? `、雲量 ${weather.cloudCoverPercent}%` : "";
  const uvi = weather.uvi != null && weather.uvi >= 3 ? `、UV ${Math.round(weather.uvi)}` : "";
  const sun =
    weather.sunset && !weather.isDaytime ? `、日落 ${weather.sunset}` : "";
  return `${weather.city || "目前位置"} · ${weather.condition}${temp ? ` · ${temp}${feels}` : ""}${precip}${clouds}${uvi}${sun} · ${weather.recommendationText}`;
}

export function formatLocation(loc?: RoamieLocation): string {
  if (!loc) return "（位置未取得）";
  const label = loc.displayLabel ?? loc.city ?? loc.country;
  return label
    ? `${label}（${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}）`
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

export function formatSelectedPlaces(
  places?: (RoamieRecommendationItem & { distanceLabel?: string })[],
): string {
  if (!places?.length) return "（無先前推薦地點，請依目的地規劃）";
  return places
    .map((p, i) => {
      const coords =
        p.lat != null && p.lng != null ? `｜座標：${p.lat}, ${p.lng}` : "";
      const hours = [
        p.openStatusLabel ? `營業：${p.openStatusLabel}` : "",
        p.todayHoursLabel ?? "",
        p.nextOpenHint ? `｜${p.nextOpenHint}` : "",
      ]
        .filter(Boolean)
        .join("");
      const dist = p.distanceLabel ? `｜距離：${p.distanceLabel}` : "";
      return `${i + 1}. ${p.placeName ?? p.name}｜類型：${p.type}｜${p.description}｜理由：${p.reason}｜地址：${p.address}${hours ? `｜${hours}` : ""}${dist}｜建議停留：${p.estimatedTime}${coords}`;
    })
    .join("\n");
}

export function formatPlanningHints(hints?: ChatPlanningHints): string {
  if (!hints) return "（尚未收集交通/預算/時間）";
  const lines: string[] = [];
  if (hints.vibe) lines.push(`今天想：${hints.vibe}`);
  if (hints.companionship) lines.push(`旅伴：${hints.companionship}`);
  if (hints.setting) lines.push(`室內外：${hints.setting}`);
  if (hints.mustVisit) lines.push(`必去：${hints.mustVisit}`);
  if (hints.transportation) lines.push(`交通：${hints.transportation}`);
  if (hints.budget) lines.push(`預算：${hints.budget}`);
  if (hints.pace) lines.push(`節奏：${hints.pace}`);
  if (hints.travelDate) lines.push(`日期：${hints.travelDate}`);
  if (hints.startTime || hints.endTime)
    lines.push(`時段：${hints.startTime ?? "?"} - ${hints.endTime ?? "?"}`);
  if (hints.conversationSummary) lines.push(`對話摘要：${hints.conversationSummary.slice(0, 400)}`);
  if (hints.avoidTypes?.length) lines.push(`想避開：${hints.avoidTypes.join("、")}`);
  if (hints.preferredArea) lines.push(`想去的區域：${hints.preferredArea}`);
  if (hints.rejectedPlaceNames?.length)
    lines.push(`明確不要：${hints.rejectedPlaceNames.join("、")}`);
  if (hints.lastUserIntent) lines.push(`最新一句：${hints.lastUserIntent.slice(0, 200)}`);
  if (hints.selectedMood) lines.push(`心情：${hints.selectedMood}`);
  if (hints.initialChatContext) lines.push(hints.initialChatContext.slice(0, 1200));
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
  if (ctx.conversationStage) {
    lines.push(
      `【Roamie 對話流程】${conversationStageLabel(ctx.conversationStage)}（${ctx.conversationStage}）`,
    );
  }
  if (ctx.emotionSignals) {
    lines.push(`【當下感受推測】${formatEmotionSignalsForPrompt(ctx.emotionSignals)}`);
  }
  if (ctx.sessionMemory) {
    lines.push(`【本輪工作記憶（temporary）】\n${formatSessionMemoryForPrompt(ctx.sessionMemory)}`);
  }
  if (ctx.longTermMemory) {
    lines.push(`【長期記憶（Plus）】\n${formatLongTermMemoryForPrompt(ctx.longTermMemory)}`);
  }
  if (ctx.focusedPlace)
    lines.push(
      `【使用者剛選的地點】${ctx.focusedPlace.placeName ?? ctx.focusedPlace.name}（${ctx.focusedPlace.type}）— ${ctx.focusedPlace.reason}`,
    );
  if (ctx.selectedPlaces?.length)
    lines.push(`【已選地點（優先規劃）】\n${formatSelectedPlaces(ctx.selectedPlaces)}`);
  if (ctx.selectedPlaceNames?.length)
    lines.push(`【selectedPlaceNames — 禁止重複推薦】${ctx.selectedPlaceNames.join("、")}`);
  if (ctx.plannedStops?.length)
    lines.push(`【plannedStops（行程停靠）】\n${formatSelectedPlaces(ctx.plannedStops)}`);
  if (ctx.recommendedPlaces?.length)
    lines.push(`【本頁推薦候選】\n${formatSelectedPlaces(ctx.recommendedPlaces)}`);
  if (ctx.planningHints) lines.push(`【規劃資訊】\n${formatPlanningHints(ctx.planningHints)}`);
  if (ctx.recentRecommendationNames?.length)
    lines.push(`【近期已推薦過，請避免重複】${ctx.recentRecommendationNames.join("、")}`);
  if (ctx.savedPlaceNames?.length)
    lines.push(`【使用者收藏地點】${ctx.savedPlaceNames.join("、")}`);
  if (ctx.fromMoodFlow || ctx.fromMoodCard) {
    lines.push(
      "【來源】fromMoodFlow：使用者從心情卡片 → 推薦頁 → 聊天；必須延續【已選地點】與 selectedMood，勿用一般歡迎語重新開場。",
    );
  }
  if (ctx.fromPlanForm) {
    lines.push(
      "【來源】fromPlanForm：使用者從「規劃新行程」進入；目的地在【位置】；禁止一次生成完整 itinerary；先推薦地點、等使用者選點後再排行程。勿推薦與目的地不同城市的地點。",
    );
  }
  if (ctx.selectedMood?.trim()) lines.push(`【selectedMood】${ctx.selectedMood.trim()}`);
  if (ctx.initialChatContext?.trim()) lines.push(ctx.initialChatContext.trim());
  if (ctx.selectedCategory?.trim())
    lines.push(`【心情類別】${ctx.selectedCategory.trim()}`);
  if (ctx.lateNightMode) {
    const nightWalk = /深夜散步|夜晚探索|想放空/.test(
      ctx.mood ?? ctx.selectedMood ?? "",
    );
    lines.push(
      nightWalk
        ? "【深夜散步模式】必須輸出 3-5 個 recommendations 地點卡；優先夜景、河岸、步道、觀景，其次深夜咖啡、宵夜；勿第一個推 KTV。戶外景點可標「適合夜晚散步」。禁止只有文字沒有地點。"
        : "【深夜模式】多數店家可能已休息；優先夜景、河岸散步、深夜咖啡、宵夜、酒吧；勿推薦明顯僅白天營業的早午餐。若候選少，summary 用溫暖語氣說明仍可幫忙找夜晚去處，勿說「附近沒有推薦」。",
    );
  }
  if (ctx.time) lines.push(`【currentTime】${ctx.time}`);
  if (ctx.avoidTypes?.length) lines.push(`【想避開的類型】${ctx.avoidTypes.join("、")}`);
  if (ctx.preferredArea) lines.push(`【想去的區域】${ctx.preferredArea}`);
  if (ctx.rejectedPlaceNames?.length)
    lines.push(`【不要推薦的地點】${ctx.rejectedPlaceNames.join("、")}`);
  if (ctx.lastUserIntent?.trim())
    lines.push(`【使用者最新訊息】${ctx.lastUserIntent.trim()}`);
  const stage = ctx.conversationStage;
  if (stage === "empathize" || stage === "infer" || stage === "clarify") {
    lines.push(
      "【接續規劃】先接話、理解感受；recommendations 必須 []；summary 用 1 個溫柔反問收束，不要列店名。",
    );
  } else if (stage === "converge") {
    lines.push(
      "【接續規劃】收斂方向；至多 0-2 個地點；summary 先呼應上一句，再問一個確認問題。",
    );
  } else if (stage === "recommend") {
    lines.push(
      "【接續規劃】可推薦 2-4 個地點；先呼應【使用者最新訊息】再介紹；summary 結尾一個自然下一步提問。",
    );
  } else {
    lines.push(
      "【接續規劃】針對【使用者最新訊息】回應；銜接【已選地點】；勿像搜尋引擎或客服清單。",
    );
  }
  return lines.join("\n");
}

export function budgetModeToItineraryTier(
  mode: ReturnType<typeof resolveBudgetMode>,
): "low" | "medium" | "high" {
  if (mode === "budget") return "low";
  if (mode === "luxury") return "high";
  return "medium";
}
