/**
 * Travel Memory → Weight Suggestion / Preference Signal
 * 不直接控制排序。
 */

import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import type {
  PreferenceSignal,
  WeightSuggestion,
} from "@/lib/recommendation/engine/signals/types";

const INTEREST_TYPE_MAP: Record<string, string[]> = {
  美食: ["restaurant", "food", "meal_takeaway", "cafe"],
  food: ["restaurant", "food", "meal_takeaway"],
  咖啡: ["cafe", "coffee_shop"],
  cafe: ["cafe", "coffee_shop"],
  coffee: ["cafe", "coffee_shop"],
  自然: ["park", "natural_feature", "campground"],
  nature: ["park", "natural_feature"],
  購物: ["shopping_mall", "department_store", "clothing_store"],
  shopping: ["shopping_mall", "department_store"],
  夜生活: ["bar", "night_club", "night_market"],
  nightlife: ["bar", "night_club"],
  文化: ["museum", "art_gallery", "tourist_attraction"],
  culture: ["museum", "art_gallery"],
};

/**
 * 從現有 preference / interests 抽出 Memory 訊號（輕量；不讀 DB）。
 */
export function buildMemoryPersonalization(
  profile?: UserProfileForReason | null,
): { suggestions: WeightSuggestion[]; signals: PreferenceSignal[] } {
  if (!profile) return { suggestions: [], signals: [] };

  const interests = profile.interests ?? [];
  const typeBoosts: Record<string, number> = {};
  const labelBoosts: Record<string, number> = {};

  for (const interest of interests) {
    const key = interest.trim();
    if (!key) continue;
    labelBoosts[key.toLowerCase()] = Math.max(labelBoosts[key.toLowerCase()] ?? 0, 0.7);
    const mapped = INTEREST_TYPE_MAP[key] ?? INTEREST_TYPE_MAP[key.toLowerCase()];
    if (mapped) {
      for (const t of mapped) {
        typeBoosts[t] = Math.max(typeBoosts[t] ?? 0, 0.75);
      }
    }
  }

  const avoid = profile.avoid ?? [];
  for (const a of avoid) {
    const k = a.trim().toLowerCase();
    if (k) labelBoosts[k] = Math.min(labelBoosts[k] ?? 0, 0);
  }

  const hasSignal = Object.keys(typeBoosts).length + Object.keys(labelBoosts).length > 0;
  if (!hasSignal) return { suggestions: [], signals: [] };

  return {
    suggestions: [
      {
        source: "memory",
        // 建議略為提高 memory 槽位；Engine 正規化後才生效
        weightDeltas: { memory: 0.08, distance: -0.02, rating: -0.02, reviews: -0.02, open: -0.02 },
      },
    ],
    signals: [
      {
        source: "memory",
        typeBoosts,
        labelBoosts,
      },
    ],
  };
}
