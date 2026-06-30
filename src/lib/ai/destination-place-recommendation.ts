import { unwrapWeatherResult } from "@/lib/ai/unwrap-weather-result";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { WeatherSummary } from "@/lib/weather-types";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamiePayloadV2, RoamieRecommendationItem } from "@/lib/ai/types";
import {
  fetchPlacesWithSearchAttemptsMerged,
  type PlaceSearchFn,
  type SearchAttempt,
} from "@/lib/ai/chat-place-recommendation";
import {
  buildDestinationTextSearchAttempts,
  EN_CITY_NAMES,
  geocodeDestinationWithFallback,
  logDestinationTextSearchResult,
  resolveDestinationApproxCenter,
} from "@/lib/ai/destination-geocode";
import {
  logChatDestinationExtracted,
  logChatDestinationResolved,
  logChatIntentDetected,
  logChatPlaceCardsRendered,
  logChatPlacesError,
  logChatPlacesResponse,
  logChatReadyToRecommend,
  logChatRenderBlocked,
} from "@/lib/ai/chat-place-flow-log";
import {
  buildNamedFallbackRecommendations,
  getMustVisitPlacesForDestination,
  resolveMustVisitDestination,
  shouldFetchDestinationPlaces,
} from "@/lib/ai/must-visit-places";
import {
  buildWeatherAwarePlaceIntro,
  buildWeatherAwareSearchAttempts,
  resolveWeatherScene,
} from "@/lib/ai/weather-place-search";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import { distanceMeters } from "@/lib/map-explore";
import { beginPlacesFlow, endPlacesFlow } from "@/lib/places-api-stats";
import {
  buildLandmarkCompanionIntro,
  buildDestinationPlaceSearchAttempts,
  classifyDestinationForPlaceSearch,
  rankLandmarkCompanionPlaces,
} from "@/lib/ai/landmark-place-strategy";
import {
  filterPlacesForAttractionRecommendation,
  userWantsParkRecommendations,
} from "@/lib/ai/place-recommendation-rules";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import {
  filterAlreadyRecommendedPlaces,
  filterExcludedPlaceIds,
} from "@/lib/place-planning-memory";
import {
  buildRefreshRecommendationSummary,
  buildAlternativeRecommendationSummary,
  logChatMorePlacesContext,
  logChatMorePlacesExcludeIds,
  logChatMorePlacesFetchCount,
  logChatMorePlacesIntent,
  logChatMorePlacesNewCount,
} from "@/lib/ai/chat-recommendation-refresh";
import {
  CHAT_DESTINATION_MIN_COUNT,
  CHAT_DESTINATION_TARGET_COUNT,
  filterChatDestinationPlaces,
} from "@/lib/ai/chat-destination-place-filter";
import {
  buildDestinationEnglishFallbackQueries,
  filterPlacesByDestinationGuard,
  type ChatPlaceSearchContext,
} from "@/lib/ai/chat-place-search-context";

export type { GeocodeDestinationFn };

export type FetchWeatherFn = (args: {
  data: { lat: number; lng: number; locale?: Locale };
}) => Promise<WeatherSummary>;

export { shouldFetchDestinationPlaces };

const RECOMMENDATION_COUNT = CHAT_DESTINATION_TARGET_COUNT;

function templateNameSearchAttempts(destination: string): SearchAttempt[] {
  return getMustVisitPlacesForDestination(destination)
    .slice(0, RECOMMENDATION_COUNT)
    .map((place) => ({
      query: `${destination} ${place.name}`,
      mode: "text" as const,
      includedTypes: ["tourist_attraction"],
    }));
}

function placesToRecommendations(
  places: PlaceResult[],
  lat: number,
  lng: number,
  context: CanonicalTravelContext,
  locale: Locale,
): RoamieRecommendationItem[] {
  return places.slice(0, RECOMMENDATION_COUNT).map((place) => {
    const distM =
      place.lat != null && place.lng != null
        ? distanceMeters({ lat, lng }, { lat: place.lat, lng: place.lng })
        : undefined;
    return mapPlaceResultToChatItem(place, {
      mood: context.mood,
      locale,
      distanceMeters: distM,
    });
  });
}

