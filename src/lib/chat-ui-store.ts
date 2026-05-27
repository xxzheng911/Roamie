import type { ChatMsg } from "@/lib/chat-history";

const UI_KEY = "roamie:chat-ui-preserve";

type Stored = { msgs: ChatMsg[]; preservedAt: string };

export function persistChatUiMessages(msgs: ChatMsg[]): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(UI_KEY, JSON.stringify({ msgs, preservedAt: new Date().toISOString() }));
  console.info("[CHAT_STATE] preserved=true");
}

export function consumePreservedChatUiMessages(): ChatMsg[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(UI_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(UI_KEY);
    const parsed = JSON.parse(raw) as Stored;
    return parsed.msgs?.length ? parsed.msgs : null;
  } catch {
    sessionStorage.removeItem(UI_KEY);
    return null;
  }
}

export function hasPreservedChatUiMessages(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(UI_KEY) != null;
}
