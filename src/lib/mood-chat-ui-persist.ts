import type { ChatMsg } from "@/lib/chat-history";

const KEY_PREFIX = "roamie:mood-chat-ui:";

function storageKey(threadKey: string): string {
  return `${KEY_PREFIX}${threadKey}`;
}

/** 心情／推薦 handoff 對話暫存（避免 init 重跑或 history 為空時訊息被清掉） */
export function persistMoodChatMessages(threadKey: string, msgs: ChatMsg[]): void {
  if (typeof window === "undefined" || !threadKey) return;
  try {
    sessionStorage.setItem(storageKey(threadKey), JSON.stringify(msgs));
  } catch {
    /* ignore quota */
  }
}

export function loadMoodChatMessages(threadKey: string): ChatMsg[] | null {
  if (typeof window === "undefined" || !threadKey) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(threadKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatMsg[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function clearMoodChatMessages(threadKey: string): void {
  if (typeof window === "undefined" || !threadKey) return;
  sessionStorage.removeItem(storageKey(threadKey));
}

export function moodChatThreadKey(search: {
  from?: string;
  mood?: string;
  recommendationId?: string;
  fromMoodFlow?: string;
}): string {
  if (search.fromMoodFlow === "1" || search.from === "mood") {
    return `rec:${search.recommendationId ?? "unknown"}`;
  }
  if (search.from === "home-mood" || search.from === "home" || search.mood?.trim()) {
    return `home-mood:${search.mood?.trim() ?? ""}`;
  }
  return "";
}
