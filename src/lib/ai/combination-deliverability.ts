import { isHardGooglePlaceId } from "./planning-place-id";
/** Choice-list delivery only. Selecting ONE option for itinerary generation is
 * a separate contract and must not use this minimum. Apply after existing
 * identity, category, geography and locale validation; never repairs candidates. */
export const MIN_DELIVERABLE_COMBINATIONS = 2;
export function hasDeliverableCombinationCount(combinations: readonly unknown[] | null | undefined): boolean {
  return (combinations?.length ?? 0) >= MIN_DELIVERABLE_COMBINATIONS;
}

/** Identity requirements for a selectable, routable provider place. Never repairs data. */
export function hasDeliverablePlaceIdentity(id: string | null | undefined, lat: unknown, lng: unknown): boolean {
  return isHardGooglePlaceId(id) && typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    (Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001);
}
