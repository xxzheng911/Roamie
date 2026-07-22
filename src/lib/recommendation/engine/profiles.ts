/**
 * Recommendation Profiles — 各 Profile 自管 Weight。
 * Engine 只讀 Profile + Weight Suggestion，不寫死業務權重。
 *
 * 未來新增 Travel DNA / Weather / Mood 權重時，改 Profile 或 Suggestion 即可。
 */

export type RecommendationProfileId =
  | "general"
  | "food"
  | "night"
  | "cafe"
  | "nature"
  | "shopping";

/** 可擴充因子；未啟用的因子權重可為 0 */
export type WeightFactorKey =
  | "open"
  | "distance"
  | "rating"
  | "reviews"
  | "memory"
  | "dna"
  | "weather"
  | "season"
  | "festival"
  | "mood"
  | "learning";

export type ProfileWeights = Record<WeightFactorKey, number>;

export type RecommendationProfile = {
  id: RecommendationProfileId;
  /** 該 Profile 的基礎權重（總和應為 1） */
  weights: ProfileWeights;
};

function weights(partial: Partial<ProfileWeights> & Pick<ProfileWeights, "open" | "distance" | "rating" | "reviews">): ProfileWeights {
  return {
    open: partial.open,
    distance: partial.distance,
    rating: partial.rating,
    reviews: partial.reviews,
    memory: partial.memory ?? 0,
    dna: partial.dna ?? 0,
    weather: partial.weather ?? 0,
    season: partial.season ?? 0,
    festival: partial.festival ?? 0,
    mood: partial.mood ?? 0,
    learning: partial.learning ?? 0,
  };
}

/**
 * R1.1 基礎：僅 open/distance/rating/reviews 有權重。
 * memory/dna 等槽位預留為 0，由 R1.2+ Suggestion 或 Profile 升級啟用。
 */
export const RECOMMENDATION_PROFILES: Record<RecommendationProfileId, RecommendationProfile> = {
  general: {
    id: "general",
    weights: weights({ open: 0.3, distance: 0.35, rating: 0.25, reviews: 0.1 }),
  },
  food: {
    id: "food",
    weights: weights({ open: 0.3, distance: 0.15, rating: 0.4, reviews: 0.15 }),
  },
  night: {
    id: "night",
    weights: weights({ open: 0.3, distance: 0.15, rating: 0.4, reviews: 0.15 }),
  },
  cafe: {
    id: "cafe",
    weights: weights({ open: 0.25, distance: 0.25, rating: 0.35, reviews: 0.15 }),
  },
  nature: {
    id: "nature",
    weights: weights({ open: 0.2, distance: 0.4, rating: 0.25, reviews: 0.15 }),
  },
  shopping: {
    id: "shopping",
    weights: weights({ open: 0.3, distance: 0.3, rating: 0.25, reviews: 0.15 }),
  },
};

const CATEGORY_TO_PROFILE: Record<string, RecommendationProfileId> = {
  food: "food",
  night: "night",
  cafe: "cafe",
  coffee: "cafe",
  nature: "nature",
  park: "nature",
  outdoor: "nature",
  shopping: "shopping",
  shop: "shopping",
  mall: "shopping",
  attraction: "general",
  sightseeing: "general",
};

export function resolveRecommendationProfileId(
  categoryHint?: string | null,
): RecommendationProfileId {
  const key = (categoryHint ?? "").trim().toLowerCase();
  if (!key) return "general";
  if (key in RECOMMENDATION_PROFILES) {
    return key as RecommendationProfileId;
  }
  return CATEGORY_TO_PROFILE[key] ?? "general";
}

export function getRecommendationProfile(
  categoryHint?: string | null,
): RecommendationProfile {
  const id = resolveRecommendationProfileId(categoryHint);
  return RECOMMENDATION_PROFILES[id];
}

/** 將權重正規化為總和 1（忽略負值） */
export function normalizeProfileWeights(input: Partial<ProfileWeights>): ProfileWeights {
  const base = weights({
    open: Math.max(0, input.open ?? 0),
    distance: Math.max(0, input.distance ?? 0),
    rating: Math.max(0, input.rating ?? 0),
    reviews: Math.max(0, input.reviews ?? 0),
    memory: Math.max(0, input.memory ?? 0),
    dna: Math.max(0, input.dna ?? 0),
    weather: Math.max(0, input.weather ?? 0),
    season: Math.max(0, input.season ?? 0),
    festival: Math.max(0, input.festival ?? 0),
    mood: Math.max(0, input.mood ?? 0),
    learning: Math.max(0, input.learning ?? 0),
  });
  const sum = (Object.keys(base) as WeightFactorKey[]).reduce((a, k) => a + base[k], 0);
  if (sum <= 0) {
    return { ...RECOMMENDATION_PROFILES.general.weights };
  }
  const out = { ...base };
  for (const k of Object.keys(out) as WeightFactorKey[]) {
    out[k] = out[k] / sum;
  }
  return out;
}

/** 距離正規化上限（公尺）— Profile 共用幾何常數，非業務權重 */
export const DISTANCE_SATURATION_METERS = 5000;
