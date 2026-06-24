import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import {
  applyAdviceResultToSession,
  resolveDestinationAdvice,
  type DestinationAdviceResult,
} from "@/lib/ai/destination-advice";
import type { PendingQuestion } from "@/lib/ai/destination-pending-question";
import {
  sessionToUnifiedContext,
  unifiedContextToTravelPatch,
  type UnifiedChatContext,
} from "@/lib/ai/chat-context-unified";
import type { AiChatRoute } from "@/lib/ai/chat-router";
import { isPlanningTurnActive } from "@/lib/ai/chat-turn-engine";
import { mergeTravelContext } from "@/lib/ai/travel-context";

export type ChatTurnResult = {
  advice: DestinationAdviceResult;
  route?: AiChatRoute;
  unified: UnifiedChatContext;
  session: ChatPlanningSession;
};

/**
 * Unified advice turn processor.
 * Call after mergeTravelContext so pending selection + context merge are already applied.
 */
export function processAdviceTurn(
  userText: string,
  session: ChatPlanningSession,
  context: CanonicalTravelContext,
  messageId?: string,
): ChatTurnResult {
  const advice = resolveDestinationAdvice(context, session, userText);
  const sessionWithAdvice = applyAdviceResultToSession(session, advice);
  const unified = sessionToUnifiedContext({
    ...sessionWithAdvice,
    travelContext: {
      ...context,
      ...(advice.contextPatch ?? {}),
      ...unifiedContextToTravelPatch(sessionToUnifiedContext(sessionWithAdvice)),
      interests: context.interests ?? [],
    },
  });

  const route: AiChatRoute | undefined = advice.reply
    ? {
        mode: "advice",
        chatPhase: "discover",
        question: advice.reply,
        pendingQuestion: advice.pendingQuestion
          ? ({
              ...advice.pendingQuestion,
              askedAtMessageId: messageId,
            } as PendingQuestion & { askedAtMessageId?: string })
          : undefined,
        contextPatch: advice.contextPatch,
      }
    : undefined;

  return {
    advice,
    route,
    unified,
    session: {
      ...sessionWithAdvice,
      travelContext: {
        ...(sessionWithAdvice.travelContext ?? { interests: [] }),
        ...advice.contextPatch,
        interests: sessionWithAdvice.travelContext?.interests ?? context.interests ?? [],
      },
    },
  };
}

export { isPlanningTurnActive };

/** Planning fallback: merge context + run local advice engine (no remote AI). */
export function resolvePlanningFallbackTurn(
  userText: string,
  session: ChatPlanningSession,
  context: CanonicalTravelContext,
): ChatTurnResult {
  const merged = mergeTravelContext(session, userText);
  return processAdviceTurn(userText, merged.session, merged.context);
}
