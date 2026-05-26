import { App } from "@capacitor/app";
import { detectPlatform } from "@/services/platform";
import { markSessionBootstrapped } from "@/components/StartupGate";
import { buildInAppOAuthCallbackHref, oauthDeepLinkToAppPath } from "@/lib/auth-redirect";
import { AUTH_CALLBACK_PATH, finalizeOAuthBrowserReturn } from "@/lib/auth-oauth";
import { emitOAuthFlow, logAuthDebug, logAuthError } from "@/lib/auth-debug";

let listenerAttached = false;
export const OAUTH_PENDING_CALLBACK_KEY = "roamie:oauth-pending-callback-path";

function stashPendingCallbackPath(path: string): void {
  try {
    sessionStorage.setItem(OAUTH_PENDING_CALLBACK_KEY, path);
  } catch {
    // ignore quota / private mode errors
  }
}

function clearPendingCallbackPath(): void {
  try {
    sessionStorage.removeItem(OAUTH_PENDING_CALLBACK_KEY);
  } catch {
    // ignore
  }
}

export function readPendingCallbackPath(): string | null {
  try {
    return sessionStorage.getItem(OAUTH_PENDING_CALLBACK_KEY);
  } catch {
    return null;
  }
}

function navigateToCallbackPath(path: string, source: string, rawUrl: string): void {
  logAuthDebug("oauth.deep_link", {
    source,
    rawUrl,
    path,
    target: typeof window !== "undefined" ? `${window.location.origin}${path}` : path,
  });

  void finalizeOAuthBrowserReturn();
  markSessionBootstrapped();
  stashPendingCallbackPath(path);

  const next = buildInAppOAuthCallbackHref(path);
  emitOAuthFlow({ phase: "return", path, href: next });

  /**
   * Capacitor (iOS) 上用 `window.location.replace()` 導到 `/auth/callback?...`
   * 可能觸發 WebView 重新載入，且沒有 server fallback 時會變成白屏。
   * 這裡改用 history API 讓 SPA router 接手。
   */
  try {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current !== path) {
      window.history.replaceState(window.history.state, "", path);
    }
    window.dispatchEvent(new PopStateEvent("popstate"));
    if (window.location.pathname === AUTH_CALLBACK_PATH) {
      clearPendingCallbackPath();
    }
  } catch (e) {
    // 最後手段：真的無法用 history 才 reload
    logAuthError("oauth.deep_link_history", e, { source, rawUrl, path, next });
    window.location.replace(next);
  }
}

/**
 * Handles OAuth return URLs (roamie://auth/callback?code=…) on iOS/Android TestFlight builds.
 */
export function attachOAuthDeepLinkListener(): () => void {
  if (typeof window === "undefined") return () => {};
  const info = detectPlatform();
  if (!info.isCapacitor || listenerAttached) return () => {};

  listenerAttached = true;

  const handleUrl = (url: string, source: string) => {
    try {
      const path = oauthDeepLinkToAppPath(url);
      if (!path) return;
      navigateToCallbackPath(path, source, url);
    } catch (e) {
      logAuthError("oauth.deep_link_handle", e, { source, url });
      emitOAuthFlow({
        phase: "error",
        message: e instanceof Error ? e.message : "無法處理登入返回網址",
      });
    }
  };

  void App.getLaunchUrl().then((result) => {
    if (result?.url) handleUrl(result.url, "getLaunchUrl");
  });

  const subPromise = App.addListener("appUrlOpen", (event) => {
    handleUrl(event.url, "appUrlOpen");
  });

  return () => {
    listenerAttached = false;
    void subPromise.then((sub) => sub.remove());
  };
}
