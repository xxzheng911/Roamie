/**
 * 輕量啟動 handlers（勿在此 import router / supabase / 重型 provider）
 */
import { normalizeCapacitorEntryPath } from "@/lib/capacitor-entry-path";
import {
  errorFromErrorEvent,
  formatAppErrorLine,
  installCapacitorConsolePatch,
  logAppError,
  shouldShowCapacitorFatalOverlay,
} from "@/lib/log-error";
import {
  AUTH_CALLBACK_PATH,
  hasOAuthCallbackParams,
} from "@/lib/auth-oauth";
import { waitForCapacitorBridge } from "@/lib/capacitor-bridge-ready";
import { attachOAuthDeepLinkListener, readPendingCallbackPath } from "@/lib/auth-oauth-deep-link";
import { navigateOAuthAppPath } from "@/lib/oauth-app-navigate";
import {
  installLocationPermissionResumeListener,
  prefetchLocationPermissionStatus,
} from "@/lib/location-permission-manager";
import { installWebGeolocationShim } from "@/lib/web-geolocation-shim";
import {
  isGoogleMapsSdkInternalError,
  logMapRuntimeDiagnostics,
  recordGoogleMapsSdkFailureFromError,
} from "@/lib/maps-runtime-diagnostics";
import { warmSupabaseAuthStorage } from "@/lib/supabase-auth-storage";
import { loadOnboardingState } from "@/lib/onboarding-storage";

let appInitInstalled = false;

function recoverPendingOAuthCallbackPath(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === AUTH_CALLBACK_PATH) return;
  if (hasOAuthCallbackParams()) return;
  const pending = readPendingCallbackPath();
  if (!pending || !pending.startsWith(`${AUTH_CALLBACK_PATH}?`)) return;
  void navigateOAuthAppPath(pending).catch((error) => {
    logAppError("APP_INIT_ERROR", error, { source: "recoverPendingOAuthCallbackPath" });
  });
}

function showCapacitorFatalOverlay(
  tag: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  if (typeof document === "undefined") return;
  if (!shouldShowCapacitorFatalOverlay(error, extra)) return;
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  if (!cap?.isNativePlatform?.()) return;

  const line = formatAppErrorLine(tag, error);
  let el = document.getElementById("roamie-fatal-overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "roamie-fatal-overlay";
    el.setAttribute(
      "style",
      "position:fixed;inset:0;z-index:99999;background:#f7f4ef;padding:24px;overflow:auto;font:14px/1.5 system-ui,sans-serif;color:#2a2520",
    );
    document.body.appendChild(el);
  }
  el.innerHTML = `<p style="margin:0 0 8px;font-weight:600">Roamie 啟動錯誤</p><pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:11px;color:#6b635c">${line.replace(/</g, "&lt;")}</pre><p style="margin:16px 0 0;font-size:12px;color:#6b635c">請將此訊息截圖回報，或重新啟動 App。</p>`;
}

/** 非阻塞：讓 createRoot 有機會先執行 */
export function scheduleAppInitHandlers(): void {
  if (typeof window !== "undefined") {
    installWebGeolocationShim();
    logMapRuntimeDiagnostics();
  }
  if (appInitInstalled || typeof window === "undefined") return;

  const run = () => {
    if (appInitInstalled) return;
    appInitInstalled = true;
    installAppInitHandlersCore();
  };

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 500 });
  } else {
    window.setTimeout(run, 0);
  }
}

function installAppInitHandlersCore(): void {
  installCapacitorConsolePatch();

  window.addEventListener(
    "error",
    (event) => {
      const err = errorFromErrorEvent(event as ErrorEvent);
      const eventMessage = (event as ErrorEvent).message?.trim() ?? "";
      recordGoogleMapsSdkFailureFromError(err, eventMessage, extra);
      const extra = {
        source: "window.error",
        eventMessage,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        script: (event.target as HTMLElement | null)?.tagName === "SCRIPT",
      };
      if (isGoogleMapsSdkInternalError(err, extra, eventMessage)) return;
      logAppError("APP_INIT_ERROR", err, extra);
      showCapacitorFatalOverlay("APP_INIT_ERROR", err, extra);
    },
    true,
  );

  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    recordGoogleMapsSdkFailureFromError(reason);
    if (isGoogleMapsSdkInternalError(reason, { source: "unhandledrejection" })) return;
    logAppError("APP_UNHANDLED_REJECTION", reason, {
      source: "unhandledrejection",
    });
    showCapacitorFatalOverlay("APP_UNHANDLED_REJECTION", reason, {
      source: "unhandledrejection",
    });
  });

  try {
    normalizeCapacitorEntryPath();
    const cap = (
      window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor;
    if (cap?.isNativePlatform?.()) {
      void waitForCapacitorBridge().then(async (ready) => {
        if (!ready) return;
        await loadOnboardingState();
        prefetchLocationPermissionStatus();
        installLocationPermissionResumeListener();
        void warmSupabaseAuthStorage();
        attachOAuthDeepLinkListener();
        recoverPendingOAuthCallbackPath();
      });
    } else {
      void loadOnboardingState();
    }
  } catch (error) {
    logAppError("APP_INIT_ERROR", error, { source: "normalizeCapacitorEntryPath" });
  }
}
