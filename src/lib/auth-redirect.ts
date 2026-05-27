import { APP_SCHEME } from "@/constants/app";
import {
  AUTH_CALLBACK_PATH,
  LOCAL_DEV_AUTH_CALLBACK,
  OAUTH_DEEP_LINK_REDIRECT,
  readOptionalWebAuthCallback,
} from "@/constants/auth-redirect";
import { readSupabaseProjectUrl } from "@/lib/supabase-project-url";
import { detectPlatform } from "@/services/platform";

export {
  AUTH_CALLBACK_PATH,
  LOCAL_DEV_AUTH_CALLBACK,
  OAUTH_DEEP_LINK_REDIRECT,
  readOptionalWebAuthCallback,
  suggestedSupabaseRedirectUrls,
} from "@/constants/auth-redirect";

/**
 * OAuth `redirectTo` — iOS TestFlight / 原生一律 `roamie://auth/callback`。
 * Web 本機用 localhost；正式網域僅在設定 VITE_APP_ORIGIN 後使用（不寫死）。
 */
export function getOAuthRedirectUrl(): string {
  const info = detectPlatform();

  if (info.isCapacitor || info.isNative) {
    return OAUTH_DEEP_LINK_REDIRECT;
  }

  const configured = readOptionalWebAuthCallback();
  if (configured) return configured;

  if (typeof window !== "undefined") {
    const origin = window.location.origin;
    if (origin && origin !== "null" && !origin.startsWith("file:")) {
      return `${origin}${AUTH_CALLBACK_PATH}`;
    }
  }

  return LOCAL_DEV_AUTH_CALLBACK;
}

export function isOAuthDeepLinkUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === `${APP_SCHEME}:`) return true;
    if (u.href.startsWith(OAUTH_DEEP_LINK_REDIRECT)) return true;

    const project = readSupabaseProjectUrl();
    if (project) {
      const origin = new URL(project).origin;
      if (u.origin === origin && u.pathname.endsWith("/auth/v1/callback")) {
        return true;
      }
    }

    return u.pathname === AUTH_CALLBACK_PATH || u.pathname.endsWith(AUTH_CALLBACK_PATH);
  } catch {
    return false;
  }
}

/** 給登入錯誤提示：須加入 Supabase Redirect URLs 的清單 */
export function formatSupabaseRedirectAllowListHint(): string {
  return suggestedSupabaseRedirectUrls().join("\n");
}

/** 將 OAuth deep link 轉成 WebView 內 `/auth/callback?…` */
export function oauthDeepLinkToAppPath(url: string): string | null {
  try {
    if (!isOAuthDeepLinkUrl(url)) return null;
    const parsed = new URL(url);
    const search = parsed.search || "";
    const hash = parsed.hash && parsed.hash !== "#" ? parsed.hash : "";

    if (parsed.protocol === `${APP_SCHEME}:`) {
      // roamie://auth/callback → hostname "auth", pathname "/callback"
      const fromHost =
        parsed.hostname && parsed.pathname && parsed.pathname !== "/"
          ? `/${parsed.hostname}${parsed.pathname}`
          : parsed.pathname && parsed.pathname !== "/"
            ? parsed.pathname
            : AUTH_CALLBACK_PATH;
      const normalized = fromHost.replace(/\/+$/, "") || AUTH_CALLBACK_PATH;
      return `${normalized}${search}${hash}`;
    }

    return `${AUTH_CALLBACK_PATH}${search}${hash}`;
  } catch {
    return null;
  }
}

/** Capacitor WebView 內組出完整 callback href */
export function buildInAppOAuthCallbackHref(path: string): string {
  if (typeof window === "undefined") return path;
  try {
    return new URL(path, window.location.origin).href;
  } catch {
    return path;
  }
}
