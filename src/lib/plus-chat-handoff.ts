import type { RoamieLocation } from "@/lib/ai/context";
import {
  createEmptySession,
  loadChatSession,
  type ChatPlanningSession,
} from "@/lib/chat-session";
import { buildHomePlusInsight, type HomePersonalizationInsightInput } from "@/lib/home-personalization-insight";
import { syncSessionPlaceMemory } from "@/lib/place-planning-memory";
import type { TravelPreferences } from "@/lib/preferences-storage";

const PLANNING_FOLLOWUP =
  "今天比較想一個人走走、還是想有人一起？有沒有特別想避開，或一定要到的類型？";

export type PlusHomeHandoffInput = {
  mood?: string | null;
  prefs?: TravelPreferences | null;
  insightInput?: HomePersonalizationInsightInput;
  location?: RoamieLocation | null;
  existing?: ChatPlanningSession;
};

function buildPlusHomeInitialContext(session: ChatPlanningSession, insight: string): string {
  const lines = [
    "【Plus 個人化旅遊中心 → 聊天規劃】",
    `insight：${insight}`,
    `selectedMood：${session.selectedMood ?? session.mood ?? "（未指定）"}`,
    session.preferences?.pace ? `pace：${session.preferences.pace}` : "",
    session.preferences?.vibe ? `vibe：${session.preferences.vibe}` : "",
    "mode：plus-personalized-discover",
    "規則：先陪伴與釐清，不要硬推景點；依使用者回覆持續推算。",
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildPlusHomeHandoffOpening(
  session: ChatPlanningSession,
  insightLine?: string,
): string {
  const lead =
    insightLine?.trim() ||
    (session.selectedMood
      ? `照著「${session.selectedMood}」的心情，我們慢慢聊出一趟適合你的路線。`
      : "我們慢慢聊出一趟適合你的路線。");
  return `${lead}\n\n${PLANNING_FOLLOWUP}`;
}

/** 首頁 Plus「開始規劃我的旅程」→ 聊天頁 handoff */
export function preparePlusHomeChatSession(input: PlusHomeHandoffInput): ChatPlanningSession {
  const existing = input.existing ?? loadChatSession();
  const mood =
    input.mood?.trim() ||
    existing.selectedMood?.trim() ||
    existing.mood?.trim() ||
    undefined;

  const insight =
    input.insightInput != null
      ? buildHomePlusInsight(input.insightInput)
      : mood
        ? `照著「${mood}」的心情，我們慢慢聊出一趟適合你的路線。`
        : "我們慢慢聊出一趟適合你的路線。";

  const merged: ChatPlanningSession = {
    ...createEmptySession(),
    ...existing,
    mood,
    selectedMood: mood,
    selectedCategory: mood ?? existing.selectedCategory,
    preferences: input.prefs ?? existing.preferences,
    location: input.location ?? existing.location,
    phase: "discover",
    fromPlusHome: true,
    fromMoodCard: true,
    plusHomeInsight: insight,
    pendingHandoff: existing?.plusHomeHandoffDone ? false : true,
    plusHomeHandoffDone: existing?.plusHomeHandoffDone ?? false,
    moodHandoffDone: existing?.plusHomeHandoffDone ?? false,
  };

  merged.initialChatContext = buildPlusHomeInitialContext(merged, insight);
  return syncSessionPlaceMemory(merged);
}

export function markPlusHomeHandoffComplete(session: ChatPlanningSession): ChatPlanningSession {
  return {
    ...session,
    pendingHandoff: false,
    plusHomeHandoffDone: true,
    moodHandoffDone: true,
    fromPlusHome: true,
    initialChatContext: session.initialChatContext ?? buildPlusHomeInitialContext(session, session.plusHomeInsight ?? ""),
  };
}
