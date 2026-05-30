import { toast } from "sonner";
import { APP_BUILD_NUMBER, APP_MARKETING_VERSION } from "@/constants/app";
import {
  copyTextForMobile,
  exportJsonForMobile,
  toastCopyResult,
  toastJsonExportResult,
} from "@/lib/debug/clipboard-export";
import { isDeveloperBuildEnabled } from "@/lib/access/developer";
import { readDeveloperUnlocked } from "@/lib/access/storage";
import { isQaBuildEnabled } from "@/lib/qa-auth/build";

/** 無推薦卡時仍匯出，方便回報 AI / Places 失敗 */
export type DiagnosticsExportMeta = {
  scope: string;
  note?: string;
  summary_excerpt?: string;
  raw_recommendation_count?: number;
  filtered_recommendation_count?: number;
  response_kind?: "text_only" | "roamie_cards" | "empty_roamie";
  chat_phase?: string;
  last_error?: string | null;
  user_location?: { lat: number; lng: number; source?: string } | null;
  location_invalid?: boolean;
  recommendation_source?: string | null;
  place_id?: string | null;
  dedupe_result?: {
    input_count: number;
    output_count: number;
    removed_duplicates: number;
  } | null;
  fallback_reason?: string | null;
  mood?: string | null;
  detected_intent?: string | null;
  selected_tags?: string[] | null;
  place_types?: string[] | null;
  ranking_reason?: string | null;
  selectedPlaces?: Array<{
    name: string;
    place_id: string | null;
    lat: number | null;
    lng: number | null;
    address: string;
  }> | null;
  itineraryPayload?: Record<string, unknown> | null;
  generationSource?: string | null;
  errorMessage?: string | null;
};

export type RecommendationDiagnosticSnapshot = {
  card_id: string;
  title: string;
  place_id: string | null;
  source_type: "google_places" | "proxy_photo" | "unsplash" | "ai_generated" | "fallback" | "mock";
  is_verified_real_place: boolean;
  location_source: "device_location" | "fallback_location" | "mock_location";
  photo_source: string | null;
  photo_url: string | null;
  photo_reference: string | null;
  photo_fallback_reason: string | null;
  opening_hours_source: string | null;
  opening_hours_status: string | null;
  business_status: string | null;
  distance_source: string | null;
  recommendation_source: string | null;
  fallback_triggered: boolean;
  fallback_reason: string | null;
  api_error: string | null;
  mood?: string | null;
  detected_intent?: string | null;
  selected_tags?: string[] | null;
  place_types?: string[] | null;
  ranking_reason?: string | null;
  created_at: string;
};

type DiagnosticsPayload = {
  homepage_recommendation_cards: RecommendationDiagnosticSnapshot[];
  chat_recommendation_cards: RecommendationDiagnosticSnapshot[];
  map_recommendation_cards: RecommendationDiagnosticSnapshot[];
  google_places_api_response_status: "ok" | "partial" | "error" | "empty";
  google_place_photo_success: {
    success_count: number;
    total_count: number;
    success_rate: number;
  };
  opening_hours_success: {
    success_count: number;
    total_count: number;
    success_rate: number;
  };
  fallback_mock_triggered: boolean;
  fallback_reason: string[];
  location_source: Array<"device_location" | "fallback_location" | "mock_location">;
  api_error_log: string[];
  build_version: string;
  environment: string;
  created_at: string;
  export_meta?: DiagnosticsExportMeta | null;
};

/** TestFlight QA / 開發者解鎖後顯示推薦卡診斷（非僅 import.meta.env.DEV） */
export function isDiagnosticsModeEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (import.meta.env.VITE_DEBUG_DIAGNOSTICS === "1") return true;
  if (isQaBuildEnabled()) return true;
  if (isDeveloperBuildEnabled() && readDeveloperUnlocked()) return true;
  return false;
}

