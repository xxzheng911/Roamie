import { type ReactNode, useEffect, useState } from "react";
import { RoamieRoutePending } from "@/components/RoamieRoutePending";
import { AppBootRouteSync } from "@/components/AppBootRouteSync";
import { OnboardingRouteGuard } from "@/components/OnboardingRouteGuard";
import { logAppBoot } from "@/lib/app-boot-log";
import { detectPlatform } from "@/services/platform";
import {
  installDevOnboardingGlobals,
  isOnboardingCompletedSync,
  isOnboardingHydrated,
  loadOnboardingState,
} from "@/lib/onboarding-storage";
import { resolveStartupPathFast } from "@/lib/startup-route";
import type { StartupPath } from "@/lib/post-auth-navigation";
import {
  getBootGateState,
  getLastResolvedStartupTarget,
  hasResolvedStartup,
  isBootCompleted,
  isWelcomeBootSettled,
  logAppRemountSource,
  logNavSkipSameRoute,
  logOnboardingGateEffectSkip,
  markBootHydrated,
  markBootRouteSynced,
  markWelcomeBootSettled,
  shouldRunFullStartupBoot,
  shouldSkipStartupNavigation,
  tryStartOnboardingGateBoot,
} from "@/lib/startup-boot-state";
import { readBrowserPathname } from "@/lib/startup-path";

type Props = { children: ReactNode };

/**
 * App root gate（須包住整個 App 子樹，在 __root 的 App 內最外層）。
 * 未完成 onboarding 時不渲染子路由，並以 router.navigate 同步 /welcome。
 */
function shouldFastOpenHomeShell(): boolean {
  if (typeof window === "undefined") return false;
  const path = readBrowserPathname().replace(/\/+$/, "") || "/";
  if (path !== "/") return false;
  if (!isOnboardingCompletedSync()) return false;
  return isBootCompleted() || hasResolvedStartup();
}

export function OnboardingGate({ children }: Props) {
  const fastOpenHome = shouldFastOpenHomeShell();
  const initialGate = getBootGateState();
  const [hydrated, setHydrated] = useState(() => fastOpenHome || initialGate.hydrated);
  const [routeSynced, setRouteSynced] = useState(() => fastOpenHome || initialGate.routeSynced);
  const [bootTarget, setBootTarget] = useState<StartupPath>(
    () => initialGate.target ?? getLastResolvedStartupTarget() ?? "/welcome",
  );

  useEffect(() => {
    logAppRemountSource("OnboardingGate");

    const syncFromModuleState = () => {
      const gate = getBootGateState();
      if (gate.target) setBootTarget(gate.target);
      if (gate.hydrated) setHydrated(true);
      if (gate.routeSynced) setRouteSynced(true);
    };

    if (isBootCompleted() || isWelcomeBootSettled()) {
      logOnboardingGateEffectSkip(
        isWelcomeBootSettled() ? "welcome-boot-settled" : "boot-already-completed",
      );
      syncFromModuleState();
      return;
    }

    if (!tryStartOnboardingGateBoot()) {
      logOnboardingGateEffectSkip("boot-already-started");
      syncFromModuleState();
      return;
    }

    const pathNow = readBrowserPathname();
    if (
      (pathNow === "/welcome" || pathNow === "/onboarding") &&
      isOnboardingCompletedSync() === false &&
      isOnboardingHydrated()
    ) {
      markWelcomeBootSettled("/welcome");
      setBootTarget("/welcome");
      setHydrated(true);
      setRouteSynced(true);
      logOnboardingGateEffectSkip("welcome-idle-no-full-boot");
      return;
    }

    logAppBoot("onboarding gate mounted");
    const platform = detectPlatform();
    logAppBoot("platform:", {
      kind: platform.kind,
      isCapacitor: platform.isCapacitor,
      isIOS: platform.isIOS,
    });
    logAppBoot("current route:", { path: readBrowserPathname() });

    installDevOnboardingGlobals();

    let cancelled = false;
    void (async () => {
      await loadOnboardingState();
      const completed = isOnboardingCompletedSync();
      const target = resolveStartupPathFast();
      const current = readBrowserPathname();
      if (cancelled) return;

      markBootHydrated();
      setBootTarget(target);
      setHydrated(true);

      if (!shouldRunFullStartupBoot() || shouldSkipStartupNavigation(current, target)) {
        if (shouldSkipStartupNavigation(current, target)) {
          logNavSkipSameRoute({ source: "OnboardingGate", current, target });
        }
        if (!completed && (target === "/welcome" || target === "/onboarding")) {
          markWelcomeBootSettled("/welcome");
        } else {
          markBootRouteSynced(target, { onboardingCompleted: completed });
        }
        setRouteSynced(true);
        logAppBoot("onboarding gate ready", {
          targetRoute: target,
          onboardingCompleted: completed,
          skippedRouteSync: true,
        });
        return;
      }

      if (!completed) {
        console.log("[ONBOARDING_GUARD] boot redirect to onboarding", { target });
      }
      logAppBoot("onboarding gate ready", {
        targetRoute: target,
        onboardingCompleted: completed,
        skippedRouteSync: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const needsRouteSync = hydrated && !routeSynced;

  if (!hydrated || needsRouteSync) {
    return (
      <>
        {needsRouteSync ? (
          <AppBootRouteSync targetRoute={bootTarget} onApplied={() => setRouteSynced(true)} />
        ) : null}
        <RoamieRoutePending />
      </>
    );
  }

  return (
    <>
      <OnboardingRouteGuard />
      {children}
    </>
  );
}
