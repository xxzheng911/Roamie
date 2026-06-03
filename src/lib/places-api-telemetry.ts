/** Google Places API 計費 SKU */
export type PlacesApiSku = "nearby" | "text" | "details" | "photo";

export type PlacesApiSurface = "home" | "map" | "ai" | "chat" | "other";

export type PlacesApiTelemetryCounts = Record<PlacesApiSku, number>;

const EMPTY: PlacesApiTelemetryCounts = {
  nearby: 0,
  text: 0,
  details: 0,
  photo: 0,
};

const surfaceBuckets = new Map<PlacesApiSurface, PlacesApiTelemetryCounts>();

function bucket(surface: PlacesApiSurface): PlacesApiTelemetryCounts {
  let b = surfaceBuckets.get(surface);
  if (!b) {
    b = { ...EMPTY };
    surfaceBuckets.set(surface, b);
  }
  return b;
}

/** 單次 API 呼叫（client 或 server log 匯總用） */
export function recordPlacesApiCall(
  sku: PlacesApiSku,
  surface: PlacesApiSurface,
  meta?: Record<string, unknown>,
): void {
  bucket(surface)[sku] += 1;
  console.info("[PLACES_API_TELEMETRY]", {
    sku,
    surface,
    count: bucket(surface)[sku],
    ...meta,
  });
}

/** 新的一次首頁 / 地圖 / AI 流程開始前重置計數 */
export function resetPlacesApiTelemetry(surface: PlacesApiSurface): void {
  surfaceBuckets.set(surface, { ...EMPTY });
}

export function getPlacesApiTelemetry(surface: PlacesApiSurface): PlacesApiTelemetryCounts {
  return { ...(surfaceBuckets.get(surface) ?? EMPTY) };
}

export function getAllPlacesApiTelemetry(): Record<PlacesApiSurface, PlacesApiTelemetryCounts> {
  const surfaces: PlacesApiSurface[] = ["home", "map", "ai", "chat", "other"];
  return Object.fromEntries(
    surfaces.map((surface) => [surface, getPlacesApiTelemetry(surface)]),
  ) as Record<PlacesApiSurface, PlacesApiTelemetryCounts>;
}

/** 流程結束時輸出摘要 */
export function logPlacesApiTelemetrySummary(
  surface: PlacesApiSurface,
  extra?: Record<string, unknown>,
): void {
  const counts = getPlacesApiTelemetry(surface);
  const total = counts.nearby + counts.text + counts.details + counts.photo;
  console.info("[PLACES_API_SUMMARY]", {
    surface,
    ...counts,
    total,
    ...extra,
  });
}
