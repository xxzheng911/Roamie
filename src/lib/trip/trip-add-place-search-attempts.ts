import type { NearbyPlaceIntent } from "@/lib/ai/chat-intent";
import type { TripAddPlaceFollowUpIntent } from "@/lib/trip/trip-add-place-session";

/** 行程加點：分批 types 搜尋，避免只吃一種類型 */
export function tripAddPlaceNearbyGroups(
  intent: TripAddPlaceFollowUpIntent | NearbyPlaceIntent,
  userText = "",
): string[][] {
  const t = userText.trim();

  if (intent === "restaurant" || /餐廳|美食|晚餐|午餐|吃/.test(t)) {
    return [
      ["restaurant"],
      ["meal_takeaway", "fast_food_restaurant"],
      ["cafe", "bakery"],
    ];
  }

  if (intent === "cafe" || /咖啡/.test(t)) {
    return [
      ["cafe", "coffee_shop"],
      ["bakery", "dessert_shop"],
      ["tea_house"],
    ];
  }

  if (/(酒吧|居酒屋|夜晚|晚上|bar|izakaya)/i.test(t)) {
    return [
      ["bar", "pub"],
      ["izakaya", "night_club"],
      ["restaurant"],
    ];
  }

  if (/(下雨|雨天|室內)/.test(t)) {
    return [
      ["museum", "art_gallery"],
      ["shopping_mall", "department_store"],
      ["cafe", "coffee_shop"],
    ];
  }

  return [
    ["tourist_attraction"],
    ["museum", "art_gallery"],
    ["park", "national_park", "botanical_garden"],
    ["shopping_mall", "department_store"],
    ["amusement_park", "aquarium", "zoo"],
    ["observation_deck", "landmark"],
  ];
}
