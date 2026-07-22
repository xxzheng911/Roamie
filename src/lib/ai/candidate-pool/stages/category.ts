/**
 * Category Diversity — ensure attraction/food/cafe/shopping/…
 * Reuses style-candidate-diversity helpers (no city-specific rules).
 */
import type { PlaceResult } from "@/lib/place-result";
import type { PlanPlaceKind } from "@/lib/ai/ai-day-plan-source";
import {
  countPlacesByPlanKind,
  underrepresentedKinds,
  STYLE_DIVERSITY_KINDS,
  resolveStyleSearchKinds,
} from "@/lib/ai/style-candidate-diversity";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { classifyPoolCategory } from "@/lib/ai/candidate-pool/classify";
import type {
  CandidatePoolDemand,
  PoolCategory,
} from "@/lib/ai/candidate-pool/types";

const POOL_TO_KINDS: Record<PoolCategory, PlanPlaceKind[]> = {
  attraction: ["attraction"],
  food: ["restaurant"],
  cafe: ["cafe"],
  shopping: ["shopping"],
  culture: ["culture"],
  night: ["night_market"],
  nature: ["nature"],
  market: ["market", "night_market"],
};

export function countByPoolCategory(
  places: PlaceResult[],
): Partial<Record<PoolCategory, number>> {
  const out: Partial<Record<PoolCategory, number>> = {};
  for (const place of places) {
    const c = classifyPoolCategory(place);
    out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

export function underrepresentedCategories(
  places: PlaceResult[],
  demand: CandidatePoolDemand,
): PlanPlaceKind[] {
  const counts = countByPoolCategory(places);
  const weakKinds: PlanPlaceKind[] = [];
  const seen = new Set<PlanPlaceKind>();

  for (const [category, min] of Object.entries(demand.minPerCategory) as [
    PoolCategory,
    number | undefined,
  ][]) {
    if (min == null || min <= 0) continue;
    if ((counts[category] ?? 0) >= min) continue;
    for (const kind of POOL_TO_KINDS[category] ?? []) {
      if (seen.has(kind)) continue;
      seen.add(kind);
      weakKinds.push(kind);
    }
  }

  // Also use plan-kind underrepresentation for multi-day
  const styleKinds = resolveStyleSearchKinds(demand.style, demand.days);
  const minPerKind = Math.max(
    2,
    Math.ceil(demand.minCanonical / Math.max(STYLE_DIVERSITY_KINDS.length, 1)),
  );
  for (const kind of underrepresentedKinds(places, styleKinds, minPerKind)) {
    if (!seen.has(kind)) {
      seen.add(kind);
      weakKinds.push(kind);
    }
  }

  return weakKinds;
}

export function logCategoryStage(
  places: PlaceResult[],
  demand: CandidatePoolDemand,
  weak: PlanPlaceKind[],
): void {
  const byKind = countPlacesByPlanKind(places);
  const byCat = countByPoolCategory(places);
  logAiPipeline(
    "[CANDIDATE_POOL_CATEGORY]",
    `style=${demand.style}`,
    `days=${demand.days}`,
    `total=${places.length}`,
    `byCategory=${Object.entries(byCat)
      .map(([k, n]) => `${k}:${n}`)
      .join("|")}`,
    `byKind=${Object.entries(byKind)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}:${n}`)
      .join("|")}`,
    `weakKinds=[${weak.join(",") || "none"}]`,
  );
}

export function resolveSearchKindsForStyle(
  style: TripStyleKey,
  days: number,
): PlanPlaceKind[] {
  return resolveStyleSearchKinds(style, days);
}
