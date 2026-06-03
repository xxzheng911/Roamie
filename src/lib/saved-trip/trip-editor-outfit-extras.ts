import type { RoamiePayloadV2 } from "@/lib/ai/types";

/** 詳情頁暫停即時 outfit suggestion（驗證 render loop） */
export const TRIP_EDITOR_OUTFIT_SUGGESTION_DISABLED = true;

/**
 * 僅用穩定 primitive 組成 outfit extras 指紋，不含 timestamp / inputKey / 陣列 reference。
 */
export function stableOutfitExtrasSignature(parts: {
  destination: string;
  outfitSuggestionText: string;
  weatherSummary: string;
  moodTag?: string | null;
}): string {
  return [
    parts.destination.trim().toLowerCase(),
    parts.outfitSuggestionText.trim(),
    parts.weatherSummary.trim(),
    (parts.moodTag ?? "").trim(),
  ].join("\u0001");
}

export function hashStableOutfitExtrasFromPayload(
  payload: RoamiePayloadV2,
  destination: string,
): string {
  const outfitSuggestionText = (
    payload.outfitSuggestion ??
    payload.clothingAdvice ??
    ""
  ).trim();
  return stableOutfitExtrasSignature({
    destination,
    outfitSuggestionText,
    weatherSummary: (payload.weatherSummary ?? "").trim(),
    moodTag: payload.moodTag ?? null,
  });
}

export function pickStableOutfitExtrasForPayload(
  payload: RoamiePayloadV2,
  outfitSuggestionText: string,
): Record<string, unknown> | null {
  const text = outfitSuggestionText.trim();
  if (!text) return null;
  return {
    outfitSuggestion: text,
    clothingAdvice: text,
    weatherSummary: payload.weatherSummary ?? "",
    weatherSource: payload.weatherSource ?? "",
    outfitTags: payload.outfitTags ?? [],
    weatherTempC: payload.weatherTempC ?? null,
    weatherFeelsLikeC: payload.weatherFeelsLikeC ?? null,
    weatherCondition: payload.weatherCondition ?? "",
    weatherIconType: payload.weatherIconType ?? "",
    weatherIsDaytime: payload.weatherIsDaytime ?? true,
    weatherPrecipPercent: payload.weatherPrecipPercent ?? null,
    outfitTier: payload.outfitTier ?? "",
  };
}
