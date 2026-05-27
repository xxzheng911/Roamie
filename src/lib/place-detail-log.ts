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
  console.info("[Place Detail Screen Mounted]");
}

export function logPlaceDetailParamsReceived(params: unknown): void {
  console.info("[Place Detail Params Received]", params);
}

export function logPlaceDetailFetchStarted(placeId: string): void {
  console.info("[Place Detail Fetch Started]", { placeId });
}

export function logPlaceDetailFetchSuccess(placeId: string): void {
  console.info("[Place Detail Fetch Success]", { placeId });
}

export function logPlaceDetailFetchFailed(placeId: string, reason: string): void {
  console.warn("[Place Detail Fetch Failed]", { placeId, reason });
}

export function logPlaceDetailFallbackUsed(reason: string): void {
  console.info("[Place Detail Fallback Used]", { reason });
}
