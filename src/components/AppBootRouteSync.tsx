import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { logAppBoot, logAppBootSnapshot, ONBOARDING_ROUTE } from "@/lib/app-boot-log";
import { isOnboardingCompletedSync, isOnboardingHydrated } from "@/lib/onboarding-storage";
import type { StartupPath } from "@/lib/post-auth-navigation";
import {
  isBootCompleted,
  logNavSkipSameRoute,
  logOnboardingGateEffectSkip,
  markBootRouteSynced,
  shouldSkipStartupNavigation,
  tryStartBootRouteSync,
} from "@/lib/startup-boot-state";
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
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  useEffect(() => {
    const normalizedTarget = targetRoute === "/" ? "/" : targetRoute;
    const currentRoute = readBrowserPathname();

    const finish = () => {
      markBootRouteSynced(normalizedTarget, {
        onboardingCompleted: isOnboardingCompletedSync(),
      });
      onAppliedRef.current();
    };

    if (shouldSkipStartupNavigation(currentRoute, normalizedTarget)) {
      logNavSkipSameRoute({ source: "AppBootRouteSync", current: currentRoute, target: normalizedTarget });
      finish();
      return;
    }

    if (isBootCompleted()) {
      logOnboardingGateEffectSkip("boot-route-sync-already-completed", { target: normalizedTarget });
      finish();
      return;
    }

    if (!tryStartBootRouteSync()) {
      logOnboardingGateEffectSkip("boot-route-sync-already-started", { target: normalizedTarget });
      finish();
      return;
    }

    void (async () => {
      try {
        if (!isOnboardingHydrated() || !isOnboardingCompletedSync()) {
          console.log("[ONBOARDING_GUARD] boot redirect", {
            from: currentRoute,
            to: normalizedTarget,
            onboardingRoute: ONBOARDING_ROUTE,
          });
        }
        await router.navigate({ to: normalizedTarget, replace: true });
        await router.load({ sync: true });

        logAppBoot("target route:", {
          route: readBrowserPathname(),
          intended: normalizedTarget,
        });
        await logAppBootSnapshot(normalizedTarget);
      } finally {
        finish();
      }
    })();
  }, [router, targetRoute]);

  return null;
}
