/** 聊聊地點推薦流程 — 統一 console log（實機 / Xcode 排查用） */

export function logChatIntentDetected(intent: string, userText: string): void {
  console.info("[CHAT_INTENT_DETECTED]", `intent=${intent}`, `text=${userText.trim().slice(0, 80)}`);
}

export function logChatDestinationExtracted(destination: string, source: string): void {
  console.info("[CHAT_DESTINATION_EXTRACTED]", `destination=${destination}`, `source=${source}`);
}

export function logChatReadyToRecommend(destination: string, stage: string): void {
  console.info("[CHAT_READY_TO_RECOMMEND]", `destination=${destination}`, `stage=${stage}`);
}

export function logChatPlacesRequest(details: Record<string, string | number | undefined>): void {
  const parts = Object.entries(details)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  console.info("[CHAT_PLACES_REQUEST]", parts.join(" "));
}

export function logChatPlacesResponse(count: number, source: string): void {
  console.info("[CHAT_PLACES_RESPONSE]", `count=${count}`, `source=${source}`);
}

export function logChatPlaceCardsRendered(count: number): void {
  console.info("[CHAT_PLACE_CARDS_RENDERED]", `count=${count}`);
}

export function logChatPlacesError(error: unknown, context?: string): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.warn("[CHAT_PLACES_ERROR]", context ? `${context}: ${msg}` : msg);
}

export function logChatGeocodeRequest(query: string): void {
  console.info("[CHAT_GEOCODE_REQUEST]", `query=${query}`);
}

export function logChatGeocodeResponse(status: string, result: string): void {
  console.info("[CHAT_GEOCODE_RESPONSE]", `status=${status}`, `result=${result}`);
}

export function logChatGeocodeFallback(query: string, reason: string): void {
  console.info("[CHAT_GEOCODE_FALLBACK]", `query=${query}`, `reason=${reason}`);
}

export function logChatTextSearchRequest(query: string): void {
  console.info("[CHAT_TEXT_SEARCH_REQUEST]", `query=${query}`);
}

export function logChatTextSearchResponse(count: number): void {
  console.info("[CHAT_TEXT_SEARCH_RESPONSE]", `count=${count}`);
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
  console.info(
    "[CHAT_DESTINATION_RESOLVED]",
    `destination=${destination}`,
    `lat=${lat.toFixed(4)}`,
    `lng=${lng.toFixed(4)}`,
    `source=${source}`,
  );
}

export function logChatPlacesRawCount(count: number): void {
  console.info("[CHAT_PLACES_RAW_COUNT]", `count=${count}`);
}

export function logChatPlacesFilterStrictCount(count: number): void {
  console.info("[CHAT_PLACES_FILTER_STRICT_COUNT]", `count=${count}`);
}

export function logChatPlacesFilterRelaxedCount(count: number): void {
  console.info("[CHAT_PLACES_FILTER_RELAXED_COUNT]", `count=${count}`);
}

export function logChatPlacesFilterFallbackCount(count: number): void {
  console.info("[CHAT_PLACES_FILTER_FALLBACK_COUNT]", `count=${count}`);
}

export function logChatPlacesFinalCount(count: number): void {
  console.info("[CHAT_PLACES_FINAL_COUNT]", `count=${count}`);
}

export function logChatSearchMode(mode: string): void {
  console.info("[CHAT_SEARCH_MODE]", `mode=${mode}`);
}

export function logChatDestinationCoords(
  destination: string,
  lat: number | null,
  lng: number | null,
): void {
  if (lat != null && lng != null) {
    console.info(
      "[CHAT_DESTINATION_COORDS]",
      `destination=${destination}`,
      `lat=${lat.toFixed(4)}`,
      `lng=${lng.toFixed(4)}`,
    );
  } else {
    console.info("[CHAT_DESTINATION_COORDS]", `destination=${destination}`, "coords=none");
  }
}

export function logChatDeviceCoords(lat: number, lng: number): void {
  console.info("[CHAT_DEVICE_COORDS]", `lat=${lat.toFixed(4)}`, `lng=${lng.toFixed(4)}`);
}

export function logChatPlaceQueryDestination(destination: string, mode: string): void {
  console.info("[CHAT_PLACE_QUERY_DESTINATION]", `destination=${destination}`, `mode=${mode}`);
}

