import type { ScoredCandidate } from "@/lib/recommendation/engine/types";

/**
 * rank — 依分數降冪排序。
 * 同分時保持既有相對順序（穩定 sort）。
 */
export function rankScoredCandidates(
  scored: readonly ScoredCandidate[],
): ScoredCandidate[] {
  return scored
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (b.item.score !== a.item.score) return b.item.score - a.item.score;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
