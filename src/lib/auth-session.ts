import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const GUEST_FLAG_KEY = "roamie:guest";

export function readGuestFlag(): boolean {
  if (typeof window === "undefined") return false;
  return (
    localStorage.getItem(GUEST_FLAG_KEY) === "1" ||
    sessionStorage.getItem(GUEST_FLAG_KEY) === "1"
  );
}

/** Supabase 在未登入時 getUser() 常回傳此訊息 — 不應當成頁面錯誤 toast */
export function isAuthSessionMissingError(
  error: { message?: string } | string | null | undefined,
): boolean {
  const msg = typeof error === "string" ? error : (error?.message ?? "");
  return /auth session missing|session missing|not authenticated|invalid jwt/i.test(
    msg,
  );
}

export function writeGuestFlag(enabled: boolean): void {
  if (typeof window === "undefined") return;
  if (enabled) {
    localStorage.setItem(GUEST_FLAG_KEY, "1");
    sessionStorage.setItem(GUEST_FLAG_KEY, "1");
    return;
  }
  localStorage.removeItem(GUEST_FLAG_KEY);
  sessionStorage.removeItem(GUEST_FLAG_KEY);
}

/** 讀取本機持久化 session（不呼叫 Auth server，避免 Auth session missing） */
export async function getClientAuthSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    if (!isAuthSessionMissingError(error)) {
      console.warn("[auth-session] getSession", error.message);
    }
    return null;
  }
  return data.session ?? null;
}

/** 訪客模式或未登入時回傳 null — 避免寫入 Supabase */
export async function getAuthenticatedUserId(): Promise<string | null> {
  if (readGuestFlag()) return null;
  const session = await getClientAuthSession();
  return session?.user?.id ?? null;
}

/** 上傳 profile 圖片前必須通過 — 不使用訪客／匿名 */
export async function requireAuthenticatedUser(): Promise<{ id: string }> {
  if (readGuestFlag()) {
    throw new Error("請先登入後再上傳圖片");
  }
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
