/**
 * Travel Flow — Travel Intent coverage for a natural day rhythm.
 * Does NOT compute routes; only ensures pool has View / Culture / Food / …
 */
import type { PlaceResult } from "@/lib/place-result";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { annotatePlaces } from "@/lib/ai/candidate-pool/annotate";
import type {
  CandidatePoolDemand,
  TravelIntent,
} from "@/lib/ai/candidate-pool/types";
import type { PlanPlaceKind } from "@/lib/ai/ai-day-plan-source";

const INTENTS: TravelIntent[] = [
  "view",
  "culture",
  "food",
  "shopping",
  "experience",
  "relax",
  "night",
];

export function countByTravelIntent(
  places: PlaceResult[],
): Record<TravelIntent, number> {
  const annotated = annotatePlaces(places);
  const counts = Object.fromEntries(INTENTS.map((i) => [i, 0])) as Record<
    TravelIntent,
    number
  >;
  for (const item of annotated) {
    counts[item.travelIntent] += 1;
  }
  return counts;
}

export function underrepresentedIntents(
  places: PlaceResult[],
  demand: CandidatePoolDemand,
): TravelIntent[] {
  const counts = countByTravelIntent(places);
  return INTENTS.filter(
    (intent) => (counts[intent] ?? 0) < (demand.minPerIntent[intent] ?? 0),
  );
}

export function kindsForTravelIntent(intent: TravelIntent): PlanPlaceKind[] {
  switch (intent) {
    case "view":
      return ["attraction", "nature"];
    case "culture":
      return ["culture", "attraction"];
    case "food":
      return ["restaurant", "market"];
    case "shopping":
      return ["shopping", "market"];
    case "experience":
      return ["attraction", "culture", "nature"];
    case "relax":
      return ["cafe", "nature"];
    case "night":
      return ["night_market", "restaurant", "attraction"];
    default:
      return ["attraction"];
  }
}

export function applyTravelFlow(
  places: PlaceResult[],
  demand: CandidatePoolDemand,
): { places: PlaceResult[]; weakIntents: TravelIntent[] } {
  const counts = countByTravelIntent(places);
  const weakIntents = underrepresentedIntents(places, demand);

  logAiPipeline(
    "[CANDIDATE_POOL_FLOW]",
    `byIntent=${INTENTS.map((i) => `${i}:${counts[i]}`).join("|")}`,
    `weak=[${weakIntents.join(",") || "none"}]`,
    `total=${places.length}`,
  );

  return { places, weakIntents };
}
