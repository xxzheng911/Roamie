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

/**
 * 正式 Web 網域（選用）：有值時才加入允許清單建議。
 * 未設定時不 fallback 任何 production URL。
 */
export function readOptionalWebAuthCallback(): string | null {
  const origin = import.meta.env.VITE_APP_ORIGIN as string | undefined;
  if (!origin?.trim()) return null;
  return `${origin.replace(/\/$/, "")}${AUTH_CALLBACK_PATH}`;
}

/** 建議在 Supabase 後台加入的 Redirect URLs（不含尚未決定的正式網域） */
export function suggestedSupabaseRedirectUrls(): string[] {
  const urls = [
    OAUTH_DEEP_LINK_REDIRECT,
    `${APP_SCHEME}://localhost`,
    "capacitor://localhost",
    LOCAL_DEV_AUTH_CALLBACK,
  ];
  const web = readOptionalWebAuthCallback();
  if (web) {
    urls.push(web);
    try {
      const origin = new URL(web).origin;
      urls.push(origin);
    } catch {
      /* ignore */
    }
  }
  return [...new Set(urls)];
}
