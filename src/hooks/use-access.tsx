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
  isProfileSubscriptionPlus,
  serializeCanonical,
  type CanonicalSubscriptionState,
} from "@/lib/access/subscription-canonical";
import { getUserPlanProfile } from "@/lib/plan-tier/storage";
import { reconcileStaleTierLocks, syncMockPlanTierToProfile } from "@/lib/plan-tier/sync-mock-tier";
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
  }, [snapshot.hasPlusAccess, snapshot.subscriptionSource, snapshot.subscriptionHydrated, canonical]);

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

      const plusActive = isProfileSubscriptionPlus(plan);
      if (plusActive && readTestModeOverride() === "force-free") {
        clearTestModeOverride();
      }

      setCanonical((prev) => {
        const syncVersion = generation;
        return applySupabaseProfile(prev, plusActive, syncVersion);
      });
    } catch {
      if (generation !== syncGenerationRef.current) return;
      setCanonical((prev) =>
        applySupabaseProfile(prev, false, generation),
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
  }, []);

  const setSubscriptionState = useCallback((tier: SubscriptionState) => {
    applyMockSubscription(tier);
    setCanonical((prev) => applyOptimisticTier(prev, tier));
  }, []);

  const setTestOverride = useCallback((mode: TestModeOverride) => {
    applyTestOverride(mode);
    refresh();
  }, [refresh]);

  const clearTestOverrideFn = useCallback(() => {
    clearTestModeOverride();
    refresh();
  }, [refresh]);

  const enablePlusTestMode = useCallback(() => {
    if (isDeveloperBuildEnabled()) {
      applyTestOverride("force-plus");
      setMockSubscriptionTier("plus");
    }

    setCanonical((prev) => {
      const next = applyOptimisticTier(prev, "plus");
      console.info("[PLUS_UPGRADE_OPTIMISTIC_SET]", serializeCanonical(next));
      return next;
    });

    const generation = ++syncGenerationRef.current;
    console.info("[PLUS_UPGRADE_SUPABASE_START]", { generation });

    void syncMockPlanTierToProfile("plus")
      .then(async () => {
        console.info("[PLUS_UPGRADE_SUPABASE_SUCCESS]", { generation });
        const uid = userIdRef.current;
        if (!uid || generation !== syncGenerationRef.current) return;
        const plan = await getUserPlanProfile(uid);
        if (generation !== syncGenerationRef.current) return;
        setCanonical((prev) =>
          applySupabaseProfile(prev, isProfileSubscriptionPlus(plan), generation),
        );
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[PLUS_UPGRADE_SUPABASE_ERROR] error=${message}`);
      });
  }, []);

  const disablePlusTestMode = useCallback(() => {
    if (isDeveloperBuildEnabled()) {
      clearTestModeOverride();
      setMockSubscriptionTier("free");
    }

    setCanonical((prev) => applyOptimisticTier(prev, "free"));

    const generation = ++syncGenerationRef.current;
    void syncMockPlanTierToProfile("free")
      .then(async () => {
        const uid = userIdRef.current;
        if (!uid || generation !== syncGenerationRef.current) return;
        const plan = await getUserPlanProfile(uid);
        if (generation !== syncGenerationRef.current) return;
        setCanonical((prev) =>
          applySupabaseProfile(prev, isProfileSubscriptionPlus(plan), generation),
        );
      })
      .catch((e) => {
        console.error("[SUBSCRIPTION_MODE] disable plus sync error", e);
      });
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
