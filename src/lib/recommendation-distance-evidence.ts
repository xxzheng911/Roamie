import { distanceMeters, formatDistanceLabel } from "@/lib/map-explore";

export type RecommendationDistanceSource =
  | "user_location"
  | "search_center"
  | "map_center"
  | "anchor"
  | "unknown";

type Coordinates = { lat: number; lng: number };

export type RecommendationDistanceEvidence = {
  distanceMeters?: number;
  distanceLabel?: string;
  distanceSource: RecommendationDistanceSource;
  userLocationAvailable: boolean;
  proximityReasonAllowed: boolean;
};

function distanceBucket(distance: number | undefined): string {
  if (distance == null || !Number.isFinite(distance)) return "none";
  if (distance < 250) return "under_250m";
  if (distance < 1_000) return "250m_to_1km";
  if (distance < 5_000) return "1km_to_5km";
  if (distance < 25_000) return "5km_to_25km";
  return "25km_plus";
}

export function resolveRecommendationDistanceEvidence(
  place: { lat?: number | null; lng?: number | null },
  userLocation: Coordinates | null | undefined,
): RecommendationDistanceEvidence {
  if (!userLocation || place.lat == null || place.lng == null) {
    return {
      distanceSource: "unknown",
      userLocationAvailable: false,
      proximityReasonAllowed: false,
    };
  }

  const value = distanceMeters(userLocation, { lat: place.lat, lng: place.lng });
  return {
    distanceMeters: value,
    distanceLabel: formatDistanceLabel(value),
    distanceSource: "user_location",
    userLocationAvailable: true,
    proximityReasonAllowed: true,
  };
}

export function logRecommendationDistanceEvidence(input: {
  canonicalPlaceId: string;
  evidence: RecommendationDistanceEvidence;
  surface: string;
}): void {
  const { evidence } = input;
  console.info(
    "[RECOMMENDATION_DISTANCE_EVIDENCE] " +
      `hasCanonicalPlaceId=${Boolean(input.canonicalPlaceId)} ` +
      `distanceBucket=${distanceBucket(evidence.distanceMeters)} ` +
      `distanceSource=${evidence.distanceSource} ` +
      `userLocationAvailable=${evidence.userLocationAvailable} ` +
      `proximityReasonAllowed=${evidence.proximityReasonAllowed} surface=${input.surface}`,
  );
}

export function logExploreDistanceDisplay(input: {
  canonicalPlaceId: string;
  evidence: RecommendationDistanceEvidence;
  displayed: boolean;
  fallbackReason?: string;
}): void {
  console.info(
    "[EXPLORE_DISTANCE_DISPLAY] " +
      `hasCanonicalPlaceId=${Boolean(input.canonicalPlaceId)} ` +
      `distanceSource=${input.evidence.distanceSource} ` +
      `distanceBucket=${distanceBucket(input.evidence.distanceMeters)} ` +
      `displayed=${input.displayed} fallbackReason=${input.fallbackReason ?? "none"}`,
  );
}
