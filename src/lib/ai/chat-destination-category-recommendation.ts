import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamiePayloadV2, RoamieRecommendationItem } from "@/lib/ai/types";
import {
  CHAT_PLACE_CATEGORY_LABELS,
  buildChatPlaceSearchAttempts,
  logChatPlaceCardsRendered,
  logChatPlaceContext,
  logChatPlaceFallback,
  logChatPlaceIntent,
  logChatPlaceQuery,
  logChatPlaceResults,
  type ChatPlaceCategoryIntent,
} from "@/lib/ai/chat-place-intent";
import {
  fetchPlacesWithSearchAttemptsMerged,
  type PlaceSearchFn,
  type SearchAttempt,
} from "@/lib/ai/chat-place-recommendation";
import {
  geocodeDestinationWithFallback,
  logDestinationTextSearchResult,
  resolveDestinationApproxCenter,
} from "@/lib/ai/destination-geocode";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import {
  logChatDestinationResolved,
  logChatPlacesError,
  logChatPlacesResponse,
} from "@/lib/ai/chat-place-flow-log";
import {
  CHAT_DESTINATION_MIN_COUNT,
  filterChatCategoryPlaces,
} from "@/lib/ai/chat-destination-place-filter";
import {
  buildCafeRelaxedSearchAttempts,
} from "@/lib/ai/chat-cafe-search";
import {
  dedupeRecommendationCopy,
  filterRecommendationsForCategoryRender,
  resolveCategorySearchIntent,
  shouldUseNamedMustVisitFallback,
} from "@/lib/ai/chat-category-place-guard";
import { classifyDestinationForPlaceSearch } from "@/lib/ai/landmark-place-strategy";
import { filterPlacesForAttractionRecommendation } from "@/lib/ai/place-recommendation-rules";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import { distanceMeters } from "@/lib/map-explore";
import { beginPlacesFlow, endPlacesFlow } from "@/lib/places-api-stats";
import {
  filterAlreadyRecommendedPlaces,
  filterExcludedPlaceIds,
} from "@/lib/place-planning-memory";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import { buildNamedFallbackRecommendations } from "@/lib/ai/must-visit-places";
import {
  filterPlacesByDestinationGuard,
  type ChatPlaceSearchContext,
} from "@/lib/ai/chat-place-search-context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { resolveRecommendationStyleTag } from "@/lib/ai/resolve-recommendation-style-tag";
import {
  buildMealRecommendationDescription,
  buildMealSearchAttempts,
  filterPlacesForMealIntent,
  parseMealIntentFromText,
  sanitizeMealSummaryText,
  sanitizeMealReasonText,
  type ParsedMealIntent,
} from "@/lib/ai/meal-intent-parser";

const PER_GROUP_TARGET = 3;
const SINGLE_INTENT_MAX = 6;

function rankCategoryPlaces(
  places: PlaceResult[],
  lat: number,
  lng: number,
): PlaceResult[] {
  return [...places].sort((a, b) => {
    const scoreA =
      (a.rating ?? 0) * Math.log10((a.userRatingCount ?? 0) + 10) -
      (a.lat != null && a.lng != null
        ? distanceMeters({ lat, lng }, { lat: a.lat, lng: a.lng })
        : Number.MAX_SAFE_INTEGER) /
      50_000;
    const scoreB =
      (b.rating ?? 0) * Math.log10((b.userRatingCount ?? 0) + 10) -
      (b.lat != null && b.lng != null
        ? distanceMeters({ lat, lng }, { lat: b.lat, lng: b.lng })
        : Number.MAX_SAFE_INTEGER) /
      50_000;
    return scoreB - scoreA;
  });
}

