import type { RoamieItineraryItem } from "@/lib/ai/types";
import { normalizeItineraryItem } from "@/lib/ai/types";
import { isHardGooglePlaceId } from "@/lib/ai/planning-place-id";

export type DeliverableItineraryStopCandidate = {
  name: string;
  placeName?: string | null;
  googlePlaceId?: string | null;
  description?: string | null;
  reason?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  primaryType?: string | null;
  type?: string | null;
  types?: string[] | null;
  sourceCombinationId?: number;
  matchedCombinationIds?: number[];
  matchedSelectedCombinationIds?: number[];
  sourceRegionCandidate?: string;
  destinationScope?: "primary" | "nearby_extension";
  extensionDestination?: string;
  photoName?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  businessStatus?: string | null;
  openStatusLabel?: string;
  todayHoursLabel?: string;
};

/** Shared strict delivery boundary for deterministic rebuild and repair stops. */
export function createDeliverableItineraryStop(
  place: DeliverableItineraryStopCandidate,
  date: string,
  time: string,
  requireDeliverableIdentity = false,
): RoamieItineraryItem {
  const googlePlaceId = place.googlePlaceId?.trim();
  if (requireDeliverableIdentity && !isHardGooglePlaceId(googlePlaceId)) {
    throw new Error("candidate_to_stop_rejected:missing_google_identity");
  }
  const placeId = isHardGooglePlaceId(googlePlaceId) ? googlePlaceId : undefined;
  return normalizeItineraryItem({
    date,
    time,
    title: place.name,
    placeName: place.placeName ?? place.name,
    description: place.description || place.reason || "",
    lat: place.lat,
    lng: place.lng,
    address: place.address?.trim() || place.name,
    googlePlaceId: placeId,
    placeType: place.primaryType ?? place.type ?? undefined,
    coordinateSource:
      placeId && place.lat != null && place.lng != null ? "google_places" : undefined,
    sourceCombinationId: place.sourceCombinationId,
    matchedCombinationIds: place.matchedCombinationIds,
    matchedSelectedCombinationIds: place.matchedSelectedCombinationIds,
    sourceRegionCandidate: place.sourceRegionCandidate,
    destinationScope: place.destinationScope,
    extensionDestination: place.extensionDestination,
    photoName: place.photoName,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    businessStatus: place.businessStatus,
    openStatusLabel: place.openStatusLabel,
    todayHoursLabel: place.todayHoursLabel,
    types: place.types?.length
      ? place.types
      : place.primaryType || place.type
        ? [place.primaryType || place.type!]
        : undefined,
    placeSnapshotSource: "selected_place",
  });
}
