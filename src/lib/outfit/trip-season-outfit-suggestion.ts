import type { RoamieItineraryItem } from "@/lib/ai/types";
import { inferTravelSeason, parseMonthNumber } from "@/lib/ai/travel-season";
import { groupItineraryByDate, listTripDates } from "@/lib/outfit/group-by-date";
import { inferActivityTypesFromDayItems } from "@/lib/outfit/infer-activities";
import type { DailyOutfitAdvice, OutfitAdvicePayload } from "@/lib/outfit/types";

export type SeasonOutfitBuildInput = {
  destination: string;
  startDate: string;
  endDate?: string;
  dayCount: number;
  itinerary?: RoamieItineraryItem[];
  mood?: string;
  weatherSummary?: string;
};

function itineraryHasOutdoorMountain(items: RoamieItineraryItem[] | undefined): boolean {
  const text = (items ?? []).map((i) => `${i.placeName ?? ""} ${i.title ?? ""}`).join(" ");
  return /富士|河口湖|五合目|戶外|登山|健行|山區|滑雪|雪場/.test(text);
}

/** 依目的地、月份、行程內容產生整趟穿搭建議（無天氣 API 時仍可用） */
export function buildSeasonTripOutfitSuggestion(
  input: SeasonOutfitBuildInput,
): { outfitSuggestion: string; season: string; destination: string } {
  const destination = input.destination.trim() || "目的地";
  const month = parseMonthNumber({ startDate: input.startDate });
  const seasonInfo = inferTravelSeason({
    destination,
    month,
  });
  const season = seasonInfo?.seasonLabel ?? "當季";
  const outdoor = itineraryHasOutdoorMountain(input.itinerary);

  let outfitSuggestion: string;

  if (month === 12 && /東京/.test(destination)) {
    outfitSuggestion =
      "12 月東京早晚偏冷，建議洋蔥式穿搭，攜帶厚外套、圍巾與好走的鞋。" +
      (outdoor ? "若安排富士山或戶外景點，建議多帶保暖配件。" : "");
  } else if (seasonInfo?.outfitSuggestion) {
    const monthLabel = month != null ? `${month} 月` : "這段時間";
    outfitSuggestion = `${monthLabel}${destination}${seasonInfo.climateNote ? `（${seasonInfo.climateNote}）` : ""}，建議${seasonInfo.outfitSuggestion}。`;
    if (outdoor) outfitSuggestion += "戶外或山區行程請再加防風保暖層與好走的鞋。";
  } else if (input.weatherSummary?.trim()) {
    outfitSuggestion = `${destination}：${input.weatherSummary.trim()}。建議依早晚溫差分層穿搭，並準備好走的鞋。`;
  } else {
    outfitSuggestion = `${destination} ${input.dayCount} 天行程，建議依${season}準備舒適分層穿搭與好走的鞋，出發前再確認當地天氣。`;
  }

  console.info("[OUTFIT_SUGGESTION_CREATED]", {
    destination,
    season,
    outfitSuggestion,
  });

  return { outfitSuggestion, season, destination };
}

/** 無天氣 API 時，以季節建議填入每日 outfitAdvice，供詳情頁顯示 */
export function buildSeasonOutfitAdvicePayload(
  input: SeasonOutfitBuildInput,
): OutfitAdvicePayload {
  const { outfitSuggestion, destination } = buildSeasonTripOutfitSuggestion(input);
  const items = input.itinerary ?? [];
  const tripDates = listTripDates(items, input.startDate, input.dayCount);
  const byDate = groupItineraryByDate(items);

  const days: DailyOutfitAdvice[] = tripDates.map((date, i) => {
    const dayItems = byDate.get(date) ?? [];
    const activities = inferActivityTypesFromDayItems(dayItems);
    return {
      date,
      dayIndex: i + 1,
      weather: {
        condition: input.weatherSummary?.slice(0, 40) || "依季節推估",
        tempHighC: null,
        tempLowC: null,
        precipProbability: null,
        diurnalRangeC: null,
      },
      activityTypes: activities,
      outfitSummary: outfitSuggestion.slice(0, 48),
      narrative: outfitSuggestion,
      packingReminders: outdoorPackingReminders(items),
    };
  });

  return {
    destination,
    generatedAt: new Date().toISOString(),
    days,
    status: "ready",
  };
}

function outdoorPackingReminders(items: RoamieItineraryItem[]): string[] {
  if (!itineraryHasOutdoorMountain(items)) return ["好走的鞋", "行動電源"];
  return ["厚外套或羽絨", "圍巾手套", "好走的鞋", "行動電源"];
}
