import type { ReactNode } from "react";
import { AuthProvider } from "@/hooks/use-auth";
import { AvatarProvider } from "@/hooks/use-avatar";
import { I18nProvider } from "@/hooks/use-i18n";
import { AnalyticsProvider } from "@/providers/AnalyticsProvider";
import { PlatformProvider } from "@/providers/PlatformProvider";
import { SubscriptionProvider } from "@/providers/SubscriptionProvider";
import { assertClientEnv } from "@/constants/env";

type Props = { children: ReactNode };

/**
 * Root provider composition — single place to add global context.
 * Existing hooks (use-auth, use-i18n) remain; migrate gradually to /providers.
 */
export function AppProviders({ children }: Props) {
  if (typeof window !== "undefined") {
    assertClientEnv();
  }

  return (
    <PlatformProvider>
      <AnalyticsProvider>
        <SubscriptionProvider>
          <AuthProvider>
            <I18nProvider>
              <AvatarProvider>{children}</AvatarProvider>
            </I18nProvider>
          </AuthProvider>
        </SubscriptionProvider>
      </AnalyticsProvider>
    </PlatformProvider>
  );
}
