import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { isAskDaysPending, parseAskDaysFromText } from "@/lib/ai/destination-pending-question";
import { resolveValidTripDays, tripDurationFieldsFromContext } from "@/lib/ai/trip-duration-guard";

/** Only acknowledge the current valid answer for discovery. The original pending
 * remains owned by the advice handler, which consumes it and persists its result. */
export function sessionForAnsweredDurationDiscovery(
  text: string,
  session: ChatPlanningSession,
  context: CanonicalTravelContext,
): ChatPlanningSession {
  if (!isAskDaysPending(session.pendingQuestion)) return session;
  const answer = parseAskDaysFromText(text, session.pendingQuestion);
  if (answer == null || resolveValidTripDays({ days: answer }) !== answer) return session;
  if (resolveValidTripDays(tripDurationFieldsFromContext(context, session)) !== answer) return session;
  return { ...session, pendingQuestion: undefined };
}
