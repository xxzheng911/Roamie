import type { DailyForecast } from "@/lib/weather.functions";
import type { RoamieItineraryItem } from "@/lib/ai/types";
import { inferActivityTypesFromDayItems } from "@/lib/outfit/infer-activities";
import type { DailyOutfitAdvice } from "@/lib/outfit/types";

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
  styleTone?: string,
): { outfitSummary: string; narrative: string; packingReminders: string[] } {
  const hi = f.tempHighC ?? 24;
  const lo = f.tempLowC ?? hi - 5;
  const diff = hi - lo;
  const rainy = (f.precipProbability ?? 0) >= 40;
  const hiking = activities.includes("hiking");
  const beach = activities.includes("beach");
  const photo = activities.includes("photo");

  let outfit = "";
  const packing: string[] = [];

  if (hi >= 28) outfit = "透氣短袖";
  else if (hi >= 20) outfit = "短袖或薄長袖";
  else if (hi >= 12) outfit = "長袖＋外套";
  else outfit = "保暖外套＋內層";

  if (diff >= 8) outfit += "＋薄外套（早晚）";
  if (rainy) {
    packing.push("建議攜帶折疊傘");
    outfit += "、防潑外套";
  }
  if (hiking) {
    packing.push("舒適球鞋、小背包");
    outfit = "機能褲＋防滑鞋";
  }
  if (beach) packing.push("防曬、拖鞋或凉鞋");
  if (photo) packing.push("方便走動的鞋子");

  const styleBit = styleTone ? `（${styleTone}風格）` : "";
  let narrative = `${f.condition}，白天約 ${Math.round(hi)}°C`;
  if (diff >= 6) narrative += `，早晚溫差大，建議多帶一層`;
  narrative += `。今天穿著可以考慮：${outfit}${styleBit}。`;

  if (rainy) narrative += " 可能下雨，輕便雨具會讓你安心很多。";
  if (hiking) narrative += " 行程有不少步行，鞋子選好走的會比較舒服。";
  if (photo) narrative += " 要拍美照的話，記得選好走又上鏡的單品。";

  return { outfitSummary: outfit, narrative, packingReminders: packing };
}

export function buildFallbackOutfitAdvice(
  forecast: DailyForecast[],
  itemsByDate: Map<string, RoamieItineraryItem[]>,
  opts: { fashionStyle?: string; startDate: string },
): DailyOutfitAdvice[] {
  return forecast.map((f, i) => {
    const items = itemsByDate.get(f.date) ?? [];
    const activities = inferActivityTypesFromDayItems(items);
    const fb = fallbackNarrative(f, activities, opts.fashionStyle);
    return {
      date: f.date,
      dayIndex: i + 1,
      weather: snapshotFromForecast(f),
      activityTypes: activities,
      outfitSummary: fb.outfitSummary,
      narrative: fb.narrative,
      packingReminders: fb.packingReminders,
      styleTone: opts.fashionStyle,
    };
  });
}
