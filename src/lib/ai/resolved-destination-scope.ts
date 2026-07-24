import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { lookupStructuredCountryForCity } from "@/lib/ai/country-city-options";
import {
  resolveDestinationEntity,
  resolveClimateZoneForDestination,
  type DestinationEntityType,
} from "@/lib/ai/destination-entity";
import {
  countryCodeForLabel,
  countryLabelForCode,
  normalizeCountryReference,
} from "@/lib/ai/destination-country-normalize";

export type DestinationCoordSource =
  | "scope_lock"
  | "cache"
  | "places_geometry"
  | "approx_center"
  | "geocode";

export type DestinationCountrySource =
  | "hint"
  | "geocode"
  | "places"
  | "entity"
  | "structured"
  | "reverse_geocode"
  | "entity_db"
  | "unknown";

export type ResolvedDestinationScope = {
  displayName: string;
  normalizedName: string;
  country?: string;
  countryCode?: string;
  type?: string;
  latitude: number;
  longitude: number;
  source: DestinationCoordSource;
  resolvedAt: number;
  /** Stable id for this city+coords generation; stale responses must ignore. */
  scopeId: string;
  countrySource?: DestinationCountrySource;
};

const TAIWAN_DEFAULT = { lat: 23.9739, lng: 120.9823 };
const TAIWAN_BBOX = { minLat: 21.5, maxLat: 26.5, minLng: 119.0, maxLng: 122.5 };

/** Coarse country bounding boxes for destination↔coordinate mismatch checks. */
const COUNTRY_BBOX: Record<
  string,
  { minLat: number; maxLat: number; minLng: number; maxLng: number }
> = {
  台灣: TAIWAN_BBOX,
  台湾: TAIWAN_BBOX,
  英國: { minLat: 49.0, maxLat: 61.0, minLng: -8.5, maxLng: 2.0 },
  英国: { minLat: 49.0, maxLat: 61.0, minLng: -8.5, maxLng: 2.0 },
  日本: { minLat: 24.0, maxLat: 46.0, minLng: 122.0, maxLng: 146.0 },
  韓國: { minLat: 33.0, maxLat: 39.0, minLng: 124.0, maxLng: 132.0 },
  韩国: { minLat: 33.0, maxLat: 39.0, minLng: 124.0, maxLng: 132.0 },
  法國: { minLat: 41.0, maxLat: 51.5, minLng: -5.5, maxLng: 10.0 },
  法国: { minLat: 41.0, maxLat: 51.5, minLng: -5.5, maxLng: 10.0 },
  澳洲: { minLat: -44.0, maxLat: -10.0, minLng: 112.0, maxLng: 154.0 },
  澳大利亚: { minLat: -44.0, maxLat: -10.0, minLng: 112.0, maxLng: 154.0 },
  美國: { minLat: 24.0, maxLat: 50.0, minLng: -125.0, maxLng: -66.0 },
  美国: { minLat: 24.0, maxLat: 50.0, minLng: -125.0, maxLng: -66.0 },
  泰國: { minLat: 5.5, maxLat: 20.5, minLng: 97.0, maxLng: 106.0 },
  泰国: { minLat: 5.5, maxLat: 20.5, minLng: 97.0, maxLng: 106.0 },
  菲律賓: { minLat: 4.5, maxLat: 21.5, minLng: 116.0, maxLng: 127.0 },
  菲律宾: { minLat: 4.5, maxLat: 21.5, minLng: 116.0, maxLng: 127.0 },
  希臘: { minLat: 34.5, maxLat: 41.8, minLng: 19.0, maxLng: 29.7 },
  西班牙: { minLat: 27.5, maxLat: 44.0, minLng: -18.5, maxLng: 5.0 },
  印尼: { minLat: -11.0, maxLat: 6.5, minLng: 95.0, maxLng: 141.0 },
  越南: { minLat: 8.0, maxLat: 23.5, minLng: 102.0, maxLng: 110.0 },
  馬來西亞: { minLat: 0.8, maxLat: 7.5, minLng: 99.5, maxLng: 119.5 },
  马来西亚: { minLat: 0.8, maxLat: 7.5, minLng: 99.5, maxLng: 119.5 },
  馬爾地夫: { minLat: -1.0, maxLat: 7.5, minLng: 72.0, maxLng: 74.0 },
  马尔代夫: { minLat: -1.0, maxLat: 7.5, minLng: 72.0, maxLng: 74.0 },
  義大利: { minLat: 36.0, maxLat: 47.5, minLng: 6.5, maxLng: 19.0 },
  意大利: { minLat: 36.0, maxLat: 47.5, minLng: 6.5, maxLng: 19.0 },
  加拿大: { minLat: 41.5, maxLat: 83.5, minLng: -141.0, maxLng: -52.0 },
  蒙古: { minLat: 41.5, maxLat: 52.2, minLng: 87.7, maxLng: 119.9 },
  /** Mainland China — Taiwan bbox is checked first in inferCountryFromCoordinates. */
  中國: { minLat: 18.0, maxLat: 54.0, minLng: 73.0, maxLng: 135.0 },
  中国: { minLat: 18.0, maxLat: 54.0, minLng: 73.0, maxLng: 135.0 },
  埃及: { minLat: 22.0, maxLat: 32.0, minLng: 24.5, maxLng: 37.0 },
  捷克: { minLat: 48.5, maxLat: 51.1, minLng: 12.0, maxLng: 18.9 },
  墨西哥: { minLat: 14.5, maxLat: 32.7, minLng: -118.5, maxLng: -86.5 },
  新加坡: { minLat: 1.15, maxLat: 1.48, minLng: 103.6, maxLng: 104.1 },
};

