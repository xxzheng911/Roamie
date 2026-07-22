/**
 * Places Gateway — Feature Flag 切換點（Phase 1 Step B）
 *
 * 呼叫端應只 import 此處，不直接呼叫 pieFacade。
 * - flag ON  → PIE Facade（目前仍委派舊實作，行為一致）
 * - flag OFF → 直接呼叫舊模組（TestFlight 預設回退路徑）
 *
 * 關閉 flag 後行為與「完全不經 PIE」相同。
 */

import { isPieFacadeEnabled } from "@/lib/pie/feature-flag";
import {
  averageLatencyMs,
  nowMs,
  recordPieMetric,
  type PieCacheSignal,
  type PieMetricOutcome,
} from "@/lib/pie/metrics";
import { pieFacade } from "@/lib/pie/pie-facade";
import type { PlacesGatewayPath } from "@/lib/pie/types";
import {
  executeExploreSearch,
  fetchPlaceDetailsForIntro as fetchPlaceDetailsForIntroLegacy,
  fetchPlaceDetailsForScreen,
  fetchPlaceDetailsForScreenWithKey as fetchPlaceDetailsForScreenWithKeyLegacy,
  getPlaceDetails as getPlaceDetailsServerFnLegacy,
} from "@/lib/places.functions";
import { fetchGooglePlaceDetailsForHandoff as fetchGooglePlaceDetailsForHandoffLegacy } from "@/lib/place-detail-resolve";
import {
  buildUnifiedPlaceDetailsCacheKey,
  readUnifiedPlaceDetailsCache,
} from "@/lib/unified-place-cache";
import { getPlaceImage as getPlaceImageLegacy } from "@/services/placeImageService";
import {
  getPlaceDetails as getPlaceLiteDetailsLegacy,
  normalizePlace as normalizePlaceLegacy,
  searchPlaces as searchAutocompleteLegacy,
} from "@/services/placesService";

export { isPieFacadeEnabled } from "@/lib/pie/feature-flag";
export type { PlacesGatewayPath } from "@/lib/pie/types";

type GatewayCallStats = {
  autocomplete: { legacy: number; pie: number };
  detailLite: { legacy: number; pie: number };
  lastAutocompletePath: PlacesGatewayPath | null;
  lastDetailLitePath: PlacesGatewayPath | null;
};

const gatewayCallStats: GatewayCallStats = {
  autocomplete: { legacy: 0, pie: 0 },
  detailLite: { legacy: 0, pie: 0 },
  lastAutocompletePath: null,
  lastDetailLitePath: null,
};

/** 讀取 gateway 呼叫統計（verify / 診斷用） */
export function getPlacesGatewayAutocompleteStats(): Readonly<
  Pick<GatewayCallStats, "autocomplete" | "lastAutocompletePath">
> {
  return {
    autocomplete: { ...gatewayCallStats.autocomplete },
    lastAutocompletePath: gatewayCallStats.lastAutocompletePath,
  };
}

export function getPlacesGatewayDetailLiteStats(): Readonly<
  Pick<GatewayCallStats, "detailLite" | "lastDetailLitePath">
> {
  return {
    detailLite: { ...gatewayCallStats.detailLite },
    lastDetailLitePath: gatewayCallStats.lastDetailLitePath,
  };
}

export function resetPlacesGatewayAutocompleteStats(): void {
  gatewayCallStats.autocomplete.legacy = 0;
  gatewayCallStats.autocomplete.pie = 0;
  gatewayCallStats.lastAutocompletePath = null;
}

export function resetPlacesGatewayDetailLiteStats(): void {
  gatewayCallStats.detailLite.legacy = 0;
  gatewayCallStats.detailLite.pie = 0;
  gatewayCallStats.lastDetailLitePath = null;
}

function resolvePath(): PlacesGatewayPath {
  return isPieFacadeEnabled() ? "pie" : "legacy";
}

