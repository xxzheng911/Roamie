/**
 * Candidate Pool demand vector — six diversity dimensions, not only days×3.
 */
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import { requiredCanonicalCandidatesForTrip } from "@/lib/ai/canonical-landmark";
import { minCandidatePoolSize } from "@/lib/ai/ai-multi-day-planner";
import type {
  CandidatePoolDemand,
  PoolCategory,
  TemporalSlot,
  TravelIntent,
} from "@/lib/ai/candidate-pool/types";

const TEMPORAL_SLOTS: TemporalSlot[] = [
  "morning",
  "lunch",
  "afternoon",
  "dinner",
  "night",
];

export function buildCandidatePoolDemand(params: {
  days: number;
  style: TripStyleKey;
}): CandidatePoolDemand {
  const days = Math.max(1, params.days);
  const pace = params.style === "slow_nature" ? "slow" : "medium";
  const minCanonical = requiredCanonicalCandidatesForTrip(days, pace);

  // Richer than days×3 so Planner rarely falls back
  const minTotal = Math.max(
    minCandidatePoolSize(days),
    minCanonical + days * 2,
    days * 6,
  );

  const minPerCategory: Partial<Record<PoolCategory, number>> = {
    attraction: Math.max(days, Math.ceil(minCanonical * 0.45)),
    food: days * 2,
    cafe: days,
    shopping: Math.max(1, Math.ceil(days * 0.75)),
    culture: Math.max(1, Math.ceil(days * 0.5)),
    night: Math.max(1, Math.ceil(days * 0.5)),
    nature: params.style === "slow_nature" ? days : Math.max(1, Math.floor(days / 2)),
    market: Math.max(0, Math.floor(days / 3)),
  };

  const minPerTemporal = Object.fromEntries(
    TEMPORAL_SLOTS.map((slot) => {
      if (slot === "lunch" || slot === "dinner") return [slot, days];
      if (slot === "night") return [slot, Math.max(1, Math.ceil(days * 0.75))];
      return [slot, days];
    }),
  ) as Record<TemporalSlot, number>;

  const minPerIntent: Partial<Record<TravelIntent, number>> = {
    view: days,
    culture: Math.max(1, Math.ceil(days * 0.5)),
    food: days * 2,
    shopping: Math.max(1, Math.ceil(days * 0.75)),
    experience: days,
    relax: days,
    night: Math.max(1, Math.ceil(days * 0.75)),
  };

  return {
    days,
    style: params.style,
    minCanonical,
    minTotal,
    minPerCategory,
    minPerTemporal,
    minPerIntent,
    minGeoClusters: Math.min(Math.max(2, days), 8),
    maxExperienceFamilyShare: 0.28,
    maxGeoClusterShare: 0.34,
  };
}
