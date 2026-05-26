import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { AvatarProvider } from "@/hooks/use-avatar";
import { I18nProvider } from "@/hooks/use-i18n";
import { AnalyticsProvider } from "@/providers/AnalyticsProvider";
import { PlatformProvider } from "@/providers/PlatformProvider";
import { AccessProvider } from "@/hooks/use-access";
import { AddToTripProvider } from "@/hooks/use-add-to-trip";
import { SubscriptionProvider } from "@/providers/SubscriptionProvider";
import { assertClientEnv } from "@/constants/env";
import { markBootPhase } from "@/lib/boot-diagnostics";
import { isSupabaseConfigured } from "@/integrations/supabase/client";
import {
  readBrowserPathname,
  shouldUseLightStartupShell,
} from "@/lib/startup-path";

type Props = { children: ReactNode };

function bootPhase(phase: string, detail?: string): void {
  markBootPhase(phase, detail);
}

/** Plus / 加入行程等僅在已登入主殼層需要；登入頁不載入以縮小冷啟動 bundle */
function AuthenticatedShellProviders({ children }: { children: ReactNode }) {
  return (
    <SubscriptionProvider>
      <AccessProvider>
        <AddToTripProvider>{children}</AddToTripProvider>
      </AccessProvider>
    </SubscriptionProvider>
  );
}

/**
 * 勿使用 useRouterState — router match 未就緒時 production 會拋 Invariant failed。
 * pathname 每次 render 從 window 讀取（導航後父層會 re-render）。
 */
function ProviderGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = readBrowserPathname();

  if (shouldUseLightStartupShell(pathname, Boolean(user), loading)) {
    bootPhase("providers:light", `u=${Boolean(user)} l=${loading ? 1 : 0}`);
    return <>{children}</>;
  }

  bootPhase("providers:authed-shell", `u=${Boolean(user)} l=${loading ? 1 : 0}`);
  return <AuthenticatedShellProviders>{children}</AuthenticatedShellProviders>;
}

/**
 * Root provider composition — single place to add global context.
 * Existing hooks (use-auth, use-i18n) remain; migrate gradually to /providers.
 */
export function AppProviders({ children }: Props) {
  if (typeof window !== "undefined") {
    assertClientEnv();
    if (!isSupabaseConfigured()) {
      console.warn(
        "[Roamie] Supabase env missing at runtime — cloud sync disabled until rebuild with VITE_SUPABASE_* in .env",
      );
    }
    bootPhase("providers:render");
  }

  return (
    <PlatformProvider>
      <AnalyticsProvider>
        <AuthProvider>
          <I18nProvider>
            <ProviderGate>
              <AvatarProvider>{children}</AvatarProvider>
            </ProviderGate>
          </I18nProvider>
        </AuthProvider>
      </AnalyticsProvider>
    </PlatformProvider>
  );
}
