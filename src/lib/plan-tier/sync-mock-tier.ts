import { getAuthenticatedUserId } from "@/lib/auth-session";
import { markCompanionModeSelected } from "@/lib/companion-mode-storage";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { supabase } from "@/lib/supabase";
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
  const userId = await getAuthenticatedUserId();
  if (!userId) return;

  try {
    await ensureUserProfile(userId);

    const { data, error: readError } = await supabase
      .from("profiles")
      .select("ai_preferences")
      .eq("id", userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    const prev =
      data?.ai_preferences && typeof data.ai_preferences === "object"
        ? (data.ai_preferences as Record<string, unknown>)
        : {};

    const subscriptionStatus = tier === "plus" ? "active" : "inactive";

    const { error } = await supabase
      .from("profiles")
      .update({
        plan_tier: tier,
        subscription_status: subscriptionStatus,
        subscription_provider: "none",
        ai_preferences: {
          ...prev,
          intro_completed: true,
          companion_mode: tier,
        } as never,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn("[plan-tier] sync mock tier to profile failed", e);
  }
}

export async function applyMockPlanTier(tier: PlanTier): Promise<void> {
  applyLocalMockPlanTier(tier);
  await syncMockPlanTierToProfile(tier);
}
