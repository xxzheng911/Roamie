import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import type { FetchPlaceDetailsForFocusFn } from "@/lib/ai/place-detail-chat";
import { resolveTripPlaceId, isGeocodeEmptyPlace } from "@/lib/ai/ai-trip-place-allocator";
import {
  logGeocodeEmptyIgnored,
  logPlaceDetailsPartialFailureIgnored,
} from "@/lib/ai/planning-place-id";
import { resolveGooglePlaceId } from "@/lib/place-canonical-identity";
import {
  logChatGeocodeReplaced,
  logChatGeocodeRetry,
  logChatGeocodeSkip,
  logChatGeocodeStart,
  logChatGeocodeSuccess,
  logChatRenderStart,
  logChatValidPlaceCount,
} from "@/lib/ai/chat-place-flow-log";
export function placeHasValidCoordinates(place: PlaceResult): boolean {
  return place.lat != null && place.lng != null && Number.isFinite(place.lat) && Number.isFinite(place.lng);
}

function mergePlaceCoordinates(
  place: PlaceResult,
  coords: { lat: number; lng: number; address?: string | null },
): PlaceResult {
  return {
    ...place,
    lat: coords.lat,
    lng: coords.lng,
    address: coords.address?.trim() || place.address,
  };
}

async function tryGeocodeQuery(
  geocodeFn: GeocodeDestinationFn,
  query: string,
  locale: Locale,
): Promise<{ lat: number; lng: number; address?: string } | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  try {
    const result = await geocodeFn({ data: { query: trimmed, locale } });
    const loc = result.location;
    if (loc?.lat != null && loc?.lng != null) {
      return {
        lat: loc.lat,
        lng: loc.lng,
        address: loc.address ?? loc.formattedName ?? trimmed,
      };
    }
  } catch {
    /* next retry */
  }
  return null;
}

export async function geocodePlanningPlace(params: {
  place: PlaceResult;
  city: string;
  locale: Locale;
  geocodeFn: GeocodeDestinationFn;
  fetchPlaceDetails?: FetchPlaceDetailsForFocusFn;
}): Promise<PlaceResult | null> {
  const { place, city, locale, geocodeFn, fetchPlaceDetails } = params;
  const name = place.name?.trim() ?? "";
  if (!name) return null;

  logChatGeocodeStart(name);

  if (placeHasValidCoordinates(place)) {
    logChatGeocodeSuccess(name);
    return place;
  }

  const primaryQuery = place.address?.trim() || `${city} ${name}`.trim();
  const primary = await tryGeocodeQuery(geocodeFn, primaryQuery, locale);
  if (primary) {
    logChatGeocodeSuccess(name);
    return mergePlaceCoordinates(place, primary);
  }

  const placeId = resolveGooglePlaceId(place);
  if (
    placeId &&
    fetchPlaceDetails
  ) {
    logChatGeocodeRetry(name, "place_details_address");
    try {
      const details = await fetchPlaceDetails(placeId);
      if (details?.lat != null && details?.lng != null) {
        logChatGeocodeSuccess(name);
        return mergePlaceCoordinates(place, {
          lat: details.lat,
          lng: details.lng,
          address: details.address,
        });
      }
      if (details?.address?.trim()) {
        const fromAddress = await tryGeocodeQuery(geocodeFn, details.address.trim(), locale);
        if (fromAddress) {
          logChatGeocodeSuccess(name);
          return mergePlaceCoordinates(place, fromAddress);
        }
      }
    } catch {
      logPlaceDetailsPartialFailureIgnored(placeId, "geocode_enrichment");
    }
  }

  logChatGeocodeRetry(name, "city_place_name");
  const cityQuery = `${city} ${name}`.trim();
  const cityRetry = await tryGeocodeQuery(geocodeFn, cityQuery, locale);
  if (cityRetry) {
    logChatGeocodeSuccess(name);
    return mergePlaceCoordinates(place, cityRetry);
  }

  logChatGeocodeSkip(name, "geocode_empty");
  logGeocodeEmptyIgnored(name, place.id);
  return place;
}