export function logChatPlaceResultGuard(name: string, ok: boolean, reason: string): void {
  console.info("[CHAT_PLACE_RESULT_GUARD]", `name=${name}`, `ok=${ok}`, `reason=${reason}`);
}

export function logChatPlaceRejectWrongRegion(name: string, marker: string): void {
  console.info("[CHAT_PLACE_REJECT_WRONG_REGION]", `name=${name}`, `marker=${marker}`);
}

export function logChatPlaceRenderGuard(name: string, ok: boolean, reason: string): void {
  console.info("[CHAT_PLACE_RENDER_GUARD]", `name=${name}`, `ok=${ok}`, `reason=${reason}`);
}

export function logChatIntentResolved(intent: string, text: string): void {
  console.info("[CHAT_INTENT_RESOLVED]", `intent=${intent}`, `text=${text}`);
}

export function logChatCategoryLock(category: string): void {
  console.info("[CHAT_CATEGORY_LOCK]", `category=${category}`);
}

export function logChatCafeQuery(query: string, relaxed = false): void {
  console.info("[CHAT_CAFE_QUERY]", `query=${query}`, `relaxed=${relaxed}`);
}

export function logChatCafeResultGuard(name: string, ok: boolean, reason: string): void {
  console.info("[CHAT_CAFE_RESULT_GUARD]", `name=${name}`, `ok=${ok}`, `reason=${reason}`);
}

export function logChatWrongCategoryRejected(name: string, reason: string): void {
  console.info("[CHAT_WRONG_CATEGORY_REJECTED]", `name=${name}`, `reason=${reason}`);
}

export function logChatRenderMode(mode: string): void {
  console.info("[CHAT_RENDER_MODE]", `mode=${mode}`);
}

export function logChatRenderPlaceCardOnly(category: string): void {
  console.info("[CHAT_RENDER_PLACE_CARD_ONLY]", `category=${category}`);
}

export function logChatPlaceRecommendationTriggered(destination: string, category: string): void {
  console.info(
    "[CHAT_PLACE_RECOMMENDATION_TRIGGERED]",
    `destination=${destination}`,
    `category=${category}`,
  );
}

export function logChatPlaceCategory(category: string): void {
  console.info("[CHAT_PLACE_CATEGORY]", `category=${category}`);
}

export function logChatPlaceDestination(destination: string, source: string): void {
  console.info("[CHAT_PLACE_DESTINATION]", `destination=${destination}`, `source=${source}`);
}

export function logChatPlaceCardRender(count: number, category: string): void {
  console.info("[CHAT_PLACE_CARD_RENDER]", `count=${count}`, `category=${category}`);
}

export function logChatRenderModeLocked(mode: string): void {
  console.info("[CHAT_RENDER_MODE_LOCKED]", `mode=${mode}`);
}

export function logChatWrongFallbackBlocked(reason: string): void {
  console.info("[CHAT_WRONG_FALLBACK_BLOCKED]", `reason=${reason}`);
}

export function logChatFinalMessageBeforeRender(cardsCount: number, summaryPreview: string): void {
  console.info(
    "[CHAT_FINAL_MESSAGE_BEFORE_RENDER]",
    `cards=${cardsCount}`,
    `summary=${summaryPreview}`,
  );
}

export function logChatFinalCardsCount(count: number): void {
  console.info("[CHAT_FINAL_CARDS_COUNT]", `count=${count}`);
}

export function logChatCardsPreserved(count: number, source: string): void {
  console.info("[CHAT_CARDS_PRESERVED]", `count=${count}`, `source=${source}`);
}

export function logChatCardsOverwriteBlocked(detail: string): void {
  console.info("[CHAT_CARDS_OVERWRITE_BLOCKED]", detail);
}

export function logChatNoResultAllowed(allowed: boolean, reason: string): void {
  console.info("[CHAT_NO_RESULT_ALLOWED]", `allowed=${allowed}`, `reason=${reason}`);
}

export function logChatUiReceivedCards(count: number): void {
  console.info("[CHAT_UI_RECEIVED_CARDS]", `count=${count}`);
}

export function logChatUiRenderedCards(count: number): void {
  console.info("[CHAT_UI_RENDERED_CARDS]", `count=${count}`);
}
