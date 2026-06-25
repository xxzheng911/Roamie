import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import { syncSessionPlaceMemory } from "@/lib/place-planning-memory";
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

export { INSUFFICIENT_ITINERARY_PLACES_MESSAGE };

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
      categoryLabel: "景點",
    });
    return {
      ...item,
      placeId: item.googlePlaceId ?? p.id,
    };
  });
}

export type FetchItineraryPlacesResult =
  | { ok: true; places: ChatPlaceItem[]; rawCount: number }
  | { ok: false; reason: "insufficient" | "geocode_failed"; message: string };

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

  const label = normalizeDestinationLabel(destination);
  const minRequired = Math.max(3, Math.min(days, 8));

  console.info(
    "[ITINERARY_PLACES_FETCH]",
    `destination=${label}`,
    `days=${days}`,
    `minRequired=${minRequired}`,
  );

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
    ...buildCityOrLandmarkSearchAttempts(label, geocodedForProfile, weather, context),
    ...templateNameSearchAttempts(label),
    { query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 景點`, mode: "nearby", includedTypes: ["tourist_attraction", "museum"] },
  ];

  let raw: PlaceResult[] = [];
  for (const attempt of attempts) {
    const batch = await fetchPlacesWithSearchAttempts(
      searchPlaces,
      lat,
      lng,
      locale,
      [attempt],
      "itinerary.fetchPlaces",
    );
    raw = dedupePlaces([...raw, ...batch]);
    raw = filterExcludedPlaceIds(raw, excludePlaceIds);
    const valid = filterValidItineraryPlaces(raw, label);
    if (valid.length >= minRequired) break;
  }

  const valid = filterValidItineraryPlaces(
    filterExcludedPlaceIds(raw, excludePlaceIds),
    label,
  );
  const ranked = rankByQuality(valid).slice(0, Math.max(minRequired, days + 2));

  console.info(
    "[ITINERARY_PLACES_FETCH]",
    `raw=${raw.length}`,
    `valid=${valid.length}`,
    `selected=${ranked.length}`,
  );

  if (ranked.length < minRequired) {
    return {
      ok: false,
      reason: "insufficient",
      message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
    };
  }

  const items = placesToChatItems(ranked, context, locale);
  if (!items.length) {
    return {
      ok: false,
      reason: "insufficient",
      message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
    };
  }

  return { ok: true, places: items, rawCount: raw.length };
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
}): Promise<
  | { ok: true; session: ChatPlanningSession }
  | { ok: false; message: string }
> {
  const { session, context, locale, searchPlaces, geocodeFn, fetchWeatherFn, excludePlaceIds } =
    params;

  const destination =
    context.destination?.trim() ||
    session.tripDestination?.displayLabel?.trim() ||
    session.tripDestination?.city?.trim();
  const days = context.days ?? session.tripDays;

  if (!destination || !days) {
    return {
      ok: false,
      message: "我還需要知道目的地和天數，才能幫你排完整行程。",
    };
  }

  const label = normalizeDestinationLabel(destination);
  const fetchResult = await fetchItineraryPlaces({
    destination: label,
    days,
    context,
    locale,
    searchPlaces,
    geocodeFn,
    fetchWeatherFn,
    excludePlaceIds,
  });

  if (!fetchResult.ok) {
    return { ok: false, message: fetchResult.message };
  }

  const places = fetchResult.places;
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
