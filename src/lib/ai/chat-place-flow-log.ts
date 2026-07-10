import { devVerboseInfo } from "@/lib/dev-verbose-log";

/** 聊聊地點推薦流程 — 統一 console log（development only） */

export function logChatIntentDetected(intent: string, userText: string): void {
  devVerboseInfo("[CHAT_INTENT_DETECTED]", `intent=${intent}`, `text=${userText.trim().slice(0, 80)}`);
}

export function logChatDestinationExtracted(destination: string, source: string): void {
  devVerboseInfo("[CHAT_DESTINATION_EXTRACTED]", `destination=${destination}`, `source=${source}`);
}

export function logChatReadyToRecommend(destination: string, stage: string): void {
  devVerboseInfo("[CHAT_READY_TO_RECOMMEND]", `destination=${destination}`, `stage=${stage}`);
}

export function logChatPlacesRequest(details: Record<string, string | number | undefined>): void {
  const parts = Object.entries(details)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  devVerboseInfo("[CHAT_PLACES_REQUEST]", parts.join(" "));
}

export function logChatPlacesResponse(count: number, source: string): void {
  devVerboseInfo("[CHAT_PLACES_RESPONSE]", `count=${count}`, `source=${source}`);
}

export function logChatPlaceCardsRendered(count: number): void {
  devVerboseInfo("[CHAT_PLACE_CARDS_RENDERED]", `count=${count}`);
}

export function logChatPlacesError(error: unknown, context?: string): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.warn("[CHAT_PLACES_ERROR]", context ? `${context}: ${msg}` : msg);
}

export function logChatGeocodeRequest(query: string): void {
  devVerboseInfo("[CHAT_GEOCODE_REQUEST]", `query=${query}`);
}

export function logChatGeocodeResponse(status: string, result: string): void {
  devVerboseInfo("[CHAT_GEOCODE_RESPONSE]", `status=${status}`, `result=${result}`);
}

export function logChatGeocodeFallback(query: string, reason: string): void {
  devVerboseInfo("[CHAT_GEOCODE_FALLBACK]", `query=${query}`, `reason=${reason}`);
}

export function logChatGeocodeStart(placeName: string): void {
  devVerboseInfo("[CHAT_GEOCODE_START]", `place=${placeName}`);
}

export function logChatGeocodeSuccess(placeName: string): void {
  devVerboseInfo("[CHAT_GEOCODE_SUCCESS]", `place=${placeName}`);
}

export function logChatGeocodeRetry(placeName: string, strategy: string): void {
  devVerboseInfo("[CHAT_GEOCODE_RETRY]", `place=${placeName}`, `strategy=${strategy}`);
}

export function logChatGeocodeSkip(placeName: string, reason = "geocode_empty"): void {
  devVerboseInfo("[CHAT_GEOCODE_SKIP]", `place=${placeName}`, `reason=${reason}`);
}

export function logChatGeocodeReplaced(skippedName: string, replacementName: string): void {
  devVerboseInfo("[CHAT_GEOCODE_REPLACED]", `skipped=${skippedName}`, `replacement=${replacementName}`);
}

export function logChatValidPlaceCount(count: number, required?: number): void {
  devVerboseInfo(
    "[CHAT_VALID_PLACE_COUNT]",
    `count=${count}`,
    required != null ? `required=${required}` : "",
  );
}

export function logChatRenderStart(): void {
  devVerboseInfo("[CHAT_RENDER_START]");
}

export function logDestinationGeocodeFallback(destination: string, source: string): void {
  devVerboseInfo("[CHAT_DESTINATION_GEOCODE_FALLBACK]", `destination=${destination}`, `source=${source}`);
}

export function logChatTextSearchRequest(query: string): void {
  devVerboseInfo("[CHAT_TEXT_SEARCH_REQUEST]", `query=${query}`);
}

export function logChatTextSearchResponse(count: number): void {
  devVerboseInfo("[CHAT_TEXT_SEARCH_RESPONSE]", `count=${count}`);
}

export function logChatRenderBlocked(reason: string): void {
  console.warn("[CHAT_RENDER_BLOCKED]", `reason=${reason}`);
}

export function logChatDestinationResolved(
  destination: string,
  lat: number,
  lng: number,
  source: "geocode" | "approx_center",
): void {
  devVerboseInfo(
    "[CHAT_DESTINATION_RESOLVED]",
    `destination=${destination}`,
    `lat=${lat.toFixed(4)}`,
    `lng=${lng.toFixed(4)}`,
    `source=${source}`,
  );
}

export function logChatPlacesRawCount(count: number): void {
  devVerboseInfo("[CHAT_PLACES_RAW_COUNT]", `count=${count}`);
}

export function logChatPlacesFilterStrictCount(count: number): void {
  devVerboseInfo("[CHAT_PLACES_FILTER_STRICT_COUNT]", `count=${count}`);
}

export function logChatPlacesFilterRelaxedCount(count: number): void {
  devVerboseInfo("[CHAT_PLACES_FILTER_RELAXED_COUNT]", `count=${count}`);
}

export function logChatPlacesFilterFallbackCount(count: number): void {
  devVerboseInfo("[CHAT_PLACES_FILTER_FALLBACK_COUNT]", `count=${count}`);
}

export function logChatPlacesFinalCount(count: number): void {
  devVerboseInfo("[CHAT_PLACES_FINAL_COUNT]", `count=${count}`);
}

export function logChatSearchMode(mode: string): void {
  devVerboseInfo("[CHAT_SEARCH_MODE]", `mode=${mode}`);
}

