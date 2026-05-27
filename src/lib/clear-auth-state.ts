import { Preferences } from "@capacitor/preferences";
import { clearPendingCallbackPath, OAUTH_PENDING_CALLBACK_KEY } from "@/lib/auth-oauth-deep-link";
import { clearOAuthCodeConsumedMarker } from "@/lib/oauth-callback-guard";
import { invalidateAppShellGateCache } from "@/lib/app-shell-gate";
import { clearAuthMemoryCache } from "@/lib/supabase-auth-storage";
import { clearCompanionModeSelection } from "@/lib/companion-mode-storage";
import { supabase } from "@/lib/supabase";
import { detectPlatform } from "@/services/platform";

const SUPABASE_AUTH_STORAGE_KEY = "roamie-auth";
const PREF_PREFIX = "roamie.supabase.auth.";
const NATIVE_CLEAR_TIMEOUT_MS = 3_000;

/** 本機未登入時的暫存資料（舊稱 guest cache；正式流程 OAuth 失敗時會清除） */
const LOCAL_DEVICE_CACHE_KEYS = [
  "roamie:user-profile",
  "roamie:profile-settings",
  "roamie:preferences",
  "roamie:places",
  "roamie:itineraries",
  "roamie:recommendations",
  "roamie:chat",
] as const;

const OAUTH_TRANSIENT_SESSION_KEYS = [
  "roamie:oauth-redirect-to",
  OAUTH_PENDING_CALLBACK_KEY,
] as const;

export function logAuthFlowMarker(marker: string, detail?: Record<string, unknown>): void {
  if (detail && Object.keys(detail).length > 0) {
    console.info(marker, detail);
    return;
  }
  console.info(marker);
}

function clearWebStorageAuthKeys(): void {
  if (typeof window === "undefined") return;

  const shouldRemove = (key: string) =>
    key === SUPABASE_AUTH_STORAGE_KEY ||
    key.startsWith(SUPABASE_AUTH_STORAGE_KEY) ||
    key.startsWith(PREF_PREFIX) ||
    (LOCAL_DEVICE_CACHE_KEYS as readonly string[]).includes(key) ||
    (OAUTH_TRANSIENT_SESSION_KEYS as readonly string[]).includes(key);

  for (const storage of [localStorage, sessionStorage]) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && shouldRemove(key)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    } catch {
      // ignore quota / private mode
    }
  }
}

async function clearNativePreferencesAuthKeys(): Promise<void> {
  const platform = detectPlatform();
  if (!platform.isCapacitor) return;

  try {
    const { keys } = await Preferences.keys();
    const authKeys = keys.filter(
      (key) => key.startsWith(PREF_PREFIX) || key === `${PREF_PREFIX}${SUPABASE_AUTH_STORAGE_KEY}`,
    );
    await Promise.all(authKeys.map((key) => Preferences.remove({ key })));
  } catch (e) {
    console.warn("[Clear Auth State] Preferences cleanup failed", e);
  }
}

/** 清除本機未登入暫存（舊 guest / local-only profile 資料） */
export function clearLocalDeviceCaches(): void {
  if (typeof window === "undefined") return;
  for (const key of LOCAL_DEVICE_CACHE_KEYS) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  logAuthFlowMarker("[Guest State Cleared]");
}

export type ClearAuthStateOptions = {
  reason?: string;
  /**
   * 僅 dev reset 使用。登出 / OAuth 失敗預設不清 onboarding（避免重看教學）。
   */
  clearCompanionMode?: boolean;
};

/** 同步清除（不等待 native bridge / signOut）— 按鈕回登入頁必須先跑這段 */
export function clearAuthStateSync(options: ClearAuthStateOptions = {}): void {
  invalidateAppShellGateCache();
  clearAuthMemoryCache();
  clearWebStorageAuthKeys();
  clearLocalDeviceCaches();
  clearPendingCallbackPath();
  clearOAuthCodeConsumedMarker();
  if (options.clearCompanionMode === true) {
    clearCompanionModeSelection();
    void import("@/lib/onboarding-storage").then(({ clearOnboardingCompleted }) =>
      clearOnboardingCompleted(),
    );
  }
}

async function clearAuthStateAsync(): Promise<void> {
  try {
    await Promise.race([
      (async () => {
        await supabase.auth.signOut({ scope: "local" });
        await clearNativePreferencesAuthKeys();
      })(),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, NATIVE_CLEAR_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    console.warn("[Clear Auth State] async cleanup failed", e);
  }
}

/**
 * 完整清除登入狀態：Supabase session、PKCE、OAuth 暫存、本機 profile 快取。
 * 正式流程 OAuth 失敗與「返回登入」必須呼叫此函式。
 */
export async function clearAuthState(options: ClearAuthStateOptions = {}): Promise<void> {
  logAuthFlowMarker("[Clear Auth State]", { reason: options.reason ?? "unspecified" });
  clearAuthStateSync(options);
  await clearAuthStateAsync();
}

export type ResetToLoginOptions = {
  reason?: string;
  /** TanStack router navigate — Capacitor 上優先於 location.replace */
  navigate?: (opts: { to: string; replace?: boolean }) => void | Promise<void>;
};

function normalizeLoginPath(): string {
  return "/login";
}

function isOnLoginPath(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/login" || path.startsWith("/login/");
}

function isStuckOffLoginPath(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path.startsWith("/auth/") || path === "/welcome" || path === "/";
}

async function enableIosLoginInteraction(): Promise<void> {
  const platform = detectPlatform();
  if (!platform.isCapacitor || !platform.isIOS) return;
  const { ensureIosLoginLiveInteraction, notifyIosOAuthReturn, scheduleIosSnapshotRefreshBurst } =
    await import("@/lib/ios-snapshot-bridge");
  notifyIosOAuthReturn();
  ensureIosLoginLiveInteraction();
  scheduleIosSnapshotRefreshBurst("reset-to-login");
}

/** 先導向登入頁（不阻塞），再背景清除 — 避免 Preferences / signOut 卡住按鈕 */
export async function resetToLoginScreen(options?: ResetToLoginOptions | string): Promise<void> {
  const opts: ResetToLoginOptions =
    typeof options === "string" ? { reason: options } : (options ?? {});
  const reason = opts.reason ?? "reset-to-login";

  clearAuthStateSync({ reason, clearCompanionMode: false });
  await enableIosLoginInteraction();

  logAuthFlowMarker("[Navigate Reset To Login]", { reason });

  if (typeof window === "undefined") return;

  const loginPath = normalizeLoginPath();

  if (opts.navigate) {
    try {
      await opts.navigate({ to: loginPath, replace: true });
    } catch (e) {
      console.warn("[resetToLogin] router navigate failed", e);
    }
  } else {
    try {
      const { navigateOAuthAppPath } = await import("@/lib/oauth-app-navigate");
      await navigateOAuthAppPath(loginPath);
    } catch (e) {
      console.warn("[resetToLogin] oauth navigate failed", e);
    }
  }

  if (!isOnLoginPath()) {
    try {
      window.history.replaceState(window.history.state, "", loginPath);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      // ignore
    }
  }

  window.setTimeout(() => {
    if (isStuckOffLoginPath()) {
      window.location.replace(`${window.location.origin}${loginPath}`);
    } else if (isOnLoginPath()) {
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, 350);

  void clearAuthStateAsync();
}
