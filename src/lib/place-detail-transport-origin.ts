import type { LatLng } from "@/lib/maps-navigation";

export type PlaceDetailTransportOriginSource =
  | "live_user_location"
  | "cached_user_location"
  | "unavailable";

export function resolvePlaceDetailTransportOrigin(input: {
  live?: { lat: number; lng: number; usedFallback: boolean } | null;
  cached?: LatLng | null;
}): { origin: LatLng | null; source: PlaceDetailTransportOriginSource } {
  if (input.live && !input.live.usedFallback) {
    return {
      origin: { lat: input.live.lat, lng: input.live.lng },
      source: "live_user_location",
    };
  }
  if (input.cached) return { origin: input.cached, source: "cached_user_location" };
  return { origin: null, source: "unavailable" };
}
