import type { PlaceResult } from "@/lib/place-result";
import { classifyPlanPlaceKind } from "@/lib/ai/ai-day-plan-source";
import {
  classifyExperienceFamily,
  classifyPoolCategory,
  classifyTemporalSlots,
  classifyTravelIntent,
} from "@/lib/ai/candidate-pool/classify";
import type {
  AnnotatedPoolPlace,
  CandidatePoolStats,
  ExperienceFamily,
  PoolCategory,
  PoolGeoCluster,
  TemporalSlot,
  TravelIntent,
  CandidatePoolStageName,
} from "@/lib/ai/candidate-pool/types";
import {
  countUniqueCanonicalLandmarks,
} from "@/lib/ai/canonical-landmark";

export function annotatePlaces(
  places: PlaceResult[],
  clusterByPlaceId?: Map<string, string>,
): AnnotatedPoolPlace[] {
  return places.map((place) => {
    const planKind = classifyPlanPlaceKind(place);
    return {
      place,
      category: classifyPoolCategory(place),
      planKind,
      temporalSlots: classifyTemporalSlots(place),
      travelIntent: classifyTravelIntent(place),
      experienceFamily: classifyExperienceFamily(place),
      geoClusterId: place.id
        ? (clusterByPlaceId?.get(place.id) ?? null)
        : null,
      qualityPassed: true,
    };
  });
}

export function buildPoolStats(
  stage: CandidatePoolStageName,
  annotated: AnnotatedPoolPlace[],
  rejectedByQuality = 0,
  geoClusters = 0,
): CandidatePoolStats {
  const byCategory: Partial<Record<PoolCategory, number>> = {};
  const byTemporal: Partial<Record<TemporalSlot, number>> = {};
  const byIntent: Partial<Record<TravelIntent, number>> = {};
  const byExperience: Partial<Record<ExperienceFamily, number>> = {};

  for (const item of annotated) {
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
    byIntent[item.travelIntent] = (byIntent[item.travelIntent] ?? 0) + 1;
    byExperience[item.experienceFamily] =
      (byExperience[item.experienceFamily] ?? 0) + 1;
    for (const slot of item.temporalSlots) {
      byTemporal[slot] = (byTemporal[slot] ?? 0) + 1;
    }
  }

  return {
    stage,
    total: annotated.length,
    canonicalCount: countUniqueCanonicalLandmarks(
      annotated.map((a) => a.place),
    ),
    byCategory,
    byTemporal,
    byIntent,
    byExperience,
    geoClusters,
    rejectedByQuality,
  };
}

export function clustersToMap(
  clusters: PoolGeoCluster[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of clusters) {
    for (const id of c.placeIds) map.set(id, c.clusterId);
  }
  return map;
}
