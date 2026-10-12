import { traceNumericAttempt, traceNumericRejection } from './combination-selection-diagnostics';
import { REFRESH_DESTINATION_RECOMMENDATIONS_OPTION } from "./destination-combination-discovery";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { PendingQuestion } from "./destination-pending-question";

export type SelectionOwner = { workspaceId?: string; conversationId?: string; snapshot: string };
export const isNumericSelection = (text: string): boolean => /^\d+[.、)]?$/.test(text.trim());
export const selectionSnapshot = (s: ChatPlanningSession, p: PendingQuestion): string => JSON.stringify([
  s.planningSessionId ?? null, s.travelContext?.destination ?? null,
  s.travelContext?.destinationCountry ?? null, s.travelContext?.days ?? s.tripDays ?? null,
  p.type, p.options, p.baseDestination ?? null,
  p.type === "combination_choice" ? s.travelContext?.offeredCombinations?.map(c => [c.id, c.places.map(p => [p.candidateId, p.plannerProvenanceKey, p.googlePlaceId, p.latitude, p.longitude])]) : null,
]);
export function bindSelectionOwner(s: ChatPlanningSession): ChatPlanningSession {
  const p = s.pendingQuestion;
  if (!p || !["ask_trip_style", "combination_choice"].includes(p.type) || p.selectionOwner) return s;
  return {...s, pendingQuestion: {...p, selectionOwner: {
    workspaceId: s.workspaceId, conversationId: s.conversationId, snapshot: selectionSnapshot(s, p),
  }}};
}
export function matchesSelectionOwner(s: ChatPlanningSession, p: PendingQuestion): boolean {
  const o = p.selectionOwner;
  // Unpersisted local advice turns have no workspace yet. Persisted legacy menus
  // must be re-offered, rather than claiming ownership retroactively at selection.
  if (!o) return !s.workspaceId && !s.conversationId;
  return o.workspaceId === s.workspaceId && o.conversationId === s.conversationId && o.snapshot === selectionSnapshot(s, p);
}
export function hasNumericStyleAuthority(s: ChatPlanningSession, style: string): boolean {
  const p = s.pendingQuestion ?? (s.adviceSelectionThisTurn === style ? s.lastResolvedPendingQuestion : undefined);
  return Boolean(p?.type === "ask_trip_style" && p.options.includes(style) && matchesSelectionOwner(s, p));
}

/** Called before context merge: an unowned number cannot become a style/create intent. */
export function rejectNumericSelection(s: ChatPlanningSession, text: string): boolean {
  if (!isNumericSelection(text)) return false;
  traceNumericAttempt(s);
  const reject = (reason: Parameters<typeof traceNumericRejection>[1]): true => { traceNumericRejection(s, reason); return true; };
  const p = s.pendingQuestion;
  if (!p) return reject("missing_pending");
  if (p.type === "ask_preference" && p.options.includes(REFRESH_DESTINATION_RECOMMENDATIONS_OPTION)) return reject("recommendation_failed");
  if (["date_confirmation", "ask_days", "duration_choice"].includes(p.type)) return false;
  if (p.selectionOwner && !matchesSelectionOwner(s, p)) return reject(p.selectionOwner.workspaceId !== s.workspaceId || p.selectionOwner.conversationId !== s.conversationId ? "owner_mismatch" : "snapshot_mismatch");
  if (["ask_trip_style", "combination_choice"].includes(p.type) && !matchesSelectionOwner(s, p)) return reject("owner_missing");
  const index = Number(text.trim().replace(/[.、)]$/, "")) - 1;
  if (index < 0 || index >= p.options.length) return reject("option_out_of_range");
  if (p.type === "combination_choice") {
    const offers = s.travelContext?.offeredCombinations;
    if (!offers?.[index] || s.travelContext?.tripPurpose === "combination_discovery_failed") return reject(!offers?.[index] ? "offer_missing" : "recommendation_failed");
  }
  return false;
}

/** An expired selection menu must not acquire a new owner when saving the clarification. */
export function discardExpiredSelection(s: ChatPlanningSession): ChatPlanningSession {
  const p = s.pendingQuestion;
  if (!p || !["ask_trip_style", "combination_choice"].includes(p.type) || matchesSelectionOwner(s, p)) return s;
  return {...s, pendingQuestion: undefined, lastResolvedPendingQuestion: undefined,
    adviceSelectionThisTurn: undefined, tripCreationAuthority: undefined, selectedPlaces: [],
    travelContext: {...(s.travelContext ?? {interests: []}), offeredCombinations: [], selectedCombinationIds: [], selectedCombinationPlaceNames: [], excludedCombinationPlaceNames: [], selectionSource: undefined}};
}
