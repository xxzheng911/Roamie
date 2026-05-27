import { AUTH_CALLBACK_PATH } from "@/constants/auth-redirect";
import { hasOAuthCallbackParams } from "@/lib/auth-oauth";
import { readPendingCallbackPath } from "@/lib/auth-oauth-deep-link";
import {
  isOnboardingCompletedSync,
  isOnboardingHydrated,
  loadOnboardingState,
} from "@/lib/onboarding-storage";
import type { StartupPath } from "@/lib/post-auth-navigation";
import {
  guardStartupTarget,
  logStartupBootDecision,
  logStartupNavigationContext,
} from "@/lib/startup-navigation";
import { readBrowserPathname } from "@/lib/startup-path";

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

/**
 * 冷啟動路由（須在 loadOnboardingState 之後呼叫）。
 * onboarding 未完成時一律 /welcome，不受 session / dev 影響。
 */
export function resolveStartupPathFast(): StartupPath {
  if (!isOnboardingHydrated()) {
    console.warn("[Startup][fast] onboarding not hydrated — defaulting to /welcome");
    return "/welcome";
  }

  const onboardingCompleted = isOnboardingCompletedSync();
  const isFirstLaunch = !onboardingCompleted;
  const hasSession = hasLikelyPersistedSession();
  const rawNext: StartupPath = !onboardingCompleted ? "/welcome" : !hasSession ? "/login" : "/";
  const next = guardStartupTarget(rawNext, "resolveStartupPathFast");

  if (typeof window !== "undefined") {
    void logStartupBootDecision({
      phase: "resolveStartupPathFast",
      onboardingCompleted,
      isFirstLaunch,
      hasSession,
      initialRoute: readBrowserPathname(),
      finalRoute: next,
      trigger: "resolveStartupPathFast",
    });
    void logStartupNavigationContext("resolveStartupPathFast", next);
  }

  return next;
}

/**
 * 在 loadOnboardingState 完成後，把 URL 導到正確冷啟動入口。
 * 須在 OnboardingHydrationGate 內呼叫，不可在 router 建立前呼叫。
 */
export function ensureColdStartPath(): void {
  if (typeof window === "undefined") return;
  if (!isOnboardingHydrated()) {
    console.warn("[Startup] ensureColdStartPath skipped — await loadOnboardingState first");
    return;
  }

  const path = readBrowserPathname();
  if (path === AUTH_CALLBACK_PATH || hasOAuthCallbackParams()) return;
  if (readPendingCallbackPath()) return;
  if (path === "/login" || path.startsWith("/login/") || path === "/welcome" || path === "/trip")
    return;
  if (path.startsWith("/auth/")) return;

  const target = resolveStartupPathFast();
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = target === "/" ? "/" : target;
  if (current === next || current.startsWith(`${next}?`)) {
    void logStartupBootDecision({
      phase: "ensureColdStartPath",
      onboardingCompleted: isOnboardingCompletedSync(),
      hasSession: hasLikelyPersistedSession(),
      initialRoute: path,
      finalRoute: path,
      trigger: "ensureColdStartPath:no-op",
    });
    return;
  }

  void logStartupBootDecision({
    phase: "ensureColdStartPath",
    onboardingCompleted: isOnboardingCompletedSync(),
    hasSession: hasLikelyPersistedSession(),
    initialRoute: path,
    finalRoute: next,
    trigger: "ensureColdStartPath:history.replaceState",
  });

  console.info("[Startup Navigation Trigger]", {
    source: "ensureColdStartPath",
    trigger: "ensureColdStartPath",
    currentRoute: path,
    onboardingCompleted: isOnboardingCompletedSync(),
    targetRoute: next,
  });

  try {
    window.history.replaceState(window.history.state, "", next);
  } catch (e) {
    console.warn("[startup] ensureColdStartPath failed", e);
  }
}

/** @deprecated 請用 OnboardingHydrationGate + AppBootRouteSync */
export async function runStartupOnboardingGate(): Promise<boolean> {
  return loadOnboardingState();
}

export { hydrateOnboardingStatus } from "@/lib/onboarding-storage";

export function markAppReady(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.roamieAppReady = "1";
}

export function isAppReady(): boolean {
  return document.documentElement.dataset.roamieAppReady === "1";
}
