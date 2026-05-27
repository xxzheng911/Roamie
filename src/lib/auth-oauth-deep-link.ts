import { App } from "@capacitor/app";
import { detectPlatform } from "@/services/platform";
import { markSessionBootstrapped } from "@/components/StartupGate";
import { buildInAppOAuthCallbackHref, oauthDeepLinkToAppPath } from "@/lib/auth-redirect";
import { AUTH_CALLBACK_PATH, finalizeOAuthBrowserReturn } from "@/lib/auth-oauth";
import { emitOAuthFlow, logAuthDebug, logAuthError } from "@/lib/auth-debug";
import { waitForCapacitorBridge } from "@/lib/capacitor-bridge-ready";
import { navigateOAuthAppPath } from "@/lib/oauth-app-navigate";
import { shouldSkipOAuthCallbackNavigation } from "@/lib/oauth-callback-guard";
import { notifyIosOAuthReturn } from "@/lib/ios-snapshot-bridge";

/** 由 iOS 原生 ASWebAuthenticationSession 回呼注入 */
export function registerNativeOAuthReturnHandler(): void {
  if (typeof window === "undefined") return;
  const win = window as Window & {
    __roamieHandleOAuthReturn?: (payload: string | { url: string }) => void;
  };
  win.__roamieHandleOAuthReturn = (payload) => {
    const url = typeof payload === "string" ? payload : payload?.url;
    if (!url) return;
    handleOAuthReturnUrl(url, "native-asweb");
  };
}

registerNativeOAuthReturnHandler();

let listenerAttached = false;
let removeListeners: (() => void) | null = null;
let handleUrlImpl: ((url: string, source: string) => void) | null = null;
const earlyUrls: string[] = [];

export const OAUTH_PENDING_CALLBACK_KEY = "roamie:oauth-pending-callback-path";

function stashPendingCallbackPath(path: string): void {
  try {
    sessionStorage.setItem(OAUTH_PENDING_CALLBACK_KEY, path);
  } catch {
    // ignore quota / private mode errors
  }
}

export function clearPendingCallbackPath(): void {
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

export function hasPendingOAuthCallback(): boolean {
  return readPendingCallbackPath() != null;
}

async function navigateToCallbackPath(path: string, source: string, rawUrl: string): Promise<void> {
  if (await shouldSkipOAuthCallbackNavigation(path)) {
    return;
  }

  logAuthDebug("oauth.deep_link", {
    source,
    rawUrl,
    path,
    target: typeof window !== "undefined" ? `${window.location.origin}${path}` : path,
  });

  void finalizeOAuthBrowserReturn();
  notifyIosOAuthReturn();
  markSessionBootstrapped();
  stashPendingCallbackPath(path);

  const next = buildInAppOAuthCallbackHref(path);
  emitOAuthFlow({ phase: "return", path, href: next });

  void (async () => {
    try {
      await waitForCapacitorBridge();
      const mode = await navigateOAuthAppPath(path);
      logAuthDebug("oauth.callback_navigate", {
        source,
        mode,
        pathname: window.location.pathname,
        hasCode: new URL(window.location.href).searchParams.has("code"),
      });
      if (window.location.pathname === AUTH_CALLBACK_PATH) {
        clearPendingCallbackPath();
      }
    } catch (e) {
      logAuthError("oauth.deep_link_navigate", e, { source, rawUrl, path, next });
      try {
        window.location.replace(next);
      } catch (replaceError) {
        logAuthError("oauth.deep_link_history", replaceError, { source, rawUrl, path, next });
      }
    }
  })();
}

function drainEarlyUrls(): void {
  if (!handleUrlImpl || earlyUrls.length === 0) return;
  const queued = earlyUrls.splice(0, earlyUrls.length);
  for (const item of queued) {
    const [url, source] = item.split("\0");
    if (url) handleUrlImpl(url, source || "early-queue");
  }
}

function enqueueOrHandleUrl(url: string, source: string): void {
  if (handleUrlImpl) {
    handleUrlImpl(url, source);
    return;
  }
  earlyUrls.push(`${url}\0${source}`);
}

/** Native / tests can push an OAuth return URL before Capacitor listeners attach. */
export function handleOAuthReturnUrl(url: string, source = "external"): void {
  enqueueOrHandleUrl(url, source);
}

async function processLaunchUrl(source: string): Promise<void> {
  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) enqueueOrHandleUrl(launch.url, source);
  } catch (e) {
    logAuthError("oauth.getLaunchUrl", e, { source });
  }
}

/**
 * Handles OAuth return URLs (roamie://auth/callback?code=…) on iOS/Android TestFlight builds.
 * Safe to call multiple times — registers listeners once.
 */
export function attachOAuthDeepLinkListener(): () => void {
  if (typeof window === "undefined") return () => {};
  const info = detectPlatform();
  if (!info.isCapacitor) return () => {};
  if (listenerAttached) return () => removeListeners?.();

  listenerAttached = true;

  handleUrlImpl = (url: string, source: string) => {
    try {
      const path = oauthDeepLinkToAppPath(url);
      if (!path) {
        logAuthDebug("oauth.deep_link_ignored", { source, url });
        return;
      }
      void navigateToCallbackPath(path, source, url);
    } catch (e) {
      logAuthError("oauth.deep_link_handle", e, { source, url });
      emitOAuthFlow({
        phase: "error",
        message: e instanceof Error ? e.message : "無法處理登入返回網址",
      });
    }
  };

  drainEarlyUrls();

  const subs: Array<{ remove: () => Promise<void> | void }> = [];

  void processLaunchUrl("getLaunchUrl");

  void (async () => {
    try {
      subs.push(
        await App.addListener("appUrlOpen", (event) => {
          enqueueOrHandleUrl(event.url, "appUrlOpen");
        }),
      );
    } catch (e) {
      logAuthError("oauth.appUrlOpen_listener", e);
      listenerAttached = false;
      handleUrlImpl = null;
    }

    try {
      subs.push(
        await App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) return;
          void processLaunchUrl("appStateChange:getLaunchUrl");
          const pending = readPendingCallbackPath();
          if (!pending) return;
          void (async () => {
            if (await shouldSkipOAuthCallbackNavigation(pending)) return;
            emitOAuthFlow({ phase: "return", path: pending });
            await navigateOAuthAppPath(pending);
          })();
        }),
      );
    } catch {
      // optional
    }
  })();

  removeListeners = () => {
    listenerAttached = false;
    handleUrlImpl = null;
    for (const sub of subs) {
      void sub.remove();
    }
  };

  return () => removeListeners?.();
}
