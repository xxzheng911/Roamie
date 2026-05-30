import type { DailyForecast } from "@/lib/weather.functions";
import type { RoamieItineraryItem } from "@/lib/ai/types";
import { inferActivityTypesFromDayItems } from "@/lib/outfit/infer-activities";
import {
  categoriesToOutfitSummary,
  inferCategoriesForItineraryDay,
  mergeAccessoriesIntoPacking,
} from "@/lib/outfit/infer-outfit-categories";
import type { DailyOutfitAdvice, OutfitCategoryAdvice } from "@/lib/outfit/types";

function snapshotFromForecast(f: DailyForecast) {
  const hi = f.tempHighC;
  const lo = f.tempLowC;
  return {
    condition: f.condition,
    tempHighC: hi,
    tempLowC: lo,
    precipProbability: f.precipProbability,
    diurnalRangeC:
      hi != null && lo != null ? Math.round((hi - lo) * 10) / 10 : null,
    iconType: f.iconType,
  };
}

function fallbackNarrative(
  f: DailyForecast,
  activities: ReturnType<typeof inferActivityTypesFromDayItems>,
  categories: OutfitCategoryAdvice,
  styleTone?: string,
): { outfitSummary: string; narrative: string; packingReminders: string[] } {
  const hi = f.tempHighC ?? 24;
  const lo = f.tempLowC ?? hi - 5;
  const diff = hi - lo;
  const rainy = (f.precipProbability ?? 0) >= 40;
  const hiking = activities.includes("hiking");
  const beach = activities.includes("beach");
  const photo = activities.includes("photo");

  const outfitSummary = categoriesToOutfitSummary(categories);
  const packing = mergeAccessoriesIntoPacking(categories, []);

  const styleBit = styleTone ? `（${styleTone}風格）` : "";
  let narrative = `${f.condition}，白天約 ${Math.round(hi)}°C`;
  if (diff >= 6) narrative += `，早晚溫差大，建議多帶一層`;
  narrative += `。今天穿著可以考慮：${outfitSummary}${styleBit}。`;

  if (rainy) narrative += " 可能下雨，輕便雨具會讓你安心很多。";
  if (hiking) narrative += " 行程有不少步行，鞋子選好走的會比較舒服。";
  if (photo) narrative += " 要拍美照的話，記得選好走又上鏡的單品。";
  if (beach) narrative += " 海邊記得防曬。";

  return { outfitSummary, narrative, packingReminders: packing };
}

export function buildFallbackOutfitAdvice(
  forecast: DailyForecast[],
  tripDates: string[],
  itemsByDate: Map<string, RoamieItineraryItem[]>,
  opts: { fashionStyle?: string; startDate: string },
): DailyOutfitAdvice[] {
  return forecast.map((f, i) => {
    const tripDate = tripDates[i] ?? f.date;
    const items = itemsByDate.get(tripDate) ?? [];
    const activities = inferActivityTypesFromDayItems(items);
    const categories = inferCategoriesForItineraryDay(f, items, opts.fashionStyle);
    const fb = fallbackNarrative(f, activities, categories, opts.fashionStyle);
    return {
      date: tripDate,
      dayIndex: i + 1,
      weather: snapshotFromForecast(f),
      activityTypes: activities,
      outfitSummary: fb.outfitSummary,
      narrative: fb.narrative,
      packingReminders: fb.packingReminders,
      categories,
      styleTone: opts.fashionStyle,
    };
  });
}
