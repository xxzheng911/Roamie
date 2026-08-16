import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamiePayloadV2, RoamieRecommendationItem } from "@/lib/ai/types";
import {
  CHAT_PLACE_CATEGORY_LABELS,
  buildChatPlaceSearchAttempts,
  buildChatPlaceSearchAttemptsForScope,
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
  buildInitialShoppingSearchAttempts,
  flattenInitialShoppingAttempts,
  logShoppingInitialPool,
  logShoppingInitialSearchSummary,
  SHOPPING_INITIAL_RESERVE_TARGET,
  SHOPPING_INITIAL_VALID_TARGET,
  SHOPPING_DISPLAY_LIMIT,
  SHOPPING_RESULTS_PER_QUERY,
  inferShoppingTypesFromPlace,
} from "@/lib/ai/shopping-query-queue";
import { resolveShoppingSearchScope } from "@/lib/ai/shopping-search-scope";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
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
import { mapPlaceResultsToChatItems } from "@/lib/chat-session";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import { distanceMeters } from "@/lib/map-explore";
import { beginPlacesFlow, endPlacesFlow } from "@/lib/places-api-stats";
import {
  filterAlreadyRecommendedPlaces,
  filterExcludedPlaceIds,
} from "@/lib/place-planning-memory";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { buildNamedFallbackRecommendations } from "@/lib/ai/must-visit-places";
import {
  filterPlacesByDestinationArea,
  filterPlacesByDestinationParentCity,
  filterPlacesByDestinationGuard,
  matchPlaceToDestinationArea,
  type ChatPlaceSearchContext,
} from "@/lib/ai/chat-place-search-context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { resolveRecommendationStyleTag } from "@/lib/ai/resolve-recommendation-style-tag";
import { resolvePresentableMoodTag } from "@/lib/ai/mood-presentation";
import { ingestResolvedPlacesIntoCandidatePool } from "@/lib/ai/places-cost-cache";
import {
  buildMealRecommendationDescription,
  buildMealSearchAttempts,
  filterPlacesForMealIntent,
  parseMealIntentFromText,
  sanitizeMealSummaryText,
  sanitizeMealReasonText,
  type ParsedMealIntent,
} from "@/lib/ai/meal-intent-parser";
import {
  placeMatchesCuisineRelevance,
  isAcceptableRestaurantPlace,
} from "@/lib/ai/recommendation-refinement/search";
import {
  parsePlaceRecommendationIntent,
  logPlaceRecommendationSearchStart,
  logPlaceRecommendationSearchResult,
  logPlaceRequirementParsed,
} from "@/lib/ai/place-recommendation-intent";
import { resolveRegionPrimaryCity } from "@/lib/ai/shopping-search-scope";
import { resolveDestinationAreaScope } from "@/lib/ai/destination-travel-profile";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { cuisineSearchTokens } from "@/lib/ai/recommendation-refinement/parser";
import {
  evaluateDestinationScopeGate,
  logDestinationScopeBlocked,
  logUnexpectedPlacesCall,
} from "@/lib/ai/destination-scope";
import {
  createDestinationCategoryPlaceSearchDiagnostics,
  logDestinationCategoryPlaceSearchSummary,
  type DestinationCategoryPlaceSearchDiagnostics,
} from "@/lib/ai/destination-category-place-search-telemetry";
import { resolveChatShortcutContext } from "@/lib/ai/chat-intent";
import { logShortcutRecommendationSummary } from "@/lib/ai/shortcut-recommendation-telemetry";
import {
  selectAreaFirstCandidates,
  type DestinationAreaCandidate,
  type DestinationAreaSourceScope,
} from "@/lib/ai/destination-area-selection";
export { selectAreaFirstCandidates } from "@/lib/ai/destination-area-selection";

