/**
 * Experience Optimizer — avoid Temple→Temple→Temple inventory dominance.
 * Adjusts Candidate Pool composition; does not schedule routes.
 */
import type { PlaceResult } from "@/lib/place-result";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { annotatePlaces } from "@/lib/ai/candidate-pool/annotate";
import type {
  CandidatePoolDemand,
  ExperienceFamily,
} from "@/lib/ai/candidate-pool/types";

/** Families that feel repetitive when over-represented */
const CAP_FAMILIES: ExperienceFamily[] = [
  "temple_heritage",
  "museum_gallery",
  "generic",
];

export function applyExperienceOptimizer(
  places: PlaceResult[],
  demand: CandidatePoolDemand,
): PlaceResult[] {
  if (places.length < 8) return places;

  const annotated = annotatePlaces(places);
  const total = annotated.length;
  const maxShare = demand.maxExperienceFamilyShare;
  const maxCount = Math.max(2, Math.floor(total * maxShare));

  const keptCounts = new Map<ExperienceFamily, number>();
  const kept: PlaceResult[] = [];
  let trimmed = 0;

  // Prefer higher review counts when trimming same family
  const ordered = [...annotated].sort(
    (a, b) =>
      (b.place.userRatingCount ?? 0) - (a.place.userRatingCount ?? 0) ||
      (b.place.rating ?? 0) - (a.place.rating ?? 0),
  );

  for (const item of ordered) {
    const family = item.experienceFamily;
    const count = keptCounts.get(family) ?? 0;
    if (CAP_FAMILIES.includes(family) && count >= maxCount) {
      trimmed += 1;
      continue;
    }
    // Soft cap for any family
    if (count >= Math.max(maxCount + 1, Math.floor(total * 0.36))) {
      trimmed += 1;
      continue;
    }
    keptCounts.set(family, count + 1);
    kept.push(item.place);
  }

  // Preserve original relative order among kept
  const keptIds = new Set(kept.map((p) => p.id).filter(Boolean));
  const orderedKept = places.filter((p) => p.id && keptIds.has(p.id));

  const byFamily = [...keptCounts.entries()]
    .map(([k, n]) => `${k}:${n}`)
    .join("|");

  logAiPipeline(
    "[CANDIDATE_POOL_EXPERIENCE]",
    `in=${places.length}`,
    `out=${orderedKept.length}`,
    `trimmed=${trimmed}`,
    `maxShare=${maxShare}`,
    `byFamily=${byFamily || "none"}`,
  );

  // Always keep the diversified inventory when we still have a usable floor.
  // Do not restore temple-dominated pools just because total < minTotal.
  const minKeep = Math.max(demand.days * 2, 4);
  if (orderedKept.length >= minKeep) return orderedKept;
  if (orderedKept.length > 0 && trimmed > 0) return orderedKept;
  return places;
}
