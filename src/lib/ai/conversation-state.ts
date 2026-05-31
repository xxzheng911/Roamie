import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ConversationContext } from "@/lib/ai/conversation-context";
import {
  isFlexiblePreferenceReply,
  normalizeFlexiblePreferences,
} from "@/lib/ai/flexible-preference";
import { normalizeDestination, extractKnownDestinationFromText } from "@/lib/ai/normalize-destination";
import { parseTravelContextFromText } from "@/lib/ai/travel-context";
import { inferTravelSeason, parseMonthNumber } from "@/lib/ai/travel-season";

/** Roamie 旅伴對話階段 */
export type ConversationStage =
  | "idle"
  | "discovering"
  | "gathering"
  | "confirming"
  | "planning"
  | "refining";

export type ConversationState = {
  destination?: string;
  travelMonth?: string;
  travelDate?: string;
  days?: number;
  companions?: string;
  transportation?: string;
  budget?: string;
  preferences: string[];
  mood?: string;
  stage: ConversationStage;
  updatedAt: string;
};

export type GatheringField =
  | "destination"
  | "travelMonth"
  | "days"
  | "preferences"
  | "companions"
  | "none";

/** 非心情／附近探索的行程規劃聊天 */
export function shouldOrchestrateCompanion(session: ChatPlanningSession): boolean {
  if (session.fromMoodFlow || session.fromMoodCard) return false;
  if (session.fromPlanForm) return false;
  if (session.chatEntry === "home_mood" || session.chatEntry === "mood_recommendation") {
    return false;
  }
  return true;
}

const COMPANION_LOCAL_REPLY_STAGES: ConversationStage[] = [
  "idle",
  "discovering",
  "gathering",
  "confirming",
];

/** 此階段應優先本地旅伴回覆，不走易失敗的 SSE */
export function shouldUseLocalCompanionReply(session: ChatPlanningSession): boolean {
  if (!shouldOrchestrateCompanion(session)) return false;
  const stage = session.conversationState?.stage ?? "idle";
  return COMPANION_LOCAL_REPLY_STAGES.includes(stage);
}

export function resolveSessionDestination(session: ChatPlanningSession): string | undefined {
  return (
    normalizeDestination(session.conversationState?.destination) ??
    normalizeDestination(session.conversationContext?.destination) ??
    normalizeDestination(session.travelContext?.destination) ??
    normalizeDestination(session.tripDestination?.city) ??
    normalizeDestination(session.tripDestination?.displayLabel) ??
    normalizeDestination(session.preferredArea)
  );
}

function parseCompanionLabel(text: string): string | undefined {
  if (/(一個人|獨自|solo)/i.test(text)) return "一個人";
  if (/(朋友|閨蜜|同學)/.test(text)) return "朋友";
  if (/(家人|爸媽|父母|親子)/.test(text)) return "家人";
  if (/(女友|男友|情侶|另一半)/.test(text)) return "情侶";
  if (/(夫妻|老公|老婆)/.test(text)) return "伴侶";
  return undefined;
}

function hasPreferences(state: ConversationState): boolean {
  return (
    state.preferences.includes("flexible") ||
    state.preferences.length > 0 ||
    Boolean(state.mood?.trim())
  );
}

function inferStage(state: ConversationState, session: ChatPlanningSession): ConversationStage {
  if (session.phase === "done") return "refining";
  if (session.phase === "generating") return "planning";
  if (session.phase === "ready") return "confirming";

  if (!state.destination) return "discovering";

  const hasTime = Boolean(state.travelMonth || state.travelDate || state.days != null);
  const hasPrefs = hasPreferences(state);
  const hasCompanions = Boolean(state.companions?.trim());

  if (state.destination && hasTime && state.days != null && hasPrefs && hasCompanions) {
    return "confirming";
  }
  if (state.destination && (hasTime || state.days != null)) return "gathering";
  if (state.destination) return "gathering";
  return "discovering";
}

/** 還缺什麼（一次只問一項） */
export function nextGatheringField(state: ConversationState | undefined): GatheringField {
  if (!state?.destination) return "destination";
  if (!state.travelMonth && !state.travelDate && state.days == null) return "travelMonth";
  if (state.days == null) return "days";
  if (!hasPreferences(state)) return "preferences";
  if (!state.companions?.trim()) return "companions";
  return "none";
}

export function isReadyForPlanningConfirm(state: ConversationState | undefined): boolean {
  if (!state?.destination || state.days == null) return false;
  if (!state.travelMonth && !state.travelDate) return false;
  if (!hasPreferences(state)) return false;
  if (!state.companions?.trim()) return false;
  return true;
}

