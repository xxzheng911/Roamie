import { buildPlaceMapsUrl } from "@/lib/maps-navigation";
import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeItineraryItem } from "@/lib/ai/types";
import type { PlaceResult } from "@/lib/place-result";
import type { SavedPlace } from "@/lib/places-storage";
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
  return {
    name: place.name,
    placeName: place.name,
    title: place.name,
    address: place.address ?? "",
    lat: place.lat,
    lng: place.lng,
    googlePlaceId: place.id,
    placeType: typeLabel,
    description: "",
    googleMapsUrl: buildPlaceMapsUrl(place.name, place.lat, place.lng),
    photoName: place.photoName,
    rating: place.rating,
  };
}

export function tripPlaceFromSavedPlace(place: SavedPlace): TripPlaceInput {
  return {
    name: place.name,
    placeName: place.name,
    title: place.name,
    address: place.address ?? "",
    lat: place.lat ?? null,
    lng: place.lng ?? null,
    placeType: place.category,
    description: place.notes ?? "",
    googleMapsUrl: buildPlaceMapsUrl(place.name, place.lat ?? null, place.lng ?? null),
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
  });
}
