import type { RoamieItineraryItem } from "@/lib/ai/types";
import { TRIP_ACTIVITY_LABELS, type TripActivityType } from "@/lib/outfit/types";

const RULES: { type: TripActivityType; pattern: RegExp }[] = [
  { type: "hiking", pattern: /登山|健行|步道|爬山|郊山|山頂|國家公園|百岳/i },
  { type: "beach", pattern: /海邊|沙灘|海水|衝浪|潛水|浮潛|海岸/i },
  { type: "photo", pattern: /拍照|攝影|打卡|取景|網美|拍美照/i },
  { type: "shopping", pattern: /逛街|購物|商圈|百貨|市集|夜市|血拼/i },
  { type: "food", pattern: /美食|餐廳|小吃|咖啡|甜點|酒吧|居酒屋|拉麵/i },
  { type: "culture", pattern: /博物館|展覽|美術|古蹟|廟宇|書店|文創/i },
  { type: "outdoor", pattern: /公園|野餐|單車|騎行|露營|戶外|草原|湖邊/i },
];

export function inferActivityTypesFromDayItems(items: RoamieItineraryItem[]): TripActivityType[] {
  const text = items
    .map((i) => `${i.title} ${i.description} ${i.placeName}`)
    .join(" ");
  const found = new Set<TripActivityType>();
  for (const { type, pattern } of RULES) {
    if (pattern.test(text)) found.add(type);
  }
  if (found.size === 0) return ["city"];
  if (found.size >= 3) return ["mixed", ...found];
  return [...found];
}

export function formatActivityTypesForPrompt(types: TripActivityType[]): string {
  return types.map((t) => TRIP_ACTIVITY_LABELS[t]).join("、");
}