function detailCacheSignal(
  placeId: string,
  options?: {
    locale?: string;
    cacheCity?: string;
    cacheCountry?: string;
  },
): PieCacheSignal {
  try {
    const locale = (options?.locale as "zh-TW" | "en" | "ja" | "ko" | undefined) ?? "zh-TW";
    const key = buildUnifiedPlaceDetailsCacheKey(placeId, locale, {
      cityLabel: options?.cacheCity,
      country: options?.cacheCountry,
    });
    return readUnifiedPlaceDetailsCache(key)?.place ? "hit" : "miss";
  } catch {
    return "unknown";
  }
}

function detailOutcome(result: { place: unknown; error: string | null }): PieMetricOutcome {
  if (result.place && result.error) return "fallback";
  if (result.place) return "ok";
  if (result.error) return "error";
  return "empty";
}

/** Autocomplete / trip-stop 搜尋 */
export const searchAutocompleteViaGateway: typeof searchAutocompleteLegacy = (...args) => {
  const path = resolvePath();
  const started = nowMs();
  if (path === "pie") {
    gatewayCallStats.autocomplete.pie += 1;
    gatewayCallStats.lastAutocompletePath = "pie";
  } else {
    gatewayCallStats.autocomplete.legacy += 1;
    gatewayCallStats.lastAutocompletePath = "legacy";
  }

  const run =
    path === "pie" ? pieFacade.searchAutocomplete(...args) : searchAutocompleteLegacy(...args);

  return Promise.resolve(run).then((result) => {
    const empty = !result.suggestions?.length;
    recordPieMetric({
      op: "search",
      path,
      latencyMs: nowMs() - started,
      outcome: result.error ? (empty ? "error" : "ok") : empty ? "empty" : "ok",
      // autocomplete 另有 requestCache；不在此推斷 HTTP，避免誤報加倍
      cache: "unknown",
      httpInferred: 0,
      caller: "searchAutocompleteViaGateway",
    });
    return result;
  });
};

/** Explore nearby/text/multi */
export const searchExploreViaGateway: typeof executeExploreSearch = (...args) => {
  if (isPieFacadeEnabled()) {
    return pieFacade.searchExplore(...args);
  }
  return executeExploreSearch(...args);
};

/** 輕量 place details（PlaceLite）— Place Detail 相關第一優先遷移入口 */
export const getPlaceLiteDetailsViaGateway: typeof getPlaceLiteDetailsLegacy = (...args) => {
  const path = resolvePath();
  const started = nowMs();
  const placeId = args[0];
  const options = args[1];
  const cache = detailCacheSignal(placeId, options);

  if (path === "pie") {
    gatewayCallStats.detailLite.pie += 1;
    gatewayCallStats.lastDetailLitePath = "pie";
  } else {
    gatewayCallStats.detailLite.legacy += 1;
    gatewayCallStats.lastDetailLitePath = "legacy";
  }

  const run =
    path === "pie" ? pieFacade.getPlaceLiteDetails(...args) : getPlaceLiteDetailsLegacy(...args);

  return Promise.resolve(run).then((result) => {
    const place = result.place as { lat?: number | null; lng?: number | null } | null;
    const usedFallback =
      Boolean(place) && (place?.lat == null || place?.lng == null) && Boolean(options?.fallback);

    recordPieMetric({
      op: "detail",
      path,
      latencyMs: nowMs() - started,
      outcome: usedFallback ? "fallback" : detailOutcome(result),
      cache,
      httpInferred: cache === "hit" ? 0 : 1,
      caller: "getPlaceLiteDetailsViaGateway",
    });
    return result;
  });
};

function wrapDetailCall<T>(
  caller: string,
  placeId: string | undefined,
  run: () => T | Promise<T>,
  mapOutcome: (result: T) => PieMetricOutcome,
): Promise<T> {
  const path = resolvePath();
  const started = nowMs();
  const cache = placeId ? detailCacheSignal(placeId) : ("unknown" as PieCacheSignal);

  return Promise.resolve(run()).then((result) => {
    recordPieMetric({
      op: "detail",
      path,
      latencyMs: nowMs() - started,
      outcome: mapOutcome(result),
      cache,
      httpInferred: cache === "hit" ? 0 : 1,
      caller,
    });
    return result;
  });
}

