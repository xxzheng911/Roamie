import type { RoamieItineraryItem } from "@/lib/ai/types";
import type { Locale } from "@/lib/i18n/types";
import {
  isRoutableGooglePlaceId,
  latLngFallbackPlaceId,
  type PlaceDetailHandoff,
} from "@/lib/place-detail-handoff";
import {
  logPlaceDetailPlaceIdResolveStart,
  logPlaceDetailPlaceIdResolveSuccess,
} from "@/lib/place/place-detail-logs";
import { searchPlaces, getPlaceDetails } from "@/services/placesService";
import { searchPlacesViaBundledApi } from "@/lib/places-search-api";
import type { PlaceResult } from "@/lib/place-result";

export type TripPlaceResolveInput = {
  item: RoamieItineraryItem;
  destination?: string | null;
  city?: string | null;
  locale?: Locale;
};

export type ResolvedTripPlaceId = {
  routePlaceId: string;
  handoff: PlaceDetailHandoff;
  confidence: "high" | "medium" | "low";
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

/** 不得只用 placeName；需含 destination / city / address */
export function buildTripPlaceSearchQuery(input: TripPlaceResolveInput): string {
  const name = (input.item.placeName || input.item.title || "").trim();
  const address = input.item.address?.trim() ?? "";
  const city = input.city?.trim() || "";
  const destination = input.destination?.trim() || "";
  const parts = [name, address, city, destination].filter(Boolean);
  const unique = [...new Set(parts)];
  return unique.join(" ").trim();
}

function scoreTextMatch(
  place: PlaceResult,
  targetName: string,
  address?: string | null,
  destination?: string | null,
): number {
  const name = norm(place.name);
  const target = norm(targetName);
  let score = 0;
  if (name === target) score += 100;
  else if (name.includes(target) || target.includes(name)) score += 60;

  const addr = norm(place.address ?? "");
  const addrKey = norm(address ?? "");
  if (addrKey && addr.includes(addrKey)) score += 40;

  const destKey = norm(destination ?? "");
  if (destKey && (addr.includes(destKey) || name.includes(destKey))) score += 25;

  if (place.rating != null && place.rating >= 4) score += 5;
  return score;
}

function pickBestPlaceResult(
  places: PlaceResult[],
  targetName: string,
  address?: string | null,
  destination?: string | null,
): PlaceResult | null {
  if (!places.length) return null;
  const scored = places
    .map((p) => ({ p, score: scoreTextMatch(p, targetName, address, destination) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 30) return null;
  return best.p;
}

async function searchByText(
  query: string,
  lat: number,
  lng: number,
  locale: Locale,
): Promise<PlaceResult[]> {
  try {
    const result = await searchPlacesViaBundledApi({
      query,
      lat,
      lng,
      mode: "text",
      availabilityContext: "lenient",
      telemetrySurface: "other",
      locale,
    });
    return result.places ?? [];
  } catch {
    return [];
  }
}

function handoffFromPlace(
  placeId: string,
  name: string,
  partial: Partial<PlaceDetailHandoff> & Pick<PlaceDetailHandoff, "placeId" | "name">,
): PlaceDetailHandoff {
  return {
    address: null,
    lat: null,
    lng: null,
    ...partial,
    placeId,
    name,
  };
}

/**
 * 行程地點 → Google placeId（Text Search 優先，不用單獨 placeName）
 */
export async function resolveTripPlaceIdForDetail(
  input: TripPlaceResolveInput,
): Promise<ResolvedTripPlaceId | null> {
  const name = (input.item.placeName || input.item.title || "").trim();
  if (!name) return null;

  const locale = input.locale ?? "zh-TW";
  const rawGoogle = (input.item.googlePlaceId ?? "").replace(/^places\//, "").trim();

  if (rawGoogle && isRoutableGooglePlaceId(rawGoogle)) {
    logPlaceDetailPlaceIdResolveSuccess({
      placeName: name,
      placeId: rawGoogle,
      confidence: "high",
      resolvedName: name,
      resolvedAddress: input.item.address?.trim() ?? "",
    });
    return {
      routePlaceId: rawGoogle,
      confidence: "high",
      handoff: handoffFromPlace(rawGoogle, name, {
        address: input.item.address?.trim() || null,
        lat: input.item.lat ?? null,
        lng: input.item.lng ?? null,
        category: input.item.placeType ?? null,
        itineraryItem: input.item,
      }),
    };
  }

  const query = buildTripPlaceSearchQuery(input);
  logPlaceDetailPlaceIdResolveStart({
    placeName: name,
    query,
  });

  const biasLat = input.item.lat ?? 35.6812;
  const biasLng = input.item.lng ?? 139.7671;

  let textPlaces = await searchByText(query, biasLat, biasLng, locale);
  let match = pickBestPlaceResult(
    textPlaces,
    name,
    input.item.address,
    input.destination ?? input.city,
  );

  if (!match && query.length >= 2) {
    const { suggestions } = await searchPlaces(query, {
      locale,
      center:
        input.item.lat != null && input.item.lng != null
          ? { lat: input.item.lat, lng: input.item.lng }
          : undefined,
    });
    const auto = suggestions.find((s) => isRoutableGooglePlaceId(s.placeId));
    if (auto?.placeId) {
      const routePlaceId = auto.placeId.replace(/^places\//, "");
      const details = await getPlaceDetails(routePlaceId, { locale });
      if (details.place) {
        match = {
          id: routePlaceId,
          name: details.place.name,
          address: details.place.address,
          lat: details.place.lat,
          lng: details.place.lng,
          rating: details.place.rating,
          userRatingCount: null,
          photoName: details.place.photoName,
          primaryType: details.place.placeType ?? null,
          types: null,
          businessStatus: null,
          openStatus: "unknown",
          openStatusLabel: "",
          todayHoursLabel: "",
          closingSoonNote: "",
          nextOpenHint: "",
        };
      }
    }
  }

  if (match && isRoutableGooglePlaceId(match.id)) {
    const routePlaceId = match.id.replace(/^places\//, "");
    const confidence: "high" | "medium" | "low" =
      scoreTextMatch(match, name, input.item.address, input.destination) >= 80
        ? "high"
        : scoreTextMatch(match, name, input.item.address, input.destination) >= 50
          ? "medium"
          : "low";
    logPlaceDetailPlaceIdResolveSuccess({
      placeName: name,
      placeId: routePlaceId,
      confidence,
      resolvedName: match.name,
      resolvedAddress: match.address ?? "",
    });
    return {
      routePlaceId,
      confidence,
      handoff: handoffFromPlace(routePlaceId, match.name || name, {
        address: match.address ?? (input.item.address?.trim() || null),
        lat: match.lat ?? input.item.lat ?? null,
        lng: match.lng ?? input.item.lng ?? null,
        category: match.primaryType ?? input.item.placeType ?? null,
        photoName: match.photoName,
        rating: match.rating,
        userRatingCount: match.userRatingCount,
        itineraryItem: input.item,
      }),
    };
  }

  if (input.item.lat != null && input.item.lng != null) {
    const routePlaceId = latLngFallbackPlaceId(input.item.lat, input.item.lng);
    return {
      routePlaceId,
      confidence: "low",
      handoff: handoffFromPlace(routePlaceId, name, {
        address: input.item.address?.trim() || null,
        lat: input.item.lat,
        lng: input.item.lng,
        category: input.item.placeType ?? null,
        itineraryItem: input.item,
      }),
    };
  }

  const routePlaceId = `trip-stop:${encodeURIComponent(name)}`;
  return {
    routePlaceId,
    confidence: "low",
    handoff: handoffFromPlace(routePlaceId, name, {
      address: input.item.address?.trim() || null,
      lat: null,
      lng: null,
      category: input.item.placeType ?? null,
      itineraryItem: input.item,
    }),
  };
}
