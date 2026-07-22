import type { PlaceResult } from "@/lib/place-result";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { EXPLICIT_FOOD_NAME_RE } from "@/lib/place-category";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import { foodPreferenceSearchQuery } from "@/lib/ai/chat-dining-flow";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  buildMealSearchAttempts,
  parseMealIntentFromText,
} from "@/lib/ai/meal-intent-parser";

/** Google types allowed for food / restaurant chat recommendations */
export const FOOD_ALLOWED_TYPES = [
  "restaurant",
  "food",
  "meal_takeaway",
  "meal_delivery",
  "food_store",
  "fast_food_restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "dessert_shop",
  "ice_cream_shop",
  "bar",
  "pub",
  "wine_bar",
  "night_club",
] as const;

/** Types that must not appear alone in food recommendations */
export const FOOD_BLOCKED_TYPES = [
  "museum",
  "art_gallery",
  "tourist_attraction",
  "hindu_temple",
  "place_of_worship",
  "church",
  "mosque",
  "synagogue",
  "shopping_mall",
  "department_store",
  "store",
  "clothing_store",
  "shoe_store",
  "home_goods_store",
  "electronics_store",
  "furniture_store",
  "hardware_store",
  "historical_landmark",
  "monument",
  "cultural_center",
  "library",
  "city_hall",
  "local_government_office",
  "university",
  "school",
] as const;

const FOOD_ALLOWED_SET = new Set<string>(FOOD_ALLOWED_TYPES);
const FOOD_BLOCKED_SET = new Set<string>(FOOD_BLOCKED_TYPES);

const FOOD_INTENT_RE =
  /(?:吃的地方|想吃|吃什麼|找吃的|推薦.{0,8}吃|吃.{0,8}推薦|有推薦的(?:餐廳|店|地方|美食)|美食|餐廳|吃飯|用餐|聚餐|小吃|甜點|下午茶|宵夜|夜食|消夜|中午|午餐|午飯|lunch)/i;

const SUPPER_INTENT_RE = /(?:宵夜|夜食|消夜|supper|late\s*night\s*food)/i;

const FOOD_DISTRICT_NAME_RE =
  /(?:夜市|美食街|傳統市場|菜市場|市場|food\s*street|bazaar|flea\s*market|中街|商店街)/i;

const FOOD_DISTRICT_TYPES = new Set(["market", "flea_market"]);

const NON_FOOD_NAME_RE =
  /(?:博物館|museum|美術館|gallery|宮|廟|temple|玉皇|百貨|department\s*store|shopping\s*mall|outlet|Outlet|磚窯|遺址|紀念|郵政|post\s*office|warehouse|工廠|factory|church|mosque|synagogue)/i;

const POI_ONLY_TYPES = new Set([
  "point_of_interest",
  "establishment",
  "premise",
  "subpremise",
  "route",
  "political",
  "locality",
  "sublocality",
]);

export type FoodPlaceVerdict = {
  allowed: boolean;
  isDistrict: boolean;
  reason: string;
};

export function isFoodIntentText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return FOOD_INTENT_RE.test(t);
}

export function isSupperIntentText(text: string): boolean {
  return SUPPER_INTENT_RE.test(text.trim());
}

function placeTypes(place: {
  primaryType?: string | null;
  types?: string[] | null;
}): string[] {
  return [
    (place.primaryType ?? "").trim().toLowerCase(),
    ...(place.types ?? []).map((t) => t.trim().toLowerCase()),
  ].filter(Boolean);
}

function hasAllowedFoodType(types: string[], allowBar: boolean): boolean {
  return types.some((t) => {
    if (FOOD_ALLOWED_SET.has(t)) {
      if (!allowBar && (t === "bar" || t === "pub" || t === "wine_bar" || t === "night_club")) {
        return false;
      }
      return true;
    }
    return false;
  });
}

export function isFoodDistrictPlace(place: {
  name?: string | null;
  address?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
}): boolean {
  const types = placeTypes(place);
  const name = (place.name ?? "").trim();
  const blob = `${name} ${place.address ?? ""}`;

  if (NON_FOOD_NAME_RE.test(blob) && !FOOD_DISTRICT_NAME_RE.test(blob)) return false;

  const hasRestaurantLikeType = types.some(
    (t) =>
      t === "restaurant" ||
      t === "fast_food_restaurant" ||
      t === "meal_takeaway" ||
      t === "cafe" ||
      t === "bakery",
  );
  if (hasRestaurantLikeType && !types.some((t) => FOOD_DISTRICT_TYPES.has(t))) {
    return false;
  }

  if (types.some((t) => FOOD_DISTRICT_TYPES.has(t))) return true;
  if (FOOD_DISTRICT_NAME_RE.test(blob) && !hasRestaurantLikeType) return true;
  return false;
}

