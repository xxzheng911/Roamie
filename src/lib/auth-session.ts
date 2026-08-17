import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  logAuthRestoreSettled,
  logAuthSessionFound,
  logAuthSessionMissing,
} from "@/lib/auth-boot-log";
import { authRestoreTimeoutMs } from "@/lib/auth-restore";
import { hasLikelyPersistedSession } from "@/lib/startup-route";
import {
  clearPersistedAuthSession,
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

export function markClientAuthSessionSettledUnauthenticated(): void {
  cachedClientSession = null;
  cachedClientSessionAt = Date.now();
}

/** AuthProvider / sign-in 成功後同步快取，避免 gate 讀到過期的 null */
export function updateClientAuthSessionCache(session: Session | null): void {
  if (session?.user) {
    cachedClientSession = session;
    cachedClientSessionAt = Date.now();
    return;
  }
  // INITIAL_SESSION null must not cache unauthenticated before restore finishes,
  // and must not undo a settled unauthenticated restore.
  if (cachedClientSession === null) return;
  invalidateClientAuthSessionCache();
}

async function readClientAuthSessionOnce(timeoutMs: number): Promise<Session | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      (async () => {
        try {
          const { data, error } = await supabase.auth.getSession();
          if (error) {
            if (!isAuthSessionMissingError(error)) {
              console.warn("[auth-session] getSession", error.message);
            }
            return null;
          }
          return data.session ?? null;
        } catch (e) {
          console.warn("[auth-session] getSession threw", e);
          return null;
        }
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

async function settleUnauthenticatedRestore(detail: {
  hadPersistedHint: boolean;
  reason: string;
}): Promise<null> {
  logAuthSessionMissing({
    hadPersistedHint: detail.hadPersistedHint,
    reason: detail.reason,
  });
  if (detail.hadPersistedHint) {
    await clearPersistedAuthSession();
  }
  markClientAuthSessionSettledUnauthenticated();
  logAuthRestoreSettled({
    outcome: "unauthenticated",
    reason: detail.reason,
    hadPersistedHint: detail.hadPersistedHint,
    clearedPersistedAuth: detail.hadPersistedHint,
  });
  return null;
}

let restoreInFlight: Promise<Session | null> | null = null;

async function restoreClientAuthSession(
  options?: GetClientAuthSessionOptions,
): Promise<Session | null> {
  const isNative = typeof window !== "undefined" && detectPlatform().isCapacitor;
  const timeoutMs = options?.timeoutMs ?? authRestoreTimeoutMs(isNative);

  if (typeof window !== "undefined" && isNative && !options?.skipWarm) {
    await warmSupabaseAuthStorage();
  }

  const hadPersistedHint = hasLikelyPersistedSession();
  const session = await readClientAuthSessionOnce(timeoutMs);
  if (session?.user) {
    logAuthSessionFound({
      userId: session.user.id,
      provider: session.user.app_metadata?.provider ?? null,
    });
    cachedClientSession = session;
    cachedClientSessionAt = Date.now();
    logAuthRestoreSettled({
      outcome: "authenticated",
      userId: session.user.id,
    });
    return session;
  }

  return settleUnauthenticatedRestore({
    hadPersistedHint,
    reason: hadPersistedHint ? "restore-failed-or-timeout" : "no-persisted-session",
  });
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

  if (restoreInFlight) return restoreInFlight;

  restoreInFlight = restoreClientAuthSession(options).finally(() => {
    restoreInFlight = null;
  });
  return restoreInFlight;
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
