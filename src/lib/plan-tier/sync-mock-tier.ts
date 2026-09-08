import { markCompanionModeSelected } from "@/lib/companion-mode-storage";
import {
  broadcastAccessChange,
  clearTestModeOverride,
  isDeveloperBuildEnabled,
  readMockSubscriptionTier,
  readTestModeOverride,
  setMockSubscriptionTier,
  setTestModeOverride,
} from "@/lib/access";
import type { PlanTier } from "./types";

/** 修正舊版 welcome 留下的 force-free / force-plus 與 mock tier 不一致 */
export function reconcileStaleTierLocks(): void {
  if (typeof window === "undefined") return;
  const mock = readMockSubscriptionTier();
  const override = readTestModeOverride();
  if (override === "force-free" && mock === "plus") clearTestModeOverride();
  if (override === "force-plus" && mock === "free") clearTestModeOverride();
}

export function applyLocalMockPlanTier(tier: PlanTier): void {
  if (tier === "free") {
    setMockSubscriptionTier("free");
    markCompanionModeSelected("free");
    if (isDeveloperBuildEnabled()) {
      setTestModeOverride("force-free");
    } else {
      clearTestModeOverride();
    }
    broadcastAccessChange();
    return;
  }

  clearTestModeOverride();
  setMockSubscriptionTier("plus");
  markCompanionModeSelected("plus");
  broadcastAccessChange();
}

export async function syncMockPlanTierToProfile(tier: PlanTier): Promise<void> {
  if (!isDeveloperBuildEnabled()) return;
  console.info("[plan-tier] mock tier remains device-local", { tier });
}

export async function applyMockPlanTier(tier: PlanTier): Promise<void> {
  applyLocalMockPlanTier(tier);
  await syncMockPlanTierToProfile(tier);
}
