import type { RoutesTravelMode } from "@/lib/routes/types";
import { logRouteOnce } from "@/lib/route-duration-log";
import {
  fetchRouteWithDirectionFallbacks,
  type RouteFetchContext,
} from "@/lib/saved-trip/route-duration-fallback";
import type { RouteLegDurationResult, RouteLegScope } from "@/lib/saved-trip/route-duration-types";
import type { TransitUnavailableProvider } from "@/lib/transit/types";
import { fetchRouteResult, type FetchRouteQueryOptions } from "@/services/routesService";
import { extractGoogleRouteStatus } from "@/lib/google-routes-fetch";

export type RouteDurationProviderId = "google_directions" | "japan_transit";

export type RouteDurationProviderContext = {
  scope: RouteLegScope;
  origin: import("@/lib/google-routes-fetch").LatLng;
  destination: import("@/lib/google-routes-fetch").LatLng;
  preferredMode: RoutesTravelMode;
  query: FetchRouteQueryOptions;
  cacheKey: string;
  allowModeFallback?: boolean;
};

function googleStatusFromResult(result: {
  ok: boolean;
  message?: string;
  googleStatus?: string;
}): string {
  if (!result.ok) {
    if (result.googleStatus) return result.googleStatus;
    if (result.message) return extractGoogleRouteStatus(result.message);
  }
  return result.ok ? "OK" : "UNKNOWN";
}

function estimatesForMode(minutes: number, mode: RoutesTravelMode, distanceMeters: number) {
  return {
    distanceMeters,
    walk: mode === "WALK" || mode === "BICYCLE" ? minutes : undefined,
    drive: mode === "DRIVE" || mode === "TWO_WHEELER" ? minutes : undefined,
    transit: mode === "TRANSIT" ? minutes : undefined,
  };
}

function transitUnavailableResult(
  preferredMode: RoutesTravelMode,
  provider: TransitUnavailableProvider,
): RouteLegDurationResult {
  return {
    ok: false,
    durationMinutes: 0,
    distanceMeters: 0,
    mode: preferredMode,
    requestedMode: preferredMode,
    resolvedMode: preferredMode,
    fallbackReason: "transit_unavailable",
    durationSource: "none",
    routeStatus: "transit_unavailable",
    usedWalkFallback: false,
    transitUnavailable: true,
    transitUnavailableProvider: provider,
    estimates: { distanceMeters: 0, transit: undefined },
  };
}

function toFetchContext(ctx: RouteDurationProviderContext): RouteFetchContext {
  return {
    scope: ctx.scope,
    origin: ctx.origin,
    destination: ctx.destination,
    query: ctx.query,
    cacheKey: ctx.cacheKey,
  };
}

/** 日本大眾運輸：不呼叫 Directions API，改由 Google Maps App 深連結 */
export async function japanTransitProvider(
  ctx: RouteDurationProviderContext,
): Promise<RouteLegDurationResult> {
  logRouteOnce(
    `japan_transit|${ctx.cacheKey}`,
    `[TRANSIT_JAPAN_MAPS] leg=${ctx.scope.legKey} provider=japan_transit action=google_maps_deeplink skipped=google_directions_api`,
  );
  return transitUnavailableResult(ctx.preferredMode, "google_maps_deeplink");
}

/** 非日本或 walking / driving 等模式 */
export async function googleDirectionsProvider(
  ctx: RouteDurationProviderContext,
): Promise<RouteLegDurationResult> {
  const { scope, origin, destination, preferredMode, query, cacheKey } = ctx;
  const allowModeFallback = ctx.allowModeFallback !== false;

  if (preferredMode === "TRANSIT") {
    logRouteOnce(
      `transit_req|${cacheKey}`,
      `[ROUTE_TRANSIT_REQUEST] leg=${scope.legKey} origin=${origin.lat},${origin.lng} destination=${destination.lat},${destination.lng} departure_time=${query.departureTime ?? "now"} region=${query.region ?? "auto"} provider=google_directions`,
    );

    const primary = await fetchRouteResult(origin, destination, "TRANSIT", query);

    if (primary.ok) {
      return {
        ok: true,
        durationMinutes: primary.data.durationMinutes,
        distanceMeters: primary.data.distanceMeters,
        mode: "TRANSIT",
        requestedMode: preferredMode,
        resolvedMode: "TRANSIT",
        fallbackReason: null,
        durationSource: "directions",
        routeStatus: "ok",
        usedWalkFallback: false,
        transitUnavailable: false,
        transitUnavailableProvider: null,
        estimates: estimatesForMode(
          primary.data.durationMinutes,
          "TRANSIT",
          primary.data.distanceMeters,
        ),
      };
    }

    const primaryStatus = googleStatusFromResult(primary);
    logRouteOnce(
      `transit_err|${cacheKey}|${primaryStatus}`,
      `[ROUTE_TRANSIT_ERROR] leg=${scope.legKey} status=${primaryStatus} message=${primary.message ?? "route_failed"} available=${primary.availableTravelModes?.join(",") ?? "n/a"} region=${query.region ?? "auto"} provider=google_directions`,
    );

    return transitUnavailableResult(preferredMode, null);
  }

  return fetchRouteWithDirectionFallbacks(toFetchContext(ctx), preferredMode, {
    allowModeFallback,
  });
}

export function resolveRouteDurationProviderId(
  preferredMode: RoutesTravelMode,
  query?: FetchRouteQueryOptions,
): RouteDurationProviderId {
  if (preferredMode === "TRANSIT" && query?.region === "jp") {
    return "japan_transit";
  }
  return "google_directions";
}

export async function fetchRouteDurationFromProvider(
  ctx: RouteDurationProviderContext,
): Promise<RouteLegDurationResult> {
  const providerId = resolveRouteDurationProviderId(ctx.preferredMode, ctx.query);
  if (providerId === "japan_transit") {
    return japanTransitProvider(ctx);
  }
  return googleDirectionsProvider(ctx);
}
