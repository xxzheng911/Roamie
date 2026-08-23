import { clearChatHistory } from "@/lib/chat-history";
import {
  clearChatSession,
  createEmptySession,
  loadChatSession,
  type ChatPlanningSession,
} from "@/lib/chat-session";
import type { HomeMoodId } from "@/lib/home-mood-options";
import {
  buildStructuredShortcutContext,
  buildNormalizedShortcutRequest,
  type ChatShortcutContext,
  type StructuredShortcutMode,
} from "@/lib/ai/chat-intent";

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
  moodId?: HomeMoodId | null,
): ChatPlanningSession {
  const activeChatIntent = moodId === "coffee" ? "cafe" : "attraction";
  const shortcutMode: StructuredShortcutMode | null =
    moodId === "coffee"
      ? "coffee"
      : moodId === "rainy"
        ? "rainy"
        : moodId === "relax"
          ? "relax"
          : moodId === "lateNight"
            ? "late_night"
            : moodId === "sea"
              ? "sea"
              : null;
  const homeProfileOwnsScene = shortcutMode === "late_night" || shortcutMode === "sea";
  const shortcutContext: ChatShortcutContext | undefined =
    shortcutMode && !homeProfileOwnsScene
      ? buildStructuredShortcutContext(shortcutMode, moodLabel)
      : undefined;
  const normalizedShortcutRequest = shortcutMode
    ? buildNormalizedShortcutRequest(shortcutMode, "home_mood", moodLabel)
    : undefined;
  return {
    ...session,
    mood: moodLabel,
    selectedMood: moodLabel,
    fromMoodCard: true,
    fromMoodFlow: true,
    activeChatIntent,
    shortcutContext: homeProfileOwnsScene
      ? undefined
      : (shortcutContext ?? session.shortcutContext),
    normalizedShortcutRequest:
      normalizedShortcutRequest ?? session.normalizedShortcutRequest,
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
