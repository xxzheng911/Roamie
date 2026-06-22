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
  const dest = params.destination.trim() || "這趟旅程";

  const parts: string[] = [];
  if (season === "winter") {
    parts.push(`${dest} 這段時間偏冷，建議洋蔥式穿搭與保暖外套，鞋子選好走防滑的款式。`);
  } else if (season === "summer") {
    parts.push(`${dest} 這段時間偏熱，建議透氣排汗的衣物，白天注意防曬與補水。`);
  } else {
    parts.push(`${dest} 這段時間氣溫適中，以舒適好走的層次穿搭為主，方便依溫差加減。`);
  }
  if (heavyWalk) parts.push("行程步行較多，鞋子選透氣好走的款式會更輕鬆。");
  if (hasNight) parts.push("若有夜間活動，多帶一件薄外套會更安心。");

  const weatherSource: TripWeatherSource = "fallback";
  return {
    outfitSuggestion: parts.join(" "),
    weatherSummary: "",
    weatherSource,
    outfitSuggestionUpdatedAt: new Date().toISOString(),
    outfitSuggestionInputKey: params.inputKey,
  };
}