/** 詳情頁用 Place Details（server key） */
export const fetchPlaceDetailsForScreenViaGateway: typeof fetchPlaceDetailsForScreen = (
  ...args
) => {
  const placeId = args[0];
  return wrapDetailCall(
    "fetchPlaceDetailsForScreenViaGateway",
    placeId,
    () =>
      isPieFacadeEnabled()
        ? pieFacade.fetchPlaceDetailsForScreen(...args)
        : fetchPlaceDetailsForScreen(...args),
    (place) => (place ? "ok" : "empty"),
  );
};

/** 詳情頁用 Place Details（browser key） */
export const fetchPlaceDetailsForScreenWithKeyViaGateway: typeof fetchPlaceDetailsForScreenWithKeyLegacy =
  (...args) => {
    const placeId = args[0];
    return wrapDetailCall(
      "fetchPlaceDetailsForScreenWithKeyViaGateway",
      placeId,
      () =>
        isPieFacadeEnabled()
          ? pieFacade.fetchPlaceDetailsForScreenWithKey(...args)
          : fetchPlaceDetailsForScreenWithKeyLegacy(...args),
      (place) => (place ? "ok" : "empty"),
    );
  };

/** Intro / 推薦說明用 details */
export const fetchPlaceDetailsForIntroViaGateway: typeof fetchPlaceDetailsForIntroLegacy = (
  ...args
) => {
  const placeId = args[0];
  return wrapDetailCall(
    "fetchPlaceDetailsForIntroViaGateway",
    placeId,
    () =>
      isPieFacadeEnabled()
        ? pieFacade.fetchPlaceDetailsForIntro(...args)
        : fetchPlaceDetailsForIntroLegacy(...args),
    (details) => (details ? "ok" : "empty"),
  );
};

/** Place Detail 頁 handoff → Google details */
export const fetchGooglePlaceDetailsForHandoffViaGateway: typeof fetchGooglePlaceDetailsForHandoffLegacy =
  (...args) => {
    const placeId = args[0];
    return wrapDetailCall(
      "fetchGooglePlaceDetailsForHandoffViaGateway",
      placeId,
      () =>
        isPieFacadeEnabled()
          ? pieFacade.fetchGooglePlaceDetailsForHandoff(...args)
          : fetchGooglePlaceDetailsForHandoffLegacy(...args),
      (result) => {
        if (result.place && result.error) return "fallback";
        if (result.place) return "ok";
        if (result.error) return "error";
        return "empty";
      },
    );
  };

/**
 * TanStack server fn（Place Details）。
 * 與既有 `places.functions.getPlaceDetails` 為同一參考；經 gateway 匯出以便呼叫端統一入口。
 * Flag 切換發生在其內部呼叫的 screen details 實作層（委派相同）。
 */
export const getPlaceDetailsServerFnViaGateway = getPlaceDetailsServerFnLegacy;

/** 地點封面圖 */
export const getPlaceImageViaGateway: typeof getPlaceImageLegacy = (...args) => {
  if (isPieFacadeEnabled()) {
    return pieFacade.getPlaceImage(...args);
  }
  return getPlaceImageLegacy(...args);
};

/** Place 正規化 */
export const normalizePlaceViaGateway: typeof normalizePlaceLegacy = (...args) => {
  if (isPieFacadeEnabled()) {
    return pieFacade.normalizePlace(...args);
  }
  return normalizePlaceLegacy(...args);
};

/** 診斷：平均 latency（不影響行為） */
export function getPieGatewayLatencyAverages(): {
  searchMs: number | null;
  detailMs: number | null;
} {
  return {
    searchMs: averageLatencyMs("search"),
    detailMs: averageLatencyMs("detail"),
  };
}
