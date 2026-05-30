import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { clearConversationContext } from "@/lib/conversation-context-store";
import { normalizeRoamieResponse, type RoamieResponse } from "@/lib/ai/types";

const GUEST_KEY = "roamie:chat";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  /** Parsed AI JSON for assistant messages when available */
  roamie?: Partial<RoamieResponse>;
};

function parseAssistantContent(content: string): { content: string; roamie?: Partial<RoamieResponse> } {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return { content: trimmed };
  try {
    const roamie = normalizeRoamieResponse(JSON.parse(trimmed) as Record<string, unknown>);
    return { content: roamie.summary, roamie };
  } catch {
    return { content: trimmed };
  }
}

export async function loadChatHistory(limit = 30): Promise<ChatMsg[]> {
  const uid = await getAuthenticatedUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error(error);
    return [];
  }
  return (data ?? [])
    .reverse()
    .map((r) => {
      const role = r.role as "user" | "assistant";
      if (role === "assistant") {
        const parsed = parseAssistantContent(r.content);
        return { role, content: parsed.content, roamie: parsed.roamie };
      }
      return { role, content: r.content };
    });
}

export async function clearChatHistory(): Promise<void> {
  const uid = await getAuthenticatedUserId();
  if (!uid) {
    if (typeof window !== "undefined") localStorage.removeItem(GUEST_KEY);
    return;
  }
  await supabase.from("chat_messages").delete().eq("user_id", uid);
  await clearConversationContext();
}
