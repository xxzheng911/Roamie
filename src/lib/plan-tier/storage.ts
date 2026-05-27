import { getAuthenticatedUserId } from "@/lib/auth-session";
import {
  hasSelectedCompanionMode,
  markCompanionModeSelected,
  readSelectedCompanionTier,
} from "@/lib/companion-mode-storage";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_USER_PLAN,
  type PlanTier,
  type SubscriptionProvider,
  type SubscriptionStatus,
  type UserPlanProfile,
} from "./types";

const PLAN_SELECT = "plan_tier, subscription_status, subscription_provider, plus_available, ai_preferences";

function introFromAiPreferences(aiPreferences: unknown): boolean {
  if (!aiPreferences || typeof aiPreferences !== "object") return false;
  return Boolean((aiPreferences as Record<string, unknown>).intro_completed);
}

function companionTierFromAiPreferences(aiPreferences: unknown): PlanTier | null {
  if (!aiPreferences || typeof aiPreferences !== "object") return null;
  const raw = (aiPreferences as Record<string, unknown>).companion_mode;
  return raw === "plus" ? "plus" : raw === "free" ? "free" : null;
}

function parsePlanRow(row: Record<string, unknown> | null | undefined): UserPlanProfile {
  if (!row) return { ...DEFAULT_USER_PLAN };
  const tier = row.plan_tier === "plus" ? "plus" : "free";
  const status = row.subscription_status as SubscriptionStatus;
  const provider = row.subscription_provider as SubscriptionProvider;
  return {
    planTier: tier,
    subscriptionStatus:
      status === "active" || status === "trialing" || status === "expired" ? status : "inactive",
    subscriptionProvider:
      provider === "revenuecat" || provider === "app_store" ? provider : "none",
    plusAvailable: Boolean(row.plus_available),
    introCompleted: introFromAiPreferences(row.ai_preferences),
  };
}

export async function getUserPlanProfile(userId?: string): Promise<UserPlanProfile> {
  const uid = userId ?? (await getAuthenticatedUserId());
  if (!uid) return { ...DEFAULT_USER_PLAN };

  const { data, error } = await supabase.from("profiles").select(PLAN_SELECT).eq("id", uid).maybeSingle();
  if (error) {
    console.warn("[plan-tier] fetch failed, using defaults", error.message);
    return { ...DEFAULT_USER_PLAN };
  }
  return parsePlanRow(data as Record<string, unknown> | null);
}

export async function isIntroCompleted(userId?: string): Promise<boolean> {
  if (hasSelectedCompanionMode()) return true;

  const uid = userId ?? (await getAuthenticatedUserId());
  if (!uid) return false;

  const { data, error } = await supabase
    .from("profiles")
    .select("ai_preferences")
    .eq("id", uid)
    .maybeSingle();
  if (error) {
    console.warn("[plan-tier] intro check failed", error.message);
    return false;
  }

  const prefs = (data as { ai_preferences?: unknown } | null)?.ai_preferences;
  if (!introFromAiPreferences(prefs)) return false;

  // 遠端 profile 僅供查詢；不可覆寫本機 onboarding 完成狀態（裝置級首次體驗）。
  return true;
}

export async function markIntroCompleted(tier: PlanTier = "free"): Promise<void> {
  markCompanionModeSelected(tier);
  const { markOnboardingCompleted } = await import("@/lib/onboarding-storage");
  await markOnboardingCompleted();

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

    const { error } = await supabase
      .from("profiles")
      .update({
        ai_preferences: {
          ...prev,
          intro_completed: true,
          companion_mode: tier,
        } as never,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn("[plan-tier] remote companion mode sync failed", e);
    // Local selection already saved — navigation can proceed.
  }
}

/** 實際 AI 使用的 tier：developer override > mock/IAP plus > free */
export async function resolveEffectivePlanTier(): Promise<PlanTier> {
  if (typeof window !== "undefined") {
    const { resolveEffectivePlanTierWithProfile } = await import("@/lib/access/resolve");
    return resolveEffectivePlanTierWithProfile();
  }

  const plan = await getUserPlanProfile();
  if (plan.planTier === "plus" && (plan.subscriptionStatus === "active" || plan.subscriptionStatus === "trialing")) {
    return "plus";
  }
  return "free";
}
