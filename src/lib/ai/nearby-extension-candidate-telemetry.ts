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

export function logNearbyExtensionPreservationDecision(params: {
  requestedExtension: string;
  verifiedCount: number;
  minimumRequired: number;
  preservedCount: number;
  rejectedCount: number;
  replacementCount: number;
  calculatedCap: number;
  finalPoolCount: number;
  sufficient: boolean;
  reason: string;
  stage: "post_merge" | "global_selection";
}): void {
  logAiPipeline(
    "[NEARBY_EXTENSION_PRESERVATION_DECISION]",
    `requestedExtension=${params.requestedExtension}`,
    `verifiedCount=${params.verifiedCount}`,
    `minimumRequired=${params.minimumRequired}`,
    `preservedCount=${params.preservedCount}`,
    `rejectedCount=${params.rejectedCount}`,
    `replacementCount=${params.replacementCount}`,
    `calculatedCap=${params.calculatedCap}`,
    `finalPoolCount=${params.finalPoolCount}`,
    `sufficient=${params.sufficient}`,
    `reason=${params.reason}`,
    `stage=${params.stage}`,
  );
}

export function logNearbyExtensionCandidatePreservationDecision(params: {
  place: NearbyTelemetryPlace;
  extension: string;
  stage: "post_merge" | "global_selection";
  decision: "dropped_after_minimum" | "rejected_global_capacity";
  reason: "bounded_cap" | "global_family_capacity";
  replacementExtension?: string;
}): void {
  logAiPipeline(
    "[NEARBY_EXTENSION_CANDIDATE_DECISION]",
    `placeIdMasked=${maskPlaceId(placeId(params.place))}`,
    `extension=${params.extension}`,
    `stage=${params.stage}`,
    `decision=${params.decision}`,
    `reason=${params.reason}`,
    `replacementExtension=${params.replacementExtension ?? ""}`,
  );
}

export function logNearbyExtensionRecoveryTrigger(params: {
  requestedExtension: string;
  triggerReason: string;
  rateLimitSignal: string;
  searchCandidateCount: number;
  recoveryAttempted: boolean;
  generationRequestId?: string;
}): void {
  logAiPipeline(
    "[NEARBY_EXTENSION_RECOVERY_TRIGGER]",
    `requestedExtension=${params.requestedExtension}`,
    `triggerReason=${params.triggerReason}`,
    `rateLimitSignal=${params.rateLimitSignal}`,
    `searchCandidateCount=${params.searchCandidateCount}`,
    `recoveryAttempted=${params.recoveryAttempted}`,
    "activePath=prepareDirectItinerarySession",
    `generationRequestId=${params.generationRequestId ?? ""}`,
  );
}

export function logNearbyExtensionRecoverySummary(params: {
  requestedExtension: string;
  sourceCounts: Readonly<Record<string, number>>;
  totalRecoveredBeforeDedupe: number;
  recoveredAfterDedupe: number;
  verifiedCount: number;
  minimumRequired: number;
  provenanceCount: number;
  sourceRegionCount: number;
  textFallbackCount: number;
  sufficient: boolean;
  reason: string;
}): void {
  logAiPipeline(
    "[NEARBY_EXTENSION_RECOVERY_SUMMARY]",
    `requestedExtension=${params.requestedExtension}`,
    `sourceCounts=${formatReasonSummary(params.sourceCounts)}`,
    `totalRecoveredBeforeDedupe=${params.totalRecoveredBeforeDedupe}`,
    `recoveredAfterDedupe=${params.recoveredAfterDedupe}`,
    `verifiedCount=${params.verifiedCount}`,
    `minimumRequired=${params.minimumRequired}`,
    `provenanceCount=${params.provenanceCount}`,
    `sourceRegionCount=${params.sourceRegionCount}`,
    `textFallbackCount=${params.textFallbackCount}`,
    `sufficient=${params.sufficient}`,
    `reason=${params.reason}`,
  );
}

export function logNearbyExtensionRecoveryReject(params: {
  place: NearbyTelemetryPlace;
  source: string;
  reason: string;
  extension: string;
}): void {
  logAiPipeline(
    "[NEARBY_EXTENSION_RECOVERY_REJECT]",
    `placeIdMasked=${maskPlaceId(placeId(params.place))}`,
    `source=${params.source}`,
    `reason=${params.reason}`,
    `extension=${params.extension}`,
  );
}
