/// <reference types="google.maps" />
import {
  getGoogleMapsBrowserKey,
  getGoogleMapsBrowserKeyError,
} from "@/lib/google-maps-client";
import { logGoogleKeyStatus } from "@/lib/map-boot-log";
import { isGoogleBillingDisabledError } from "@/lib/places-api-errors";
import {
  googleMapsBillingUserMessage,
  googleMapsFailureUserMessage,
} from "@/lib/maps-runtime-diagnostics";

const LOG = "[Roamie Maps]";

declare global {
  interface Window {
    google?: typeof google;
  }
}

export type GoogleMapsApi = typeof google.maps;

let loadPromise: Promise<GoogleMapsApi> | null = null;
let billingErrorHookInstalled = false;

function recordMapsAuthFailure(message: string, reason: string): void {
  window.__roamieMapsAuthFailure = { message };
  console.error("[MAP_LOAD] error=", message);
  console.info("[MAP_FALLBACK] reason=", reason);
}

/** 捕捉 Maps JS 在 console 拋出的 BillingNotEnabledMapError（不一定會觸發 gm_authFailure） */
export function installGoogleMapsBillingErrorListener(): void {
  if (typeof window === "undefined" || billingErrorHookInstalled) return;
  billingErrorHookInstalled = true;

  const onError = (ev: ErrorEvent) => {
    const msg = [ev.message, ev.error instanceof Error ? ev.error.message : ""]
      .filter(Boolean)
      .join(" ");
    if (!isGoogleBillingDisabledError(msg)) return;
    recordMapsAuthFailure(googleMapsBillingUserMessage(), "billing_not_enabled_console");
  };

  window.addEventListener("error", onError);
}

function waitForImportLibrary(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (window.google?.maps?.importLibrary) {
        console.info(LOG, "window.google.maps.importLibrary 已就緒");
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(
          new Error(
            "等待 google.maps 逾時。請確認已啟用 Maps JavaScript API，且 API 金鑰允許此網域。",
          ),
        );
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

type MapsAuthFailureDetail = { message: string };

declare global {
  interface Window {
    gm_authFailure?: () => void;
    __roamieMapsAuthFailure?: MapsAuthFailureDetail;
  }
}

function installMapsAuthFailureHook(): void {
  if (typeof window === "undefined") return;
  installGoogleMapsBillingErrorListener();
  window.gm_authFailure = () => {
    const message =
      "Google 地圖授權失敗。請確認已啟用帳單、Maps JavaScript API，且金鑰允許 iOS bundle（com.shuode.roamie）或 capacitor://localhost/*。";
    recordMapsAuthFailure(message, "gm_authFailure");
  };
}

function injectMapsScript(): Promise<void> {
  const key = getGoogleMapsBrowserKey();
  if (!key) {
    const err = getGoogleMapsBrowserKeyError() ?? "缺少 API 金鑰";
    console.info("[MAP_LOAD] start url=", "(skipped:no_key)");
    console.error("[MAP_LOAD] error=", err);
    return Promise.reject(new Error(err));
  }

  installMapsAuthFailureHook();
  const src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&v=weekly`;
  const existing = document.querySelector<HTMLScriptElement>('script[data-roamie-maps="1"]');

  if (existing) {
    console.info(LOG, "重用既有 script tag");
    if (window.google?.maps?.importLibrary) return Promise.resolve();
    return waitForImportLibrary(20_000);
  }

  return new Promise((resolve, reject) => {
    const redactedUrl = src.replace(key, "***");
    console.info("[MAP_LOAD] start url=", redactedUrl);
    console.info(LOG, "注入 script", { src: redactedUrl });
    const s = document.createElement("script");
    s.dataset.roamieMaps = "1";
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      console.info(LOG, "script onload", {
        hasGoogle: !!window.google,
        hasMaps: !!window.google?.maps,
      });
      waitForImportLibrary(20_000).then(resolve).catch(reject);
    };
    s.onerror = (ev) => {
      const msg =
        "無法載入 Google Maps script。請檢查網路、CSP，或 API 金鑰是否啟用 Maps JavaScript API。";
      console.error("[MAP_LOAD] error=", msg, ev);
      reject(new Error(msg));
    };
    document.head.appendChild(s);
  });
}

/** Load Maps JS API via importLibrary (recommended async loader). */
export async function loadGoogleMapsApi(): Promise<GoogleMapsApi> {
  if (typeof window === "undefined") {
    throw new Error("SSR 環境無法載入地圖");
  }

  logGoogleKeyStatus("map-load");
  console.info("[MAP_LOAD] start");

  const keyError = getGoogleMapsBrowserKeyError();
  if (keyError) {
    console.info("[MAP_LOAD] start url=", "(skipped:key_validation)");
    console.error("[MAP_LOAD] error=", keyError);
    console.error(LOG, "金鑰檢查失敗", keyError);
    throw new Error(keyError);
  }

  if (window.google?.maps?.importLibrary) {
    console.info(LOG, "API 已載入，略過 inject");
    try {
      await window.google.maps.importLibrary("maps");
      console.info(LOG, "importLibrary(maps) ok (cached)");
      return window.google.maps;
    } catch (e) {
      console.warn(LOG, "importLibrary 失敗，重新載入", e);
      loadPromise = null;
    }
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      await injectMapsScript();
      if (!window.google?.maps?.importLibrary) {
        throw new Error("script 載入後仍找不到 google.maps.importLibrary");
      }
      const mapsLib = (await window.google.maps.importLibrary("maps")) as {
        Map?: typeof google.maps.Map;
        sdkError?: { sessionStatus?: unknown };
      };
      const sdkErr = mapsLib?.sdkError;
      if (sdkErr != null) {
        const message = googleMapsFailureUserMessage(
          `Maps JS sdkError (sessionStatus=${String(sdkErr.sessionStatus ?? "unknown")})`,
        );
        recordMapsAuthFailure(message, "importLibrary_sdkError");
        throw new Error(message);
      }
      if (typeof mapsLib?.Map !== "function") {
        const message = googleMapsFailureUserMessage("Maps JS 未載入 Map 建構子");
        recordMapsAuthFailure(message, "importLibrary_missing_map_ctor");
        throw new Error(message);
      }
      console.info("[MAP_LOAD] success");
      console.info(LOG, "importLibrary(maps) 完成", {
        Map: true,
        mapsVersion: window.google?.maps?.version,
      });
      return window.google!.maps;
    })().catch((err) => {
      loadPromise = null;
      console.error("[MAP_LOAD] error=", err instanceof Error ? err.message : String(err));
      console.error(LOG, "載入失敗", err);
      throw err;
    });
  }

  return loadPromise;
}

export function triggerMapResize(map: google.maps.Map): void {
  window.google?.maps?.event?.trigger(map, "resize");
}
