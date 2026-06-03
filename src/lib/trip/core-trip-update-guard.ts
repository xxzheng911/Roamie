import type { Itinerary } from "@/lib/itinerary.functions";
import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";
import {
  diffTripPersistFields,
  tripPayloadFingerprint,
  tripPayloadsEqual,
} from "@/lib/trip/trip-payload-persist";

const updatingTripIds = new Set<string>();
const lastSavedFingerprint = new Map<string, string>();

export type CoreTripUpdateSkipReason = "in_flight" | "unchanged" | "duplicate_fingerprint";

export type CoreTripUpdateDecision = {
  shouldWrite: boolean;
  skipReason?: CoreTripUpdateSkipReason;
  changedFields: string[];
  nextFingerprint: string;
};

export function logCoreTripUpdateRequested(tripId: string, reason: string): void {
  console.info("[CORE_TRIP_UPDATE_REQUESTED]", { tripId, reason });
}

export function logCoreTripUpdateSkipped(
  tripId: string,
  reason: string,
  changedFields: string[],
  skipReason: CoreTripUpdateSkipReason,
): void {
  console.info("[CORE_TRIP_UPDATE_SKIPPED]", { tripId, reason, changedFields, skipReason });
}

export function logCoreTripUpdateSuccess(
  tripId: string,
  reason: string,
  changedFields: string[],
): void {
  console.info("[CORE_TRIP_UPDATE_SUCCESS]", { tripId, reason, changedFields });
}

export function isCoreTripUpdateInFlight(tripId: string): boolean {
  return updatingTripIds.has(tripId);
}

export function beginCoreTripUpdate(tripId: string): void {
  updatingTripIds.add(tripId);
}

export function endCoreTripUpdate(tripId: string, fingerprint: string): void {
  updatingTripIds.delete(tripId);
  lastSavedFingerprint.set(tripId, fingerprint);
}

/** 新建／剛寫入後登記指紋，避免詳情頁載入又觸發相同 payload 的 update */
export function seedCoreTripPersistedFingerprint(
  tripId: string,
  payload: Itinerary | RoamiePayloadV2,
  mood?: string | null,
): void {
  lastSavedFingerprint.set(tripId, tripPayloadFingerprint(payload, mood ?? null));
}

export function abortCoreTripUpdate(tripId: string): void {
  updatingTripIds.delete(tripId);
}

export function evaluateCoreTripUpdate(params: {
  tripId: string;
  existingPayload: Itinerary | RoamiePayloadV2 | null | undefined;
  existingMood?: string | null;
  nextPayload: Itinerary | RoamiePayloadV2;
  nextMood?: string | null;
}): CoreTripUpdateDecision {
  const changedFields = diffTripPersistFields(
    params.existingPayload,
    params.nextPayload,
    params.existingMood,
    params.nextMood,
  );
  const nextFingerprint = tripPayloadFingerprint(params.nextPayload, params.nextMood ?? null);

  if (updatingTripIds.has(params.tripId)) {
    return { shouldWrite: false, skipReason: "in_flight", changedFields, nextFingerprint };
  }

  if (
    tripPayloadsEqual(
      params.existingPayload,
      params.nextPayload,
      params.existingMood,
      params.nextMood,
    )
  ) {
    return { shouldWrite: false, skipReason: "unchanged", changedFields: [], nextFingerprint };
  }

  const prevFingerprint = lastSavedFingerprint.get(params.tripId);
  if (prevFingerprint && prevFingerprint === nextFingerprint) {
    return {
      shouldWrite: false,
      skipReason: "duplicate_fingerprint",
      changedFields,
      nextFingerprint,
    };
  }

  return { shouldWrite: true, changedFields, nextFingerprint };
}

/** @internal vitest only */
export function resetCoreTripUpdateGuardForTests(): void {
  updatingTripIds.clear();
  lastSavedFingerprint.clear();
}
