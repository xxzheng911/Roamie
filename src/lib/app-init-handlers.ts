/**
 * 輕量啟動 handlers（勿在此 import router / supabase / 重型 provider）
 */
import { normalizeCapacitorEntryPath } from "@/lib/capacitor-entry-path";
import {
  formatAppErrorLine,
  installCapacitorConsolePatch,
  logAppError,
  shouldShowCapacitorFatalOverlay,
} from "@/lib/log-error";
import {
  AUTH_CALLBACK_PATH,
  hasOAuthCallbackParams,
} from "@/lib/auth-oauth";
import { readPendingCallbackPath } from "@/lib/auth-oauth-deep-link";
import { ensureColdStartPath } from "@/lib/startup-route";

let appInitInstalled = false;

function recoverPendingOAuthCallbackPath(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === AUTH_CALLBACK_PATH) return;
  if (hasOAuthCallbackParams()) return;
  const pending = readPendingCallbackPath();
  if (!pending || !pending.startsWith(`${AUTH_CALLBACK_PATH}?`)) return;
  try {
    window.history.replaceState(window.history.state, "", pending);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch (error) {
    logAppError("APP_INIT_ERROR", error, { source: "recoverPendingOAuthCallbackPath" });
  }
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
      const err = (event as ErrorEvent).error ?? event.message;
      const extra = {
        source: "window.error",
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        script: (event.target as HTMLElement | null)?.tagName === "SCRIPT",
      };
      logAppError("APP_INIT_ERROR", err, extra);
      showCapacitorFatalOverlay("APP_INIT_ERROR", err, extra);
    },
    true,
  );

  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    logAppError("APP_UNHANDLED_REJECTION", reason, {
      source: "unhandledrejection",
    });
    showCapacitorFatalOverlay("APP_UNHANDLED_REJECTION", reason, {
      source: "unhandledrejection",
    });
  });

  try {
    normalizeCapacitorEntryPath();
    recoverPendingOAuthCallbackPath();
    ensureColdStartPath();
  } catch (error) {
    logAppError("APP_INIT_ERROR", error, { source: "normalizeCapacitorEntryPath" });
  }
}
