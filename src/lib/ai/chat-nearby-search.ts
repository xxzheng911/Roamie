import type { ChatPlanningSession } from "@/lib/chat-session";
import { placeDisplayName } from "@/lib/chat-session";
import type { NearbyPlaceIntent } from "@/lib/ai/chat-intent";
import { isPlaceDetailChatActive } from "@/lib/ai/place-detail-chat";
import { calculateDistanceKm } from "@/lib/geo-distance";
import type { PlaceResult } from "@/lib/place-result";
import { hasValidPlaceCoordinates, logChatContextPlace } from "@/lib/chat-place-context";

export type NearbySearchCenter = {
  mode: "basePlace" | "userLocation";
  lat: number;
  lng: number;
  basePlaceName?: string;
  country?: string;
};

/** 附近搜尋半徑（公尺）：由小到大逐步擴大 */
export const CHAT_NEARBY_RADIUS_STEPS_M = [1_500, 2_000, 3_000, 5_000] as const;

/** place detail 附近搜尋：較少半徑步驟，避免重複打 API */
export const CHAT_PLACE_DETAIL_NEARBY_RADIUS_STEPS_M = [1_500, 2_500, 3_500] as const;

export function maxDistanceKmForIntent(intent: NearbyPlaceIntent, radiusStepIndex = 0): number {
  const base = intent === "attraction" || intent === "camping" ? 20 : 5;
  const bonus = radiusStepIndex * 3;
  return base + bonus;
}

export function logChatNearbyContext(params: {
  mode: "basePlace" | "userLocation";
  basePlaceName?: string;
  baseLat?: number;
  baseLng?: number;
  userLat?: number;
  userLng?: number;
}): void {
  console.info("[CHAT_NEARBY_CONTEXT]", {
    mode: params.mode,
    basePlaceName: params.basePlaceName ?? "",
    baseLat: params.baseLat ?? "",
    baseLng: params.baseLng ?? "",
    userLat: params.userLat ?? "",
    userLng: params.userLng ?? "",
  });
}

export function resolveNearbySearchCenter(
  session: ChatPlanningSession,
  userText: string,
): NearbySearchCenter | null {
  const deviceLat = session.location?.lat;
  const deviceLng = session.location?.lng;
  const focus = session.placeDetailFocus;
  const hasFocusCoords = hasValidPlaceCoordinates(focus);

  if (isPlaceDetailChatActive(session)) {
    if (hasFocusCoords) {
      logChatContextPlace(focus!);
      const center = {
        mode: "basePlace" as const,
        lat: focus!.lat!,
        lng: focus!.lng!,
        basePlaceName: placeDisplayName(focus!),
        country: focus?.country,
      };
      logChatNearbyContext({
        mode: center.mode,
        basePlaceName: center.basePlaceName,
        baseLat: center.lat,
        baseLng: center.lng,
        userLat: deviceLat,
        userLng: deviceLng,
      });
      return center;
    }
    console.warn("[CHAT_NEARBY_CONTEXT] place_detail_missing_coords");
    return null;
  }

  if (deviceLat != null && deviceLng != null) {
    logChatNearbyContext({
      mode: "userLocation",
      userLat: deviceLat,
      userLng: deviceLng,
    });
    return { mode: "userLocation", lat: deviceLat, lng: deviceLng };
  }

  return null;
}

export function filterPlacesByNearbyDistance(
  places: PlaceResult[],
  centerLat: number,
  centerLng: number,
  maxKm: number,
): PlaceResult[] {
  return places.filter((place) => {
    const distanceKm = calculateDistanceKm(centerLat, centerLng, place.lat, place.lng);

    if (distanceKm == null) {
      console.info("[CHAT_FILTER_DROP]", {
        reason: "missing_location",
        place: place.name ?? "",
      });
      return false;
    }

    const roundedKm = Number(distanceKm.toFixed(2));
    console.info("[CHAT_DISTANCE_CALCULATED]", {
      placeName: place.name ?? "",
      distanceKm: roundedKm,
    });

    const allowed = distanceKm <= maxKm;
    console.info("[CHAT_NEARBY_DISTANCE_CHECK]", {
      placeName: place.name ?? "",
      distanceKm: roundedKm,
      radiusKm: maxKm,
      allowed,
    });

    if (!allowed) {
      console.info("[CHAT_FILTER_DROP]", {
        reason: "distance_too_far",
        place: place.name ?? "",
        distanceKm: roundedKm,
        radiusKm: maxKm,
      });
    }
    return allowed;
  });
}
