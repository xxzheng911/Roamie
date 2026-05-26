import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { AvatarProvider } from "@/hooks/use-avatar";
import { I18nProvider } from "@/hooks/use-i18n";
import { AnalyticsProvider } from "@/providers/AnalyticsProvider";
import { PlatformProvider } from "@/providers/PlatformProvider";
import { AccessProvider } from "@/hooks/use-access";
import { AddToTripProvider } from "@/hooks/use-add-to-trip";
import { SubscriptionProvider } from "@/providers/SubscriptionProvider";
import { assertClientEnv } from "@/constants/env";
import { isSupabaseConfigured } from "@/integrations/supabase/client";

type Props = { children: ReactNode };

/** 僅登入／OAuth callback 冷啟動可略過重型 provider；welcome 仍需 Access（開發工具） */
function isLoginColdStartPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/auth/");
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

function ProviderGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, loading } = useAuth();
  if (isLoginColdStartPath(pathname) && (loading || !user)) {
    return <>{children}</>;
  }

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
