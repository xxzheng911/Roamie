import {
  normalizeProfileWeights,
  type ProfileWeights,
  type WeightFactorKey,
} from "@/lib/recommendation/engine/profiles";
import type {
  PreferenceSignal,
  WeightSuggestion,
} from "@/lib/recommendation/engine/signals/types";
import type { RecommendationCandidate } from "@/lib/recommendation/engine/types";

/**
 * 合併 Profile 基礎權重與 Weight Suggestions，再正規化。
 * Memory/DNA 只透過 suggestion 影響權重，不直接排序。
 */
export function mergeWeightsWithSuggestions(
  base: ProfileWeights,
  suggestions: readonly WeightSuggestion[],
): ProfileWeights {
  const merged: ProfileWeights = { ...base };
  for (const s of suggestions) {
    for (const [key, delta] of Object.entries(s.weightDeltas ?? {}) as [
      WeightFactorKey,
      number,
    ][]) {
      if (typeof delta !== "number" || !Number.isFinite(delta)) continue;
      merged[key] = (merged[key] ?? 0) + delta;
    }
  }
  return normalizeProfileWeights(merged);
}

function placeBlob(candidate: RecommendationCandidate): string {
  return [candidate.name, candidate.primaryType, ...(candidate.types ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * 將 Preference Signal 轉成 0–1 factor 分數（memory / dna 各一）。
 */
export function preferenceFactorScores(
  candidate: RecommendationCandidate,
  signals: readonly PreferenceSignal[],
): { memory: number; dna: number } {
  let memory = 0;
  let dna = 0;
  const blob = placeBlob(candidate);
  const types = new Set(
    [candidate.primaryType, ...(candidate.types ?? [])]
      .map((t) => (t ?? "").toLowerCase().trim())
      .filter(Boolean),
  );

  for (const signal of signals) {
    let best = 0;
    for (const [typeKey, boost] of Object.entries(signal.typeBoosts ?? {})) {
      const k = typeKey.toLowerCase();
      if (types.has(k) || [...types].some((t) => t.includes(k) || k.includes(t))) {
        best = Math.max(best, Math.min(1, boost));
      }
    }
    for (const [label, boost] of Object.entries(signal.labelBoosts ?? {})) {
      if (blob.includes(label.toLowerCase())) {
        best = Math.max(best, Math.min(1, boost));
      }
    }
    if (signal.source === "memory") memory = Math.max(memory, best);
    if (signal.source === "dna") dna = Math.max(dna, best);
  }

  return { memory, dna };
}
