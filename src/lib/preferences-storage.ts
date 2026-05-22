import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";

const GUEST_KEY = "roamie:preferences";

/** 小資 / 一般 / 品質感 / 奢華 */
export type BudgetMode = "budget" | "standard" | "quality" | "luxury";

export type TravelPreferences = {
  pace?: "slow" | "medium" | "active";
  avoid?: string[];
  vibe?: "quiet" | "either" | "lively";
  /** @deprecated 請用 budgetMode */
  budget?: "shoestring" | "comfortable" | "premium";
  budgetMode?: BudgetMode;
  interests?: string[];
  onboarded?: boolean;
  personalityType?: string;
  personalitySummary?: string;
  updated_at?: string;
};

export function resolveBudgetMode(prefs?: TravelPreferences): BudgetMode {
  if (prefs?.budgetMode) return prefs.budgetMode;
  if (prefs?.budget === "shoestring") return "budget";
  if (prefs?.budget === "premium") return "luxury";
  if (prefs?.budget === "comfortable") return "standard";
  return "standard";
}

export const BUDGET_MODE_LABELS: Record<BudgetMode, string> = {
  budget: "小資",
  standard: "一般",
  quality: "品質感",
  luxury: "奢華",
};

function readGuest(): TravelPreferences {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeGuest(prefs: TravelPreferences) {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_KEY, JSON.stringify(prefs));
}

export async function getPreferences(): Promise<TravelPreferences> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("travel_personality")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.travel_personality ?? {}) as TravelPreferences;
  }
  return readGuest();
}

export async function savePreferences(prefs: TravelPreferences): Promise<TravelPreferences> {
  const merged = { ...(await getPreferences()), ...prefs, updated_at: new Date().toISOString() };
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: userId, travel_personality: merged as never }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return merged;
  }
  writeGuest(merged);
  return merged;
}
