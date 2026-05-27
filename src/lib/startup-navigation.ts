import { getClientAuthSession } from "@/lib/auth-session";
import {
  getOnboardingStorageSource,
  isOnboardingCompletedSync,
  isOnboardingHydrated,
} from "@/lib/onboarding-storage";
import { hasLikelyPersistedSession } from "@/lib/startup-route";
import { ONBOARDING_ROUTE } from "@/lib/app-boot-log";
import { readBrowserPathname } from "@/lib/startup-path";
import type { StartupPath } from "@/lib/post-auth-navigation";

export type StartupNavigationSource =
  | "resolveStartupPath"
  | "resolveStartupPathFast"
  | "requireAppShellAccess"
  | "welcome-beforeLoad"
  | "welcome-complete"
  | "login-session-restore"
  | "auth-callback"
  | "auth-post-redirect"
  | "ensureColdStartPath"
  | "runStartupOnboardingGate";

/** 僅本機 onboarding 完成後才可進入主頁 */
export function canNavigateToHome(): boolean {
  return isOnboardingHydrated() && isOnboardingCompletedSync();
}

/**
 * 任何導向首頁前必須呼叫；未完成 onboarding 時回傳教學頁並印 log。
 */
export function blockHomeRedirectIfOnboardingIncomplete(
  currentRoute: string,
  attemptedRoute: string,
  source?: string,
): StartupPath {
  if (!isOnboardingHydrated() || !isOnboardingCompletedSync()) {
    const target = ONBOARDING_ROUTE;
    if (attemptedRoute === "/" || attemptedRoute.startsWith("/_app")) {
      console.log("[ONBOARDING_GUARD] blocked home redirect", {
        source: source ?? "blockHomeRedirectIfOnboardingIncomplete",
        currentRoute,
        attemptedRoute,
        targetRoute: target,
        onboardingCompleted: isOnboardingHydrated() ? isOnboardingCompletedSync() : false,
      });
    }
    return target;
  }
  return attemptedRoute as StartupPath;
}

export function isOnWelcomeRoute(): boolean {
  return readBrowserPathname() === "/welcome";
}

/**
 * 攔截任何自動導向主頁的請求；onboarding 未完成時一律改去 /welcome。
 */
export function guardStartupTarget(
  target: StartupPath,
  source: StartupNavigationSource,
): StartupPath {
  const currentRoute = readBrowserPathname();
  const onboardingCompleted = isOnboardingCompletedSync();
  const onboardingHydrated = isOnboardingHydrated();

  if (target === "/" && (!onboardingHydrated || !onboardingCompleted)) {
    const redirectedTo = ONBOARDING_ROUTE;
    console.log("[ONBOARDING_GUARD] blocked home redirect", {
      source,
      trigger: "guardStartupTarget",
      attemptedRoute: target,
      redirectedTo,
      currentRoute,
      onboardingCompleted,
      onboardingHydrated,
      storageSource: getOnboardingStorageSource(),
      reason: "onboarding_not_completed",
    });
    return redirectedTo;
  }

  console.info("[Startup Navigation Allowed]", {
    source,
    trigger: "guardStartupTarget",
    currentRoute,
    onboardingCompleted,
    onboardingHydrated,
    storageSource: getOnboardingStorageSource(),
    targetRoute: target,
  });

  return target;
}

export type StartupBootDecision = {
  phase: string;
  onboardingCompleted: boolean;
  isFirstLaunch?: boolean;
  hasSession?: boolean;
  authReady?: boolean;
  sessionExists?: boolean;
  devMode?: boolean;
  storageSource?: string;
  initialRoute: string;
  finalRoute: string;
  trigger: string;
};

export async function logStartupBootDecision(
  detail: Omit<StartupBootDecision, "authReady" | "sessionExists" | "devMode" | "storageSource"> &
    Partial<StartupBootDecision>,
): Promise<void> {
  if (typeof window === "undefined") return;

  const session = await getClientAuthSession().catch(() => null);
  const hasSession =
    detail.hasSession ??
    detail.sessionExists ??
    (hasLikelyPersistedSession() || Boolean(session?.user));

  console.info("[Startup Boot]", {
    ...detail,
    storageSource: detail.storageSource ?? getOnboardingStorageSource(),
    authReady: detail.authReady ?? isOnboardingHydrated(),
    sessionExists: hasSession,
    devMode: detail.devMode ?? import.meta.env.DEV,
  });
}

export async function logStartupNavigationContext(
  source: StartupNavigationSource,
  target: StartupPath,
  extra?: Record<string, unknown>,
): Promise<void> {
  const session = await getClientAuthSession().catch(() => null);

  console.info("[Startup Navigation Context]", {
    source,
    trigger: "logStartupNavigationContext",
    currentRoute: readBrowserPathname(),
    onboardingCompleted: isOnboardingCompletedSync(),
    onboardingHydrated: isOnboardingHydrated(),
    storageSource: getOnboardingStorageSource(),
    authReady: isOnboardingHydrated(),
    session: session?.user
      ? {
          userId: session.user.id,
          provider: session.user.app_metadata?.provider ?? null,
        }
      : null,
    sessionExists: Boolean(session?.user) || hasLikelyPersistedSession(),
    devMode: import.meta.env.DEV,
    targetRoute: target,
    ...extra,
  });
}
