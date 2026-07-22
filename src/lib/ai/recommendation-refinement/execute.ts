/**
 * Execute a recommendation refinement search using ActiveRecommendationContext.
 * Reuses existing Places search helpers — does not touch Candidate Pool / Engine.
 */
import type { Locale } from "@/lib/i18n/types";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamieRecommendationItem, RoamiePayloadV2 } from "@/lib/ai/types";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import {
  fetchPlacesWithSearchAttemptsMerged,
  type PlaceSearchFn,
} from "@/lib/ai/chat-place-recommendation";
import {
  geocodeDestinationWithFallback,
  resolveDestinationApproxCenter,
} from "@/lib/ai/destination-geocode";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import { CHAT_PLACE_CATEGORY_LABELS } from "@/lib/ai/chat-place-intent";
import { distanceMeters } from "@/lib/map-explore";
import {
  buildRefinementSearchAttempts,
  filterPlacesByRecommendationContext,
  logRefinementSearchResult,
  logRefinementSearchStart,
} from "@/lib/ai/recommendation-refinement/search";
import type { ActiveRecommendationContext } from "@/lib/ai/recommendation-refinement/types";
import { recommendationIntentToCategoryIntent } from "@/lib/ai/recommendation-refinement/types";
import { cuisineSearchTokens } from "@/lib/ai/recommendation-refinement/parser";

const TARGET_COUNT = 6;

function buildSummary(
  ctx: ActiveRecommendationContext,
  recommendations: RoamieRecommendationItem[],
): string {
  const dest = ctx.destinationDisplayName ?? ctx.destinationName;
  const city = ctx.resolvedSearchCity ? `（${ctx.resolvedSearchCity}）` : "";
  const categoryIntent = recommendationIntentToCategoryIntent(ctx.intent);
  const heading = `${CHAT_PLACE_CATEGORY_LABELS[categoryIntent]}推薦：`;
  const constraints: string[] = [];
  if (ctx.cuisine?.length) {
    constraints.push(ctx.cuisine.map((c) => cuisineSearchTokens(c)[0] ?? c).join("、"));
  }
  if (ctx.shoppingTypes?.length) constraints.push(ctx.shoppingTypes.join("、"));
  if (ctx.budget?.level === "cheap") constraints.push("偏平價");
  if (ctx.excludedKeywords?.length) {
    constraints.push(`排除${ctx.excludedKeywords.slice(0, 3).join("、")}`);
  }
  const constraintLine = constraints.length ? `已套用：${constraints.join(" · ")}` : "";
  const list = recommendations
    .map(
      (rec, index) =>
        `${index + 1}. ${rec.name}${rec.rating != null ? `（${rec.rating}★）` : ""}${rec.reason ? ` — ${rec.reason}` : ""}`,
    )
    .join("\n");
  return [
    `在${dest}${city}，依你補充的條件再幫你找：`,
    constraintLine,
    "",
    heading,
    list,
    "",
    "想再調整條件或說「還有嗎」都可以。",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

export async function buildRecommendationRefinementResults(params: {
  context: ActiveRecommendationContext;
  travelContext: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  session?: ChatPlanningSession;
}): Promise<{
  summary: string;
  recommendations: RoamieRecommendationItem[];
  payload: RoamiePayloadV2;
  usedQueries: string[];
  stats: {
    rawCount: number;
    categoryAccepted: number;
    subcategoryAccepted: number;
    duplicateRejected: number;
    locationRejected: number;
    qualityRejected: number;
    finalCount: number;
  };
} | null> {
  const { context: recCtx, travelContext, locale, searchPlaces, geocodeFn } = params;
  const city =
    recCtx.resolvedSearchCity?.trim() ||
    recCtx.destinationName.trim() ||
    travelContext.destination?.trim() ||
    "";
  if (!city) return null;

  const attempts = buildRefinementSearchAttempts(recCtx);
  const queries = attempts.map((a) => a.query);
  logRefinementSearchStart(recCtx, queries);

  let lat = recCtx.latitude;
  let lng = recCtx.longitude;
  if (lat == null || lng == null) {
    const geo = await geocodeDestinationWithFallback({
      destination: city,
      locale,
      geocodeFn,
    });
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
    } else {
      const approx = resolveDestinationApproxCenter(city);
      if (approx) {
        lat = approx.lat;
        lng = approx.lng;
      }
    }
  }
  if (lat == null || lng == null) return null;

  const raw = await fetchPlacesWithSearchAttemptsMerged(
    searchPlaces,
    lat,
    lng,
    locale,
    attempts,
    "chat.recommendationRefinement",
    { minResults: 3, maxResults: 24 },
  );

  const excludeSet = new Set(
    recCtx.previousPlaceIds.map((id) => id.trim()).filter(Boolean),
  );
  const withoutExcludedIds = raw.filter((p) => {
    const id = (p.id ?? "").trim();
    return !id || !excludeSet.has(id);
  });
  const filtered = filterPlacesByRecommendationContext(withoutExcludedIds, recCtx);

  // Soft fallback: if cuisine filter emptied the pool, keep category-accepted restaurants
  // that passed exclusion/dedupe but failed cuisine — only when raw had results.
  let finalPlaces = filtered.accepted;
  if (!finalPlaces.length && recCtx.cuisine?.length && withoutExcludedIds.length) {
    finalPlaces = withoutExcludedIds
      .filter((p) => {
        const types = [p.primaryType, ...(p.types ?? [])]
          .filter(Boolean)
          .map((t) => String(t).toLowerCase());
        return types.some((t) => t.includes("restaurant") || t === "food");
      })
      .slice(0, TARGET_COUNT);
  }

  const ranked = [...finalPlaces].sort((a, b) => {
    const scoreA =
      (a.rating ?? 0) * Math.log10((a.userRatingCount ?? 0) + 10);
    const scoreB =
      (b.rating ?? 0) * Math.log10((b.userRatingCount ?? 0) + 10);
    return scoreB - scoreA;
  });

  const categoryIntent = recommendationIntentToCategoryIntent(recCtx.intent);
  const label = CHAT_PLACE_CATEGORY_LABELS[categoryIntent];
  const recommendations = ranked.slice(0, TARGET_COUNT).map((place) => {
    const distM =
      place.lat != null && place.lng != null
        ? distanceMeters({ lat: lat!, lng: lng! }, { lat: place.lat, lng: place.lng })
        : undefined;
    return mapPlaceResultToChatItem(place, {
      mood: travelContext.mood,
      locale,
      distanceMeters: distM,
      categoryLabel: label,
      categoryIntent,
    });
  });

  const stats = {
    rawCount: raw.length,
    categoryAccepted: filtered.categoryAccepted,
    subcategoryAccepted: filtered.subcategoryAccepted,
    duplicateRejected: filtered.duplicateRejected,
    locationRejected: filtered.locationRejected,
    qualityRejected: filtered.qualityRejected,
    finalCount: recommendations.length,
  };
  logRefinementSearchResult(stats);

  if (!recommendations.length) return null;

  const summary = buildSummary(recCtx, recommendations);
  const payload: RoamiePayloadV2 = {
    version: 2,
    title: `${recCtx.destinationDisplayName ?? recCtx.destinationName}推薦`,
    summary,
    recommendations,
    itinerary: [],
    moodTag: travelContext.mood ?? "",
  };

  return {
    summary,
    recommendations,
    payload,
    usedQueries: queries,
    stats,
  };
}
