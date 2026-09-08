import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import { resolveCanonicalPlaceIdentity } from "@/lib/place-canonical-identity";
import { planningRejectedCandidateIds } from "@/lib/ai/planning-conversation-constraints";
import { isHardGooglePlaceId } from "@/lib/ai/planning-place-id";

type CandidateWithPlanningIdentity = ChatPlaceItem & {
  canonicalId?: string;
  canonicalPlaceId?: string;
  id?: string;
};

export type PlanningRequiredAnchorHandoff<T extends ChatPlaceItem> = {
  requiredPlaces: T[];
  supplementalPlaces: T[];
  excludedPlaceIds: string[];
  acceptedCount: number;
  mustIncludeCount: number;
  excludedCount: number;
  resolvedAcceptedCount: number;
  unresolvedAcceptedCount: number;
  staleSelectedDroppedCount: number;
  excludedDroppedCount: number;
  finalRequiredCount: number;
  overlapCount: number;
  acceptedMissingCount: number;
  explicitConversationalAuthority: boolean;
  legacyFallbackBlocked: boolean;
};

export type PlanningGenerationCandidateSource =
  | "active_context"
  | "assistant_metadata"
  | "persisted_session"
  | "workspace"
  | "none";

export type PlanningGenerationCandidateContext<T extends ChatPlaceItem> = {
  candidates: T[];
  source: PlanningGenerationCandidateSource;
  activeContextAvailable: boolean;
  recoveryUsed: boolean;
};

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}

function identityTokens(place: CandidateWithPlanningIdentity): string[] {
  const canonical = resolveCanonicalPlaceIdentity(place);
  return unique([
    place.canonicalId ?? "",
    place.canonicalPlaceId ?? "",
    place.googlePlaceId ?? "",
    place.placeId ?? "",
    place.id ?? "",
    canonical.canonicalPlaceId ?? "",
    canonical.identityKey,
  ]);
}

export function logPlanningRequiredIdentityHandoff(
  stage: "shown_candidate" | "accepted_resolution" | "planner_handoff" | "native_request",
  places: readonly CandidateWithPlanningIdentity[],
  generationId = "",
  counts?: {
    shownCandidateCount?: number;
    acceptedCandidateCount?: number;
    requiredCandidateCount?: number;
  },
): void {
  const googleIdPresentCount = places.filter((place) =>
    isHardGooglePlaceId(place.googlePlaceId),
  ).length;
  const canonicalOnlyCount = places.filter(
    (place) => !isHardGooglePlaceId(place.googlePlaceId) && identityTokens(place).length > 0,
  ).length;
  console.info("[PLANNING_REQUIRED_IDENTITY_HANDOFF]", {
    generationId,
    stage,
    shownCandidateCount: counts?.shownCandidateCount ?? 0,
    acceptedCandidateCount: counts?.acceptedCandidateCount ?? 0,
    requiredCandidateCount: counts?.requiredCandidateCount ?? places.length,
    inputRequiredCount: places.length,
    googleIdPresentCount,
    missingGoogleIdCount: places.length - googleIdPresentCount,
    canonicalOnlyCount,
  });
}

export function hasUndeliverableRequiredIdentity(
  places: readonly CandidateWithPlanningIdentity[],
): boolean {
  return places.some((place) => !isHardGooglePlaceId(place.googlePlaceId));
}

function hasIdentity(place: CandidateWithPlanningIdentity, identities: Set<string>): boolean {
  return identityTokens(place).some((identity) => identities.has(identity));
}

