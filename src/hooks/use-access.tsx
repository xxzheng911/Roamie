import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  ACCESS_CHANGED_EVENT,
  applyMockSubscription,
  applyTestOverride,
  buildAccessSnapshot,
  clearTestModeOverride,
  type AccessSnapshot,
  type SubscriptionState,
  type TestModeOverride,
} from "@/lib/access";
import { getUserPlanProfile } from "@/lib/plan-tier/storage";
import {
  applyLocalMockPlanTier,
  reconcileStaleTierLocks,
  syncMockPlanTierToProfile,
} from "@/lib/plan-tier/sync-mock-tier";

type AccessCtx = AccessSnapshot & {
  refresh: () => void;
  setSubscriptionState: (tier: SubscriptionState) => void;
  setTestOverride: (mode: TestModeOverride) => void;
  clearTestOverride: () => void;
  /** 開啟 Plus 測試模式（模擬訂閱） */
  enablePlusTestMode: () => void;
  /** 關閉 Plus 測試模式（模擬取消訂閱 → Free） */
  disablePlusTestMode: () => void;
};

const Ctx = createContext<AccessCtx | null>(null);

function isProfileSubscriptionPlus(
  plan: Awaited<ReturnType<typeof getUserPlanProfile>>,
): boolean {
  return (
    plan.planTier === "plus" &&
    (plan.subscriptionStatus === "active" || plan.subscriptionStatus === "trialing")
  );
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const email = user?.email ?? null;
  const userId = user?.id ?? null;
  const [profilePlusActive, setProfilePlusActive] = useState(false);
  const [snapshot, setSnapshot] = useState<AccessSnapshot>(() =>
    buildAccessSnapshot(email, { profilePlusActive: false }),
  );

  const refresh = useCallback(() => {
    const next = buildAccessSnapshot(email, { profilePlusActive });
    console.info("[DEV_SUBSCRIPTION] mode=", next.devSubscriptionMode);
    setSnapshot(next);
  }, [email, profilePlusActive]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) {
        setProfilePlusActive(false);
        return;
      }
      try {
        const plan = await getUserPlanProfile(userId);
        if (!cancelled) setProfilePlusActive(isProfileSubscriptionPlus(plan));
      } catch {
        if (!cancelled) setProfilePlusActive(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    reconcileStaleTierLocks();
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = () => {
      if (!userId) return;
      void getUserPlanProfile(userId)
        .then((plan) => setProfilePlusActive(isProfileSubscriptionPlus(plan)))
        .catch(() => setProfilePlusActive(false));
    };
    window.addEventListener(ACCESS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ACCESS_CHANGED_EVENT, onChange);
  }, [userId]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener(ACCESS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ACCESS_CHANGED_EVENT, onChange);
  }, [refresh]);

  const setSubscriptionState = useCallback((tier: SubscriptionState) => {
    applyMockSubscription(tier);
    refresh();
  }, [refresh]);

  const setTestOverride = useCallback((mode: TestModeOverride) => {
    applyTestOverride(mode);
    refresh();
  }, [refresh]);

  const clearTestOverrideFn = useCallback(() => {
    clearTestModeOverride();
    refresh();
  }, [refresh]);

  const enablePlusTestMode = useCallback(() => {
    console.info("[SUBSCRIPTION_MODE] switch start free -> plus");
    try {
      setProfilePlusActive(true);
      applyLocalMockPlanTier("plus");
      refresh();
      console.info("[SUBSCRIPTION_MODE] local update success");
      console.info("[DEV_SUBSCRIPTION] switched_to_plus");
      void syncMockPlanTierToProfile("plus")
        .then(() => {
          console.info("[SUBSCRIPTION_MODE] supabase update success");
          if (!userId) return;
          return getUserPlanProfile(userId).then((plan) =>
            setProfilePlusActive(isProfileSubscriptionPlus(plan)),
          );
        })
        .then(() => {
          refresh();
          console.info("[SUBSCRIPTION_MODE] switch success plus");
        })
        .catch((e) => {
          console.error("[SUBSCRIPTION_MODE] switch error", e);
        });
    } catch (e) {
      console.error("[SUBSCRIPTION_MODE] switch error", e);
    }
  }, [refresh, userId]);

  const disablePlusTestMode = useCallback(() => {
    console.info("[SUBSCRIPTION_MODE] switch start plus -> free");
    try {
      setProfilePlusActive(false);
      applyLocalMockPlanTier("free");
      refresh();
      console.info("[SUBSCRIPTION_MODE] local update success");
      console.info("[DEV_SUBSCRIPTION] switched_to_free");
      void syncMockPlanTierToProfile("free")
        .then(() => {
          console.info("[SUBSCRIPTION_MODE] supabase update success");
          if (!userId) return;
          return getUserPlanProfile(userId).then((plan) =>
            setProfilePlusActive(isProfileSubscriptionPlus(plan)),
          );
        })
        .then(() => {
          refresh();
          console.info("[SUBSCRIPTION_MODE] switch success free");
        })
        .catch((e) => {
          console.error("[SUBSCRIPTION_MODE] switch error", e);
        });
    } catch (e) {
      console.error("[SUBSCRIPTION_MODE] switch error", e);
    }
  }, [refresh, userId]);

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

/** Safe hook when provider may be absent (rare) */
export function useAccessOptional(): AccessCtx | null {
  return useContext(Ctx);
}
