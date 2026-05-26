import { isOAuthProviderEnabled, type OAuthProvider } from "@/constants/auth";
import { signInWithAppleNative, canUseNativeAppleSignIn } from "@/lib/auth-apple-native";
import { completeSignInAfterAuth } from "@/lib/complete-sign-in";
import {
  AUTH_CALLBACK_PATH,
  formatSupabaseRedirectAllowListHint,
  getOAuthRedirectUrl,
} from "@/lib/auth-redirect";
import { assertSupabaseConfiguredForAuth } from "@/lib/supabase-project-url";
import {
  emitOAuthFlow,
  logAuthAuthorizeUrl,
  logAuthDebug,
  logAuthError,
  logAuthSessionResult,
  logAuthStart,
} from "@/lib/auth-debug";
import { detectPlatform } from "@/services/platform";
import { supabase } from "@/lib/supabase";

export type { OAuthProvider };

export type SignInResult = { ok: true } | { ok: false; message: string; cancelled?: boolean };

function isValidSupabaseAuthorizeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname.includes("/auth/v1/authorize");
  } catch {
    return false;
  }
}

function oauthConfigHint(): string {
  return `請在 Supabase Dashboard → Authentication → URL Configuration → Redirect URLs 加入：\n${formatSupabaseRedirectAllowListHint()}`;
}

/** OAuth callback 路徑（與 @/constants/auth-redirect 同步） */
export { AUTH_CALLBACK_PATH, OAUTH_DEEP_LINK_REDIRECT } from "@/lib/auth-redirect";

const OAUTH_REDIRECT_KEY = "roamie:oauth-redirect-to";

let browserListenerAttached = false;
let oauthReturnClosingBrowser = false;

async function closeOAuthBrowser(): Promise<void> {
  const platform = detectPlatform();
  if (!platform.isCapacitor) return;
  try {
    const { Browser } = await import("@capacitor/browser");
    oauthReturnClosingBrowser = true;
    await Browser.close();
    logAuthDebug("oauth.browser.close", {});
  } catch (e) {
    logAuthError("oauth.browser_close", e);
  }
}

function attachOAuthBrowserListener(): void {
  if (browserListenerAttached || typeof window === "undefined") return;
  const platform = detectPlatform();
  if (!platform.isCapacitor) return;

  browserListenerAttached = true;
  void import("@capacitor/browser").then(({ Browser }) => {
    void Browser.addListener("browserFinished", () => {
      if (oauthReturnClosingBrowser) {
        oauthReturnClosingBrowser = false;
        logAuthDebug("oauth.browser.finished", { withoutCallback: false, reason: "closed_by_return" });
        return;
      }
      logAuthDebug("oauth.browser.finished", { withoutCallback: true });
      emitOAuthFlow({ phase: "cancelled" });
    });
  });
}

/** @deprecated Use getOAuthRedirectUrl — kept for callers expecting web-style URL */
export function getAuthCallbackUrl(): string {
  return getOAuthRedirectUrl();
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
    hash.includes("error_description") ||
    hash.includes("error=")
  );
}

export function stripOAuthParamsFromUrl(): void {
  if (typeof window === "undefined") return;
  window.history.replaceState({}, document.title, AUTH_CALLBACK_PATH);
}

/**
 * 登入入口：iOS 原生 Apple；Google / Web Apple 走正式 OAuth（無 mock）。
 * 原生 Apple 成功後直接建立 session。
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<SignInResult> {
  logAuthStart(provider);

  if (provider === "apple" && canUseNativeAppleSignIn()) {
    const native = await signInWithAppleNative();
    if (!native.ok) {
      if (!native.cancelled) logAuthError("apple.native", native.message);
      return native;
    }
    try {
      await completeSignInAfterAuth();
      logAuthSessionResult(true, { provider: "apple", flow: "native" });
      return { ok: true };
    } catch (e) {
      logAuthError("apple.post_sign_in", e);
      const msg = e instanceof Error ? e.message : "登入後處理失敗";
      return { ok: false, message: msg };
    }
  }

  return startOAuthSignIn(provider);
}

/** 啟動 Google / Apple OAuth（正式 Supabase flow，保留 PKCE verifier 於 WebView localStorage） */
export async function startOAuthSignIn(
  provider: OAuthProvider,
): Promise<SignInResult> {
  const configError = assertSupabaseConfiguredForAuth();
  if (configError) {
    return { ok: false, message: configError };
  }

  const platform = detectPlatform();
  if (provider === "apple" && platform.isCapacitor && platform.isIOS) {
    return {
      ok: false,
      message:
        "iOS 請使用原生 Apple 登入（勿開瀏覽器 OAuth）。若按鈕無反應，請更新 App 後重試。",
    };
  }

  if (!isOAuthProviderEnabled(provider)) {
    logAuthSessionResult(false, { provider, reason: "provider_disabled" });
    return {
      ok: false,
      message:
        provider === "apple"
          ? "Apple 登入尚未開放，請使用 Google 登入。"
          : "此登入方式暫時無法使用。",
    };
  }

  const redirectTo = getOAuthRedirectUrl();
  stashOAuthRedirectTarget(redirectTo);
  attachOAuthBrowserListener();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    logAuthError("oauth.signInWithOAuth", error, { provider, redirectTo });
    return { ok: false, message: error.message };
  }

  if (!data?.url) {
    logAuthError("oauth.missing_url", new Error("no authorize url"), { provider });
    return { ok: false, message: "無法取得登入網址" };
  }

  console.error("OAUTH_OPEN_URL", {
    url: data?.url,
    provider,
    redirectTo,
    pathname: data?.url ? new URL(data.url).pathname : null,
    search: data?.url ? new URL(data.url).search : null,
  });

  if (!isValidSupabaseAuthorizeUrl(data.url)) {
    logAuthError("oauth.invalid_authorize_url", new Error(data.url), { provider, redirectTo });
    return {
      ok: false,
      message: `登入網址格式異常，請確認 Supabase 設定。\n${oauthConfigHint()}`,
    };
  }

  logAuthAuthorizeUrl(provider, data.url);

  if (platform.isCapacitor) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: data.url, presentationStyle: "fullscreen" });
      return { ok: true };
    } catch (e) {
      logAuthError("oauth.browser_open", e, { provider });
      return { ok: false, message: "無法開啟登入視窗，請稍後再試。" };
    }
  }

  window.location.replace(data.url);
  return { ok: true };
}

/** Deep link 處理完成後關閉系統瀏覽器 */
export async function finalizeOAuthBrowserReturn(): Promise<void> {
  await closeOAuthBrowser();
}
