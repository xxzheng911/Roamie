import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/types";
/** 探索地圖：依分類決定搜尋半徑與顯示距離（非首頁 nearby） */

export function exploreCategorySearchRadiusMeters(categoryId: string): number {
  switch (categoryId) {
    case "sight":
      return 25_000;
    case "district":
    case "night":
      return 7_500;
    case "all":
    case "coffee":
    case "food":
    default:
      return 4_000;
  }
}

export function exploreCategoryMaxDistanceMeters(categoryId: string): number {
  switch (categoryId) {
    case "sight":
      return 30_000;
    case "district":
    case "night":
      return 10_000;
    case "all":
    case "coffee":
    case "food":
    default:
      return 5_000;
  }
}

export function exploreCategorySheetTitle(categoryId: string, locale: Locale = "zh-TW"): string {
  switch (categoryId) {
    case "coffee":
      return translate(locale, "uiCoverage.exploreCoffee");
    case "sight":
      return translate(locale, "uiCoverage.exploreSight");
    case "district":
      return translate(locale, "uiCoverage.exploreDistrict");
    case "food":
      return translate(locale, "uiCoverage.exploreFood");
    case "night":
      return translate(locale, "uiCoverage.exploreNight");
    case "all":
    default:
      return translate(locale, "uiCoverage.exploreAll");
  }
}
