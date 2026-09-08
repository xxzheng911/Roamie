export type AffiliateFactualEvidenceStage =
  | "raw_candidate"
  | "post_localization"
  | "offered_combination"
  | "planning_candidate"
  | "server_input"
  | "pre_persistence"
  | "stored_itinerary"
  | "itinerary_ui";

type FactualPlace = {
  id?: string | null;
  googlePlaceId?: string | null;
  name?: string | null;
  title?: string | null;
  placeName?: string | null;
  primaryType?: string | null;
  placeType?: string | null;
  types?: string[] | null;
  rating?: number | null;
  userRatingCount?: number | null;
  businessStatus?: string | null;
};

export function affiliateFactualPlaceHash(place: FactualPlace): string {
  const value =
    place.googlePlaceId?.trim() ||
    place.id?.trim() ||
    place.placeName?.trim() ||
    place.name?.trim() ||
    place.title?.trim() ||
    "unknown";
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const rawReviewEvidence = new Map<string, boolean>();

export function resolveAffiliateReviewCountEvidenceState(
  place: FactualPlace,
): "present" | "source_missing" | "handoff_lost" {
  if (place.userRatingCount != null) return "present";
  return rawReviewEvidence.get(affiliateFactualPlaceHash(place)) === true
    ? "handoff_lost"
    : "source_missing";
}

export function logAffiliateFactualEvidenceLifecycle(
  stage: AffiliateFactualEvidenceStage,
  place: FactualPlace,
  generationId?: string,
): void {
  const types = [place.primaryType, place.placeType, ...(place.types ?? [])]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toLowerCase());
  const placeHash = affiliateFactualPlaceHash(place);
  if (stage === "raw_candidate") rawReviewEvidence.set(placeHash, place.userRatingCount != null);
  console.info("[AFFILIATE_FACTUAL_EVIDENCE_LIFECYCLE]", {
    ...(generationId ? { generationId } : {}),
    placeHash,
    stage,
    userRatingCountPresent: place.userRatingCount != null,
    businessStatusPresent: Boolean(place.businessStatus?.trim()),
    primaryTypePresent: Boolean(place.primaryType?.trim() || place.placeType?.trim()),
    typesPresent: types.length > 0,
    ratingPresent: place.rating != null,
    culturalOrReligiousAuthorityPresent: types.some((type) =>
      /^(place_of_worship|church|hindu_temple|mosque|synagogue|cultural_landmark|historical_landmark)$/.test(type),
    ),
  });
}
