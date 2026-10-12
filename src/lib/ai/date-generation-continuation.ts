import type { ChatPlanningSession } from '@/lib/chat-session';
import { parseAskTripStyleSelection } from '@/lib/ai/ai-trip-style';
import { devVerboseInfo } from '@/lib/dev-verbose-log';

/** Display-independent action reference. It grants no generation or credit authority. */
export type DateGenerationAction = {
  kind: 'resume_generation';
  generationId: string;
  workspaceId?: string;
  conversationId?: string;
  planningSessionId?: string;
  selectionKey: string;
};
function selectionKey(s: ChatPlanningSession): string {
  const c = s.travelContext;
  // Restore enriches display copy and mirrors selections into plannedStops.
  // Bind geographic identities/order, not locale-dependent render metadata.
  const places = (values: ChatPlanningSession['selectedPlaces']) => values.map(p =>
    [p.placeId ?? p.name, p.lat ?? null, p.lng ?? null]);
  return JSON.stringify([s.tripDestination ?? null, c?.destination ?? null,
    c?.destinationType ?? null, c?.destinationCountry ?? null, c?.days ?? s.tripDays ?? null,
    c?.travelMonth ?? null, c?.selectedCombinationIds ?? [], c?.selectedCombinationPlaceNames ?? [],
    c?.offeredCombinations ?? [], c?.planningTripStyle ?? null, c?.interests ?? [], places(s.selectedPlaces), places(s.plannedStops?.length ? s.plannedStops : s.selectedPlaces),
    s.currentDayPlan ?? null]);
}
export function captureDateGenerationAction(s: ChatPlanningSession): DateGenerationAction | undefined {
  if (!s.tripCreationAuthority?.explicitCreate || !s.tripCreationAuthority.generationId) return;
  return {kind:'resume_generation',generationId:s.tripCreationAuthority.generationId,
    workspaceId:s.workspaceId,conversationId:s.conversationId,planningSessionId:s.planningSessionId,
    selectionKey:selectionKey(s)};
}
export function matchesDateGenerationAction(s: ChatPlanningSession, a?: DateGenerationAction): boolean {
  return Boolean(a?.kind === 'resume_generation' && s.tripCreationAuthority?.explicitCreate &&
    a.generationId === s.tripCreationAuthority.generationId &&
    a.workspaceId === s.workspaceId && a.conversationId === s.conversationId &&
    a.planningSessionId === s.planningSessionId && a.selectionKey === selectionKey(s));
}
export function traceDateGenerationContinuation(s: ChatPlanningSession, text: string, match: boolean, action?: DateGenerationAction): void {
  const ownerMatch = Boolean(action && action.workspaceId === s.workspaceId &&
    action.conversationId === s.conversationId && action.planningSessionId === s.planningSessionId);
  devVerboseInfo('[DATE_GENERATION_CONTINUATION]', {
    actionType:'resume_generation', inputKind:/^\s*\d+[.、)]?\s*$/.test(text) ? 'numeric' : parseAskTripStyleSelection(text) ? 'style' : 'other',
    sessionOwnerMatch:ownerMatch, snapshotMatch:match,
    destinationTypeBefore:s.travelContext?.destinationType ?? 'unknown',
    destinationTypeAfter:s.travelContext?.destinationType ?? 'unknown',
    selectedCombinationPresent:Boolean(s.travelContext?.selectedCombinationIds?.length),
    selectedPlacesCount:s.selectedPlaces.length, styleReselectTriggered:false,
    continuationStarted:match,
  });
}
