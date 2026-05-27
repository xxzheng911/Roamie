import { Preferences } from "@capacitor/preferences";
import type { SupportedStorage } from "@supabase/supabase-js";
import { waitForCapacitorBridge } from "@/lib/capacitor-bridge-ready";
import { detectPlatform } from "@/services/platform";

const PREF_PREFIX = "roamie.supabase.auth.";
const SUPABASE_STORAGE_KEY = "roamie-auth";
export const SUPABASE_PKCE_VERIFIER_KEY = `${SUPABASE_STORAGE_KEY}-code-verifier`;

function isNativeCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    }
  ).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  const platform = cap?.getPlatform?.();
  return platform === "ios" || platform === "android";
}

function prefKey(key: string): string {
  return `${PREF_PREFIX}${key}`;
}

/** In-memory layer so PKCE read/write never blocks on Capacitor Preferences bridge. */
const memoryCache = new Map<string, string>();

export function clearAuthMemoryCache(): void {
  memoryCache.clear();
}

let preferencesBridgeReady = false;

function readLocal(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // ignore
  }
}

function removeLocal(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // ignore
  }
}

async function ensurePreferencesBridge(): Promise<boolean> {
  if (preferencesBridgeReady) return true;
  preferencesBridgeReady = await waitForCapacitorBridge(8_000);
  return preferencesBridgeReady;
}

/** Awaitable persist for PKCE verifier before leaving app for OAuth browser */
async function persistToPreferences(key: string, value: string | null): Promise<void> {
  const ready = await ensurePreferencesBridge();
  if (!ready) return;
  try {
    if (value === null) {
      await Preferences.remove({ key: prefKey(key) });
    } else {
      await Preferences.set({ key: prefKey(key), value });
    }
  } catch (e) {
    console.warn("[auth-storage] Preferences persist failed", key, e);
  }
}

/** Fire-and-forget — must not block signInWithOAuth / PKCE */
function schedulePreferencesPersist(key: string, value: string | null): void {
  void (async () => {
    const ready = await ensurePreferencesBridge();
    if (!ready) return;
    try {
      if (value === null) {
        await Preferences.remove({ key: prefKey(key) });
      } else {
        await Preferences.set({ key: prefKey(key), value });
      }
    } catch (e) {
      console.warn("[auth-storage] Preferences persist failed", key, e);
    }
  })();
}

/**
 * Durable auth storage for Capacitor native.
 * PKCE verifier writes go to memory + localStorage immediately; Preferences syncs async.
 * Avoids `Preferences.then() is not implemented on ios` and signInWithOAuth hangs.
 */
function createCapacitorAuthStorage(): SupportedStorage {
  return {
    getItem: async (key: string) => {
      const cached = memoryCache.get(key);
      if (cached != null) return cached;

      const local = readLocal(key);
      if (local != null) {
        memoryCache.set(key, local);
        return local;
      }

      const ready = await ensurePreferencesBridge();
      if (!ready) return null;

      try {
        const { value } = await Preferences.get({ key: prefKey(key) });
        if (value != null) {
          memoryCache.set(key, value);
          writeLocal(key, value);
        }
        return value;
      } catch (e) {
        console.warn("[auth-storage] Preferences.get failed", key, e);
        return null;
      }
    },
    setItem: async (key: string, value: string) => {
      memoryCache.set(key, value);
      writeLocal(key, value);
      schedulePreferencesPersist(key, value);
    },
    removeItem: async (key: string) => {
      memoryCache.delete(key);
      removeLocal(key);
      schedulePreferencesPersist(key, null);
    },
  };
}

/** Call after Capacitor bridge is up (app init / login mount). */
export async function warmSupabaseAuthStorage(): Promise<void> {
  if (!isNativeCapacitor()) return;
  await ensurePreferencesBridge();
}

/** 開啟 OAuth 瀏覽器前：把 PKCE verifier 寫入 localStorage + Preferences（避免 ASWeb 回來後 memory 被清） */
export async function persistOAuthPkceVerifier(): Promise<boolean> {
  const verifier =
    memoryCache.get(SUPABASE_PKCE_VERIFIER_KEY) ?? readLocal(SUPABASE_PKCE_VERIFIER_KEY);
  if (!verifier) {
    console.warn("[auth-storage] PKCE verifier missing before OAuth browser");
    return false;
  }
  memoryCache.set(SUPABASE_PKCE_VERIFIER_KEY, verifier);
  writeLocal(SUPABASE_PKCE_VERIFIER_KEY, verifier);
  if (isNativeCapacitor()) {
    await persistToPreferences(SUPABASE_PKCE_VERIFIER_KEY, verifier);
  }
  logAuthStorageDebug("pkce.persisted", { hasVerifier: true });
  return true;
}

/** exchangeCodeForSession 前再從 Preferences 還原 verifier */
export async function restoreOAuthPkceVerifier(): Promise<boolean> {
  const fromMemory = memoryCache.get(SUPABASE_PKCE_VERIFIER_KEY);
  const fromLocal = readLocal(SUPABASE_PKCE_VERIFIER_KEY);
  if (fromMemory ?? fromLocal) {
    const value = fromMemory ?? fromLocal!;
    memoryCache.set(SUPABASE_PKCE_VERIFIER_KEY, value);
    writeLocal(SUPABASE_PKCE_VERIFIER_KEY, value);
    return true;
  }
  if (!isNativeCapacitor()) return false;
  const ready = await ensurePreferencesBridge();
  if (!ready) return false;
  try {
    const { value } = await Preferences.get({ key: prefKey(SUPABASE_PKCE_VERIFIER_KEY) });
    if (!value) return false;
    memoryCache.set(SUPABASE_PKCE_VERIFIER_KEY, value);
    writeLocal(SUPABASE_PKCE_VERIFIER_KEY, value);
    logAuthStorageDebug("pkce.restored", { from: "preferences" });
    return true;
  } catch (e) {
    console.warn("[auth-storage] PKCE restore failed", e);
    return false;
  }
}

function logAuthStorageDebug(phase: string, payload: Record<string, unknown>): void {
  console.info(`[auth-storage] ${phase}`, payload);
}

export function createSupabaseAuthStorage(): SupportedStorage | undefined {
  if (typeof window === "undefined") return undefined;
  if (isNativeCapacitor() || detectPlatform().isCapacitor) {
    return createCapacitorAuthStorage();
  }
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
