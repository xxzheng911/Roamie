import { useEffect, useRef } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { logAppBoot, ONBOARDING_ROUTE } from "@/lib/app-boot-log";
import {
  getOnboardingStorageSource,
  isOnboardingCompletedSync,
  isOnboardingHydrated,
} from "@/lib/onboarding-storage";
import { getClientAuthSession } from "@/lib/auth-session";
import { blockHomeRedirectIfOnboardingIncomplete } from "@/lib/startup-navigation";

function isAuthCallbackPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path.startsWith("/auth/");
}

/**
 * 登入 / session restore 後仍可能觸發的導向，在此攔截並強制回教學頁。
 */
export function OnboardingRouteGuard() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const mountedRef = useRef(false);
  const lastBlockedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      logAppBoot("onboarding guard mounted", {
        currentRoute: pathname.replace(/\/+$/, "") || "/",
        onboardingHydrated: isOnboardingHydrated(),
        onboardingCompleted: isOnboardingHydrated() ? isOnboardingCompletedSync() : null,
      });
    }
  }, [pathname]);

  useEffect(() => {
    if (!isOnboardingHydrated()) return;

    const currentRoute = pathname.replace(/\/+$/, "") || "/";
    if (isOnboardingCompletedSync()) return;
    if (currentRoute === ONBOARDING_ROUTE || currentRoute === "/onboarding") return;
    if (isAuthCallbackPath(currentRoute)) return;
    if (lastBlockedRef.current === currentRoute) return;
    lastBlockedRef.current = currentRoute;

    const targetRoute = blockHomeRedirectIfOnboardingIncomplete(currentRoute, "/");

    void (async () => {
      const session = await getClientAuthSession().catch(() => null);
      console.log("[ONBOARDING_GUARD] blocked home redirect", {
        trigger: "OnboardingRouteGuard",
        currentRoute,
        targetRoute,
        onboardingCompleted: false,
        onboardingHydrated: true,
        storageSource: getOnboardingStorageSource(),
        sessionExists: Boolean(session?.user),
        authEvent: null,
      });
      await navigate({ to: targetRoute, replace: true });
    })();
  }, [navigate, pathname]);

  return null;
}
