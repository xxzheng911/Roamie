import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { invalidItineraryStopReason } from "@/lib/ai/generic-place-label";
import { isHardGooglePlaceId } from "@/lib/ai/planning-place-id";
import { resolveAdministrativeScope } from "@/lib/ai/administrative-locality";
import { computeMinimumPlacesForTripDays } from "@/lib/ai/real-place-supplement";

export type DeliverableCandidateRejectionReason =
  | "missing_google_identity"
  | "invalid_coordinates"
  | "generic_name"
  | "operational_ineligible"
  | "out_of_scope"
  | "duplicate"
  | "other";

export type ItineraryCandidateSourceType =
  | "legacy_selected_places"
  | "recommendation_candidate"
  | "supplemental_pool"
  | "extension_pool"
  | "planner_synthesized_candidate"
  | "fallback_candidate"
  | "normalized_minimal_place"
  | "other";

export type SourcedItineraryCandidate = {
  candidate: RoamieRecommendationItem;
  sourceType: ItineraryCandidateSourceType;
};

export type DeliverableCandidateDecision = {
  deliverable: boolean;
  reason?: DeliverableCandidateRejectionReason;
};

function coordinatesValid(candidate: RoamieRecommendationItem): boolean {
  return Boolean(
    Number.isFinite(candidate.lat) &&
      Number.isFinite(candidate.lng) &&
      Math.abs(candidate.lat ?? 0) > 0.001 &&
      Math.abs(candidate.lng ?? 0) > 0.001,
  );
}

export function isDeliverableItineraryCandidate(
  candidate: RoamieRecommendationItem,
  destination: string,
): DeliverableCandidateDecision {
  if (!isHardGooglePlaceId(candidate.googlePlaceId)) {
    return { deliverable: false, reason: "missing_google_identity" };
  }
  if (!coordinatesValid(candidate)) {
    return { deliverable: false, reason: "invalid_coordinates" };
  }
  const name = (candidate.placeName ?? candidate.name).trim();
  const placeValidityReason = invalidItineraryStopReason(
    {
      name: candidate.name,
      placeName: candidate.placeName,
      googlePlaceId: candidate.googlePlaceId,
      address: candidate.address,
      lat: candidate.lat,
      lng: candidate.lng,
      primaryType: candidate.primaryType,
      types: candidate.types,
    },
    destination,
  );
  if (!name || placeValidityReason === "generic_name") {
    return { deliverable: false, reason: "generic_name" };
  }
  if (placeValidityReason) return { deliverable: false, reason: "other" };
  const status = (candidate.businessStatus ?? "").trim().toUpperCase();
  if (status === "CLOSED_TEMPORARILY" || status === "CLOSED_PERMANENTLY") {
    return { deliverable: false, reason: "operational_ineligible" };
  }
  const { candidateLocality, destinationLocality } = resolveAdministrativeScope(
    destination,
    candidate.address,
  );
  if (
    destinationLocality.canonicalCity &&
    candidateLocality.canonicalCity &&
    destinationLocality.canonicalCity !== candidateLocality.canonicalCity
  ) {
    return { deliverable: false, reason: "out_of_scope" };
  }
  return { deliverable: true };
}

export function buildDeliverableItineraryCandidatePool(
  candidates: readonly SourcedItineraryCandidate[],
  destination: string,
) {
  const eligible: SourcedItineraryCandidate[] = [];
  const rejected: Array<SourcedItineraryCandidate & { reason: DeliverableCandidateRejectionReason }> = [];
  const seenGoogleIds = new Set<string>();
  for (const sourced of candidates) {
    const decision = isDeliverableItineraryCandidate(sourced.candidate, destination);
    if (!decision.deliverable) {
      rejected.push({ ...sourced, reason: decision.reason ?? "other" });
      continue;
    }
    const googleId = sourced.candidate.googlePlaceId!.trim().replace(/^places\//i, "");
    if (seenGoogleIds.has(googleId)) {
      rejected.push({ ...sourced, reason: "duplicate" });
      continue;
    }
    seenGoogleIds.add(googleId);
    eligible.push(sourced);
  }
  const rejectionReasonCounts = rejected.reduce<Record<string, number>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
    return counts;
  }, {});
  return {
    inputCount: candidates.length,
    googleIdentityCount: candidates.filter(({ candidate }) => isHardGooglePlaceId(candidate.googlePlaceId)).length,
    eligible,
    rejected,
    deliverableCount: eligible.length,
    rejectedCount: rejected.length,
    rejectionReasonCounts,
  };
}

export function assessDeterministicRebuildCapacity(deliverableCount: number, days: number) {
  const minimumRequiredEntries = computeMinimumPlacesForTripDays(days);
  const sufficient = deliverableCount >= minimumRequiredEntries;
  return {
    minimumRequiredEntries,
    sufficient,
    buildBlockedReason: sufficient ? "none" : "insufficient_deliverable_capacity",
  } as const;
}