const COUNTRY_CODE_BY_NAME: Record<string, string> = {
  台灣: "TW",
  台湾: "TW",
  日本: "JP",
  韓國: "KR",
  韩国: "KR",
  英國: "GB",
  英国: "GB",
  法國: "FR",
  法国: "FR",
  美國: "US",
  美国: "US",
  澳洲: "AU",
  澳大利亚: "AU",
  泰國: "TH",
  泰国: "TH",
  菲律賓: "PH",
  菲律宾: "PH",
  新加坡: "SG",
  越南: "VN",
  印尼: "ID",
  馬來西亞: "MY",
  马来西亚: "MY",
  中國: "CN",
  中国: "CN",
  香港: "HK",
  澳門: "MO",
  澳门: "MO",
  摩納哥: "MC",
  摩纳哥: "MC",
  梵蒂岡: "VA",
  梵蒂冈: "VA",
  希臘: "GR",
  西班牙: "ES",
  馬爾地夫: "MV",
  马尔代夫: "MV",
  義大利: "IT",
  意大利: "IT",
  加拿大: "CA",
  蒙古: "MN",
  埃及: "EG",
  捷克: "CZ",
  墨西哥: "MX",
};

const scopeByDestination = new Map<string, ResolvedDestinationScope>();

/** Same generationRequestId + scopeId → reuse finalized profile (no re-resolve loop). */
const finalizedProfileByRequest = new Map<string, ResolvedDestinationScope>();
const validationFailureByRequest = new Map<string, string>();

function scopeKey(destination: string, countryCode?: string): string {
  const label = normalizeDestinationLabel(destination);
  const cc = (countryCode ?? "").trim().toUpperCase();
  return cc ? `${label}|${cc}` : label;
}

function buildScopeId(
  destination: string,
  lat: number,
  lng: number,
  source: DestinationCoordSource,
): string {
  return `${normalizeDestinationLabel(destination)}:${lat.toFixed(4)},${lng.toFixed(4)}:${source}`;
}

function isNearTaiwanDefault(lat: number, lng: number): boolean {
  return Math.abs(lat - TAIWAN_DEFAULT.lat) < 0.05 && Math.abs(lng - TAIWAN_DEFAULT.lng) < 0.05;
}

function inBbox(
  lat: number,
  lng: number,
  box: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): boolean {
  return lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;
}

