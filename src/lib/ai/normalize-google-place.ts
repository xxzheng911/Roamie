import type { PlaceResult } from "@/lib/place-result";
import type { PlaceHoursData } from "@/lib/filter-available-places";
import { applyNormalizedOpeningToPlaceResult } from "@/lib/normalized-opening-status";
import { resolvePlaceDisplayAddress } from "@/lib/place-display-address";
import type { Locale } from "@/lib/i18n/types";

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

function resolveRawTypes(raw: GooglePlaceRaw, name: string): string[] {
  const fromArray = (raw.types ?? [])
    .map((t) => (t ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (fromArray.length) return fromArray;

  const primary = (raw.primaryType ?? raw.type ?? "").trim().toLowerCase();
  if (primary) return [primary];

  const blob = name.toLowerCase();
  if (/博物|museum/i.test(blob)) return ["museum"];
  if (/咖啡|cafe|coffee/i.test(blob)) return ["cafe"];
  if (/餐|restaurant|food|小吃/i.test(blob)) return ["restaurant"];
  if (/公園|park/i.test(blob)) return ["park"];
  if (/夜市|market/i.test(blob)) return ["market"];
  if (/商圈|shopping/i.test(blob)) return ["shopping_mall"];
  return ["tourist_attraction"];
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
  const types = resolveRawTypes(raw, name);
  const primaryType = (raw.primaryType ?? raw.type ?? types[0] ?? "tourist_attraction").trim().toLowerCase();
  const hours = resolveRawHours(raw);
  const locale = options?.locale ?? "zh-TW";

  const base: PlaceResult = {
    ...(options?.existing ?? {}),
    id: id || options?.existing?.id || "",
    name,
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
    rating: raw.rating ?? options?.existing?.rating ?? null,
    userRatingCount: raw.userRatingCount ?? options?.existing?.userRatingCount ?? null,
    photoName:
      raw.photoName ??
      raw.photos?.[0]?.name ??
      options?.existing?.photoName ??
      null,
    primaryType,
    types: types.length ? types : [primaryType],
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
