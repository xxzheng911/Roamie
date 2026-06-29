import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import type { ChatMsg } from "@/lib/chat-history";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import {
  syncSessionPlaceMemory,
  computeItineraryFetchTarget,
  preparePlacesForItineraryBuild,
  resolveItineraryPlaceSources,
} from "@/lib/place-planning-memory";
import {
  fetchPlacesWithSearchAttempts,
  type PlaceSearchFn,
  type SearchAttempt,
} from "@/lib/ai/chat-place-recommendation";
import {
  geocodeDestinationWithFallback,
  resolveDestinationApproxCenter,
} from "@/lib/ai/destination-geocode";
import {
  buildWeatherAwareSearchAttempts,
  resolveWeatherScene,
} from "@/lib/ai/weather-place-search";
import { getMustVisitPlacesForDestination } from "@/lib/ai/must-visit-places";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import {
  logItineraryDaysParsed,
  logItineraryGeocodeQuery,
  logItineraryBuildSource,
  logItineraryUsedRecommendedPlaces,
  logItineraryValidationResult,
  sanitizeDestinationForGeocode,
} from "@/lib/ai/itinerary-entity-extraction";
import { buildDestinationTextSearchAttempts } from "@/lib/ai/destination-geocode";
import {
  filterExcludedPlaceIds,
  type PlaceLike,
} from "@/lib/place-planning-memory";
import {
  INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
  isGenericPlaceLabel,
  isValidItineraryStopPlace,
} from "@/lib/ai/generic-place-label";
import {
  buildCityAttractionSearchAttempts,
  buildLandmarkCompanionSearchAttempts,
  classifyDestinationForPlaceSearch,
} from "@/lib/ai/landmark-place-strategy";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import type { WeatherSummary } from "@/lib/weather-types";
import { ITINERARY_PARTIAL_FAILURE_MESSAGE } from "@/lib/trip/itinerary-guards";

export { INSUFFICIENT_ITINERARY_PLACES_MESSAGE };

const ITINERARY_PLACE_TYPES = [
  "tourist_attraction",
  "restaurant",
  "cafe",
  "shopping_mall",
  "museum",
  "park",
] as const;

const TYPE_QUERY_LABEL: Record<(typeof ITINERARY_PLACE_TYPES)[number], string[]> = {
  tourist_attraction: ["必去景點", "人氣景點", "landmark", "attractions"],
  restaurant: ["美食", "餐廳", "restaurants"],
  cafe: ["咖啡廳", "café", "cafe"],
  shopping_mall: ["商圈", "購物", "shopping mall"],
  museum: ["博物館", "美術館", "museum"],
  park: ["公園", "park", "綠地"],
};

function buildMultiTypeItinerarySearchAttempts(destination: string): SearchAttempt[] {
  const label = destination.trim();
  if (!label) return [];

  const attempts: SearchAttempt[] = [];
  for (const type of ITINERARY_PLACE_TYPES) {
    for (const suffix of TYPE_QUERY_LABEL[type]) {
      attempts.push({
        query: `${label} ${suffix}`,
        mode: "text",
        includedTypes: [type],
      });
    }
    attempts.push({
      query: label,
      mode: "nearby",
      includedTypes: [type],
    });
  }
  return attempts;
}

function buildCityOrLandmarkSearchAttempts(
  destination: string,
  geocoded: { city?: string; region?: string; lat: number; lng: number } | null,
  weather: WeatherSummary | null,
  context: CanonicalTravelContext,
): SearchAttempt[] {
  const profile = classifyDestinationForPlaceSearch(destination, geocoded);
  const weatherLabel =
    profile.kind === "landmark" ? (profile.nearestCity ?? destination) : destination;
  const weatherAttempts = buildWeatherAwareSearchAttempts(weatherLabel, weather, context);
  if (profile.kind === "landmark") {
    return [...buildLandmarkCompanionSearchAttempts(profile), ...weatherAttempts];
  }
  return [...buildCityAttractionSearchAttempts(destination), ...weatherAttempts];
}

