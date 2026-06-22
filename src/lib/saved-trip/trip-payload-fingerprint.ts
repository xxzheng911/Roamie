import type { RoamiePayloadV2 } from "@/lib/ai/types";
import type { TripOutfitSuggestionFields } from "@/lib/outfit/types";

/** Stable JSON key for autosave dedup — only user-editable + persisted outfit fields. */
export function tripPayloadFingerprint(
  payload: Pick<
    RoamiePayloadV2,
    "title" | "itinerary" | "tripSettings" | "recommendations"
  > &
    TripOutfitSuggestionFields,
): string {
  return JSON.stringify({
    title: payload.title,
    itinerary: payload.itinerary,
    tripSettings: payload.tripSettings,
    days: payload.days ?? null,
    outfitSuggestion: payload.outfitSuggestion ?? null,
    outfitSuggestionUpdatedAt: payload.outfitSuggestionUpdatedAt ?? null,
    weatherSummary: payload.weatherSummary ?? null,
    weatherSource: payload.weatherSource ?? null,
    outfitSuggestionInputKey: payload.outfitSuggestionInputKey ?? null,
  });
}