export function countryCodeForCountryName(country?: string | null): string | undefined {
  if (!country?.trim()) return undefined;
  const normalized = normalizeCountryReference(country);
  if (normalized.countryCode) return normalized.countryCode;
  const label = normalizeDestinationLabel(country);
  return COUNTRY_CODE_BY_NAME[label] ?? countryCodeForLabel(label);
}

/**
 * Lightweight reverse-geocode: map coordinates to a known country via bbox.
 * Prefer Taiwan when coords fall in Taiwan (including east of Philippines bbox overlap care).
 */
export function inferCountryFromCoordinates(
  lat: number,
  lng: number,
): { country: string; countryCode: string; source: DestinationCountrySource } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Taiwan first — small island with unambiguous bbox vs mainland Asia.
  if (inBbox(lat, lng, TAIWAN_BBOX)) {
    return { country: "台灣", countryCode: "TW", source: "reverse_geocode" };
  }
  for (const [name, box] of Object.entries(COUNTRY_BBOX)) {
    if (name === "台灣" || name === "台湾") continue;
    if (inBbox(lat, lng, box)) {
      const country = normalizeDestinationLabel(name);
      const code = COUNTRY_CODE_BY_NAME[country] ?? COUNTRY_CODE_BY_NAME[name];
      if (!code) continue;
      return { country, countryCode: code, source: "reverse_geocode" };
    }
  }
  return null;
}

/**
 * Country label priority (do not re-ask AI):
 * 1. explicit hint
 * 2. entity metadata
 * 3. structured country/city index
 * 4. (coords handled separately via enrichDestinationCountry)
 */
export function resolveDestinationCountryLabel(
  destination: string,
  countryHint?: string | null,
): string | undefined {
  if (countryHint?.trim()) {
    const fromHint = normalizeCountryReference(countryHint);
    if (fromHint.country && fromHint.country !== "unknown") {
      return fromHint.country;
    }
    const hint = normalizeDestinationLabel(countryHint);
    // Ignore placeholder / ISO codes mistaken as names when a better source exists later.
    if (hint && hint !== "unknown" && hint.length > 1 && !/^[A-Z]{2}$/i.test(hint)) {
      return hint;
    }
    if (/^[A-Z]{2}$/i.test(hint)) {
      return countryLabelForCode(hint.toUpperCase());
    }
  }
  const label = normalizeDestinationLabel(destination);
  const entity = resolveDestinationEntity(label);
  if (entity.country) {
    return normalizeCountryReference(entity.country).country ?? normalizeDestinationLabel(entity.country);
  }
  const structured = lookupStructuredCountryForCity(label);
  if (structured) {
    return normalizeCountryReference(structured).country ?? structured;
  }
  return undefined;
}

/**
 * Enrich missing country from destination metadata + coordinates.
 * Never treats "unknown" as a coordinate mismatch — that is for validateDestinationScope.
 */
