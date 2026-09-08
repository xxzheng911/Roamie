import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import { isHardGooglePlaceId } from "@/lib/ai/planning-place-id";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import { resolveCanonicalPlaceIdentity } from "@/lib/place-canonical-identity";

function normalized(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().toLowerCase().replace(/臺/g, "台").replace(/[^\p{L}\p{N}]+/gu, "");
}

function anonymousHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function itineraryStopHash(stop: RoamieItineraryItem): string {
  return anonymousHash(
    [stop.placeName, stop.title, stop.originalName, stop.address, stop.lat?.toFixed(4), stop.lng?.toFixed(4)]
      .map(normalized)
      .join("|"),
  );
}

export function itineraryInternalIdentityHashes(
  stops: readonly RoamieItineraryItem[],
): string[] {
  return stops
    .filter((stop) => !isHardGooglePlaceId(stop.googlePlaceId))
    .map(itineraryStopHash);
}

function candidateName(candidate: RoamieRecommendationItem): string {
  return candidate.placeName?.trim() || candidate.name.trim();
}

function coordinatesMatch(
  stop: Pick<RoamieItineraryItem, "lat" | "lng">,
  candidate: Pick<RoamieRecommendationItem, "lat" | "lng">,
): boolean {
  if (stop.lat == null || stop.lng == null || candidate.lat == null || candidate.lng == null) {
    return false;
  }
  const meanLatRadians = ((stop.lat + candidate.lat) / 2) * (Math.PI / 180);
  const northMeters = (stop.lat - candidate.lat) * 111_320;
  const eastMeters = (stop.lng - candidate.lng) * 111_320 * Math.cos(meanLatRadians);
  return Math.hypot(northMeters, eastMeters) <= 35;
}

export type ItineraryIdentityLookupReason =
  | "already_google"
  | "canonical_identity"
  | "source_key"
  | "name_address"
  | "name_coordinate"
  | "ambiguous"
  | "source_candidate_missing_google_id"
  | "no_match";

export type ItineraryIdentityLookupDecision = {
  candidateIndex: number | null;
  candidate: RoamieRecommendationItem | null;
  reason: ItineraryIdentityLookupReason;
  ambiguous: boolean;
};

function nameKeys(values: Array<string | null | undefined>): Set<string> {
  return new Set(
    values.flatMap((value) => {
      const simple = normalized(value);
      const canonical = normalized(normalizePlaceName(value ?? ""));
      return [simple, canonical].filter(Boolean);
    }),
  );
}

export function inspectItineraryIdentityLookup(
  stop: RoamieItineraryItem,
  candidates: readonly RoamieRecommendationItem[],
): ItineraryIdentityLookupDecision {
  const identity = stop.googlePlaceId?.trim() ?? "";
  if (isHardGooglePlaceId(identity)) {
    const candidateIndex = candidates.findIndex((candidate) => candidate.googlePlaceId?.trim() === identity);
    return { candidateIndex: candidateIndex >= 0 ? candidateIndex : null, candidate: candidateIndex >= 0 ? candidates[candidateIndex]! : null, reason: "already_google", ambiguous: false };
  }
  const stopNames = nameKeys([stop.placeName, stop.title, stop.originalName, stop.localizedDisplayName]);
  const stopAddress = normalized(stop.address);
  const stopCanonical = resolveCanonicalPlaceIdentity({
    googlePlaceId: stop.googlePlaceId,
    name: stop.placeName,
    originalName: stop.originalName,
    address: stop.address,
    lat: stop.lat,
    lng: stop.lng,
    type: stop.placeType,
  });
  const eligible = candidates.map((candidate, candidateIndex) => ({ candidate, candidateIndex })).filter(({ candidate }) => isHardGooglePlaceId(candidate.googlePlaceId));
  const choose = (matches: typeof eligible, reason: ItineraryIdentityLookupReason): ItineraryIdentityLookupDecision | null => {
    if (matches.length === 1) return { ...matches[0]!, reason, ambiguous: false };
    if (matches.length > 1) return { candidateIndex: null, candidate: null, reason: "ambiguous", ambiguous: true };
    return null;
  };
  const canonical = choose(eligible.filter(({ candidate }) => {
    const candidateIdentity = resolveCanonicalPlaceIdentity(candidate);
    return Boolean(identity && (identity === candidateIdentity.identityKey || identity === candidateIdentity.canonicalPlaceId));
  }), "canonical_identity");
  if (canonical) return canonical;
  const sourceKey = choose(eligible.filter(({ candidate }) => {
    const googlePlaceId = candidate.googlePlaceId!.trim();
    return identity === googlePlaceId || identity === `google:${googlePlaceId}` || stopCanonical.identityKey === `google:${googlePlaceId}`;
  }), "source_key");
  if (sourceKey) return sourceKey;
  const sameName = eligible.filter(({ candidate }) => {
    const candidateNames = nameKeys([candidate.name, candidate.placeName]);
    return [...candidateNames].some((key) => stopNames.has(key));
  });
  const nameAddress = choose(sameName.filter(({ candidate }) => {
    const candidateAddress = normalized(candidate.address);
    return Boolean(stopAddress && candidateAddress && stopAddress === candidateAddress);
  }), "name_address");
  if (nameAddress) return nameAddress;
  const nameCoordinate = choose(sameName.filter(({ candidate }) => coordinatesMatch(stop, candidate)), "name_coordinate");
  if (nameCoordinate) return nameCoordinate;
  const missingGoogleSameName = candidates.some((candidate) => {
    if (isHardGooglePlaceId(candidate.googlePlaceId)) return false;
    const candidateNames = nameKeys([candidate.name, candidate.placeName]);
    return [...candidateNames].some((key) => stopNames.has(key));
  });
  return { candidateIndex: null, candidate: null, reason: missingGoogleSameName ? "source_candidate_missing_google_id" : "no_match", ambiguous: false };
}