export function logChatDestinationCoords(
  destination: string,
  lat: number | null,
  lng: number | null,
): void {
  if (lat != null && lng != null) {
    devVerboseInfo(
      "[CHAT_DESTINATION_COORDS]",
      `destination=${destination}`,
      `lat=${lat.toFixed(4)}`,
      `lng=${lng.toFixed(4)}`,
    );
  } else {
    devVerboseInfo("[CHAT_DESTINATION_COORDS]", `destination=${destination}`, "coords=none");
  }
}

export function logChatDeviceCoords(lat: number, lng: number): void {
  devVerboseInfo("[CHAT_DEVICE_COORDS]", `lat=${lat.toFixed(4)}`, `lng=${lng.toFixed(4)}`);
}

export function logChatPlaceQueryDestination(destination: string, mode: string): void {
  devVerboseInfo("[CHAT_PLACE_QUERY_DESTINATION]", `destination=${destination}`, `mode=${mode}`);
}

export function logChatPlaceResultGuard(name: string, ok: boolean, reason: string): void {
  devVerboseInfo("[CHAT_PLACE_RESULT_GUARD]", `name=${name}`, `ok=${ok}`, `reason=${reason}`);
}

export function logChatPlaceRejectWrongRegion(name: string, marker: string): void {
  devVerboseInfo("[CHAT_PLACE_REJECT_WRONG_REGION]", `name=${name}`, `marker=${marker}`);
}

export function logChatPlaceRenderGuard(name: string, ok: boolean, reason: string): void {
  devVerboseInfo("[CHAT_PLACE_RENDER_GUARD]", `name=${name}`, `ok=${ok}`, `reason=${reason}`);
}

export function logChatIntentResolved(intent: string, text: string): void {
  devVerboseInfo("[CHAT_INTENT_RESOLVED]", `intent=${intent}`, `text=${text}`);
}

export function logChatCategoryLock(category: string): void {
  devVerboseInfo("[CHAT_CATEGORY_LOCK]", `category=${category}`);
}

export function logChatCafeQuery(query: string, relaxed = false): void {
  devVerboseInfo("[CHAT_CAFE_QUERY]", `query=${query}`, `relaxed=${relaxed}`);
}

export function logChatCafeResultGuard(name: string, ok: boolean, reason: string): void {
  devVerboseInfo("[CHAT_CAFE_RESULT_GUARD]", `name=${name}`, `ok=${ok}`, `reason=${reason}`);
}

export function logChatWrongCategoryRejected(name: string, reason: string): void {
  devVerboseInfo("[CHAT_WRONG_CATEGORY_REJECTED]", `name=${name}`, `reason=${reason}`);
}

export function logChatRenderMode(mode: string): void {
  devVerboseInfo("[CHAT_RENDER_MODE]", `mode=${mode}`);
}

export function logChatRenderPlaceCardOnly(category: string): void {
  devVerboseInfo("[CHAT_RENDER_PLACE_CARD_ONLY]", `category=${category}`);
}

export function logChatPlaceRecommendationTriggered(destination: string, category: string): void {
  devVerboseInfo(
    "[CHAT_PLACE_RECOMMENDATION_TRIGGERED]",
    `destination=${destination}`,
    `category=${category}`,
  );
}

export function logChatPlaceCategory(category: string): void {
  devVerboseInfo("[CHAT_PLACE_CATEGORY]", `category=${category}`);
}

export function logChatPlaceDestination(destination: string, source: string): void {
  devVerboseInfo("[CHAT_PLACE_DESTINATION]", `destination=${destination}`, `source=${source}`);
}

export function logChatPlaceCardRender(count: number, category: string): void {
  devVerboseInfo("[CHAT_PLACE_CARD_RENDER]", `count=${count}`, `category=${category}`);
}

export function logChatRenderModeLocked(mode: string): void {
  devVerboseInfo("[CHAT_RENDER_MODE_LOCKED]", `mode=${mode}`);
}

export function logChatWrongFallbackBlocked(reason: string): void {
  devVerboseInfo("[CHAT_WRONG_FALLBACK_BLOCKED]", `reason=${reason}`);
}

export function logChatFinalMessageBeforeRender(cardsCount: number, summaryPreview: string): void {
  devVerboseInfo(
    "[CHAT_FINAL_MESSAGE_BEFORE_RENDER]",
    `cards=${cardsCount}`,
    `summary=${summaryPreview}`,
  );
}

export function logChatFinalCardsCount(count: number): void {
  devVerboseInfo("[CHAT_FINAL_CARDS_COUNT]", `count=${count}`);
}

export function logChatCardsPreserved(count: number, source: string): void {
  devVerboseInfo("[CHAT_CARDS_PRESERVED]", `count=${count}`, `source=${source}`);
}

export function logChatCardsOverwriteBlocked(detail: string): void {
  devVerboseInfo("[CHAT_CARDS_OVERWRITE_BLOCKED]", detail);
}

export function logChatNoResultAllowed(allowed: boolean, reason: string): void {
  devVerboseInfo("[CHAT_NO_RESULT_ALLOWED]", `allowed=${allowed}`, `reason=${reason}`);
}

export function logChatUiReceivedCards(count: number): void {
  devVerboseInfo("[CHAT_UI_RECEIVED_CARDS]", `count=${count}`);
}

export function logChatUiRenderedCards(count: number): void {
  devVerboseInfo("[CHAT_UI_RENDERED_CARDS]", `count=${count}`);
}
