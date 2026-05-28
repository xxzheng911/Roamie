import { CapacitorHttp } from "@capacitor/core";
import { resolveAppApiUrl } from "@/lib/api-base-url";
import type { PlaceDetailsScreenResult } from "@/lib/places.functions";
import { detectPlatform } from "@/services/platform";

export type PlaceDetailsApiResult = {
  place: PlaceDetailsScreenResult | null;
  error: string | null;
};

function isNativeCapacitorShell(): boolean {
  if (typeof window === "undefined") return false;
  return (
    detectPlatform().isCapacitor ||
    window.location.protocol === "capacitor:" ||
    window.location.protocol === "ionic:"
  );
}

function parsePlaceDetailsResponse(status: number, data: unknown): PlaceDetailsApiResult {
  let parsed: PlaceDetailsApiResult | null = null;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data) as PlaceDetailsApiResult;
    } catch {
      parsed = null;
    }
  } else if (data && typeof data === "object") {
    parsed = data as PlaceDetailsApiResult;
  }

  if (status < 200 || status >= 300) {
    return {
      place: null,
      error: parsed?.error ?? `Place details HTTP ${status}`,
    };
  }

  return {
    place: parsed?.place ?? null,
    error: parsed?.error ?? null,
  };
}

/** Capacitor：經 roamie.tw 代理 Places Details（server 金鑰） */
export async function fetchPlaceDetailsViaBundledApi(input: {
  placeId: string;
  locale?: "zh-TW" | "en" | "ja" | "ko";
}): Promise<PlaceDetailsApiResult> {
  const url = resolveAppApiUrl("/api/place-details");
  const body = { placeId: input.placeId, locale: input.locale };

  if (isNativeCapacitorShell()) {
    const response = await CapacitorHttp.post({
      url,
      headers: { "Content-Type": "application/json" },
      data: body,
      connectTimeout: 30_000,
      readTimeout: 30_000,
    });
    return parsePlaceDetailsResponse(response.status, response.data);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let dataJson: unknown = text;
  try {
    dataJson = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  return parsePlaceDetailsResponse(res.status, dataJson);
}
