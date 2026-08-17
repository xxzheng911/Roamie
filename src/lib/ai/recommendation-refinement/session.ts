/**
 * Bridge ActiveRecommendationContext ↔ ChatPlanningSession / RecommendationSession.
 */
import type { ChatPlanningSession } from "@/lib/chat-session";
import { resolveActiveCategoryIntent } from "@/lib/ai/conversation-recommendation-session";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import { resolveShoppingSearchScope } from "@/lib/ai/shopping-search-scope";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import {
  appendRecommendationResults,
  createActiveRecommendationContext,
  mergeRecommendationRefinement,
  logRecommendationContextMerged,
} from "@/lib/ai/recommendation-refinement/merge";
import type {
  ActiveRecommendationContext,
  RecommendationIntent,
  RecommendationRefinementPatch,
} from "@/lib/ai/recommendation-refinement/types";
import {
  categoryIntentToRecommendationIntent,
  recommendationIntentToCategoryIntent,
} from "@/lib/ai/recommendation-refinement/types";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";

function placeIdOf(item: {
  googlePlaceId?: string | null;
  placeId?: string | null;
  id?: string | null;
  name?: string | null;
}): string {
  return (item.googlePlaceId ?? item.placeId ?? item.id ?? "").trim();
}

function canonicalKeyOf(item: {
  googlePlaceId?: string | null;
  placeId?: string | null;
  id?: string | null;
  name?: string | null;
  placeName?: string | null;
}): string {
  const id = placeIdOf(item);
  if (id) return `id:${id}`;
  const name = normalizePlaceName(item.placeName ?? item.name ?? "");
  return name ? `n:${name}` : "";
}

export function ensureActiveRecommendationContext(
  session: ChatPlanningSession,
  params: {
    destination: string;
    intent: RecommendationIntent | ChatPlaceCategoryIntent;
    places?: Array<{
      googlePlaceId?: string | null;
      placeId?: string | null;
      id?: string | null;
      name?: string | null;
      placeName?: string | null;
    }>;
    usedQueries?: string[];
    resolvedSearchCity?: string;
    parentCity?: string;
    area?: string;
    searchScope?: import("@/lib/ai/conversation-recommendation-session").RecommendationSearchScope;
    latitude?: number;
    longitude?: number;
    radius?: number;
  },
): ActiveRecommendationContext {
  const existing = session.activeRecommendationContext;
  const intent: RecommendationIntent =
    typeof params.intent === "string" &&
    (params.intent === "restaurant" ||
      params.intent === "cafe" ||
      params.intent === "shopping" ||
      params.intent === "attraction" ||
      params.intent === "nightlife" ||
      params.intent === "indoor" ||
      params.intent === "general_place")
      ? params.intent
      : categoryIntentToRecommendationIntent(params.intent as ChatPlaceCategoryIntent);

  const scope =
    intent === "shopping"
      ? resolveShoppingSearchScope({ destination: params.destination })
      : null;
  const entity = resolveDestinationEntity(params.destination);
  const placeIds = (params.places ?? []).map(placeIdOf).filter(Boolean);
  const canonicalKeys = (params.places ?? []).map(canonicalKeyOf).filter((k) => k && k !== "n:");
  const destinationChanged =
    Boolean(existing?.destinationName) &&
    normalizePlaceName(existing?.destinationDisplayName ?? existing?.destinationName ?? "") !==
      normalizePlaceName(params.destination);

  if (existing && existing.intent === intent && !destinationChanged) {
    // Same intent — refresh geo if missing, append places
    const withGeo: ActiveRecommendationContext = {
      ...existing,
      destinationName: existing.destinationName || params.destination,
      destinationDisplayName:
        existing.destinationDisplayName || params.destination,
      resolvedSearchCity:
        existing.resolvedSearchCity ||
        params.resolvedSearchCity ||
        scope?.activeSearchCity,
      parentCity: existing.parentCity ?? params.parentCity,
      area: existing.area ?? params.area,
      searchScope: existing.searchScope ?? params.searchScope,
      latitude: existing.latitude ?? params.latitude ?? scope?.searchCentroid.lat,
      longitude: existing.longitude ?? params.longitude ?? scope?.searchCentroid.lng,
      radius: existing.radius ?? params.radius ?? scope?.searchRadius,
      countryCode: existing.countryCode ?? entity?.country,
    };
    if (!placeIds.length) return withGeo;
    return appendRecommendationResults(withGeo, {
      placeIds,
      canonicalKeys,
      usedQueries: params.usedQueries,
    });
  }

  return createActiveRecommendationContext({
    destinationName: params.destination,
    destinationDisplayName: params.destination,
    destinationKey: entity?.name ?? params.destination,
    countryCode: entity?.country,
    resolvedSearchCity: params.resolvedSearchCity ?? scope?.activeSearchCity,
    parentCity: params.parentCity,
    area: params.area,
    searchScope: params.searchScope,
    latitude: params.latitude ?? scope?.searchCentroid.lat,
    longitude: params.longitude ?? scope?.searchCentroid.lng,
    radius: params.radius ?? scope?.searchRadius,
    intent,
    placeIds,
    canonicalKeys,
    usedQueries: params.usedQueries,
  });
}

