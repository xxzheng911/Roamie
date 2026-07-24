import type { LatLng } from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";
import type { TransitUnavailableProvider } from "@/lib/transit/types";

export type RouteLegScope = {
  tripId: string;
  dateKey: string;
  dayIndex: number;
  legIndex: number;
  legKey: string;
};

export type RouteLegDurationResult = {
  ok: boolean;
  durationMinutes: number;
  distanceMeters: number;
  mode: RoutesTravelMode;
  /** Preference / initial request mode (may differ from mode after fallback). */
  requestedMode?: RoutesTravelMode;
  /** Same as mode when ok — explicit SoT alias. */
  resolvedMode?: RoutesTravelMode;
  fallbackReason?: string | null;
  durationSource?: "directions" | "estimate" | "none";
  routeStatus?: "ok" | "failed" | "mode_unavailable" | "transit_unavailable";
  usedWalkFallback: boolean;
  /** 單車等模式改以 driving/walking 估算 */
  usedEstimatedFallback?: boolean;
  /** fallback 實際採用的 Routes mode */
  fallbackEstimateMode?: RoutesTravelMode;
  transitUnavailable: boolean;
  transitUnavailableProvider?: TransitUnavailableProvider;
  estimates: {
    walk?: number;
    drive?: number;
    transit?: number;
    distanceMeters: number;
  };
};

export type FetchLegDurationInput = {
  scope: RouteLegScope;
  origin: LatLng;
  destination: LatLng;
  preferredMode: RoutesTravelMode;
  query: import("@/services/routesService").FetchRouteQueryOptions;
  force?: boolean;
  /**
   * When false (manual mode switch): only fetch preferredMode.
   * Do not return another mode's duration.
   */
  allowModeFallback?: boolean;
};
