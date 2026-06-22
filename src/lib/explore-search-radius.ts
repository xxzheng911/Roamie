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

export function exploreCategorySheetTitle(categoryId: string): string {
  switch (categoryId) {
    case "coffee":
      return "咖啡推薦";
    case "sight":
      return "景點推薦";
    case "district":
      return "商圈推薦";
    case "food":
      return "美食推薦";
    case "night":
      return "夜晚推薦";
    case "all":
    default:
      return "推薦地點";
  }
}
