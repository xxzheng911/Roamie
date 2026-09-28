import { resolveOAuthCallback, validateOAuthOrigin } from "@/lib/oauth-origin-authority";
import { APP_SCHEME } from "@/constants/app";
import {
  AUTH_CALLBACK_PATH,
  LOCAL_DEV_AUTH_CALLBACK,
  OAUTH_DEEP_LINK_REDIRECT,
  readOptionalWebAuthCallback,
  suggestedSupabaseRedirectUrls,
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

/** Web authority is the strictly validated current origin; native retains its deep link. */
export function getOAuthRedirectUrl(): string {
  const info = detectPlatform();
  return resolveOAuthCallback({
    native: info.isCapacitor || info.isNative,
    origin: typeof window === "undefined" ? undefined : window.location.origin,
    development: import.meta.env.DEV,
  });
}

export function isOAuthDeepLinkUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === `${APP_SCHEME}:`) {
      return u.hostname === "auth" && u.pathname === "/callback";
    }

    const project = readSupabaseProjectUrl();
    if (project) {
      const origin = new URL(project).origin;
      if (u.origin === origin && u.pathname.endsWith("/auth/v1/callback")) {
        return true;
      }
    }

    // Validate raw authority (URL.origin would discard explicit ports/userinfo).
    const rawAuthority = url.match(/^(https?:\/\/[^/?#]+)(?:[/?#]|$)/)?.[1];
    if (rawAuthority) {
      validateOAuthOrigin(rawAuthority, import.meta.env.DEV);
      return u.pathname === AUTH_CALLBACK_PATH;
    }
    return false;
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