const PER_GROUP_TARGET = 3;
const SINGLE_INTENT_MAX = 6;
/** Larger pool so「還有嗎」can continue from cursor without re-search */
const SINGLE_INTENT_POOL_MAX = 24;

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
  diagnostics?: DestinationCategoryPlaceSearchDiagnostics;
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
    diagnostics,
  } = params;

  const mealAttempts =
    mealIntent && intent === "restaurant"
      ? buildMealSearchAttempts(mealIntent.city ?? destination, mealIntent.slot)
      : null;

  // Shopping: multi-group oversample (street/dept/underground/mall/market) for reserve.
  const shoppingScope =
    intent === "shopping"
      ? resolveShoppingSearchScope({ destination })
      : null;
  const shoppingEntity =
    intent === "shopping" ? resolveDestinationEntity(destination) : null;
  const shoppingSeed =
    intent === "shopping"
      ? buildInitialShoppingSearchAttempts(
          destination,
          userText,
          shoppingScope?.activeSearchCity,
          shoppingEntity?.country,
        )
      : null;

  const { primary, fallback } = mealAttempts
    ? { primary: mealAttempts, fallback: [] as SearchAttempt[] }
    : intent === "shopping" && shoppingSeed
      ? {
          primary: shoppingSeed.primary,
          fallback: shoppingSeed.fallback,
        }
      : buildChatPlaceSearchAttempts(intent, destination, userText);

  const placeReq = parsePlaceRecommendationIntent(userText);
  if (placeReq) {
    logPlaceRequirementParsed({
      ...placeReq,
      destinationName: placeReq.destinationName ?? destination,
      resolvedSearchCity: resolveRegionPrimaryCity(destination) ?? destination,
    });
    logPlaceRecommendationSearchStart(
      {
        destination,
        resolvedSearchCity: resolveRegionPrimaryCity(destination) ?? destination,
        primaryType: placeReq.primaryType,
        subtypes: placeReq.subtypes,
        preferredFeatures: placeReq.preferredFeatures,
        excludedFeatures: placeReq.excludedFeatures,
        mealSlot: placeReq.mealSlot,
        budget: placeReq.budget,
      },
      [...primary, ...fallback].map((a) => a.query),
    );
  }

  const minResults = CHAT_DESTINATION_MIN_COUNT;
  const destinationAreaScope = resolveDestinationAreaScope(destination);
  const searchExtras = searchContext
    ? { searchContext, intentCategory: intent }
    : undefined;
  let rawCount = 0;

  const runSearch = async (
    attempts: typeof primary,
    isFallback: boolean,
    guardScope?: "area" | "city",
  ) => {
    let roundRawCount = 0;
    for (const attempt of attempts) {
      for (const type of attempt.includedTypes ?? []) {
        diagnostics?.includedTypes.add(type);
      }
    }
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
      {
        // Per-attempt: low min so multi-group oversample can continue across queries.
        // Aggregate target SHOPPING_INITIAL_VALID_TARGET is enforced by the shopping loop.
        minResults: intent === "shopping" ? 2 : minResults,
        maxResults: intent === "shopping" ? SHOPPING_RESULTS_PER_QUERY : 24,
        extras: searchExtras,
        onAttemptDiagnostics: (round) => {
          rawCount += round.rawCount;
          roundRawCount += round.rawCount;
          if (!diagnostics) return;
          diagnostics.attemptCount += round.attemptsVisited;
          diagnostics.requestsSent += round.requestsSent;
          diagnostics.rateLimitedBeforeRequest ||= round.rateLimitedBeforeRequest;
          diagnostics.rawCount += round.rawCount;
        },
      },
    );
    if (guardScope === "area" && destinationAreaScope) {
      places = filterPlacesByDestinationArea(places, destinationAreaScope);
    } else if (guardScope === "city" && destinationAreaScope) {
      places = filterPlacesByDestinationParentCity(places, destinationAreaScope);
    } else {
      const destinationGuard =
        isFallback && destinationAreaScope
            ? destinationAreaScope.parentCity
            : destination;
      places = filterPlacesByDestinationGuard(places, destinationGuard, userText);
    }
    if (diagnostics) {
      diagnostics.afterDestinationFilterCount += places.length;
    }
    places = filterExcludedPlaceIds(places, excludePlaceIds);
    if (diagnostics) diagnostics.afterExclusionCount += places.length;
    // Shopping / cafe use dedicated category guards — do not run attraction filters
    if (intent !== "cafe" && intent !== "shopping") {
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
      onDiagnostics: (counts) => {
        if (!diagnostics) return;
        diagnostics.afterCanonicalIdCount += counts.afterCanonicalIdCount;
        diagnostics.afterBaseEligibilityCount += counts.afterBaseEligibilityCount;
        diagnostics.afterCategoryGuardCount += counts.afterCategoryGuardCount;
        diagnostics.afterQualityCount += counts.afterQualityCount;
        diagnostics.baseEligibilityRejections.missing_identity +=
          counts.baseEligibilityRejections.missing_identity;
        diagnostics.baseEligibilityRejections.destination_subplace +=
          counts.baseEligibilityRejections.destination_subplace;
        diagnostics.baseEligibilityRejections.open_status +=
          counts.baseEligibilityRejections.open_status;
        diagnostics.baseEligibilityRejections.school_or_office +=
          counts.baseEligibilityRejections.school_or_office;
        diagnostics.baseEligibilityRejections.permanently_closed +=
          counts.baseEligibilityRejections.permanently_closed;
      },
    });
    places = rankCategoryPlaces(places, lat, lng);
    if (mealIntent && intent === "restaurant") {
      places = filterPlacesForMealIntent(places, mealIntent);
    }
    // Subtype validation (e.g. sukiyaki) — never pad with unrelated restaurants
    if (intent === "restaurant" && placeReq?.subtypes.length) {
      const matched = places.filter(
        (p) =>
          isAcceptableRestaurantPlace(p) &&
          placeMatchesCuisineRelevance(p, placeReq.subtypes),
      );
      const rejected = places.length - matched.length;
      for (const p of places) {
        if (
          isAcceptableRestaurantPlace(p) &&
          !placeMatchesCuisineRelevance(p, placeReq.subtypes)
        ) {
          logAiPipeline(
            "[FOOD_INTENT_MATCH]",
            `name=${p.name}`,
            `requestedDish=${placeReq.subtypes.join("|")}`,
            "matched=false",
            "reason=dish_type_mismatch",
          );
        }
      }
      logAiPipeline(
        "[FOOD_RECOMMENDATION_FINAL]",
        `destination=${destination}`,
        `requestedDish=${placeReq.subtypes.join("|")}`,
        `rawCount=${places.length}`,
        `acceptedCount=${matched.length}`,
        `rejectedTypeMismatch=${rejected}`,
      );
      // Keep only cuisine matches — never substitute roast-duck / breakfast for sukiyaki.
      places = matched;
    }
    return { places, rawCount: roundRawCount };
  };

  const mergeUnique = (base: PlaceResult[], more: PlaceResult[]): PlaceResult[] => {
    const seen = new Set(base.map((p) => (p.id ?? p.name ?? "").trim()).filter(Boolean));
    const out = [...base];
    for (const place of more) {
      const id = (place.id ?? place.name ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(place);
    }
    return out;
  };

  let places: PlaceResult[] = [];

  if (intent === "shopping" && shoppingSeed) {
    // Oversample across groups until valid≥8 (or attempts exhausted). Never stop at 4.
    const attempts = flattenInitialShoppingAttempts(shoppingSeed);
    for (let i = 0; i < attempts.length; i++) {
      if (places.length >= SHOPPING_INITIAL_VALID_TARGET) break;
      const attempt = attempts[i]!;
      const isFallback = i >= shoppingSeed.primary.length;
      const round = await runSearch([attempt], isFallback);
      places = mergeUnique(places, round.places);
      logChatPlaceResults(intent, places.length);
    }
    const byType: Record<string, number> = {};
    for (const p of places) {
      for (const t of inferShoppingTypesFromPlace(p)) {
        byType[t] = (byType[t] ?? 0) + 1;
      }
    }
    logShoppingInitialSearchSummary({
      rawCount,
      validatedCount: places.length,
      canonicalCount: places.length,
      displayTarget: SHOPPING_DISPLAY_LIMIT,
      reserveTarget: SHOPPING_INITIAL_RESERVE_TARGET,
    });
    logShoppingInitialPool({
      candidateCount: places.length,
      byType,
      byCluster: shoppingScope?.geoClusterLabel
        ? { [shoppingScope.geoClusterLabel]: places.length }
        : {},
    });
    return places;
  }

  if (destinationAreaScope && intent !== "shopping" && !mealAttempts) {
    const areaAttempts = buildChatPlaceSearchAttemptsForScope(
      intent,
      destinationAreaScope.displayLabel,
      userText,
    );
    const cityAttempts = buildChatPlaceSearchAttemptsForScope(
      intent,
      destinationAreaScope.parentCity,
      userText,
    );
    const tagCandidates = (
      roundPlaces: PlaceResult[],
      sourceScope: DestinationAreaSourceScope,
      attempts: SearchAttempt[],
    ): DestinationAreaCandidate[] =>
      roundPlaces.map((place) => ({
        place,
        sourceScope,
        sourceAttempt: attempts.map((attempt) => attempt.query).join("|"),
        ...matchPlaceToDestinationArea(place, destinationAreaScope),
      }));

    const areaPrimary = await runSearch(areaAttempts.primary, false, "area");
    const areaRelaxed =
      areaPrimary.places.length < minResults && areaAttempts.fallback.length > 0
        ? await runSearch(areaAttempts.fallback, true, "area")
        : { places: [] as PlaceResult[], rawCount: 0 };
    const areaCandidates = selectAreaFirstCandidates(
      tagCandidates(areaPrimary.places, "area_primary", areaAttempts.primary),
      tagCandidates(areaRelaxed.places, "area_relaxed", areaAttempts.fallback),
      minResults,
    );
    const cityFallbackTriggered = areaCandidates.length < minResults;
    const cityPrimary = cityFallbackTriggered
      ? await runSearch(cityAttempts.primary, true, "city")
      : { places: [] as PlaceResult[], rawCount: 0 };
    const cityPrimaryCandidates = tagCandidates(
      cityPrimary.places,
      "city_primary",
      cityAttempts.primary,
    );
    const cityRelaxed =
      cityFallbackTriggered &&
      areaCandidates.length + cityPrimaryCandidates.length < minResults &&
      cityAttempts.fallback.length > 0
        ? await runSearch(cityAttempts.fallback, true, "city")
        : { places: [] as PlaceResult[], rawCount: 0 };
    const cityCandidates = [
      ...cityPrimaryCandidates,
      ...tagCandidates(cityRelaxed.places, "city_relaxed", cityAttempts.fallback),
    ];
    const selected = selectAreaFirstCandidates(areaCandidates, cityCandidates, minResults, {
      explicitAreaConstraint: true,
    });
    logAiPipeline("[DESTINATION_AREA_SELECTION_SUMMARY]", {
      input: destination,
      parentCity: destinationAreaScope.parentCity,
      area: destinationAreaScope.area,
      areaPrimaryRawCount: areaPrimary.rawCount,
      areaPrimaryUsableCount: areaPrimary.places.length,
      areaRelaxedRawCount: areaRelaxed.rawCount,
      areaRelaxedUsableCount: areaRelaxed.places.length,
      cityFallbackTriggered,
      cityPrimaryRawCount: cityPrimary.rawCount,
      cityPrimaryUsableCount: cityPrimary.places.length,
      cityRelaxedRawCount: cityRelaxed.rawCount,
      cityRelaxedUsableCount: cityRelaxed.places.length,
      finalCount: selected.length,
      finalAreaMatchCount: selected.filter((candidate) => candidate.areaMatched).length,
      finalCityFallbackCount: selected.filter((candidate) =>
        candidate.sourceScope.startsWith("city_"),
      ).length,
      finalPlaces: selected.map((candidate) => ({
        placeId: candidate.place.id,
        sourceScope: candidate.sourceScope,
        areaMatched: candidate.areaMatched,
        parentCityMatched: candidate.parentCityMatched,
      })),
    });
    return selected.map((candidate) => candidate.place);
  }

  places = (await runSearch(primary, false)).places;
  logChatPlaceResults(intent, places.length);

  if (places.length >= minResults) {
    if (placeReq) {
      logPlaceRecommendationSearchResult({
        rawCount,
        typeAccepted: places.length,
        subtypeAccepted: placeReq.subtypes.length
          ? places.filter((p) => placeMatchesCuisineRelevance(p, placeReq.subtypes)).length
          : places.length,
        qualityRejected: 0,
        duplicateRejected: 0,
        finalCount: places.length,
      });
    }
    return places;
  }

  if (fallback.length > 0) {
    for (const attempt of fallback) {
      logChatPlaceFallback(intent, attempt.query);
    }
    const fallbackPlaces = (await runSearch(fallback, true)).places;
    logChatPlaceResults(intent, fallbackPlaces.length);
    if (fallbackPlaces.length > places.length) {
      places = fallbackPlaces;
    }
  }

  if (places.length < minResults && intent === "cafe") {
    const relaxed = buildCafeRelaxedSearchAttempts(destination);
    const more = (await runSearch(relaxed, true)).places;
    if (more.length > places.length) {
      places = more;
    }
  }

  if (placeReq) {
    logPlaceRecommendationSearchResult({
      rawCount,
      typeAccepted: places.length,
      subtypeAccepted: placeReq.subtypes.length
        ? places.filter((p) => placeMatchesCuisineRelevance(p, placeReq.subtypes)).length
        : places.length,
      qualityRejected: 0,
      duplicateRejected: 0,
      finalCount: places.length,
    });
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
  categoryIntent: ChatPlaceCategoryIntent,
  mealIntent?: ParsedMealIntent | null,
  userProfile?: UserProfileForReason | null,
): RoamieRecommendationItem[] {
  return mapPlaceResultsToChatItems(
    places.map((place) => {
      const distM =
        place.lat != null && place.lng != null
          ? distanceMeters({ lat, lng }, { lat: place.lat, lng: place.lng })
          : undefined;
      return {
        place,
        ctx: {
          mood: context.mood,
          preferenceEvidenceSource: context.moodEvidenceSource,
          locale,
          distanceMeters: distM,
          distanceSource: "DESTINATION_CENTER",
          categoryLabel,
          categoryIntent,
          userProfile,
        },
      };
    }),
  )
    .map((item) => {
      const place = places.find((p) => p.id === item.googlePlaceId || p.id === item.placeId);
      const withTypes = {
        ...item,
        types: place?.types?.length
          ? place.types
          : place?.primaryType
            ? [place.primaryType]
            : item.types,
      } as RoamieRecommendationItem & { types?: string[] };
      if (mealIntent && place) {
        return {
          ...withTypes,
          reason: buildMealRecommendationDescription(place, mealIntent),
          description: buildMealRecommendationDescription(place, mealIntent),
        };
      }
      return withTypes;
    })
    .map(dedupeRecommendationCopy);
}

function buildGroupedSummary(
  destination: string,
  groups: Array<{ intent: ChatPlaceCategoryIntent; recommendations: RoamieRecommendationItem[] }>,
  mealIntent?: ParsedMealIntent | null,
  dishLabel?: string,
): string {
  const label = normalizeDestinationLabel(destination);
  const dish = dishLabel?.trim();
  const sections: string[] = [
    dish
      ? `在${label}，這幾間${dish}可以先看看：`
      : `在${label}，這些地方值得先看看：`,
  ];

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
  userProfile?: UserProfileForReason | null;
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
    userProfile,
  } = params;
  const label = normalizeDestinationLabel(destination);
  const mealIntent = parseMealIntentFromText(userText);

  const scopeGate = evaluateDestinationScopeGate({
    destination: label,
    destinationType: context.destinationType,
    countryCode: context.destinationCountry,
    requestedIntent: intents[0] ?? "place_recommendation",
  });
  if (scopeGate.placesCallBlocked) {
    logDestinationScopeBlocked(scopeGate);
    logUnexpectedPlacesCall({
      trigger: "buildDestinationCategoryRecommendations",
      intent: intents[0] ?? "place_recommendation",
      destinationType: scopeGate.destinationType,
      scopePrecision: scopeGate.scopePrecision,
      callPath: "chat-destination-category-recommendation",
    });
    const summary = `${label}範圍很大，請先告訴我比較想去哪個城市或地區，我再幫你找適合的地點。`;
    return {
      summary,
      recommendations: [],
      payload: {
        title: "Roamie 推薦",
        summary,
        moodTag: resolvePresentableMoodTag(undefined, context),
        recommendations: [],
        itinerary: [],
      },
      contextPatch: {
        destination: label,
        destinationType: "country",
        destinationCountry: label,
        tripPurpose: "destination_selection",
      },
    };
  }

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
    const perGroupMax =
      searchIntents.length > 1 ? PER_GROUP_TARGET : SINGLE_INTENT_POOL_MAX;
    const seenIds = new Set<string>();
    const groups: Array<{
      intent: ChatPlaceCategoryIntent;
      recommendations: RoamieRecommendationItem[];
    }> = [];

    for (const intent of searchIntents) {
      const searchDiagnostics = createDestinationCategoryPlaceSearchDiagnostics(label, intent);
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
        diagnostics: searchDiagnostics,
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

      if (places.length) {
        ingestResolvedPlacesIntoCandidatePool({
          sessionId:
            session?.planningSessionId?.trim() ||
            session?.conversationId?.trim() ||
            "chat_default",
          destination: label,
          countryCode: entity.country ?? undefined,
          places,
          source: `chat.category.${intent}`,
        });
      }

      const categoryLabel = CHAT_PLACE_CATEGORY_LABELS[intent];
      let recommendations =
        places.length > 0
          ? placesToRecommendations(
              places,
              lat,
              lng,
              context,
              locale,
              categoryLabel,
              intent,
              mealIntent,
              userProfile,
            )
          : [];
      recommendations = filterRecommendationsForCategoryRender(
        recommendations,
        intent,
        userText,
      );
      searchDiagnostics.renderableCount = recommendations.length;
      searchDiagnostics.finalRecommendationCount = recommendations.length;
      logDestinationCategoryPlaceSearchSummary(searchDiagnostics);
      const shortcut = resolveChatShortcutContext(userText);
      if (shortcut) {
        logShortcutRecommendationSummary({
          shortcut,
          searchScope: "destination",
          includedTypes: [...searchDiagnostics.includedTypes].sort(),
          excludedTypes: [],
          attemptCount: searchDiagnostics.attemptCount,
          requestsSent: searchDiagnostics.requestsSent,
          rawCount: searchDiagnostics.rawCount,
          afterDestinationOrNearbyScopeCount: searchDiagnostics.afterDestinationFilterCount,
          afterExclusionCount: searchDiagnostics.afterExclusionCount,
          afterCanonicalIdCount: searchDiagnostics.afterCanonicalIdCount,
          afterCategoryGuardCount: searchDiagnostics.afterCategoryGuardCount,
          afterQualityCount: searchDiagnostics.afterQualityCount,
          afterAlreadyRecommendedCount: places.length,
          renderableCount: searchDiagnostics.renderableCount,
          finalCardCount: searchDiagnostics.finalRecommendationCount,
        });
      }

      if (recommendations.length > 0) {
        logChatPlacesResponse(recommendations.length, `category_${intent}`);
      }

      groups.push({ intent, recommendations });
    }

    // Full pool returned; chat layer paginates via ConversationRecommendationSession
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

    const placeReqForSummary = parsePlaceRecommendationIntent(userText);
    const dishLabel =
      placeReqForSummary?.subtypes?.[0] != null
        ? cuisineSearchTokens(placeReqForSummary.subtypes[0])[0]
        : undefined;

    let summary =
      allRecommendations.length > 0
        ? buildGroupedSummary(label, groups, mealIntent, dishLabel)
        : placeReqForSummary?.subtypes?.length
          ? `目前找到的${label}${dishLabel ?? "餐廳"}數量不多，可以換個菜系或稍後再試。`
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
      moodTag: session
        ? resolveRecommendationStyleTag(session, context) || resolvePresentableMoodTag(session, context)
        : resolvePresentableMoodTag(undefined, context),
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
