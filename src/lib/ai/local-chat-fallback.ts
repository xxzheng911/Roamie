import type { ChatPlanningSession } from "@/lib/chat-session";
import type { AiUserIntent } from "@/lib/ai/user-intent";
import { isAiItineraryServiceUnavailableError } from "@/lib/ai/local-itinerary-fallback";
import { CHAT_PIPELINE_FALLBACK } from "@/lib/chat/chat-pipeline-constants";
import { buildContextPreservingChatFallback } from "@/lib/ai/conversation-state";
import { resolveInstantChatReply } from "@/lib/chat/chat-instant-reply";
import {
  buildTravelAdviceFallbackReply,
  tryLocalTravelAdviceReply,
} from "@/lib/ai/travel-advice-fallback";

export { isAiItineraryServiceUnavailableError as isAiChatServiceUnavailableError };

export function buildChatFallbackReply(
  userText: string,
  session: ChatPlanningSession,
  intent: AiUserIntent,
): string {
  const instant = resolveInstantChatReply(userText, session);
  if (instant?.summary) return instant.summary;

  if (intent.type === "travel_time_advice") {
    return buildTravelAdviceFallbackReply(userText, session, {
      destination: intent.destination,
      travelMonth: intent.travelMonth,
    });
  }

  const travelReply = tryLocalTravelAdviceReply(userText, session, {
    destination: intent.destination,
    travelMonth: intent.travelMonth,
  });
  if (travelReply) return travelReply;

  if (
    session.conversationState?.destination ||
    session.planningState?.destination ||
    session.conversationContext?.destination
  ) {
    return buildContextPreservingChatFallback(session);
  }

  return CHAT_PIPELINE_FALLBACK;
}
