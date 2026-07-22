/**
 * Geo Clustering — density clusters from coordinates.
 * No destination-travel-profile.districts / KNOWN_HUB_CENTERS.
 */
import type { PlaceResult } from "@/lib/place-result";
import { clusterPlacesByGeography } from "@/lib/ai/geographic-clustering";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { CandidatePoolDemand, PoolGeoCluster } from "@/lib/ai/candidate-pool/types";

export const GEO_CLUSTER_SEARCH_RADIUS_M = 3_200;

export function buildGeoClustersFromPlaces(
  places: PlaceResult[],
  days: number,
): { clusters: PoolGeoCluster[]; radiusMeters: number } {
  const { clusters: raw, radiusMeters } = clusterPlacesByGeography(places, days, {
    fitToDays: false,
  });
  const total = Math.max(1, places.filter((p) => p.lat != null && p.lng != null).length);
  const clusters: PoolGeoCluster[] = raw.map((c) => ({
    clusterId: c.clusterId,
    centerLat: c.centerLatitude,
    centerLng: c.centerLongitude,
    areaName: c.areaName,
    placeIds: c.placeIds,
    count: c.places.length,
    share: c.places.length / total,
  }));

  logAiPipeline(
    "[CANDIDATE_POOL_GEO]",
    `clusters=${clusters.length}`,
    `radiusM=${Math.round(radiusMeters)}`,
    `byCluster=${clusters
      .map((c) => `${c.areaName || c.clusterId}:${c.count}`)
      .join("|") || "none"}`,
  );

  return { clusters, radiusMeters };
}

export function saturatedGeoClusters(
  clusters: PoolGeoCluster[],
  maxShare: number,
): PoolGeoCluster[] {
  if (clusters.length < 2) return [];
  const dynamicCap = Math.max(maxShare, 1 / clusters.length);
  return clusters.filter((c) => c.share >= dynamicCap);
}

export function underrepresentedGeoClusters(
  clusters: PoolGeoCluster[],
  demand: CandidatePoolDemand,
  minPerCluster = 2,
): PoolGeoCluster[] {
  if (clusters.length < demand.minGeoClusters) {
    // Prefer smaller clusters for expand bias (need more members nearby)
    return [...clusters].sort((a, b) => a.count - b.count).slice(0, 4);
  }
  return clusters.filter((c) => c.count < minPerCluster);
}

/** Pick next search bias from unsaturated density clusters (round-robin). */
export function pickNextClusterBias(params: {
  clusters: PoolGeoCluster[];
  roundIndex: number;
  maxShare: number;
  fallback: { lat: number; lng: number };
}): { lat: number; lng: number; clusterId: string | null; areaName: string } {
  const { clusters, roundIndex, maxShare, fallback } = params;
  if (!clusters.length) {
    return { ...fallback, clusterId: null, areaName: "city" };
  }
  const saturated = new Set(
    saturatedGeoClusters(clusters, maxShare).map((c) => c.clusterId),
  );
  const pool = clusters.filter((c) => !saturated.has(c.clusterId));
  const use = pool.length ? pool : clusters;
  const picked = use[roundIndex % use.length]!;
  return {
    lat: picked.centerLat,
    lng: picked.centerLng,
    clusterId: picked.clusterId,
    areaName: picked.areaName || picked.clusterId,
  };
}