export function applyRefinementPatchToSession(
  session: ChatPlanningSession,
  patch: RecommendationRefinementPatch,
): ChatPlanningSession {
  const base =
    session.activeRecommendationContext ??
    (resolveActiveCategoryIntent(session)
      ? ensureActiveRecommendationContext(session, {
          destination:
            session.recommendationSession?.destination ||
            session.travelContext?.destination ||
            session.tripPlanningContext?.destination ||
            session.tripDestination?.city ||
            "",
          intent: resolveActiveCategoryIntent(session)!,
          places: session.recommendedPlaces,
          usedQueries: session.recommendationSession?.usedQueries,
          resolvedSearchCity: session.recommendationSession?.activeSearchCity,
          parentCity: session.recommendationSession?.parentCity,
          area: session.recommendationSession?.area,
          searchScope: session.recommendationSession?.searchScope,
          latitude: session.recommendationSession?.searchCentroid?.lat,
          longitude: session.recommendationSession?.searchCentroid?.lng,
          radius: session.recommendationSession?.searchRadius,
        })
      : null);

  if (!base || !base.destinationName) return session;

  const merged = mergeRecommendationRefinement(base, patch);
  logRecommendationContextMerged(merged);

  const categoryIntent = recommendationIntentToCategoryIntent(merged.intent);
  return {
    ...session,
    activeRecommendationContext: merged,
    activeCategoryIntent: categoryIntent,
    activeChatIntent:
      categoryIntent === "cafe" || categoryIntent === "restaurant"
        ? categoryIntent
        : session.activeChatIntent,
    foodPreference: merged.cuisine?.[0] ?? session.foodPreference,
    phase: "recommend",
    pendingQuestion: undefined,
  };
}

export function syncActiveRecommendationContextAfterResults(
  session: ChatPlanningSession,
  places: RoamieRecommendationItem[],
  usedQueries?: string[],
  exhausted?: boolean,
): ChatPlanningSession {
  const ctx = session.activeRecommendationContext;
  if (!ctx) return session;
  const next = appendRecommendationResults(ctx, {
    placeIds: places.map(placeIdOf).filter(Boolean),
    canonicalKeys: places.map(canonicalKeyOf).filter((k) => k && k !== "n:"),
    usedQueries,
    exhausted,
  });
  return {
    ...session,
    activeRecommendationContext: next,
  };
}

export function restoreActiveRecommendationContextFromWorkspace(params: {
  session: ChatPlanningSession;
  workspaceContext?: ActiveRecommendationContext | null;
}): ChatPlanningSession {
  const { session, workspaceContext } = params;
  if (session.activeRecommendationContext) return session;
  if (workspaceContext) {
    return { ...session, activeRecommendationContext: workspaceContext };
  }
  // Rebuild from recommendation session if present
  if (session.recommendationSession) {
    const rec = session.recommendationSession;
    return {
      ...session,
      activeRecommendationContext: createActiveRecommendationContext({
        destinationName: rec.destination,
        destinationDisplayName: rec.searchRegionLabel ?? rec.destination,
        resolvedSearchCity: rec.activeSearchCity,
        parentCity: rec.parentCity,
        area: rec.area,
        searchScope: rec.searchScope,
        latitude: rec.searchCentroid?.lat,
        longitude: rec.searchCentroid?.lng,
        radius: rec.searchRadius,
        intent: categoryIntentToRecommendationIntent(rec.topic),
        placeIds: rec.returnedPlaceIds,
        canonicalKeys: rec.returnedCanonicalKeys,
        usedQueries: rec.usedQueries,
      }),
    };
  }
  return session;
}
