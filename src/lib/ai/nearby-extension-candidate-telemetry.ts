import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export type NearbyTelemetryPlace = {
  googlePlaceId?: string;
  placeId?: string;
  name?: string;
  placeName?: string;
  destinationScope?: "primary" | "nearby_extension";
  extensionDestination?: string;
};

function maskPlaceId(placeId: string | undefined): string {
  const value = placeId?.trim() ?? "";
  if (!value) return "";
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-3)}`;
}

function placeId(place: NearbyTelemetryPlace): string {
  return place.googlePlaceId?.trim() || place.placeId?.trim() || "";
}

function placeName(place: NearbyTelemetryPlace): string {
  return (place.placeName ?? place.name ?? "").trim();
}

function formatReasonSummary(reasons: Readonly<Record<string, number>>): string {
  const entries = Object.entries(reasons)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([reason, count]) => `${reason}:${count}`).join("|") : "none";
}

export function logNearbyExtensionSearchTelemetry(params: {
  requestedExtension: string;
  rawCount: number;
  acceptedPlaces: readonly NearbyTelemetryPlace[];
  rejectionReasons: Readonly<Record<string, number>>;
}): void {
  const rejectedCount = Object.values(params.rejectionReasons).reduce(
    (sum, count) => sum + count,
    0,
  );
  logAiPipeline(
    "[NEARBY_EXTENSION_SEARCH]",
    `requestedExtension=${params.requestedExtension}`,
    `rawCount=${params.rawCount}`,
    `acceptedCount=${params.acceptedPlaces.length}`,
    `rejectedCount=${rejectedCount}`,
    `acceptedPlaceCount=${params.acceptedPlaces.length}`,
    `acceptedPlaceIds=[${params.acceptedPlaces
      .map((place) => maskPlaceId(placeId(place)))
      .filter(Boolean)
      .join("|")}]`,
    `acceptedPlaceNames=[${params.acceptedPlaces.map(placeName).filter(Boolean).join("|")}]`,
    `rejectionReasons=${formatReasonSummary(params.rejectionReasons)}`,
  );
}

export function logNearbyExtensionMergeTelemetry(params: {
  requestedExtension: string;
  beforeMerge: number;
  nearbyAdded: number;
  afterMerge: number;
  calculatedCap: number;
  afterSlice: number;
  remainingPlaces: readonly NearbyTelemetryPlace[];
}): void {
  logAiPipeline(
    "[NEARBY_EXTENSION_MERGE]",
    `requestedExtension=${params.requestedExtension}`,
    `beforeMerge=${params.beforeMerge}`,
    `nearbyAdded=${params.nearbyAdded}`,
    `afterMerge=${params.afterMerge}`,
    `calculatedCap=${params.calculatedCap}`,
    `afterSlice=${params.afterSlice}`,
    `remainingNearby=${params.remainingPlaces.length}`,
    `remainingNearbyPlaceIds=[${params.remainingPlaces
      .map((place) => maskPlaceId(placeId(place)))
      .filter(Boolean)
      .join("|")}]`,
    `remainingNearbyNames=[${params.remainingPlaces.map(placeName).filter(Boolean).join("|")}]`,
    `remainingNearbyDestinationScope=[${params.remainingPlaces.map((place) => place.destinationScope ?? "").join("|")}]`,
    `remainingNearbyExtensionDestination=[${params.remainingPlaces.map((place) => place.extensionDestination ?? "").join("|")}]`,
  );
}