function templateNameSearchAttempts(destination: string): SearchAttempt[] {
  return getMustVisitPlacesForDestination(destination)
    .filter((p) => !isGenericPlaceLabel(p.name, destination))
    .slice(0, 8)
    .map((place) => ({
      query: `${destination} ${place.name}`,
      mode: "text" as const,
      includedTypes: ["tourist_attraction"],
    }));
}

function rankByQuality(places: PlaceResult[]): PlaceResult[] {
  return [...places].sort((a, b) => {
    const score = (p: PlaceResult) =>
      (p.rating ?? 0) * Math.log10((p.userRatingCount ?? 0) + 10) +
      (p.photoName ? 0.5 : 0);
    return score(b) - score(a);
  });
}

function dedupeChatPlaces(places: ChatPlaceItem[]): ChatPlaceItem[] {
  const seen = new Set<string>();
  const out: ChatPlaceItem[] = [];
  for (const p of places) {
    const key = p.placeId?.trim() || p.googlePlaceId?.trim() || `${p.name}@${p.address ?? ""}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function dedupePlaces(places: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const p of places) {
    const key = p.id?.trim() || `${p.name}@${p.address ?? ""}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function categoryLabelForPlace(place: PlaceResult): string {
  const type = `${place.primaryType ?? ""} ${(place.types ?? []).join(" ")}`.toLowerCase();
  if (/restaurant|food|meal/.test(type)) return "餐廳";
  if (/cafe|coffee|bakery/.test(type)) return "咖啡廳";
  if (/shopping_mall|store|market/.test(type)) return "商圈";
  if (/museum|art_gallery/.test(type)) return "博物館";
  if (/park|garden/.test(type)) return "公園";
  return "景點";
}

export function filterValidItineraryPlaces(
  places: PlaceResult[],
  destination: string,
): PlaceResult[] {
  return dedupePlaces(places).filter((p) => isValidItineraryStopPlace(p, destination));
}

export function placesToChatItems(
  places: PlaceResult[],
  context: CanonicalTravelContext,
  locale: Locale,
): ChatPlaceItem[] {
  return places.map((p) => {
    const item = mapPlaceResultToChatItem(p, {
      mood: context.mood,
      locale,
      categoryLabel: categoryLabelForPlace(p),
    });
    return {
      ...item,
      placeId: item.googlePlaceId ?? p.id,
    };
  });
}

export type FetchItineraryPlacesResult =
  | { ok: true; places: ChatPlaceItem[]; rawCount: number; validCount: number }
  | {
      ok: false;
      reason: "api_empty" | "filtered_empty";
      message: string;
      rawCount: number;
      validCount: number;
    };

export async function fetchItineraryPlaces(params: {
  destination: string;
  days: number;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn?: (args: {
    data: { lat: number; lng: number; locale?: Locale };
  }) => Promise<WeatherSummary>;
  excludePlaceIds?: string[];
}): Promise<FetchItineraryPlacesResult> {
  const {
    destination,
    days,
    context,
    locale,
    searchPlaces,
    geocodeFn,
    fetchWeatherFn,
    excludePlaceIds = [],
  } = params;

  const label = sanitizeDestinationForGeocode(destination);
  const fetchTarget = computeItineraryFetchTarget(days);

  console.info(
    "[ITINERARY_PLACES_FETCH]",
    `destination=${label}`,
    `days=${days}`,
    `fetchTarget=${fetchTarget}`,
  );

  logItineraryGeocodeQuery(label);

  const geocoded = await geocodeDestinationWithFallback({
    destination: label,
    locale,
    geocodeFn,
  });

  let lat: number;
  let lng: number;
  let geocodedForProfile: typeof geocoded = geocoded;

  if (geocoded?.lat != null && geocoded?.lng != null) {
    lat = geocoded.lat;
    lng = geocoded.lng;
  } else {
    const approx = resolveDestinationApproxCenter(label);
    lat = approx.lat;
    lng = approx.lng;
    geocodedForProfile = {
      placeId: "",
      country: "",
      city: label,
      lat,
      lng,
      formattedName: label,
      displayLabel: label,
    };
    console.warn("[ITINERARY_PLACES_FETCH] geocode_fallback", label);
  }

  let weather: WeatherSummary | null = null;
  if (fetchWeatherFn) {
    try {
      const raw = await fetchWeatherFn({ data: { lat, lng, locale } });
      const { unwrapWeatherResult } = await import("@/lib/ai/unwrap-weather-result");
      weather = unwrapWeatherResult(raw);
    } catch (e) {
      console.warn("[ITINERARY_PLACES_FETCH] weather_skipped", e);
    }
  }

  const scene = resolveWeatherScene(weather, label);
  void scene;

  const attempts: SearchAttempt[] = [
    ...buildMultiTypeItinerarySearchAttempts(label),
    ...buildCityOrLandmarkSearchAttempts(label, geocodedForProfile, weather, context),
    ...templateNameSearchAttempts(label),
    ...buildDestinationTextSearchAttempts(label),
    { query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 景點`, mode: "nearby", includedTypes: ["tourist_attraction", "museum", "park"] },
  ];

  const searchExtras = geocoded
    ? undefined
    : {
        searchContext: {
          searchMode: "destination" as const,
          destinationName: label,
          textOnlyDestinationSearch: true,
        },
      };

  let raw: PlaceResult[] = [];
  for (const attempt of attempts) {
    const batch = await fetchPlacesWithSearchAttempts(
      searchPlaces,
      lat,
      lng,
      locale,
      [attempt],
      "itinerary.fetchPlaces",
      searchExtras,
    );
    raw = dedupePlaces([...raw, ...batch]);
    raw = filterExcludedPlaceIds(raw, excludePlaceIds);
    const valid = filterValidItineraryPlaces(raw, label);
    if (valid.length >= fetchTarget) break;
  }

  const valid = filterValidItineraryPlaces(
    filterExcludedPlaceIds(raw, excludePlaceIds),
    label,
  );
  const ranked = rankByQuality(valid).slice(0, Math.max(fetchTarget, days + 2));

  console.info(
    "[ITINERARY_PLACES_FETCH]",
    `raw=${raw.length}`,
    `valid=${valid.length}`,
    `selected=${ranked.length}`,
  );

  if (raw.length < 1) {
    return {
      ok: false,
      reason: "api_empty",
      message: ITINERARY_PARTIAL_FAILURE_MESSAGE,
      rawCount: 0,
      validCount: 0,
    };
  }

  if (ranked.length < 1) {
    return {
      ok: false,
      reason: "filtered_empty",
      message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
      rawCount: raw.length,
      validCount: 0,
    };
  }

  const items = placesToChatItems(ranked, context, locale);
  if (!items.length) {
    return {
      ok: false,
      reason: "filtered_empty",
      message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
      rawCount: raw.length,
      validCount: valid.length,
    };
  }

  return { ok: true, places: items, rawCount: raw.length, validCount: valid.length };
}

async function mergeSessionPlacesWithFetch(params: {
  sessionPlaces: ChatPlaceItem[];
  destination: string;
  days: number;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn?: (args: {
    data: { lat: number; lng: number; locale?: Locale };
  }) => Promise<WeatherSummary>;
  excludePlaceIds?: string[];
}): Promise<
  | { ok: true; places: ChatPlaceItem[] }
  | { ok: false; message: string; apiEmpty: boolean }
> {
  const fetchTarget = computeItineraryFetchTarget(params.days);
  const fetchResult = await fetchItineraryPlaces(params);

  if (fetchResult.ok) {
    const merged = dedupeChatPlaces([
      ...params.sessionPlaces,
      ...fetchResult.places,
    ]).slice(0, Math.max(fetchTarget, params.sessionPlaces.length));
    if (merged.length > 0) {
      return { ok: true, places: merged };
    }
  }

  if (params.sessionPlaces.length > 0) {
    return { ok: true, places: params.sessionPlaces };
  }

  return {
    ok: false,
    message: fetchResult.ok ? INSUFFICIENT_ITINERARY_PLACES_MESSAGE : fetchResult.message,
    apiEmpty: !fetchResult.ok && fetchResult.reason === "api_empty",
  };
}

export async function prepareDirectItinerarySession(params: {
  session: ChatPlanningSession;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn?: (args: {
    data: { lat: number; lng: number; locale?: Locale };
  }) => Promise<WeatherSummary>;
  excludePlaceIds?: string[];
  msgs?: ChatMsg[];
}): Promise<
  | { ok: true; session: ChatPlanningSession }
  | { ok: false; message: string; apiEmpty?: boolean }
> {
  const { session, context, locale, searchPlaces, geocodeFn, fetchWeatherFn, excludePlaceIds, msgs } =
    params;

  const destination =
    context.destination?.trim() ||
    session.tripDestination?.displayLabel?.trim() ||
    session.tripDestination?.city?.trim();
  const days = context.days ?? session.tripDays;

  if (!destination || !days) {
    console.info("[ITINERARY_SAVE_FAILED_REASON]", "no destination");
    return {
      ok: false,
      message: "我還需要知道目的地和天數，才能幫你排完整行程。",
    };
  }

  const label = sanitizeDestinationForGeocode(
    normalizeDestinationLabel(destination),
  );
  logItineraryDaysParsed(days);

  const syncedSession = syncSessionPlaceMemory(session);
  const { places: rawSessionPlaces, source } = resolveItineraryPlaceSources(syncedSession, msgs);
  const sessionPlaces = preparePlacesForItineraryBuild(rawSessionPlaces, label);

  logItineraryBuildSource(source, sessionPlaces.length);
  if (source === "recommendedPlaces" || source === "plannedStops" || source === "renderedCards") {
    logItineraryUsedRecommendedPlaces(sessionPlaces.length);
  }

  const merged = await mergeSessionPlacesWithFetch({
    sessionPlaces,
    destination: label,
    days,
    context,
    locale,
    searchPlaces,
    geocodeFn,
    fetchWeatherFn,
    excludePlaceIds,
  });

  if (!merged.ok) {
    console.info("[ITINERARY_SAVE_FAILED_REASON]", merged.apiEmpty ? "api_empty" : "no places");
    return {
      ok: false,
      message: merged.message,
      apiEmpty: merged.apiEmpty,
    };
  }

  const places = merged.places;
  console.info(
    "[ITINERARY_PLACES_FETCH]",
    `destination=${label}`,
    `source=${source}`,
    `selected=${places.length}`,
  );

  if (!places.length) {
    console.info("[ITINERARY_SAVE_FAILED_REASON]", "no places");
    return { ok: false, message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE, apiEmpty: false };
  }

  logItineraryValidationResult(true, `places=${places.length}`);

  const today = new Date().toISOString().slice(0, 10);
  const startDate = session.tripStartDate || today;
  const end = new Date(startDate);
  end.setDate(end.getDate() + Math.max(days - 1, 0));
  const endDate = session.tripEndDate || end.toISOString().slice(0, 10);

  const tripDestination =
    session.tripDestination?.city === label || session.tripDestination?.displayLabel === label
      ? session.tripDestination
      : {
          placeId: "",
          country: context.destinationCountry ?? "",
          city: label,
          lat: places[0]?.lat ?? 0,
          lng: places[0]?.lng ?? 0,
          formattedName: label,
          displayLabel: label,
        };

  const readySession = syncSessionPlaceMemory({
    ...session,
    phase: "ready",
    selectedPlaces: places,
    plannedStops: places,
    tripDestination,
    tripDays: days,
    tripStartDate: startDate,
    tripEndDate: endDate,
    pendingQuestion: undefined,
    conversationMode: "destination_planning",
    travelContext: {
      ...(session.travelContext ?? { interests: [] }),
      ...context,
      destination: label,
      days,
      conversationState: "ready_for_itinerary",
      tripPurpose: "direct_itinerary_generation",
      selectedPlanMode: "full_itinerary",
    },
  });

  return { ok: true, session: readySession };
}

export function assertItineraryStopsHavePlaceIds(
  places: PlaceLike[],
  destination?: string,
): boolean {
  if (!places.length) return false;
  return places.every((p) => isValidItineraryStopPlace(p, destination));
}
