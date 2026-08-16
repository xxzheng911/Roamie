import type { ChatShortcutScene } from "@/lib/ai/chat-intent";

export const RELAX_WALK_INCLUDED_TYPES = [
  "tourist_attraction",
  "park",
  "museum",
  "art_gallery",
] as const;

export const RELAX_WALK_EXCLUDED_TYPES = [
  "food",
  "restaurant",
  "cafe",
  "coffee_shop",
  "bar",
  "bakery",
  "shopping_mall",
  "shopping_center",
  "department_store",
  "store",
  "supermarket",
  "convenience_store",
  "lodging",
  "hotel",
  "train_station",
  "subway_station",
  "transit_station",
  "bus_station",
] as const;

type PlaceTypeMetadata = {
  primaryType?: string | null;
  types?: string[] | null;
};

function normalizedTypes(place: PlaceTypeMetadata): string[] {
  return [place.primaryType ?? "", ...(place.types ?? [])]
    .map((type) => type.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean);
}

/** Metadata-first guard. Generic/unknown candidates retain the existing eligibility contract. */
export function isPlaceEligibleForShortcutScene(
  place: PlaceTypeMetadata,
  scene?: ChatShortcutScene | null,
): boolean {
  if (scene !== "relax_walk") return true;
  const types = normalizedTypes(place);
  return !types.some((type) =>
    RELAX_WALK_EXCLUDED_TYPES.some(
      (excluded) => type === excluded || type.endsWith(`_${excluded}`),
    ),
  );
}
