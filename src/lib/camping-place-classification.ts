import { collectPlaceTypes } from "@/lib/place-identity";

export type CampingPlaceLike = {
  name?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
};

const EXPLICIT_CAMPING_TYPES = new Set([
  "campground",
  "rv_park",
  "camping_cabin",
  "childrens_camp",
]);

/**
 * Canonical camping identity authority.
 *
 * A name or a recommendation family is not sufficient evidence: stores and
 * ordinary parks must not become itinerary stops merely because their label
 * mentions camping. Google/normalized place types are the authority here.
 */
export function isExplicitCampingPlace(place: CampingPlaceLike): boolean {
  return collectPlaceTypes(place).some((type) => EXPLICIT_CAMPING_TYPES.has(type));
}
