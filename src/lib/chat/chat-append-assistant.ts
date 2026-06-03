import type { ChatMsg } from "@/lib/chat-history";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { RoamieResponse } from "@/lib/ai/types";
import {
  hasMeaningfulRoamiePayload,
  replaceTrailingAssistantMessage,
} from "@/lib/chat/assistant-message";
import {
  appendAssistantToConversation,
  buildAssistantChatMsg,
} from "@/lib/chat/chat-instant-reply";

export function assistantMessageIsVisible(msg: ChatMsg | undefined): boolean {
  if (!msg || msg.role !== "assistant") return false;
  const text = msg.content?.trim() || msg.roamie?.summary?.trim() || "";
  return Boolean(text) || hasMeaningfulRoamiePayload(msg.roamie);
}

export function conversationMissingAssistantReply(conversation: ChatMsg[]): boolean {
  const last = conversation.at(-1);
  if (!last) return true;
  if (last.role === "user") return true;
  if (last.role === "assistant" && !assistantMessageIsVisible(last)) return true;
  return false;
}

export function logAiResponseTextReady(text: string): void {
  console.info("[AI_RESPONSE_TEXT_READY]", {
    textLength: text.length,
    preview: text.slice(0, 120),
  });
}

export function logChatFallbackShown(reason: string): void {
  console.info("[CHAT_FALLBACK_SHOWN]", { reason });
}

export function logChatAppendAssistantFailed(error: unknown): void {
  console.error("[CHAT_APPEND_ASSISTANT_FAILED]", {
    error: error instanceof Error ? error.message : String(error),
  });
}

export function logAiResponseSkipped(reason: string, extra?: Record<string, unknown>): void {
  console.info("[AI_RESPONSE_SKIPPED]", { reason, ...extra });
}

/** 串流佔位或接在使用者訊息後的助理回覆 */
export function buildConversationWithAssistantReply(
  conversation: ChatMsg[],
  summary: string,
  session: ChatPlanningSession,
  roamieExtra?: Partial<RoamieResponse>,
): ChatMsg[] {
  const text = summary.trim();
  const last = conversation.at(-1);
  const roamie: Partial<RoamieResponse> = {
    title: "",
    summary: text,
    moodTag: session.mood ?? session.selectedMood ?? "",
    recommendations: roamieExtra?.recommendations ?? [],
    itinerary: roamieExtra?.itinerary ?? [],
    ...roamieExtra,
  };

  const isStreamingPlaceholder =
    last?.role === "assistant" &&
    !last.content?.trim() &&
    !last.roamie?.summary?.trim() &&
    !hasMeaningfulRoamiePayload(last.roamie);

  if (isStreamingPlaceholder) {
    return replaceTrailingAssistantMessage(conversation, text, roamie);
  }

  if (last?.role === "user") {
    return appendAssistantToConversation(conversation, text, session);
  }

  if (last?.role === "assistant") {
    return replaceTrailingAssistantMessage(conversation, text, roamie);
  }

  return [...conversation, buildAssistantChatMsg(text, session)];
}

export type AppendAssistantResult = {
  conversation: ChatMsg[];
  ok: boolean;
  error?: unknown;
};

export function appendAssistantMessageToConversation(
  conversation: ChatMsg[],
  summary: string,
  session: ChatPlanningSession,
  roamieExtra?: Partial<RoamieResponse>,
): AppendAssistantResult {
  const text = summary.trim();
  if (!text && !hasMeaningfulRoamiePayload(roamieExtra)) {
    return { conversation, ok: false, error: new Error("empty_assistant_text") };
  }

  logAiResponseTextReady(text);
  console.info("[CHAT_APPEND_ASSISTANT_START]", { preview: text.slice(0, 80) });

  try {
    const next = buildConversationWithAssistantReply(
      conversation,
      text,
      session,
      roamieExtra,
    );
    const last = next.at(-1);
    if (!assistantMessageIsVisible(last)) {
      throw new Error("append_produced_invisible_message");
    }
    console.info("[CHAT_APPEND_ASSISTANT_SUCCESS]", {
      messageCount: next.length,
      lastMessageRole: last?.role ?? null,
    });
    return { conversation: next, ok: true };
  } catch (error) {
    logChatAppendAssistantFailed(error);
    return { conversation, ok: false, error };
  }
}
