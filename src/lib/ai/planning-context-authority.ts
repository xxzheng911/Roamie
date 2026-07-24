/**
 * Planning Context — Single Source of Truth (P0 stabilization).
 *
 * Live chat authority lives on `ChatPlanningSession`:
 *   1. `travelContext` — destination / days / dates / combinations / conversationState
 *   2. `pendingQuestion` — awaiting user answer (must not be silently dropped)
 *   3. `tripDays` / `tripStartDate` / `tripEndDate` — mirrored scalars for UI/planner
 *
 * Non-authoritative (must not overwrite live SoT unless explicit user action):
 *   - Workspace snapshot (restore only when opening a draft)
 *   - tripPlanningContext (derived mirror; sync from travelContext)
 *   - ephemeral UI caches
 *
 * This module is an adapter — it does not rewrite Conversation Engine.
 */

import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { isValidContextValue } from "@/lib/ai/travel-context";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { resolveValidTripDays } from "@/lib/ai/trip-duration-guard";

export type PlanningContextAuthority = {
  destination?: string;
  destinationCountry?: string;
  days?: number;
  startDate?: string;
  endDate?: string;
  pendingQuestionType?: string;
  conversationState?: string;
  selectedCombinationIds?: string[];
  workspaceId?: string;
  conversationId?: string;
  /** Where destination was resolved from for this read */
  destinationSource:
    | "travelContext"
    | "tripPlanningContext"
    | "tripDestination"
    | "none";
};

function validDest(value: unknown): string | undefined {
  if (!isValidContextValue(value)) return undefined;
  const label = normalizeDestinationLabel(String(value));
  return label || undefined;
}

/** Read live planning facts from the session SoT (with safe mirrors). */
export function readPlanningContextAuthority(
  session: ChatPlanningSession,
): PlanningContextAuthority {
  const travel = session.travelContext;
  const fromTravel = validDest(travel?.destination);
  const fromTripCtx = validDest(session.tripPlanningContext?.destination);
  const fromTripDest = validDest(session.tripDestination?.city);

  let destination: string | undefined;
  let destinationSource: PlanningContextAuthority["destinationSource"] = "none";
  if (fromTravel) {
    destination = fromTravel;
    destinationSource = "travelContext";
  } else if (fromTripCtx) {
    destination = fromTripCtx;
    destinationSource = "tripPlanningContext";
  } else if (fromTripDest) {
    destination = fromTripDest;
    destinationSource = "tripDestination";
  }

  const days =
    resolveValidTripDays({
      days: travel?.days,
      tripDays: session.tripDays,
      startDate: travel?.startDate ?? session.tripStartDate,
      endDate: travel?.endDate ?? session.tripEndDate,
    }) ?? undefined;

  return {
    destination,
    destinationCountry: travel?.destinationCountry,
    days,
    startDate: travel?.startDate ?? session.tripStartDate,
    endDate: travel?.endDate ?? session.tripEndDate,
    pendingQuestionType: session.pendingQuestion?.type,
    conversationState: travel?.conversationState,
    selectedCombinationIds: travel?.selectedCombinationIds,
    workspaceId: session.workspaceId,
    conversationId: session.conversationId,
    destinationSource,
  };
}

export function logPlanningContextAuthority(
  tag: string,
  authority: PlanningContextAuthority,
): void {
  console.info(
    `[PLANNING_CONTEXT_AUTHORITY] ${tag}`,
    `destination=${authority.destination ?? "(none)"}`,
    `destinationSource=${authority.destinationSource}`,
    `days=${authority.days ?? "(none)"}`,
    `pending=${authority.pendingQuestionType ?? "(none)"}`,
    `state=${authority.conversationState ?? "(none)"}`,
    `workspaceId=${authority.workspaceId ?? "(none)"}`,
  );
}

/**
 * After a turn merge: never lose destination when only duration/dates changed.
 * Also mirrors destination/days onto tripPlanningContext + tripDays scalars.
 */
export function finalizePlanningContextAuthority(params: {
  before: ChatPlanningSession;
  context: CanonicalTravelContext;
  session: ChatPlanningSession;
  destinationSwitched?: boolean;
  didReset?: boolean;
}): { context: CanonicalTravelContext; session: ChatPlanningSession } {
  const { before, destinationSwitched, didReset } = params;
  let { context, session } = params;

  const beforeDest = validDest(before.travelContext?.destination);
  const afterDest = validDest(context.destination);
  const beforePending = before.pendingQuestion?.type;

  // Duration / date answers must not wipe destination unless trip reset or switch.
  if (beforeDest && !afterDest && !destinationSwitched && !didReset) {
    console.warn(
      "[PLANNING_CONTEXT_DESTINATION_PRESERVED]",
      `restored=${beforeDest}`,
      `reason=duration_or_merge_cleared_destination`,
    );
    context = {
      ...context,
      destination: beforeDest,
      destinationCountry:
        context.destinationCountry ?? before.travelContext?.destinationCountry,
      destinationCity:
        context.destinationCity ?? before.travelContext?.destinationCity,
      destinationType:
        context.destinationType ?? before.travelContext?.destinationType,
      destinationCountryCode:
        context.destinationCountryCode ??
        before.travelContext?.destinationCountryCode,
      destinationCoordinates:
        context.destinationCoordinates ??
        before.travelContext?.destinationCoordinates,
      destinationScopeId:
        context.destinationScopeId ?? before.travelContext?.destinationScopeId,
      destinationRegion:
        context.destinationRegion ?? before.travelContext?.destinationRegion,
    };
  }

  // Pending question should only clear via explicit resolution paths; warn if dropped mid-merge.
  if (
    beforePending &&
    !session.pendingQuestion &&
    !session.adviceSelectionThisTurn &&
    !session.lastResolvedPendingQuestion &&
    !didReset
  ) {
    console.warn(
      "[PLANNING_CONTEXT_PENDING_DROPPED]",
      `previous=${beforePending}`,
      "note=pending_cleared_without_explicit_resolution",
    );
  }

  const authorityDest = validDest(context.destination);
  const days =
    resolveValidTripDays({
      days: context.days,
      tripDays: session.tripDays,
      startDate: context.startDate ?? session.tripStartDate,
      endDate: context.endDate ?? session.tripEndDate,
    }) ?? context.days;

  // Dates + destination present must not remain stuck in awaiting_days.
  if (
    days != null &&
    authorityDest &&
    (context.conversationState === "awaiting_days" || !context.conversationState)
  ) {
    context = {
      ...context,
      conversationState: "awaiting_combination_selection",
    };
  }

  // Mirror SoT onto session scalars + tripPlanningContext (derived, not independent).
  session = {
    ...session,
    travelContext: {
      ...context,
      ...(days != null ? { days } : {}),
    },
    tripDays: days ?? session.tripDays,
    tripStartDate: context.startDate ?? session.tripStartDate,
    tripEndDate: context.endDate ?? session.tripEndDate,
    preferredArea: authorityDest ?? session.preferredArea,
    tripPlanningContext: session.tripPlanningContext
      ? {
          ...session.tripPlanningContext,
          destination: authorityDest ?? session.tripPlanningContext.destination,
          days: days ?? session.tripPlanningContext.days,
        }
      : authorityDest
        ? {
            intent: "destination_planning" as const,
            destination: authorityDest,
            days,
          }
        : session.tripPlanningContext,
  };

  context = session.travelContext ?? context;

  logPlanningContextAuthority("after_merge", readPlanningContextAuthority(session));

  return { context, session };
}
