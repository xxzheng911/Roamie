export type ResidentialPlaceInput = {
  name?: string | null;
  address?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  category?: string | null;
};

export type ResidentialPlaceDecision = {
  residential: boolean;
  source: "google_primary_type" | "google_type" | "provider_category" | "name_fallback" | "none";
  matchedValue: string;
};

// Tokens already observed/handled elsewhere in this repository's provider data.
const RESIDENTIAL_TYPES = new Set([
  "apartment",
  "apartment_building",
  "apartment_complex",
  "housing_complex",
  "residential",
  "residential_area",
  "real_estate_agency",
]);

const AUTHORITATIVE_CULTURAL_TYPES = new Set([
  "museum",
  "art_gallery",
  "cultural_center",
  "cultural_landmark",
  "performing_arts_theater",
]);

const GENERIC_TYPES = new Set([
  "",
  "unknown",
  "other",
  "point_of_interest",
  "establishment",
  "premise",
  "subpremise",
]);

const RESIDENTIAL_NAME_RE =
  /(?:大樓|社區|公寓|住宅|華廈|华厦|豪宅|國宅|国宅|帝景|城堡)(?:$|[\s（(·・-])/i;

function normalizeType(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

/** Metadata-first residential decision. Name is used only with absent/generic metadata. */
export function resolveResidentialPlace(
  place: ResidentialPlaceInput,
): ResidentialPlaceDecision {
  const primaryType = normalizeType(place.primaryType);

  // Google primaryType is authoritative in both directions.
  if (AUTHORITATIVE_CULTURAL_TYPES.has(primaryType)) {
    return { residential: false, source: "none", matchedValue: primaryType };
  }
  if (RESIDENTIAL_TYPES.has(primaryType)) {
    return { residential: true, source: "google_primary_type", matchedValue: primaryType };
  }

  const types = (place.types ?? []).map(normalizeType).filter(Boolean);
  const residentialType = types.find((type) => RESIDENTIAL_TYPES.has(type));
  if (residentialType) {
    return { residential: true, source: "google_type", matchedValue: residentialType };
  }
  if (types.some((type) => AUTHORITATIVE_CULTURAL_TYPES.has(type))) {
    return { residential: false, source: "none", matchedValue: "cultural_google_type" };
  }

  const category = normalizeType(place.category);
  if (RESIDENTIAL_TYPES.has(category)) {
    return { residential: true, source: "provider_category", matchedValue: category };
  }
  if (AUTHORITATIVE_CULTURAL_TYPES.has(category)) {
    return { residential: false, source: "none", matchedValue: category };
  }

  const metadata = [primaryType, ...types, category].filter(Boolean);
  const metadataIncomplete = metadata.length === 0 || metadata.every((type) => GENERIC_TYPES.has(type));
  const name = (place.name ?? "").trim();
  if (metadataIncomplete && RESIDENTIAL_NAME_RE.test(name)) {
    return { residential: true, source: "name_fallback", matchedValue: name };
  }

  return { residential: false, source: "none", matchedValue: "" };
}

export function isResidentialPlace(place: ResidentialPlaceInput): boolean {
  return resolveResidentialPlace(place).residential;
}