function buildSummaryText(
  destination: string,
  intro: string,
  recommendations: RoamieRecommendationItem[],
  context: CanonicalTravelContext,
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>,
): string {
  const label = normalizeDestinationLabel(destination);
  if (
    (context.tripPurpose === "refresh_recommendations" ||
      context.tripPurpose === "more_place_recommendations") &&
    recommendations.length > 0
  ) {
    return buildRefreshRecommendationSummary(recommendations, "attraction");
  }
  if (!recommendations.length) {
    const hint =
      profile?.kind === "landmark"
        ? `我暫時沒連上${label}周邊的即時地點資料，你可以換個說法（例如「${label}周邊景點」）再試一次。`
        : `我暫時沒連上${label}的即時地點資料，你可以換個說法（例如「${label}必去景點」）再試一次。`;
    return [intro, "", hint].join("\n");
  }
  const lines = recommendations.map(
    (rec, index) => `${index + 1}. ${rec.name}${rec.reason ? ` — ${rec.reason}` : ""}`,
  );
  return [intro, "", ...lines, "", "想加進行程的話，跟我說你最想先排哪幾個。"].join("\n");
}

async function searchDestinationPlaces(params: {
  label: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  weather: WeatherSummary | null;
  context: CanonicalTravelContext;
  attempts: SearchAttempt[];
  caller: string;
  excludePlaceIds?: string[];
  userText?: string;
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchContext?: ChatPlaceSearchContext;
}): Promise<PlaceResult[]> {
  const {
    label,
    lat,
    lng,
    locale,
    searchPlaces,
    weather,
    context,
    attempts,
    caller,
    excludePlaceIds = [],
    userText,
    profile,
    searchContext,
  } = params;

  const searchExtras = searchContext
    ? { searchContext, intentCategory: "destination_attraction" }
    : undefined;

  const mergeAndFilter = async (searchAttempts: SearchAttempt[]): Promise<PlaceResult[]> => {
    let places = await fetchPlacesWithSearchAttemptsMerged(
      searchPlaces,
      lat,
      lng,
      locale,
      searchAttempts,
      caller,
      { minResults: CHAT_DESTINATION_MIN_COUNT, maxResults: 24, extras: searchExtras },
    );
    places = filterPlacesByDestinationGuard(places, label, userText);
    places = filterExcludedPlaceIds(places, excludePlaceIds);
    const allowParks = userWantsParkRecommendations(userText ?? "", context);
    places = filterPlacesForAttractionRecommendation(places, {
      allowParks,
      profile,
      parentLandmark: profile?.parentLandmark,
      blockedPlaceIds: excludePlaceIds,
    });
    return filterChatDestinationPlaces(places, {
      destination: label,
      profile,
      userText,
    });
  };

  let filtered = await mergeAndFilter(attempts);

  if (filtered.length < CHAT_DESTINATION_MIN_COUNT) {
    const supplementAttempts = buildDestinationTextSearchAttempts(label).filter(
      (attempt) => !attempts.some((a) => a.query === attempt.query),
    );
    if (supplementAttempts.length) {
      const more = await mergeAndFilter(supplementAttempts);
      const seen = new Set(filtered.map((p) => p.id));
      for (const place of more) {
        if (!seen.has(place.id)) {
          seen.add(place.id);
          filtered.push(place);
        }
      }
      filtered = filtered.slice(0, CHAT_DESTINATION_TARGET_COUNT);
    }
  }

  if (filtered.length < CHAT_DESTINATION_MIN_COUNT) {
    const englishFallback = buildDestinationEnglishFallbackQueries(label);
    const more = await mergeAndFilter(englishFallback);
    const seen = new Set(filtered.map((p) => p.id));
    for (const place of more) {
      if (!seen.has(place.id)) {
        seen.add(place.id);
        filtered.push(place);
      }
    }
    filtered = filtered.slice(0, CHAT_DESTINATION_TARGET_COUNT);
  }

  if (!filtered.length && weather) {
    void weather;
    void context;
  }

  logDestinationTextSearchResult(filtered.length);
  return filtered;
}

