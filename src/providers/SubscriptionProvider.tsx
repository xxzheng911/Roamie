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
  const adapter = useMemo(() => createSubscriptionAdapter(), []);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [usage, setUsage] = useState<UsageCounters>(() => readLocalUsage());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, nextUsage] = await Promise.all([
        adapter.getStatus(),
        adapter.getUsage(),
      ]);
      setStatus(nextStatus);
      setUsage(nextUsage);
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const checkFeature = useCallback(
    (feature: SubscriptionFeature): FeatureGateResult => {
      if (!status) return { allowed: true };
      return canUseFeature(status, usage, feature);
    },
    [status, usage],
  );

  const recordUsage = useCallback((feature: SubscriptionFeature) => {
    setUsage((prev) => incrementUsage(feature, prev));
  }, []);

  const purchase = useCallback(
    async (productId: string) => {
      const next = await adapter.purchase(productId);
      setStatus(next);
    },
    [adapter],
  );

  const restore = useCallback(async () => {
    const next = await adapter.restore();
    setStatus(next);
  }, [adapter]);

  const value = useMemo(
    () => ({
      status: status ?? { tier: "free", isActive: true, expiresAt: null, productId: null, willRenew: false, source: "local" as const },
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
