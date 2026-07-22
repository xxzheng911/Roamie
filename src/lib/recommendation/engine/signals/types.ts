/**
 * Memory / DNA 僅提供 Weight Suggestion 或 Preference Signal。
 * 不得直接決定最終排序；Engine 統一計算分數。
 */

import type { WeightFactorKey } from "@/lib/recommendation/engine/profiles";

export type PersonalizationSource = "memory" | "dna";

/** 對 Profile 權重的建議調整（delta，可正可負） */
export type WeightSuggestion = {
  source: PersonalizationSource;
  weightDeltas?: Partial<Record<WeightFactorKey, number>>;
};

/**
 * 偏好訊號：對候選／類型的親和度（0–1）。
 * Engine 將其轉成 memory/dna factor score，再乘上（合併後的）權重。
 */
export type PreferenceSignal = {
  source: PersonalizationSource;
  /** Google primaryType / types 關鍵字 → 親和度 */
  typeBoosts?: Record<string, number>;
  /** 興趣／風格標籤 → 親和度（比對 name/types 文字） */
  labelBoosts?: Record<string, number>;
};

export type PersonalizationBundle = {
  weightSuggestions: WeightSuggestion[];
  preferenceSignals: PreferenceSignal[];
};
