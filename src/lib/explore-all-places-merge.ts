import { distanceMeters } from "@/lib/map-explore";
import {
  EXPLORE_CITY_ALL_MAX_DISPLAY,
  EXPLORE_MAP_MAX_DISPLAY,
  exploreMapQualityScore,
} from "@/lib/explore-places-eligibility";
import { exploreCityTouristQualityScore } from "@/lib/explore-city-tourist-filter";
import { resolveOpenNow } from "@/lib/is-recommendable-place";
import type { PlaceResult } from "@/lib/place-result";
import { EXPLORE_ALL_SUBCATEGORY_IDS } from "@/lib/places-search-config";
import type { ExploreTimeBucket } from "@/lib/explore-time-bucket";

type MergeablePlace = PlaceResult & { categoryId?: string | null };

export function explorePlaceDedupeKey(
  place: Pick<PlaceResult, "id" | "name" | "address" | "lat" | "lng">,
): string {
  const id = (place.id ?? "").trim();
  if (id && !id.startsWith("mock-") && !id.startsWith("saved-")) {
    return `id:${id}`;
  }
  const name = (place.name ?? "").trim().toLowerCase();
  const address = (place.address ?? "").trim().toLowerCase();
  const lat = place.lat != null ? place.lat.toFixed(5) : "";
  const lng = place.lng != null ? place.lng.toFixed(5) : "";
  return `geo:${name}|${address}|${lat}|${lng}`;
}

function sortMergedAllCards<T extends MergeablePlace>(
  cards: T[],
  origin: { lat: number; lng: number },
  cityMode = false,
): T[] {
  return [...cards].sort((a, b) => {
    if (cityMode) {
      const scoreA = exploreCityTouristQualityScore(a, origin);
      const scoreB = exploreCityTouristQualityScore(b, origin);
      if (scoreA !== scoreB) return scoreB - scoreA;
    }

    const openA = resolveOpenNow(a) === true ? 0 : 1;
    const openB = resolveOpenNow(b) === true ? 0 : 1;
    if (openA !== openB) return openA - openB;

    const ratingA = a.rating ?? 0;
    const ratingB = b.rating ?? 0;
    if (ratingA !== ratingB) return ratingB - ratingA;

    const countA = a.userRatingCount ?? 0;
    const countB = b.userRatingCount ?? 0;
    if (countA !== countB) return countB - countA;

    const distA =
      a.lat != null && a.lng != null
        ? distanceMeters(origin, { lat: a.lat, lng: a.lng })
        : Number.POSITIVE_INFINITY;
    const distB =
      b.lat != null && b.lng != null
        ? distanceMeters(origin, { lat: b.lat, lng: b.lng })
        : Number.POSITIVE_INFINITY;
    if (distA !== distB) return distA - distB;

    const catA = a.categoryId ?? "";
    const catB = b.categoryId ?? "";
    if (catA !== catB) return catA.localeCompare(catB);

    return 0;
  });
}

/** 「全部」：各子分類既有合格結果的完整去重聯集，再套單一 global cap。 */
export function mergeExploreAllCategoryResults<T extends MergeablePlace>(
  cardsByCategory: Partial<Record<string, T[]>>,
  options: {
    origin: { lat: number; lng: number };
    timeBucket: ExploreTimeBucket;
    cityMode?: boolean;
  },
): T[] {
  const cityMode = options.cityMode === true;
  const maxDisplay = cityMode ? EXPLORE_CITY_ALL_MAX_DISPLAY : EXPLORE_MAP_MAX_DISPLAY;
  const seen = new Set<string>();
  const union: T[] = [];
  const add = (card: T, subId: string): void => {
    const key = explorePlaceDedupeKey(card);
    if (seen.has(key)) return;
    seen.add(key);
    union.push({ ...card, categoryId: card.categoryId ?? subId });
  };

  for (const subId of EXPLORE_ALL_SUBCATEGORY_IDS) {
    for (const card of cardsByCategory[subId] ?? []) add(card, subId);
  }

  return sortMergedAllCards(union, options.origin, cityMode).slice(0, maxDisplay);
}