function buildAlternativeSearchAttempts(destination: string): SearchAttempt[] {
  return [
    { query: `${destination} 美食 餐廳`, mode: "text", includedTypes: ["restaurant"] },
    { query: `${destination} 咖啡廳`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${destination} 室內景點`, mode: "text", includedTypes: ["museum", "shopping_mall", "art_gallery"] },
    { query: `${destination} 餐廳`, mode: "nearby", includedTypes: ["restaurant"] },
    { query: `${destination} 咖啡`, mode: "nearby", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${destination} 博物館`, mode: "nearby", includedTypes: ["museum", "art_gallery", "shopping_mall"] },
  ];
}

function pickAlternativePlaceMix(places: PlaceResult[], max = RECOMMENDATION_COUNT): PlaceResult[] {
  const buckets: Record<"restaurant" | "cafe" | "indoor", PlaceResult[]> = {
    restaurant: [],
    cafe: [],
    indoor: [],
  };
  const seen = new Set<string>();

  for (const place of places) {
    const id = place.placeId ?? place.name;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name = (place.name ?? "").trim();
    const types = new Set(
      [...(place.types ?? []), place.primaryType ?? ""]
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    );

    if (types.has("restaurant") || /(餐|食|飯|廚|料理|小吃)/.test(name)) {
      buckets.restaurant.push(place);
    } else if (types.has("cafe") || types.has("coffee_shop") || /咖啡/.test(name)) {
      buckets.cafe.push(place);
    } else {
      buckets.indoor.push(place);
    }
  }

  const picked: PlaceResult[] = [];
  const order: Array<keyof typeof buckets> = ["restaurant", "cafe", "indoor"];
  while (picked.length < max) {
    let added = false;
    for (const key of order) {
      const next = buckets[key].shift();
      if (!next) continue;
      picked.push(next);
      added = true;
      if (picked.length >= max) break;
    }
    if (!added) break;
  }
  return picked;
}

