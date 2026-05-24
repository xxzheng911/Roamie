import { getAuthenticatedUserId } from "@/lib/auth-session";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { supabase } from "@/lib/supabase";
import { readDebugAiMode } from "./debug-ai-mode";
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
  const plan = await getUserPlanProfile(userId);
  return plan.introCompleted;
}

export async function markIntroCompleted(): Promise<void> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return;
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
    .update({ ai_preferences: { ...prev, intro_completed: true } as never })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

/** 實際 AI 使用的 tier：debug 覆寫 > active plus > free */
export async function resolveEffectivePlanTier(): Promise<PlanTier> {
  const debug = readDebugAiMode();
  if (debug) return debug;

  const plan = await getUserPlanProfile();
  if (plan.planTier === "plus" && (plan.subscriptionStatus === "active" || plan.subscriptionStatus === "trialing")) {
    return "plus";
  }
  return "free";
}
