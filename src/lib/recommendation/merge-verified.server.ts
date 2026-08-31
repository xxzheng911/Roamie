import type { RoamieResponse } from "@/lib/ai/types";
import { normalizePlaceName } from "@/lib/recommendation/place-mapping";
import type { VerifiedPlaceCandidate } from "@/lib/recommendation/types";
import { assignDiversePlaceReasons } from "@/lib/place-reason-diversity";
import { devVerboseInfo } from "@/lib/dev-verbose-log";

export type PersonalityClaimCategory = "quiet" | "crowd" | "dwell" | "price";

const PERSONALITY_CLAIM_RULES: Array<{
  category: PersonalityClaimCategory;
  evidence: NonNullable<VerifiedPlaceCandidate["sourcePlace"]["reasonClaimEvidence"]>[number];
  patterns: RegExp[];
}> = [
  { category: "quiet", evidence: "quiet_ambience", patterns: [/這(?:裡|邊|間).{0,6}安靜/u, /(?:is|feels|stays)\s+quiet\b/i, /静か(?:な|です|で)/u, /조용(?:한|해|합니다)/u] },
  { category: "crowd", evidence: "low_crowd", patterns: [/人少|人潮少|不擁擠|避開人潮/u, /(?:not crowded|fewer crowds?|uncrowded)/i, /混雑しにくい|人が少ない/u, /붐비지 않|사람이 적/u] },
  { category: "dwell", evidence: "seating_dwell", patterns: [/適合久坐|可以久坐|適合待很久/u, /(?:good|ideal|suitable)\s+(?:for\s+)?(?:a\s+)?long\s+(?:stay|sit)/i, /長居しやすい/u, /오래 머물기 좋/u] },
  { category: "price", evidence: "price", patterns: [/價格親民|價錢親民|很省錢|便宜|預算友善/u, /(?:affordable|budget[- ]friendly|inexpensive|cheap)\b/i, /手頃|安い/u, /가성비|저렴/u] },
];

export function validateAiPersonalityClaims(
  reason: string,
  place: VerifiedPlaceCandidate["sourcePlace"],
): { valid: boolean; rejectedClaim: PersonalityClaimCategory | "" } {
  const available = new Set(place.reasonClaimEvidence ?? []);
  for (const rule of PERSONALITY_CLAIM_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(reason)) && !available.has(rule.evidence)) {
      return { valid: false, rejectedClaim: rule.category };
    }
  }
  return { valid: true, rejectedClaim: "" };
}

function categoryIntentFromCandidate(candidate: VerifiedPlaceCandidate): string | undefined {
  if (candidate.categoryId === "coffee") return "cafe";
  if (candidate.categoryId === "food") return "restaurant";
  if (["sight", "park", "walking"].includes(candidate.categoryId)) return "attraction";
  if (candidate.categoryId === "district") return "shopping";
  if (["indoor", "rainy"].includes(candidate.categoryId)) return "indoor";
  if (candidate.categoryId === "night") return "bar";
  return undefined;
}

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
  options?: {
    minCount?: number;
    maxCount?: number;
    profileTier?: "free" | "plus";
    profileOnboarded?: boolean;
  },
): RoamieResponse {
  const minCount = options?.minCount ?? 3;
  const maxCount = options?.maxCount ?? 5;
  const usedIds = new Set<string>();
  const merged: VerifiedPlaceCandidate[] = [];
  const evidenceFallbacks = new Map(
    assignDiversePlaceReasons(
      candidates.map((candidate) => ({
        place: candidate.sourcePlace,
        context: { categoryIntent: categoryIntentFromCandidate(candidate) },
      })),
    ).map((resolved) => [resolved.placeId, resolved] as const),
  );

  const withEvidenceFallback = (candidate: VerifiedPlaceCandidate): VerifiedPlaceCandidate => {
    const resolved = evidenceFallbacks.get(candidate.sourcePlace.id);
    if (!resolved) return candidate;
    return {
      ...candidate,
      reason: resolved.reason,
      reasonSource: resolved.evidenceCode === "grounded_neutral" ? "fallback" : "evidence",
    };
  };

  for (const item of ai.recommendations ?? []) {
    const match = findCandidate(item.name, candidates);
    if (!match || usedIds.has(match.googlePlaceId)) continue;
    usedIds.add(match.googlePlaceId);
    const aiReason = item.reason?.trim();
    const fallbackMatch = withEvidenceFallback(match);
    const validation = aiReason
      ? validateAiPersonalityClaims(aiReason, match.sourcePlace)
      : { valid: false, rejectedClaim: "" as const };
    const acceptedAiReason = aiReason && validation.valid ? aiReason : "";
    devVerboseInfo("[RECOMMENDATION_REASON_RESOLVED]", {
      placeId: match.sourcePlace.id,
      reasonSource: acceptedAiReason ? "ai" : fallbackMatch.reasonSource,
      primaryEvidence: acceptedAiReason ? "ai_validated" : fallbackMatch.reasonSource,
      availableEvidence: match.sourcePlace.reasonClaimEvidence ?? [],
      identity: match.primaryType ?? "",
      categoryIntent: categoryIntentFromCandidate(match) ?? "",
      fallbackUsed: !acceptedAiReason,
      fallbackReason: aiReason && !validation.valid ? "unsupported_ai_personality_claim" : aiReason ? "" : "missing_ai_reason",
      profileTier: options?.profileTier ?? "free",
      profileOnboarded: options?.profileOnboarded === true,
      preferenceEvidenceUsed: false,
      preferenceEvidenceSource: "",
      preferenceField: "",
      preferenceMappingContract: "",
      personalityTypeUsed: false,
      personalitySummaryUsed: false,
      aiReasonValidated: Boolean(aiReason),
      aiReasonRejectedClaim: validation.rejectedClaim,
      restoredFromCache: false,
      distanceSource: "UNKNOWN",
      distanceMeters: null,
      proximityWordingAllowed: false,
    });
    merged.push({
      ...match,
      description: item.description?.trim() || match.description,
      reason: acceptedAiReason || fallbackMatch.reason,
      estimatedTime: item.estimatedTime?.trim() || match.estimatedTime,
      reasonSource: acceptedAiReason ? "ai" : fallbackMatch.reasonSource,
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
      merged.push(withEvidenceFallback(c));
      if (merged.length >= minCount) break;
    }
  }

  return {
    ...ai,
    recommendations: merged.slice(0, maxCount),
  };
}
