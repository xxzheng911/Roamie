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
import { useAuth } from "@/hooks/use-auth";
import {
  applyMockSubscription,
  applyTestOverride,
  buildAccessSnapshotFromCanonical,
  clearTestModeOverride,
  isDeveloperBuildEnabled,
  readTestModeOverride,
  setMockSubscriptionTier,
  type AccessSnapshot,
  type SubscriptionState,
  type TestModeOverride,
} from "@/lib/access";
import {
  applyDevOverrideFromStorage,
  applyOptimisticTier,
  applySupabaseProfile,
  createInitialCanonicalState,
  serializeCanonical,
  type CanonicalSubscriptionState,
} from "@/lib/access/subscription-canonical";
import { getUserPlanProfile } from "@/lib/plan-tier/storage";
import { reconcileStaleTierLocks } from "@/lib/plan-tier/sync-mock-tier";
import { clearPersonalizedChatCaches } from "@/lib/clear-auth-state";

type AccessCtx = AccessSnapshot & {
  refresh: () => void;
  setSubscriptionState: (tier: SubscriptionState) => void;
  setTestOverride: (mode: TestModeOverride) => void;
  clearTestOverride: () => void;
  enablePlusTestMode: () => void;
  disablePlusTestMode: () => void;
};

const Ctx = createContext<AccessCtx | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const email = user?.email ?? null;
  const userId = user?.id ?? null;

  const [canonical, setCanonical] = useState<CanonicalSubscriptionState>(() =>
    createInitialCanonicalState(),
  );
  const syncGenerationRef = useRef(0);
  const userIdRef = useRef(userId);
  const lastResolvedTierRef = useRef<"free" | "plus" | null>(null);
  userIdRef.current = userId;

  const snapshot = useMemo(
    () => buildAccessSnapshotFromCanonical(email, canonical),
    [email, canonical],
  );

  useEffect(() => {
    const status = snapshot.hasPlusAccess ? "plus" : "free";
    console.info(
      `[SUBSCRIPTION_STATE_RENDER] status=${status} source=${snapshot.subscriptionSource ?? canonical.source} hydrated=${snapshot.subscriptionHydrated ?? canonical.hydrated} version=${canonical.version}`,
    );
  }, [
    snapshot.hasPlusAccess,
    snapshot.subscriptionSource,
    snapshot.subscriptionHydrated,
    canonical,
  ]);

  useEffect(() => {
    if (!snapshot.subscriptionHydrated) return;
    const tier = snapshot.hasPlusAccess ? "plus" : "free";
    const previous = lastResolvedTierRef.current;
    if (previous && previous !== tier) clearPersonalizedChatCaches();
    lastResolvedTierRef.current = tier;
  }, [snapshot.hasPlusAccess, snapshot.subscriptionHydrated]);

  const hydrateFromSupabase = useCallback(async (uid: string) => {
    const generation = ++syncGenerationRef.current;
    try {
      const plan = await getUserPlanProfile(uid);
      if (generation !== syncGenerationRef.current || userIdRef.current !== uid) return;

      if (plan.hasPlus && readTestModeOverride() === "force-free") {
        clearTestModeOverride();
      }

      setCanonical((prev) => {
        const syncVersion = generation;
        return applySupabaseProfile(
          prev,
          {
            hasPlus: plan.hasPlus,
            effectiveSource: plan.effectiveSource,
            activeSources: plan.activeSources,
            expiresAt: plan.entitlementExpiresAt,
          },
          syncVersion,
        );
      });
    } catch {
      if (generation !== syncGenerationRef.current) return;
      setCanonical((prev) =>
        applySupabaseProfile(
          prev,
          {
            hasPlus: false,
            effectiveSource: "none",
            activeSources: [],
            expiresAt: null,
          },
          generation,
        ),
      );
    }
  }, []);

  useEffect(() => {
    reconcileStaleTierLocks();
  }, []);

  useEffect(() => {
    if (!userId) {
      syncGenerationRef.current += 1;
      setCanonical(createInitialCanonicalState());
      return;
    }
    void hydrateFromSupabase(userId);
  }, [userId, hydrateFromSupabase]);

  const refresh = useCallback(() => {
    setCanonical((prev) => applyDevOverrideFromStorage(prev));
    if (userId) void hydrateFromSupabase(userId);
  }, [userId, hydrateFromSupabase]);

  const setSubscriptionState = useCallback((tier: SubscriptionState) => {
    if (!isDeveloperBuildEnabled()) return;
    applyMockSubscription(tier);
    setCanonical((prev) => applyOptimisticTier(prev, tier));
  }, []);

  const setTestOverride = useCallback(
    (mode: TestModeOverride) => {
      if (!isDeveloperBuildEnabled()) return;
      applyTestOverride(mode);
      refresh();
    },
    [refresh],
  );

  const clearTestOverrideFn = useCallback(() => {
    if (!isDeveloperBuildEnabled()) return;
    clearTestModeOverride();
    refresh();
  }, [refresh]);

  const enablePlusTestMode = useCallback(() => {
    if (!isDeveloperBuildEnabled()) return;
    applyTestOverride("force-plus");
    setMockSubscriptionTier("plus");

    setCanonical((prev) => {
      const next = applyOptimisticTier(prev, "plus");
      console.info("[PLUS_UPGRADE_OPTIMISTIC_SET]", serializeCanonical(next));
      return next;
    });
  }, []);

  const disablePlusTestMode = useCallback(() => {
    if (!isDeveloperBuildEnabled()) return;
    clearTestModeOverride();
    setMockSubscriptionTier("free");

    setCanonical((prev) => applyOptimisticTier(prev, "free"));
  }, []);

  const value = useMemo(
    () => ({
      ...snapshot,
      refresh,
      setSubscriptionState,
      setTestOverride,
      clearTestOverride: clearTestOverrideFn,
      enablePlusTestMode,
      disablePlusTestMode,
    }),
    [
      snapshot,
      refresh,
      setSubscriptionState,
      setTestOverride,
      clearTestOverrideFn,
      enablePlusTestMode,
      disablePlusTestMode,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccess() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAccess must be used within AccessProvider");
  return ctx;
}

export function useAccessOptional(): AccessCtx | null {
  return useContext(Ctx);
}
