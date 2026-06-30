import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  logAuthSessionFound,
  logAuthSessionMissing,
} from "@/lib/auth-boot-log";
import { hasLikelyPersistedSession } from "@/lib/startup-route";
import {
  readHydratedAuthSessionRaw,
  warmSupabaseAuthStorage,
} from "@/lib/supabase-auth-storage";
import { detectPlatform } from "@/services/platform";

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
  return cap?.isNativePlatform?.() ? 12_000 : 4_000;
}

type GetClientAuthSessionOptions = {
  timeoutMs?: number;
  skipWarm?: boolean;
};

let cachedClientSession: Session | null | undefined;
let cachedClientSessionAt = 0;
const CLIENT_SESSION_CACHE_MS = 30_000;

export function invalidateClientAuthSessionCache(): void {
  cachedClientSession = undefined;
  cachedClientSessionAt = 0;
}

/** AuthProvider / sign-in 成功後同步快取，避免 gate 讀到過期的 null */
export function updateClientAuthSessionCache(session: Session | null): void {
  if (session?.user) {
    cachedClientSession = session;
    cachedClientSessionAt = Date.now();
    return;
  }
  invalidateClientAuthSessionCache();
}

async function readClientAuthSessionOnce(timeoutMs: number): Promise<Session | null> {
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
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 讀取本機持久化 session（不呼叫 Auth server，避免 Auth session missing） */
export async function getClientAuthSession(
  options?: GetClientAuthSessionOptions,
): Promise<Session | null> {
  const now = Date.now();
  if (
    !options?.skipWarm &&
    cachedClientSession !== undefined &&
    now - cachedClientSessionAt < CLIENT_SESSION_CACHE_MS
  ) {
    return cachedClientSession;
  }

  const timeoutMs = options?.timeoutMs ?? authSessionTimeoutMs();

  if (typeof window !== "undefined" && detectPlatform().isCapacitor && !options?.skipWarm) {
    await warmSupabaseAuthStorage();
  }

  const session = await readClientAuthSessionOnce(timeoutMs);
  if (session?.user) {
    logAuthSessionFound({
      userId: session.user.id,
      provider: session.user.app_metadata?.provider ?? null,
    });
    cachedClientSession = session;
    cachedClientSessionAt = Date.now();
    return session;
  }

  if (typeof window !== "undefined" && detectPlatform().isCapacitor && hasLikelyPersistedSession()) {
    await warmSupabaseAuthStorage();
    const retry = await readClientAuthSessionOnce(Math.max(timeoutMs, 12_000));
    if (retry?.user) {
      logAuthSessionFound({
        userId: retry.user.id,
        provider: retry.user.app_metadata?.provider ?? null,
        retry: true,
      });
      cachedClientSession = retry;
      cachedClientSessionAt = Date.now();
      return retry;
    }
  }

  const hadPersistedHint = hasLikelyPersistedSession();
  logAuthSessionMissing({
    hadPersistedHint,
  });
  // 勿快取 timeout 造成的 false negative；本機仍有 token 時下次應重試
  if (!hadPersistedHint) {
    cachedClientSession = null;
    cachedClientSessionAt = Date.now();
  } else {
    cachedClientSession = undefined;
  }
  return null;
}

/** 同步讀取本機已 hydrate 的 user id（不發網路、不 await auth bridge） */
export function readCachedAuthenticatedUserIdSync(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      readHydratedAuthSessionRaw() ??
      globalThis.localStorage?.getItem("roamie-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: { id?: string } };
    return parsed?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** 未登入時回傳 null */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const session = await getClientAuthSession();
  return session?.user?.id ?? null;
}

/** 須已登入；未登入時拋錯（正式流程不使用訪客 session） */
export async function requireAuthenticatedUserId(): Promise<string> {
  const id = await getAuthenticatedUserId();
  if (!id) throw new Error("請先登入");
  return id;
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
