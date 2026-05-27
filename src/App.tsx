/**
 * App shell（TanStack Start 以 __root + AppProviders 組裝；此檔供明確對應 App 進入點）。
 */
import { type ReactNode, useEffect } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { OnboardingGate } from "@/components/OnboardingGate";
import { AppProviders } from "@/providers/AppProviders";
import { logAppBoot, logAppBootSnapshot } from "@/lib/app-boot-log";
import { detectPlatform } from "@/services/platform";
import { readBrowserPathname } from "@/lib/startup-path";
import { logAppError } from "@/lib/log-error";

type Props = { children: ReactNode };

export function App({ children }: Props) {
  useEffect(() => {
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

  return (
    <OnboardingGate>
      <AppProviders>
        <AppErrorBoundary>{children}</AppErrorBoundary>
      </AppProviders>
    </OnboardingGate>
  );
}

/** Provider 子樹 render 拋錯時由 AppErrorBoundary 攔截；此處僅記錄同步初始化問題 */
export function logAppMountError(error: unknown, source: string): void {
  logAppError("APP_INIT_ERROR", error, { source });
}