export function enrichDestinationCountry(params: {
  destination: string;
  country?: string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): {
  country?: string;
  countryCode?: string;
  source: DestinationCountrySource;
  enriched: boolean;
} {
  const destination = normalizeDestinationLabel(params.destination);
  const before =
    resolveDestinationCountryLabel(destination, params.country) ??
    (params.countryCode ? resolveDestinationCountryLabel(destination, params.countryCode) : undefined);

  const lat = params.latitude;
  const lng = params.longitude;
  const hasCoords =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);

  if (before) {
    const normalized = normalizeCountryReference(before, params.countryCode);
    return {
      country: normalized.country ?? before,
      countryCode:
        normalized.countryCode ||
        params.countryCode?.trim().toUpperCase() ||
        countryCodeForCountryName(before),
      source: params.country?.trim() ? "hint" : "entity",
      enriched: false,
    };
  }

  if (hasCoords) {
    logAiPipeline(
      "[DESTINATION_SCOPE_ENRICH_START]",
      `destination=${destination}`,
      `lat=${lat}`,
      `lng=${lng}`,
      "countryBefore=unknown",
    );
    logAiPipeline(
      "[UNKNOWN_COUNTRY_MISMATCH_BLOCKED]",
      "action=enrich_before_validation",
    );
  }

  // Entity / structured (re-resolve in case parent hints were updated)
  const entity = resolveDestinationEntity(destination);
  if (entity.country) {
    const country = normalizeDestinationLabel(entity.country);
    const countryCode = countryCodeForCountryName(country);
    logAiPipeline(
      "[DESTINATION_COUNTRY_ENRICHED]",
      `countryName=${country}`,
      `countryCode=${countryCode ?? "unknown"}`,
      "source=entity_db",
    );
    return { country, countryCode, source: "entity_db", enriched: true };
  }

  const structured = lookupStructuredCountryForCity(destination);
  if (structured) {
    const countryCode = countryCodeForCountryName(structured);
    logAiPipeline(
      "[DESTINATION_COUNTRY_ENRICHED]",
      `countryName=${structured}`,
      `countryCode=${countryCode ?? "unknown"}`,
      "source=structured",
    );
    return { country: structured, countryCode, source: "structured", enriched: true };
  }

  if (hasCoords) {
    const fromCoords = inferCountryFromCoordinates(lat!, lng!);
    if (fromCoords) {
      logAiPipeline(
        "[DESTINATION_COUNTRY_ENRICHED]",
        `countryName=${fromCoords.country}`,
        `countryCode=${fromCoords.countryCode}`,
        "source=reverse_geocode",
      );
      return {
        country: fromCoords.country,
        countryCode: fromCoords.countryCode,
        source: fromCoords.source,
        enriched: true,
      };
    }
  }

  return { source: "unknown", enriched: false };
}

export function getResolvedDestinationScope(
  destination: string,
  countryCode?: string,
): ResolvedDestinationScope | null {
  return scopeByDestination.get(scopeKey(destination, countryCode)) ?? null;
}

export type DestinationScopeValidation = {
  ok: boolean;
  reason?: string;
  country?: string;
  countryCode?: string;
};

/**
 * Hard gate before Places search in trip-planning mode.
 * Blocks wrong-country coordinates for *known* overseas destinations.
 * country=unknown with valid coords must enrich first — never treat as mismatch.
 */
