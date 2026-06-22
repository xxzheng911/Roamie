/**
 * Google Places API (New) searchNearby `includedTypes` whitelist (Table A).
 * All nearby type lists must pass through sanitizeNearbyTypes before API calls.
 */
export const GOOGLE_PLACES_NEARBY_TYPE_WHITELIST = new Set([
  "restaurant",
  "meal_takeaway",
  "fast_food_restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "bar",
  "night_club",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "historical_landmark",
  "monument",
  "shopping_mall",
  "department_store",
  "market",
  "flea_market",
  "park",
  "national_park",
  "botanical_garden",
  "zoo",
  "aquarium",
  "amusement_park",
  "stadium",
  "movie_theater",
  "performing_arts_theater",
  "spa",
  "gym",
  "beauty_salon",
  "hair_salon",
  "book_store",
  "clothing_store",
  "convenience_store",
  "supermarket",
  "grocery_store",
  "pharmacy",
  "bank",
  "atm",
]);

/** Category → allowed nearby types (keywords stay in textQuery only). */
export const HOME_NEARBY_CATEGORY_TYPES: Record<string, readonly string[]> = {
  night_bar: ["bar", "night_club"],
  night_food: ["restaurant", "meal_takeaway", "fast_food_restaurant"],
  night_cafe: ["cafe", "coffee_shop", "bakery"],
  day_cafe: ["cafe", "coffee_shop", "bakery"],
  day_food: ["restaurant", "meal_takeaway", "fast_food_restaurant"],
  day_sight: ["tourist_attraction", "museum", "art_gallery", "historical_landmark"],
  day_market: ["market", "flea_market", "shopping_mall", "department_store"],
};

/** Single-type fallback when a category nearby request fails (400 or empty). */
export const HOME_NEARBY_CATEGORY_FALLBACK_TYPE: Record<string, string> = {
  night_bar: "bar",
  night_food: "restaurant",
  night_cafe: "cafe",
  day_cafe: "cafe",
  day_food: "restaurant",
  day_sight: "tourist_attraction",
  day_market: "shopping_mall",
};

/** Last-resort nearby types for home when all waves fail. */
export const HOME_POPULAR_NEARBY_TYPES = ["restaurant", "cafe", "tourist_attraction"] as const;

export function sanitizeNearbyTypes(types: string[] | undefined): string[] {
  if (!types?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of types) {
    const t = raw.trim().toLowerCase();
    if (!t || !GOOGLE_PLACES_NEARBY_TYPE_WHITELIST.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function sanitizeNearbyGroups(groups: string[][] | undefined): string[][] {
  if (!groups?.length) return [];
  return groups
    .map((group) => sanitizeNearbyTypes(group))
    .filter((group) => group.length > 0);
}

export function homeNearbyTypesForCategory(categoryId: string): string[] {
  const mapped = HOME_NEARBY_CATEGORY_TYPES[categoryId];
  if (mapped?.length) return [...mapped];
  return sanitizeNearbyTypes([categoryId]);
}

export function homeNearbyFallbackTypeForCategory(categoryId: string): string | null {
  const fallback = HOME_NEARBY_CATEGORY_FALLBACK_TYPE[categoryId];
  if (!fallback) return null;
  const sanitized = sanitizeNearbyTypes([fallback]);
  return sanitized[0] ?? null;
}
