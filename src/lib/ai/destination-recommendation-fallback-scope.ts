import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { resolveDestinationForCategorySearch } from "@/lib/ai/chat-category-destination";
import {
  evidenceIncludesArea,
  evidenceIncludesParentCity,
} from "@/lib/ai/destination-area-aliases";
import {
  restorePlaceIntentAfterGeographicClarification,
  type RestoredPlaceClarification,
} from "@/lib/ai/destination-geographic-clarification";
import { resolveDestinationAreaScope } from "@/lib/ai/destination-travel-profile";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";

export type ExplicitDestinationFallbackScope = {
  destination: string;
  parentCity: string;
  area: string;
  searchScope: "area" | "city";
};

export type DestinationRecommendationFallbackDecision = {
  accepted: boolean;
  reason: string;
};

function scopeKey(label: string | null | undefined): string {
  return normalizeDestinationLabel(label ?? "").replace(/[\s,，、/／-]+/g, "");
}

function placeMatchesExplicitArea(
  scope: ExplicitDestinationFallbackScope,
  name: string,
  address: string,
): boolean {
  const blob = `${name} ${address}`.trim();
  if (!blob) return false;
  return (
    evidenceIncludesArea(blob, scope.area) &&
    evidenceIncludesParentCity(blob, scope.parentCity)
  );
}

export function destinationsShareRecommendationScope(
  explicitDestination: string,
  candidateDestination: string | null | undefined,
): boolean {
  const explicit = scopeKey(explicitDestination);
  const candidate = scopeKey(candidateDestination);
  if (!explicit || !candidate) return false;
  if (explicit === candidate) return true;

  const explicitScope = resolveDestinationAreaScope(explicitDestination);
  const candidateScope = resolveDestinationAreaScope(candidateDestination ?? "");
  if (
    explicitScope &&
    candidateScope &&
    scopeKey(explicitScope.parentCity) === scopeKey(candidateScope.parentCity) &&
    scopeKey(explicitScope.area) === scopeKey(candidateScope.area)
  ) {
    return true;
  }
  return false;
}

export function resolveExplicitDestinationFallbackScope(params: {
  userText: string;
  session: ChatPlanningSession;
  context?: CanonicalTravelContext;
  restored?: RestoredPlaceClarification | null;
}): ExplicitDestinationFallbackScope | null {
  if (params.restored) {
    return {
      destination: params.restored.destinationLabel,
      parentCity: params.restored.parentCity,
      area: params.restored.area,
      searchScope: params.restored.searchScope,
    };
  }

  const pending = params.session.pendingClarification;
  const restoredFromPending = restorePlaceIntentAfterGeographicClarification(
    pending,
    params.userText,
  );
  if (restoredFromPending) {
    return {
      destination: restoredFromPending.destinationLabel,
      parentCity: restoredFromPending.parentCity,
      area: restoredFromPending.area,
      searchScope: restoredFromPending.searchScope,
    };
  }

  const fromText = resolveDestinationAreaScope(params.userText);
  if (fromText) {
    return {
      destination: fromText.displayLabel,
      parentCity: fromText.parentCity,
      area: fromText.area,
      searchScope: fromText.searchScope,
    };
  }

  const context = params.context ?? params.session.travelContext ?? { interests: [] };
  const fromCategory = resolveDestinationForCategorySearch(
    context,
    params.session,
    params.userText,
  );
  if (!fromCategory) return null;
  const scoped = resolveDestinationAreaScope(fromCategory);
  if (scoped) {
    return {
      destination: scoped.displayLabel,
      parentCity: scoped.parentCity,
      area: scoped.area,
      searchScope: scoped.searchScope,
    };
  }
  if (!hasCategoryPlaceQuery(params.userText) && !fromCategory.trim()) return null;
  return {
    destination: fromCategory,
    parentCity: fromCategory,
    area: fromCategory,
    searchScope: "city",
  };
}

