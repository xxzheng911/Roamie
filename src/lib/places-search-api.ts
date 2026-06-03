import { CapacitorHttp } from "@capacitor/core";
import { resolveAppApiUrl } from "@/lib/api-base-url";
import type { ExploreSearchInput } from "@/lib/places.functions";
import {
  buildRequestDeniedDiagnostics,
  logExploreSearchRequest,
  logExploreSearchResponse,
  logExploreSearchResponseBody,
} from "@/lib/explore-places-search-diagnostics";
import { DEFAULT_SEARCH_RADIUS_M } from "@/lib/places-search-config";
import type { PlaceResult } from "@/lib/place-result";
import { detectPlatform } from "@/services/platform";
import type { z } from "zod";

export type PlacesSearchApiResult = { places: PlaceResult[]; error: string | null };

function isNativeCapacitorShell(): boolean {
  if (typeof window === "undefined") return false;
  return (
    detectPlatform().isCapacitor ||
    window.location.protocol === "capacitor:" ||
    window.location.protocol === "ionic:"
  );
}

function parsePlacesSearchResponse(
  status: number,
  data: unknown,
): PlacesSearchApiResult {
  let parsed: PlacesSearchApiResult | null = null;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data) as PlacesSearchApiResult;
    } catch {
      parsed = null;
    }
  } else if (data && typeof data === "object") {
    parsed = data as PlacesSearchApiResult;
  }

  if (status < 200 || status >= 300) {
    return {
      places: [],
      error: parsed?.error ?? `Places API HTTP ${status}`,
    };
  }

  return {
    places: parsed?.places ?? [],
    error: parsed?.error ?? null,
  };
}

/** TestFlight：經 roamie.tw 代理，使用 GOOGLE_PLACES_SERVER_API_KEY（非 iOS 限制金鑰） */
export async function searchPlacesViaBundledApi(
  data: z.infer<typeof ExploreSearchInput>,
): Promise<PlacesSearchApiResult> {
  const url = resolveAppApiUrl("/api/places-search");
  const radius = data.radius ?? DEFAULT_SEARCH_RADIUS_M;
  const logBundled = data.telemetrySurface === "map" && data.mode === "text";

  if (logBundled) {
    logExploreSearchRequest({
      rawQuery: data.rawQuery ?? data.query,
      finalQuery: data.query,
      lat: data.lat,
      lng: data.lng,
      radius,
      endpoint: url,
      transport: "bundled_api",
      mode: data.mode,
      exploreMapTextSearch: data.exploreMapTextSearch,
      locationBias: !data.exploreMapTextSearch,
    });
  }

  if (isNativeCapacitorShell()) {
    const response = await CapacitorHttp.post({
      url,
      headers: { "Content-Type": "application/json" },
      data,
      connectTimeout: 30_000,
      readTimeout: 30_000,
    });
    const parsed = parsePlacesSearchResponse(response.status, response.data);
    if (logBundled) {
      logExploreSearchResponse({
        status: response.status,
        resultCount: parsed.places.length,
        firstPlaceName: parsed.places[0]?.name ?? null,
        error: parsed.error,
        transport: "bundled_api",
      });
      if (parsed.places.length === 0) {
        logExploreSearchResponseBody(response.data);
      }
      if (parsed.error) {
        buildRequestDeniedDiagnostics(parsed.error, "bundled_api_proxy", null);
      }
    }
    return parsed;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  let dataJson: unknown = text;
  try {
    dataJson = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  const parsed = parsePlacesSearchResponse(res.status, dataJson);
  if (logBundled) {
    logExploreSearchResponse({
      status: res.status,
      resultCount: parsed.places.length,
      firstPlaceName: parsed.places[0]?.name ?? null,
      error: parsed.error,
      transport: "bundled_api",
    });
    if (parsed.places.length === 0) {
      logExploreSearchResponseBody(dataJson);
    }
    if (parsed.error) {
      buildRequestDeniedDiagnostics(parsed.error, "bundled_api_proxy", null);
    }
  }
  return parsed;
}
