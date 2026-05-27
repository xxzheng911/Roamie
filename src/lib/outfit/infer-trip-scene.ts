import type { RoamieItineraryItem } from "@/lib/ai/types";
import { inferActivityTypesFromDayItems } from "@/lib/outfit/infer-activities";
import type { TripActivityType } from "@/lib/outfit/types";

/** 行程主場景（影響穿搭建議語境） */
export type TripSceneType = "city" | "beach" | "mountain" | "indoor";

export const TRIP_SCENE_LABELS: Record<TripSceneType, string> = {
  city: "城市",
  beach: "海邊",
  mountain: "山區",
  indoor: "室內",
};

const SCENE_FROM_ACTIVITY: Partial<Record<TripActivityType, TripSceneType>> = {
  beach: "beach",
  hiking: "mountain",
  outdoor: "mountain",
  culture: "indoor",
  shopping: "city",
  food: "city",
  city: "city",
  photo: "city",
};

const INDOOR_PATTERN = /博物館|美術館|展覽|商場|百貨|室內|購物中心|電影院|劇院|spa|溫泉館/i;
const BEACH_PATTERN = /海邊|沙灘|海水|衝浪|潛水|海灘|海岸/i;
const MOUNTAIN_PATTERN = /登山|健行|步道|爬山|山頂|國家公園|郊山|高山/i;

export function inferTripSceneTypes(items: RoamieItineraryItem[]): TripSceneType[] {
  const activities = inferActivityTypesFromDayItems(items);
  const text = items.map((i) => `${i.title} ${i.description} ${i.placeName}`).join(" ");

  const scenes = new Set<TripSceneType>();
  for (const act of activities) {
    const scene = SCENE_FROM_ACTIVITY[act];
    if (scene) scenes.add(scene);
  }
  if (INDOOR_PATTERN.test(text)) scenes.add("indoor");
  if (BEACH_PATTERN.test(text)) scenes.add("beach");
  if (MOUNTAIN_PATTERN.test(text)) scenes.add("mountain");
  if (scenes.size === 0) scenes.add("city");
  return [...scenes];
}

export function formatTripScenesForPrompt(scenes: TripSceneType[]): string {
  return scenes.map((s) => TRIP_SCENE_LABELS[s]).join("、");
}
