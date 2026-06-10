import type { SearchPlacesInput } from "@/lib/explore-category-search";
import type { PlaceResult } from "@/lib/place-result";

export function logPlacesRequest(
  source: "server" | "client",
  data: SearchPlacesInput,
  extra?: Record<string, unknown>,
): void {
  console.info("[PLACES_REQUEST]", {
    source,
    lat: data.lat,
    lng: data.lng,
    radius: data.radius,
    mode: data.mode,
    query: data.query,
    includedTypes: data.includedTypes ?? [],
    locale: data.locale ?? null,
    ...extra,
  });
}

export function logPlacesResponse(
  source: "server" | "client" | "cache",
  data: SearchPlacesInput,
  result: { places: PlaceResult[]; error: string | null },
  extra?: Record<string, unknown>,
): void {
  const tag = source === "client" ? "[PLACES_FALLBACK_RESPONSE]" : "[PLACES_RESPONSE]";
  console.info(tag, {
    source,
    lat: data.lat,
    lng: data.lng,
    mode: data.mode,
    query: data.query,
    status: result.error ? "error" : "ok",
    count: result.places.length,
    error: result.error,
    sample: result.places.slice(0, 2).map((p) => p.name),
    ...extra,
  });
}

export function logHomeNearbyDataReady(detail: {
  count: number;
  lat: number;
  lng: number;
  categories: string[];
  fromMock?: boolean;
  error?: string | null;
}): void {
  console.info("[HOME_NEARBY_DATA_READY]", detail);
}
