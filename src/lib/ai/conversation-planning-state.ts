/**
 * @deprecated 請改用 conversation-state.ts；此檔保留相容匯出。
 */
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ConversationContext } from "@/lib/ai/conversation-context";
import { resolveCompanionDialogueReply } from "@/lib/ai/companion-dialogue";
import {
  buildContextPreservingChatFallback,
  formatKnownInfoBlock,
  hasEstablishedTripPlanningContext,
  isPlanningContextComplete,
  resolveSessionDestination,
  syncConversationState,
  type ConversationState,
} from "@/lib/ai/conversation-state";
import { isFlexiblePreferenceReply } from "@/lib/ai/flexible-preference";

export { isFlexiblePreferenceReply } from "@/lib/ai/flexible-preference";

export type ConversationPlanningStage =
  | "idle"
  | "understanding"
  | "collecting"
  | "planning_intent"
  | "ready_to_plan";

export type ConversationPlanningState = {
  destination?: string;
  month?: string;
  days?: number;
  preferences: string[];
  flexiblePreference?: boolean;
  stage: ConversationPlanningStage;
  updatedAt: string;
};

export function syncConversationPlanningState(
  session: ChatPlanningSession,
  userText: string,
): ChatPlanningSession {
  return syncConversationState(session, userText);
}

export function buildFlexiblePlanningContinuationReply(
  session: ChatPlanningSession,
): string | null {
  const text = session.lastUserIntent ?? "";
  if (!isFlexiblePreferenceReply(text)) return null;
  return resolveCompanionDialogueReply(text, session)?.summary ?? null;
}

export {
  buildContextPreservingChatFallback,
  hasEstablishedTripPlanningContext,
  isPlanningContextComplete,
  resolveSessionDestination,
};

export function formatPlanningContextSummary(
  ctx: ConversationContext | undefined,
  planning?: ConversationPlanningState,
): string {
  const state: ConversationState | undefined = planning
    ? {
        destination: planning.destination,
        travelMonth: planning.month,
        days: planning.days,
        preferences: planning.flexiblePreference
          ? ["flexible"]
          : planning.preferences,
        stage: "gathering",
        updatedAt: planning.updatedAt,
      }
    : undefined;
  return formatKnownInfoBlock(state, ctx).replace(/目前我知道：\n\n/g, "");
}
