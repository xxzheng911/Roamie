/**
 * @deprecated 權重已移至 Recommendation Profiles（profiles.ts）。
 * 保留薄相容層，供既有 R1.1 verify / import 過渡。
 */

import {
  getRecommendationProfile,
  type ProfileWeights,
} from "@/lib/recommendation/engine/profiles";

export type R11WeightKey = "open" | "distance" | "rating" | "reviews";
export type R11Weights = Record<R11WeightKey, number>;

function toR11(w: ProfileWeights): R11Weights {
  return {
    open: w.open,
    distance: w.distance,
    rating: w.rating,
    reviews: w.reviews,
  };
}

export const R1_1_WEIGHTS_DEFAULT: R11Weights = toR11(
  getRecommendationProfile("general").weights,
);

export const R1_1_WEIGHTS_FOOD_NIGHT: R11Weights = toR11(
  getRecommendationProfile("food").weights,
);

export function resolveR11Weights(categoryId?: string | null): R11Weights {
  return toR11(getRecommendationProfile(categoryId).weights);
}

export { DISTANCE_SATURATION_METERS as R1_1_DISTANCE_SATURATION_METERS } from "@/lib/recommendation/engine/profiles";
