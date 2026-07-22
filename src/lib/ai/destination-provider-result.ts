/**
 * Unified Destination Provider result contract.
 * Server Adapter normalizes Geocode / Places shapes into this before Client parsing.
 */
import {
  extractCoordinatesFromProviderResponse,
  type ProviderCoordinateCandidate,
} from "@/lib/ai/destination-provider-coords";
import type { TripLocation } from "@/lib/location/types";

export type DestinationProviderKind =
  | "geocode"
  | "places_autocomplete"
  | "places_details"
  | "geocode_fn"
  | "unknown";

export type DestinationProviderResult = {
  ok: boolean;
  status: string;
  latitude?: number;
  longitude?: number;
  formattedAddress?: string;
  countryCode?: string;
  country?: string;
  administrativeArea?: string;
  locality?: string;
  viewport?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  provider: DestinationProviderKind;
  rawResultCount: number;
  parsedResultCount: number;
  failureReason?: string;
  httpStatus?: number;
  placeId?: string;
  /** Which response path produced lat/lng (e.g. geometry.location.lat/lng). */
  sourceShape?: string;
  query?: string;
};

export type GeocodeFnEnvelope = {
  location: TripLocation | null;
  error: string | null;
  /** Normalized provider diagnostics — always preferred over guessing response shapes. */
  providerResult?: DestinationProviderResult;
  /** True when Places Details was actually requested. */
  usedPlaceDetails?: boolean;
};

