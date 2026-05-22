/// <reference types="google.maps" />
import {
  getGoogleMapsBrowserKey,
  getGoogleMapsBrowserKeyError,
} from "@/lib/google-maps-client";

const LOG = "[Roamie Maps]";

declare global {
  interface Window {
    google?: typeof google;
  }
}

export type GoogleMapsApi = typeof google.maps;

let loadPromise: Promise<GoogleMapsApi> | null = null;

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

function injectMapsScript(): Promise<void> {
  const key = getGoogleMapsBrowserKey();
  if (!key) {
    return Promise.reject(new Error(getGoogleMapsBrowserKeyError() ?? "缺少 API 金鑰"));
  }

  const src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&v=weekly`;
  const existing = document.querySelector<HTMLScriptElement>('script[data-roamie-maps="1"]');

  if (existing) {
    console.info(LOG, "重用既有 script tag");
    if (window.google?.maps?.importLibrary) return Promise.resolve();
    return waitForImportLibrary(20_000);
  }

  return new Promise((resolve, reject) => {
    console.info(LOG, "注入 script", { src: src.replace(key, "***") });
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
    s.onerror = () => {
      reject(
        new Error(
          "無法載入 Google Maps script。請檢查網路、CSP，或 API 金鑰是否啟用 Maps JavaScript API。",
        ),
      );
    };
    document.head.appendChild(s);
  });
}

/** Load Maps JS API via importLibrary (recommended async loader). */
export async function loadGoogleMapsApi(): Promise<GoogleMapsApi> {
  if (typeof window === "undefined") {
    throw new Error("SSR 環境無法載入地圖");
  }

  const keyError = getGoogleMapsBrowserKeyError();
  if (keyError) {
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
      const mapsLib = await window.google.maps.importLibrary("maps");
      console.info(LOG, "importLibrary(maps) 完成", {
        Map: !!(mapsLib as { Map?: unknown }).Map,
        mapsVersion: window.google?.maps?.version,
      });
      return window.google!.maps;
    })().catch((err) => {
      loadPromise = null;
      console.error(LOG, "載入失敗", err);
      throw err;
    });
  }

  return loadPromise;
}

export function triggerMapResize(map: google.maps.Map): void {
  window.google?.maps?.event?.trigger(map, "resize");
}
