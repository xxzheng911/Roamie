import type { ChatShortcutContext } from "@/lib/ai/chat-intent";

export type ShortcutRecommendationFailureStage =
  | "request_not_sent"
  | "provider_empty"
  | "scope_filter_empty"
  | "exclusion_empty"
  | "missing_canonical_id"
  | "category_guard_empty"
  | "quality_filter_empty"
  | "already_recommended_empty"
  | "render_guard_empty"
  | "success";

export type ShortcutRecommendationDiagnostics = {
  shortcut: ChatShortcutContext;
  searchScope: "destination" | "nearby" | "unknown";
  includedTypes: string[];
  excludedTypes: string[];
  attemptCount: number;
  requestsSent: number;
  rawCount: number;
  afterDestinationOrNearbyScopeCount: number;
  afterExclusionCount: number;
  afterCanonicalIdCount: number;
  afterCategoryGuardCount: number;
  afterQualityCount: number;
  afterAlreadyRecommendedCount: number;
  renderableCount: number;
  finalCardCount: number;
  searchReturnedCount?: number;
  requestNotSent?: boolean;
};

export function resolveShortcutRecommendationFailureStage(
  d: ShortcutRecommendationDiagnostics,
): ShortcutRecommendationFailureStage {
  if (d.requestNotSent || d.requestsSent === 0) return "request_not_sent";
  if (d.rawCount === 0) return "provider_empty";
  if (d.afterDestinationOrNearbyScopeCount === 0) return "scope_filter_empty";
  if (d.afterExclusionCount === 0) return "exclusion_empty";
  if (d.afterCanonicalIdCount === 0) return "missing_canonical_id";
  if (d.afterCategoryGuardCount === 0) return "category_guard_empty";
  if (d.afterQualityCount === 0) return "quality_filter_empty";
  if (d.afterAlreadyRecommendedCount === 0) return "already_recommended_empty";
  if (d.renderableCount === 0 || d.finalCardCount === 0) return "render_guard_empty";
  return "success";
}

export function logShortcutRecommendationSummary(
  d: ShortcutRecommendationDiagnostics,
): void {
  console.info(
    "[SHORTCUT_RECOMMENDATION_SUMMARY]",
    `shortcutId=${d.shortcut.shortcutId}`,
    `shortcutLabel=${d.shortcut.shortcutLabel}`,
    `categoryIntent=${d.shortcut.categoryIntent}`,
    `mood=${d.shortcut.mood}`,
    `scene=${d.shortcut.scene}`,
    `searchScope=${d.searchScope}`,
    `includedTypes=${d.includedTypes.join(",")}`,
    `excludedTypes=${d.excludedTypes.join(",")}`,
    `attemptCount=${d.attemptCount}`,
    `requestsSent=${d.requestsSent}`,
    `rawCount=${d.rawCount}`,
    `afterDestinationOrNearbyScopeCount=${d.afterDestinationOrNearbyScopeCount}`,
    `afterExclusionCount=${d.afterExclusionCount}`,
    `afterCanonicalIdCount=${d.afterCanonicalIdCount}`,
    `afterCategoryGuardCount=${d.afterCategoryGuardCount}`,
    `afterQualityCount=${d.afterQualityCount}`,
    `renderableCount=${d.renderableCount}`,
    `finalCardCount=${d.finalCardCount}`,
    `failureStage=${resolveShortcutRecommendationFailureStage(d)}`,
  );
}

export function logShortcutRecommendationRequestNotSent(
  shortcut: ChatShortcutContext,
  searchScope: ShortcutRecommendationDiagnostics["searchScope"],
  includedTypes: string[],
  excludedTypes: string[] = [],
): void {
  logShortcutRecommendationSummary({
    shortcut,
    searchScope,
    includedTypes,
    excludedTypes,
    attemptCount: 0,
    requestsSent: 0,
    rawCount: 0,
    afterDestinationOrNearbyScopeCount: 0,
    afterExclusionCount: 0,
    afterCanonicalIdCount: 0,
    afterCategoryGuardCount: 0,
    afterQualityCount: 0,
    afterAlreadyRecommendedCount: 0,
    renderableCount: 0,
    finalCardCount: 0,
    requestNotSent: true,
  });
}
