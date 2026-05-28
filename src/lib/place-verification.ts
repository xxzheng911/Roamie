import type { PlaceResult } from "@/lib/place-result";
import type { RoamieRecommendationItem } from "@/lib/ai/types";

/** 是否為 Google Places 回傳的真實地點（非 mock / 無座標模板） */
export function isVerifiedPlaceResult(place: PlaceResult): boolean {
  if (!place.name?.trim()) return false;
  if (place.id?.startsWith("mock-")) return false;
  if (/附近.*散步|附近.*咖啡|安靜咖啡$/i.test(place.name)) return false;
  return place.lat != null && place.lng != null;
}

export function isVerifiedRecommendation(item: RoamieRecommendationItem): boolean {
  const name = (item.placeName ?? item.name)?.trim() ?? "";
  if (!name) return false;
  if (/附近.*散步|附近.*咖啡|安靜咖啡$/i.test(name)) return false;
  if (item.lat == null || item.lng == null) return false;
  return true;
}

export function filterVerifiedPlaceResults(places: PlaceResult[]): PlaceResult[] {
  return places.filter(isVerifiedPlaceResult);
}

export function filterVerifiedRecommendations(
  items: RoamieRecommendationItem[],
): RoamieRecommendationItem[] {
  return items.filter(isVerifiedRecommendation);
}