async function searchCategoryPlaces(params: {
  intent: ChatPlaceCategoryIntent;
  destination: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  context: CanonicalTravelContext;
  userText: string;
  excludePlaceIds: string[];
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchContext?: ChatPlaceSearchContext;
  mealIntent?: ParsedMealIntent | null;
}): Promise<PlaceResult[]> {
  const {
    intent,
    destination,
    lat,
    lng,
    locale,
    searchPlaces,
    context,
    userText,
    excludePlaceIds,
    profile,
    searchContext,
    mealIntent,
  } = params;

  const mealAttempts =
    mealIntent && intent === "restaurant"
      ? buildMealSearchAttempts(mealIntent.city ?? destination, mealIntent.slot)
      : null;
  const { primary, fallback } = mealAttempts
    ? { primary: mealAttempts, fallback: [] as SearchAttempt[] }
    : buildChatPlaceSearchAttempts(intent, destination);
  const minResults = CHAT_DESTINATION_MIN_COUNT;
  const searchExtras = searchContext
    ? { searchContext, intentCategory: intent }
    : undefined;

  const runSearch = async (attempts: typeof primary, isFallback: boolean) => {
    for (const attempt of attempts) {
      logChatPlaceQuery(intent, attempt.query, isFallback);
    }
    let places = await fetchPlacesWithSearchAttemptsMerged(
      searchPlaces,
      lat,
      lng,
      locale,
      attempts,
      `chat.category.${intent}${isFallback ? ".fallback" : ""}`,
      { minResults, maxResults: 24, extras: searchExtras },
    );
    places = filterPlacesByDestinationGuard(places, destination, userText);
    places = filterExcludedPlaceIds(places, excludePlaceIds);
    if (intent !== "cafe") {
      places = filterPlacesForAttractionRecommendation(places, {
        allowParks: intent === "attraction" || intent === "indoor",
        profile,
        parentLandmark: profile?.parentLandmark,
        blockedPlaceIds: excludePlaceIds,
      });
    }
    places = filterChatCategoryPlaces(places, {
      intent,
      destination,
      profile,
      userText,
    });
    places = rankCategoryPlaces(places, lat, lng);
    if (mealIntent && intent === "restaurant") {
      places = filterPlacesForMealIntent(places, mealIntent);
    }
    return places;
  };

  let places = await runSearch(primary, false);
  logChatPlaceResults(intent, places.length);

  if (places.length >= minResults) {
    return places;
  }

  if (places.length < minResults && fallback.length > 0) {
    for (const attempt of fallback) {
      logChatPlaceFallback(intent, attempt.query);
    }
    const fallbackPlaces = await runSearch(fallback, true);
    logChatPlaceResults(intent, fallbackPlaces.length);
    if (fallbackPlaces.length > places.length) {
      places = fallbackPlaces;
    }
  }

  if (places.length < minResults && intent === "cafe") {
    const relaxed = buildCafeRelaxedSearchAttempts(destination);
    const more = await runSearch(relaxed, true);
    if (more.length > places.length) {
      places = more;
    }
  }

  return places;
}

function placesToRecommendations(
  places: PlaceResult[],
  lat: number,
  lng: number,
  context: CanonicalTravelContext,
  locale: Locale,
  categoryLabel: string,
  mealIntent?: ParsedMealIntent | null,
): RoamieRecommendationItem[] {
  return places.map((place) => {
    const distM =
      place.lat != null && place.lng != null
        ? distanceMeters({ lat, lng }, { lat: place.lat, lng: place.lng })
        : undefined;
    const item = mapPlaceResultToChatItem(place, {
      mood: context.mood,
      locale,
      distanceMeters: distM,
      categoryLabel,
    });
    if (mealIntent) {
      return {
        ...item,
        reason: buildMealRecommendationDescription(place, mealIntent),
        description: buildMealRecommendationDescription(place, mealIntent),
      };
    }
    return item;
  }).map(dedupeRecommendationCopy);
}

function buildGroupedSummary(
  destination: string,
  groups: Array<{ intent: ChatPlaceCategoryIntent; recommendations: RoamieRecommendationItem[] }>,
  mealIntent?: ParsedMealIntent | null,
): string {
  const label = normalizeDestinationLabel(destination);
  const sections: string[] = [`在${label}，這些地方值得先看看：`];

  for (const group of groups) {
    if (!group.recommendations.length) continue;
    const heading = `${CHAT_PLACE_CATEGORY_LABELS[group.intent]}推薦：`;
    const lines = group.recommendations.map((rec, index) => {
      let reason = rec.reason ?? "";
      if (mealIntent) {
        reason = sanitizeMealReasonText(reason, mealIntent.slot);
      }
      return `${index + 1}. ${rec.name}${rec.rating != null ? `（${rec.rating}★）` : ""}${reason ? ` — ${reason}` : ""}`;
    });
    sections.push("", heading, ...lines);
  }

  sections.push("", "想加進行程的話，直接點卡片或跟我說你最想先排哪幾個。");
  return sections.join("\n");
}

