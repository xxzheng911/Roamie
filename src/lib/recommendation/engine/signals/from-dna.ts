/**
 * Travel DNA → Weight Suggestion / Preference Signal
 * 不直接控制排序；不寫入 Memory。
 */

import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import type {
  PreferenceSignal,
  WeightSuggestion,
} from "@/lib/recommendation/engine/signals/types";

type DnaTraitHint = {
  match: RegExp;
  typeBoosts: Record<string, number>;
  labelBoosts?: Record<string, number>;
  weightDeltas?: WeightSuggestion["weightDeltas"];
};

const DNA_TRAITS: DnaTraitHint[] = [
  {
    match: /cafe|咖啡/i,
    typeBoosts: { cafe: 0.9, coffee_shop: 0.85 },
    labelBoosts: { cafe: 0.8, coffee: 0.8 },
    weightDeltas: { dna: 0.1, rating: 0.02, distance: -0.04, open: -0.04, reviews: -0.04 },
  },
  {
    match: /food|美食|gourmet/i,
    typeBoosts: { restaurant: 0.85, food: 0.8 },
    weightDeltas: { dna: 0.1, rating: 0.04, reviews: 0.02, distance: -0.06, open: -0.05, memory: -0.05 },
  },
  {
    match: /nature|自然|outdoor|hiking/i,
    typeBoosts: { park: 0.9, natural_feature: 0.85 },
    weightDeltas: { dna: 0.1, distance: 0.02, open: -0.04, rating: -0.04, reviews: -0.04 },
  },
  {
    match: /night|夜生活|nightlife/i,
    typeBoosts: { bar: 0.85, night_club: 0.8 },
    weightDeltas: { dna: 0.1, open: 0.02, rating: -0.04, distance: -0.04, reviews: -0.04 },
  },
  {
    match: /shop|購物|mall/i,
    typeBoosts: { shopping_mall: 0.85, department_store: 0.8 },
    weightDeltas: { dna: 0.08, distance: -0.02, rating: -0.02, reviews: -0.02, open: -0.02 },
  },
  {
    match: /culture|文化|museum|history/i,
    typeBoosts: { museum: 0.9, art_gallery: 0.8, tourist_attraction: 0.6 },
    weightDeltas: { dna: 0.08, rating: 0.02, distance: -0.04, open: -0.03, reviews: -0.03 },
  },
];

/**
 * 從 personality / travelStyle 抽出 DNA 訊號（輕量；完整 DNA 模組就緒後可替換輸入源）。
 */
export function buildDnaPersonalization(
  profile?: UserProfileForReason | null,
): { suggestions: WeightSuggestion[]; signals: PreferenceSignal[] } {
  if (!profile) return { suggestions: [], signals: [] };

  const text = [profile.personalityType, profile.travelStyle, profile.personalitySummary]
    .filter(Boolean)
    .join(" ");
  if (!text.trim()) return { suggestions: [], signals: [] };

  const typeBoosts: Record<string, number> = {};
  const labelBoosts: Record<string, number> = {};
  const weightDeltas: NonNullable<WeightSuggestion["weightDeltas"]> = {};

  let matched = false;
  for (const trait of DNA_TRAITS) {
    if (!trait.match.test(text)) continue;
    matched = true;
    for (const [k, v] of Object.entries(trait.typeBoosts)) {
      typeBoosts[k] = Math.max(typeBoosts[k] ?? 0, v);
    }
    for (const [k, v] of Object.entries(trait.labelBoosts ?? {})) {
      labelBoosts[k] = Math.max(labelBoosts[k] ?? 0, v);
    }
    for (const [k, v] of Object.entries(trait.weightDeltas ?? {}) as [string, number][]) {
      weightDeltas[k as keyof typeof weightDeltas] =
        (weightDeltas[k as keyof typeof weightDeltas] ?? 0) + v;
    }
  }

  if (!matched) {
    // 有 DNA 標籤但未對上特化 trait：僅建議開啟 dna 槽位，不指定類型
    return {
      suggestions: [{ source: "dna", weightDeltas: { dna: 0.05, distance: -0.05 } }],
      signals: [],
    };
  }

  return {
    suggestions: [{ source: "dna", weightDeltas }],
    signals: [{ source: "dna", typeBoosts, labelBoosts }],
  };
}
