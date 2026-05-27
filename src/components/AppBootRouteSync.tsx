import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { logAppBoot, logAppBootSnapshot, ONBOARDING_ROUTE } from "@/lib/app-boot-log";
import { isOnboardingCompletedSync, isOnboardingHydrated } from "@/lib/onboarding-storage";
import type { StartupPath } from "@/lib/post-auth-navigation";
import { readBrowserPathname } from "@/lib/startup-path";

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
        if (currentRoute !== normalizedTarget) {
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
