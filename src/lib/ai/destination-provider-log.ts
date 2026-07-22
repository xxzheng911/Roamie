/**
 * Destination Anchor provider diagnostics.
 *
 * Always emits via console.info (not gated by VITE_VERBOSE_LOG) so Xcode /
 * Capacitor WebView and Node verify scripts can see the real execution path.
 *
 * Geocode itself may run inside createServerFn (server stdout). Callers on the
 * client path must also log after geocodeFn returns so device consoles see it.
 */

export const DESTINATION_ANCHOR_BUILD_VERSION = "destination-resolution-v3";

let buildVersionLogged = false;

export function logDestinationAnchorBuildVersion(extra?: Record<string, string | number | boolean | undefined | null>): void {
  if (buildVersionLogged) return;
  buildVersionLogged = true;
  const parts = Object.entries({
    version: DESTINATION_ANCHOR_BUILD_VERSION,
    buildTime: typeof import.meta !== "undefined" && import.meta.env?.VITE_BUILD_TIME
      ? String(import.meta.env.VITE_BUILD_TIME)
      : new Date().toISOString(),
    ...extra,
  })
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  console.info("[DESTINATION_ANCHOR_BUILD_VERSION]", ...parts);
}

function formatParts(
  parts: Record<string, string | number | boolean | undefined | null>,
): string[] {
  return Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`);
}

/** Always-on destination diagnostics (bypass verbose gate). */
export function logDestinationDiag(
  tag: string,
  parts: Record<string, string | number | boolean | undefined | null> = {},
): void {
  console.info(tag, ...formatParts(parts));
}

export function newDestinationProviderRequestId(): string {
  return `dpr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function logDestinationProviderRequest(params: {
  requestId: string;
  destination?: string;
  normalizedDestination?: string;
  countryCode?: string;
  entityType?: string;
  provider: string;
  query: string;
  attempt?: number;
  requestPath?: string;
  cacheHit?: boolean;
  platform?: string;
}): void {
  logDestinationDiag("[DESTINATION_PROVIDER_REQUEST]", {
    requestId: params.requestId,
    destination: params.destination,
    normalizedDestination: params.normalizedDestination,
    countryCode: params.countryCode ?? "unknown",
    entityType: params.entityType,
    provider: params.provider,
    query: params.query,
    attempt: params.attempt,
    requestPath: params.requestPath,
    cacheHit: params.cacheHit === true,
    platform: params.platform ?? detectPlatform(),
  });
}

export function logDestinationProviderResponse(params: {
  requestId: string;
  provider: string;
  query: string;
  destination?: string;
  httpStatus?: number;
  apiStatus?: string;
  rawResultCount?: number;
  parsedResultCount?: number;
  hasGeometry?: boolean;
  hasLocation?: boolean;
  latitude?: number;
  longitude?: number;
  failureReason?: string;
  errorCode?: string;
  errorMessage?: string;
  responseShape?: string;
  elapsedMs?: number;
}): void {
  const hasLocation =
    params.hasLocation === true ||
    params.hasGeometry === true ||
    (typeof params.latitude === "number" &&
      typeof params.longitude === "number" &&
      Number.isFinite(params.latitude) &&
      Number.isFinite(params.longitude));
  logDestinationDiag("[DESTINATION_PROVIDER_RESPONSE]", {
    requestId: params.requestId,
    provider: params.provider,
    destination: params.destination,
    query: params.query,
    httpStatus: params.httpStatus,
    apiStatus: params.apiStatus,
    rawResultCount: params.rawResultCount ?? 0,
    parsedResultCount: params.parsedResultCount ?? 0,
    hasGeometry: hasLocation,
    hasLocation,
    latitude: hasLocation ? params.latitude : undefined,
    longitude: hasLocation ? params.longitude : undefined,
    failureReason: hasLocation ? undefined : params.failureReason ?? params.errorCode,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    responseShape: params.responseShape,
    elapsedMs: params.elapsedMs,
  });
}

export function logDestinationProviderParseResult(params: {
  destination?: string;
  accepted: boolean;
  sourceShape?: string;
  latitude?: number;
  longitude?: number;
  reason?: string;
  provider?: string;
  query?: string;
}): void {
  logDestinationDiag("[DESTINATION_PROVIDER_PARSE_RESULT]", {
    destination: params.destination,
    accepted: params.accepted,
    sourceShape: params.sourceShape ?? "unknown",
    latitude: params.accepted ? params.latitude : undefined,
    longitude: params.accepted ? params.longitude : undefined,
    reason: params.reason,
    provider: params.provider,
    query: params.query,
  });
}

export function logDestinationServerRequest(params: {
  provider: string;
  endpoint: string;
  query: string;
  language?: string;
  region?: string;
  requestId?: string;
  transport?: "server" | "client";
}): void {
  logDestinationDiag("[DESTINATION_SERVER_REQUEST]", {
    provider: params.provider,
    endpoint: params.endpoint,
    query: params.query,
    language: params.language,
    region: params.region ?? "none",
    requestId: params.requestId,
    transport: params.transport ?? "server",
    platform: detectPlatform(),
  });
}

export function logDestinationServerResponse(params: {
  provider: string;
  httpStatus?: number;
  googleStatus?: string;
  resultCount?: number;
  errorMessage?: string;
  requestId?: string;
  elapsedMs?: number;
}): void {
  logDestinationDiag("[DESTINATION_SERVER_RESPONSE]", {
    provider: params.provider,
    httpStatus: params.httpStatus,
    googleStatus: params.googleStatus ?? "unknown",
    resultCount: params.resultCount ?? 0,
    errorMessage: params.errorMessage,
    requestId: params.requestId,
    elapsedMs: params.elapsedMs,
  });
}

export function logDestinationProviderNormalized(params: {
  provider: string;
  coordinateField?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  source?: string;
  query?: string;
  accepted?: boolean;
}): void {
  logDestinationDiag("[DESTINATION_PROVIDER_NORMALIZED]", {
    provider: params.provider,
    coordinateField: params.coordinateField ?? "none",
    latitude: params.latitude,
    longitude: params.longitude,
    placeId: params.placeId,
    source: params.source,
    query: params.query,
    accepted: params.accepted === true,
  });
}

function detectPlatform(): string {
  if (typeof window === "undefined") return "server";
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } })
      .Capacitor;
    if (cap?.isNativePlatform?.()) return cap.getPlatform?.() ?? "native";
  } catch {
    /* ignore */
  }
  return "web";
}
