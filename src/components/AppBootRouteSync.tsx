import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { logAppBoot, logAppBootSnapshot, ONBOARDING_ROUTE } from "@/lib/app-boot-log";
import { isOnboardingCompletedSync, isOnboardingHydrated } from "@/lib/onboarding-storage";
import type { StartupPath } from "@/lib/post-auth-navigation";
import { readBrowserPathname } from "@/lib/startup-path";

/** 已登入冷啟動若 URL 已在主殼層深連結，勿強制改寫為首頁（避免行程詳情等閃回 /） */
function shouldPreserveAppDeepLinkOnBoot(currentRoute: string, targetRoute: StartupPath): boolean {
  if (targetRoute !== "/") return false;
  const path = currentRoute.replace(/\/+$/, "") || "/";
  if (path === "/") return false;
  if (path === "/login" || path.startsWith("/login/")) return false;
  if (path === "/welcome" || path === "/onboarding") return false;
  if (path.startsWith("/auth/")) return false;
  const appPrefixes = [
    "/chat",
    "/map",
    "/plan",
    "/saved",
    "/place",
    "/profile",
    "/settings",
    "/trip",
    "/recommendations",
    "/preference-quiz",
    "/developer",
  ] as const;
  return appPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

type Props = {
  targetRoute: StartupPath;
  onApplied: () => void;
};

/**
 * 冷啟動：在 router 就緒後以 navigate(replace) 套用 boot 決策（不用 history.replaceState）。
 */
export function AppBootRouteSync({ targetRoute, onApplied }: Props) {
  const router = useRouter();
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;

    const currentRoute = readBrowserPathname();
    const normalizedTarget = targetRoute === "/" ? "/" : targetRoute;

    void (async () => {
      try {
        const preserveDeepLink = shouldPreserveAppDeepLinkOnBoot(currentRoute, normalizedTarget);
        if (preserveDeepLink) {
          logAppBoot("boot preserve deep link", {
            route: currentRoute,
            intended: normalizedTarget,
          });
        } else if (currentRoute !== normalizedTarget) {
          if (!isOnboardingHydrated() || !isOnboardingCompletedSync()) {
            console.log("[ONBOARDING_GUARD] boot redirect", {
              from: currentRoute,
              to: normalizedTarget,
              onboardingRoute: ONBOARDING_ROUTE,
            });
          }
          await router.navigate({ to: normalizedTarget, replace: true });
          await router.load({ sync: true });
        }

        logAppBoot("target route:", { route: readBrowserPathname(), intended: normalizedTarget });
        await logAppBootSnapshot(normalizedTarget);
      } finally {
        onApplied();
      }
    })();
  }, [router, targetRoute, onApplied]);

  return null;
}
