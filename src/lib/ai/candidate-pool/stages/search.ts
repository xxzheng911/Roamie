/**
 * Places Search for Candidate Pool — Category × Query Diversity.
 * Geo bias uses density-cluster centroids after seed (never fixed city hubs).
 */
import type { PlaceResult } from "@/lib/place-result";
import type { PlanPlaceKind } from "@/lib/ai/ai-day-plan-source";
import { kindsForStyle } from "@/lib/ai/ai-day-plan-source";
import {
  STYLE_PER_QUERY_KEEP,
  buildAttemptsForStyleKind,
} from "@/lib/ai/style-candidate-diversity";
import { dedupeCandidatePlaces } from "@/lib/ai/ai-multi-day-planner";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { shouldSkipPlanningPlacesApi } from "@/lib/ai/planning-candidate-pool";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import type { CandidatePoolSearchFn } from "@/lib/ai/candidate-pool/types";
import {
  GEO_CLUSTER_SEARCH_RADIUS_M,
  buildGeoClustersFromPlaces,
  pickNextClusterBias,
} from "@/lib/ai/candidate-pool/stages/geo";
import {
  resolveSearchKindsForStyle,
  underrepresentedCategories,
} from "@/lib/ai/candidate-pool/stages/category";
import { buildCandidatePoolDemand } from "@/lib/ai/candidate-pool/demand";

export type SeedSearchParams = {
  destination: string;
  lat: number;
  lng: number;
  style: TripStyleKey;
  days: number;
  search: CandidatePoolSearchFn;
  seedPlaces?: PlaceResult[];
};

export async function runCategoryQuerySearch(
  params: SeedSearchParams,
): Promise<{ places: PlaceResult[]; searchRequestCount: number }> {
  const { destination, lat, lng, style, days, search } = params;
  let collected = dedupeCandidatePlaces(params.seedPlaces ?? []);
  let searchRequestCount = 0;
  let geoRound = 0;

  const primaryKinds =
    style === "classic_landmarks"
      ? kindsForStyle(style).filter((k) => k !== "attraction")
      : kindsForStyle(style);
  const diversityKinds = resolveSearchKindsForStyle(style, days);

  const fetchKinds = async (
    kinds: PlanPlaceKind[],
    phase: string,
  ): Promise<void> => {
    for (const kind of kinds) {
      if (shouldSkipPlanningPlacesApi()) break;
      const attempts = buildAttemptsForStyleKind(destination, kind);
      let kindKept = 0;

      // Refresh clusters for bias after we have enough points
      const { clusters } =
        collected.filter((p) => p.lat != null && p.lng != null).length >= 4
          ? buildGeoClustersFromPlaces(collected, days)
          : { clusters: [] };

      for (const attempt of attempts) {
        if (shouldSkipPlanningPlacesApi()) break;
        const bias = pickNextClusterBias({
          clusters,
          roundIndex: geoRound,
          maxShare: 0.34,
          fallback: { lat, lng },
        });
        geoRound += 1;

        searchRequestCount += 1;
        const batch = await search({
          attempt,
          kind,
          lat: bias.lat,
          lng: bias.lng,
          radiusM:
            bias.clusterId != null ? GEO_CLUSTER_SEARCH_RADIUS_M : undefined,
          phase: `${phase}.${kind}${bias.clusterId ? `.${bias.clusterId}` : ""}`,
        });
        const kept = batch.slice(0, STYLE_PER_QUERY_KEEP);
        kindKept += kept.length;
        collected = dedupeCandidatePlaces([...collected, ...kept]);

        logAiPipeline(
          "[CANDIDATE_POOL_SEARCH_QUERY]",
          `style=${style}`,
          `kind=${kind}`,
          `phase=${phase}`,
          `geo=${bias.areaName}`,
          `query=${attempt.query}`,
          `returned=${batch.length}`,
          `kept=${kept.length}`,
          `collected=${collected.length}`,
        );
      }

      logAiPipeline(
        "[CANDIDATE_POOL_SEARCH_KIND]",
        `style=${style}`,
        `phase=${phase}`,
        `kind=${kind}`,
        `queries=${attempts.length}`,
        `kept=${kindKept}`,
        `collected=${collected.length}`,
      );
    }
  };

  if (!shouldSkipPlanningPlacesApi()) {
    await fetchKinds(primaryKinds, "primary");
  }

  // Category diversity expand
  if (!shouldSkipPlanningPlacesApi()) {
    const demand = buildCandidatePoolDemand({ days, style });
    const weak = underrepresentedCategories(collected, demand);
    if (weak.length) {
      logAiPipeline(
        "[CANDIDATE_POOL_CATEGORY_EXPAND]",
        `weakKinds=[${weak.join(",")}]`,
      );
      await fetchKinds(weak, "category_expand");
    } else if (days >= 3) {
      // Ensure diversity kinds were touched
      const extra = diversityKinds.filter((k) => !primaryKinds.includes(k));
      if (extra.length) await fetchKinds(extra.slice(0, 4), "diversity");
    }
  }

  return { places: collected, searchRequestCount };
}

