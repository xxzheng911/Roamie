import { getAuthenticatedUserId } from "@/lib/auth-session";
import { getUserPlanProfile } from "@/lib/plan-tier/storage";
import { mergeTravelPreferencesFromProfileRow } from "@/lib/travel-preference-survey-save";
import type { ProfileSurveyRow } from "@/lib/travel-preference-survey-save";
import { buildTravelProfileFields, formatTravelProfileForAi } from "@/lib/travel-profile-for-ai";
import { resolveFashionStyle } from "@/lib/outfit/resolve-style";
import { supabase } from "@/integrations/supabase/client";

const PROFILE_OUTFIT_SELECT =
  "travel_style, travel_preferences, travel_tags, survey_completed, survey_completed_at, ai_preferences, plan_tier, subscription_status";

export type OutfitUserContext = {
  hasPlusAccess: boolean;
  travelProfileText: string;
  fashionStyle?: string;
  travelTags: string[];
  travelPreferences: string[];
};

export async function loadOutfitUserContext(): Promise<OutfitUserContext> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return {
      hasPlusAccess: false,
      travelProfileText: "（尚未登入，僅提供基本穿搭建議）",
      travelTags: [],
      travelPreferences: [],
    };
  }

  const plan = await getUserPlanProfile(userId);
  const hasPlusAccess =
    plan.planTier === "plus" &&
    (plan.subscriptionStatus === "active" || plan.subscriptionStatus === "trialing");

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_OUTFIT_SELECT)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[TripOutfit] profile read failed", error.message);
    return {
      hasPlusAccess,
      travelProfileText: "（讀取偏好失敗，僅提供基本穿搭建議）",
      travelTags: [],
      travelPreferences: [],
    };
  }

  const row = data as ProfileSurveyRow | null;
  const prefs = mergeTravelPreferencesFromProfileRow(userId, row);
  const fields = buildTravelProfileFields(row, prefs);
  const travelProfileText = hasPlusAccess
    ? formatTravelProfileForAi(fields, prefs, { includePersonalityType: true })
    : fields.surveyCompleted
      ? `旅行風格：${fields.travelStyle || "一般"}。依當日天氣與行程提供實用穿搭建議（不含人格測驗名稱）。`
      : "（尚未完成旅行偏好測驗）";

  const fashionStyle = resolveFashionStyle({
    travelStyle: fields.travelStyle,
    interests: fields.travelPreferences,
  });

  return {
    hasPlusAccess,
    travelProfileText,
    fashionStyle,
    travelTags: fields.travelTags,
    travelPreferences: fields.travelPreferences,
  };
}
