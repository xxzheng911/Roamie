/**
 * Cross-day geographic clustering.
 *
 * Trip generation must group places by geography FIRST, then assign each
 * geographic cluster to a day — instead of splitting nearby places across
 * different days (or letting每個組合選項 map 1:1 to a day).
 *
 * The clustering is destination-agnostic and density-adaptive: a dense city uses
 * a tighter "same area" radius than a sparse rural trip.
 */

import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/geo-distance";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { resolveTripPlaceId } from "@/lib/ai/ai-trip-place-allocator";

type LatLng = { lat: number; lng: number };

/** Minimal accessor so clustering can run on any place-like shape. */
export type GeoAccessor<T> = {
  coords: (item: T) => LatLng | null;
  id: (item: T) => string;
  name: (item: T) => string;
  address: (item: T) => string;
  /** Higher = seeded earlier for stable centroids (e.g. review count). */
  weight: (item: T) => number;
};

export type GeoClusterOf<T> = {
  clusterId: string;
  centerLatitude: number;
  centerLongitude: number;
  areaName: string;
  ids: string[];
  items: T[];
  candidateDay?: number;
};

export type GeoCluster = GeoClusterOf<PlaceResult> & {
  placeIds: string[];
  places: PlaceResult[];
};

export type GeographicClusteringResult = {
  clusters: GeoCluster[];
  unlocated: PlaceResult[];
  radiusMeters: number;
};

const MIN_CLUSTER_RADIUS_M = 700;
const MAX_CLUSTER_RADIUS_M = 6_000;
/** Sparse / island-scale trips (nearest neighbors often >8km). Destination-agnostic. */
const MAX_SPARSE_CLUSTER_RADIUS_M = 40_000;
/** Do not merge day clusters farther than this — prefer more days over cross-island days. */
const MAX_SAME_DAY_CLUSTER_MERGE_M = 35_000;

function normalizeCoords(coords: LatLng | null): LatLng | null {
  if (!coords) return null;
  if (Math.abs(coords.lat) < 0.0001 && Math.abs(coords.lng) < 0.0001) return null;
  return coords;
}

function placeResultCoords(place: PlaceResult): LatLng | null {
  if (place.lat == null || place.lng == null) return null;
  return normalizeCoords({ lat: place.lat, lng: place.lng });
}

/** Coarse administrative-area label from a formatted address (multi-locale). */
export function extractAreaNameFromAddress(address: string): string {
  if (!address) return "";
  const patterns: RegExp[] = [
    /([\u4e00-\u9fff]{1,4}區)/, // 松山區 / 信義區
    /([\u4e00-\u9fff]{1,4}区)/, // 台東区 (JP)
    /([\u4e00-\u9fff]{1,4}鄉)/,
    /([\u4e00-\u9fff]{1,4}鎮)/,
    /([\uac00-\ud7a3]+구)/, // 종로구 (KR)
    /([\uac00-\ud7a3]+동)/, // dong
    /([\u4e00-\u9fff]{1,4}市)/,
  ];
  for (const re of patterns) {
    const m = address.match(re);
    if (m?.[1]) return m[1];
  }
  return address.split(",")[0]?.trim() ?? "";
}

