import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createSubscriptionAdapter } from "@/services/subscription";
import { canUseFeature, incrementUsage, readLocalUsage } from "@/services/subscription/tiers";
import type {
  FeatureGateResult,
  SubscriptionFeature,
  SubscriptionStatus,
  UsageCounters,
} from "@/services/subscription/types";
import { useAccess } from "@/hooks/use-access";

type SubscriptionCtx = {
  status: SubscriptionStatus;
  usage: UsageCounters;
  loading: boolean;
  checkFeature: (feature: SubscriptionFeature) => FeatureGateResult;
  recordUsage: (feature: SubscriptionFeature) => void;
  refresh: () => Promise<void>;
  purchase: (productId: string) => Promise<void>;
  restore: () => Promise<void>;
};

const Ctx = createContext<SubscriptionCtx | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { hasPlusAccess, refresh: refreshAccess } = useAccess();
  const adapter = useMemo(() => createSubscriptionAdapter(), []);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [usage, setUsage] = useState<UsageCounters>(() => readLocalUsage());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    console.info("[APP_BOOT_STAGE]", {
      stage: "subscription_start",
      elapsedMs: Math.round(performance.now()),
      route: typeof location !== "undefined" ? location.pathname : "",
    });
    try {
      const [nextStatus, nextUsage] = await Promise.all([adapter.getStatus(), adapter.getUsage()]);
      setStatus(nextStatus);
      setUsage(nextUsage);
    } finally {
      setLoading(false);
      console.info("[APP_BOOT_STAGE]", {
        stage: "subscription_done",
        elapsedMs: Math.round(performance.now()),
        route: typeof location !== "undefined" ? location.pathname : "",
      });
    }
  }, [adapter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const checkFeature = useCallback(
    (feature: SubscriptionFeature): FeatureGateResult => {
      const authoritativeStatus: SubscriptionStatus = {
        tier: hasPlusAccess ? "plus" : "free",
        isActive: true,
        expiresAt: null,
        productId: null,
        willRenew: false,
        source: "local",
      };
      return canUseFeature(authoritativeStatus, usage, feature);
    },
    [hasPlusAccess, usage],
  );

  const recordUsage = useCallback((feature: SubscriptionFeature) => {
    setUsage((prev) => incrementUsage(feature, prev));
  }, []);

  const purchase = useCallback(
    async (productId: string) => {
      const next = await adapter.purchase(productId);
      setStatus(next);
      refreshAccess();
    },
    [adapter, refreshAccess],
  );

  const restore = useCallback(async () => {
    const next = await adapter.restore();
    setStatus(next);
    refreshAccess();
  }, [adapter, refreshAccess]);

  const value = useMemo(
    () => ({
      status: status ?? {
        tier: "free",
        isActive: true,
        expiresAt: null,
        productId: null,
        willRenew: false,
        source: "local" as const,
      },
      usage,
      loading,
      checkFeature,
      recordUsage,
      refresh,
      purchase,
      restore,
    }),
    [status, usage, loading, checkFeature, recordUsage, refresh, purchase, restore],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSubscription() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSubscription must be used within SubscriptionProvider");
  return ctx;
}
