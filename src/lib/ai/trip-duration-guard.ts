/**
 * Unified trip-duration + combination-discovery guards.
 *
 * Destination selection must never enter Combination Discovery / Candidate Pool /
 * Places search until a valid trip duration (or inclusive date range) is present.
 */
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  canDiscoverDestinationPlaces,
  isCountryLevelDestination,
} from "@/lib/ai/destination-scope";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import {
  assertDestinationConsistency,
  hasCompleteResolvedDestination,
  logCombinationFailureChain,
  logPlanningDestinationSummary,
  resolvePlanningDestination,
  type PlanningDestinationInput,
  type ResolvedTripDestination,
} from "@/lib/ai/resolved-trip-destination";

/** Inclusive upper bound for a single trip planning session. */
export const MAX_VALID_TRIP_DAYS = 30;

export type TripDurationFields = {
  tripDays?: number | null;
  days?: number | null;
  startDate?: string | null;
  endDate?: string | null;
};

/**
 * Avoid importing the full PendingQuestion module (circular with duration guard).
 * Only the pending `type` field is needed for discovery gating.
 */
export type DurationGuardPendingQuestion = {
  type?: string | null;
};

export type CombinationDiscoveryGuardContext = TripDurationFields &
  PlanningDestinationInput & {
    pendingQuestion?: DurationGuardPendingQuestion | null;
    tripPurpose?: string | null;
    conversationState?: string | null;
    session?: ChatPlanningSession | null;
  };

export type CombinationDiscoveryGuardResult = {
  allowed: boolean;
  reason:
    | "ok"
    | "missing_destination"
    | "country_level_destination"
    | "destination_state_desync"
    | "missing_trip_duration"
    | "pending_destination_question"
    | "pending_duration_question";
  tripDays?: number;
  hasDestination: boolean;
  hasValidTripDuration: boolean;
  resolvedDestination?: ResolvedTripDestination | null;
};

function coerceFiniteDays(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return undefined;
    return n;
  }
  return undefined;
}

/** Inclusive day count from YYYY-MM-DD start/end (local calendar days). */
function inferInclusiveTripDays(
  startDate?: string | null,
  endDate?: string | null,
): number | undefined {
  const start = startDate?.trim();
  const end = endDate?.trim();
  if (!start || !end) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return undefined;
  }
  const startMs = Date.parse(`${start}T00:00:00`);
  const endMs = Date.parse(`${end}T00:00:00`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return undefined;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.min(
    MAX_VALID_TRIP_DAYS,
    Math.max(1, Math.round((endMs - startMs) / dayMs) + 1),
  );
}

/**
 * True only when tripDays is a finite integer in [1, MAX_VALID_TRIP_DAYS],
 * or startDate+endDate form a valid inclusive range that yields such days.
 *
 * Rejects: undefined, null, 0, NaN, "", " ", unparsed text.
 */
export function hasValidTripDuration(context: TripDurationFields): boolean {
  return resolveValidTripDays(context) != null;
}

/** Resolve a validated day count, or undefined when duration is missing/invalid. */
export function resolveValidTripDays(context: TripDurationFields): number | undefined {
  const direct = coerceFiniteDays(context.tripDays ?? context.days);
  if (direct != null) {
    const days = Math.trunc(direct);
    if (days >= 1 && days <= MAX_VALID_TRIP_DAYS) return days;
  }

  const fromRange = inferInclusiveTripDays(context.startDate, context.endDate);
  if (fromRange != null && fromRange >= 1 && fromRange <= MAX_VALID_TRIP_DAYS) {
    return fromRange;
  }

  return undefined;
}

/**
 * City / region / island / city_state destination ready for combination discovery.
 * Uses ResolvedTripDestination SoT — never label-only or destinationType===country alone.
 */
export function hasResolvedDestination(
  context: CombinationDiscoveryGuardContext,
): boolean {
  const resolved = resolvePlanningDestination(context, context.session);
  if (!resolved?.label) return false;
  if (resolved.type === "country" || isCountryLevelDestination(resolved.label)) {
    return false;
  }
  if (hasCompleteResolvedDestination(resolved)) return true;
  // Discoverable entity with countryCode — coords may hydrate from approx/scope shortly after.
  if (
    resolved.countryCode &&
    canDiscoverDestinationPlaces(resolved.label) &&
    resolved.type !== "country" &&
    resolved.type !== "unknown"
  ) {
    return true;
  }
  // Scope already locked with valid coords/countryCode must always pass.
  if (
    resolved.scopeLocked &&
    resolved.countryCode &&
    canDiscoverDestinationPlaces(resolved.label)
  ) {
    return true;
  }
  return false;
}

export function hasPendingDestinationQuestion(
  pending?: DurationGuardPendingQuestion | null,
): boolean {
  return pending?.type === "region_choice";
}

export function hasPendingDurationQuestion(
  pending?: DurationGuardPendingQuestion | null,
): boolean {
  return pending?.type === "ask_days" || pending?.type === "duration_choice";
}

