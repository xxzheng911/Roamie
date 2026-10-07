import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
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
import { subscriptionStatusForDisplay } from "@/lib/subscription/canonical-plus";
import { isSubscriptionOwnershipErrorCode } from "@/lib/subscription/revenuecat-identity";
import {
  isCanonicalRestoreConfirmed,
  syncRevenueCatEntitlementAfterRestore,
  syncRevenueCatEntitlementWithServer,
} from "@/lib/subscription/revenuecat-sync";
import {
  SUBSCRIPTION_HYDRATION_TIMEOUT_MS,
  withSubscriptionTimeout,
} from "@/lib/subscription/async-timeout";

export type OfferingsState =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "timeout"
  | "error"
  | "retrying";
type SubscriptionCtx = {
  purchasesSupported: boolean;
  status: SubscriptionStatus | null;
  packages: SubscriptionPackage[];
  usage: UsageCounters;
  loading: boolean;
  offeringsLoading: boolean;
  offeringsState: OfferingsState;
  offeringsPhase: "initializing" | "fetching" | null;
  initializationError: string | null;
  offeringsError: string | null;
  purchaseError: string | null;
  restoreError: string | null;
  canonicalSyncError: string | null;
  canonicalSyncLoading: boolean;
  ownershipBlocked: boolean;
  checkFeature: (feature: SubscriptionFeature) => FeatureGateResult;
  recordUsage: (feature: SubscriptionFeature) => void;
  refresh: () => Promise<boolean>;
  loadOfferings: () => Promise<void>;
  purchase: (packageId: string) => Promise<SubscriptionActionResult>;
  restore: () => Promise<SubscriptionActionResult>;
  canonicalRevision: number;
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
  const [stateUserId, setStateUserId] = useState(user?.id);
  const matchesUser = stateUserId === user?.id;
  const [offeringsPhase, setOfferingsPhase] = useState<"initializing" | "fetching" | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [usage, setUsage] = useState<UsageCounters>(() => readLocalUsage());
  const [loading, setLoading] = useState(true);
  const [offeringsState, setOfferingsState] = useState<OfferingsState>("idle");
  const offeringsLoading = offeringsState === "loading" || offeringsState === "retrying";
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [offeringsError, setOfferingsError] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [canonicalSyncLoading, setCanonicalSyncLoading] = useState(false);
  const [canonicalSyncError, setCanonicalSyncError] = useState<string | null>(null);
  const [ownershipBlocked, setOwnershipBlocked] = useState(false);
  const offeringsRequest = useRef<AbortController | null>(null);
  const currentUserId = useRef(user?.id);

  const syncRequest = useRef(0);
  const [canonicalRevision, setCanonicalRevision] = useState(0);
  const generationRef = useRef(0);
  const mounted = useRef(false);
  const actionRequest = useRef(0);
  const usageRequest = useRef(0);
  if (currentUserId.current !== user?.id) {
    currentUserId.current = user?.id;
    generationRef.current += 1;
  }
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generationRef.current += 1;
      offeringsRequest.current?.abort();
    };
  }, []);
  const refreshUsage = useCallback(
    async (userId: string, generation: number) => {
      const request = ++usageRequest.current;
      // Usage is a device-local daily quota, independent of canonical server credits.
      const next = await adapter.getUsage().catch(() => readLocalUsage());
      if (
        mounted.current &&
        currentUserId.current === userId &&
        generationRef.current === generation &&
        usageRequest.current === request
      )
        setUsage(next);
    },
    [adapter],
  );

  const syncCanonical = useCallback(async (userId: string, active: boolean, restoring = false) => {
    const generation = generationRef.current;
    const request = ++syncRequest.current;
    if (mounted.current && currentUserId.current === userId) setCanonicalSyncLoading(true);
    const sync = () => syncRevenueCatEntitlementWithServer(userId);
    const result = restoring ? await syncRevenueCatEntitlementAfterRestore({ sync }) : await sync();
    const confirmed = result.ok && (!active || isCanonicalRestoreConfirmed(active, result));
    const errorCode = confirmed
      ? undefined
      : (result.errorCode ?? "subscription_canonical_sync_failed");
    if (
      mounted.current &&
      currentUserId.current === userId &&
      generation === generationRef.current &&
      request === syncRequest.current
    ) {
      setCanonicalSyncLoading(false);
      setCanonicalSyncError(errorCode ?? null);
      if (isSubscriptionOwnershipErrorCode(errorCode)) {
        setOwnershipBlocked(true);
        setStatus((current) => subscriptionStatusForDisplay(current, userId, true));
      } else if (confirmed) {
        setOwnershipBlocked(false);
        setCanonicalRevision((revision) => revision + 1);
      }
    }
    return { confirmed, errorCode };
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current || !user?.id) return false;
    const userId = user.id;
    const generation = generationRef.current;
    const request = ++actionRequest.current;
    try {
      const next = await withSubscriptionTimeout(
        adapter.getStatus(userId),
        SUBSCRIPTION_HYDRATION_TIMEOUT_MS,
        "subscription_initialization_timeout",
      );
      if (
        !mounted.current ||
        currentUserId.current !== userId ||
        generation !== generationRef.current ||
        request !== actionRequest.current
      )
        return false;
      setStatus(next);
      setInitializationError(null);
      await refreshUsage(userId, generation);
      if (
        !mounted.current ||
        currentUserId.current !== userId ||
        generation !== generationRef.current ||
        request !== actionRequest.current
      )
        return false;
      const synced =
        adapter.id === "revenuecat"
          ? await syncCanonical(userId, next.isActive)
          : { confirmed: true, errorCode: undefined };
      return (
        mounted.current &&
        currentUserId.current === userId &&
        generation === generationRef.current &&
        request === actionRequest.current &&
        next.isActive &&
        synced.confirmed
      );
    } catch (cause) {
      if (
        mounted.current &&
        currentUserId.current === userId &&
        generation === generationRef.current &&
        request === actionRequest.current
      )
        setCanonicalSyncError(cause instanceof Error ? cause.message : "subscription_sync_failed");
      return false;
    }
  }, [adapter, user?.id, syncCanonical, refreshUsage]);

  useLayoutEffect(() => {
    if (authLoading) return;
    const generation = ++generationRef.current;
    setStateUserId(user?.id);
    setUsage(readLocalUsage());
    setOfferingsPhase(null);
    offeringsRequest.current?.abort();
    syncRequest.current += 1;
    setPackages([]);
    setStatus(null);
    setOfferingsState("idle");
    setOfferingsError(null);
    setPurchaseError(null);
    setRestoreError(null);
    setCanonicalSyncError(null);
    setCanonicalSyncLoading(false);
    setOwnershipBlocked(false);
    setInitializationError(null);
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
    setInitializationError(null);
    const hydrationTimeout = setTimeout(() => {
      if (
        !mounted.current ||
        cancelled ||
        currentUserId.current !== user?.id ||
        generation !== generationRef.current
      )
        return;
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
        if (
          !mounted.current ||
          cancelled ||
          currentUserId.current !== user?.id ||
          generation !== generationRef.current
        )
          return;
        removeListener = await adapter.addStatusListener((next) => {
          if (
            !mounted.current ||
            currentUserId.current !== user?.id ||
            generation !== generationRef.current
          )
            return;
          setStatus(next);
          if (adapter.id === "revenuecat") void syncCanonical(user.id, next.isActive);
        }, user.id);
        if (cancelled) {
          removeListener();
          removeListener = undefined;
          return;
        }
        const next = await adapter.getStatus(user.id);
        if (
          !mounted.current ||
          currentUserId.current !== user?.id ||
          generation !== generationRef.current
        )
          return;
        setStatus(next);
        void refreshUsage(user.id, generation);
        if (adapter.id === "revenuecat") {
          void syncCanonical(user.id, next.isActive);
          // Reconciliation has its own identity lease, but is not an offerings prerequisite.
          void adapter
            .reconcile?.(user.id)
            .then(async () => {
              if (
                !mounted.current ||
                cancelled ||
                generation !== generationRef.current ||
                currentUserId.current !== user.id
              )
                return;
              const reconciled = await adapter.getStatus(user.id);
              if (
                !mounted.current ||
                cancelled ||
                generation !== generationRef.current ||
                currentUserId.current !== user.id
              )
                return;
              setStatus(reconciled);
              await syncCanonical(user.id, reconciled.isActive);
            })
            .catch(() =>
              console.warn("[REVENUECAT_STATE]", { event: "store_reconciliation_failed" }),
            );
        }
      } catch (cause) {
        if (
          mounted.current &&
          currentUserId.current === user?.id &&
          generation === generationRef.current
        )
          setInitializationError(
            cause instanceof Error ? cause.message : "subscription_unavailable",
          );
      } finally {
        clearTimeout(hydrationTimeout);
        if (
          mounted.current &&
          currentUserId.current === user?.id &&
          generation === generationRef.current
        )
          setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      offeringsRequest.current?.abort();
      generationRef.current += 1;
      clearTimeout(hydrationTimeout);
      removeListener?.();
    };
  }, [adapter, authLoading, user?.id, syncCanonical, refreshUsage]);

  const loadOfferings = useCallback(async () => {
    if (!mounted.current || currentUserId.current !== user?.id) return;
    offeringsRequest.current?.abort();
    const generation = generationRef.current;
    const request = new AbortController();
    offeringsRequest.current = request;
    const userId = user?.id;
    const current = () =>
      mounted.current &&
      generation === generationRef.current &&
      !request.signal.aborted &&
      currentUserId.current === userId;
    setPackages([]);
    setOfferingsState((previous) => (previous === "idle" ? "loading" : "retrying"));
    setOfferingsError(null);
    setOfferingsPhase("initializing");
    let initialized = false;
    try {
      if (!userId) throw new Error("revenuecat_user_id_missing");
      await withSubscriptionTimeout(
        adapter.configure(userId, request.signal),
        SUBSCRIPTION_HYDRATION_TIMEOUT_MS,
        "subscription_initialization_timeout",
      );
      if (!current()) return;
      initialized = true;
      setOfferingsPhase("fetching");
      setInitializationError(null);
      const next = await adapter.getPackages(userId, request.signal);
      if (!current()) return;
      setPackages(next);
      setOfferingsPhase(null);
      setOfferingsState(next.length ? "success" : "empty");
    } catch (cause) {
      if (!current()) return;
      setOfferingsPhase(null);
      const message = cause instanceof Error ? cause.message : "offerings_unavailable";
      if (initialized) {
        setOfferingsError(message);
        setOfferingsState(message === "offerings_timeout" ? "timeout" : "error");
      } else {
        setInitializationError(message);
        setOfferingsState("idle");
      }
      request.abort();
    }
  }, [adapter, user?.id]);

  const purchase = useCallback(
    async (packageId: string): Promise<SubscriptionActionResult> => {
      const userId = user?.id;
      const generation = generationRef.current;
      const request = ++actionRequest.current;
      if (!mounted.current || currentUserId.current !== userId)
        return { outcome: "cancelled", status: null };
      setPurchaseError(null);
      if (!userId) throw new Error("revenuecat_user_id_missing");
      let result: SubscriptionActionResult;
      try {
        result = await adapter.purchase(packageId, userId);
      } catch (cause) {
        if (
          mounted.current &&
          currentUserId.current === userId &&
          generation === generationRef.current &&
          request === actionRequest.current
        )
          setPurchaseError("purchase_failed");
        throw cause;
      }
      if (
        !mounted.current ||
        currentUserId.current !== userId ||
        generation !== generationRef.current ||
        request !== actionRequest.current
      )
        return { outcome: "cancelled", status: null };
      if (result.outcome !== "success") return result;
      setStatus(result.status);
      const synced =
        adapter.id === "revenuecat"
          ? await syncCanonical(userId, result.status.isActive)
          : { confirmed: true, errorCode: undefined };
      if (
        !mounted.current ||
        currentUserId.current !== userId ||
        generation !== generationRef.current ||
        request !== actionRequest.current
      )
        return { outcome: "cancelled", status: null };
      await refreshUsage(userId, generation);
      if (
        !mounted.current ||
        currentUserId.current !== userId ||
        generation !== generationRef.current ||
        request !== actionRequest.current
      )
        return { outcome: "cancelled", status: null };
      return {
        ...result,
        canonicalSynced: synced.confirmed,
        canonicalErrorCode: synced.errorCode,
      };
    },
    [adapter, user?.id, syncCanonical, refreshUsage],
  );

  const restore = useCallback(async (): Promise<SubscriptionActionResult> => {
    const userId = user?.id;
    const generation = generationRef.current;
    const request = ++actionRequest.current;
    if (!mounted.current || currentUserId.current !== userId)
      return { outcome: "cancelled", status: null };
    setRestoreError(null);
    if (!userId) throw new Error("revenuecat_user_id_missing");
    let result: SubscriptionActionResult;
    try {
      result = await adapter.restore(userId);
    } catch (cause) {
      if (
        mounted.current &&
        currentUserId.current === userId &&
        generation === generationRef.current &&
        request === actionRequest.current
      )
        setRestoreError("restore_failed");
      throw cause;
    }
    if (
      !mounted.current ||
      currentUserId.current !== userId ||
      generation !== generationRef.current ||
      request !== actionRequest.current
    )
      return { outcome: "cancelled", status: null };
    if (result.outcome !== "success") return result;
    const synced =
      adapter.id === "revenuecat"
        ? await syncCanonical(userId, result.status.isActive, true)
        : { confirmed: true, errorCode: undefined };
    if (
      !mounted.current ||
      currentUserId.current !== userId ||
      generation !== generationRef.current ||
      request !== actionRequest.current
    )
      return { outcome: "cancelled", status: null };
    if (!isSubscriptionOwnershipErrorCode(synced.errorCode)) setStatus(result.status);
    await refreshUsage(userId, generation);
    if (
      !mounted.current ||
      currentUserId.current !== userId ||
      generation !== generationRef.current ||
      request !== actionRequest.current
    )
      return { outcome: "cancelled", status: null };
    return {
      ...result,
      canonicalSynced: synced.confirmed,
      canonicalErrorCode: synced.errorCode,
    };
  }, [adapter, user?.id, syncCanonical, refreshUsage]);
  const visibleStatus = matchesUser
    ? subscriptionStatusForDisplay(status, user?.id, ownershipBlocked)
    : null;
  const checkFeature = useCallback(
    (feature: SubscriptionFeature): FeatureGateResult =>
      canUseFeature(
        visibleStatus ?? UNKNOWN_SUBSCRIPTION_STATUS,
        matchesUser ? usage : readLocalUsage(),
        feature,
      ),
    [matchesUser, usage, visibleStatus],
  );
  const recordUsage = useCallback(
    (feature: SubscriptionFeature) => setUsage((prev) => incrementUsage(feature, prev)),
    [],
  );
  const value = useMemo(
    () => ({
      purchasesSupported: adapter.id === "revenuecat",
      status: visibleStatus,
      packages: matchesUser ? packages : [],
      usage: matchesUser ? usage : readLocalUsage(),
      loading: matchesUser ? loading : true,
      offeringsLoading,
      offeringsPhase,
      offeringsState,
      initializationError: matchesUser ? initializationError : null,
      offeringsError: matchesUser ? offeringsError : null,
      purchaseError: matchesUser ? purchaseError : null,
      restoreError: matchesUser ? restoreError : null,
      canonicalSyncError: matchesUser ? canonicalSyncError : null,
      canonicalSyncLoading: matchesUser && canonicalSyncLoading,
      ownershipBlocked: matchesUser && ownershipBlocked,
      checkFeature,
      recordUsage,
      refresh,
      loadOfferings,
      purchase,
      restore,
      canonicalRevision,
    }),
    [
      matchesUser,
      packages,
      usage,
      loading,
      offeringsLoading,
      offeringsPhase,
      offeringsState,
      initializationError,
      offeringsError,
      purchaseError,
      restoreError,
      canonicalSyncError,
      canonicalSyncLoading,
      ownershipBlocked,
      visibleStatus,
      checkFeature,
      recordUsage,
      refresh,
      loadOfferings,
      purchase,
      restore,
      canonicalRevision,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useSubscription() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSubscription must be used within SubscriptionProvider");
  return ctx;
}
