import { placesSearchTextUrl } from "@/lib/google-maps-api";
import {
  isGoogleBillingDisabledError,
  isGooglePlacesIosAppBlockedError,
  isGooglePlacesPermissionError,
} from "@/lib/places-api-errors";

export type ExploreSearchRequestLog = {
  query?: string;
  rawQuery?: string;
  finalQuery?: string;
  lat: number;
  lng: number;
  radius: number;
  endpoint: string;
  transport?:
    | "google_direct"
    | "bundled_api"
    | "server_fn"
    | "autocomplete_fallback"
    | "trip_stops_fallback"
    | "map_ui"
    | "map_primary";
  mode?: string;
  exploreMapTextSearch?: boolean;
  locationBias?: boolean;
};

export function logExploreSearchFiltered(params: {
  beforeCount: number;
  afterCount: number;
  filterReason: string;
}): void {
  console.info("[EXPLORE_SEARCH_FILTERED]", params);
}

export function logExploreSearchRequest(params: ExploreSearchRequestLog): void {
  console.info("[EXPLORE_SEARCH_REQUEST]", params);
}

export function logExploreSearchResponse(params: {
  status: number | string;
  resultCount: number;
  firstPlaceName: string | null;
  rawResultCount?: number;
  mappedResultCount?: number;
  error?: string | null;
  transport?: string;
}): void {
  console.info("[EXPLORE_SEARCH_RESPONSE]", params);
}

export type ExploreSearchTransport =
  | "google_direct"
  | "bundled_api"
  | "server_fn"
  | "autocomplete_fallback"
  | "trip_stops_fallback"
  | "map_ui"
  | "map_primary";

export function logExploreSearchResponseBody(fullBody: unknown): void {
  console.info("[EXPLORE_SEARCH_RESPONSE_BODY]", fullBody);
}

export function logExploreSearchSkipped(reason: string, detail?: Record<string, unknown>): void {
  console.info("[EXPLORE_SEARCH_SKIPPED]", { reason, ...detail });
}

export function logExploreSearchDeniedDiagnostics(params: {
  error: string;
  apiKeyHint: string;
  keySource: string;
  placesApiEnabled: string;
  billingEnabled: string;
  restrictions: string;
}): void {
  console.info("[EXPLORE_SEARCH_REQUEST_DENIED]", params);
}

export function maskApiKeyHint(apiKey: string | null | undefined): string {
  const k = apiKey?.trim() ?? "";
  if (!k) return "(missing)";
  if (k.length <= 8) return `${k.slice(0, 2)}…`;
  return `${k.slice(0, 6)}…${k.slice(-4)} (len=${k.length})`;
}

export function buildRequestDeniedDiagnostics(
  error: string,
  keySource: string,
  apiKey?: string | null,
): void {
  if (
    !isGooglePlacesPermissionError(error) &&
    !isGoogleBillingDisabledError(error) &&
    !/REQUEST_DENIED|403|PERMISSION/i.test(error)
  ) {
    return;
  }

  const restrictions: string[] = [];
  if (isGooglePlacesIosAppBlockedError(error)) {
    restrictions.push("iOS_app_restriction_on_server_key");
  }
  if (/referer|referrer/i.test(error)) {
    restrictions.push("http_referrer_restriction");
  }
  if (/IP address/i.test(error)) {
    restrictions.push("ip_restriction");
  }
  if (isGoogleBillingDisabledError(error)) {
    restrictions.push("billing_not_enabled");
  }

  logExploreSearchDeniedDiagnostics({
    error: error.slice(0, 500),
    apiKeyHint: maskApiKeyHint(apiKey),
    keySource,
    placesApiEnabled: "check_Google_Cloud_Places_API_New_enabled",
    billingEnabled: isGoogleBillingDisabledError(error)
      ? "likely_disabled"
      : "check_GCP_billing_account",
    restrictions: restrictions.length ? restrictions.join(", ") : "see_error_message",
  });
}

export function textSearchEndpoint(): string {
  return placesSearchTextUrl();
}
