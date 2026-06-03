import type { RoamieItineraryItem } from "@/lib/ai/types";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceDetailHandoff } from "@/lib/place-detail-handoff";
import {
  resolveTripPlaceIdForDetail,
  type ResolvedTripPlaceId,
} from "@/lib/place/resolve-trip-place-id";

export type ResolvedTripPlaceDetail = {
  routePlaceId: string;
  handoff: PlaceDetailHandoff;
};

function decodeTripStopName(routePlaceId: string): string | null {
  if (!routePlaceId.startsWith("trip-stop:")) return null;
  try {
    return decodeURIComponent(routePlaceId.slice("trip-stop:".length)).trim();
  } catch {
    return routePlaceId.slice("trip-stop:".length).trim();
  }
}

export function isTripStopRouteId(placeId: string): boolean {
  return placeId.startsWith("trip-stop:");
}

export function tripStopNameFromRouteId(routePlaceId: string): string | null {
  return decodeTripStopName(routePlaceId);
}

/**
 * 行程地點 → 可開啟地點詳情（補 Google placeId / 座標）
 * @deprecated 內部改用 resolveTripPlaceIdForDetail
 */
export async function resolveTripItineraryPlaceForDetail(
  item: RoamieItineraryItem,
  options: { destination?: string; city?: string; locale?: Locale },
): Promise<ResolvedTripPlaceDetail | null> {
  const resolved: ResolvedTripPlaceId | null = await resolveTripPlaceIdForDetail({
    item,
    destination: options.destination,
    city: options.city,
    locale: options.locale,
  });
  if (!resolved) return null;
  return {
    routePlaceId: resolved.routePlaceId,
    handoff: resolved.handoff,
  };
}