export function validateDestinationScope(params: {
  destination: string;
  country?: string | null;
  countryCode?: string | null;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  /** When true (default), attempt country enrichment before mismatch checks. */
  enrichIfUnknown?: boolean;
}): DestinationScopeValidation {
  const destination = normalizeDestinationLabel(params.destination);
  const lat = params.latitude;
  const lng = params.longitude;
  const enrichIfUnknown = params.enrichIfUnknown !== false;

  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    logAiPipeline(
      "[DESTINATION_SCOPE_VALIDATION_FAILED]",
      "reason=missing_coordinates",
      `destination=${destination}`,
      `country=${params.country ?? "unknown"}`,
    );
    return { ok: false, reason: "missing_coordinates" };
  }

  let country = resolveDestinationCountryLabel(destination, params.country ?? params.countryCode);
  let countryCode =
    params.countryCode?.trim().toUpperCase() || countryCodeForCountryName(country);
  let countrySource: DestinationCountrySource | undefined;

  // Normalize English / ISO country strings from Geocode before enrichment.
  if (params.country?.trim() || params.countryCode?.trim()) {
    const normalized = normalizeCountryReference(params.country, params.countryCode);
    if (normalized.country && !country) country = normalized.country;
    if (normalized.countryCode && !countryCode) countryCode = normalized.countryCode;
    if (normalized.country && country === params.country) {
      country = normalized.country;
      countryCode = normalized.countryCode ?? countryCode;
    }
  }

  if (!country && enrichIfUnknown) {
    const enriched = enrichDestinationCountry({
      destination,
      country: params.country,
      countryCode: params.countryCode,
      latitude: lat,
      longitude: lng,
    });
    country = enriched.country;
    countryCode = enriched.countryCode ?? countryCode;
    countrySource = enriched.source;
  }

  if (!country) {
    logAiPipeline(
      "[DESTINATION_SCOPE_VALIDATION_FAILED]",
      "reason=country_unresolved",
      `destination=${destination}`,
      `lat=${lat}`,
      `lng=${lng}`,
    );
    return { ok: false, reason: "country_unresolved" };
  }

  const isTaiwanCountry = country === "台灣" || country === "台湾";

  // Explicit non-Taiwan country + Taiwan coords → real mismatch.
  if (!isTaiwanCountry && inBbox(lat, lng, TAIWAN_BBOX)) {
    logAiPipeline(
      "[DESTINATION_SCOPE_VALIDATION_FAILED]",
      "reason=country_coordinate_mismatch",
      `destination=${destination}`,
      `country=${country}`,
      `lat=${lat}`,
      `lng=${lng}`,
    );
    return { ok: false, reason: "country_coordinate_mismatch", country, countryCode };
  }
  if (!isTaiwanCountry && isNearTaiwanDefault(lat, lng)) {
    logAiPipeline(
      "[DESTINATION_SCOPE_VALIDATION_FAILED]",
      "reason=taiwan_default_fallback",
      `destination=${destination}`,
      `country=${country}`,
    );
    return { ok: false, reason: "taiwan_default_fallback", country, countryCode };
  }

  const box = COUNTRY_BBOX[country];
  if (box && !inBbox(lat, lng, box)) {
    logAiPipeline(
      "[DESTINATION_SCOPE_VALIDATION_FAILED]",
      "reason=country_coordinate_mismatch",
      `destination=${destination}`,
      `country=${country}`,
      `lat=${lat}`,
      `lng=${lng}`,
    );
    return { ok: false, reason: "country_coordinate_mismatch", country, countryCode };
  }

  logAiPipeline(
    "[DESTINATION_SCOPE_VALIDATION_PASSED]",
    `destination=${destination}`,
    `countryCode=${countryCode ?? countryCodeForCountryName(country) ?? "unknown"}`,
  );
  if (countrySource) {
    // already logged enrichment
  }

  return {
    ok: true,
    country,
    countryCode: countryCode ?? countryCodeForCountryName(country),
  };
}

/**
 * Atomically finalize a destination scope profile (coords + country + type + climate).
 * Same generationRequestId + scopeId reuses the prior profile.
 */
export function finalizeDestinationScope(params: {
  destination: string;
  latitude: number;
  longitude: number;
  source: DestinationCoordSource;
  country?: string | null;
  countryCode?: string | null;
  type?: DestinationEntityType | string | null;
  generationRequestId?: string | null;
}): ResolvedDestinationScope | null {
  const destination = normalizeDestinationLabel(params.destination);
  const scopeId = buildScopeId(destination, params.latitude, params.longitude, params.source);
  const requestKey = params.generationRequestId?.trim()
    ? `${params.generationRequestId.trim()}|${scopeId}`
    : null;

  if (requestKey) {
    const reused = finalizedProfileByRequest.get(requestKey);
    if (reused) {
      logAiPipeline(
        "[DESTINATION_PROFILE_REUSED]",
        `destinationScopeId=${reused.scopeId}`,
        `generationRequestId=${params.generationRequestId}`,
      );
      return reused;
    }
    const priorFail = validationFailureByRequest.get(requestKey);
    if (priorFail) {
      logAiPipeline(
        "[DESTINATION_PROFILE_REUSED]",
        `destinationScopeId=${scopeId}`,
        `generationRequestId=${params.generationRequestId}`,
        `priorFailure=${priorFail}`,
      );
      return null;
    }
  }

  const validation = validateDestinationScope({
    destination,
    country: params.country,
    countryCode: params.countryCode,
    latitude: params.latitude,
    longitude: params.longitude,
  });
  if (!validation.ok) {
    if (requestKey) {
      validationFailureByRequest.set(requestKey, validation.reason ?? "invalid");
    }
    return null;
  }

  const entity = resolveDestinationEntity(destination);
  const climate = resolveClimateZoneForDestination({
    destination,
    country: validation.country,
    latitude: params.latitude,
    longitude: params.longitude,
  });

  const full: ResolvedDestinationScope = {
    displayName: destination,
    normalizedName: destination,
    country: validation.country,
    countryCode: validation.countryCode ?? countryCodeForCountryName(validation.country),
    type: params.type ?? entity.type,
    latitude: params.latitude,
    longitude: params.longitude,
    source: params.source,
    resolvedAt: Date.now(),
    scopeId,
  };

  scopeByDestination.set(scopeKey(destination, full.countryCode), full);
  scopeByDestination.set(scopeKey(destination), full);

  if (requestKey) {
    finalizedProfileByRequest.set(requestKey, full);
  }

  logAiPipeline(
    "[DESTINATION_SCOPE_FINAL]",
    `destination=${full.normalizedName}`,
    `type=${full.type ?? "unknown"}`,
    `country=${full.country ?? "unknown"}`,
    `countryCode=${full.countryCode ?? "unknown"}`,
    `lat=${full.latitude}`,
    `lng=${full.longitude}`,
  );
  logAiPipeline(
    "[CLIMATE_PROFILE_RESOLVED]",
    `destination=${destination}`,
    `source=${climate.source}`,
    `climateZone=${climate.climateZone}`,
  );

  return full;
}

