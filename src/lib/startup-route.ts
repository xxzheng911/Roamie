import { AUTH_CALLBACK_PATH } from "@/constants/auth-redirect";
import { hasOAuthCallbackParams } from "@/lib/auth-oauth";
import { readPendingCallbackPath } from "@/lib/auth-oauth-deep-link";
import { isOnboardingCompletedSync } from "@/lib/onboarding-storage";
import type { StartupPath } from "@/lib/post-auth-navigation";

const SUPABASE_AUTH_STORAGE_KEY = "roamie-auth";

/** 本機是否可能有有效 Supabase session（不發網路；須含 user + 未過期 token） */
export function hasLikelyPersistedSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as {
      access_token?: string;
      expires_at?: number;
      user?: { id?: string };
    };
    if (!parsed?.access_token || !parsed?.user?.id) return false;
    if (typeof parsed.expires_at === "number") {
      const expiresMs = parsed.expires_at * 1000;
      if (expiresMs < Date.now() - 60_000) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** 冷啟動路由（僅讀本機狀態，避免卡在 Supabase 網路） */
export function resolveStartupPathFast(): StartupPath {
  if (!hasLikelyPersistedSession()) return "/login";
  if (!isOnboardingCompletedSync()) return "/welcome";
  return "/";
}

/**
 * Capacitor 冷啟動：在 React bundle 載入前把路徑導到正確入口，
 * 避免先進 `/_app` 的 beforeLoad 等網路而白屏。
 */
export function ensureColdStartPath(): void {
  if (typeof window === "undefined") return;

  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === AUTH_CALLBACK_PATH || hasOAuthCallbackParams()) return;
  if (readPendingCallbackPath()) return;
  if (path === "/login" || path.startsWith("/login/") || path === "/welcome" || path === "/trip") return;
  if (path.startsWith("/auth/")) return;

  const target = resolveStartupPathFast();
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = target === "/" ? "/" : target;
  if (current === next || current.startsWith(`${next}?`)) return;

  try {
    window.history.replaceState(window.history.state, "", next);
  } catch (e) {
    console.warn("[startup] ensureColdStartPath failed", e);
  }
}

export function markAppReady(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.roamieAppReady = "1";
}

export function isAppReady(): boolean {
  return document.documentElement.dataset.roamieAppReady === "1";
}
