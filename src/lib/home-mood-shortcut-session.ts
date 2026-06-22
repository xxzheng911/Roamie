import { clearChatHistory } from "@/lib/chat-history";
import {
  clearChatSession,
  createEmptySession,
  loadChatSession,
  type ChatPlanningSession,
} from "@/lib/chat-session";

export function isHomeMoodShortcutSearch(search: {
  from?: string;
  recommendationId?: string;
  mood?: string;
}): boolean {
  return search.from === "mood" && !search.recommendationId && Boolean(search.mood?.trim());
}

export function isHomeMoodShortcutSession(session: ChatPlanningSession): boolean {
  return session.homeMoodShortcutEntry === true;
}

export function shouldDiscardHomeMoodShortcutSession(session: ChatPlanningSession): boolean {
  return isHomeMoodShortcutSession(session) && !session.homeMoodShortcutEngaged;
}

export function beginHomeMoodShortcutSession(
  session: ChatPlanningSession,
  moodLabel: string,
): ChatPlanningSession {
  return {
    ...session,
    mood: moodLabel,
    selectedMood: moodLabel,
    fromMoodCard: true,
    fromMoodFlow: true,
    homeMoodShortcutEntry: true,
    homeMoodShortcutEngaged: false,
  };
}

export function markHomeMoodShortcutEngaged(
  session: ChatPlanningSession,
): ChatPlanningSession {
  if (!session.homeMoodShortcutEntry) return session;
  return { ...session, homeMoodShortcutEngaged: true };
}

/** 放棄未互動的首頁心情快捷聊聊（session + 訊息紀錄） */
export async function discardHomeMoodShortcutSession(): Promise<void> {
  const current = loadChatSession();
  if (!shouldDiscardHomeMoodShortcutSession(current)) return;
  clearChatSession();
  await clearChatHistory();
}

export function createDefaultChatEntrySession(): ChatPlanningSession {
  return createEmptySession();
}