/** Chat-context patch fields written together after scope finalize. */
export function buildDestinationScopeContextPatch(scope: ResolvedDestinationScope): {
  destination: string;
  destinationType: string;
  destinationCountry?: string;
  destinationCountryCode?: string;
  destinationCity?: string;
  destinationRegion?: string;
  destinationScopeId: string;
  destinationCoordinates: { lat: number; lng: number };
} {
  const isRegionLike =
    scope.type === "region" ||
    scope.type === "island" ||
    scope.type === "state";
  const isCityState = scope.type === "city_state";
  return {
    destination: scope.normalizedName,
    destinationType: scope.type ?? "city",
    destinationCountry: scope.country ?? (isCityState ? scope.normalizedName : undefined),
    destinationCountryCode: scope.countryCode,
    destinationCity: isRegionLike ? undefined : scope.normalizedName,
    destinationRegion: isRegionLike ? scope.normalizedName : undefined,
    destinationScopeId: scope.scopeId,
    destinationCoordinates: { lat: scope.latitude, lng: scope.longitude },
  };
}

export function setResolvedDestinationScope(
  scope: Omit<ResolvedDestinationScope, "scopeId"> & { scopeId?: string },
): ResolvedDestinationScope | null {
  const key = scopeKey(scope.normalizedName, scope.countryCode ?? scope.country);
  const existing = scopeByDestination.get(key);

  const validation = validateDestinationScope({
    destination: scope.normalizedName,
    country: scope.country ?? scope.countryCode,
    countryCode: scope.countryCode,
    latitude: scope.latitude,
    longitude: scope.longitude,
  });
  if (!validation.ok) {
    logAiPipeline(
      "[STALE_DESTINATION_COORDINATES_BLOCKED]",
      `oldDestination=${existing?.normalizedName ?? "none"}`,
      `newDestination=${scope.normalizedName}`,
      `reason=${validation.reason ?? "invalid"}`,
    );
    return existing ?? null;
  }

  // Never clear / overwrite a locked coordinate with a worse empty outcome.
  if (existing && Number.isFinite(existing.latitude) && Number.isFinite(existing.longitude)) {
    if (scope.source === "geocode" && existing.source !== "geocode") {
      return existing;
    }
    if (
      existing.normalizedName !== scope.normalizedName ||
      (existing.country && scope.country && existing.country !== scope.country)
    ) {
      logAiPipeline(
        "[STALE_DESTINATION_COORDINATES_BLOCKED]",
        `oldDestination=${existing.normalizedName}`,
        `newDestination=${scope.normalizedName}`,
      );
    }
  }

  const full: ResolvedDestinationScope = {
    ...scope,
    country: validation.country ?? scope.country,
    countryCode:
      validation.countryCode ??
      scope.countryCode ??
      countryCodeForCountryName(validation.country ?? scope.country),
    scopeId:
      scope.scopeId ??
      buildScopeId(scope.normalizedName, scope.latitude, scope.longitude, scope.source),
  };
  scopeByDestination.set(key, full);
  // Also index by destination-only key for callers that omit country.
  scopeByDestination.set(scopeKey(scope.normalizedName), full);
  logAiPipeline(
    "[DESTINATION_SCOPE_LOCKED]",
    `destination=${full.normalizedName}`,
    `lat=${full.latitude}`,
    `lng=${full.longitude}`,
    `source=${full.source}`,
    `scopeId=${full.scopeId}`,
    `country=${full.country ?? "unknown"}`,
    `countryCode=${full.countryCode ?? "unknown"}`,
  );
  return full;
}

