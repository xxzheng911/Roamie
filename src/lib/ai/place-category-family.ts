/**
 * Shared place category family — Candidate Pool / Planner / Validator / Auto Repair.
 * Collapses Google type variants (museum / history_museum / art_museum → museum).
 */
import type { PlaceResult } from "@/lib/place-result";

export type PlaceCategoryFamily =
  | "museum"
  | "gallery"
  | "temple_shrine"
  | "church"
  | "park"
  | "garden"
  | "market"
  | "shopping"
  | "viewpoint"
  | "beach"
  | "historic_district"
  | "monument"
  | "theme_park"
  | "zoo_aquarium"
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

  if (
    types.has("amusement_park") ||
    types.has("theme_park") ||
    /主題樂園|theme\s*park|disney|universal\s*studios/i.test(blob)
  ) {
    return "theme_park";
  }
  if (
    types.has("zoo") ||
    types.has("aquarium") ||
    /動物園|水族館|zoo|aquarium/i.test(blob)
  ) {
    return "zoo_aquarium";
  }
  if (looksMuseumFamily(types, blob)) {
    if (types.has("art_gallery") || /美術館|art\s*gallery|gallery/i.test(blob)) {
      return "gallery";
    }
    return "museum";
  }
  if (
    types.has("castle") ||
    types.has("palace") ||
    /城|宮殿|castle|palace|皇宮/i.test(blob)
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
    return "viewpoint";
  }
  if (types.has("beach") || /海灘|beach|海水浴場/i.test(blob)) return "beach";
  if (
    types.has("hiking_area") ||
    types.has("national_park") ||
    /步道|trail|hiking|登山/i.test(blob)
  ) {
    return "nature_trail";
  }
  if (types.has("garden") || /庭園|植物園|garden/i.test(blob)) return "garden";
  if (types.has("park") || /公園|park/i.test(blob)) return "park";
  if (
    types.has("market") ||
    /市場|夜市|market/i.test(blob)
  ) {
    return "market";
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
  if (family === "gallery") return "museum";
  if (family === "palace_castle") return "attraction";
  if (family === "temple_shrine" || family === "church") return "shrine_temple";
  if (family === "viewpoint") return "viewpoint_tower";
  if (family === "park" || family === "garden" || family === "nature_trail") {
    return "ordinary_park";
  }
  if (family === "market") return "ordinary_market";
  return family;
}