export async function buildAlternativeDestinationRecommendations(params: {
  destination: string;
  userText: string;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn: FetchWeatherFn;
  excludePlaceIds?: string[];
  rejectedPlaceNames?: string[];
}): Promise<{
  summary: string;
  recommendations: RoamieRecommendationItem[];
  payload: RoamiePayloadV2;
  contextPatch: Partial<CanonicalTravelContext>;
}> {
  const {
    destination,
    userText,
    context,
    locale,
    searchPlaces,
    geocodeFn,
    excludePlaceIds = [],
    rejectedPlaceNames = [],
  } = params;
  const label = normalizeDestinationLabel(destination);

  logChatIntentDetected("alternative_recommendations", userText);
  logChatDestinationExtracted(label, "alternative_flow");
  logChatReadyToRecommend(label, "ready_to_recommend");

  const flow = beginPlacesFlow("chat_destination_alternative");
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
      logChatPlacesError("geocode_empty", "geocode");
      const approx = resolveDestinationApproxCenter(label);
      if (approx) {
        lat = approx.lat;
        lng = approx.lng;
        logChatDestinationResolved(label, lat, lng, "approx_center");
      } else {
        lat = 0;
        lng = 0;
        textOnlyDestinationSearch = true;
      }
    }

    const altEntity = resolveDestinationEntity(label);
    const searchContext: ChatPlaceSearchContext = {
      searchMode: "destination",
      destinationName: label,
      destinationLatLng: textOnlyDestinationSearch ? null : { lat, lng },
      textOnlyDestinationSearch,
      destinationCountry: altEntity.country,
      destinationCity: altEntity.type === "city" ? label : undefined,
    };

    const searchProfile = classifyDestinationForPlaceSearch(label, geocoded);
    const attempts = buildAlternativeSearchAttempts(label);
    let places = await searchDestinationPlaces({
      label,
      lat,
      lng,
      locale,
      searchPlaces,
      weather: null,
      context: { ...context, tripPurpose: "alternative_recommendations" },
      attempts,
      caller: "chat.destinationAlternative",
      excludePlaceIds,
      userText,
      profile: searchProfile,
      searchContext,
    });

    places = filterAlreadyRecommendedPlaces(places, {
      rejectedNames: rejectedPlaceNames,
    });
    places = pickAlternativePlaceMix(places);

    let recommendations: RoamieRecommendationItem[];
    if (places.length > 0) {
      recommendations = placesToRecommendations(places, lat, lng, context, locale);
      logChatPlacesResponse(recommendations.length, "places_api");
    } else {
      logChatPlacesError("places_empty", "alternative_all_attempts");
      recommendations = [];
      logChatRenderBlocked("no_real_places");
    }

    const summary = buildAlternativeRecommendationSummary(recommendations);
    if (recommendations.length > 0) {
      logChatPlaceCardsRendered(recommendations.length);
    }

    return {
      summary,
      recommendations,
      payload: {
        version: 2,
        title: "美食咖啡室內推薦",
        summary,
        moodTag: context.mood ?? "",
        recommendations,
        itinerary: [],
        generatedAt: new Date().toISOString(),
      },
      contextPatch: {
        destination: label,
        tripPurpose: "alternative_recommendations",
        conversationState: "itinerary_draft",
        planningStage: "recommendations_generated",
        setting: "混合",
      },
    };
  } finally {
    endPlacesFlow(flow);
  }
}

