import type { PlaceResult } from "@/lib/place-result";

export type MockMapPlace = PlaceResult & { reason: string };

const TYPE_LABELS: Record<string, string> = {
  cafe: "咖啡廳",
  bakery: "烘焙",
  restaurant: "餐廳",
  tourist_attraction: "景點",
  museum: "博物館",
  park: "公園",
  bookstore: "書店",
  bar: "酒吧",
};

/** Google primaryType → 中文類型 */
export function formatPlaceTypeLabel(
  primaryType: string | null | undefined,
  fallback = "地點",
): string {
  if (!primaryType) return fallback;
  const key = primaryType.toLowerCase();
  for (const [k, label] of Object.entries(TYPE_LABELS)) {
    if (key.includes(k)) return label;
  }
  return fallback;
}

/** API 無結果或失敗時的示範推薦（座標偏移，不綁定特定城市名稱） */
export function getMockMapPlaces(center: { lat: number; lng: number }): MockMapPlace[] {
  return [
    {
      id: "mock-1",
      name: "巷弄咖啡",
      address: "附近",
      lat: center.lat + 0.0038,
      lng: center.lng - 0.0026,
      rating: 4.6,
      userRatingCount: 420,
      photoName: null,
      primaryType: "cafe",
      businessStatus: "OPERATIONAL",
      openStatus: "open",
      openStatusLabel: "營業中",
      todayHoursLabel: "10:00–21:00",
      closingSoonNote: "",
      nextOpenHint: "",
      reason: "氣氛安靜，適合坐下來發呆一陣子",
    },
    {
      id: "mock-2",
      name: "在地小餐館",
      address: "附近",
      lat: center.lat + 0.0021,
      lng: center.lng + 0.0034,
      rating: 4.5,
      userRatingCount: 890,
      photoName: null,
      primaryType: "restaurant",
      businessStatus: "OPERATIONAL",
      openStatus: "open",
      openStatusLabel: "營業中",
      todayHoursLabel: "11:30–21:00",
      closingSoonNote: "",
      nextOpenHint: "",
      reason: "適合慢慢吃一餐再繼續走",
    },
    {
      id: "mock-3",
      name: "城市公園",
      address: "附近",
      lat: center.lat - 0.0042,
      lng: center.lng - 0.0018,
      rating: 4.4,
      userRatingCount: 2100,
      photoName: null,
      primaryType: "park",
      businessStatus: "OPERATIONAL",
      openStatus: "open",
      openStatusLabel: "營業中",
      todayHoursLabel: "05:00–22:00",
      closingSoonNote: "",
      nextOpenHint: "",
      reason: "綠意多、步調慢，適合傍晚散步",
    },
    {
      id: "mock-4",
      name: "獨立書店",
      address: "附近",
      lat: center.lat - 0.0015,
      lng: center.lng + 0.0041,
      rating: 4.3,
      userRatingCount: 1500,
      photoName: null,
      primaryType: "bookstore",
      businessStatus: "OPERATIONAL",
      openStatus: "open",
      openStatusLabel: "營業中",
      todayHoursLabel: "10:00–22:00",
      closingSoonNote: "",
      nextOpenHint: "",
      reason: "適合慢慢翻書、不趕時間的午後",
    },
  ];
}