export function clearResolvedDestinationScope(destination?: string): void {
  if (!destination) {
    scopeByDestination.clear();
    finalizedProfileByRequest.clear();
    validationFailureByRequest.clear();
    return;
  }
  const label = normalizeDestinationLabel(destination);
  for (const key of [...scopeByDestination.keys()]) {
    if (key === label || key.startsWith(`${label}|`)) {
      scopeByDestination.delete(key);
    }
  }
  for (const key of [...finalizedProfileByRequest.keys()]) {
    if (key.includes(`|${label}:`) || key.endsWith(`|${label}`) || key.includes(`:${label}:`)) {
      // Keys are generationRequestId|scopeId; scopeId starts with label:
      if (key.includes(`|${label}:`)) finalizedProfileByRequest.delete(key);
    }
  }
  for (const key of [...validationFailureByRequest.keys()]) {
    if (key.includes(`|${label}:`)) validationFailureByRequest.delete(key);
  }
}

/**
 * Unified destination coordinate priority:
 * 1. Locked scope
 * 2. Places geometry (caller-supplied)
 * 3. Approx center (injected to avoid circular imports with destination-geocode)
 */
export function resolveDestinationCoordinates(params: {
  destination: string;
  countryCode?: string;
  country?: string;
  placesGeometry?: { lat: number; lng: number } | null;
  approxCenter?: { lat: number; lng: number } | null;
  generationRequestId?: string;
}): {
  coordinates: { lat: number; lng: number } | null;
  source: DestinationCoordSource | null;
  scope: ResolvedDestinationScope | null;
} {
  const label = normalizeDestinationLabel(params.destination);
  if (!label) return { coordinates: null, source: null, scope: null };
  let country = resolveDestinationCountryLabel(
    label,
    params.country ?? params.countryCode,
  );

  const locked = getResolvedDestinationScope(label, params.countryCode);
  if (locked) {
    const v = validateDestinationScope({
      destination: label,
      country: locked.country ?? country,
      countryCode: locked.countryCode,
      latitude: locked.latitude,
      longitude: locked.longitude,
    });
    if (v.ok) {
      logAiPipeline(
        "[DESTINATION_RESOLUTION_REUSED]",
        `source=scope_lock`,
        `destination=${label}`,
        `lat=${locked.latitude}`,
        `lng=${locked.longitude}`,
      );
      const scope =
        locked.country === v.country
          ? locked
          : {
              ...locked,
              country: v.country,
              countryCode: v.countryCode ?? locked.countryCode,
            };
      if (scope !== locked) {
        setResolvedDestinationScope(scope);
      }
      return {
        coordinates: { lat: locked.latitude, lng: locked.longitude },
        source: "scope_lock",
        scope,
      };
    }
    // Drop stale wrong-country lock (e.g. Taiwan coords for Edinburgh).
    clearResolvedDestinationScope(label);
    logAiPipeline(
      "[STALE_DESTINATION_COORDINATES_BLOCKED]",
      `oldDestination=${locked.normalizedName}`,
      `newDestination=${label}`,
      `reason=${v.reason ?? "invalid_lock"}`,
    );
  }

  const places = params.placesGeometry;
  if (
    places &&
    Number.isFinite(places.lat) &&
    Number.isFinite(places.lng) &&
    (Math.abs(places.lat) > 0.001 || Math.abs(places.lng) > 0.001)
  ) {
    const enriched = enrichDestinationCountry({
      destination: label,
      country,
      countryCode: params.countryCode,
      latitude: places.lat,
      longitude: places.lng,
    });
    country = enriched.country ?? country;
    const v = validateDestinationScope({
      destination: label,
      country,
      countryCode: enriched.countryCode ?? params.countryCode,
      latitude: places.lat,
      longitude: places.lng,
    });
    if (v.ok) {
      try {
        const scope = setResolvedDestinationScope({
          displayName: label,
          normalizedName: label,
          country: v.country,
          countryCode: v.countryCode ?? params.countryCode,
          latitude: places.lat,
          longitude: places.lng,
          source: "places_geometry",
          resolvedAt: Date.now(),
        });
        if (scope) {
          logAiPipeline(
            "[DESTINATION_RESOLUTION_REUSED]",
            `source=places_geometry`,
            `destination=${label}`,
            `lat=${places.lat}`,
            `lng=${places.lng}`,
          );
          return {
            coordinates: { lat: places.lat, lng: places.lng },
            source: "places_geometry",
            scope,
          };
        }
      } catch {
        // fall through
      }
    }
  }

  const approx = params.approxCenter;
  if (approx && Number.isFinite(approx.lat) && Number.isFinite(approx.lng)) {
    const enriched = enrichDestinationCountry({
      destination: label,
      country,
      countryCode: params.countryCode,
      latitude: approx.lat,
      longitude: approx.lng,
    });
    country = enriched.country ?? country;
    const v = validateDestinationScope({
      destination: label,
      country,
      countryCode: enriched.countryCode ?? params.countryCode,
      latitude: approx.lat,
      longitude: approx.lng,
    });
    if (v.ok) {
      const scope =
        finalizeDestinationScope({
          destination: label,
          latitude: approx.lat,
          longitude: approx.lng,
          source: "approx_center",
          country: v.country,
          countryCode: v.countryCode ?? params.countryCode,
          generationRequestId: params.generationRequestId,
        }) ??
        setResolvedDestinationScope({
          displayName: label,
          normalizedName: label,
          country: v.country,
          countryCode: v.countryCode ?? params.countryCode,
          latitude: approx.lat,
          longitude: approx.lng,
          source: "approx_center",
          resolvedAt: Date.now(),
        });
      if (scope) {
        logAiPipeline(
          "[DESTINATION_RESOLUTION_REUSED]",
          `source=approx_center`,
          `destination=${label}`,
          `lat=${approx.lat}`,
          `lng=${approx.lng}`,
        );
        return {
          coordinates: { lat: approx.lat, lng: approx.lng },
          source: "approx_center",
          scope,
        };
      }
    } else {
      logAiPipeline(
        "[STALE_DESTINATION_COORDINATES_BLOCKED]",
        `oldDestination=approx_reject`,
        `newDestination=${label}`,
        `reason=${v.reason ?? "invalid_approx"}`,
      );
    }
  }

  return { coordinates: null, source: null, scope: null };
}

export function lockDestinationCoordinatesFromGeocode(params: {
  destination: string;
  lat: number;
  lng: number;
  countryCode?: string;
  country?: string;
}): ResolvedDestinationScope | null {
  const enriched = enrichDestinationCountry({
    destination: params.destination,
    country: params.country ?? params.countryCode,
    countryCode: params.countryCode,
    latitude: params.lat,
    longitude: params.lng,
  });
  return setResolvedDestinationScope({
    displayName: normalizeDestinationLabel(params.destination),
    normalizedName: normalizeDestinationLabel(params.destination),
    country: enriched.country,
    countryCode: enriched.countryCode ?? params.countryCode,
    countrySource: enriched.source,
    latitude: params.lat,
    longitude: params.lng,
    source: "geocode",
    resolvedAt: Date.now(),
  });
}
