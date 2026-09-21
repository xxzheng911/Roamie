import type { Locale } from "@/lib/i18n/types";
import { localizedOutfitCopy } from "./localized-outfit-copy";
import type { RoamieItineraryItem, TripTransportMode } from "@/lib/ai/types";
import {
  inferHasNightActivities,
  inferHeavyOutdoorWalking,
} from "@/lib/outfit/trip-outfit-context";
import type { TripOutfitSuggestionFields, TripWeatherSource } from "@/lib/outfit/types";

function inferSeasonLabel(startDate: string): "winter" | "summer" | "mild" {
  const month = Number.parseInt(startDate.slice(5, 7), 10);
  if (month === 12 || month <= 2) return "winter";
  if (month >= 6 && month <= 8) return "summer";
  return "mild";
}

/** 無天氣 API 時的本地穿搭建議（僅顯示，不寫回 trip） */
export function buildLocalTripOutfitFallback(params: {
  locale: Locale;
  destination: string;
  startDate: string;
  endDate: string;
  items: RoamieItineraryItem[];
  transport?: TripTransportMode | string | null;
  inputKey: string;
}): TripOutfitSuggestionFields {
  const season = inferSeasonLabel(params.startDate);
  const hasNight = inferHasNightActivities(params.items);
  const heavyWalk = inferHeavyOutdoorWalking(params.items, params.transport);
  const copy = localizedOutfitCopy(params.locale, {
    high: season === "winter" ? 12 : season === "summer" ? 30 : 23,
    walking: heavyWalk, night: hasNight,
  });

  const weatherSource: TripWeatherSource = "fallback";
  return {
    outfitSuggestion: copy,
    outfitCopy: { generatedLocale: params.locale },
    weatherSummary: "",
    weatherSource,
    outfitSuggestionUpdatedAt: new Date().toISOString(),
    outfitSuggestionInputKey: params.inputKey,
  };
}