function centroid<T>(items: T[], acc: GeoAccessor<T>): LatLng {
  const coords = items.map(acc.coords).filter((c): c is LatLng => normalizeCoords(c) != null);
  if (!coords.length) return { lat: 0, lng: 0 };
  const sum = coords.reduce(
    (a, c) => ({ lat: a.lat + c.lat, lng: a.lng + c.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / coords.length, lng: sum.lng / coords.length };
}

/** Density-adaptive "same area" radius derived from nearest-neighbor spacing. */
export function estimateRadius<T>(items: T[], acc: GeoAccessor<T>): number {
  const coords = items.map(acc.coords).filter((c): c is LatLng => normalizeCoords(c) != null);
  if (coords.length < 2) return MIN_CLUSTER_RADIUS_M;

  const nearest: number[] = [];
  for (let i = 0; i < coords.length; i += 1) {
    let min = Number.POSITIVE_INFINITY;
    for (let j = 0; j < coords.length; j += 1) {
      if (i === j) continue;
      const d = distanceMeters(coords[i]!, coords[j]!);
      if (d < min) min = d;
    }
    if (Number.isFinite(min)) nearest.push(min);
  }
  if (!nearest.length) return MIN_CLUSTER_RADIUS_M;
  nearest.sort((a, b) => a - b);
  const p75 = nearest[Math.floor(nearest.length * 0.75)] ?? nearest[nearest.length - 1]!;
  const candidate = p75 * 1.8;
  // Sparse destinations (islands, rural): allow larger same-area radius so east/west
  // places do not each become tiny clusters that later get force-merged across the island.
  const maxCap = p75 > 8_000 ? MAX_SPARSE_CLUSTER_RADIUS_M : MAX_CLUSTER_RADIUS_M;
  return Math.min(maxCap, Math.max(MIN_CLUSTER_RADIUS_M, candidate));
}

type Working<T> = { items: T[]; center: LatLng };

function mergeToFit<T>(working: Working<T>[], days: number, acc: GeoAccessor<T>): void {
  while (working.length > days) {
    let bestI = -1;
    let bestJ = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < working.length; i += 1) {
      for (let j = i + 1; j < working.length; j += 1) {
        const d = distanceMeters(working[i]!.center, working[j]!.center);
        if (d < bestDist) {
          bestDist = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestI < 0 || bestJ < 0) break;
    // Prefer leaving extra geographic clusters over merging opposite sides of a region.
    if (bestDist > MAX_SAME_DAY_CLUSTER_MERGE_M) break;
    const merged = [...working[bestI]!.items, ...working[bestJ]!.items];
    working[bestI] = { items: merged, center: centroid(merged, acc) };
    working.splice(bestJ, 1);
  }
}

function orderByRoute<T>(clusters: GeoClusterOf<T>[], days: number): void {
  if (!clusters.length) return;
  const remaining = [...clusters];
  let current = remaining.shift()!;
  const route = [current];
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const d = distanceMeters(
        { lat: current.centerLatitude, lng: current.centerLongitude },
        { lat: remaining[i]!.centerLatitude, lng: remaining[i]!.centerLongitude },
      );
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    current = remaining.splice(bestIdx, 1)[0]!;
    route.push(current);
  }
  // Spread along the geographic route — avoid dumping leftovers onto the last day.
  route.forEach((cluster, index) => {
    cluster.candidateDay = Math.min(
      days,
      Math.floor((index / Math.max(1, route.length)) * days) + 1,
    );
  });
}

export type ClusterGeographyOptions = {
  radiusMeters?: number;
  /**
   * When true (default), merge clusters down to ≈ tripDays for day allocation.
   * Candidate Pool Geo Diversity should pass false so density clusters stay natural.
   */
  fitToDays?: boolean;
};

/** Generic geographic clustering usable on any place-like item. */
export function clusterItemsByGeography<T>(
  items: T[],
  tripDays: number,
  acc: GeoAccessor<T>,
  opts?: ClusterGeographyOptions,
): { clusters: GeoClusterOf<T>[]; unlocated: T[]; radiusMeters: number } {
  const located: T[] = [];
  const unlocated: T[] = [];
  for (const item of items) {
    if (normalizeCoords(acc.coords(item))) located.push(item);
    else unlocated.push(item);
  }

  const radius = opts?.radiusMeters ?? estimateRadius(located, acc);
  const days = Math.max(1, tripDays);
  const fitToDays = opts?.fitToDays !== false;

  const ordered = [...located].sort((a, b) => acc.weight(b) - acc.weight(a));
  const working: Working<T>[] = [];
  for (const item of ordered) {
    const c = normalizeCoords(acc.coords(item))!;
    let best: Working<T> | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const cluster of working) {
      const d = distanceMeters(c, cluster.center);
      if (d <= radius && d < bestDist) {
        best = cluster;
        bestDist = d;
      }
    }
    if (best) {
      best.items.push(item);
      best.center = centroid(best.items, acc);
    } else {
      working.push({ items: [item], center: c });
    }
  }

  if (fitToDays) {
    mergeToFit(working, days, acc);
  }

  const clusters: GeoClusterOf<T>[] = working
    .map((cluster, index) => {
      const center = centroid(cluster.items, acc);
      const areaName =
        cluster.items.map((i) => extractAreaNameFromAddress(acc.address(i))).find(Boolean) ??
        `區域${index + 1}`;
      return {
        clusterId: `geo_${index + 1}`,
        centerLatitude: center.lat,
        centerLongitude: center.lng,
        areaName,
        ids: cluster.items.map((i) => acc.id(i)),
        items: cluster.items,
      } satisfies GeoClusterOf<T>;
    })
    .sort((a, b) => b.items.length - a.items.length);

  orderByRoute(clusters, days);
  return { clusters, unlocated, radiusMeters: radius };
}

const PLACE_RESULT_ACCESSOR: GeoAccessor<PlaceResult> = {
  coords: placeResultCoords,
  id: (p) => resolveTripPlaceId(p),
  name: (p) => p.name ?? "",
  address: (p) => p.address ?? "",
  weight: (p) => p.userRatingCount ?? 0,
};

/** PlaceResult-typed clustering used by validators and the deterministic planner. */
export function clusterPlacesByGeography(
  places: PlaceResult[],
  tripDays: number,
  opts?: ClusterGeographyOptions,
): GeographicClusteringResult {
  const { clusters, unlocated, radiusMeters } = clusterItemsByGeography(
    places,
    tripDays,
    PLACE_RESULT_ACCESSOR,
    opts,
  );
  const enriched: GeoCluster[] = clusters.map((c) => ({
    ...c,
    placeIds: c.ids,
    places: c.items,
  }));
  for (const cluster of enriched) {
    logAiPipeline(
      "[GEOGRAPHIC_CLUSTER_CREATED]",
      `clusterId=${cluster.clusterId}`,
      `area=${cluster.areaName}`,
      `places=[${cluster.places.map((p) => p.name).join(",")}]`,
    );
  }
  return { clusters: enriched, unlocated, radiusMeters };
}

export type CrossDayValidationEntry = {
  place: PlaceResult;
  day: number;
};

export type CrossDayGeographicValidation = {
  ok: boolean;
  reasons: string[];
  splitClusterCount: number;
};

/**
 * Validate that a day allocation respects geography (§12): no geographic cluster
 * should be split across days without reason.
 */
export function validateCrossDayGeographicAllocation(
  entries: CrossDayValidationEntry[],
  tripDays: number,
): CrossDayGeographicValidation {
  const reasons: string[] = [];
  const dayByPlaceId = new Map<string, number>();
  for (const entry of entries) {
    dayByPlaceId.set(resolveTripPlaceId(entry.place), entry.day);
  }

  const { clusters, radiusMeters } = clusterPlacesByGeography(
    entries.map((e) => e.place),
    tripDays,
  );

  let splitClusterCount = 0;
  for (const cluster of clusters) {
    const days = new Set<number>();
    for (const id of cluster.placeIds) {
      const day = dayByPlaceId.get(id);
      if (day != null) days.add(day);
    }
    if (days.size > 1 && cluster.places.length <= 6) {
      splitClusterCount += 1;
      reasons.push(`cross_day_cluster_split:${cluster.clusterId}:days=${[...days].join(",")}`);
      logAiPipeline(
        "[CROSS_DAY_CLUSTER_SPLIT_DETECTED]",
        `clusterId=${cluster.clusterId}`,
        `days=[${[...days].join(",")}]`,
        `places=[${cluster.places.map((p) => p.name).join(",")}]`,
      );
    }
  }

  const ok = splitClusterCount === 0;
  if (ok) {
    logAiPipeline(
      "[CROSS_DAY_GEOGRAPHIC_VALIDATION_PASSED]",
      `days=${tripDays}`,
      `splitClusterCount=0`,
      `radiusM=${Math.round(radiusMeters)}`,
    );
  }

  return { ok, reasons: [...new Set(reasons)], splitClusterCount };
}
