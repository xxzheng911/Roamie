import { distanceMeters } from "@/lib/geo-distance";
import { resolveParentLandmark } from "@/lib/ai/landmark-cluster";
import { resolveCanonicalPlaceIdentity } from "@/lib/place-canonical-identity";
import type { PlaceResult } from "@/lib/place-result";

export type VenueHierarchyRelation =
  | "same_entity"
  | "ancestor"
  | "descendant"
  | "sibling"
  | "unrelated";

export type VenueHierarchyEvidenceType =
  | "canonical_identity"
  | "provider_parent"
  | "shared_venue_core_and_child_marker"
  | "strong_name_containment_and_venue"
  | "none";

export type VenueHierarchyPlace = Omit<Pick<
  PlaceResult,
  "id" | "googlePlaceId" | "name" | "address" | "lat" | "lng" | "primaryType" | "types"
>, "id"> & {
  id?: string;
  parentPlaceId?: string | null;
  containedInPlaceId?: string | null;
};

export type VenueHierarchyDecision = {
  relation: VenueHierarchyRelation;
  evidenceType: VenueHierarchyEvidenceType;
  confidence: "high" | "medium" | "none";
  parentChildRole: "parent" | "child" | "standalone";
};

function normalizedAddress(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function sameVenueSupport(a: VenueHierarchyPlace, b: VenueHierarchyPlace): boolean {
  const leftAddress = normalizedAddress(a.address);
  const rightAddress = normalizedAddress(b.address);
  if (leftAddress && rightAddress && (leftAddress === rightAddress || leftAddress.includes(rightAddress) || rightAddress.includes(leftAddress))) {
    return true;
  }
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return false;
  return distanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) <= 300;
}

function asPlaceResult(place: VenueHierarchyPlace): PlaceResult {
  return {
    id: place.id ?? place.googlePlaceId ?? place.name,
    googlePlaceId: place.googlePlaceId,
    name: place.name,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    rating: null,
    userRatingCount: null,
    photoName: null,
    primaryType: place.primaryType,
    types: place.types,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

/** Pairwise, destination-agnostic venue hierarchy decision shared by recommendation and itinerary exclusion. */
export function resolveVenueHierarchyRelation(
  parent: VenueHierarchyPlace,
  candidate: VenueHierarchyPlace,
): VenueHierarchyDecision {
  const parentCanonical = resolveCanonicalPlaceIdentity(parent).identityKey;
  const candidateCanonical = resolveCanonicalPlaceIdentity(candidate).identityKey;
  if (parentCanonical && parentCanonical === candidateCanonical) {
    return { relation: "same_entity", evidenceType: "canonical_identity", confidence: "high", parentChildRole: "standalone" };
  }

  const parentId = (parent.googlePlaceId ?? parent.id ?? "").trim();
  const candidateId = (candidate.googlePlaceId ?? candidate.id ?? "").trim();
  if (candidate.parentPlaceId === parentId || candidate.containedInPlaceId === parentId) {
    return { relation: "ancestor", evidenceType: "provider_parent", confidence: "high", parentChildRole: "child" };
  }
  if (parent.parentPlaceId === candidateId || parent.containedInPlaceId === candidateId) {
    return { relation: "descendant", evidenceType: "provider_parent", confidence: "high", parentChildRole: "parent" };
  }

  const parentLandmark = resolveParentLandmark(asPlaceResult(parent));
  const candidateLandmark = resolveParentLandmark(asPlaceResult(candidate));
  const sharedCore = Boolean(
    parentLandmark.parentLandmarkKey &&
      parentLandmark.parentLandmarkKey === candidateLandmark.parentLandmarkKey,
  );
  const venueSupported = sameVenueSupport(parent, candidate);
  if (sharedCore && venueSupported && candidateLandmark.isSubPlace && !parentLandmark.isSubPlace) {
    return { relation: "ancestor", evidenceType: "shared_venue_core_and_child_marker", confidence: "high", parentChildRole: "child" };
  }
  if (sharedCore && venueSupported && parentLandmark.isSubPlace && !candidateLandmark.isSubPlace) {
    return { relation: "descendant", evidenceType: "shared_venue_core_and_child_marker", confidence: "high", parentChildRole: "parent" };
  }
  if (sharedCore && venueSupported && parentLandmark.isSubPlace && candidateLandmark.isSubPlace) {
    return { relation: "sibling", evidenceType: "shared_venue_core_and_child_marker", confidence: "medium", parentChildRole: "child" };
  }

  const parentCore = parentLandmark.parentLandmarkKey ?? "";
  const candidateCore = candidateLandmark.parentLandmarkKey ?? "";
  const contained = parentCore.length >= 3 && candidateCore.includes(parentCore) && candidateCore !== parentCore;
  if (contained && venueSupported && candidateLandmark.isSubPlace) {
    return { relation: "ancestor", evidenceType: "strong_name_containment_and_venue", confidence: "medium", parentChildRole: "child" };
  }
  return { relation: "unrelated", evidenceType: "none", confidence: "none", parentChildRole: candidateLandmark.isSubPlace ? "child" : "standalone" };
}

export type PlaceExclusionDecision = {
  excluded: boolean;
  matchReason: "place_id" | "canonical_identity" | "ancestor_excluded" | null;
  matchedExcludedIndex: number | null;
  parentVenueMatched: boolean;
  excludedAncestorIndex: number | null;
  hierarchyEvidence: VenueHierarchyEvidenceType;
  parentChildRole: VenueHierarchyDecision["parentChildRole"];
};

export function isExcludedByPlaceOrAncestor(
  candidate: VenueHierarchyPlace,
  explicitExcludedIds: readonly string[],
  explicitExcludedPlaces: readonly VenueHierarchyPlace[],
): PlaceExclusionDecision {
  const candidateId = (candidate.googlePlaceId ?? candidate.id ?? "").trim();
  const exactIndex = explicitExcludedIds.indexOf(candidateId);
  if (exactIndex >= 0) return { excluded: true, matchReason: "place_id", matchedExcludedIndex: exactIndex, parentVenueMatched: false, excludedAncestorIndex: null, hierarchyEvidence: "none", parentChildRole: "standalone" };

  const candidateCanonical = resolveCanonicalPlaceIdentity(candidate).identityKey;
  for (let index = 0; index < explicitExcludedPlaces.length; index += 1) {
    const excluded = explicitExcludedPlaces[index]!;
    if (resolveCanonicalPlaceIdentity(excluded).identityKey === candidateCanonical) {
      return { excluded: true, matchReason: "canonical_identity", matchedExcludedIndex: index, parentVenueMatched: false, excludedAncestorIndex: null, hierarchyEvidence: "canonical_identity", parentChildRole: "standalone" };
    }
    const hierarchy = resolveVenueHierarchyRelation(excluded, candidate);
    if (hierarchy.relation === "ancestor") {
      return { excluded: true, matchReason: "ancestor_excluded", matchedExcludedIndex: index, parentVenueMatched: true, excludedAncestorIndex: index, hierarchyEvidence: hierarchy.evidenceType, parentChildRole: hierarchy.parentChildRole };
    }
  }
  return { excluded: false, matchReason: null, matchedExcludedIndex: null, parentVenueMatched: false, excludedAncestorIndex: null, hierarchyEvidence: "none", parentChildRole: "standalone" };
}
