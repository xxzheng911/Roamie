import type { ChatPlanningSession } from '@/lib/chat-session';
import type { ChatIntentArbitrationResult } from './recommendation-refinement/types';
import { beginTripCreation } from './generated-plan-handoff';
import { receiveTripAction } from './trip-action-diagnostic';

/** Upgrade the current action only after the intent arbiter has resolved its route. */
export function applyChatCreateAuthority(
  session: ChatPlanningSession,
  arbitration: ChatIntentArbitrationResult,
  previewOnly = false,
): ChatPlanningSession {
  if (previewOnly || arbitration.route !== 'NEW_TRIP_PLANNING') return session;
  // A Plan form owner is already explicit; do not replace its generation or origin.
  if (session.tripCreationAuthority?.explicitCreate && session.phase !== 'done' &&
      session.tripActionDiagnostic?.actionSource === 'plan_ai_button') return session;
  const next = beginTripCreation(session.phase === 'done'
    ? { ...session, tripCreationAuthority: undefined } : session, 'direct_itinerary_create');
  const action = session.tripActionDiagnostic ?? receiveTripAction('chat_generate_trip', true);
  return { ...next, tripActionDiagnostic: { ...action, actionSource: 'chat_generate_trip' } };
}
