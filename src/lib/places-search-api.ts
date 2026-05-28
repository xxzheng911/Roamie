import { CapacitorHttp } from "@capacitor/core";
import { resolveAppApiUrl } from "@/lib/api-base-url";
import type { ExploreSearchInput } from "@/lib/places.functions";
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

  if (isNativeCapacitorShell()) {
    const response = await CapacitorHttp.post({
      url,
      headers: { "Content-Type": "application/json" },
      data,
      connectTimeout: 30_000,
      readTimeout: 30_000,
    });
    return parsePlacesSearchResponse(response.status, response.data);
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
  return parsePlacesSearchResponse(res.status, dataJson);
}