function summarizePayload(payload: Omit<DiagnosticsPayload, "created_at">): DiagnosticsPayload {
  const allCards = [
    ...payload.homepage_recommendation_cards,
    ...payload.chat_recommendation_cards,
    ...payload.map_recommendation_cards,
  ];
  const totalCount = allCards.length;
  const photoSuccessCount = allCards.filter(
    (item) => item.photo_source != null && item.photo_source !== "fallback",
  ).length;
  const openingHoursSuccessCount = allCards.filter(
    (item) =>
      item.opening_hours_source === "google_opening_hours" &&
      item.opening_hours_status != null &&
      item.opening_hours_status !== "unknown",
  ).length;
  const fallbackReasons = Array.from(
    new Set(allCards.map((item) => item.fallback_reason).filter((v): v is string => Boolean(v))),
  );
  const apiErrors = Array.from(
    new Set(allCards.map((item) => item.api_error).filter((v): v is string => Boolean(v))),
  );
  const locationSources = Array.from(new Set(allCards.map((item) => item.location_source)));
  const hasApiError = apiErrors.length > 0;
  const hasFallback = allCards.some(
    (item) => item.fallback_triggered || item.source_type === "mock",
  );
  const hasVerified = allCards.some((item) => item.is_verified_real_place);
  const googlePlacesApiStatus: DiagnosticsPayload["google_places_api_response_status"] =
    totalCount === 0
      ? "empty"
      : hasApiError && !hasVerified
        ? "error"
        : hasApiError || hasFallback
          ? "partial"
          : "ok";

  return {
    ...payload,
    google_places_api_response_status: googlePlacesApiStatus,
    google_place_photo_success: {
      success_count: photoSuccessCount,
      total_count: totalCount,
      success_rate: totalCount > 0 ? Number((photoSuccessCount / totalCount).toFixed(4)) : 0,
    },
    opening_hours_success: {
      success_count: openingHoursSuccessCount,
      total_count: totalCount,
      success_rate: totalCount > 0 ? Number((openingHoursSuccessCount / totalCount).toFixed(4)) : 0,
    },
    fallback_mock_triggered: hasFallback,
    fallback_reason: fallbackReasons,
    location_source: locationSources,
    api_error_log: apiErrors,
    build_version:
      import.meta.env.VITE_APP_BUILD_VERSION ?? `${APP_MARKETING_VERSION} (${APP_BUILD_NUMBER})`,
    environment: import.meta.env.MODE,
    created_at: new Date().toISOString(),
  };
}

export async function copyDiagnosticsSnapshot(
  scope: string,
  items: RecommendationDiagnosticSnapshot[],
  meta?: DiagnosticsExportMeta,
): Promise<void> {
  const payload = {
    scope,
    meta: meta ?? null,
    created_at: new Date().toISOString(),
    count: items.length,
    empty_state: items.length === 0,
    items,
  };
  const text = JSON.stringify(payload, null, 2);
  console.log("[RECOMMENDATION_DIAGNOSTICS]", payload);
  const ok = await copyTextForMobile(text);
  if (ok) {
    toast.success(
      items.length === 0 ? "已複製診斷（含無地點卡狀態）" : "已複製診斷快照",
    );
  } else {
    toastCopyResult(false);
  }
}

export function buildDiagnosticsPayload(
  sections: Partial<{
    homepage_recommendation_cards: RecommendationDiagnosticSnapshot[];
    chat_recommendation_cards: RecommendationDiagnosticSnapshot[];
    map_recommendation_cards: RecommendationDiagnosticSnapshot[];
    export_meta?: DiagnosticsExportMeta | null;
  }>,
): DiagnosticsPayload {
  const summarized = summarizePayload({
    homepage_recommendation_cards: sections.homepage_recommendation_cards ?? [],
    chat_recommendation_cards: sections.chat_recommendation_cards ?? [],
    map_recommendation_cards: sections.map_recommendation_cards ?? [],
    google_places_api_response_status: "empty",
    google_place_photo_success: { success_count: 0, total_count: 0, success_rate: 0 },
    opening_hours_success: { success_count: 0, total_count: 0, success_rate: 0 },
    fallback_mock_triggered: false,
    fallback_reason: [],
    location_source: [],
    api_error_log: [],
    build_version: "",
    environment: "",
  });
  return { ...summarized, export_meta: sections.export_meta ?? null };
}

export async function downloadDiagnosticsJson(
  sections: Partial<{
    homepage_recommendation_cards: RecommendationDiagnosticSnapshot[];
    chat_recommendation_cards: RecommendationDiagnosticSnapshot[];
    map_recommendation_cards: RecommendationDiagnosticSnapshot[];
    export_meta?: DiagnosticsExportMeta | null;
  }>,
): Promise<void> {
  const payload = buildDiagnosticsPayload(sections);
  const text = JSON.stringify(payload, null, 2);
  console.log("[RECOMMENDATION_DIAGNOSTICS_FILE]", payload);
  const result = await exportJsonForMobile("diagnostics.json", text);
  toastJsonExportResult(result);
}