/** Valid finite WGS84 coordinates — soft-accept gate for Destination Anchor. */
export function isValidAnchorCoordinate(
  latitude: unknown,
  longitude: unknown,
): boolean {
  if (typeof latitude !== "number" || typeof longitude !== "number") return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function candidateToProviderResult(
  candidate: ProviderCoordinateCandidate,
  opts: {
    provider: DestinationProviderKind;
    status: string;
    rawResultCount: number;
    query?: string;
    httpStatus?: number;
  },
): DestinationProviderResult {
  return {
    ok: isValidAnchorCoordinate(candidate.latitude, candidate.longitude),
    status: opts.status,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    formattedAddress: candidate.formattedAddress,
    countryCode: candidate.countryCode,
    country: candidate.country,
    administrativeArea: candidate.administrativeArea,
    locality: candidate.locality ?? candidate.name,
    provider: opts.provider,
    rawResultCount: opts.rawResultCount,
    parsedResultCount: 1,
    httpStatus: opts.httpStatus,
    placeId: candidate.placeId,
    sourceShape: candidate.sourceShape,
    query: opts.query,
  };
}

/**
 * Unique Destination Provider Parser.
 * Soft-accept: any finite WGS84 lat/lng is enough — never require displayName /
 * formattedAddress / viewport / locality.
 *
 * Checks (in order):
 * - response.latitude / longitude
 * - response.lat / lng
 * - response.location.{latitude|lat}/{longitude|lng}
 * - response.geometry.location.{lat|latitude}
 * - response.result|data|payload.location.*
 * - response.results[0].geometry.location.*
 * - response.places[0].location.*
 * - ServerFn envelope { location, error, providerResult }
 */
export function normalizeDestinationProviderResponse(
  response: unknown,
  opts?: {
    provider?: DestinationProviderKind;
    query?: string;
    httpStatus?: number;
    apiStatus?: string;
  },
): DestinationProviderResult {
  const provider = opts?.provider ?? "unknown";
  const query = opts?.query;
  const httpStatus = opts?.httpStatus;
  const root = asRecord(response);

  // Already a DestinationProviderResult
  if (root && typeof root.ok === "boolean" && typeof root.status === "string") {
    const lat = readFinite(root.latitude) ?? readFinite(root.lat);
    const lng = readFinite(root.longitude) ?? readFinite(root.lng);
    const ok = isValidAnchorCoordinate(lat, lng);
    return {
      ok,
      status: readString(root.status) ?? (ok ? "OK" : "EMPTY"),
      latitude: lat,
      longitude: lng,
      formattedAddress: readString(root.formattedAddress),
      countryCode: readString(root.countryCode)?.toUpperCase(),
      country: readString(root.country),
      administrativeArea: readString(root.administrativeArea),
      locality: readString(root.locality),
      viewport: asRecord(root.viewport)
        ? {
            north: readFinite(asRecord(root.viewport)!.north) ?? 0,
            south: readFinite(asRecord(root.viewport)!.south) ?? 0,
            east: readFinite(asRecord(root.viewport)!.east) ?? 0,
            west: readFinite(asRecord(root.viewport)!.west) ?? 0,
          }
        : undefined,
      provider: (readString(root.provider) as DestinationProviderKind) ?? provider,
      rawResultCount: readFinite(root.rawResultCount) ?? (ok ? 1 : 0),
      parsedResultCount: readFinite(root.parsedResultCount) ?? (ok ? 1 : 0),
      failureReason: ok ? undefined : readString(root.failureReason) ?? "anchor_geocode_empty",
      httpStatus: readFinite(root.httpStatus) ?? httpStatus,
      placeId: readString(root.placeId),
      sourceShape: readString(root.sourceShape) ?? "destination_provider_result",
      query: readString(root.query) ?? query,
    };
  }

  // Ordered path checks on a single object (priority contract).
  const tryPair = (
    lat: unknown,
    lng: unknown,
    shape: string,
    meta?: Partial<DestinationProviderResult>,
  ): DestinationProviderResult | null => {
    const latitude = readFinite(lat);
    const longitude = readFinite(lng);
    if (!isValidAnchorCoordinate(latitude, longitude)) return null;
    return {
      ok: true,
      status: opts?.apiStatus ?? "OK",
      latitude,
      longitude,
      formattedAddress: meta?.formattedAddress,
      countryCode: meta?.countryCode,
      country: meta?.country,
      administrativeArea: meta?.administrativeArea,
      locality: meta?.locality,
      provider,
      rawResultCount: meta?.rawResultCount ?? 1,
      parsedResultCount: 1,
      httpStatus,
      placeId: meta?.placeId,
      sourceShape: shape,
      query,
    };
  };

  if (root) {
    // 1–2: root latitude/longitude | lat/lng
    const fromRootNew = tryPair(root.latitude, root.longitude, "response.latitude/longitude", {
      formattedAddress: readString(root.formattedAddress) ?? readString(root.formatted_address),
      placeId: readString(root.placeId) ?? readString(root.place_id),
      locality: readString(root.locality) ?? readString(root.city),
      country: readString(root.country),
      countryCode: readString(root.countryCode)?.toUpperCase(),
    });
    if (fromRootNew) return fromRootNew;

    const fromRootLegacy = tryPair(root.lat, root.lng, "response.lat/lng", {
      formattedAddress: readString(root.formattedAddress) ?? readString(root.formatted_address),
      placeId: readString(root.placeId) ?? readString(root.place_id),
      locality: readString(root.locality) ?? readString(root.city),
      country: readString(root.country),
      countryCode: readString(root.countryCode)?.toUpperCase(),
    });
    if (fromRootLegacy) return fromRootLegacy;

    // 3–4: location.*
    const location = asRecord(root.location);
    if (location) {
      const fromLocNew = tryPair(
        location.latitude,
        location.longitude,
        "response.location.latitude/longitude",
        {
          formattedAddress:
            readString(location.formattedName) ??
            readString(location.displayLabel) ??
            readString(location.address) ??
            readString(root.formattedAddress),
          placeId: readString(location.placeId) ?? readString(root.placeId),
          locality: readString(location.city) ?? readString(location.locality),
          country: readString(location.country),
          countryCode: readString(location.countryCode)?.toUpperCase(),
          administrativeArea:
            readString(location.region) ?? readString(location.administrativeArea),
        },
      );
      if (fromLocNew) return fromLocNew;

      const fromLocLegacy = tryPair(location.lat, location.lng, "response.location.lat/lng", {
        formattedAddress:
          readString(location.formattedName) ??
          readString(location.displayLabel) ??
          readString(location.address),
        placeId: readString(location.placeId),
        locality: readString(location.city) ?? readString(location.locality),
        country: readString(location.country),
        administrativeArea: readString(location.region),
      });
      if (fromLocLegacy) return fromLocLegacy;
    }

    // 5: geometry.location
    const geometry = asRecord(root.geometry);
    const geomLoc = geometry ? asRecord(geometry.location) : null;
    if (geomLoc) {
      const fromGeom =
        tryPair(geomLoc.lat, geomLoc.lng, "response.geometry.location.lat/lng") ??
        tryPair(
          geomLoc.latitude,
          geomLoc.longitude,
          "response.geometry.location.latitude/longitude",
        );
      if (fromGeom) {
        return {
          ...fromGeom,
          formattedAddress:
            readString(root.formatted_address) ?? readString(root.formattedAddress),
          placeId: readString(root.place_id) ?? readString(root.placeId),
        };
      }
    }
  }

  // Server Fn envelope: { location, error, providerResult? }
  if (root && ("location" in root || "error" in root || "providerResult" in root)) {
    const nested = root.providerResult
      ? normalizeDestinationProviderResponse(root.providerResult, opts)
      : null;
    if (nested?.ok) return nested;

    const error = readString(root.error) ?? nested?.failureReason ?? "geocode_empty_response";
    return {
      ok: false,
      status: opts?.apiStatus ?? error,
      provider: nested?.provider ?? (provider === "unknown" ? "geocode_fn" : provider),
      rawResultCount: nested?.rawResultCount ?? 0,
      parsedResultCount: 0,
      failureReason: error,
      httpStatus: nested?.httpStatus ?? httpStatus,
      sourceShape: nested?.sourceShape ?? "trip_location_empty",
      query,
    };
  }

  // Nested { data|result|payload }.location.*
  if (root) {
    for (const key of ["result", "data", "payload"] as const) {
      const nestedRoot = asRecord(root[key]);
      if (!nestedRoot) continue;
      const nestedLoc = asRecord(nestedRoot.location);
      if (nestedLoc) {
        const hit =
          tryPair(
            nestedLoc.latitude,
            nestedLoc.longitude,
            `response.${key}.location.latitude/longitude`,
          ) ??
          tryPair(nestedLoc.lat, nestedLoc.lng, `response.${key}.location.lat/lng`);
        if (hit) return hit;
      }
      const nested = normalizeDestinationProviderResponse(root[key], opts);
      if (nested.ok || nested.rawResultCount > 0 || nested.failureReason) return nested;
    }
  }

  const extracted = extractCoordinatesFromProviderResponse(response);
  const first = extracted.candidates[0];
  if (first && isValidAnchorCoordinate(first.latitude, first.longitude)) {
    return candidateToProviderResult(first, {
      provider,
      status: opts?.apiStatus ?? "OK",
      rawResultCount: extracted.rawResultCount,
      query,
      httpStatus,
    });
  }

  // Empty object from failed Capacitor serverFn — distinct failure reason.
  if (root && Object.keys(root).length === 0) {
    return {
      ok: false,
      status: opts?.apiStatus ?? "EMPTY",
      provider,
      rawResultCount: 0,
      parsedResultCount: 0,
      failureReason: "geocode_empty_envelope",
      httpStatus,
      sourceShape: "empty_object",
      query,
    };
  }

  return {
    ok: false,
    status: opts?.apiStatus ?? "ZERO_RESULTS",
    provider,
    rawResultCount: extracted.rawResultCount,
    parsedResultCount: 0,
    failureReason: "geocode_zero_results",
    httpStatus,
    sourceShape: extracted.responseShape || "unknown",
    query,
  };
}

/** @deprecated Prefer normalizeDestinationProviderResponse */
export function normalizeDestinationProviderResult(
  response: unknown,
  opts?: {
    provider?: DestinationProviderKind;
    query?: string;
    httpStatus?: number;
    apiStatus?: string;
  },
): DestinationProviderResult {
  return normalizeDestinationProviderResponse(response, opts);
}

export function providerResultToTripLocation(
  result: DestinationProviderResult,
  fallbackName = "destination",
): TripLocation | null {
  if (!result.ok || !isValidAnchorCoordinate(result.latitude, result.longitude)) {
    return null;
  }
  const name =
    result.locality ||
    result.formattedAddress ||
    fallbackName;
  return {
    placeId: result.placeId ?? `provider:${result.latitude},${result.longitude}`,
    country: result.country || result.countryCode || "unknown",
    city: name,
    region: result.administrativeArea,
    lat: result.latitude!,
    lng: result.longitude!,
    formattedName: result.formattedAddress || name,
    displayLabel: result.formattedAddress || name,
    address: result.formattedAddress,
    timezone: undefined,
    utcOffsetMinutes: null,
  };
}

export function tripLocationToProviderResult(
  location: TripLocation | null,
  opts?: {
    provider?: DestinationProviderKind;
    error?: string | null;
    query?: string;
    rawResultCount?: number;
    httpStatus?: number;
    apiStatus?: string;
    sourceShape?: string;
  },
): DestinationProviderResult {
  if (location && isValidAnchorCoordinate(location.lat, location.lng)) {
    return {
      ok: true,
      status: opts?.apiStatus ?? "OK",
      latitude: location.lat,
      longitude: location.lng,
      formattedAddress: location.formattedName || location.displayLabel || location.address,
      country: location.country,
      administrativeArea: location.region,
      locality: location.city,
      provider: opts?.provider ?? "geocode",
      rawResultCount: opts?.rawResultCount ?? 1,
      parsedResultCount: 1,
      httpStatus: opts?.httpStatus ?? 200,
      placeId: location.placeId,
      sourceShape: opts?.sourceShape ?? "trip_location",
      query: opts?.query,
    };
  }
  return {
    ok: false,
    status: opts?.apiStatus ?? opts?.error ?? "ZERO_RESULTS",
    provider: opts?.provider ?? "geocode",
    rawResultCount: opts?.rawResultCount ?? 0,
    parsedResultCount: 0,
    failureReason: opts?.error ?? "geocode_zero_results",
    httpStatus: opts?.httpStatus,
    sourceShape: opts?.sourceShape ?? "empty",
    query: opts?.query,
  };
}
