import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";

export type DestinationCategoryPlaceSearchFailureStage =
  | "rate_limited_before_request"
  | "provider_empty"
  | "destination_filter_empty"
  | "exclusion_empty"
  | "missing_canonical_id"
  | "base_eligibility_empty"
  | "category_guard_empty"
  | "quality_filter_empty"
  | "render_guard_empty"
  | "success";

export type DestinationCategoryPlaceSearchDiagnostics = {
  destination: string;
  intent: ChatPlaceCategoryIntent;
  includedTypes: Set<string>;
  attemptCount: number;
  requestsSent: number;
  rateLimitedBeforeRequest: boolean;
  rawCount: number;
  afterDestinationFilterCount: number;
  afterExclusionCount: number;
  afterCanonicalIdCount: number;
  afterBaseEligibilityCount: number;
  afterCategoryGuardCount: number;
  afterQualityCount: number;
  renderableCount: number;
  finalRecommendationCount: number;
  baseEligibilityRejections: {
    missing_identity: number;
    destination_subplace: number;
    open_status: number;
    school_or_office: number;
    permanently_closed: number;
  };
};

export function createDestinationCategoryPlaceSearchDiagnostics(
  destination: string,
  intent: ChatPlaceCategoryIntent,
): DestinationCategoryPlaceSearchDiagnostics {
  return {
    destination,
    intent,
    includedTypes: new Set<string>(),
    attemptCount: 0,
    requestsSent: 0,
    rateLimitedBeforeRequest: false,
    rawCount: 0,
    afterDestinationFilterCount: 0,
    afterExclusionCount: 0,
    afterCanonicalIdCount: 0,
    afterBaseEligibilityCount: 0,
    afterCategoryGuardCount: 0,
    afterQualityCount: 0,
    renderableCount: 0,
    finalRecommendationCount: 0,
    baseEligibilityRejections: {
      missing_identity: 0,
      destination_subplace: 0,
      open_status: 0,
      school_or_office: 0,
      permanently_closed: 0,
    },
  };
}

export function resolveDestinationCategoryPlaceSearchFailureStage(
  diagnostics: DestinationCategoryPlaceSearchDiagnostics,
): DestinationCategoryPlaceSearchFailureStage {
  if (
    diagnostics.rateLimitedBeforeRequest &&
    diagnostics.finalRecommendationCount === 0
  ) {
    return "rate_limited_before_request";
  }
  if (diagnostics.rawCount === 0) return "provider_empty";
  if (diagnostics.afterDestinationFilterCount === 0) {
    return "destination_filter_empty";
  }
  if (diagnostics.afterExclusionCount === 0) return "exclusion_empty";
  if (diagnostics.afterCanonicalIdCount === 0) return "missing_canonical_id";
  if (diagnostics.afterBaseEligibilityCount === 0) {
    return "base_eligibility_empty";
  }
  if (diagnostics.afterCategoryGuardCount === 0) return "category_guard_empty";
  if (diagnostics.afterQualityCount === 0) return "quality_filter_empty";
  if (diagnostics.renderableCount === 0) return "render_guard_empty";
  return "success";
}

export function logDestinationCategoryPlaceSearchSummary(
  diagnostics: DestinationCategoryPlaceSearchDiagnostics,
): void {
  console.info(
    "[DESTINATION_CATEGORY_PLACE_SEARCH_SUMMARY]",
    `destination=${diagnostics.destination}`,
    `intent=${diagnostics.intent}`,
    `includedTypes=${[...diagnostics.includedTypes].sort().join(",")}`,
    `attemptCount=${diagnostics.attemptCount}`,
    `requestsSent=${diagnostics.requestsSent}`,
    `rateLimitedBeforeRequest=${diagnostics.rateLimitedBeforeRequest}`,
    `rawCount=${diagnostics.rawCount}`,
    `afterDestinationFilterCount=${diagnostics.afterDestinationFilterCount}`,
    `afterExclusionCount=${diagnostics.afterExclusionCount}`,
    `afterCanonicalIdCount=${diagnostics.afterCanonicalIdCount}`,
    `afterBaseEligibilityCount=${diagnostics.afterBaseEligibilityCount}`,
    `afterCategoryGuardCount=${diagnostics.afterCategoryGuardCount}`,
    `afterQualityCount=${diagnostics.afterQualityCount}`,
    `renderableCount=${diagnostics.renderableCount}`,
    `finalRecommendationCount=${diagnostics.finalRecommendationCount}`,
    `baseEligibilityRejections=${Object.entries(diagnostics.baseEligibilityRejections)
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => `${reason}:${count}`)
      .join(",") || "none"}`,
    `failureStage=${resolveDestinationCategoryPlaceSearchFailureStage(diagnostics)}`,
  );
}
