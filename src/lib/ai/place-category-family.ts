/**
 * Shared place category family — Candidate Pool / Planner / Validator / Auto Repair.
 * Collapses Google type variants (museum / history_museum / art_museum → museum).
 */
import type { PlaceResult } from "@/lib/place-result";

export type PlaceCategoryFamily =
  | "museum_family"
  | "temple_shrine"
  | "church"
  | "park_family"
  | "market_family"
  | "shopping"
  | "viewpoint_family"
  | "beach"
  | "historic_district"
  | "monument"
  | "theme_park"
  | "wildlife_family"
  | "cafe"
  | "restaurant"
  | "nightlife"
  | "nature_trail"
  | "palace_castle"
  | "other";

function blobOf(place: PlaceResult): string {
  return [
    place.name,
    place.localizedDisplayName,
    place.originalName,
    place.address,
    place.primaryType,
    ...(place.types ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function typeSet(place: PlaceResult): Set<string> {
  const out = new Set<string>();
  for (const t of place.types ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  return out;
}

/** True when types/name clearly indicate a museum / gallery even if primaryType is attraction. */
function looksMuseumFamily(types: Set<string>, blob: string): boolean {
  if (
    types.has("museum") ||
    types.has("art_gallery") ||
    types.has("history_museum") ||
    types.has("art_museum") ||
    types.has("science_museum") ||
    types.has("military_museum") ||
    types.has("war_museum")
  ) {
    return true;
  }
  return /博物|美術館|museum|gallery|美術館|紀念館|軍區|軍事|歷史館/i.test(blob);
}

export function resolvePlaceCategoryFamily(place: PlaceResult): PlaceCategoryFamily {
  const types = typeSet(place);
  const blob = blobOf(place);

  // Wildlife wins before park/name matching: e.g. "Bird Park" occupies only wildlife_family.
  if (
    types.has("zoo") ||
    types.has("bird_park") ||
    types.has("wildlife_park") ||
    types.has("aquarium") ||
    types.has("animal_park") ||
    /飛禽公園|鸟园|鳥園|bird\s*park|wildlife\s*park|動物園|水族館|zoo|aquarium/i.test(blob)
  ) {
    return "wildlife_family";
  }
  if (
    types.has("amusement_park") ||
    types.has("theme_park") ||
    /主題樂園|theme\s*park|disney|universal\s*studios/i.test(blob)
  ) {
    return "theme_park";
  }
  if (looksMuseumFamily(types, blob)) {
    return "museum_family";
  }
  if (
    types.has("castle") ||
    types.has("palace") ||
    /城堡|古城(?:區|遗址|遺址)?$|宮殿|castle|palace|皇宮/i.test(blob)
  ) {
    return "palace_castle";
  }
  if (
    types.has("church") ||
    types.has("cathedral") ||
    /教堂|cathedral|church/i.test(blob)
  ) {
    return "church";
  }
  if (
    types.has("place_of_worship") ||
    types.has("hindu_temple") ||
    types.has("mosque") ||
    types.has("synagogue") ||
    /神社|寺廟|寺庙|寺$|廟|神宮|寺院|temple|shrine/i.test(blob)
  ) {
    return "temple_shrine";
  }
  if (
    types.has("observation_deck") ||
    /觀景|展望|observation|viewpoint|lookout|塔$|tower/i.test(blob)
  ) {
    return "viewpoint_family";
  }
  if (types.has("beach") || /海灘|beach|海水浴場/i.test(blob)) return "beach";
  if (
    types.has("hiking_area") ||
    types.has("national_park") ||
    /步道|trail|hiking|登山/i.test(blob)
  ) {
    return "nature_trail";
  }
  if (
    ["park", "urban_park", "city_park", "public_park", "garden", "botanical_garden", "lake_garden", "ecological_park", "recreational_park", "landmark_park"].some((type) => types.has(type)) ||
    /公園|花園|庭園|植物園|park|garden/i.test(blob)
  ) return "park_family";
  if (
    types.has("market") ||
    /市場|夜市|market/i.test(blob)
  ) {
    return "market_family";
  }
  if (
    types.has("shopping_mall") ||
    types.has("department_store") ||
    /購物|商场|shopping|mall|百貨/i.test(blob)
  ) {
    return "shopping";
  }
  if (
    types.has("historical_landmark") ||
    types.has("monument") ||
    /雕像|紀念碑|statue|monument|memorial/i.test(blob)
  ) {
    return "monument";
  }
  if (
    /老城|historic\s*district|old\s*town|古城|歴史的/i.test(blob)
  ) {
    return "historic_district";
  }
  if (types.has("cafe") || types.has("coffee_shop") || /咖啡|cafe|coffee/i.test(blob)) {
    return "cafe";
  }
  if (
    types.has("night_club") ||
    types.has("bar") ||
    /酒吧|nightlife|夜店/i.test(blob)
  ) {
    return "nightlife";
  }
  if (
    types.has("restaurant") ||
    types.has("food") ||
    /餐|料理|restaurant|dining/i.test(blob)
  ) {
    return "restaurant";
  }
  return "other";
}

/** Map family → daily diversity category key used by diversity limits. */
export function categoryFamilyToDiversityKey(
  family: PlaceCategoryFamily,
): string {
  if (family === "museum_family") return "museum_family";
  if (family === "palace_castle") return "attraction";
  if (family === "temple_shrine" || family === "church") return "shrine_temple";
  if (family === "viewpoint_family") return "viewpoint_family";
  if (family === "park_family") return "park_family";
  if (family === "market_family") return "market_family";
  return family;
}
