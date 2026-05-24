import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";
import type { PlaceResult } from "@/lib/place-result";
import type { RecommendationCategoryId, VerifiedPlaceCandidate } from "@/lib/recommendation/types";

export function googleMapsPlaceUrl(placeId: string): string {
  return `https://www.google.com/maps/search/?api=1&query=place_id:${encodeURIComponent(placeId)}`;
}

export function normalizePlaceName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function placeResultToCandidate(
  place: PlaceResult,
  categoryId: RecommendationCategoryId,
): VerifiedPlaceCandidate | null {
  if (!place.id || place.id.startsWith("saved-") || place.id.startsWith("mock-")) return null;
  if (place.lat == null || place.lng == null) return null;
  if (!place.name?.trim()) return null;

  const typeLabel = identityDisplayLabel(resolvePlaceIdentity(place));
  const base: RoamieRecommendationItem = {
    name: place.name,
    placeName: place.name,
    type: typeLabel,
    description: "",
    reason: "",
    estimatedTime: categoryId === "coffee" ? "45-90 分鐘" : "1-2 小時",
    address: place.address ?? "",
    lat: place.lat,
    lng: place.lng,
    googleMapsUrl: googleMapsPlaceUrl(place.id),
    reasonSource: "template",
    openStatusLabel: place.openStatusLabel,
    todayHoursLabel: place.todayHoursLabel,
    closingSoonNote: place.closingSoonNote,
    nextOpenHint: place.nextOpenHint,
  };

  return {
    ...base,
    googlePlaceId: place.id,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    photoName: place.photoName,
    primaryType: place.primaryType,
    categoryId,
    sourcePlace: place,
  };
}

export function isVerifiedCandidate(
  item: RoamieRecommendationItem & { googlePlaceId?: string },
): boolean {
  return Boolean(item.googlePlaceId?.trim() && item.lat != null && item.lng != null);
}
