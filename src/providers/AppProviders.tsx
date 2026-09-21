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
import { PlusPurchaseProvider } from "@/providers/PlusPurchaseProvider";
import { assertClientEnv } from "@/constants/env";
import { markBootPhase } from "@/lib/boot-diagnostics";
import { isSupabaseConfigured } from "@/integrations/supabase/client";
import { hydrateAppBootCachesAsync, resetAppBootCachesForUserChange } from "@/lib/app-boot-cache";
import { flushConversationWorkspacesToNative } from "@/lib/conversation-workspace/storage";
import { pushConversationWorkspacesRemote } from "@/lib/conversation-workspace/remote-sync";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import { clearPersonalizedChatCaches } from "@/lib/clear-auth-state";

type Props = { children: ReactNode };

function bootPhase(phase: string, detail?: string): void {
  markBootPhase(phase, detail);
}

/** Shared purchase authority must outlive Welcome → Login → authenticated transitions. */
function PurchaseShellProviders({ children }: { children: ReactNode }) {
  return (
    <SubscriptionProvider>
      <AccessProvider>
        <PlusPurchaseProvider>
          <AddToTripProvider>{children}</AddToTripProvider>
        </PlusPurchaseProvider>
      </AccessProvider>
    </SubscriptionProvider>
  );
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
        clearPersonalizedChatCaches();
        resetAppBootCachesForUserChange();
      }
    }
    lastUserIdRef.current = userId;
    void hydrateAppBootCachesAsync(userId).catch(() => {
      // Offline boot-cache hydration is recoverable and never app-shell authority.
    });
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
            <PurchaseShellProviders>
              <AvatarProvider>
                <CoverProvider>{children}</CoverProvider>
              </AvatarProvider>
            </PurchaseShellProviders>
          </I18nProvider>
        </AuthProvider>
      </AnalyticsProvider>
    </PlatformProvider>
  );
}
