/**
 * Profile-based scoring（R1.1 因子 + 可選 R1.2 Memory/DNA factor）
 * 權重來自 Recommendation Profile（+ Weight Suggestions），非寫死於 Engine。
 */

import { distanceMeters } from "@/lib/geo-distance";
import {
  DISTANCE_SATURATION_METERS,
  getRecommendationProfile,
  type ProfileWeights,
  type WeightFactorKey,
} from "@/lib/recommendation/engine/profiles";
import {
  mergeWeightsWithSuggestions,
  preferenceFactorScores,
} from "@/lib/recommendation/engine/signals/merge";
import type { PersonalizationBundle } from "@/lib/recommendation/engine/signals/types";
import {
  attachScoreBreakdown,
  type RecommendationCandidate,
  type RecommendationContext,
  type ScoredCandidate,
} from "@/lib/recommendation/engine/types";

function openStatusScore(candidate: RecommendationCandidate): number {
  const status = (candidate.openStatus ?? "").toLowerCase();
  if (status === "open" || candidate.openNow === true) return 1;
  if (status === "closing_soon") return 0.75;
  if (status === "unknown" || (!status && candidate.openNow == null)) return 0.4;
  if (status === "closed_now" || status === "closed" || candidate.openNow === false) {
    return 0;
  }
  return 0.4;
}

function ratingScore(candidate: RecommendationCandidate): number {
  const rating = candidate.rating;
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return 0;
  return Math.min(1, Math.max(0, rating / 5));
}

function distanceScore(
  candidate: RecommendationCandidate,
  origin: { lat: number; lng: number } | undefined,
): number {
  if (!origin || candidate.lat == null || candidate.lng == null) return 0;
  const meters = distanceMeters(origin, { lat: candidate.lat, lng: candidate.lng });
  if (!Number.isFinite(meters)) return 0;
  return Math.max(0, 1 - meters / DISTANCE_SATURATION_METERS);
}

function reviewScore(candidate: RecommendationCandidate, maxLog: number): number {
  const count = candidate.userRatingCount ?? 0;
  if (count <= 0 || maxLog <= 0) return 0;
  return Math.min(1, Math.log1p(count) / maxLog);
}

function weightedSum(
  parts: Partial<Record<WeightFactorKey, number>>,
  weights: ProfileWeights,
): number {
  let score = 0;
  for (const key of Object.keys(weights) as WeightFactorKey[]) {
    const w = weights[key];
    if (w <= 0) continue;
    score += (parts[key] ?? 0) * w;
  }
  return score;
}

export type ScoreWithProfileOptions = {
  personalization?: PersonalizationBundle | null;
};

/**
 * 以 Recommendation Profile 計算分數。
 * Explain 階段再填結構化 reasons；此處 reasons 先留空。
 */
export function scoreCandidatesWithProfile(
  candidates: readonly RecommendationCandidate[],
  ctx: RecommendationContext,
  options?: ScoreWithProfileOptions,
): ScoredCandidate[] {
  const profile = getRecommendationProfile(ctx.categoryHint);
  const bundle = options?.personalization ?? ctx.personalization ?? null;
  const suggestions = bundle?.weightSuggestions ?? [];
  const signals = bundle?.preferenceSignals ?? [];
  const weights = mergeWeightsWithSuggestions(profile.weights, suggestions);

  const origin = ctx.location
    ? { lat: ctx.location.lat, lng: ctx.location.lng }
    : undefined;

  let maxLog = 0;
  for (const c of candidates) {
    const count = c.userRatingCount ?? 0;
    if (count > 0) maxLog = Math.max(maxLog, Math.log1p(count));
  }

  return candidates.map((candidate) => {
    const pref = preferenceFactorScores(candidate, signals);
    const parts: Partial<Record<WeightFactorKey, number>> = {
      open: openStatusScore(candidate),
      distance: distanceScore(candidate, origin),
      rating: ratingScore(candidate),
      reviews: reviewScore(candidate, maxLog),
      memory: pref.memory,
      dna: pref.dna,
    };

    const score = weightedSum(parts, weights);
    const scoreBreakdown: Record<string, number> = {
      open: parts.open ?? 0,
      distance: parts.distance ?? 0,
      rating: parts.rating ?? 0,
      reviews: parts.reviews ?? 0,
      memory: parts.memory ?? 0,
      dna: parts.dna ?? 0,
    };
    for (const key of Object.keys(weights) as WeightFactorKey[]) {
      if (
        weights[key] > 0 ||
        key === "open" ||
        key === "distance" ||
        key === "rating" ||
        key === "reviews" ||
        key === "memory" ||
        key === "dna"
      ) {
        scoreBreakdown[`weight_${key}`] = weights[key];
      }
    }

    return {
      candidate,
      score,
      reasons: [],
      ...attachScoreBreakdown(scoreBreakdown),
      profileId: profile.id,
      factorScores: parts,
      effectiveWeights: weights,
    };
  });
}

/** @deprecated 使用 scoreCandidatesWithProfile */
export const scoreCandidatesR11 = scoreCandidatesWithProfile;
