import { isOAuthProviderEnabled, type OAuthProvider } from "@/constants/auth";
import { supabase } from "@/lib/supabase";

export type { OAuthProvider };

/** OAuth callback 路徑（須在 Supabase Redirect URLs 白名單內） */
export const AUTH_CALLBACK_PATH = "/auth/callback";

const OAUTH_REDIRECT_KEY = "roamie:oauth-redirect-to";

/**
 * OAuth 回跳網址：一律用目前頁面 origin。
 * 電腦 http://localhost:8080 → …/auth/callback
 * 手機 http://192.168.x.x:8080 → …/auth/callback
 */
export function getAuthCallbackUrl(): string {
  if (typeof window === "undefined") return AUTH_CALLBACK_PATH;
  return `${window.location.origin}${AUTH_CALLBACK_PATH}`;
}

export function stashOAuthRedirectTarget(url: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(OAUTH_REDIRECT_KEY, url);
}

export function readStashedOAuthRedirectTarget(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(OAUTH_REDIRECT_KEY);
}

export function isAuthCallbackRoute(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname === AUTH_CALLBACK_PATH;
}

export function hasOAuthCallbackParams(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  const hash = window.location.hash || "";
  return (
    url.searchParams.has("code") ||
    url.searchParams.has("error") ||
    url.searchParams.has("error_description") ||
    hash.includes("access_token") ||
    hash.includes("error_description")
  );
}

export function stripOAuthParamsFromUrl(): void {
  if (typeof window === "undefined") return;
  window.history.replaceState({}, document.title, AUTH_CALLBACK_PATH);
}

/** 啟動 Google / Apple OAuth（全頁導向，保留 PKCE verifier 於 localStorage） */
export async function startOAuthSignIn(
  provider: OAuthProvider,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isOAuthProviderEnabled(provider)) {
    console.warn("[oauth] provider disabled", provider);
    return {
      ok: false,
      message:
        provider === "apple"
          ? "Apple 登入尚未開放，請使用 Google 登入。"
          : "此登入方式暫時無法使用。",
    };
  }

  const redirectTo = getAuthCallbackUrl();
  stashOAuthRedirectTarget(redirectTo);
  console.info("[oauth] start", provider, "redirectTo", redirectTo);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    console.error("[oauth] signInWithOAuth", error);
    return { ok: false, message: error.message };
  }

  if (!data?.url) {
    return { ok: false, message: "無法取得登入網址" };
  }

  window.location.replace(data.url);
  return { ok: true };
}
