import { AUTH_CALLBACK_PATH } from "@/constants/auth-redirect";
import { hasOAuthCallbackParams } from "@/lib/auth-oauth";
import { hasSelectedCompanionMode } from "@/lib/companion-mode-storage";
import type { StartupPath } from "@/lib/post-auth-navigation";

const SUPABASE_AUTH_STORAGE_KEY = "roamie-auth";

/** 本機是否可能有 Supabase session（不發網路請求） */
export function hasLikelyPersistedSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as {
      access_token?: string;
      expires_at?: number;
    };
    if (!parsed?.access_token) return false;
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
  if (!hasSelectedCompanionMode()) return "/welcome";
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
  if (path === "/login" || path === "/welcome" || path === "/trip") return;
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
