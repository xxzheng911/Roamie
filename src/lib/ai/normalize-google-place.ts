import type { PlaceResult } from "@/lib/place-result";
import type { PlaceHoursData } from "@/lib/filter-available-places";
import { applyNormalizedOpeningToPlaceResult } from "@/lib/normalized-opening-status";
import { resolvePlaceDisplayAddress } from "@/lib/place-display-address";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import type { Locale } from "@/lib/i18n/types";
import { resolvePlaceDisplayName } from "@/lib/place-display-name";

/** Raw shapes from Nearby Search, Text Search, and Place Details (Google Places API v1). */
export type GooglePlaceRaw = {
  id?: string | null;
  placeId?: string | null;
  place_id?: string | null;
  googlePlaceId?: string | null;
  name?: string | null;
  displayName?: { text?: string | null } | null;
  formattedAddress?: string | null;
  shortFormattedAddress?: string | null;
  vicinity?: string | null;
  address?: string | null;
  location?: { latitude?: number | null; longitude?: number | null } | null;
  lat?: number | null;
  lng?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  rating?: number | null;
  userRatingCount?: number | null;
  photos?: Array<{ name?: string | null }> | null;
  photoName?: string | null;
  primaryType?: string | null;
  primaryTypeDisplayName?: { text?: string; languageCode?: string } | null;
  types?: string[] | null;
  type?: string | null;
  businessStatus?: string | null;
  regularOpeningHours?: PlaceHoursData["regularOpeningHours"];
  currentOpeningHours?: PlaceHoursData["currentOpeningHours"];
  opening_hours?: {
    weekdayDescriptions?: string[];
    periods?: PlaceHoursData["regularOpeningHours"] extends infer T
      ? T extends { periods?: infer P }
        ? P
        : never
      : never;
  } | null;
  utcOffsetMinutes?: number | null;
};

export function normalizeGooglePlaceId(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/^places\//i, "").trim();
}

function resolveRawPlaceId(raw: GooglePlaceRaw): string {
  return normalizeGooglePlaceId(
    raw.id ?? raw.placeId ?? raw.place_id ?? raw.googlePlaceId ?? "",
  );
}

function resolveRawPlaceName(raw: GooglePlaceRaw): string {
  const fromDisplay = raw.displayName?.text?.trim();
  if (fromDisplay) return fromDisplay;
  return (raw.name ?? "").trim();
}

function resolveRawCoordinates(raw: GooglePlaceRaw): { lat: number | null; lng: number | null } {
  const lat =
    raw.location?.latitude ??
    raw.lat ??
    raw.latitude ??
    null;
  const lng =
    raw.location?.longitude ??
    raw.lng ??
    raw.longitude ??
    null;
  return {
    lat: lat != null && Number.isFinite(lat) ? lat : null,
    lng: lng != null && Number.isFinite(lng) ? lng : null,
  };
}

function resolveRawTypes(raw: GooglePlaceRaw): string[] {
  const fromArray = (raw.types ?? [])
    .map((t) => (t ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (fromArray.length) return fromArray;

  const primary = (raw.primaryType ?? raw.type ?? "").trim().toLowerCase();
  if (primary) return [primary];

  // Name hints belong to the semantic authority and require compatible provider evidence.
  return [];
}

function resolveRawHours(raw: GooglePlaceRaw): PlaceHoursData {
  const regular =
    raw.regularOpeningHours ??
    (raw.opening_hours?.periods
      ? { periods: raw.opening_hours.periods, weekdayDescriptions: raw.opening_hours.weekdayDescriptions }
      : undefined);

  return {
    businessStatus: raw.businessStatus ?? null,
    regularOpeningHours: regular,
    currentOpeningHours: raw.currentOpeningHours,
    utcOffsetMinutes: raw.utcOffsetMinutes ?? null,
  };
}

/**
 * Normalize any Google Places API payload (search or details) into a PlanningPlace-compatible PlaceResult.
 * Handles id/place_id/places/ prefix, displayName.text vs name, location.latitude vs lat, etc.
 */
export function normalizeGooglePlace(
  raw: GooglePlaceRaw,
  options?: { locale?: Locale; existing?: Partial<PlaceResult> },
): PlaceResult | null {
  const name = resolveRawPlaceName(raw);
  if (!name) return null;

  const id = resolveRawPlaceId(raw);
  const { lat, lng } = resolveRawCoordinates(raw);
  const types = resolveRawTypes(raw);
  // Only an explicit provider primaryType carries primary identity authority.
  // Legacy type and types[] remain candidate evidence via resolveRawTypes.
  const primaryType = raw.primaryType?.trim().toLowerCase() || null;
  const hours = resolveRawHours(raw);
  const locale = options?.locale ?? effectiveAppLocale();
  const resolvedName = resolvePlaceDisplayName(
    {
      name,
      originalName: name,
      placeId: id || options?.existing?.id || undefined,
      canonicalPlaceId: id || options?.existing?.id || undefined,
      primaryType,
      types,
    },
    locale,
  );

  const base: PlaceResult = {
    ...(options?.existing ?? {}),
    id: id || options?.existing?.id || "",
    name: resolvedName.localizedDisplayName,
    originalName: resolvedName.originalName,
    localizedDisplayName: resolvedName.localizedDisplayName,
    languageCode: resolvedName.languageCode,
    localizationSource: resolvedName.localizationSource,
    address:
      options?.existing?.address ??
      resolvePlaceDisplayAddress(
        {
          formattedAddress: raw.formattedAddress ?? raw.address ?? undefined,
          shortFormattedAddress: raw.shortFormattedAddress,
          vicinity: raw.vicinity,
        },
        { locale },
      ),
    lat: lat ?? options?.existing?.lat ?? null,
    lng: lng ?? options?.existing?.lng ?? null,
    navigationLatitude:
      options?.existing?.navigationLatitude ??
      (lat != null && lng != null ? lat : null),
    navigationLongitude:
      options?.existing?.navigationLongitude ??
      (lat != null && lng != null ? lng : null),
    coordinateSource:
      options?.existing?.coordinateSource ??
      (lat != null && lng != null
        ? id
          ? "google_places"
          : "unknown"
        : options?.existing?.coordinateSource ?? "unknown"),
    rating: raw.rating ?? options?.existing?.rating ?? null,
    userRatingCount: raw.userRatingCount ?? options?.existing?.userRatingCount ?? null,
    photoName:
      raw.photoName ??
      raw.photos?.[0]?.name ??
      options?.existing?.photoName ??
      null,
    primaryType,
    primaryTypeDisplayName: raw.primaryTypeDisplayName,
    rawTypes: raw.types ? [...raw.types] : undefined,
    types: types.length ? types : primaryType ? [primaryType] : [],
    businessStatus: raw.businessStatus ?? options?.existing?.businessStatus ?? null,
    openStatus: options?.existing?.openStatus ?? "unknown",
    openStatusLabel: options?.existing?.openStatusLabel ?? "",
    todayHoursLabel: options?.existing?.todayHoursLabel ?? "",
    closingSoonNote: options?.existing?.closingSoonNote ?? "",
    nextOpenHint: options?.existing?.nextOpenHint ?? "",
  };

  return applyNormalizedOpeningToPlaceResult(base, hours);
}

/** Batch-normalize mixed raw/search results; drops entries without a resolvable name. */
export function normalizeGooglePlaces(
  raws: GooglePlaceRaw[],
  options?: { locale?: Locale },
): PlaceResult[] {
  const out: PlaceResult[] = [];
  for (const raw of raws) {
    const place = normalizeGooglePlace(raw, options);
    if (place) out.push(place);
  }
  return out;
}
