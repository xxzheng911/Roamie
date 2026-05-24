import type { RoamieResponse } from "@/lib/ai/types";
import { normalizePlaceName } from "@/lib/recommendation/place-mapping";
import type { VerifiedPlaceCandidate } from "@/lib/recommendation/types";

function fuzzyNameMatch(a: string, b: string): boolean {
  const na = normalizePlaceName(a);
  const nb = normalizePlaceName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function findCandidate(
  aiName: string,
  candidates: VerifiedPlaceCandidate[],
): VerifiedPlaceCandidate | undefined {
  const exact = candidates.find((c) => normalizePlaceName(c.name) === normalizePlaceName(aiName));
  if (exact) return exact;
  return candidates.find((c) => fuzzyNameMatch(c.name, aiName));
}

/**
 * AI 只能排序／解釋 — 合併回已驗證的 Google Places 候選，捨棄虛構地點
 */
export function mergeAiWithVerifiedCandidates(
  ai: RoamieResponse,
  candidates: VerifiedPlaceCandidate[],
  options?: { minCount?: number; maxCount?: number },
): RoamieResponse {
  const minCount = options?.minCount ?? 3;
  const maxCount = options?.maxCount ?? 5;
  const usedIds = new Set<string>();
  const merged: VerifiedPlaceCandidate[] = [];

  for (const item of ai.recommendations ?? []) {
    const match = findCandidate(item.name, candidates);
    if (!match || usedIds.has(match.googlePlaceId)) continue;
    usedIds.add(match.googlePlaceId);
    merged.push({
      ...match,
      description: item.description?.trim() || match.description,
      reason: item.reason?.trim() || match.reason,
      estimatedTime: item.estimatedTime?.trim() || match.estimatedTime,
      reasonSource: "ai",
      googlePlaceId: match.googlePlaceId,
      photoName: match.photoName,
      rating: match.rating,
      userRatingCount: match.userRatingCount,
    });
    if (merged.length >= maxCount) break;
  }

  if (merged.length < minCount) {
    for (const c of candidates) {
      if (usedIds.has(c.googlePlaceId)) continue;
      usedIds.add(c.googlePlaceId);
      merged.push(c);
      if (merged.length >= minCount) break;
    }
  }

  return {
    ...ai,
    recommendations: merged.slice(0, maxCount),
  };
}