export function evaluateDestinationRecommendationFallback(params: {
  explicit: ExplicitDestinationFallbackScope;
  sourcePath: string;
  fallbackDestination?: string | null;
  candidatePlaceId?: string | null;
  candidateAddress?: string | null;
  candidateName?: string | null;
}): DestinationRecommendationFallbackDecision {
  const fallbackDestination = params.fallbackDestination?.trim() ?? "";
  if (
    fallbackDestination &&
    !destinationsShareRecommendationScope(params.explicit.destination, fallbackDestination)
  ) {
    return { accepted: false, reason: "cross_scope_destination" };
  }

  if (params.sourcePath === "current-location-nearby" || params.sourcePath === "gps_nearby") {
    return { accepted: false, reason: "current_location_blocked" };
  }
  if (params.sourcePath === "old_recommendation_session" || params.sourcePath === "stored_candidate_pool") {
    if (
      fallbackDestination &&
      !destinationsShareRecommendationScope(params.explicit.destination, fallbackDestination)
    ) {
      return { accepted: false, reason: "old_session_destination" };
    }
  }

  const address = `${params.candidateName ?? ""} ${params.candidateAddress ?? ""}`.trim();
  if (address && params.explicit.searchScope === "area") {
    if (
      !placeMatchesExplicitArea(
        params.explicit,
        params.candidateName ?? "",
        params.candidateAddress ?? "",
      )
    ) {
      return { accepted: false, reason: "cross_scope_place" };
    }
  }

  if (fallbackDestination) {
    return { accepted: true, reason: "same_scope" };
  }
  return { accepted: false, reason: "missing_fallback_destination" };
}

export function shouldBlockCrossScopeRecommendationFallback(params: {
  explicit: ExplicitDestinationFallbackScope | null;
  sourcePath: string;
  fallbackDestination?: string | null;
}): boolean {
  if (!params.explicit) return false;
  const decision = evaluateDestinationRecommendationFallback({
    explicit: params.explicit,
    sourcePath: params.sourcePath,
    fallbackDestination: params.fallbackDestination,
  });
  return !decision.accepted;
}

export function filterRecommendationsForExplicitDestinationScope(
  items: RoamieRecommendationItem[],
  scope: ExplicitDestinationFallbackScope,
): RoamieRecommendationItem[] {
  if (scope.searchScope !== "area") {
    const destKey = scopeKey(scope.destination);
    return items.filter((item) => {
      const blob = `${item.name ?? ""} ${item.address ?? ""}`;
      return scopeKey(blob).includes(destKey);
    });
  }
  return items.filter((item) =>
    placeMatchesExplicitArea(scope, item.placeName ?? item.name ?? "", item.address ?? ""),
  );
}

export function isolateSessionToExplicitDestination<T extends ChatPlanningSession>(
  session: T,
  scope: ExplicitDestinationFallbackScope,
): T {
  const recDest =
    session.recommendationSession?.destination ||
    session.activeRecommendationContext?.destinationName ||
    session.travelContext?.destination;
  const stale =
    recDest && !destinationsShareRecommendationScope(scope.destination, recDest);
  return {
    ...session,
    travelContext: {
      ...(session.travelContext ?? { interests: [] }),
      destination: scope.destination,
    },
    recommendationSession: stale ? undefined : session.recommendationSession,
    activeRecommendationContext: stale ? undefined : session.activeRecommendationContext,
    recommendedPlaces: stale
      ? filterRecommendationsForExplicitDestinationScope(session.recommendedPlaces, scope)
      : session.recommendedPlaces,
  };
}

export function logDestinationRecommendationFallbackSummary(params: {
  destination: string;
  sourcePath: string;
  fallbackDestination?: string | null;
  candidatePlaceId?: string | null;
  accepted: boolean;
  reason: string;
}): void {
  logAiPipeline(
    "[DESTINATION_RECOMMENDATION_FALLBACK_SUMMARY]",
    `destination=${params.destination}`,
    `sourcePath=${params.sourcePath}`,
    `fallbackDestination=${params.fallbackDestination?.trim() || "none"}`,
    `candidatePlaceId=${params.candidatePlaceId?.trim() || "none"}`,
    `accepted=${params.accepted ? "accepted" : "rejected"}`,
    `reason=${params.reason}`,
  );
}
