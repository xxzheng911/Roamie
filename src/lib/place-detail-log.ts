import type { PlaceDetailHandoff } from "@/lib/place-detail-handoff";

export function logNearbyPlaceCardPressed(placeId: string, name: string): void {
  console.info("[Nearby Place Card Pressed]", { placeId, name });
}

export function logNearbyPlaceId(placeId: string): void {
  console.info("[Nearby Place ID]", placeId || "(empty)");
}

export function logNearbyPlaceNavigateToDetail(): void {
  console.info("[Nearby Place Navigate To Detail]");
}

export function logNearbyPlaceNavigateParams(params: PlaceDetailHandoff): void {
  console.info("[Nearby Place Navigate Params]", params);
}

export function logPlaceDetailScreenMounted(): void {
  console.info("[PLACE_DETAIL] screen mounted");
}

export function logPlaceDetailParamsReceived(params: unknown): void {
  console.info("[PLACE_DETAIL] params=", params);
}

export function logPlaceDetailFetchStarted(placeId: string): void {
  console.info("[PLACE_DETAIL] fetch start placeId=", placeId);
}

export function logPlaceDetailFetchSuccess(placeId: string): void {
  console.info("[PLACE_DETAIL] fetch success placeId=", placeId);
}

export function logPlaceDetailFetchFailed(placeId: string, reason: string): void {
  console.info("[PLACE_DETAIL] fetch failed placeId=", placeId, "reason=", reason);
}

export function logPlaceDetailFallbackUsed(reason: string): void {
  console.info("[PLACE_DETAIL] fallback used=", reason);
}
