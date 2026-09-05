export type RecommendationOperationalPlace = {
  id?: string | null;
  businessStatus?: string | null;
  business_status?: string | null;
  permanentlyClosed?: boolean | null;
  permanently_closed?: boolean | null;
  temporarilyClosed?: boolean | null;
  temporarily_closed?: boolean | null;
  operational?: boolean | null;
  openStatus?: string | null;
};

export type RecommendationOperationalEligibility = {
  eligible: boolean;
  businessStatus: string | null;
  statusSource: string;
};

function normalizedStatus(place: RecommendationOperationalPlace): string | null {
  const value = place.businessStatus ?? place.business_status;
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return normalized || null;
}

function isUnknownBusinessStatus(status: string | null): boolean {
  return status === "UNKNOWN" || status === "BUSINESS_STATUS_UNSPECIFIED" || status === "UNSPECIFIED";
}

/**
 * Single hard-exclusion contract for recommendation candidates.
 * Missing opening/status data remains eligible; only explicit reliable closed evidence is rejected.
 */
export function placeOperationalEligibility(
  place: RecommendationOperationalPlace,
): RecommendationOperationalEligibility {
  const businessStatus = normalizedStatus(place);
  if (businessStatus && businessStatus !== "OPERATIONAL" && !isUnknownBusinessStatus(businessStatus)) {
    return { eligible: false, businessStatus, statusSource: "businessStatus" };
  }
  if (place.permanentlyClosed === true || place.permanently_closed === true) {
    return { eligible: false, businessStatus, statusSource: "permanently_closed" };
  }
  if (place.temporarilyClosed === true || place.temporarily_closed === true) {
    return { eligible: false, businessStatus, statusSource: "temporarily_closed" };
  }
  if (place.operational === false) {
    return { eligible: false, businessStatus, statusSource: "operational_false" };
  }
  const openStatus = (place.openStatus ?? "").trim().toLowerCase();
  if (openStatus === "permanently_closed" || openStatus === "temporarily_closed") {
    return { eligible: false, businessStatus, statusSource: "openStatus" };
  }
  return {
    eligible: true,
    businessStatus,
    statusSource: businessStatus === "OPERATIONAL" ? "businessStatus" : "unknown",
  };
}

export function isPlaceOperationalForRecommendation(
  place: RecommendationOperationalPlace,
): boolean {
  return placeOperationalEligibility(place).eligible;
}
