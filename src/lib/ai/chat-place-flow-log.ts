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
