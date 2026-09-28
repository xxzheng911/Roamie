import { APP_SCHEME } from "@/constants/app";

/** In-app route after OAuth deep link is opened in WebView */
export const AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * iOS / Android TestFlight & 原生殼層：Supabase `redirectTo` 與 Google OAuth 回 App 用。
 * 須加入 Supabase Dashboard → Authentication → Redirect URLs。
 */
export const OAUTH_DEEP_LINK_REDIRECT = `${APP_SCHEME}://auth/callback`;

/** 本機 Vite dev（僅瀏覽器／Capacitor live reload 用，非寫死正式網域） */
export const LOCAL_DEV_AUTH_CALLBACK = "http://localhost:8080/auth/callback";

/** Fixed production authority; never derived from unvalidated build configuration. */
export const PRODUCTION_AUTH_ORIGIN = "https://roamie.tw";
export const PRODUCTION_AUTH_CALLBACK = `${PRODUCTION_AUTH_ORIGIN}${AUTH_CALLBACK_PATH}`;

export function readOptionalWebAuthCallback(): string {
  return PRODUCTION_AUTH_CALLBACK;
}

export function suggestedSupabaseRedirectUrls(): string[] {
  return [OAUTH_DEEP_LINK_REDIRECT, LOCAL_DEV_AUTH_CALLBACK, PRODUCTION_AUTH_CALLBACK];
}
