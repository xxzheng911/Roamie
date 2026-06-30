import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { TripStopSuggestion } from "@/lib/trip-stop-search.functions";
import { searchPlaces, getPlaceDetails, type PlaceLite } from "@/services/placesService";
import { fetchPlaceDetailsForScreenWithKey, type PlaceDetailsScreenResult } from "@/lib/places.functions";
import { getGoogleMapsBrowserKey, buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { preferJpegPngImageUrl } from "@/lib/safe-image-url";
import { buildUnifiedPlaceCard } from "@/lib/unified-place-card";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import type { WeatherSummary } from "@/lib/weather-types";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import { distanceMeters } from "@/lib/map-explore";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";
import {
  buildSelectedPlaceDistanceLabel,
  isPinnableSearchSelection,
  normalizeExplorePlaceId,
} from "@/lib/explore-selected-place";

export type ExploreMapSearchCard = PlaceResult & {
  reason: string;
  googleMapsUrl?: string;
  distanceLabel?: string;
  displayCategory?: string;
  coverImageUrl?: string;
  isSelectedExplorePin?: boolean;
};

type SearchFn = (args: {
  data: { query: string; locale?: Locale; lat?: number; lng?: number; sessionToken?: string };
}) => Promise<{ suggestions: TripStopSuggestion[]; error: string | null }>;

type ResolveFn = (args: {
  data: { placeId: string; locale?: Locale };
}) => Promise<{
  stop: { lat: number | null; lng: number | null; name?: string; address?: string } | null;
  error: string | null;
}>;

export async function runExploreMapPlaceSearch(
  query: string,
  options: {
    locale: Locale;
    center?: { lat: number; lng: number };
    searchFn: SearchFn;
    sessionToken?: string;
  },
): Promise<{ suggestions: TripStopSuggestion[]; error: string | null }> {
  const trimmed = query.trim();
  console.info(`[EXPLORE_SEARCH_START] query=${trimmed}`);
  if (!trimmed) {
    return { suggestions: [], error: null };
  }

  try {
    const result = await searchPlaces(trimmed, {
      locale: options.locale,
      center: options.center,
      sessionToken: options.sessionToken,
      searchFn: options.searchFn,
    });
    console.info(`[EXPLORE_SEARCH_RESULTS] count=${result.suggestions.length}`);
    if (result.error && result.suggestions.length === 0) {
      console.warn(`[EXPLORE_SEARCH_ERROR] status=search message=${result.error}`);
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[EXPLORE_SEARCH_ERROR] status=exception message=${msg}`);
    return { suggestions: [], error: msg };
  }
}

function placeLiteToResult(place: PlaceLite, types?: string[] | null): PlaceResult {
  const mergedTypes =
    types && types.length > 0
      ? types
      : place.placeType
        ? [place.placeType]
        : null;
  return {
    id: place.placeId,
    name: place.name,
    address: place.address || null,
    lat: place.lat,
    lng: place.lng,
    rating: place.rating ?? null,
    userRatingCount: null,
    photoName: place.photoName ?? null,
    primaryType: place.placeType ?? types?.[0] ?? null,
    types: mergedTypes,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

export function mapSearchCardFromPlaceLite(
  place: PlaceLite,
  opts: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    reasonProfile: UserProfileForReason | null;
    locale: Locale;
    types?: string[];
  },
): ExploreMapSearchCard {
  const base = placeLiteToResult(place, opts.types);
  const card = buildUnifiedPlaceCard({
    place: base,
    categoryId: "all",
    userLocation: opts.userLocation,
    weather: opts.weather,
    userProfile: opts.reasonProfile,
    locale: opts.locale,
  });
  const item = mapPlaceResultToChatItem(base, {
    weather: opts.weather,
    userProfile: opts.reasonProfile,
    locale: opts.locale,
  });
  return { ...card, googleMapsUrl: item.googleMapsUrl };
}

function normalizeGooglePlaceId(raw: string): string {
  return normalizeExplorePlaceId(raw);
}

function mapDetailsToSearchCard(
  place: PlaceDetailsScreenResult | PlaceResult,
  opts: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    reasonProfile: UserProfileForReason | null;
    locale: Locale;
    distanceLabel: string;
  },
): ExploreMapSearchCard | null {
  if (place.lat == null || place.lng == null) return null;
  const origin = { lat: place.lat, lng: place.lng };
  const card = buildUnifiedPlaceCard({
    place,
    categoryId: "all",
    userLocation: origin,
    weather: opts.weather,
    userProfile: opts.reasonProfile,
    locale: opts.locale,
  });
  const item = mapPlaceResultToChatItem(place, {
    weather: opts.weather,
    userProfile: opts.reasonProfile,
    locale: opts.locale,
  });
  return {
    ...card,
    googleMapsUrl: item.googleMapsUrl,
    distanceLabel: opts.distanceLabel,
    displayCategory: identityDisplayLabel(resolvePlaceIdentity(place), place),
    coverImageUrl: place.photoName
      ? (preferJpegPngImageUrl(buildPlacePhotoUrl(place.photoName, 600) ?? null) ?? undefined)
      : undefined,
    isSelectedExplorePin: true,
  };
}

/** 以搜尋選取的 placeId 拉 Place Details，作為推薦第一筆（不可被 filter 掉） */
export async function resolveExploreSelectedPlacePin(
  suggestion: TripStopSuggestion,
  options: {
    locale: Locale;
    resolveFn: ResolveFn;
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    reasonProfile: UserProfileForReason | null;
    fetchPlaceDetailsFn?: (args: {
      data: { placeId: string; locale?: Locale };
    }) => Promise<{ place: PlaceDetailsScreenResult | null; error: string | null }>;
  },
): Promise<ExploreMapSearchCard | null> {
  const placeId = normalizeGooglePlaceId(suggestion.placeId ?? "");
  if (!placeId) return null;

  if (
    !isPinnableSearchSelection({
      label: suggestion.label,
      types: suggestion.types,
      placeId,
    })
  ) {
    return null;
  }

  const distanceLabel = buildSelectedPlaceDistanceLabel(options.locale);
  let details: PlaceDetailsScreenResult | PlaceResult | null = null;

  const browserKey = getGoogleMapsBrowserKey();
  if (browserKey) {
    details = await fetchPlaceDetailsForScreenWithKey(placeId, browserKey, options.locale);
  } else if (options.fetchPlaceDetailsFn) {
    const result = await options.fetchPlaceDetailsFn({
      data: { placeId, locale: options.locale },
    });
    details = result.place;
  }

  if (details?.lat != null && details.lng != null) {
    const card = mapDetailsToSearchCard(details, { ...options, distanceLabel });
    if (!card) return null;
    const label = suggestion.label?.trim();
    return {
      ...card,
      id: placeId,
      name: label || card.name,
      isSelectedExplorePin: true,
    };
  }

  const { card } = await resolveExploreMapSuggestion(suggestion, options);
  if (!card?.lat || !card.lng) return null;
  const label = suggestion.label?.trim();
  return {
    ...card,
    id: placeId,
    name: label || card.name,
    distanceLabel,
    isSelectedExplorePin: true,
    coverImageUrl:
      preferJpegPngImageUrl(card.coverImageUrl ?? null) ??
      (card.photoName
        ? (preferJpegPngImageUrl(buildPlacePhotoUrl(card.photoName, 600) ?? null) ?? undefined)
        : undefined),
  };
}

export async function resolveExploreMapSuggestion(
  suggestion: TripStopSuggestion,
  options: {
    locale: Locale;
    resolveFn: ResolveFn;
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    reasonProfile: UserProfileForReason | null;
  },
): Promise<{ card: ExploreMapSearchCard | null; error: string | null }> {
  const { place, error } = await getPlaceDetails(suggestion.placeId, {
    locale: options.locale,
    resolveFn: options.resolveFn,
    fallback: suggestion,
  });
  if (!place) {
    console.warn(`[EXPLORE_SEARCH_ERROR] status=resolve message=${error ?? "not_found"}`);
    return { card: null, error: error ?? "not_found" };
  }
  return {
    card: mapSearchCardFromPlaceLite(place, {
      userLocation: options.userLocation,
      weather: options.weather,
      reasonProfile: options.reasonProfile,
      locale: options.locale,
      types: suggestion.types,
    }),
    error: null,
  };
}

export async function resolveExploreMapSuggestionsToCards(
  suggestions: TripStopSuggestion[],
  options: {
    locale: Locale;
    resolveFn: ResolveFn;
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    reasonProfile: UserProfileForReason | null;
    limit?: number;
  },
): Promise<ExploreMapSearchCard[]> {
  const slice = suggestions.slice(0, options.limit ?? 8);
  const cards: ExploreMapSearchCard[] = [];
  await Promise.all(
    slice.map(async (s) => {
      const { card } = await resolveExploreMapSuggestion(s, options);
      if (card?.lat != null && card.lng != null) {
        cards.push(card);
      }
    }),
  );
  cards.sort((a, b) => {
    const da = distanceMeters(options.userLocation, { lat: a.lat!, lng: a.lng! });
    const db = distanceMeters(options.userLocation, { lat: b.lat!, lng: b.lng! });
    return da - db;
  });
  return cards;
}

export function exploreSuggestionDistanceLabel(
  suggestion: TripStopSuggestion,
  userLocation: { lat: number; lng: number },
  card?: ExploreMapSearchCard | null,
): string | undefined {
  if (card?.lat != null && card.lng != null) {
    const m = distanceMeters(userLocation, { lat: card.lat, lng: card.lng });
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(1)} km`;
  }
  return suggestion.secondary?.split(",").pop()?.trim();
}
