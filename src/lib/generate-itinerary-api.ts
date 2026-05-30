import { CapacitorHttp } from "@capacitor/core";
import { resolveAppApiUrl } from "@/lib/api-base-url";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import type { ItineraryInput } from "@/lib/itinerary.functions";
import { detectPlatform } from "@/services/platform";

export type GenerateItineraryApiResult = {
  itinerary: RoamiePayloadV2 | null;
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

/** Capacitor 打包後經 VITE_APP_ORIGIN 呼叫 /api/generate-itinerary */
export function shouldUseBundledGenerateItineraryApi(): boolean {
  return isNativeCapacitorShell();
}

function parseGenerateItineraryResponse(
  status: number,
  data: unknown,
): GenerateItineraryApiResult {
  let parsed: Record<string, unknown> | null = null;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  } else if (data && typeof data === "object") {
    parsed = data as Record<string, unknown>;
  }

  if (status < 200 || status >= 300) {
    const err =
      (typeof parsed?.error === "string" && parsed.error) ||
      `行程生成 API HTTP ${status}`;
    return { itinerary: null, error: err };
  }

  const itinerary = parsed?.itinerary;
  if (!itinerary || typeof itinerary !== "object") {
    return { itinerary: null, error: "行程生成失敗（伺服器回應格式錯誤）" };
  }

  return { itinerary: itinerary as RoamiePayloadV2, error: null };
}

export async function generateItineraryViaBundledApi(
  payload: ItineraryInput,
  options?: { token?: string },
): Promise<GenerateItineraryApiResult> {
  const url = resolveAppApiUrl("/api/generate-itinerary");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.token) headers.Authorization = `Bearer ${options.token}`;

  if (isNativeCapacitorShell()) {
    const response = await CapacitorHttp.post({
      url,
      headers,
      data: payload as unknown as Record<string, unknown>,
      connectTimeout: 120_000,
      readTimeout: 120_000,
    });
    return parseGenerateItineraryResponse(response.status, response.data);
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let dataJson: unknown = text;
  try {
    dataJson = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return parseGenerateItineraryResponse(res.status, dataJson);
}