export type BuildValidPlacePoolResult = {
  validPlaces: PlaceResult[];
  skippedCount: number;
  replacedCount: number;
};

export async function buildValidPlacePoolForItinerary(params: {
  pool: PlaceResult[];
  minRequired: number;
  city: string;
  locale: Locale;
  geocodeFn: GeocodeDestinationFn;
  fetchPlaceDetails?: FetchPlaceDetailsForFocusFn;
  fetchMoreCandidates?: (excludeIds: string[]) => Promise<PlaceResult[]>;
  maxSearchRounds?: number;
}): Promise<BuildValidPlacePoolResult> {
  const {
    pool,
    minRequired,
    city,
    locale,
    geocodeFn,
    fetchPlaceDetails,
    fetchMoreCandidates,
    maxSearchRounds = 4,
  } = params;

  const validPlaces: PlaceResult[] = [];
  const pending: PlaceResult[] = [...pool];
  const processedIds = new Set<string>();
  let skippedCount = 0;
  let replacedCount = 0;
  let searchRound = 0;

  const processPending = async (): Promise<void> => {
    while (pending.length > 0 && validPlaces.length < minRequired) {
      const candidate = pending.shift()!;
      const id = resolveTripPlaceId(candidate);
      if (!id || processedIds.has(id)) continue;
      processedIds.add(id);

      const resolved = await geocodePlanningPlace({
        place: candidate,
        city,
        locale,
        geocodeFn,
        fetchPlaceDetails,
      });

      if (resolved) {
        if (placeHasValidCoordinates(resolved)) {
          validPlaces.push(resolved);
        } else {
          logGeocodeEmptyIgnored(resolved.name ?? id, id);
          validPlaces.push(resolved);
        }
        continue;
      }

      skippedCount += 1;

      if (fetchMoreCandidates) {
        const replacementBatch = await fetchMoreCandidates([...processedIds]);
        let replaced = false;
        for (const replacement of replacementBatch) {
          const replacementId = resolveTripPlaceId(replacement);
          if (!replacementId || processedIds.has(replacementId)) continue;
          pending.push(replacement);
          logChatGeocodeReplaced(candidate.name ?? id, replacement.name ?? replacementId);
          replacedCount += 1;
          replaced = true;
          break;
        }
        if (!replaced && replacementBatch.length === 0) {
          continue;
        }
      }
    }
  };

  await processPending();

  while (
    validPlaces.length < minRequired &&
    fetchMoreCandidates &&
    searchRound < maxSearchRounds
  ) {
    searchRound += 1;
    const more = await fetchMoreCandidates([...processedIds]);
    if (!more.length) break;
    for (const place of more) {
      const id = resolveTripPlaceId(place);
      if (!id || processedIds.has(id)) continue;
      pending.push(place);
    }
    await processPending();
  }

  logChatValidPlaceCount(validPlaces.length, minRequired);
  return { validPlaces, skippedCount, replacedCount };
}

import { minCandidatePoolSize } from "@/lib/ai/ai-multi-day-planner";

/** 進入 Planner 前：候選池至少 days × 4 */
export function minGeocodedPlacesForItinerary(days: number): number {
  return minCandidatePoolSize(days);
}

/** Geocode 池目標：與 Planner 進入門檻一致 */
export function minGeocodedPoolTarget(days: number): number {
  return minCandidatePoolSize(days);
}

export function canRenderItinerary(validCount: number, days: number, _minPerDay?: number): boolean {
  return validCount >= minCandidatePoolSize(days);
}

export function logItineraryRenderStart(): void {
  logChatRenderStart();
}

export function filterPlacesWithCoordinates(places: PlaceResult[]): PlaceResult[] {
  return places.filter((place) => placeHasValidCoordinates(place) && !isGeocodeEmptyPlace(place));
}
