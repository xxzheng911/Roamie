import type { ChatPlanningSession } from '@/lib/chat-session';
import { isDebugDiagnosticsEnabled } from '@/lib/debug-flags';
import { planCorrelationToken } from './generated-plan-handoff-diagnostic';
import { selectionSnapshot } from './numeric-selection-authority';

type Session = ChatPlanningSession;
type Reason = 'missing_pending' | 'recommendation_failed' | 'owner_missing' | 'owner_mismatch' | 'snapshot_mismatch' | 'option_out_of_range' | 'offer_missing' | 'other';
// Process-local opaque menu tokens: no destination, option text or geographic identity is logged.
const menus = new Map<string, number>();
let sequence = 0;
function menuToken(key?: string): number | null {
  if (!key) return null;
  if (!menus.has(key)) { if (menus.size >= 256) menus.delete(menus.keys().next().value!); menus.set(key, ++sequence); }
  return menus.get(key)!;
}
export function combinationCorrelationToken(s: Session): string | undefined {
  return s.workspaceId || s.conversationId || s.planningSessionId
    ? planCorrelationToken(JSON.stringify([s.workspaceId, s.conversationId, s.planningSessionId])) : undefined;
}
export function combinationDiscoveryCorrelation(s: Session): string | undefined {
  return isDebugDiagnosticsEnabled() ? combinationCorrelationToken(s)
    : s.tripCreationAuthority ? planCorrelationToken(s.tripCreationAuthority.generationId) : undefined;
}
const discoveryCounts = new Map<string, number | null>();
const helperCounts = new WeakMap<Session, number>();
const persistence = new WeakMap<Session, boolean>();
export function observeCombinationDiscovery(s: Session, count: number | null): void {
  if (!isDebugDiagnosticsEnabled()) return;
  const key = combinationCorrelationToken(s);
  if (!key) return;
  if (discoveryCounts.size >= 64 && !discoveryCounts.has(key)) discoveryCounts.delete(discoveryCounts.keys().next().value!);
  discoveryCounts.set(key, count);
}
export function observeCombinationHelper(s: Session, count: number | null): void {
  if (isDebugDiagnosticsEnabled()) { if (count == null) helperCounts.delete(s); else helperCounts.set(s, count); }
}
type ReturnBranch = 'completeAdviceTurn' | 'triggerPlaceRecommendations' | 'triggerPlaceRecommendations.adviceFallback' | 'triggerPlaceRecommendations.namedFallback' | 'buildPlanningOfflineReply.localFallback' | 'buildPlanningOfflineReply.streamFallback' | 'buildPlanningOfflineReply.streamHint' | 'buildPlanningOfflineReply.sendFallback' | 'route.clarify';
export function traceCombinationChatReturn(s: Session, branchCode: ReturnBranch,
  advice?: {contextPatch?: {offeredCombinations?: unknown[]}}, helperSession?: Session): void {
  emit('COMBINATION_CHAT_RETURN_TRACE', () => ({
    branchCode, correlationToken: combinationCorrelationToken(s) ?? null,
    discoveryCombinationCount: discoveryCounts.get(combinationCorrelationToken(s) ?? '') ?? null,
    helperOfferedCount: helperSession ? helperCounts.get(helperSession) ?? null : null,
    adviceOfferedCount: advice ? advice.contextPatch?.offeredCombinations?.length ?? 0 : null,
    sessionOfferedCount: s.travelContext?.offeredCombinations?.length ?? 0,
    pendingType: s.pendingQuestion?.type ?? 'none', pendingOptionsCount: s.pendingQuestion?.options.length ?? 0,
    contextPatchPresent: advice ? Boolean(advice.contextPatch) : null,
    sessionPersisted: branchCode === 'buildPlanningOfflineReply.streamHint' ? null : persistence.get(s) ?? null,
  }));
}
function fields(s: Session) {
  const p = s.pendingQuestion, o = p?.selectionOwner;
  const current = p ? selectionSnapshot(s, p) : undefined;
  let planningOwnerMatch: boolean | null = null;
  if (o) { try { planningOwnerMatch = JSON.parse(o.snapshot)[0] === (s.planningSessionId ?? null); } catch { planningOwnerMatch = false; } }
  const workspaceOwnerMatch = o ? o.workspaceId === s.workspaceId : null;
  const conversationOwnerMatch = o ? o.conversationId === s.conversationId : null;
  return {
    correlationToken: combinationCorrelationToken(s) ?? null,
    menuToken: menuToken(o?.snapshot ?? current), currentSnapshotToken: menuToken(current),
    pendingType: p?.type ?? 'none', offeredCount: s.travelContext?.offeredCombinations?.length ?? 0,
    pendingOptionsCount: p?.options.length ?? 0, workspaceOwnerMatch, conversationOwnerMatch, planningOwnerMatch,
    ownerMatch: o ? workspaceOwnerMatch && conversationOwnerMatch && planningOwnerMatch : null,
    snapshotMatch: o ? o.snapshot === current : null,
  };
}
function emit(event: string, data: () => object): void {
  if (!isDebugDiagnosticsEnabled()) return;
  // Diagnostics must never change persistence, selection or error handling.
  try { console.info(`[${event}]`, data()); } catch { /* observational only */ }
}
export function traceNumericAttempt(s: Session): void {
  emit('COMBINATION_NUMERIC_ATTEMPT', () => ({ ...fields(s), inputKind: 'numeric' }));
}
export function traceNumericRejection(s: Session, reason: Reason): void {
  emit('COMBINATION_NUMERIC_REJECTED', () => ({ ...fields(s), reason }));
}
export function traceCombinationDisplayed(s: Session, displayedCount: number, displayedSession: Session = s): void {
  emit('COMBINATION_OPTIONS_DISPLAYED', () => ({ ...fields(s), displayedCount,
    displayedSnapshotToken: fields(displayedSession).currentSnapshotToken,
    displayedSessionMatch: displayedSession.pendingQuestion && s.pendingQuestion
      ? selectionSnapshot(displayedSession, displayedSession.pendingQuestion) === selectionSnapshot(s, s.pendingQuestion) : false,
  }));
}
export function traceCombinationPersisted(before: Session, after: Session | undefined, persistSucceeded: boolean): void {
  if (isDebugDiagnosticsEnabled() && after) persistence.set(after, persistSucceeded);
  if (before.pendingQuestion?.type !== 'combination_choice' && !before.travelContext?.offeredCombinations?.length) return;
  emit('COMBINATION_SESSION_PERSISTED', () => ({
    ...fields(after ?? before), beforeCorrelationToken: fields(before).correlationToken,
    beforeSnapshotToken: fields(before).currentSnapshotToken,
    persistSucceeded, authoritativeSessionReturned: Boolean(after),
    offeredCountBefore: before.travelContext?.offeredCombinations?.length ?? 0,
    offeredCountAfter: after?.travelContext?.offeredCombinations?.length ?? 0,
    ownerChanged: after ? before.workspaceId !== after.workspaceId || before.conversationId !== after.conversationId || before.planningSessionId !== after.planningSessionId : null,
    snapshotChanged: after?.pendingQuestion && before.pendingQuestion ? selectionSnapshot(before, before.pendingQuestion) !== selectionSnapshot(after, after.pendingQuestion) : Boolean(before.pendingQuestion !== after?.pendingQuestion),
  }));
}

