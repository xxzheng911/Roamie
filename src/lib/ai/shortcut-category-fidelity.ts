import type { ChatShortcutScene } from "@/lib/ai/chat-intent";
import {
  isCoffeeFallbackPlace,
  isCoffeePrimaryPlace,
  isRainyPreferredPlace,
  classifyNearbyShortcutPlaceKind,
  nearbySearchAttemptsForShortcutScene,
  selectShortcutSceneCandidates,
} from "@/lib/ai/nearby-shortcut-ranking";
import { resolveResidentialPlace } from "@/lib/ai/residential-place";
import { logShortcutRuntime } from "@/lib/ai/shortcut-runtime-diag";

export const RELAX_WALK_INCLUDED_TYPES = [
  "park",
  "garden",
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

export const COFFEE_INCLUDED_TYPES = [
  "cafe",
  "coffee_shop",
] as const;

export const COFFEE_FALLBACK_INCLUDED_TYPES = [
  "cafe",
  "coffee_shop",
  "bakery",
] as const;

export const RAINY_INCLUDED_TYPES = [
  "museum",
  "art_gallery",
  "cafe",
  "coffee_shop",
  "book_store",
  "library",
  "shopping_mall",
  "aquarium",
] as const;

type PlaceTypeMetadata = {
  id?: string | null;
  name?: string | null;
  address?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  category?: string | null;
};

function normalizedTypes(place: PlaceTypeMetadata): string[] {
  return [place.primaryType ?? "", ...(place.types ?? [])]
    .map((type) => type.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean);
}

function isRelaxExcludedPlace(place: PlaceTypeMetadata): boolean {
  const types = normalizedTypes(place);
  return types.some((type) =>
    RELAX_WALK_EXCLUDED_TYPES.some(
      (excluded) => type === excluded || type.endsWith(`_${excluded}`),
    ),
  );
}

/** Metadata-first guard. Coffee/Rainy use staged filters; unknown types stay eligible. */
export function isPlaceEligibleForShortcutScene(
  place: PlaceTypeMetadata,
  scene?: ChatShortcutScene | null,
): boolean {
  if (!scene) return true;
  if (scene !== "quiet_cafe" && resolveResidentialPlace(place).residential) return false;
  if (scene === "relax_walk") return !isRelaxExcludedPlace(place);
  if (scene === "quiet_cafe") {
    if (isCoffeePrimaryPlace(place) || isCoffeeFallbackPlace(place)) return true;
    return false;
  }
  if (scene === "rainy_indoor") return true;
  return true;
}

export function filterPlacesForShortcutScene<T extends PlaceTypeMetadata>(
  places: T[],
  scene?: ChatShortcutScene | null,
): T[] {
  const eligible = places.filter((place) => {
    if (scene !== "relax_walk" && scene !== "rainy_indoor") {
      return isPlaceEligibleForShortcutScene(place, scene);
    }
    const residential = resolveResidentialPlace(place);
    if (residential.residential) {
      logShortcutRuntime("[RT_RESIDENTIAL_FILTER]", {
        placeName: place.name ?? "",
        placeId: place.id ?? "",
        primaryType: place.primaryType ?? "",
        types: place.types ?? [],
        inferredCategory: classifyNearbyShortcutPlaceKind(place),
        residentialDetected: true,
        residentialSource: residential.source,
        residentialMatchedValue: residential.matchedValue,
        rejected: true,
        scene,
      });
      return false;
    }
    return isPlaceEligibleForShortcutScene(place, scene);
  });
  return selectShortcutSceneCandidates(eligible, scene);
}

export function includedTypesForShortcutScene(
  scene?: ChatShortcutScene | null,
): string[] {
  if (scene === "quiet_cafe") return [...COFFEE_INCLUDED_TYPES];
  if (scene === "rainy_indoor") return [...RAINY_INCLUDED_TYPES];
  if (scene === "relax_walk") return [...RELAX_WALK_INCLUDED_TYPES];
  return [];
}

export function excludedTypesForShortcutScene(
  scene?: ChatShortcutScene | null,
): string[] {
  if (scene === "relax_walk") return [...RELAX_WALK_EXCLUDED_TYPES];
  if (scene === "quiet_cafe") {
    return ["park", "bridge", "museum", "art_gallery", "tourist_attraction"];
  }
  if (scene === "rainy_indoor") return ["hiking_area", "campground"];
  return [];
}

export { nearbySearchAttemptsForShortcutScene, isRainyPreferredPlace };