function dedupeByCanonicalIdentity<T extends ChatPlaceItem>(places: T[]): T[] {
  const seen = new Set<string>();
  return places.filter((place) => {
    const key = resolveCanonicalPlaceIdentity(place).identityKey;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function samePlanningContext(
  active: Pick<ChatPlanningSession, "workspaceId" | "conversationId">,
  candidate: Pick<ChatPlanningSession, "workspaceId" | "conversationId"> | undefined,
): boolean {
  if (!candidate) return false;
  if (active.workspaceId && candidate.workspaceId !== active.workspaceId) return false;
  if (active.conversationId && candidate.conversationId !== active.conversationId) return false;
  return Boolean(active.workspaceId || active.conversationId);
}

/** Resolves the one candidate snapshot authorized for this generation only. */
export function resolvePlanningCandidateContextForGeneration<T extends ChatPlaceItem>(params: {
  session: ChatPlanningSession;
  assistantCandidates?: T[];
  persistedSession?: ChatPlanningSession;
  workspace?: {
    workspaceId: string;
    conversationId: string;
    planningSession?: ChatPlanningSession;
  } | null;
}): PlanningGenerationCandidateContext<T> {
  const active = (params.session.activeShownCandidates ?? []) as unknown as T[];
  if (active.length) {
    return {
      candidates: dedupeByCanonicalIdentity(active),
      source: "active_context",
      activeContextAvailable: true,
      recoveryUsed: false,
    };
  }
  if (params.assistantCandidates?.length) {
    return {
      candidates: dedupeByCanonicalIdentity(params.assistantCandidates),
      source: "assistant_metadata",
      activeContextAvailable: false,
      recoveryUsed: true,
    };
  }
  if (
    samePlanningContext(params.session, params.persistedSession) &&
    params.persistedSession?.activeShownCandidates?.length
  ) {
    return {
      candidates: dedupeByCanonicalIdentity(
        params.persistedSession.activeShownCandidates as unknown as T[],
      ),
      source: "persisted_session",
      activeContextAvailable: false,
      recoveryUsed: true,
    };
  }
  const workspaceSession = params.workspace?.planningSession;
  const workspaceMatches = Boolean(
    params.session.workspaceId &&
      params.workspace?.workspaceId === params.session.workspaceId &&
      (!params.session.conversationId ||
        params.workspace?.conversationId === params.session.conversationId),
  );
  if (workspaceMatches && workspaceSession?.activeShownCandidates?.length) {
    return {
      candidates: dedupeByCanonicalIdentity(
        workspaceSession.activeShownCandidates as unknown as T[],
      ),
      source: "workspace",
      activeContextAvailable: false,
      recoveryUsed: true,
    };
  }
  return {
    candidates: [],
    source: "none",
    activeContextAvailable: false,
    recoveryUsed: false,
  };
}

/**
 * Conversational planning authority boundary.
 *
 * Accepted shown candidates and explicit must-includes are required. Places
 * discovered while hydrating/supplementing the trip remain optional and must
 * never become required merely because they were written to selectedPlaces.
 */
export function resolvePlanningRequiredAnchorHandoff<T extends ChatPlaceItem>(params: {
  session: ChatPlanningSession;
  candidateRequiredPlaces: T[];
  selectionMode: boolean;
  additionalExcludedPlaceIds?: string[];
}): PlanningRequiredAnchorHandoff<T> {
  const { session, candidateRequiredPlaces, selectionMode } = params;
  const constraints = session.planningConstraints;
  const acceptedIds = unique(constraints?.acceptedCandidateIds ?? []);
  const mustIncludeIds = unique(
    constraints?.mustIncludePlaces
      .map((reference) => reference.placeId)
      .filter((id): id is string => Boolean(id?.trim())) ?? [],
  );
  const excludedPlaceIds = unique([
    ...planningRejectedCandidateIds(session),
    ...(params.additionalExcludedPlaceIds ?? []),
  ]);
  const excludedIdentities = new Set(excludedPlaceIds);
  const acceptedIdentities = new Set(acceptedIds);
  const mustIncludeIdentities = new Set(mustIncludeIds);
  const legacyFallbackBlocked =
    !selectionMode &&
    constraints?.clarificationRequired === true &&
    acceptedIds.length === 0 &&
    mustIncludeIds.length === 0;
  const explicitConversationalAuthority =
    !selectionMode &&
    (acceptedIds.length > 0 || mustIncludeIds.length > 0 || legacyFallbackBlocked);

  if (selectionMode) {
    return {
      requiredPlaces: candidateRequiredPlaces,
      supplementalPlaces: [],
      excludedPlaceIds,
      acceptedCount: acceptedIds.length,
      mustIncludeCount: mustIncludeIds.length,
      excludedCount: excludedPlaceIds.length,
      resolvedAcceptedCount: acceptedIds.length,
      unresolvedAcceptedCount: 0,
      staleSelectedDroppedCount: 0,
      excludedDroppedCount: 0,
      finalRequiredCount: candidateRequiredPlaces.length,
      overlapCount: 0,
      acceptedMissingCount: 0,
      explicitConversationalAuthority: false,
      legacyFallbackBlocked: false,
    };
  }

  const resolutionPool = dedupeByCanonicalIdentity([
    ...((session.activeShownCandidates ?? []) as unknown as T[]),
    ...(session.selectedPlaces as T[]),
    ...((session.plannedStops ?? []) as T[]),
    ...(session.recommendedPlaces as T[]),
    ...candidateRequiredPlaces,
  ]);
  const resolvedAccepted = acceptedIds.flatMap((acceptedId) => {
    const match = resolutionPool.find((candidate) => hasIdentity(candidate, new Set([acceptedId])));
    return match ? [match] : [];
  });
  const resolvedMustIncludes = mustIncludeIds.flatMap((mustIncludeId) => {
    const match = resolutionPool.find((candidate) =>
      hasIdentity(candidate, new Set([mustIncludeId])),
    );
    return match ? [match] : [];
  });
  // P43 authority boundary: shown/persisted candidates are lookup and
  // supplemental authority only. Non-selection required anchors must always
  // have an explicit accepted or must-include reference.
  const authoritativeCandidates = dedupeByCanonicalIdentity([
    ...resolvedAccepted,
    ...resolvedMustIncludes,
  ]);

  const overlap = authoritativeCandidates.filter((place) => hasIdentity(place, excludedIdentities));
  const requiredPlaces = authoritativeCandidates.filter(
    (place) => !hasIdentity(place, excludedIdentities),
  );
  const requiredIdentityKeys = new Set(requiredPlaces.flatMap((place) => identityTokens(place)));
  const supplementalPlaces = dedupeByCanonicalIdentity(
    candidateRequiredPlaces.filter(
      (place) =>
        !hasIdentity(place, requiredIdentityKeys) && !hasIdentity(place, excludedIdentities),
    ),
  );
  const excludedDroppedCount = candidateRequiredPlaces.filter((place) =>
    hasIdentity(place, excludedIdentities),
  ).length;
  const acceptedMissingCount = acceptedIds.filter(
    (acceptedId) => !requiredPlaces.some((place) => hasIdentity(place, new Set([acceptedId]))),
  ).length;

  return {
    requiredPlaces,
    supplementalPlaces,
    excludedPlaceIds,
    acceptedCount: acceptedIds.length,
    mustIncludeCount: mustIncludeIds.length,
    excludedCount: excludedPlaceIds.length,
    resolvedAcceptedCount: resolvedAccepted.length,
    unresolvedAcceptedCount: Math.max(0, acceptedIds.length - resolvedAccepted.length),
    staleSelectedDroppedCount: explicitConversationalAuthority ? supplementalPlaces.length : 0,
    excludedDroppedCount,
    finalRequiredCount: requiredPlaces.length,
    overlapCount: overlap.length,
    acceptedMissingCount,
    explicitConversationalAuthority,
    legacyFallbackBlocked,
  };
}

export const REQUIRED_CAPACITY_OVERFLOW_USER_MESSAGE =
  "選擇的地點較多，這趟行程可能排不完。可以減少地點或增加天數。";

export function assessPlanningRequiredCapacity(
  requiredCount: number,
  days: number,
  maxPlacesPerDay = 5,
): { overflow: boolean; requiredCount: number; hardCapacity: number } {
  const safeDays = Math.max(1, Math.floor(days));
  const safeMax = Math.max(1, Math.floor(maxPlacesPerDay));
  const hardCapacity = safeDays * safeMax;
  return { overflow: requiredCount > hardCapacity, requiredCount, hardCapacity };
}

export function logPlanningRequiredAnchorHandoff(
  handoff: PlanningRequiredAnchorHandoff<ChatPlaceItem>,
  generationId = "",
): void {
  console.info("[PLANNING_REQUIRED_ANCHOR_HANDOFF]", {
    generationId,
    acceptedCount: handoff.acceptedCount,
    mustIncludeCount: handoff.mustIncludeCount,
    excludedCount: handoff.excludedCount,
    resolvedAcceptedCount: handoff.resolvedAcceptedCount,
    unresolvedAcceptedCount: handoff.unresolvedAcceptedCount,
    staleSelectedDroppedCount: handoff.staleSelectedDroppedCount,
    excludedDroppedCount: handoff.excludedDroppedCount,
    finalRequiredCount: handoff.finalRequiredCount,
    legacyFallbackBlocked: handoff.legacyFallbackBlocked,
  });
  console.info("[PLANNING_REQUIRED_ANCHOR_INVARIANT]", {
    generationId,
    requiredCount: handoff.finalRequiredCount,
    excludedCount: handoff.excludedCount,
    overlapCount: handoff.overlapCount,
    acceptedMissingCount: handoff.acceptedMissingCount,
  });
}
