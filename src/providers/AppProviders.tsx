import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { AvatarProvider } from "@/hooks/use-avatar";
import { CoverProvider } from "@/hooks/use-cover";
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
import { hydrateAppBootCachesAsync, resetAppBootCachesForUserChange } from "@/lib/app-boot-cache";
import {
  flushConversationWorkspacesToNative,
} from "@/lib/conversation-workspace/storage";
import { pushConversationWorkspacesRemote } from "@/lib/conversation-workspace/remote-sync";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

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
  const light = shouldUseLightStartupShell(pathname, Boolean(user), loading);
  const phase = light ? "providers:light" : "providers:authed-shell";
  const detail = `u=${Boolean(user)} l=${loading ? 1 : 0}`;
  const lastPhaseRef = useRef<string>("");

  useEffect(() => {
    const key = `${phase}|${detail}`;
    if (lastPhaseRef.current === key) return;
    lastPhaseRef.current = key;
    bootPhase(phase, detail);
  }, [phase, detail]);

  if (light) {
    return <>{children}</>;
  }

  return <AuthenticatedShellProviders>{children}</AuthenticatedShellProviders>;
}

function BootCacheHydrator() {
  const { user, loading } = useAuth();
  const lastUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (loading) return;
    const userId = user?.id ?? null;
    const prev = lastUserIdRef.current;
    if (prev !== undefined && prev !== userId) {
      // Only wipe media when switching between two real users, or on logout.
      // Never wipe on null→user (first session resolve) — that retriggers seed loops.
      if ((prev && userId && prev !== userId) || (prev && !userId)) {
        resetAppBootCachesForUserChange();
      }
    }
    lastUserIdRef.current = userId;
    void hydrateAppBootCachesAsync(userId);
  }, [loading, user?.id]);

  // Persist travel drafts when app backgrounds (WK localStorage may be non-durable)
  useEffect(() => {
    if (!isCapacitorNativeShell()) return;
    let remove: (() => void) | undefined;
    let cancelled = false;
    void import("@capacitor/app").then(({ App }) => {
      if (cancelled) return;
      void App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) return;
        const userId = user?.id ?? null;
        void flushConversationWorkspacesToNative(userId);
        if (userId) void pushConversationWorkspacesRemote(userId);
      }).then((handle) => {
        remove = () => {
          void handle.remove();
        };
      });
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [user?.id]);

  return null;
}

/**
 * Root provider composition — single place to add global context.
 * Existing hooks (use-auth, use-i18n) remain; migrate gradually to /providers.
 */
export function AppProviders({ children }: Props) {
  const bootLogged = useRef(false);
  useEffect(() => {
    if (bootLogged.current) return;
    bootLogged.current = true;
    assertClientEnv();
    if (!isSupabaseConfigured()) {
      console.warn(
        "[Roamie] Supabase env missing at runtime — cloud sync disabled until rebuild with VITE_SUPABASE_* in .env",
      );
    }
    bootPhase("providers:render");
  }, []);

  return (
    <PlatformProvider>
      <AnalyticsProvider>
        <AuthProvider>
          <I18nProvider>
            <BootCacheHydrator />
            <ProviderGate>
              <AvatarProvider>
                <CoverProvider>{children}</CoverProvider>
              </AvatarProvider>
            </ProviderGate>
          </I18nProvider>
        </AuthProvider>
      </AnalyticsProvider>
    </PlatformProvider>
  );
}
