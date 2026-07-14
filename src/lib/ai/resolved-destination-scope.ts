import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export type DestinationCoordSource =
  | "scope_lock"
  | "cache"
  | "places_geometry"
  | "approx_center"
  | "geocode";

export type ResolvedDestinationScope = {
  displayName: string;
  normalizedName: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  source: DestinationCoordSource;
  resolvedAt: number;
};

const scopeByDestination = new Map<string, ResolvedDestinationScope>();

function scopeKey(destination: string, countryCode?: string): string {
  const label = normalizeDestinationLabel(destination);
  const cc = (countryCode ?? "").trim().toUpperCase();
  return cc ? `${label}|${cc}` : label;
}

export function getResolvedDestinationScope(
  destination: string,
  countryCode?: string,
): ResolvedDestinationScope | null {
  return scopeByDestination.get(scopeKey(destination, countryCode)) ?? null;
}

export function setResolvedDestinationScope(
  scope: ResolvedDestinationScope,
): ResolvedDestinationScope {
  const key = scopeKey(scope.normalizedName, scope.countryCode);
  const existing = scopeByDestination.get(key);
  // Never clear / overwrite a locked coordinate with a worse empty outcome.
  if (existing && Number.isFinite(existing.latitude) && Number.isFinite(existing.longitude)) {
    if (scope.source === "geocode" && existing.source !== "geocode") {
      return existing;
    }
  }
  scopeByDestination.set(key, scope);
  logAiPipeline(
    "[DESTINATION_SCOPE_LOCKED]",
    `destination=${scope.normalizedName}`,
    `lat=${scope.latitude}`,
    `lng=${scope.longitude}`,
    `source=${scope.source}`,
  );
  return scope;
}

export function clearResolvedDestinationScope(destination?: string): void {
  if (!destination) {
    scopeByDestination.clear();
    return;
  }
  const label = normalizeDestinationLabel(destination);
  for (const key of [...scopeByDestination.keys()]) {
    if (key === label || key.startsWith(`${label}|`)) {
      scopeByDestination.delete(key);
    }
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
  placesGeometry?: { lat: number; lng: number } | null;
  approxCenter?: { lat: number; lng: number } | null;
}): {
  coordinates: { lat: number; lng: number } | null;
  source: DestinationCoordSource | null;
  scope: ResolvedDestinationScope | null;
} {
  const label = normalizeDestinationLabel(params.destination);
  if (!label) return { coordinates: null, source: null, scope: null };

  const locked = getResolvedDestinationScope(label, params.countryCode);
  if (locked) {
    logAiPipeline(
      "[DESTINATION_RESOLUTION_REUSED]",
      `source=scope_lock`,
      `destination=${label}`,
      `lat=${locked.latitude}`,
      `lng=${locked.longitude}`,
    );
    return {
      coordinates: { lat: locked.latitude, lng: locked.longitude },
      source: "scope_lock",
      scope: locked,
    };
  }

  const places = params.placesGeometry;
  if (
    places &&
    Number.isFinite(places.lat) &&
    Number.isFinite(places.lng) &&
    (Math.abs(places.lat) > 0.001 || Math.abs(places.lng) > 0.001)
  ) {
    const scope = setResolvedDestinationScope({
      displayName: label,
      normalizedName: label,
      countryCode: params.countryCode,
      latitude: places.lat,
      longitude: places.lng,
      source: "places_geometry",
      resolvedAt: Date.now(),
    });
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

  const approx = params.approxCenter;
  if (approx && Number.isFinite(approx.lat) && Number.isFinite(approx.lng)) {
    const scope = setResolvedDestinationScope({
      displayName: label,
      normalizedName: label,
      countryCode: params.countryCode,
      latitude: approx.lat,
      longitude: approx.lng,
      source: "approx_center",
      resolvedAt: Date.now(),
    });
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

  return { coordinates: null, source: null, scope: null };
}

export function lockDestinationCoordinatesFromGeocode(params: {
  destination: string;
  lat: number;
  lng: number;
  countryCode?: string;
}): ResolvedDestinationScope {
  return setResolvedDestinationScope({
    displayName: normalizeDestinationLabel(params.destination),
    normalizedName: normalizeDestinationLabel(params.destination),
    countryCode: params.countryCode,
    latitude: params.lat,
    longitude: params.lng,
    source: "geocode",
    resolvedAt: Date.now(),
  });
}
