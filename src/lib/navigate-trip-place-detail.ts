import type { RoamieItineraryItem } from "@/lib/ai/types";
import type { PlaceIntroItineraryContext } from "@/lib/place/generate-place-intro";
import { resolveTripPlaceIdForDetail } from "@/lib/place/resolve-trip-place-id";
import type { PlaceDetailRouteContext } from "@/lib/place-detail-handoff";
import { logPlaceDetailOpened } from "@/lib/place/place-detail-logs";
import {
  setPlaceDetailHandoff,
} from "@/lib/place-detail-handoff";
import { setPlaceDetailStoreEntry } from "@/lib/place-detail-store";

export type TripPlaceDetailNavigate = (opts: {
  to: "/place/$placeId";
  params: { placeId: string };
  search: { from: string; tripId: string };
}) => Promise<void> | void;

/** 行程詳情地點卡片 → 地點詳情（返回時回到同一筆行程） */
export async function navigateToTripPlaceDetail(
  item: RoamieItineraryItem,
  tripId: string,
  navigate: TripPlaceDetailNavigate,
  options?: {
    destination?: string;
    city?: string | null;
    dayNumber?: number;
    nearbyStops?: string[];
    itineraryContext?: PlaceIntroItineraryContext;
    /** 上一站（用於交通距離 trip_sequence） */
    prevItem?: RoamieItineraryItem | null;
    /** 下一站 */
    nextItem?: RoamieItineraryItem | null;
  },
): Promise<boolean> {
  const placeName = item.placeName || item.title;
  if (!placeName?.trim()) return false;

  const resolved = await resolveTripPlaceIdForDetail({
    item,
    destination: options?.destination,
    city: options?.city,
  });
  if (!resolved) return false;

  const { routePlaceId, handoff: resolvedHandoff } = resolved;

  let routeContext: PlaceDetailRouteContext | undefined;
  const prev = options?.prevItem;
  const prevName = (prev?.placeName || prev?.title || "").trim();
  if (prev && prev.lat != null && prev.lng != null && prevName) {
    routeContext = {
      source: "trip_sequence",
      fromPlace: prevName,
      toPlace: placeName,
      originLat: prev.lat,
      originLng: prev.lng,
    };
  } else {
    routeContext = {
      source: "current_location",
      fromPlace: "目前位置",
      toPlace: placeName,
    };
  }

  const withContext = {
    ...resolvedHandoff,
    itineraryItem: item,
    tripId,
    city: options?.city ?? options?.itineraryContext?.city ?? null,
    itineraryContext: {
      destination: options?.destination?.trim() || null,
      city: options?.city ?? options?.itineraryContext?.city ?? options?.destination?.trim() ?? null,
      dayIndex: options?.dayNumber ?? options?.itineraryContext?.dayIndex ?? null,
      nearbyStops: options?.nearbyStops ?? options?.itineraryContext?.nearbyStops,
      ...options?.itineraryContext,
    },
    routeContext,
  };

  setPlaceDetailStoreEntry(routePlaceId, withContext);
  setPlaceDetailHandoff(withContext);

  logPlaceDetailOpened({
    source: "trip_detail",
    placeName,
    tripId,
    dayIndex: options?.dayNumber ?? null,
    placeId: routePlaceId,
  });

  await navigate({
    to: "/place/$placeId",
    params: { placeId: routePlaceId },
    search: { from: "trip_detail", tripId },
  });
  return true;
}
