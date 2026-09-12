/**
 * App shell（TanStack Start 以 __root + AppProviders 組裝；此檔供明確對應 App 進入點）。
 */
import { type ReactNode, useEffect } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { OnboardingGate } from "@/components/OnboardingGate";
import { AppProviders } from "@/providers/AppProviders";
import { logAppBoot, logAppBootSnapshot } from "@/lib/app-boot-log";
import { logAppRemountSource, shouldLogAppMounted } from "@/lib/startup-boot-state";
import { detectPlatform } from "@/services/platform";
import { readBrowserPathname } from "@/lib/startup-path";
import { logAppError } from "@/lib/log-error";
import { isAdminAuthBoundaryRoute, isAdminRoute } from "@/lib/admin/admin-route-boundary";

type Props = { children: ReactNode };

export function App({ children }: Props) {
  const isAdminBoundary = isAdminAuthBoundaryRoute(readBrowserPathname());
  const isAdminPage = isAdminRoute(readBrowserPathname());
  const stagingBadge =
    import.meta.env.VITE_DEPLOY_ENV === "staging" ? (
      <div
        aria-label="Staging build"
        className="pointer-events-none fixed right-3 z-[10000] rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold tracking-wider text-black shadow-sm"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 4px)" }}
      >
        STAGING
      </div>
    ) : null;

  useEffect(() => {
    logAppRemountSource("App");

    if (!shouldLogAppMounted()) return;

    const platform = detectPlatform();
    console.info("[REAL_APP] mounted", {
      isCapacitor: platform.isCapacitor,
      isIOS: platform.isIOS,
      route: readBrowserPathname(),
    });
    logAppBoot("App mounted");
    logAppBoot("platform:", {
      kind: platform.kind,
      isCapacitor: platform.isCapacitor,
      isIOS: platform.isIOS,
    });
    logAppBoot("current route:", { path: readBrowserPathname() });
    void logAppBootSnapshot();
  }, []);

  if (isAdminPage) {
    return (
      <AppErrorBoundary>
        {stagingBadge}
        {children}
      </AppErrorBoundary>
    );
  }

  if (isAdminBoundary) {
    return (
      <AppProviders>
        <AppErrorBoundary>
          {stagingBadge}
          {children}
        </AppErrorBoundary>
      </AppProviders>
    );
  }

  return (
    <OnboardingGate>
      <AppProviders>
        <AppErrorBoundary>
          {stagingBadge}
          {children}
        </AppErrorBoundary>
      </AppProviders>
    </OnboardingGate>
  );
}

/** Provider 子樹 render 拋錯時由 AppErrorBoundary 攔截；此處僅記錄同步初始化問題 */
export function logAppMountError(error: unknown, source: string): void {
  logAppError("APP_INIT_ERROR", error, { source });
}