export function evaluateCombinationDiscoveryGuard(
  context: CombinationDiscoveryGuardContext,
): CombinationDiscoveryGuardResult {
  const resolved = resolvePlanningDestination(context, context.session);
  const consistency = assertDestinationConsistency(resolved);
  const hasDestination = hasResolvedDestination(context);
  const tripDays = resolveValidTripDays(context);
  const durationOk = tripDays != null;

  logPlanningDestinationSummary(resolved, { hasDestination });

  // Label present + scope locked, but SoT incomplete → desync (not "no destination").
  const labelOnlyDesync =
    Boolean(resolved?.label) &&
    !hasDestination &&
    (resolved?.scopeLocked || Boolean(context.destination?.trim()));

  if (hasPendingDestinationQuestion(context.pendingQuestion)) {
    return {
      allowed: false,
      reason: "pending_destination_question",
      hasDestination,
      hasValidTripDuration: durationOk,
      tripDays,
      resolvedDestination: resolved,
    };
  }

  if (hasPendingDurationQuestion(context.pendingQuestion)) {
    return {
      allowed: false,
      reason: "pending_duration_question",
      hasDestination,
      hasValidTripDuration: durationOk,
      tripDays,
      resolvedDestination: resolved,
    };
  }

  if (!hasDestination) {
    const raw = resolved?.label ?? context.destination?.trim();
    let reason: CombinationDiscoveryGuardResult["reason"] = "missing_destination";
    if (raw && isCountryLevelDestination(raw)) {
      reason = "country_level_destination";
    } else if (labelOnlyDesync) {
      reason = "destination_state_desync";
      logCombinationFailureChain({
        destinationLabel: raw,
        destinationResolved: consistency.ok,
        destinationLocked: Boolean(resolved?.scopeLocked),
        guardHasDestination: false,
        primaryReason: "destination_state_desync",
        secondaryReason: "missing_destination",
      });
    }
    return {
      allowed: false,
      reason,
      hasDestination: false,
      hasValidTripDuration: durationOk,
      tripDays,
      resolvedDestination: resolved,
    };
  }

  if (!durationOk) {
    return {
      allowed: false,
      reason: "missing_trip_duration",
      hasDestination: true,
      hasValidTripDuration: false,
      resolvedDestination: resolved,
    };
  }

  return {
    allowed: true,
    reason: "ok",
    hasDestination: true,
    hasValidTripDuration: true,
    tripDays,
    resolvedDestination: resolved,
  };
}

export function canEnterCombinationDiscovery(
  context: CombinationDiscoveryGuardContext,
): boolean {
  return evaluateCombinationDiscoveryGuard(context).allowed;
}

export function logTripDurationGuard(params: {
  tripDays?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  valid: boolean;
  nextState?: string;
}): void {
  logAiPipeline(
    "[TRIP_DURATION_GUARD]",
    `tripDays=${params.tripDays ?? ""}`,
    `startDate=${params.startDate ?? ""}`,
    `endDate=${params.endDate ?? ""}`,
    `valid=${params.valid}`,
    params.nextState ? `nextState=${params.nextState}` : "",
  );
}

export function logCombinationDiscoveryGuard(
  result: CombinationDiscoveryGuardResult,
  destination?: string | null,
): void {
  logAiPipeline(
    "[COMBINATION_DISCOVERY_GUARD]",
    `destination=${destination?.trim() || result.resolvedDestination?.label || ""}`,
    `hasDestination=${result.hasDestination}`,
    `tripDays=${result.tripDays ?? ""}`,
    `hasValidTripDuration=${result.hasValidTripDuration}`,
    `allowed=${result.allowed}`,
    `reason=${result.reason}`,
  );
}

export function logConversationStateTransition(params: {
  from?: string | null;
  to: string;
  reason: string;
}): void {
  logAiPipeline(
    "[CONVERSATION_STATE_TRANSITION]",
    `from=${params.from ?? ""}`,
    `to=${params.to}`,
    `reason=${params.reason}`,
  );
}

export function tripDurationFieldsFromContext(
  ctx?: CanonicalTravelContext | null,
  session?: ChatPlanningSession | null,
): TripDurationFields {
  return {
    tripDays: session?.tripDays,
    days: ctx?.days ?? session?.travelContext?.days ?? session?.tripDays,
    startDate:
      ctx?.startDate ??
      session?.travelContext?.startDate ??
      session?.tripStartDate,
    endDate:
      ctx?.endDate ?? session?.travelContext?.endDate ?? session?.tripEndDate,
  };
}

/**
 * Copy that never interpolates empty / undefined / NaN day counts.
 */
export function buildDestinationDirectionAck(params: {
  destination: string;
  tripDays?: number | null;
  days?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}): string {
  const label = normalizeDestinationLabel(params.destination) || "這趟";
  const start = params.startDate?.trim();
  const end = params.endDate?.trim();
  if (start && end && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    const fmt = (iso: string) => {
      const [y, m, d] = iso.split("-");
      return `${y}/${m}/${d}`;
    };
    return `好，我先記下${label} ${fmt(start)}～${fmt(end)} 的行程方向。`;
  }
  const days = resolveValidTripDays(params);
  if (days != null) {
    return `好，我先記下${label} ${days} 天的行程方向。`;
  }
  return `好的，我們以${label}為主往下規劃。`;
}
