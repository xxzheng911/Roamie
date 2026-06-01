import type { PlacesApiSku, PlacesApiSurface } from "@/lib/places-api-telemetry";

type PlacesApiTelemetryCounts = Record<PlacesApiSku, number>;

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

/** Server-side Places API 呼叫 log（Cloudflare Workers / SSR） */
export function recordPlacesApiCallServer(
  sku: PlacesApiSku,
  surface: PlacesApiSurface = "other",
  meta?: Record<string, unknown>,
): void {
  bucket(surface)[sku] += 1;
  console.info("[PLACES_API_TELEMETRY]", {
    sku,
    surface,
    origin: "server",
    count: bucket(surface)[sku],
    ...meta,
  });
}

export function resetPlacesApiTelemetryServer(surface: PlacesApiSurface): void {
  surfaceBuckets.set(surface, { ...EMPTY });
}

export function logPlacesApiTelemetrySummaryServer(
  surface: PlacesApiSurface,
  extra?: Record<string, unknown>,
): void {
  const counts = { ...(surfaceBuckets.get(surface) ?? EMPTY) };
  const total = counts.nearby + counts.text + counts.details + counts.photo;
  console.info("[PLACES_API_SUMMARY]", {
    surface,
    origin: "server",
    ...counts,
    total,
    ...extra,
  });
}
