import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Supabase 在未登入時 getUser() 常回傳此訊息 — 不應當成頁面錯誤 toast */
export function isAuthSessionMissingError(
  error: { message?: string } | string | null | undefined,
): boolean {
  const msg = typeof error === "string" ? error : (error?.message ?? "");
  return /auth session missing|session missing|not authenticated|invalid jwt/i.test(
    msg,
  );
}

function authSessionTimeoutMs(): number {
  if (typeof window === "undefined") return 4_000;
  const cap = (
    window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean };
    }
  ).Capacitor;
  // WKWebView + localStorage 在冷啟動常較慢；過短會誤判未登入並刷 warn
  return cap?.isNativePlatform?.() ? 10_000 : 4_000;
}

/** 讀取本機持久化 session（不呼叫 Auth server，避免 Auth session missing） */
export async function getClientAuthSession(): Promise<Session | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      (async () => {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          if (!isAuthSessionMissingError(error)) {
            console.warn("[auth-session] getSession", error.message);
          }
          return null;
        }
        return data.session ?? null;
      })(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          if (import.meta.env.DEV) {
            console.warn("[auth-session] getSession timed out — treating as signed out");
          }
          resolve(null);
        }, authSessionTimeoutMs());
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 未登入時回傳 null */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const session = await getClientAuthSession();
  return session?.user?.id ?? null;
}

/** 上傳 profile 圖片前必須通過 — 不使用訪客／匿名 */
export async function requireAuthenticatedUser(): Promise<{ id: string }> {
  const session = await getClientAuthSession();
  if (!session?.user) {
    throw new Error("請先登入後再上傳圖片");
  }
  return { id: session.user.id };
}

export function isDataUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("data:");
}

export function isHttpUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}
