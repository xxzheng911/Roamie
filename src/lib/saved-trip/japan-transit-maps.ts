import type { TransitLegAdvice } from "@/lib/transit/types";
import { buildDirectionsUrl, openExternal, type LatLng } from "@/lib/maps-navigation";
import { isTransitRequested } from "@/lib/saved-trip/travel-time";

export const JAPAN_TRANSIT_MAPS_BUTTON_LABEL = "🚆 查看大眾運輸路線 →";

export function isJapanTransitMapsLeg(
  leg: TransitLegAdvice | undefined,
  transportLabel: string,
): boolean {
  if (!leg || !isTransitRequested(transportLabel)) return false;
  return leg.transitUnavailableProvider === "google_maps_deeplink";
}

export function openJapanTransitLegInGoogleMaps(origin: LatLng, destination: LatLng): void {
  const url = buildDirectionsUrl(destination, {
    origin,
    travelMode: "transit",
  });
  void openExternal(url);
}