export type ItineraryIdentityCounts = {
  totalStopCount: number;
  googleIdentityCount: number;
  internalOnlyIdentityCount: number;
  missingIdentityCount: number;
  invalidGoogleIdentityCount: number;
  lostGoogleIdCount: number;
};

export function itineraryIdentityCounts(
  stops: readonly RoamieItineraryItem[],
  candidates: readonly RoamieRecommendationItem[] = [],
): ItineraryIdentityCounts {
  let googleIdentityCount = 0;
  let internalOnlyIdentityCount = 0;
  let missingIdentityCount = 0;
  let lostGoogleIdCount = 0;
  for (const stop of stops) {
    const identity = stop.googlePlaceId?.trim() ?? "";
    if (isHardGooglePlaceId(identity)) {
      googleIdentityCount += 1;
      continue;
    }
    if (identity) internalOnlyIdentityCount += 1;
    else missingIdentityCount += 1;
    if (inspectItineraryIdentityLookup(stop, candidates).candidate) lostGoogleIdCount += 1;
  }
  return {
    totalStopCount: stops.length,
    googleIdentityCount,
    internalOnlyIdentityCount,
    missingIdentityCount,
    invalidGoogleIdentityCount: internalOnlyIdentityCount,
    lostGoogleIdCount,
  };
}

export type ItineraryIdentityRecoveryResult = {
  items: RoamieItineraryItem[];
  restoredFromCandidatePoolCount: number;
  replacedFromSupplementalPoolCount: number;
  unrecoverableCount: number;
  lookupReasonCounts: Record<ItineraryIdentityLookupReason, number>;
  unrecoverableHashes: string[];
};

function itemFromCandidate(
  scheduled: RoamieItineraryItem,
  candidate: RoamieRecommendationItem,
): RoamieItineraryItem {
  const name = candidateName(candidate);
  return {
    ...scheduled,
    title: name,
    placeName: name,
    localizedDisplayName: name,
    originalName: candidate.name,
    description: candidate.description,
    googlePlaceId: candidate.googlePlaceId,
    lat: candidate.lat,
    lng: candidate.lng,
    address: candidate.address,
    placeType: candidate.primaryType ?? candidate.type,
    types: candidate.types?.length ? candidate.types : [candidate.type],
    photoName: candidate.photoName,
    rating: candidate.rating,
    userRatingCount: candidate.userRatingCount,
    businessStatus: candidate.businessStatus,
    openStatusLabel: candidate.openStatusLabel,
    todayHoursLabel: candidate.todayHoursLabel,
    destinationScope: candidate.destinationScope,
    extensionDestination: candidate.extensionDestination,
    sourceRegionCandidate: candidate.sourceRegionCandidate,
    placeSnapshotSource: "selected_place",
  };
}

/** Restore delivery identity only from the request's original candidate provenance. */
export function recoverItineraryGoogleIdentities(args: {
  stops: readonly RoamieItineraryItem[];
  candidates: readonly RoamieRecommendationItem[];
  supplementalCandidates?: readonly RoamieRecommendationItem[];
}): ItineraryIdentityRecoveryResult {
  const usedGoogleIds = new Set(
    args.stops
      .map((stop) => stop.googlePlaceId?.trim())
      .filter((id): id is string => isHardGooglePlaceId(id)),
  );
  const lookupByStop = args.stops.map((stop) => inspectItineraryIdentityLookup(stop, args.candidates));
  for (const lookup of lookupByStop) {
    if (lookup.candidate) usedGoogleIds.add(lookup.candidate.googlePlaceId!.trim());
  }
  let restoredFromCandidatePoolCount = 0;
  let replacedFromSupplementalPoolCount = 0;
  let unrecoverableCount = 0;
  const lookupReasonCounts = {} as Record<ItineraryIdentityLookupReason, number>;
  const unrecoverableHashes: string[] = [];

  const items = args.stops.map((stop, stopIndex) => {
    if (isHardGooglePlaceId(stop.googlePlaceId)) return stop;
    const lookup = lookupByStop[stopIndex]!;
    lookupReasonCounts[lookup.reason] = (lookupReasonCounts[lookup.reason] ?? 0) + 1;
    if (lookup.candidate) {
      const match = lookup.candidate;
      const googlePlaceId = match.googlePlaceId!.trim();
      restoredFromCandidatePoolCount += 1;
      return itemFromCandidate(stop, match);
    }
    const replacement = (args.supplementalCandidates ?? []).find((candidate) => {
      const googlePlaceId = candidate.googlePlaceId?.trim() ?? "";
      return isHardGooglePlaceId(googlePlaceId) && !usedGoogleIds.has(googlePlaceId);
    });
    if (replacement) {
      usedGoogleIds.add(replacement.googlePlaceId!.trim());
      replacedFromSupplementalPoolCount += 1;
      return itemFromCandidate(stop, replacement);
    }
    unrecoverableCount += 1;
    unrecoverableHashes.push(itineraryStopHash(stop));
    return stop;
  });

  return {
    items,
    restoredFromCandidatePoolCount,
    replacedFromSupplementalPoolCount,
    unrecoverableCount,
    lookupReasonCounts,
    unrecoverableHashes,
  };
}