export async function buildDestinationCategoryRecommendations(params: {
  destination: string;
  intents: ChatPlaceCategoryIntent[];
  userText: string;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  excludePlaceIds?: string[];
  rejectedPlaceNames?: string[];
  session?: ChatPlanningSession;
}): Promise<{
  summary: string;
  recommendations: RoamieRecommendationItem[];
  payload: RoamiePayloadV2;
  contextPatch: Partial<CanonicalTravelContext>;
}> {
  const {
    destination,
    intents,
    userText,
    context,
    locale,
    searchPlaces,
    geocodeFn,
    excludePlaceIds = [],
    rejectedPlaceNames = [],
    session,
  } = params;
  const label = normalizeDestinationLabel(destination);
  const mealIntent = parseMealIntentFromText(userText);

  logChatPlaceIntent(intents, userText);
  const lockedIntent = resolveCategorySearchIntent(userText, intents);
  const searchIntents = intents.length ? intents : [lockedIntent];
  logChatPlaceContext({
    destination: label,
    days: context.days,
    travelDate: context.startDate ?? context.travelMonth,
    preferences: context.interests,
  });

  const flow = beginPlacesFlow("chat_destination_category");
  try {
    const geocoded = await geocodeDestinationWithFallback({
      destination: label,
      locale,
      geocodeFn,
    });

    let lat: number;
    let lng: number;
    let textOnlyDestinationSearch = false;
    if (geocoded?.lat != null && geocoded?.lng != null) {
      lat = geocoded.lat;
      lng = geocoded.lng;
      logChatDestinationResolved(label, lat, lng, "geocode");
    } else {
      const approx = resolveDestinationApproxCenter(label);
      if (approx) {
        lat = approx.lat;
        lng = approx.lng;
        logChatDestinationResolved(label, lat, lng, "approx_center");
      } else {
        lat = 0;
        lng = 0;
        textOnlyDestinationSearch = true;
        logChatDestinationResolved(label, lat, lng, "approx_center");
      }
    }

    const entity = resolveDestinationEntity(label);
    const searchContext: ChatPlaceSearchContext = {
      searchMode: "destination",
      destinationName: label,
      destinationLatLng: textOnlyDestinationSearch ? null : { lat, lng },
      textOnlyDestinationSearch,
      destinationCountry: entity.country,
      destinationCity: entity.type === "city" ? label : undefined,
    };

    const profile = classifyDestinationForPlaceSearch(label, geocoded);
    const perGroupMax = searchIntents.length > 1 ? PER_GROUP_TARGET : SINGLE_INTENT_MAX;
    const seenIds = new Set<string>();
    const groups: Array<{
      intent: ChatPlaceCategoryIntent;
      recommendations: RoamieRecommendationItem[];
    }> = [];

    for (const intent of searchIntents) {
      let places = await searchCategoryPlaces({
        intent,
        destination: label,
        lat,
        lng,
        locale,
        searchPlaces,
        context,
        userText,
        excludePlaceIds: [...excludePlaceIds, ...seenIds],
        profile,
        searchContext,
        mealIntent,
      });

      places = filterAlreadyRecommendedPlaces(places, {
        rejectedNames: rejectedPlaceNames,
      });
      places = places.filter((p) => {
        const id = (p.id ?? p.name ?? "").trim();
        if (!id || seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      });
      places = places.slice(0, perGroupMax);

      const categoryLabel = CHAT_PLACE_CATEGORY_LABELS[intent];
      let recommendations =
        places.length > 0
          ? placesToRecommendations(places, lat, lng, context, locale, categoryLabel, mealIntent)
          : [];
      recommendations = filterRecommendationsForCategoryRender(recommendations, intent);

      if (recommendations.length > 0) {
        logChatPlacesResponse(recommendations.length, `category_${intent}`);
      }

      groups.push({ intent, recommendations });
    }

    let allRecommendations = groups.flatMap((g) => g.recommendations);
    logDestinationTextSearchResult(allRecommendations.length);

    const primaryIntent = searchIntents[0] ?? lockedIntent;
    if (allRecommendations.length === 0 && shouldUseNamedMustVisitFallback(primaryIntent)) {
      const named = buildNamedFallbackRecommendations(label);
      if (named.length > 0) {
        logChatPlaceFallback(primaryIntent, "named_template");
        groups.push({
          intent: primaryIntent,
          recommendations: named.slice(0, SINGLE_INTENT_MAX),
        });
        allRecommendations = named.slice(0, SINGLE_INTENT_MAX);
      }
    }

    let summary =
      allRecommendations.length > 0
        ? buildGroupedSummary(label, groups, mealIntent)
        : primaryIntent === "cafe"
          ? `目前在${label}暫時找不到符合的咖啡廳，可以換個描述或稍後再試。`
          : `目前在${label}暫時找不到符合的地點，可以換個描述或稍後再試。`;
    if (mealIntent) {
      summary = sanitizeMealSummaryText(summary, mealIntent.slot);
    }
    if (allRecommendations.length > 0) {
      logChatPlaceCardsRendered(allRecommendations.length, intents);
    } else {
      logChatPlacesError("places_empty", "category_all_intents");
    }

    const payload: RoamiePayloadV2 = {
      version: 2,
      title: "Roamie 推薦",
      summary,
      moodTag: session ? resolveRecommendationStyleTag(session, context) : (context.mood ?? ""),
      recommendations: allRecommendations,
      itinerary: [],
      generatedAt: new Date().toISOString(),
    };

    return {
      summary,
      recommendations: allRecommendations,
      payload,
      contextPatch: {
        destination: label,
        tripPurpose: "recommend_places",
        conversationState: "discover",
        planningStage: "recommendations_generated",
      },
    };
  } finally {
    endPlacesFlow(flow);
  }
}
