import type { LatLng } from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";
import { fetchRouteResult, type FetchRouteQueryOptions } from "@/services/routesService";
import { extractGoogleRouteStatus } from "@/lib/google-routes-fetch";
import { logRouteOnce } from "@/lib/route-duration-log";
import type { RouteLegDurationResult, RouteLegScope } from "@/lib/saved-trip/route-duration-types";
import type { TransitUnavailableProvider } from "@/lib/transit/types";

export type RouteDurationProviderId = "google_directions" | "japan_transit";

export type RouteDurationProviderContext = {
  scope: RouteLegScope;
  origin: LatLng;
  destination: LatLng;
  preferredMode: RoutesTravelMode;
  query: FetchRouteQueryOptions;
  cacheKey: string;
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
  provider: TransitUnavailableProvider,
): RouteLegDurationResult {
  return {
    ok: false,
    durationMinutes: 0,
    distanceMeters: 0,
    mode: "TRANSIT",
    usedWalkFallback: false,
    transitUnavailable: true,
    transitUnavailableProvider: provider,
    estimates: { distanceMeters: 0, transit: undefined },
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
  return transitUnavailableResult("google_maps_deeplink");
}

/** 非日本或 walking / driving 等模式 */
export async function googleDirectionsProvider(
  ctx: RouteDurationProviderContext,
): Promise<RouteLegDurationResult> {
  const { scope, origin, destination, preferredMode, query, cacheKey } = ctx;

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
      `[ROUTE_TRANSIT_ERROR] leg=${scope.legKey} status=${primaryStatus} message=${primary.message ?? "route_failed"} region=${query.region ?? "auto"} provider=google_directions`,
    );

    return transitUnavailableResult(null);
  }

  const primary = await fetchRouteResult(origin, destination, preferredMode, query);
  if (primary.ok) {
    return {
      ok: true,
      durationMinutes: primary.data.durationMinutes,
      distanceMeters: primary.data.distanceMeters,
      mode: preferredMode,
      usedWalkFallback: false,
      transitUnavailable: false,
      transitUnavailableProvider: null,
      estimates: estimatesForMode(
        primary.data.durationMinutes,
        preferredMode,
        primary.data.distanceMeters,
      ),
    };
  }

  return {
    ok: false,
    durationMinutes: 0,
    distanceMeters: 0,
    mode: preferredMode,
    usedWalkFallback: false,
    transitUnavailable: false,
    transitUnavailableProvider: null,
    estimates: { distanceMeters: 0 },
  };
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