export function evaluateFoodPlace(
  place: {
    name?: string | null;
    address?: string | null;
    primaryType?: string | null;
    types?: string[] | null;
  },
  userText = "",
): FoodPlaceVerdict {
  const types = placeTypes(place);
  const name = (place.name ?? "").trim();
  const blob = `${name} ${place.address ?? ""}`;
  const allowBar = isSupperIntentText(userText);

  if (isFoodDistrictPlace(place)) {
    return { allowed: false, isDistrict: true, reason: "food_district" };
  }

  if (NON_FOOD_NAME_RE.test(blob) && !EXPLICIT_FOOD_NAME_RE.test(blob)) {
    logChatFoodFilter(name, types.join("|"), false, "blocked_name");
    return { allowed: false, isDistrict: false, reason: "blocked_name" };
  }

  if (hasAllowedFoodType(types, allowBar)) {
    const blockedDominant = types.some(
      (t) =>
        t === "museum" ||
        t === "hindu_temple" ||
        t === "place_of_worship" ||
        t === "shopping_mall" ||
        t === "department_store",
    );
    if (blockedDominant && !EXPLICIT_FOOD_NAME_RE.test(blob)) {
      logChatFoodFilter(name, types.join("|"), false, "blocked_dominant_type");
      return { allowed: false, isDistrict: false, reason: "blocked_dominant_type" };
    }
    logChatFoodFilter(name, types.join("|"), true, "food_type");
    return { allowed: true, isDistrict: false, reason: "food_type" };
  }

  if (EXPLICIT_FOOD_NAME_RE.test(blob)) {
    logChatFoodFilter(name, types.join("|"), true, "food_name");
    return { allowed: true, isDistrict: false, reason: "food_name" };
  }

  if (types.some((t) => FOOD_BLOCKED_SET.has(t))) {
    logChatFoodFilter(name, types.join("|"), false, "blocked_type");
    return { allowed: false, isDistrict: false, reason: "blocked_type" };
  }

  if (types.length > 0 && types.every((t) => POI_ONLY_TYPES.has(t))) {
    logChatFoodFilter(name, types.join("|"), false, "poi_only");
    return { allowed: false, isDistrict: false, reason: "poi_only" };
  }

  logChatFoodFilter(name, types.join("|"), false, "not_food");
  return { allowed: false, isDistrict: false, reason: "not_food" };
}

export function filterPlacesForFoodIntent<T extends PlaceResult>(
  places: T[],
  userText = "",
): { restaurants: T[]; districts: T[] } {
  const restaurants: T[] = [];
  const districts: T[] = [];

  for (const place of places) {
    const verdict = evaluateFoodPlace(place, userText);
    if (verdict.isDistrict) {
      districts.push(place);
      continue;
    }
    if (verdict.allowed) {
      restaurants.push(place);
    }
  }

  logChatFoodResults(places.length, restaurants.length, districts.length);
  return { restaurants, districts };
}

export function filterRecommendationItemsForFoodIntent(
  items: RoamieRecommendationItem[],
  userText = "",
): RoamieRecommendationItem[] {
  return items.filter((item) => {
    const verdict = evaluateFoodPlace(
      {
        name: item.placeName ?? item.name,
        address: item.address,
        primaryType: item.type,
        types: item.type ? [item.type] : [],
      },
      userText,
    );
    return verdict.allowed && !verdict.isDistrict;
  });
}

export function logChatFoodFilter(
  placeName: string,
  types: string,
  allowed: boolean,
  reason: string,
): void {
  logAiPipeline(
    `[CHAT_FOOD_FILTER] placeName=${placeName} types=${types} allowed=${allowed} reason=${reason}`,
  );
}

export function logChatFoodResults(
  rawCount: number,
  filteredFoodCount: number,
  districtCount = 0,
): void {
  logAiPipeline(
    `[CHAT_FOOD_RESULTS] rawCount=${rawCount} filteredFoodCount=${filteredFoodCount} districtCount=${districtCount}`,
  );
}

/** Food-only search attempts — never fall back to attractions */
export function buildFoodSearchAttempts(
  foodPreference?: string,
  userText = "",
  cityLabel?: string,
): SearchAttempt[] {
  const mealIntent = parseMealIntentFromText(userText);
  if (mealIntent && cityLabel?.trim()) {
    return buildMealSearchAttempts(cityLabel, mealIntent.slot);
  }

  const attempts: SearchAttempt[] = [];
  const cuisineQuery =
    foodPreference && foodPreference !== "any"
      ? foodPreferenceSearchQuery(foodPreference)
      : undefined;
  const city = cityLabel?.trim();

  if (cuisineQuery) {
    const prefixed = city ? `${city} ${cuisineQuery}` : cuisineQuery;
    attempts.push({ query: prefixed, mode: "text", includedTypes: ["restaurant"] });
    attempts.push({ query: prefixed, mode: "text", includedTypes: ["food", "cafe"] });
    if (city && /壽喜燒|すき焼き|sukiyaki/i.test(cuisineQuery)) {
      attempts.push({
        query: `${city} すき焼き`,
        mode: "text",
        includedTypes: ["restaurant", "japanese_restaurant"],
      });
      attempts.push({
        query: `${city} sukiyaki restaurant`,
        mode: "text",
        includedTypes: ["restaurant"],
      });
      attempts.push({
        query: `${city} 牛鍋`,
        mode: "text",
        includedTypes: ["restaurant"],
      });
    }
    // Cuisine-specific: do not pad with generic nearby restaurants.
    return attempts.slice(0, 4);
  }

  attempts.push(
    { query: "餐廳 美食", mode: "nearby", includedTypes: ["restaurant"] },
    { query: "", mode: "nearby", includedTypes: ["food"] },
    { query: "", mode: "nearby", includedTypes: ["meal_takeaway"] },
    { query: "", mode: "nearby", includedTypes: ["cafe", "bakery"] },
    { query: "小吃 甜點", mode: "text", includedTypes: ["restaurant", "food", "bakery"] },
    { query: "在地美食", mode: "text", includedTypes: ["restaurant", "food", "meal_takeaway"] },
  );

  if (isSupperIntentText(userText)) {
    attempts.push({
      query: "宵夜",
      mode: "nearby",
      includedTypes: ["restaurant", "meal_takeaway", "bar"],
    });
  }

  attempts.push({
    query: "傳統市場 美食",
    mode: "text",
    includedTypes: ["market", "food"],
  });

  return attempts;
}

export const FOOD_DISTRICT_CARD_TYPE = "美食街區 / 可以逛吃";
