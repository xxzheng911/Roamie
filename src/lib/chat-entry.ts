import type { ChatPlanningSession } from "@/lib/chat-session";
import { createEmptySession } from "@/lib/chat-session";
import type { RoamieLocation } from "@/lib/ai/context";
import type { WeatherSummary } from "@/lib/weather-types";

export type ChatEntryKind =
  | "tab"
  | "home_mood"
  | "mood_recommendation"
  | "plan"
  | "plus_home"
  | "other";

export type ChatRouteSearch = {
  from?: string;
  recommendationId?: string;
  fromMoodFlow?: string;
  mood?: string;
  prompt?: string;
};

/** 依 URL search 判斷聊聊入口（不依 localStorage mood） */
export function resolveChatEntry(search: ChatRouteSearch): ChatEntryKind {
  if (search.from === "tab") return "tab";
  if (search.from === "plan") return "plan";
  if (search.from === "plus-home") return "plus_home";
  if (search.fromMoodFlow === "1" || search.from === "mood") return "mood_recommendation";
  if (search.from === "home-mood" || search.from === "home") return "home_mood";
  if (search.mood?.trim()) return "home_mood";
  return "tab";
}

export function isExplicitChatEntry(search: ChatRouteSearch): boolean {
  return resolveChatEntry(search) !== "tab";
}

/** 底部 Tab「聊聊」：一般聊天，不帶心情 handoff 狀態 */
export function sessionForDefaultTab(existing: ChatPlanningSession): ChatPlanningSession {
  return {
    ...createEmptySession(),
    location: existing.location,
    weather: existing.weather,
    chatEntry: "tab",
    phase: "discover",
    pendingHandoff: false,
    moodHandoffDone: false,
    planHandoffDone: false,
    plusHomeHandoffDone: false,
    fromMoodFlow: false,
    fromMoodCard: false,
    fromPlanForm: false,
    fromPlusHome: false,
  };
}

/** 首頁心情卡片進聊聊：帶 mood，但不走推薦頁 handoff */
export function sessionForHomeMoodEntry(
  mood: string,
  existing: ChatPlanningSession,
  ctx?: { location?: RoamieLocation | null; weather?: WeatherSummary | null },
): ChatPlanningSession {
  return {
    ...createEmptySession(),
    mood,
    selectedMood: mood,
    fromMoodCard: true,
    fromMoodFlow: false,
    pendingHandoff: false,
    moodHandoffDone: false,
    chatEntry: "home_mood",
    location: ctx?.location ?? existing.location,
    weather: ctx?.weather ?? existing.weather,
    phase: "recommend",
  };
}

export function homeMoodPrompt(mood: string, override?: string): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  return `我想${mood}，幫我看看附近適合去哪裡。`;
}
