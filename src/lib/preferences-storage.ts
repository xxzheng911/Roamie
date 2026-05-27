import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { broadcastPreferencesUpdate } from "@/lib/preference-events";
import {
  buildTravelProfileFields,
  type TravelProfileFields,
} from "@/lib/travel-profile-for-ai";
import {
  mergeTravelPreferencesFromProfileRow,
  type ProfileSurveyRow,
} from "@/lib/travel-preference-survey-save";

export type { TravelProfileFields } from "@/lib/travel-profile-for-ai";

let cachedProfileFields: TravelProfileFields | null = null;
import type { SurveyCompanionship, SurveyResultProfile } from "@/lib/travel-preference-survey-types";

const GUEST_KEY = "roamie:preferences";

const PROFILE_PREFS_SELECT =
  "travel_personality, travel_style, travel_preferences, travel_tags, survey_completed, survey_completed_at, ai_preferences";

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
  companionship?: SurveyCompanionship;
  onboarded?: boolean;
  surveyCompleted?: boolean;
  surveyCompletedAt?: string;
  personalityType?: string;
  personalitySummary?: string;
  resultProfile?: SurveyResultProfile;
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
  return Boolean(prefs.surveyCompleted ?? prefs.onboarded);
}

export async function getPreferences(): Promise<TravelPreferences> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return readGuest();

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_PREFS_SELECT)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as ProfileSurveyRow | null;
  const prefs = mergeTravelPreferencesFromProfileRow(userId, row);
  cachedProfileFields = buildTravelProfileFields(row, prefs);
  return prefs;
}

export function getCachedTravelProfileFields(): TravelProfileFields | null {
  return cachedProfileFields;
}

export function setCachedTravelProfileFields(fields: TravelProfileFields | null): void {
  cachedProfileFields = fields;
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
    throw new Error(error.message);
  }
  writeGuest(merged);
  broadcastPreferencesUpdate(merged);
  return merged;
}

/** Dev-only: clear preference quiz completion for first-run testing */
export async function resetPreferenceQuizForDev(): Promise<void> {
  if (!import.meta.env.DEV) return;

  const userId = await getAuthenticatedUserId();
  if (userId) {
    const current = await getPreferences();
    const {
      onboarded: _o,
      surveyCompleted: _s,
      surveyCompletedAt: _at,
      resultProfile: _r,
      ...rest
    } = current;
    await savePreferences({ ...rest, onboarded: false, surveyCompleted: false });
    return;
  }

  const local = readGuest();
  delete local.onboarded;
  writeGuest(local);
  broadcastPreferencesUpdate(local);
}
