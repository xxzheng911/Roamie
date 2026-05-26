/**
 * App shell（TanStack Start 以 __root + AppProviders 組裝；此檔供明確對應 App 進入點）。
 */
import type { ReactNode } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { AppProviders } from "@/providers/AppProviders";
import { logAppError } from "@/lib/log-error";

type Props = { children: ReactNode };

export function App({ children }: Props) {
  return (
    <AppProviders>
      <AppErrorBoundary>{children}</AppErrorBoundary>
    </AppProviders>
  );
}

/** Provider 子樹 render 拋錯時由 AppErrorBoundary 攔截；此處僅記錄同步初始化問題 */
export function logAppMountError(error: unknown, source: string): void {
  logAppError("APP_INIT_ERROR", error, { source });
}
