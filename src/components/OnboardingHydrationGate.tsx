import { type ReactNode, useEffect, useState } from "react";
import { RoamieRoutePending } from "@/components/RoamieRoutePending";
import { hydrateOnboardingStatus } from "@/lib/onboarding-storage";

type Props = { children: ReactNode };

/**
 * 冷啟動：先讀 onboarding_completed（Preferences + localStorage），再渲染路由，
 * 避免未讀完就預設導向 /welcome。
 */
export function OnboardingHydrationGate({ children }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hydrateOnboardingStatus().finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <RoamieRoutePending />;
  }

  return <>{children}</>;
}
