import type { ChatPlanningSession } from '@/lib/chat-session';
import type { TripActionDiagnostic } from './trip-action-diagnostic';

export function hasPlanAiOwner(session: ChatPlanningSession): boolean {
  return session.phase !== 'done' && session.tripCreationAuthority?.explicitCreate === true &&
    session.tripCreationAuthority.intentSource === 'plan_ai_create' &&
    Boolean(session.tripCreationAuthority.generationId) &&
    session.tripActionDiagnostic?.actionSource === 'plan_ai_button';
}
/** Restore the entire pending context, never attach a new trip's owner to old candidates. */
export function restorePendingPlanAiOwner(current: ChatPlanningSession, stored: ChatPlanningSession): ChatPlanningSession {
  if (stored.pendingHandoff && hasPlanAiOwner(stored) &&
      current.tripCreationAuthority?.generationId !== stored.tripCreationAuthority?.generationId) return stored;
  return current;
}
export function selectTripActionOwner(session: ChatPlanningSession, incoming?: TripActionDiagnostic): TripActionDiagnostic | undefined {
  return hasPlanAiOwner(session) ? session.tripActionDiagnostic : incoming ?? session.tripActionDiagnostic;
}
