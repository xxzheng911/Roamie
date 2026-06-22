import type { ChatMsg } from "@/lib/chat-history";

const CHAT_UI_CACHE_KEY = "roamie:chat-ui-cache";

export type ChatUiCache = {
  msgs: ChatMsg[];
  scrollTop: number;
  cachedAt: string;
  returnTo: "chat";
};

export function saveChatUiCache(cache: ChatUiCache): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(CHAT_UI_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn("[Roamie] saveChatUiCache failed", e);
  }
}

export function peekChatUiCache(): ChatUiCache | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CHAT_UI_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatUiCache;
    if (!Array.isArray(parsed.msgs) || parsed.msgs.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function consumeChatUiCache(): ChatUiCache | null {
  const cached = peekChatUiCache();
  if (!cached) return null;
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(CHAT_UI_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
  return cached;
}

export function clearChatUiCache(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(CHAT_UI_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** 從聊聊進地點詳情前呼叫：保留訊息與捲動位置 */
export function preserveChatUiForPlaceDetail(msgs: ChatMsg[], scrollTop: number): void {
  saveChatUiCache({
    msgs,
    scrollTop: Math.max(0, Math.round(scrollTop)),
    cachedAt: new Date().toISOString(),
    returnTo: "chat",
  });
}
