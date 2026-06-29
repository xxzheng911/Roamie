import type { LatLng } from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";
import type { TransitUnavailableProvider } from "@/lib/transit/types";

export type RouteLegScope = {
  tripId: string;
  dayIndex: number;
  legIndex: number;
  legKey: string;
};

export type RouteLegDurationResult = {
  ok: boolean;
  durationMinutes: number;
  distanceMeters: number;
  mode: RoutesTravelMode;
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
};
