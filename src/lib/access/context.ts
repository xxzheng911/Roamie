import type { RoamieRequestContext } from "@/lib/ai/context";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { SubscriptionState } from "./types";

function stripPlusPreferences(prefs?: TravelPreferences): TravelPreferences | undefined {
  if (!prefs) return undefined;
  return {
    pace: prefs.pace,
    vibe: prefs.vibe,
    budgetMode: prefs.budgetMode,
    budget: prefs.budget,
    avoid: prefs.avoid,
    interests: prefs.interests,
    onboarded: prefs.onboarded,
    personalityType: undefined,
    personalitySummary: undefined,
  };
}

/** Remove Plus-only AI context for free tier */
export function applyTierToAiContext(
  ctx: RoamieRequestContext,
  tier: SubscriptionState = ctx.planTier ?? "free",
): RoamieRequestContext {
  if (tier === "plus") {
    return { ...ctx, planTier: "plus" };
  }
  return {
    ...ctx,
    planTier: "free",
    preferences: stripPlusPreferences(ctx.preferences),
    savedPlaceNames: undefined,
    longTermMemory: undefined,
  };
}