/** 同步 ConversationState（每則使用者訊息後） */
export function syncConversationState(
  session: ChatPlanningSession,
  userText: string,
): ChatPlanningSession {
  const t = userText.trim();
  const parsed = parseTravelContextFromText(t, session);
  const flexible = isFlexiblePreferenceReply(t);
  const prev = session.conversationState;

  const destination =
    resolveSessionDestination(session) ??
    (parsed.destination ? normalizeDestination(parsed.destination) : undefined) ??
    prev?.destination;

  const travelMonth =
    session.conversationContext?.travelMonth ??
    parsed.travelMonth ??
    session.travelContext?.travelMonth ??
    prev?.travelMonth;

  const travelDate =
    session.conversationContext?.travelDate ??
    parsed.startDate ??
    session.travelDate ??
    prev?.travelDate;

  const days =
    session.conversationContext?.travelDays ??
    parsed.days ??
    session.travelContext?.days ??
    session.tripDays ??
    prev?.days;

  let preferences = [...(prev?.preferences ?? [])];
  if (flexible) {
    preferences = normalizeFlexiblePreferences();
  } else {
    for (const tag of parsed.interests ?? []) {
      if (!preferences.includes(tag)) preferences.push(tag);
    }
    const vibe = session.discovery?.vibe ?? parsed.vibe ?? parsed.mood;
    if (vibe === "混合") preferences = normalizeFlexiblePreferences();
    else if (vibe === "放鬆" && !preferences.includes("放鬆")) preferences.push("放鬆");
    else if (vibe === "探索" && !preferences.includes("拍照")) preferences.push("拍照");
    else if (vibe === "拍照" && !preferences.includes("拍照")) preferences.push("拍照");
  }

  const companions =
    parseCompanionLabel(t) ??
    prev?.companions ??
    (session.discovery?.companionship === "情侶"
      ? "情侶"
      : session.discovery?.companionship) ??
    session.travelContext?.companion;

  const nextState: ConversationState = {
    destination,
    travelMonth,
    travelDate,
    days: days ?? undefined,
    companions: companions?.trim() || undefined,
    transportation:
      session.travelContext?.transportMode ?? session.transportation ?? prev?.transportation,
    budget: session.travelContext?.budgetLevel ?? session.budget ?? prev?.budget,
    preferences,
    mood: session.mood ?? session.selectedMood ?? parsed.mood ?? prev?.mood,
    stage: "idle",
    updatedAt: new Date().toISOString(),
  };

  nextState.stage = inferStage(nextState, session);

  return {
    ...session,
    conversationState: nextState,
    planningState: legacyPlanningFromConversation(nextState),
  };
}

/** 舊版 planningState 相容 */
export function legacyPlanningFromConversation(
  state: ConversationState,
): import("@/lib/ai/conversation-planning-state").ConversationPlanningState {
  return {
    destination: state.destination,
    month: state.travelMonth,
    days: state.days,
    preferences: state.preferences.filter((p) => p !== "flexible"),
    flexiblePreference: state.preferences.includes("flexible"),
    stage:
      state.stage === "confirming"
        ? "ready_to_plan"
        : state.stage === "gathering"
          ? "collecting"
          : state.stage === "discovering"
            ? "understanding"
            : "idle",
    updatedAt: state.updatedAt,
  };
}

export function formatKnownInfoBlock(
  state: ConversationState | undefined,
  ctx?: ConversationContext,
): string {
  const dest = state?.destination ?? ctx?.destination;
  const month = state?.travelMonth ?? ctx?.travelMonth;
  const days = state?.days ?? ctx?.travelDays;
  const lines: string[] = ["目前我知道：", ""];
  if (dest) lines.push(`📍目的地：${dest}`);
  if (month) lines.push(`📅時間：${month}`);
  else if (state?.travelDate) lines.push(`📅時間：${state.travelDate}`);
  if (days != null) lines.push(`🗓天數：${days} 天`);
  const prefLabel = state?.preferences.includes("flexible")
    ? "彈性安排"
    : state?.preferences.length
      ? state.preferences.join("、")
      : undefined;
  if (prefLabel) lines.push(`✨偏好：${prefLabel}`);
  if (state?.companions) lines.push(`👥旅伴：${state.companions}`);
  return lines.join("\n");
}

export function monthSeasonHint(destination: string, month?: string): string {
  const monthNum = parseMonthNumber({ travelMonth: month });
  const season = inferTravelSeason({ destination, month: monthNum, userText: "" });
  if (/釜山/.test(destination) && month?.includes("11")) {
    return "11 月的釜山很舒服，楓葉季剛開始、天氣偏涼。";
  }
  if (season?.seasonLabel && month) {
    return `${month}的${destination}${season.climateNote ? `，${season.climateNote}` : "，很適合安排行程。"}`;
  }
  if (month) return `${month}去${destination}是很不錯的時段。`;
  return "";
}

export function userWantsPlanNow(text: string): boolean {
  return /(立即規劃|幫我排|開始規劃|排一版|排行程|好，排|確認，?排)/.test(text.trim());
}

export function userWantsChatMore(text: string): boolean {
  return /(再聊聊|先聊聊|繼續聊|不急|等等再)/.test(text.trim());
}

export function buildContextPreservingChatFallback(
  session: ChatPlanningSession,
): string {
  const block = formatKnownInfoBlock(session.conversationState, session.conversationContext);
  if (block.includes("📍")) {
    return `抱歉剛剛沒接好。\n\n${block}\n\n我們繼續吧～`;
  }
  return "抱歉剛剛沒接好，但我還在。跟我說你想去哪、大概幾天，我們慢慢聊～";
}

export function isPlanningContextComplete(state: ConversationState | undefined): boolean {
  return isReadyForPlanningConfirm(state);
}

export function hasEstablishedTripPlanningContext(session: ChatPlanningSession): boolean {
  return Boolean(resolveSessionDestination(session) && session.conversationState);
}
