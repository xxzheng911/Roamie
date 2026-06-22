import { distanceMeters } from "@/lib/map-explore";
import {
  EXPLORE_MAP_MAX_DISPLAY,
  exploreMapQualityScore,
} from "@/lib/explore-places-eligibility";
import { openStatusSortRank } from "@/lib/home-nearby-eligibility";
import { resolveOpenNow } from "@/lib/is-recommendable-place";
import type { PlaceResult } from "@/lib/place-result";
import { EXPLORE_ALL_SUBCATEGORY_IDS } from "@/lib/places-search-config";
import type { ExploreTimeBucket } from "@/lib/explore-time-bucket";

type MergeablePlace = PlaceResult & { categoryId?: string | null };

type Quota = { min: number; max: number };

function quotasForTimeBucket(bucket: ExploreTimeBucket): Record<string, Quota> {
  if (bucket === "late_night") {
    return {
      coffee: { min: 0, max: 2 },
      food: { min: 1, max: 2 },
      sight: { min: 0, max: 1 },
      district: { min: 0, max: 1 },
      night: { min: 2, max: 3 },
    };
  }
  if (bucket === "night") {
    return {
      coffee: { min: 1, max: 2 },
      food: { min: 1, max: 2 },
      sight: { min: 1, max: 2 },
      district: { min: 1, max: 1 },
      night: { min: 1, max: 2 },
    };
  }
  return {
    coffee: { min: 1, max: 2 },
    food: { min: 1, max: 2 },
    sight: { min: 1, max: 2 },
    district: { min: 1, max: 1 },
    night: { min: 0, max: 1 },
  };
}

export function explorePlaceDedupeKey(place: Pick<PlaceResult, "id" | "name" | "address" | "lat" | "lng">): string {
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

function sortCategoryCards<T extends MergeablePlace>(
  cards: T[],
  origin: { lat: number; lng: number },
  categoryId: string,
): T[] {
  return [...cards].sort((a, b) => {
    const tierA = a.exploreQualityTier ?? (resolveOpenNow(a) === true ? 1 : 2);
    const tierB = b.exploreQualityTier ?? (resolveOpenNow(b) === true ? 1 : 2);
    if (tierA !== tierB) return tierA - tierB;

    const statusA = openStatusSortRank(a.openStatus);
    const statusB = openStatusSortRank(b.openStatus);
    if (statusA !== statusB) return statusA - statusB;

    const scoreA = exploreMapQualityScore(a, origin, categoryId);
    const scoreB = exploreMapQualityScore(b, origin, categoryId);
    if (scoreA !== scoreB) return scoreB - scoreA;

    const distA =
      a.lat != null && a.lng != null
        ? distanceMeters(origin, { lat: a.lat, lng: a.lng })
        : Number.POSITIVE_INFINITY;
    const distB =
      b.lat != null && b.lng != null
        ? distanceMeters(origin, { lat: b.lat, lng: b.lng })
        : Number.POSITIVE_INFINITY;
    return distA - distB;
  });
}

function sortMergedAllCards<T extends MergeablePlace>(
  cards: T[],
  origin: { lat: number; lng: number },
): T[] {
  return [...cards].sort((a, b) => {
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

/** 「全部」：混合各子分類，確保多樣性 */
export function mergeExploreAllCategoryResults<T extends MergeablePlace>(
  cardsByCategory: Partial<Record<string, T[]>>,
  options: {
    origin: { lat: number; lng: number };
    timeBucket: ExploreTimeBucket;
  },
): T[] {
  const quotas = quotasForTimeBucket(options.timeBucket);
  const seen = new Set<string>();
  const picked: T[] = [];
  const categoryCounts = new Map<string, number>();

  const sortedByCategory: Record<string, T[]> = {};
  for (const subId of EXPLORE_ALL_SUBCATEGORY_IDS) {
    const list = cardsByCategory[subId] ?? [];
    sortedByCategory[subId] = sortCategoryCards(list, options.origin, subId);
  }

  const tryAdd = (card: T, subId: string): boolean => {
    const key = explorePlaceDedupeKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    picked.push({ ...card, categoryId: card.categoryId ?? subId });
    categoryCounts.set(subId, (categoryCounts.get(subId) ?? 0) + 1);
    return true;
  };

  for (const subId of EXPLORE_ALL_SUBCATEGORY_IDS) {
    const quota = quotas[subId] ?? { min: 0, max: 1 };
    const list = sortedByCategory[subId] ?? [];
    let added = 0;
    for (const card of list) {
      if (added >= quota.max) break;
      if (tryAdd(card, subId)) added += 1;
    }
  }

  const overflow: Array<{ card: T; subId: string; score: number }> = [];
  for (const subId of EXPLORE_ALL_SUBCATEGORY_IDS) {
    const quota = quotas[subId] ?? { min: 0, max: 1 };
    const list = sortedByCategory[subId] ?? [];
    for (let i = quota.max; i < list.length; i += 1) {
      const card = list[i]!;
      const key = explorePlaceDedupeKey(card);
      if (seen.has(key)) continue;
      overflow.push({
        card,
        subId,
        score: exploreMapQualityScore(card, options.origin, subId),
      });
    }
  }
  overflow.sort((a, b) => b.score - a.score);

  for (const item of overflow) {
    if (picked.length >= EXPLORE_MAP_MAX_DISPLAY) break;
    tryAdd(item.card, item.subId);
  }

  for (const subId of EXPLORE_ALL_SUBCATEGORY_IDS) {
    const quota = quotas[subId] ?? { min: 0, max: 1 };
    const have = categoryCounts.get(subId) ?? 0;
    if (have >= quota.min) continue;
    const list = sortedByCategory[subId] ?? [];
    for (const card of list) {
      if ((categoryCounts.get(subId) ?? 0) >= quota.min) break;
      tryAdd(card, subId);
    }
  }

  return sortMergedAllCards(picked, options.origin);
}
