import { decodeGeneratedChatContent, type GeneratedLocaleContract } from "@/lib/generated-locale";
import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { normalizeRoamieResponse, type RoamieResponse } from "@/lib/ai/types";

const GUEST_KEY = "roamie:chat";

export type ChatMsg = GeneratedLocaleContract & {
  /** Stable UI identity; legacy persisted messages fall back to role + list position. */
  id?: string;
  role: "user" | "assistant";
  content: string;
  /** Anonymous runtime correlation only; never persisted as user content. */
  recommendationRequestId?: string;
  /** Parsed AI JSON for assistant messages when available */
  roamie?: Partial<RoamieResponse>;
  /** 行程加點：結構化地點卡（與 roamie.recommendations 同步） */
  structuredPlaces?: import("@/lib/trip/trip-add-place-render").TripAddPlaceStructuredPlace[];
  /**
   * Plain authority for planning choices rendered as prose rather than cards.
   * Legacy persisted messages may omit this field.
   */
  planningCandidateContext?: {
    source: "planning_suggestion";
    candidates: import("@/lib/chat-session").PlanningShownCandidate[];
  };
  /**
   * Itinerary-aware recommendation loading identity.
   * Display is projected from the current locale; content is only a snapshot.
   */
  loadingPhase?: "itinerary_route_recommendation";
};

export function parseAssistantContent(content: string): {
  content: string;
  roamie?: Partial<RoamieResponse>;
} {
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
  return (data ?? []).reverse().map((r) => {
    const role = r.role as "user" | "assistant";
    if (role === "assistant") {
      return restoreAssistantChatMessage(r.content);
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
}

/** Historical content stays in its original language; provenance governs later reuse. */
export function restoreAssistantChatMessage(content: string): ChatMsg {
  const stored = decodeGeneratedChatContent(content);
  const parsed = parseAssistantContent(stored.content);
  return { role: "assistant", ...parsed, generatedLocale: stored.generatedLocale,
    ...(parsed.roamie ? { roamie: { ...parsed.roamie, generatedLocale: stored.generatedLocale } } : {}) };
}
