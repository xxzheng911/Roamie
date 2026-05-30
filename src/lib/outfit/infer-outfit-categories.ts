import type { DailyForecast } from "@/lib/weather.functions";
import type { RoamieItineraryItem } from "@/lib/ai/types";
import { inferActivityTypesFromDayItems } from "@/lib/outfit/infer-activities";
import type { OutfitCategoryAdvice } from "@/lib/outfit/types";

type CategoryInput = {
  forecast: DailyForecast;
  activities: ReturnType<typeof inferActivityTypesFromDayItems>;
  styleTone?: string;
};

/** 依天氣與活動推導結構化穿搭建議（AI 失敗時使用） */
export function inferOutfitCategories(input: CategoryInput): OutfitCategoryAdvice {
  const hi = input.forecast.tempHighC ?? 24;
  const lo = input.forecast.tempLowC ?? hi - 5;
  const diff = hi - lo;
  const rainy =
    (input.forecast.precipProbability ?? 0) >= 40 ||
    /雨|雷|雪/.test(input.forecast.condition);
  const sunny = /晴/.test(input.forecast.condition);
  const hiking = input.activities.includes("hiking");
  const beach = input.activities.includes("beach");
  const cold = hi <= 12 || lo <= 5;
  const hot = hi >= 28;

  let top = "";
  let outerwear = "";
  let bottom = "";
  let footwear = "";
  const accessories: string[] = [];

  if (cold) {
    top = "保暖內層或發熱衣";
    outerwear = hi <= 5 ? "羽絨外套或厚大衣" : "保暖外套或輕羽絨";
    bottom = "厚長褲或刷毛褲";
    footwear = "防滑保暖靴或好走運動鞋";
    if (lo <= 0) accessories.push("圍巾、手套");
  } else if (hot) {
    top = "透氣短袖或薄襯衫";
    outerwear = hi >= 32 ? "防曬薄罩衫（冷氣／日曬）" : sunny ? "薄防曬外套" : "可選薄外套";
    bottom = beach ? "透氣短褲或輕便長褲" : "透氣長褲或休閒短褲";
    footwear = beach ? "凉鞋或透氣運動鞋" : "透氣運動鞋";
    if (sunny || (input.forecast.uvi ?? 0) >= 6) {
      accessories.push("防曬帽");
      accessories.push("太陽眼鏡");
    }
  } else if (hi >= 20) {
    top = "薄長袖或短袖";
    outerwear = diff >= 8 ? "輕便外套（早晚加穿）" : "薄外套或針織罩衫";
    bottom = "長褲或休閒褲";
    footwear = "舒適運動鞋";
  } else {
    top = "長袖上衣或薄針織";
    outerwear = "輕外套或風衣";
    bottom = "長褲";
    footwear = "好走運動鞋";
  }

  if (rainy) {
    outerwear = outerwear.includes("防") ? outerwear : "防潑水外套";
    footwear = hiking ? "防滑機能鞋" : "防滑鞋";
    accessories.push("折疊傘");
  }

  if (hiking) {
    bottom = "機能長褲";
    footwear = "防滑登山鞋或機能運動鞋";
    accessories.push("小背包");
  }

  if (beach && !accessories.includes("防曬帽")) {
    accessories.push("防曬用品");
  }

  if (input.styleTone?.trim()) {
    const tone = input.styleTone.trim();
    if (/文青|日系|極簡/.test(tone) && !cold) {
      top = top.includes("襯衫") ? top : `${top.includes("短袖") ? "素色" : "亞麻"}${top}`;
    }
  }

  return {
    top: top || "舒適上衣",
    outerwear: outerwear || "依溫差加減外套",
    bottom: bottom || "舒適長褲",
    footwear: footwear || "好走運動鞋",
    accessories: accessories.length ? accessories : sunny ? ["太陽眼鏡"] : [],
  };
}

export function categoriesToOutfitSummary(categories: OutfitCategoryAdvice): string {
  const parts = [categories.top, categories.outerwear].filter(
    (p) => p && !/依溫差|可選/.test(p),
  );
  return parts.slice(0, 2).join("＋") || categories.top;
}

export function mergeAccessoriesIntoPacking(
  categories: OutfitCategoryAdvice,
  packingReminders: string[],
): string[] {
  const merged = [...packingReminders];
  for (const item of categories.accessories) {
    if (!merged.some((m) => m.includes(item) || item.includes(m))) {
      merged.push(item);
    }
  }
  return merged.slice(0, 5);
}

export function inferCategoriesForItineraryDay(
  forecast: DailyForecast,
  items: RoamieItineraryItem[],
  styleTone?: string,
): OutfitCategoryAdvice {
  return inferOutfitCategories({
    forecast,
    activities: inferActivityTypesFromDayItems(items),
    styleTone,
  });
}
