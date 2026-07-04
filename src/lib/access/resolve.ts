import type { PlanTier } from "@/lib/plan-tier/types";
import { getUserPlanProfile } from "@/lib/plan-tier/storage";
import type { AccessSnapshot, SubscriptionState, TestModeOverride, UserRole } from "./types";
import { canShowDeveloperTools, isDeveloperAccount } from "./developer";
import {
  readMockSubscriptionTier,
  readTestModeOverride,
  writeMockSubscriptionTier,
  writeTestModeOverride,
} from "./storage";
import { broadcastAccessChange } from "./events";
import {
  type CanonicalSubscriptionState,
  resolveEffectiveTier as resolveTierFromCanonical,
  resolveHasPlusAccess,
} from "./subscription-canonical";

function resolveEffectiveTier(
  subscriptionState: SubscriptionState,
  _isDeveloper: boolean,
  testOverride: TestModeOverride,
  subscriptionPlusActive: boolean,
): SubscriptionState {
  if (testOverride === "force-free") return "free";
  if (testOverride === "force-plus") return "plus";
  if (subscriptionPlusActive) return "plus";
  return subscriptionState;
}

export type BuildAccessSnapshotOptions = {
  /** profiles.plan_tier === 'plus' 且 subscription_status 為 active/trialing */
  profilePlusActive?: boolean;
};

/**
 * isPlusUser ≈ subscriptionPlusActive || devPlusMode（force-free 時一律為 Free）
 */
export function buildAccessSnapshot(
  email?: string | null,
  options?: BuildAccessSnapshotOptions,
): AccessSnapshot {
  const subscriptionState = readMockSubscriptionTier();
  const testModeOverride = readTestModeOverride();
  const developerUnlocked = isDeveloperAccount(email);
  const userRole: UserRole = developerUnlocked ? "developer" : "user";
  const subscriptionPlusActive = options?.profilePlusActive ?? false;
  const devPlusMode = testModeOverride === "force-plus";
  const effectiveTier = resolveEffectiveTier(
    subscriptionState,
    developerUnlocked,
    testModeOverride,
    subscriptionPlusActive,
  );
  const hasPlusAccess = effectiveTier === "plus";
  /** subscriptionPlusActive || devPlusMode（force-free 覆寫時為 false） */
  const isPlusUser = hasPlusAccess;
  const devSubscriptionMode: SubscriptionState =
    testModeOverride === "force-free"
      ? "free"
      : testModeOverride === "force-plus"
        ? "plus"
        : subscriptionState;

  return {
    subscriptionState,
    userRole,
    testModeOverride,
    hasPlusAccess,
    isPlusUser,
    devPlusMode,
    devSubscriptionMode,
    subscriptionPlusActive,
    effectiveTier,
    developerUnlocked,
    canShowDeveloperTools: canShowDeveloperTools(email),
  };
}

/** 由 canonical subscription state 建立 AccessSnapshot（首頁／全 app 唯一入口） */
export function buildAccessSnapshotFromCanonical(
  email: string | null | undefined,
  canonical: CanonicalSubscriptionState,
): AccessSnapshot {
  const subscriptionState = readMockSubscriptionTier();
  const testModeOverride = canonical.devOverride;
  const developerUnlocked = isDeveloperAccount(email);
  const userRole: UserRole = developerUnlocked ? "developer" : "user";
  const subscriptionPlusActive = canonical.profilePlusActive;
  const devPlusMode = testModeOverride === "force-plus";
  const hasPlusAccess = resolveHasPlusAccess(canonical);
  const effectiveTier = resolveTierFromCanonical(canonical);
  const devSubscriptionMode: SubscriptionState =
    testModeOverride === "force-free"
      ? "free"
      : testModeOverride === "force-plus"
        ? "plus"
        : subscriptionState;

  return {
    subscriptionState,
    userRole,
    testModeOverride,
    hasPlusAccess,
    isPlusUser: hasPlusAccess,
    devPlusMode,
    devSubscriptionMode,
    subscriptionPlusActive,
    effectiveTier,
    developerUnlocked,
    canShowDeveloperTools: canShowDeveloperTools(email),
    subscriptionSource: canonical.source,
    subscriptionHydrated: canonical.hydrated,
  };
}

/** Sync client read — used before AI requests */
export function resolveClientEffectiveTier(email?: string | null): PlanTier {
  return buildAccessSnapshot(email).effectiveTier;
}

/** Async — merges mock tier with Supabase profile when subscribed */
export async function resolveEffectivePlanTierWithProfile(
  email?: string | null,
): Promise<PlanTier> {
  const snapshot = buildAccessSnapshot(email);
  if (snapshot.developerUnlocked) return snapshot.effectiveTier;

  const plan = await getUserPlanProfile();
  if (
    plan.planTier === "plus" &&
    (plan.subscriptionStatus === "active" || plan.subscriptionStatus === "trialing")
  ) {
    return "plus";
  }

  return snapshot.effectiveTier;
}

export function setMockSubscriptionTier(tier: SubscriptionState): void {
  writeMockSubscriptionTier(tier);
  broadcastAccessChange();
}

export function setTestModeOverride(mode: TestModeOverride): void {
  writeTestModeOverride(mode);
  broadcastAccessChange();
}
