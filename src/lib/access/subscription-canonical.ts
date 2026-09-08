import { isDeveloperBuildEnabled } from "@/lib/access/developer";
import { readMockSubscriptionTier, readTestModeOverride } from "@/lib/access/storage";
import type { SubscriptionState, TestModeOverride } from "@/lib/access/types";
import { FREE_PLUS_ENTITLEMENT, type PlusEntitlementSnapshot } from "@/lib/plan-tier/entitlement";

export type SubscriptionStateSource = "initial" | "supabase" | "dev_override" | "optimistic";

/** 單一訂閱狀態來源 — AccessProvider 持有此結構 */
export type CanonicalSubscriptionState = {
  tier: SubscriptionState;
  source: SubscriptionStateSource;
  /** Server/Supabase resolver output; the client never recomputes entitlement. */
  entitlement: PlusEntitlementSnapshot;
  /** 僅 dev/debug：localStorage test-mode-override */
  devOverride: TestModeOverride;
  /** 遞增版本；較舊的非同步回寫一律忽略 */
  version: number;
  /** 首次 Supabase hydrate 完成 */
  hydrated: boolean;
};

export function createInitialCanonicalState(): CanonicalSubscriptionState {
  const devOverride = readTestModeOverride();
  const state: CanonicalSubscriptionState = {
    tier: "free",
    source: "initial",
    entitlement: { ...FREE_PLUS_ENTITLEMENT },
    devOverride,
    version: 0,
    hydrated: false,
  };
  console.info("[SUBSCRIPTION_STATE_INIT]", serializeCanonical(state));
  return state;
}

export function serializeCanonical(state: CanonicalSubscriptionState): string {
  return JSON.stringify({
    tier: state.tier,
    source: state.source,
    entitlement: state.entitlement,
    devOverride: state.devOverride,
    version: state.version,
    hydrated: state.hydrated,
  });
}

/**
 * 由 canonical state 解析 UI 是否為 Plus。
 * 優先序：dev override（僅 dev build）→ optimistic → supabase profile → free
 * 未 hydrate 前一律 Free，避免 Free 使用者短暫看到 Plus 卡片。
 */
export function resolveHasPlusAccess(state: CanonicalSubscriptionState): boolean {
  const devBuild = isDeveloperBuildEnabled();

  if (devBuild && state.devOverride === "force-free") return false;
  if (devBuild && state.devOverride === "force-plus") return true;

  if (state.source === "optimistic") return state.tier === "plus";

  if (!state.hydrated) return false;

  if (state.entitlement.hasPlus) return true;

  return false;
}

export function resolveEffectiveTier(state: CanonicalSubscriptionState): SubscriptionState {
  return resolveHasPlusAccess(state) ? "plus" : "free";
}

export function applyOptimisticTier(
  prev: CanonicalSubscriptionState,
  tier: SubscriptionState,
): CanonicalSubscriptionState {
  const nextVersion = prev.version + 1;
  const next: CanonicalSubscriptionState = {
    ...prev,
    tier,
    source: "optimistic",
    devOverride: readTestModeOverride(),
    version: nextVersion,
    hydrated: true,
  };
  console.info(`[SUBSCRIPTION_STATE_OPTIMISTIC_UPDATE] tier=${tier} version=${nextVersion}`);
  return next;
}

export function applySupabaseProfile(
  prev: CanonicalSubscriptionState,
  entitlement: PlusEntitlementSnapshot,
  syncVersion: number,
): CanonicalSubscriptionState {
  if (prev.source === "optimistic" && syncVersion <= prev.version) {
    console.info(
      `[SUBSCRIPTION_STATE_STALE_IGNORED] syncVersion=${syncVersion} currentVersion=${prev.version} source=${prev.source}`,
    );
    return prev;
  }

  if (prev.source === "optimistic" && prev.tier === "free" && entitlement.hasPlus) {
    console.info(
      `[SUBSCRIPTION_STATE_STALE_IGNORED] reason=optimistic_free_pending_sync syncVersion=${syncVersion}`,
    );
    return prev;
  }

  if (prev.source === "optimistic" && prev.tier === "plus" && !entitlement.hasPlus) {
    console.info(
      `[SUBSCRIPTION_STATE_STALE_IGNORED] reason=optimistic_plus_pending_sync syncVersion=${syncVersion}`,
    );
    return prev;
  }

  const tier: SubscriptionState = entitlement.hasPlus ? "plus" : "free";
  const next: CanonicalSubscriptionState = {
    ...prev,
    tier,
    source: "supabase",
    entitlement,
    devOverride: readTestModeOverride(),
    version: Math.max(prev.version, syncVersion),
    hydrated: true,
  };
  console.info(
    `[SUBSCRIPTION_STATE_SUPABASE_SYNC] hasPlus=${entitlement.hasPlus} source=${entitlement.effectiveSource} tier=${tier} version=${next.version}`,
  );
  return next;
}

export function applyDevOverrideFromStorage(
  prev: CanonicalSubscriptionState,
): CanonicalSubscriptionState {
  const devOverride = readTestModeOverride();
  if (devOverride === prev.devOverride) return prev;

  const tier =
    devOverride === "force-plus"
      ? "plus"
      : devOverride === "force-free"
        ? "free"
        : prev.entitlement.hasPlus
          ? "plus"
          : "free";

  return {
    ...prev,
    devOverride,
    tier,
    source: devOverride !== "none" ? "dev_override" : prev.source,
    version: prev.version + 1,
    hydrated: true,
  };
}

/** dev/debug 面板用：mock localStorage tier */
export function readDevMockTier(): SubscriptionState {
  return readMockSubscriptionTier();
}
