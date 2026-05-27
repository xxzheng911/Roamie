import type { BudgetMode, TravelPreferences } from "@/lib/preferences-storage";

export const SURVEY_TOTAL_STEPS = 5;

export type SurveyCompanionship = "solo" | "couple" | "friends" | "family" | "flexible";

export type SurveyAnswers = {
  pace?: TravelPreferences["pace"];
  vibe?: TravelPreferences["vibe"];
  budgetMode?: BudgetMode;
  interests?: string[];
  companionship?: SurveyCompanionship;
};

export type SurveyResultProfile = {
  personalityType: string;
  personalitySummary: string;
  personalityImpression: string;
  travelStyle: string;
  preferenceTypes: string[];
  recommendedStyle: string;
  suitableDirections: string[];
  aiRecommendationSummary: string;
  travelTags: string[];
};

export type TravelPreferenceSurveyPhase = "quiz" | "result";

export type TravelPreferenceSurveyState = {
  currentStep: number;
  totalSteps: number;
  answers: SurveyAnswers;
  isCompleted: boolean;
  completedAt: string | null;
  resultProfile: SurveyResultProfile | null;
  /** 結果頁已顯示但尚未按「完成設定」寫入 */
  pendingSave: boolean;
  loading: boolean;
  error: string | null;
  phase: TravelPreferenceSurveyPhase;
  returnTo: string;
  sessionActive: boolean;
};
