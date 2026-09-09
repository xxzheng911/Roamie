import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createSubscriptionAdapter } from "@/services/subscription";
import { canUseFeature, incrementUsage, readLocalUsage } from "@/services/subscription/tiers";
import type {
  FeatureGateResult,
  SubscriptionActionResult,
  SubscriptionFeature,
  SubscriptionPackage,
  SubscriptionStatus,
  UsageCounters,
} from "@/services/subscription/types";
import { useAuth } from "@/hooks/use-auth";
import {
  syncRevenueCatEntitlementInBackground,
  syncRevenueCatEntitlementWithServer,
} from "@/lib/subscription/revenuecat-sync";
import {
  SUBSCRIPTION_HYDRATION_TIMEOUT_MS,
  SUBSCRIPTION_OFFERINGS_TIMEOUT_MS,
  withSubscriptionTimeout,
} from "@/lib/subscription/async-timeout";

type SubscriptionCtx = {
  status: SubscriptionStatus | null;
  packages: SubscriptionPackage[];
  usage: UsageCounters;
  loading: boolean;
  offeringsLoading: boolean;
  error: string | null;
  checkFeature: (feature: SubscriptionFeature) => FeatureGateResult;
  recordUsage: (feature: SubscriptionFeature) => void;
  refresh: () => Promise<void>;
  loadOfferings: () => Promise<void>;
  purchase: (packageId: string) => Promise<SubscriptionActionResult>;
  restore: () => Promise<SubscriptionActionResult>;
};
const Ctx = createContext<SubscriptionCtx | null>(null);
const UNKNOWN_SUBSCRIPTION_STATUS: SubscriptionStatus = {
  tier: "free",
  isActive: false,
  expiresAt: null,
  productId: null,
  willRenew: false,
  source: "local",
};

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const adapter = useMemo(() => createSubscriptionAdapter(), []);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [usage, setUsage] = useState<UsageCounters>(() => readLocalUsage());
  const [loading, setLoading] = useState(true);
  const [offeringsLoading, setOfferingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    const generation = generationRef.current;
    const next = await adapter.getStatus(user.id);
    if (generation !== generationRef.current) return;
    setStatus(next);
    setUsage(await adapter.getUsage());
    if (adapter.id === "revenuecat") await syncRevenueCatEntitlementWithServer();
  }, [adapter, user?.id]);

  useEffect(() => {
    if (authLoading) return;
    const generation = ++generationRef.current;
    let cancelled = false;
    let removeListener: (() => void) | undefined;
    if (!user?.id) {
      setStatus(null);
      setPackages([]);
      setLoading(false);
      void adapter.logOut().catch(() => undefined);
      return;
    }
    setLoading(true);
    setError(null);
    const hydrationTimeout = setTimeout(() => {
      if (cancelled || generation !== generationRef.current) return;
      setStatus(
        (current) =>
          current ?? {
            ...UNKNOWN_SUBSCRIPTION_STATUS,
            source: adapter.id === "revenuecat" ? "revenuecat" : "local",
          },
      );
      setLoading(false);
      console.warn("[REVENUECAT_STATE]", { event: "hydration_timeout", fallback: "free" });
    }, SUBSCRIPTION_HYDRATION_TIMEOUT_MS);
    void (async () => {
      try {
        await adapter.configure(user.id);
        removeListener = await adapter.addStatusListener((next) => {
          if (generation !== generationRef.current) return;
          setStatus(next);
          if (adapter.id === "revenuecat") syncRevenueCatEntitlementInBackground();
        }, user.id);
        if (cancelled) {
          removeListener();
          removeListener = undefined;
          return;
        }
        const next = await adapter.getStatus(user.id);
        if (generation !== generationRef.current) return;
        setStatus(next);
        if (adapter.id === "revenuecat") await syncRevenueCatEntitlementWithServer();
      } catch (cause) {
        if (generation === generationRef.current)
          setError(cause instanceof Error ? cause.message : "subscription_unavailable");
      } finally {
        clearTimeout(hydrationTimeout);
        if (generation === generationRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      generationRef.current += 1;
      clearTimeout(hydrationTimeout);
      removeListener?.();
    };
  }, [adapter, authLoading, user?.id]);

  const loadOfferings = useCallback(async () => {
    setOfferingsLoading(true);
    setError(null);
    try {
      if (!user?.id) throw new Error("revenuecat_user_id_missing");
      setPackages(
        await withSubscriptionTimeout(
          adapter.getPackages(user.id),
          SUBSCRIPTION_OFFERINGS_TIMEOUT_MS,
          "offerings_timeout",
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "offerings_unavailable");
    } finally {
      setOfferingsLoading(false);
    }
  }, [adapter, user?.id]);
  const purchase = useCallback(
    async (packageId: string) => {
      setError(null);
      if (!user?.id) throw new Error("revenuecat_user_id_missing");
      const result = await adapter.purchase(packageId, user.id);
      setStatus(result.status);
      if (result.outcome === "success" && adapter.id === "revenuecat")
        await syncRevenueCatEntitlementWithServer();
      return result;
    },
    [adapter, user?.id],
  );
  const restore = useCallback(async () => {
    setError(null);
    if (!user?.id) throw new Error("revenuecat_user_id_missing");
    const result = await adapter.restore(user.id);
    setStatus(result.status);
    if (adapter.id === "revenuecat") await syncRevenueCatEntitlementWithServer();
    return result;
  }, [adapter, user?.id]);
  const checkFeature = useCallback(
    (feature: SubscriptionFeature): FeatureGateResult =>
      canUseFeature(status ?? UNKNOWN_SUBSCRIPTION_STATUS, usage, feature),
    [status, usage],
  );
  const recordUsage = useCallback(
    (feature: SubscriptionFeature) => setUsage((prev) => incrementUsage(feature, prev)),
    [],
  );
  const value = useMemo(
    () => ({
      status,
      packages,
      usage,
      loading,
      offeringsLoading,
      error,
      checkFeature,
      recordUsage,
      refresh,
      loadOfferings,
      purchase,
      restore,
    }),
    [
      status,
      packages,
      usage,
      loading,
      offeringsLoading,
      error,
      checkFeature,
      recordUsage,
      refresh,
      loadOfferings,
      purchase,
      restore,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useSubscription() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSubscription must be used within SubscriptionProvider");
  return ctx;
}