/** Per-call state only; never persisted into planning data. */
export type AdviceReturnObservation = {
  branchCode: string;
  next?: { contextPatch?: { offeredCombinations?: unknown[] } };
  guardReason?: string;
};
export function traceCombinationAdviceReturn(s: Session, observation: AdviceReturnObservation,
  advice: {contextPatch?: {offeredCombinations?: unknown[]}; pendingQuestion?: {options: string[]}}): void {
  emit('COMBINATION_ADVICE_RETURN_TRACE', () => ({
    branchCode: observation.branchCode,
    correlationToken: combinationCorrelationToken(s) ?? null,
    pendingType: s.pendingQuestion?.type ?? 'none',
    lastResolvedPendingType: s.lastResolvedPendingQuestion?.type ?? 'none',
    guardReason: observation.guardReason ?? null,
    nextOfferedCount: null, // No top-level offeredCombinations field in helper contract.
    nextContextPatchOfferedCount: observation.next ? observation.next.contextPatch?.offeredCombinations?.length ?? 0 : null,
    adviceOfferedCount: null, // Offers live in contextPatch, not a top-level Advice field.
    adviceContextPatchOfferedCount: advice.contextPatch?.offeredCombinations?.length ?? 0,
    pendingOptionsCount: advice.pendingQuestion?.options.length ?? 0,
  }));
}
