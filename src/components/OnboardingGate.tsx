import { type ReactNode, useEffect, useState } from "react";
import { RoamieRoutePending } from "@/components/RoamieRoutePending";
import { AppBootRouteSync } from "@/components/AppBootRouteSync";
import { OnboardingRouteGuard } from "@/components/OnboardingRouteGuard";
import { logAppBoot } from "@/lib/app-boot-log";
import { detectPlatform } from "@/services/platform";
import {
  installDevOnboardingGlobals,
  isOnboardingCompletedSync,
  loadOnboardingState,
} from "@/lib/onboarding-storage";
import { resolveStartupPathFast } from "@/lib/startup-route";
import type { StartupPath } from "@/lib/post-auth-navigation";
import { ensureIosLoginLiveInteraction } from "@/lib/ios-snapshot-bridge";
import { dismissExternalBootSplash } from "@/main";
import { readBrowserPathname } from "@/lib/startup-path";

const BOOT_GATE_MAX_MS = 15_000;

type Props = { children: ReactNode };

/**
 * App root gate（須包住整個 App 子樹，在 __root 的 App 內最外層）。
 * 未完成 onboarding 時不渲染子路由，並以 router.navigate 同步 /welcome。
 */
export function OnboardingGate({ children }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [routeSynced, setRouteSynced] = useState(false);
  const [bootTarget, setBootTarget] = useState<StartupPath>("/welcome");

  useEffect(() => {
    logAppBoot("onboarding gate mounted");
    const platform = detectPlatform();
    logAppBoot("platform:", {
      kind: platform.kind,
      isCapacitor: platform.isCapacitor,
      isIOS: platform.isIOS,
    });
    logAppBoot("current route:", { path: readBrowserPathname() });

    installDevOnboardingGlobals();

    if (platform.isCapacitor && platform.isIOS) {
      ensureIosLoginLiveInteraction();
    }

    let cancelled = false;
    void (async () => {
      await loadOnboardingState();
      const completed = isOnboardingCompletedSync();
      const target = resolveStartupPathFast();
      if (cancelled) return;
      setBootTarget(target);
      setHydrated(true);
      if (!completed) {
        console.log("[ONBOARDING_GUARD] boot redirect to onboarding", { target });
      }
      logAppBoot("onboarding gate ready", {
        targetRoute: target,
        onboardingCompleted: completed,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (routeSynced) {
      dismissExternalBootSplash();
      return;
    }
    const timer = window.setTimeout(() => {
      console.warn("[OnboardingGate] boot gate timeout — unblocking UI", {
        hydrated,
        routeSynced,
        path: readBrowserPathname(),
      });
      dismissExternalBootSplash();
      ensureIosLoginLiveInteraction();
      setRouteSynced(true);
    }, BOOT_GATE_MAX_MS);
    return () => window.clearTimeout(timer);
  }, [hydrated, routeSynced]);

  if (!hydrated || !routeSynced) {
    return (
      <>
        {hydrated ? (
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
