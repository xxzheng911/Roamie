import { normalizeGooglePlaceId } from "@/lib/ai/normalize-google-place";
import {
  isFallbackPlanningPlaceId,
  isHardGooglePlaceId,
} from "@/lib/ai/planning-place-id";

export type CanonicalPlaceIdentitySource =
  | "google_place_id"
  | "canonical_id"
  | "saved_id"
  | "deterministic_fallback";

export type CanonicalPlaceIdentityInput = {
  canonicalPlaceId?: string | null;
  googlePlaceId?: string | null;
  placeId?: string | null;
  id?: string | null;
  originalName?: string | null;
  rawName?: string | null;
  englishName?: string | null;
  name?: string | null;
  placeName?: string | null;
  address?: string | null;
  formattedAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  type?: string | null;
  primaryType?: string | null;
  source?: string | null;
};

export type CanonicalPlaceIdentity = {
  canonicalPlaceId: string | null;
  googlePlaceId: string | null;
  identityKey: string;
  source: CanonicalPlaceIdentitySource;
  isGooglePlaceId: boolean;
};

const TRANSIENT_ID_PREFIXES = [
  "origin:", "center:", "offset:", "geocode:", "provider:", "scope:",
  "approx:", "fallback:", "synthetic:", "landmark-cache:",
  "local-life-fallback:", "slow-nature-fallback:", "classic-fallback:",
  "mixed-fallback:", "core:", "name:", "dayplan:", "latlng:",
  "session:", "trip:", "memory:", "mock-", "rec-", "combo-collapse-",
] as const;

function normalizeCandidateId(value: string | null | undefined): string {
  return normalizeGooglePlaceId(value);
}

export function isTransientPlaceIdentity(value: string | null | undefined): boolean {
  const normalized = normalizeCandidateId(value).toLowerCase();
  if (!normalized || normalized === "none") return true;
  if (isFallbackPlanningPlaceId(normalized)) return true;
  return TRANSIENT_ID_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isStableInternalId(value: string): boolean {
  return Boolean(value && !isTransientPlaceIdentity(value));
}

function normalizeIdentityText(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[（(][^)）]*[)）]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function fixedCoordinate(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(5)
    : "missing";
}

function transientNamespace(values: string[]): string {
  const transient = values.find((value) => isTransientPlaceIdentity(value));
  if (!transient) return "none";
  const separator = transient.indexOf(":");
  return separator >= 0 ? transient.slice(0, separator) : transient.toLowerCase();
}

/** App identity boundary; only googlePlaceId may cross a Google Places API boundary. */
export function resolveCanonicalPlaceIdentity(
  place: CanonicalPlaceIdentityInput,
): CanonicalPlaceIdentity {
  const candidates = {
    canonicalPlaceId: normalizeCandidateId(place.canonicalPlaceId),
    googlePlaceId: normalizeCandidateId(place.googlePlaceId),
    placeId: normalizeCandidateId(place.placeId),
    id: normalizeCandidateId(place.id),
  };
  const candidateValues = [
    candidates.googlePlaceId,
    candidates.placeId,
    candidates.id,
    candidates.canonicalPlaceId,
  ].filter(Boolean);

  const googlePlaceId = candidateValues.find((value) => isHardGooglePlaceId(value));
  if (googlePlaceId) {
    return {
      canonicalPlaceId: googlePlaceId,
      googlePlaceId,
      identityKey: `google:${googlePlaceId}`,
      source: "google_place_id",
      isGooglePlaceId: true,
    };
  }

  if (isStableInternalId(candidates.canonicalPlaceId)) {
    return {
      canonicalPlaceId: candidates.canonicalPlaceId,
      googlePlaceId: null,
      identityKey: `canonical:${candidates.canonicalPlaceId}`,
      source: "canonical_id",
      isGooglePlaceId: false,
    };
  }

  const savedId = [candidates.id, candidates.placeId, candidates.googlePlaceId]
    .find((value) => isStableInternalId(value));
  if (savedId) {
    return {
      canonicalPlaceId: savedId,
      googlePlaceId: null,
      identityKey: `saved:${savedId}`,
      source: "saved_id",
      isGooglePlaceId: false,
    };
  }

  const coreName = normalizeIdentityText(
    place.originalName ?? place.rawName ?? place.englishName ?? place.name ?? place.placeName,
  );
  const address = normalizeIdentityText(place.address ?? place.formattedAddress);
  const lat = fixedCoordinate(place.lat ?? place.latitude);
  const lng = fixedCoordinate(place.lng ?? place.longitude);
  const kind = normalizeIdentityText(place.primaryType ?? place.type ?? place.source) || "missing";
  const namespace = transientNamespace(candidateValues);
  const identityKey = [
    `name=${coreName || "missing"}`,
    `address=${address || "missing"}`,
    `coords=${lat},${lng}`,
    `kind=${kind}`,
    `synthetic=${namespace}`,
  ].join("|");

  return {
    canonicalPlaceId: null,
    googlePlaceId: null,
    identityKey: `fallback:${identityKey}`,
    source: "deterministic_fallback",
    isGooglePlaceId: false,
  };
}

export function resolveGooglePlaceId(place: CanonicalPlaceIdentityInput): string | null {
  return resolveCanonicalPlaceIdentity(place).googlePlaceId;
}

export function resolveCanonicalPlaceId(place: CanonicalPlaceIdentityInput): string | null {
  return resolveCanonicalPlaceIdentity(place).canonicalPlaceId;
}
