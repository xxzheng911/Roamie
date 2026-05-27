import { getGoogleMapsBrowserKey, getGoogleMapsBrowserKeyError } from "@/lib/google-maps-client";
import { logGoogleMapsKeyDiagnostics } from "@/lib/google-maps-key-resolve";
import { isGoogleBillingDisabledError } from "@/lib/places-api-errors";
import { detectPlatform } from "@/services/platform";

const MAP_FAILURE_PATTERNS = [
  /無法正確載入\s*Google\s*地圖/i,
  /這個網頁無法.*Google\s*地圖/i,
  /can't load Google Maps correctly/i,
  /For development purposes only/i,
  /Did you mean/i,
  /Google Maps Platform/i,
  /Google Maps JavaScript API error/i,
  /BillingNotEnabled/i,
  /InvalidKeyMapError/i,
  /RefererNotAllowed/i,
  /ApiNotActivated/i,
  /billing.*not enabled/i,
  /帳單/i,
];

function containerFailureText(container: HTMLElement): string {
  return [container.textContent, container.innerText].filter(Boolean).join("\n");
}

/** 監聽 Maps JS 在 console / window 拋出的授權、計費錯誤 */
export function installGoogleMapsWindowErrorListener(
  onFailure: (message: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (ev: ErrorEvent) => {
    const msg = [ev.message, ev.filename, String(ev.error ?? "")].filter(Boolean).join(" ");
    if (!msg.trim()) return;
    if (!MAP_FAILURE_PATTERNS.some((re) => re.test(msg)) && !isGoogleBillingDisabledError(msg)) {
      return;
    }
    onFailure(googleMapsFailureUserMessage(msg));
  };

  window.addEventListener("error", handler);
  return () => window.removeEventListener("error", handler);
}

export function googleMapsBillingUserMessage(): string {
  return "Google Cloud 專案尚未啟用帳單。請至 Google Cloud Console 連結帳單帳戶，並啟用 Maps JavaScript API 與 Places API。";
}

/** 啟動時記錄 WebView origin 與金鑰狀態（不印完整 key） */
export function logMapRuntimeDiagnostics(): void {
  if (typeof window === "undefined") return;
  const platform = detectPlatform();
  const keyErr = getGoogleMapsBrowserKeyError();
  console.info("[MAP_ORIGIN] origin=", window.location.origin);
  console.info("[MAP_ORIGIN] href=", window.location.href);
  const appOrigin =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_APP_ORIGIN
      ? String(import.meta.env.VITE_APP_ORIGIN).trim()
      : "";
  console.info("[MAP_ORIGIN] vite_app_origin=", appOrigin || "(unset)");
  console.info("[MAP_DIAG] capacitor=", platform.isCapacitor, "ios=", platform.isIOS);
  logGoogleMapsKeyDiagnostics();
  if (keyErr) console.warn("[GOOGLE_KEY] validation=", keyErr);
  void getGoogleMapsBrowserKey();
  if (platform.isCapacitor) {
    console.info(
      "[MAP_DIAG] nativeHint=",
      "GCP 金鑰需啟用 Maps JavaScript API + Places API；iOS 限制請填 bundle id com.shuode.roamie，或 HTTP referrer 加 capacitor://localhost/*；並啟用帳單",
    );
  }
}

/** Google Maps 在 DOM 內顯示授權／計費錯誤或 development 浮水印時為 true */
export function detectGoogleMapsDomFailure(container: HTMLElement | null): boolean {
  if (!container) return false;

  const allText = containerFailureText(container).trim();
  if (allText.length > 0 && MAP_FAILURE_PATTERNS.some((re) => re.test(allText))) {
    return true;
  }

  const errNode = container.querySelector(
    ".gm-err-container, .gm-err-message, .dismissible-error",
  );
  if (errNode) {
    const text = (errNode.textContent ?? "").trim();
    if (text.length > 0 && MAP_FAILURE_PATTERNS.some((re) => re.test(text))) return true;
  }

  return false;
}

export function googleMapsFailureUserMessage(detail?: string | null): string {
  if (isGoogleBillingDisabledError(detail)) return googleMapsBillingUserMessage();
  return "Google 地圖無法載入。請在 Google Cloud 啟用 Maps JavaScript API 與帳單，並將 API 金鑰允許 iOS bundle（com.shuode.roamie）或 capacitor://localhost/*。";
}
