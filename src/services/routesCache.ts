import { API_CACHE_TTL_MS } from "@/lib/api/constants";
import type { RoutesTravelMode } from "@/lib/routes/types";
import { createRequestCache } from "@/services/requestCache";

export type LatLng = { lat: number; lng: number };

const routesCache = createRequestCache({
  prefix: "routes",
  ttlMs: API_CACHE_TTL_MS.routes,
});

export function routesCacheKey(
  origin: LatLng,
  destination: LatLng,
  travelMode: RoutesTravelMode,
): string {
  const o = `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}`;
  const d = `${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
  return `${o}|${d}|${travelMode}`;
}

export function tripLegsCacheKey(places: LatLng[], travelMode: RoutesTravelMode): string {
  const coords = places.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(">");
  return `trip:${coords}|${travelMode}`;
}

export { routesCache };
