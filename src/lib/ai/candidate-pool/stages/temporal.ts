/**
 * Temporal Diversity — Morning / Lunch / Afternoon / Dinner / Night
 * + soft business-hours awareness (type-based; full hours checked in Planner).
 */
import type { PlaceResult } from "@/lib/place-result";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { annotatePlaces } from "@/lib/ai/candidate-pool/annotate";
import type {
  CandidatePoolDemand,
  TemporalSlot,
} from "@/lib/ai/candidate-pool/types";
import { classifyPoolCategory } from "@/lib/ai/candidate-pool/classify";
import type { PlanPlaceKind } from "@/lib/ai/ai-day-plan-source";

const TEMPORAL_SLOTS: TemporalSlot[] = [
  "morning",
  "lunch",
  "afternoon",
  "dinner",
  "night",
];

export function countByTemporal(
  places: PlaceResult[],
): Record<TemporalSlot, number> {
  const annotated = annotatePlaces(places);
  const counts = Object.fromEntries(
    TEMPORAL_SLOTS.map((s) => [s, 0]),
  ) as Record<TemporalSlot, number>;
  for (const item of annotated) {
    for (const slot of item.temporalSlots) {
      counts[slot] += 1;
    }
  }
  return counts;
}

export function underrepresentedTemporalSlots(
  places: PlaceResult[],
  demand: CandidatePoolDemand,
): TemporalSlot[] {
  const counts = countByTemporal(places);
  return TEMPORAL_SLOTS.filter(
    (slot) => (counts[slot] ?? 0) < (demand.minPerTemporal[slot] ?? 0),
  );
}

/** Map temporal gap → search kinds to fill (not route logic). */
export function kindsForTemporalSlot(slot: TemporalSlot): PlanPlaceKind[] {
  switch (slot) {
    case "morning":
      return ["attraction", "culture", "cafe", "nature"];
    case "lunch":
      return ["restaurant", "market"];
    case "afternoon":
      return ["attraction", "shopping", "cafe", "culture", "nature"];
    case "dinner":
      return ["restaurant"];
    case "night":
      return ["night_market", "attraction", "restaurant"];
    default:
      return ["attraction"];
  }
}

/**
 * Drop places that are hard temporal mismatches for ALL of their tagged slots
 * when pool is rich enough — keeps soft tagging otherwise.
 */
export function applyTemporalDiversity(
  places: PlaceResult[],
  demand: CandidatePoolDemand,
): PlaceResult[] {
  const counts = countByTemporal(places);
  const weak = underrepresentedTemporalSlots(places, demand);

  logAiPipeline(
    "[CANDIDATE_POOL_TEMPORAL]",
    `bySlot=${TEMPORAL_SLOTS.map((s) => `${s}:${counts[s]}`).join("|")}`,
    `weak=[${weak.join(",") || "none"}]`,
    `total=${places.length}`,
  );

  // Cap night-incompatible cafe domination is handled in Experience;
  // here we only report + return unchanged inventory for expand stage.
  return places;
}

export function categoryGapsHint(places: PlaceResult[]): string {
  const by: Record<string, number> = {};
  for (const p of places) {
    const c = classifyPoolCategory(p);
    by[c] = (by[c] ?? 0) + 1;
  }
  return Object.entries(by)
    .map(([k, n]) => `${k}:${n}`)
    .join("|");
}
