import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { distanceMeters } from "@/lib/map-explore";
import type { PlaceResult } from "@/lib/place-result";
import {
  isSimilarPlaceName,
  normalizePlaceName,
  similarPlaceClusterRadiusMeters,
  type PlaceLike,
} from "@/lib/place-planning-memory";

export type DedupeResultMeta = {
  input_count: number;
  output_count: number;
  removed_duplicates: number;
  dedupe_keys: string[];
  cluster_collapsed?: number;
  geo_spread_applied?: boolean;
};

function googlePlaceIdFromItem(item: PlaceLike & { googlePlaceId?: string }): string {
  const raw = item.googlePlaceId?.trim() || ("placeId" in item ? String(item.placeId ?? "").trim() : "");
  return raw.replace(/^places\//, "");
}

/** 推薦去重 key：place_id 優先，其次 name+座標 */
export function recommendationIdentityKey(
  item: PlaceLike & { googlePlaceId?: string; placeId?: string },
): string {
  return dedupeKeyForItem(item);
}

function dedupeKeyForItem(item: PlaceLike & { googlePlaceId?: string; placeId?: string }): string {
  const gid = googlePlaceIdFromItem(item);
  if (gid && !gid.startsWith("mock-")) return `id:${gid}`;
  const name = normalizePlaceName(item.placeName ?? item.name);
  if (item.lat != null && item.lng != null) {
    return `geo:${name}@${item.lat.toFixed(4)},${item.lng.toFixed(4)}`;
  }
  const addr = (item.address ?? "").trim().toLowerCase();
  return addr ? `na:${name}@${addr}` : `n:${name}`;
}

function placeNameOf(item: PlaceLike): string {
  return item.placeName ?? item.name;
}

function isNearDuplicate(a: PlaceLike, b: PlaceLike): boolean {
  const nameA = placeNameOf(a);
  const nameB = placeNameOf(b);
  if (!isSimilarPlaceName(nameA, nameB)) return false;
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    const maxDist = similarPlaceClusterRadiusMeters(nameA, nameB);
    return distanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) < maxDist;
  }
  return true;
}

function ratingScore(item: PlaceLike & { rating?: number | null; userRatingCount?: number | null }): number {
  const rating = item.rating ?? 0;
  const count = item.userRatingCount ?? 0;
  return rating * 1000 + Math.min(count, 999);
}

/** 景區去重後，再依距離挑選分散的地點（避免同一河岸／同一園區連推 4 個） */
export function selectGeographicallyDiversePlaces<T extends PlaceLike>(
  items: T[],
  opts: { maxCount: number; minSeparationMeters?: number },
): T[] {
  const minSep = opts.minSeparationMeters ?? 800;
  const sorted = [...items].sort((a, b) => ratingScore(b) - ratingScore(a));
  const out: T[] = [];

  for (const candidate of sorted) {
    if (out.length >= opts.maxCount) break;
    const tooClose = out.some((existing) => {
      if (
        candidate.lat == null ||
        candidate.lng == null ||
        existing.lat == null ||
        existing.lng == null
      ) {
        return isNearDuplicate(existing, candidate);
      }
      return distanceMeters(existing, candidate) < minSep || isNearDuplicate(existing, candidate);
    });
    if (!tooClose) out.push(candidate);
  }

  if (out.length < opts.maxCount) {
    for (const candidate of sorted) {
      if (out.length >= opts.maxCount) break;
      if (out.includes(candidate)) continue;
      if (out.some((existing) => isNearDuplicate(existing, candidate))) continue;
      out.push(candidate);
    }
  }

  return out.slice(0, opts.maxCount);
}

/** 同一輪推薦去重（place_id → 同名景區 → 地理分散） */
export function dedupeRecommendationItems<T extends PlaceLike & { googlePlaceId?: string }>(
  items: T[],
  opts?: { maxCount?: number; minCount?: number; minSeparationMeters?: number },
): { items: T[]; meta: DedupeResultMeta } {
  const maxCount = opts?.maxCount ?? 4;
  const keys: string[] = [];
  const clustered: T[] = [];

  for (const item of items) {
    const key = dedupeKeyForItem(item);
    if (keys.includes(key)) continue;
    if (clustered.some((existing) => isNearDuplicate(existing, item))) continue;
    keys.push(key);
    clustered.push(item);
  }

  const diverse = selectGeographicallyDiversePlaces(clustered, {
    maxCount,
    minSeparationMeters: opts?.minSeparationMeters,
  });

  const meta: DedupeResultMeta = {
    input_count: items.length,
    output_count: diverse.length,
    removed_duplicates: Math.max(0, items.length - diverse.length),
    dedupe_keys: keys,
    cluster_collapsed: Math.max(0, clustered.length - diverse.length),
    geo_spread_applied: diverse.length < clustered.length,
  };

  if (opts?.minCount && diverse.length < opts.minCount) {
    console.info("[REC_DEDUPE] below_min", opts.minCount, meta);
  } else {
    console.info("[REC_DEDUPE]", meta);
  }

  return { items: diverse, meta };
}

export function dedupePlaceResults(places: PlaceResult[], opts?: { maxCount?: number; minCount?: number }): {
  places: PlaceResult[];
  meta: DedupeResultMeta;
} {
  const { items, meta } = dedupeRecommendationItems(places, opts);
  return { places: items, meta };
}

export function dedupeRoamieRecommendations(
  recs: RoamieRecommendationItem[],
  opts?: { maxCount?: number; minCount?: number },
): { recommendations: RoamieRecommendationItem[]; meta: DedupeResultMeta } {
  const normalized = recs.map((r) => ({
    ...r,
    googlePlaceId: r.googlePlaceId,
    placeId: r.googlePlaceId,
    name: r.placeName ?? r.name,
    rating: r.rating ?? null,
    userRatingCount: r.userRatingCount ?? null,
  }));
  const { items, meta } = dedupeRecommendationItems(normalized, opts);
  return { recommendations: items as RoamieRecommendationItem[], meta };
}
