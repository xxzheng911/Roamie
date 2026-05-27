import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { broadcastPreferencesUpdate } from "@/lib/preference-events";

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

export async function isPreferenceQuizCompleted(): Promise<boolean> {
  const prefs = await getPreferences();
  return Boolean(prefs.onboarded);
}

export async function getPreferences(): Promise<TravelPreferences> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return {};

  const { data, error } = await supabase
    .from("profiles")
    .select("travel_personality")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.travel_personality ?? {}) as TravelPreferences;
}

export async function savePreferences(prefs: TravelPreferences): Promise<TravelPreferences> {
  const merged = { ...(await getPreferences()), ...prefs, updated_at: new Date().toISOString() };
  const userId = await getAuthenticatedUserId();
  if (!userId) throw new Error("請先登入");

  await ensureUserProfile();
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, travel_personality: merged as never }, { onConflict: "id" });
  if (error) {
    // 某些環境的 profiles table trigger 會引用不存在的 updated_at 欄位，導致更新失敗。
    // 此時仍允許完成測驗：改存本機（下次可再嘗試同步）。
    const msg = error.message ?? "";
    if (/record\s+\"new\"\s+has\s+no\s+field\s+\"updated_at\"/i.test(msg)) {
      console.warn("[prefs] Supabase profile schema mismatch, falling back to localStorage", msg);
      writeGuest(merged);
      broadcastPreferencesUpdate(merged);
      return merged;
    }
    throw new Error(error.message);
  }
  broadcastPreferencesUpdate(merged);
  return merged;
}

/** Dev-only: clear preference quiz completion for first-run testing */
export async function resetPreferenceQuizForDev(): Promise<void> {
  if (!import.meta.env.DEV) return;

  const userId = await getAuthenticatedUserId();
  if (userId) {
    const current = await getPreferences();
    const { onboarded: _removed, ...rest } = current;
    await savePreferences({ ...rest, onboarded: false });
    return;
  }

  const local = readGuest();
  delete local.onboarded;
  writeGuest(local);
  broadcastPreferencesUpdate(local);
}
