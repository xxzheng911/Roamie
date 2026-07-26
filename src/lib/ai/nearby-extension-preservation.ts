import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { combinationIdsFromPlace } from "@/lib/ai/combination-provenance";
import { computeMinimumPerSelectedCombination } from "@/lib/ai/combination-itinerary-integrity";
import { NEARBY_EXTENSION_MIN_STOPS } from "@/lib/ai/nearby-extension-requirements";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { isMappableGooglePlaceId } from "@/lib/ai/map-named-places-to-google";

export type NearbyExtensionCandidate = RoamieRecommendationItem & {
  placeId?: string;
};

export type NearbyExtensionPreservationDecision = {
  requestedExtension: string;
  verifiedCount: number;
  minimumRequired: number;
  preservedCount: number;
  rejectedCount: number;
  replacementCount: number;
  sufficient: boolean;
  reason: "preserved" | "insufficient_verified_candidates" | "no_verified_candidates";
};

function candidateKey(candidate: NearbyExtensionCandidate): string {
  return (
    candidate.googlePlaceId?.trim() ||
    candidate.placeId?.trim() ||
    `${candidate.placeName ?? candidate.name}@${candidate.lat ?? ""},${candidate.lng ?? ""}`
  );
}

export function matchesNearbyExtension(
  candidate: NearbyExtensionCandidate,
  requestedExtension: string,
): boolean {
  const extension = normalizeDestinationLabel(requestedExtension);
  if (!extension || candidate.destinationScope === "primary") return false;
  const explicitExtension = normalizeDestinationLabel(candidate.extensionDestination ?? "");
  if (candidate.destinationScope === "nearby_extension" && explicitExtension === extension) {
    return true;
  }
  return normalizeDestinationLabel(candidate.sourceRegionCandidate ?? "") === extension;
}

export function isVerifiedNearbyExtensionCandidate(
  candidate: NearbyExtensionCandidate,
  requestedExtension: string,
): boolean {
  const id = candidate.googlePlaceId?.trim() || candidate.placeId?.trim();
  return (
    isMappableGooglePlaceId(id) &&
    candidate.lat != null &&
    candidate.lng != null &&
    matchesNearbyExtension(candidate, requestedExtension)
  );
}

/**
 * Preserve required identities, selected-combination representatives, and the
 * formal nearby-extension minimum before filling the remaining bounded target
 * in the existing candidate order.
 */
export function selectBoundedCandidatesWithNearbyMinimum(params: {
  candidates: NearbyExtensionCandidate[];
  targetCount: number;
  selectedCombinationIds: number[];
  nearbyExtensions: string[];
  minimumNearbyCount?: number;
}): {
  selected: NearbyExtensionCandidate[];
  hardPreservedCount: number;
  finalBoundedCount: number;
  decisions: NearbyExtensionPreservationDecision[];
} {
  const minimumNearbyCount = params.minimumNearbyCount ?? NEARBY_EXTENSION_MIN_STOPS;
  const requestedExtensions = [
    ...new Set(params.nearbyExtensions.map(normalizeDestinationLabel).filter(Boolean)),
  ];
  const selected: NearbyExtensionCandidate[] = [];
  const selectedKeys = new Set<string>();
  const add = (candidate: NearbyExtensionCandidate): boolean => {
    const key = candidateKey(candidate);
    if (!key || selectedKeys.has(key)) return false;
    selectedKeys.add(key);
    selected.push(candidate);
    return true;
  };

  for (const candidate of params.candidates) {
    if (candidate.isRequiredBySelection) add(candidate);
  }

  const minimumPerCombination = computeMinimumPerSelectedCombination(
    Math.max(params.targetCount, params.selectedCombinationIds.length * 2),
    params.selectedCombinationIds.length,
  );
  for (const combinationId of params.selectedCombinationIds) {
    let covered = selected.filter((candidate) =>
      combinationIdsFromPlace(candidate).includes(combinationId),
    ).length;
    for (const candidate of params.candidates) {
      if (covered >= minimumPerCombination) break;
      if (!combinationIdsFromPlace(candidate).includes(combinationId)) continue;
      if (add(candidate)) covered += 1;
    }
  }

  const decisions: NearbyExtensionPreservationDecision[] = [];
  for (const extension of requestedExtensions) {
    const candidates = params.candidates.filter((candidate) =>
      isVerifiedNearbyExtensionCandidate(candidate, extension),
    );
    let preservedCount = selected.filter((candidate) =>
      matchesNearbyExtension(candidate, extension),
    ).length;
    for (const candidate of candidates) {
      if (preservedCount >= minimumNearbyCount) break;
      if (add(candidate)) preservedCount += 1;
    }
    const sufficient =
      candidates.length >= minimumNearbyCount && preservedCount >= minimumNearbyCount;
    decisions.push({
      requestedExtension: extension,
      verifiedCount: candidates.length,
      minimumRequired: minimumNearbyCount,
      preservedCount,
      rejectedCount: Math.max(0, candidates.length - preservedCount),
      replacementCount: 0,
      sufficient,
      reason:
        candidates.length === 0
          ? "no_verified_candidates"
          : sufficient
            ? "preserved"
            : "insufficient_verified_candidates",
    });
  }

  const hardPreservedCount = selected.length;
  const finalBoundedCount = Math.max(params.targetCount, hardPreservedCount);
  for (const candidate of params.candidates) {
    if (selected.length >= finalBoundedCount) break;
    add(candidate);
  }

  return { selected, hardPreservedCount, finalBoundedCount, decisions };
}
