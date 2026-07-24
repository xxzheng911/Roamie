import { buildPlaceMapsUrl } from "@/lib/maps-navigation";
import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeItineraryItem } from "@/lib/ai/types";
import type { PlaceResult } from "@/lib/place-result";
import type { SavedPlace } from "@/lib/places-storage";
import { readSavedPlaceMetadata } from "@/lib/saved-place-utils";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";

/** 可加入行程的地點（探索、聊天、收藏、手動搜尋） */
export type TripPlaceInput = {
  name: string;
  placeName: string;
  title: string;
  address: string;
  lat: number | null;
  lng: number | null;
  googlePlaceId?: string;
  placeType?: string;
  description?: string;
  googleMapsUrl?: string;
  photoName?: string | null;
  rating?: number | null;
  localizedDisplayName?: string;
  navigationLatitude?: number | null;
  navigationLongitude?: number | null;
  coordinateSource?: RoamieItineraryItem["coordinateSource"];
};

export function tripPlaceFromRecommendation(rec: RoamieRecommendationItem): TripPlaceInput {
  return {
    name: rec.name,
    placeName: rec.placeName ?? rec.name,
    title: rec.placeName ?? rec.name,
    address: rec.address ?? "",
    lat: rec.lat,
    lng: rec.lng,
    googlePlaceId: rec.googlePlaceId,
    placeType: rec.type,
    description: rec.description,
    googleMapsUrl: rec.googleMapsUrl,
    photoName: rec.photoName ?? null,
    rating: rec.rating ?? null,
  };
}

export function tripPlaceFromPlaceResult(place: PlaceResult): TripPlaceInput {
  const typeLabel = identityDisplayLabel(resolvePlaceIdentity(place));
  const displayName =
    place.localizedDisplayName?.trim() || place.name;
  return {
    name: displayName,
    placeName: displayName,
    title: displayName,
    address: place.address ?? "",
    lat: place.lat,
    lng: place.lng,
    googlePlaceId: place.id,
    placeType: typeLabel,
    description: "",
    googleMapsUrl: buildPlaceMapsUrl(displayName, place.lat, place.lng),
    photoName: place.photoName,
    rating: place.rating,
    navigationLatitude: place.navigationLatitude ?? undefined,
    navigationLongitude: place.navigationLongitude ?? undefined,
    coordinateSource: place.coordinateSource ?? undefined,
    localizedDisplayName: displayName,
  };
}

export function tripPlaceFromSavedPlace(place: SavedPlace): TripPlaceInput {
  const meta = readSavedPlaceMetadata(place);
  return {
    name: place.name,
    placeName: place.name,
    title: place.name,
    address: place.address ?? "",
    lat: place.lat ?? null,
    lng: place.lng ?? null,
    googlePlaceId: meta.googlePlaceId ?? meta.placeId,
    placeType: meta.primaryType ?? place.category ?? undefined,
    description: place.notes ?? "",
    googleMapsUrl: buildPlaceMapsUrl(place.name, place.lat ?? null, place.lng ?? null),
    photoName: meta.photoName ?? null,
    rating: meta.rating ?? null,
  };
}

export function tripPlaceToItineraryItem(
  place: TripPlaceInput,
  opts: { date: string; time?: string; notes?: string },
): RoamieItineraryItem {
  return normalizeItineraryItem({
    date: opts.date,
    time: opts.time ?? "10:00",
    title: place.title,
    placeName: place.placeName,
    description: place.description ?? "",
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    googlePlaceId: place.googlePlaceId,
    placeType: place.placeType,
    notes: opts.notes ?? "",
    localizedDisplayName: place.localizedDisplayName,
    navigationLatitude: place.navigationLatitude,
    navigationLongitude: place.navigationLongitude,
    coordinateSource:
      place.coordinateSource ??
      (place.googlePlaceId && place.lat != null && place.lng != null
        ? "google_places"
        : undefined),
  });
}
