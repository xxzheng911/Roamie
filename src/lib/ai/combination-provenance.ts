/**
 * Multi-combination provenance: union merge, never overwrite with a single id.
 */
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export type CombinationProvenanceFields = {
  sourceCombinationId?: number;
  sourceCombinationIds?: number[];
  matchedCombinationIds?: number[];
  matchedSelectedCombinationIds?: number[];
};

function uniqSortedIds(ids: Iterable<number | undefined | null>): number[] {
  const set = new Set<number>();
  for (const id of ids) {
    if (id == null || !Number.isFinite(id) || id <= 0) continue;
    set.add(Math.trunc(id));
  }
  return [...set].sort((a, b) => a - b);
}

/** Collect every combination id present on a place (all legacy + array fields). */
export function combinationIdsFromPlace(place: CombinationProvenanceFields): number[] {
  return uniqSortedIds([
    ...(place.sourceCombinationIds ?? []),
    ...(place.matchedSelectedCombinationIds ?? []),
    ...(place.matchedCombinationIds ?? []),
    place.sourceCombinationId,
  ]);
}

/**
 * Union-merge provenance from multiple sources onto a representative place.
 * Always populates array fields; keeps sourceCombinationId as the first id for legacy readers.
 */
export function mergeCombinationProvenance<T extends CombinationProvenanceFields>(
  place: T,
  ...extraIdSets: Array<number[] | number | undefined | null>
): T {
  const merged = uniqSortedIds([
    ...combinationIdsFromPlace(place),
    ...extraIdSets.flatMap((entry) =>
      entry == null ? [] : Array.isArray(entry) ? entry : [entry],
    ),
  ]);
  if (!merged.length) return place;
  return {
    ...place,
    sourceCombinationIds: merged,
    matchedCombinationIds: uniqSortedIds([
      ...(place.matchedCombinationIds ?? []),
      ...merged,
    ]),
    matchedSelectedCombinationIds: merged,
    sourceCombinationId: place.sourceCombinationId ?? merged[0],
  };
}

/** Merge two places' provenance (for dedupe). */
export function mergePlaceProvenance<T extends CombinationProvenanceFields>(
  representative: T,
  other: T,
  opts?: { representativeName?: string; otherName?: string },
): T {
  const before = combinationIdsFromPlace(representative);
  const merged = mergeCombinationProvenance(
    representative,
    combinationIdsFromPlace(other),
  );
  const after = combinationIdsFromPlace(merged);
  if (after.length > before.length) {
    logAiPipeline(
      "[DEDUPED_PLACE_SOURCE_MERGED]",
      `representative=${opts?.representativeName ?? "place"}`,
      `mergedCandidates=[${opts?.otherName ?? "other"}]`,
      `sourceCombinationIds=[${after.join(",")}]`,
    );
    logAiPipeline(
      "[COMBINATION_SOURCE_MERGE_STATS]",
      `place=${opts?.representativeName ?? "place"}`,
      `sourceCombinationIds=[${after.join(",")}]`,
    );
  }
  return merged;
}