export async function buildDestinationMustVisitRecommendation(params: {
  destination: string;
  userText: string;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn: FetchWeatherFn;
  excludePlaceIds?: string[];
  rejectedPlaceNames?: string[];
}): Promise<{
  summary: string;
  recommendations: RoamieRecommendationItem[];
  payload: RoamiePayloadV2;
  contextPatch: Partial<CanonicalTravelContext>;
}> {
  const { destination, userText, context, locale, searchPlaces, geocodeFn, fetchWeatherFn, excludePlaceIds = [], rejectedPlaceNames = [] } =
    params;
  const label = normalizeDestinationLabel(destination);

  logChatIntentDetected("must_visit_places", userText);
  logChatDestinationExtracted(label, "must_visit_flow");
  logChatReadyToRecommend(label, "ready_to_recommend");

  const flow = beginPlacesFlow("chat_destination_must_visit");
  try {
    const geocoded = await geocodeDestinationWithFallback({
      destination: label,
      locale,
      geocodeFn,
    });
    const searchProfile = classifyDestinationForPlaceSearch(label, geocoded);

    let lat: number;
    let lng: number;
    let geocodeSucceeded = false;
    let textOnlyDestinationSearch = false;

    if (geocoded?.lat != null && geocoded?.lng != null) {
      lat = geocoded.lat;
      lng = geocoded.lng;
      geocodeSucceeded = true;
      logChatDestinationResolved(label, lat, lng, "geocode");
      logChatDestinationExtracted(`${label}@${lat.toFixed(4)},${lng.toFixed(4)}`, "geocode");
    } else {
      logChatPlacesError("geocode_empty", "geocode");
      const approx = resolveDestinationApproxCenter(label);
      if (approx) {
        lat = approx.lat;
        lng = approx.lng;
        logChatDestinationResolved(label, lat, lng, "approx_center");
        logChatDestinationExtracted(`${label}@${lat.toFixed(4)},${lng.toFixed(4)}`, "approx_center");
      } else {
        lat = 0;
        lng = 0;
        textOnlyDestinationSearch = true;
        logChatDestinationResolved(label, lat, lng, "approx_center");
        logChatDestinationExtracted(`${label}@text_only`, "text_only");
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

    let weather: WeatherSummary | null = null;
    if (geocodeSucceeded) {
      try {
        const raw = await fetchWeatherFn({ data: { lat, lng, locale } });
        weather = unwrapWeatherResult(raw);
      } catch (error) {
        logChatPlacesError(error, "weather");
      }
    }

    const scene = resolveWeatherScene(weather, label);
    const weatherSearchLabel =
      searchProfile.kind === "landmark"
        ? (searchProfile.nearestCity ?? label)
        : label;
    const intro =
      searchProfile.kind === "landmark"
        ? buildLandmarkCompanionIntro(searchProfile, scene, weather?.available !== false)
        : buildWeatherAwarePlaceIntro(label, scene, weather?.available !== false);

    const attempts: SearchAttempt[] = buildDestinationPlaceSearchAttempts({
      profile: searchProfile,
      weatherAwareAttempts: geocodeSucceeded
        ? buildWeatherAwareSearchAttempts(weatherSearchLabel, weather, context)
        : [],
      templateAttempts: geocodeSucceeded ? templateNameSearchAttempts(label) : [],
      textOnlyFallback: buildDestinationTextSearchAttempts(label),
    });

    let places = await searchDestinationPlaces({
      label,
      lat,
      lng,
      locale,
      searchPlaces,
      weather,
      context,
      attempts,
      caller: geocodeSucceeded
        ? "chat.destinationMustVisit"
        : "chat.destinationMustVisit.textOnly",
      excludePlaceIds,
      userText,
      profile: searchProfile,
      searchContext,
    });

    places = rankLandmarkCompanionPlaces(places, searchProfile);

    const filteredPlaces = filterAlreadyRecommendedPlaces(places, {
      rejectedNames: rejectedPlaceNames,
      blockedCoreNames: searchProfile.parentLandmark
        ? [searchProfile.parentLandmark]
        : undefined,
    });

    let recommendations: RoamieRecommendationItem[];
    if (filteredPlaces.length > 0) {
      recommendations = placesToRecommendations(filteredPlaces, lat, lng, context, locale);
      logChatPlacesResponse(recommendations.length, "places_api");
    } else {
      logChatPlacesError("places_empty", "all_attempts");
      const fallback = buildNamedFallbackRecommendations(label);
      recommendations = filterAlreadyRecommendedPlaces(fallback, {
        rejectedNames: rejectedPlaceNames,
      });
      if (recommendations.length > 0) {
        logChatPlacesResponse(recommendations.length, "named_fallback");
      } else {
        logChatRenderBlocked("no_real_places");
      }
    }

    const summary = buildSummaryText(label, intro, recommendations, context, searchProfile);
    if (recommendations.length > 0) {
      logChatPlaceCardsRendered(recommendations.length);
    } else {
      logChatRenderBlocked("no_real_places");
    }

    return {
      summary,
      recommendations,
      payload: buildPayload(summary, recommendations, context),
      contextPatch: buildContextPatch(label),
    };
  } finally {
    endPlacesFlow(flow);
  }
}

function buildPayload(
  summary: string,
  recommendations: RoamieRecommendationItem[],
  context: CanonicalTravelContext,
): RoamiePayloadV2 {
  return {
    version: 2,
    title: "必去推薦",
    summary,
    moodTag: context.mood ?? "",
    recommendations,
    itinerary: [],
    generatedAt: new Date().toISOString(),
  };
}

function buildContextPatch(destination: string): Partial<CanonicalTravelContext> {
  return {
    destination,
    mustVisitGenerated: true,
    tripPurpose: "must_visit_places",
    conversationState: "itinerary_draft",
    planningStage: "recommendations_generated",
  };
}

function resolveMorePlacesCategoryPreference(
  context: CanonicalTravelContext,
  activeChatIntent?: string | null,
): string {
  if (activeChatIntent === "cafe") return "cafe";
  if (activeChatIntent === "restaurant") return "restaurant";
  if (context.setting === "室內") return "indoor";
  if (/咖啡/.test(context.mood ?? "") || context.interests?.includes("咖啡")) return "cafe";
  if (/美食|餐廳|吃/.test(context.mood ?? "") || context.interests?.includes("美食")) {
    return "restaurant";
  }
  return "attraction";
}

function buildMorePlacesPrimaryAttempts(destination: string, category: string): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  if (category === "cafe") {
    return [{ query: `${label} 咖啡廳`, mode: "text", includedTypes: ["cafe", "coffee_shop"] }];
  }
  if (category === "restaurant") {
    return [{ query: `${label} 美食`, mode: "text", includedTypes: ["restaurant"] }];
  }
  if (category === "indoor") {
    return [
      {
        query: `${label} 室內景點`,
        mode: "text",
        includedTypes: ["museum", "shopping_mall", "art_gallery"],
      },
    ];
  }
  return [{ query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction"] }];
}

function buildMorePlacesFallbackQueries(destination: string): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const en = EN_CITY_NAMES[label] ?? label;
  return [
    { query: `${label} 景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    {
      query: `${label} 室內景點`,
      mode: "text",
      includedTypes: ["museum", "shopping_mall", "art_gallery"],
    },
    { query: `${label} 美食`, mode: "text", includedTypes: ["restaurant"] },
    { query: `${label} 咖啡廳`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${en} attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${en} hidden gems`, mode: "text", includedTypes: ["tourist_attraction"] },
  ];
}

export async function buildMoreDestinationRecommendations(params: {
  destination: string;
  userText: string;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn: FetchWeatherFn;
  excludePlaceIds?: string[];
  rejectedPlaceNames?: string[];
  activeChatIntent?: string | null;
}): Promise<{
  summary: string;
  recommendations: RoamieRecommendationItem[];
  payload: RoamiePayloadV2;
  contextPatch: Partial<CanonicalTravelContext>;
  newCount: number;
  fetchCount: number;
}> {
  const {
    destination,
    userText,
    context,
    locale,
    searchPlaces,
    geocodeFn,
    fetchWeatherFn,
    excludePlaceIds = [],
    rejectedPlaceNames = [],
    activeChatIntent,
  } = params;
  const label = normalizeDestinationLabel(destination);
  const category = resolveMorePlacesCategoryPreference(context, activeChatIntent);

  logChatMorePlacesIntent(userText);
  logChatMorePlacesContext({
    destination: label,
    category,
    tripPurpose: "more_place_recommendations",
  });
  logChatMorePlacesExcludeIds(excludePlaceIds.length);

  const flow = beginPlacesFlow("chat_more_place_recommendations");
  try {
    const geocoded = await geocodeDestinationWithFallback({
      destination: label,
      locale,
      geocodeFn,
    });
    const searchProfile = classifyDestinationForPlaceSearch(label, geocoded);

    let lat: number;
    let lng: number;
    let geocodeSucceeded = false;
    let textOnlyDestinationSearch = false;

    if (geocoded?.lat != null && geocoded?.lng != null) {
      lat = geocoded.lat;
      lng = geocoded.lng;
      geocodeSucceeded = true;
      logChatDestinationResolved(label, lat, lng, "geocode");
    } else {
      logChatPlacesError("geocode_empty", "geocode");
      const approx = resolveDestinationApproxCenter(label);
      if (approx) {
        lat = approx.lat;
        lng = approx.lng;
        logChatDestinationResolved(label, lat, lng, "approx_center");
      } else {
        lat = 0;
        lng = 0;
        textOnlyDestinationSearch = true;
        logChatDestinationResolved(label, lat, lng, "text_only");
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

    let weather: WeatherSummary | null = null;
    if (geocodeSucceeded) {
      try {
        const raw = await fetchWeatherFn({ data: { lat, lng, locale } });
        weather = unwrapWeatherResult(raw);
      } catch (error) {
        logChatPlacesError(error, "weather");
      }
    }

    const scene = resolveWeatherScene(weather, label);
    const intro =
      searchProfile.kind === "landmark"
        ? buildLandmarkCompanionIntro(searchProfile, scene, weather?.available !== false)
        : buildWeatherAwarePlaceIntro(label, scene, weather?.available !== false);

    const caller = geocodeSucceeded
      ? "chat.morePlaceRecommendations"
      : "chat.morePlaceRecommendations.textOnly";

    const searchParams = {
      label,
      lat,
      lng,
      locale,
      searchPlaces,
      weather,
      context: { ...context, destination: label, tripPurpose: "more_place_recommendations" as const },
      caller,
      excludePlaceIds,
      userText,
      profile: searchProfile,
      searchContext,
    };

    const primaryAttempts = buildMorePlacesPrimaryAttempts(label, category);
    let places = await searchDestinationPlaces({ ...searchParams, attempts: primaryAttempts });
    let filtered = filterAlreadyRecommendedPlaces(places, {
      rejectedNames: rejectedPlaceNames,
      blockedCoreNames: searchProfile.parentLandmark ? [searchProfile.parentLandmark] : undefined,
    });
    logChatMorePlacesFetchCount(places.length);

    if (filtered.length < CHAT_DESTINATION_MIN_COUNT) {
      const fallbackAttempts = buildMorePlacesFallbackQueries(label).filter(
        (attempt) => !primaryAttempts.some((a) => a.query === attempt.query),
      );
      for (const attempt of fallbackAttempts) {
        if (filtered.length >= CHAT_DESTINATION_MIN_COUNT) break;
        const more = await searchDestinationPlaces({ ...searchParams, attempts: [attempt] });
        const moreFiltered = filterAlreadyRecommendedPlaces(more, {
          rejectedNames: rejectedPlaceNames,
          blockedCoreNames: searchProfile.parentLandmark
            ? [searchProfile.parentLandmark]
            : undefined,
        });
        const seen = new Set(filtered.map((p) => p.id));
        for (const place of moreFiltered) {
          if (!seen.has(place.id)) {
            seen.add(place.id);
            filtered.push(place);
          }
        }
      }
    }

    filtered = rankLandmarkCompanionPlaces(filtered, searchProfile).slice(0, RECOMMENDATION_COUNT);
    logChatMorePlacesNewCount(filtered.length);

    let recommendations: RoamieRecommendationItem[];
    if (filtered.length > 0) {
      recommendations = placesToRecommendations(filtered, lat, lng, context, locale);
      logChatPlacesResponse(recommendations.length, "places_api");
      logChatPlaceCardsRendered(recommendations.length);
    } else {
      recommendations = [];
      logChatRenderBlocked("no_new_places");
    }

    const moreContext = {
      ...context,
      destination: label,
      tripPurpose: "more_place_recommendations" as const,
    };
    const summary =
      recommendations.length > 0
        ? buildSummaryText(label, intro, recommendations, moreContext, searchProfile)
        : intro;

    return {
      summary,
      recommendations,
      payload: {
        version: 2,
        title: "更多推薦",
        summary,
        moodTag: context.mood ?? "",
        recommendations,
        itinerary: [],
        generatedAt: new Date().toISOString(),
      },
      contextPatch: {
        destination: label,
        tripPurpose: "more_place_recommendations",
        conversationState: "itinerary_draft",
        planningStage: "recommendations_generated",
      },
      newCount: recommendations.length,
      fetchCount: places.length,
    };
  } finally {
    endPlacesFlow(flow);
  }
}

export function resolveDestinationForPlaceFetch(
  userText: string,
  context: CanonicalTravelContext,
): string | undefined {
  if (!shouldFetchDestinationPlaces(userText, context)) return undefined;
  return resolveMustVisitDestination(context, userText);
}
