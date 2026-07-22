/**
 * Incremental merge for ActiveRecommendationContext.
 * Never wipe prior cuisine/budget/exclusions when adding a new constraint.
 */
import type {
  ActiveRecommendationContext,
  RecommendationIntent,
  RecommendationRefinementPatch,
} from "@/lib/ai/recommendation-refinement/types";
import { recommendationIntentToCategoryIntent } from "@/lib/ai/recommendation-refinement/types";

function uniq(values: string[] | undefined): string[] | undefined {
  if (!values?.length) return values;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

function mergeLists(
  prev: string[] | undefined,
  next: string[] | undefined,
): string[] | undefined {
  if (!next?.length) return prev;
  return uniq([...(prev ?? []), ...next]);
}

/** Fields that are restaurant-specific and must clear on intent switch away from restaurant. */
const RESTAURANT_ONLY_KEYS = ["cuisine"] as const;

function sharedConditionsSurvivingIntentSwitch(
  prev: ActiveRecommendationContext,
): Partial<ActiveRecommendationContext> {
  return {
    budget: prev.budget,
    atmosphere: prev.atmosphere,
    companion: prev.companion,
    mealSlot: prev.mealSlot,
    openNow: prev.openNow,
    quietOnly: prev.quietOnly,
    nearStation: prev.nearStation,
    walkable: prev.walkable,
    highRatingPreferred: prev.highRatingPreferred,
    preferredKeywords: prev.preferredKeywords,
    // Keep exclusions that are still meaningful (chain, queue, tourist…)
    excludedKeywords: prev.excludedKeywords,
  };
}

export function createActiveRecommendationContext(params: {
  destinationName: string;
  destinationDisplayName?: string;
  destinationKey?: string;
  countryCode?: string;
  resolvedSearchCity?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  intent: RecommendationIntent;
  category?: string;
  subcategory?: string;
  placeIds?: string[];
  canonicalKeys?: string[];
  usedQueries?: string[];
}): ActiveRecommendationContext {
  const now = Date.now();
  const placeIds = params.placeIds ?? [];
  return {
    destinationName: params.destinationName.trim(),
    destinationDisplayName: params.destinationDisplayName?.trim() || params.destinationName.trim(),
    destinationKey: params.destinationKey,
    countryCode: params.countryCode,
    resolvedSearchCity: params.resolvedSearchCity?.trim() || undefined,
    latitude: params.latitude,
    longitude: params.longitude,
    radius: params.radius,
    intent: params.intent,
    category: params.category ?? recommendationIntentToCategoryIntent(params.intent),
    subcategory: params.subcategory,
    previousPlaceIds: [...placeIds],
    previousCanonicalKeys: [...(params.canonicalKeys ?? [])],
    currentResultPlaceIds: [...placeIds],
    usedQueries: [...(params.usedQueries ?? [])],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Merge a refinement patch into the active context.
 * Intent switch clears restaurant-only fields and previous results.
 */
export function mergeRecommendationRefinement(
  prev: ActiveRecommendationContext,
  patch: RecommendationRefinementPatch,
): ActiveRecommendationContext {
  const now = Date.now();
  const intentSwitch = patch.intentSwitch;
  const switching =
    intentSwitch != null && intentSwitch !== prev.intent;

  if (switching && intentSwitch) {
    const shared = sharedConditionsSurvivingIntentSwitch(prev);
    return {
      ...prev,
      ...shared,
      intent: intentSwitch,
      category: patch.category ?? recommendationIntentToCategoryIntent(intentSwitch),
      subcategory: patch.subcategory,
      cuisine: undefined,
      shoppingTypes: patch.shoppingTypes,
      attractionTypes: patch.attractionTypes,
      budget: patch.budget ?? shared.budget,
      atmosphere: mergeLists(shared.atmosphere, patch.atmosphere),
      companion: mergeLists(shared.companion, patch.companion),
      mealSlot: patch.mealSlot ?? shared.mealSlot,
      openNow: patch.openNow ?? shared.openNow,
      indoorOnly: patch.indoorOnly,
      quietOnly: patch.quietOnly ?? shared.quietOnly,
      reservationPreferred: patch.reservationPreferred,
      soloFriendly: patch.soloFriendly ?? undefined,
      familyFriendly: patch.familyFriendly ?? undefined,
      nearStation: patch.nearStation ?? shared.nearStation,
      walkable: patch.walkable ?? shared.walkable,
      highRatingPreferred: patch.highRatingPreferred ?? shared.highRatingPreferred,
      preferredKeywords: mergeLists(shared.preferredKeywords, patch.preferredKeywords),
      excludedKeywords: mergeLists(shared.excludedKeywords, patch.excludedKeywords),
      resolvedSearchCity: patch.searchCityOverride ?? prev.resolvedSearchCity,
      // Clear previous restaurant results on topic switch
      previousPlaceIds: [],
      previousCanonicalKeys: [],
      currentResultPlaceIds: [],
      usedQueries: [],
      reserveCandidates: undefined,
      exhausted: false,
      updatedAt: now,
    };
  }

  void RESTAURANT_ONLY_KEYS;

  return {
    ...prev,
    category: patch.category ?? prev.category,
    subcategory: patch.subcategory ?? prev.subcategory,
    cuisine: mergeLists(prev.cuisine, patch.cuisine),
    shoppingTypes: mergeLists(prev.shoppingTypes, patch.shoppingTypes),
    attractionTypes: mergeLists(prev.attractionTypes, patch.attractionTypes),
    budget: patch.budget
      ? {
          ...prev.budget,
          ...patch.budget,
        }
      : prev.budget,
    atmosphere: mergeLists(prev.atmosphere, patch.atmosphere),
    companion: mergeLists(prev.companion, patch.companion),
    mealSlot: patch.mealSlot ?? prev.mealSlot,
    openNow: patch.openNow ?? prev.openNow,
    indoorOnly: patch.indoorOnly ?? prev.indoorOnly,
    quietOnly: patch.quietOnly ?? prev.quietOnly,
    reservationPreferred: patch.reservationPreferred ?? prev.reservationPreferred,
    soloFriendly: patch.soloFriendly ?? prev.soloFriendly,
    familyFriendly: patch.familyFriendly ?? prev.familyFriendly,
    nearStation: patch.nearStation ?? prev.nearStation,
    walkable: patch.walkable ?? prev.walkable,
    highRatingPreferred: patch.highRatingPreferred ?? prev.highRatingPreferred,
    preferredKeywords: mergeLists(prev.preferredKeywords, patch.preferredKeywords),
    excludedKeywords: mergeLists(prev.excludedKeywords, patch.excludedKeywords),
    resolvedSearchCity: patch.searchCityOverride ?? prev.resolvedSearchCity,
    // 「還有嗎」must not clear refinements — only touch updatedAt unless results appended elsewhere
    updatedAt: now,
  };
}

/** Append newly shown place ids / queries after a successful refinement search. */
export function appendRecommendationResults(
  ctx: ActiveRecommendationContext,
  params: {
    placeIds: string[];
    canonicalKeys?: string[];
    usedQueries?: string[];
    exhausted?: boolean;
  },
): ActiveRecommendationContext {
  const placeIds = uniq([...(ctx.previousPlaceIds ?? []), ...params.placeIds]) ?? [];
  const canonicalKeys =
    uniq([...(ctx.previousCanonicalKeys ?? []), ...(params.canonicalKeys ?? [])]) ?? [];
  const usedQueries = uniq([...(ctx.usedQueries ?? []), ...(params.usedQueries ?? [])]) ?? [];
  return {
    ...ctx,
    previousPlaceIds: placeIds,
    previousCanonicalKeys: canonicalKeys,
    currentResultPlaceIds: [...params.placeIds],
    usedQueries,
    exhausted: params.exhausted ?? ctx.exhausted,
    updatedAt: Date.now(),
  };
}

export function logRecommendationContextMerged(ctx: ActiveRecommendationContext): void {
  console.info(
    "[RECOMMENDATION_CONTEXT_MERGED]",
    `intent=${ctx.intent}`,
    `destination=${ctx.destinationDisplayName ?? ctx.destinationName}`,
    `resolvedCity=${ctx.resolvedSearchCity ?? ""}`,
    `cuisine=${(ctx.cuisine ?? []).join(",")}`,
    `budget=${ctx.budget?.level ?? ""}`,
    `excludedKeywords=${(ctx.excludedKeywords ?? []).join(",")}`,
    `previousPlaceCount=${ctx.previousPlaceIds.length}`,
    `previousCanonicalCount=${ctx.previousCanonicalKeys.length}`,
  );
}