export async function expandByGeoClusters(params: {
  places: PlaceResult[];
  destination: string;
  lat: number;
  lng: number;
  days: number;
  style: TripStyleKey;
  search: CandidatePoolSearchFn;
  maxExpands?: number;
}): Promise<{ places: PlaceResult[]; searchRequestCount: number }> {
  let collected = dedupeCandidatePlaces(params.places);
  let searchRequestCount = 0;
  const { clusters } = buildGeoClustersFromPlaces(collected, params.days);
  const weak = [...clusters].sort((a, b) => a.count - b.count).slice(0, params.maxExpands ?? 4);

  if (!weak.length || shouldSkipPlanningPlacesApi()) {
    return { places: collected, searchRequestCount };
  }

  logAiPipeline(
    "[CANDIDATE_POOL_GEO_EXPAND]",
    `weak=[${weak.map((c) => c.areaName || c.clusterId).join(",")}]`,
  );

  for (const cluster of weak) {
    if (shouldSkipPlanningPlacesApi()) break;
    for (const kind of ["attraction", "restaurant", "cafe"] as PlanPlaceKind[]) {
      if (shouldSkipPlanningPlacesApi()) break;
      const attempts = buildAttemptsForStyleKind(params.destination, kind).slice(
        0,
        2,
      );
      for (const attempt of attempts) {
        searchRequestCount += 1;
        const batch = await params.search({
          attempt,
          kind,
          lat: cluster.centerLat,
          lng: cluster.centerLng,
          radiusM: GEO_CLUSTER_SEARCH_RADIUS_M,
          phase: `geo_expand.${cluster.clusterId}.${kind}`,
        });
        collected = dedupeCandidatePlaces([
          ...collected,
          ...batch.slice(0, STYLE_PER_QUERY_KEEP),
        ]);
      }
    }
  }

  return { places: collected, searchRequestCount };
}

export async function expandByKinds(params: {
  places: PlaceResult[];
  destination: string;
  lat: number;
  lng: number;
  days: number;
  kinds: PlanPlaceKind[];
  phase: string;
  search: CandidatePoolSearchFn;
}): Promise<{ places: PlaceResult[]; searchRequestCount: number }> {
  let collected = dedupeCandidatePlaces(params.places);
  let searchRequestCount = 0;
  if (!params.kinds.length || shouldSkipPlanningPlacesApi()) {
    return { places: collected, searchRequestCount };
  }

  const { clusters } = buildGeoClustersFromPlaces(collected, params.days);
  let geoRound = 0;

  for (const kind of params.kinds) {
    if (shouldSkipPlanningPlacesApi()) break;
    const attempts = buildAttemptsForStyleKind(params.destination, kind);
    for (const attempt of attempts) {
      if (shouldSkipPlanningPlacesApi()) break;
      const bias = pickNextClusterBias({
        clusters,
        roundIndex: geoRound,
        maxShare: 0.34,
        fallback: { lat: params.lat, lng: params.lng },
      });
      geoRound += 1;
      searchRequestCount += 1;
      const batch = await params.search({
        attempt,
        kind,
        lat: bias.lat,
        lng: bias.lng,
        radiusM: bias.clusterId != null ? GEO_CLUSTER_SEARCH_RADIUS_M : undefined,
        phase: `${params.phase}.${kind}`,
      });
      collected = dedupeCandidatePlaces([
        ...collected,
        ...batch.slice(0, STYLE_PER_QUERY_KEEP),
      ]);
    }
  }

  return { places: collected, searchRequestCount };
}
