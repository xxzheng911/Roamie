import type { ChatMsg } from "@/lib/chat-history";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { RoamieResponse } from "@/lib/ai/types";
import { buildContextPreservingChatFallback } from "@/lib/ai/conversation-state";
import { resolveInstantChatReply } from "@/lib/chat/chat-instant-reply";
import { resolveCompanionDialogueReply } from "@/lib/ai/companion-dialogue";
import { shouldOrchestrateCompanion } from "@/lib/ai/conversation-state";

export function hasMeaningfulRoamiePayload(data: Partial<RoamieResponse> | undefined): boolean {
  if (!data) return false;
  if (data.summary?.trim()) return true;
  if ((data.recommendations?.length ?? 0) > 0) return true;
  if ((data.itinerary?.length ?? 0) > 0) return true;
  return false;
}

/** 助理泡泡應顯示的文字（content → roamie.summary → 上下文 fallback） */
export function getAssistantDisplayText(
  msg: ChatMsg,
  session: ChatPlanningSession,
): string {
  const fromContent = msg.content?.trim();
  if (fromContent) return fromContent;
  const fromRoamie = msg.roamie?.summary?.trim();
  if (fromRoamie) return fromRoamie;
  return buildContextPreservingChatFallback(session);
}

export function buildAssistantRoamiePayload(
  summary: string,
  session: ChatPlanningSession,
  partial?: Partial<RoamieResponse>,
): Partial<RoamieResponse> {
  return {
    title: "",
    summary,
    moodTag: session.mood ?? session.selectedMood ?? "",
    recommendations: [],
    itinerary: [],
    ...partial,
  };
}

/** 修復尾端空白助理訊息（串流中斷、API 失敗） */
export function repairTrailingAssistantMessage(
  conversation: ChatMsg[],
  session: ChatPlanningSession,
  userText: string,
): ChatMsg[] {
  const last = conversation.at(-1);
  if (last?.role !== "assistant") return conversation;
  if (last.content?.trim() || last.roamie?.summary?.trim()) return conversation;
  const instant = resolveInstantChatReply(userText, session);
  const companion = shouldOrchestrateCompanion(session)
    ? resolveCompanionDialogueReply(userText, session)
    : null;
  const summary =
    companion?.summary ??
    instant?.summary ??
    buildContextPreservingChatFallback(session);
  const trimmed = conversation.filter(
    (m, i) => !(i === conversation.length - 1 && m.role === "assistant"),
  );
  return [
    ...trimmed,
    {
      role: "assistant",
      content: summary,
      roamie: buildAssistantRoamiePayload(summary, session),
    },
  ];
}

export function replaceTrailingAssistantMessage(
  prev: ChatMsg[],
  content: string,
  roamie?: Partial<RoamieResponse>,
): ChatMsg[] {
  const trimmedPrev = prev.filter(
    (m, i) => !(i === prev.length - 1 && m.role === "assistant"),
  );
  return [
    ...trimmedPrev,
    {
      role: "assistant",
      content,
      ...(roamie ? { roamie } : {}),
    },
  ];
}
