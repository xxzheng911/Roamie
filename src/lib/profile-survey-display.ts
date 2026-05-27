import {
  BUDGET_MODE_LABELS,
  resolveBudgetMode,
  type BudgetMode,
  type TravelPreferences,
} from "@/lib/preferences-storage";
import type { ProfileExtras, UserProfile } from "@/lib/profile-storage";

const PACE_LABEL: Record<NonNullable<TravelPreferences["pace"]>, string> = {
  slow: "慢",
  medium: "適中",
  active: "緊湊",
};

const VIBE_LABEL: Record<NonNullable<TravelPreferences["vibe"]>, string> = {
  quiet: "安靜",
  either: "平衡",
  lively: "熱鬧",
};

function normalizePace(raw: string | undefined): TravelPreferences["pace"] | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "slow" || /慢/.test(v)) return "slow";
  if (v === "active" || /緊湊|快|探索/.test(v)) return "active";
  if (v === "medium" || /適中|中等|剛好/.test(v)) return "medium";
  return undefined;
}

function normalizeBudgetMode(raw: string | undefined): BudgetMode | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "budget" || v === "shoestring" || /小資/.test(v)) return "budget";
  if (v === "luxury" || v === "premium" || /奢華/.test(v)) return "luxury";
  if (v === "quality" || /質感/.test(v)) return "quality";
  if (v === "standard" || v === "comfortable" || /一般/.test(v)) return "standard";
  return undefined;
}

function normalizeVibe(raw: string | undefined): TravelPreferences["vibe"] | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "quiet" || /安靜/.test(v)) return "quiet";
  if (v === "lively" || /熱鬧|嗨/.test(v)) return "lively";
  if (v === "either" || /平衡|都可以|適中/.test(v)) return "either";
  return undefined;
}

function inferPaceFromTags(tags: string[]): TravelPreferences["pace"] | undefined {
  if (tags.some((t) => /慢步|慢行|慢旅|留白/.test(t))) return "slow";
  if (tags.some((t) => /緊湊|探索|多看/.test(t))) return "active";
  if (tags.some((t) => /適中|中等|剛好/.test(t))) return "medium";
  return undefined;
}

function inferVibeFromTags(tags: string[]): TravelPreferences["vibe"] | undefined {
  if (tags.some((t) => /安靜/.test(t))) return "quiet";
  if (tags.some((t) => /熱鬧/.test(t))) return "lively";
  if (tags.some((t) => /平衡/.test(t))) return "either";
  return undefined;
}

export type ProfileSurveyDisplay = {
  paceKey: NonNullable<TravelPreferences["pace"]>;
  vibeKey: NonNullable<TravelPreferences["vibe"]>;
  budgetMode: BudgetMode;
  paceLabel: string;
  vibeLabel: string;
  budgetLabel: string;
};

/** 從 profile / survey / ai_preferences 推導主卡片與測驗卡共用的步調、氣氛、預算文案 */
export function resolveProfileSurveyDisplay(profile: UserProfile): ProfileSurveyDisplay | null {
  const completed = Boolean(
    profile.surveyCompleted ?? profile.prefs.surveyCompleted ?? profile.prefs.onboarded,
  );
  if (!completed) return null;

  const extras = (profile.aiPreferences ?? {}) as ProfileExtras;
  const tags = profile.travelTags.length > 0 ? profile.travelTags : (profile.prefs.interests ?? []);

  const paceKey =
    profile.prefs.pace ??
    normalizePace(extras.pacePreference) ??
    inferPaceFromTags(tags) ??
    "medium";

  const vibeKey =
    profile.prefs.vibe ??
    normalizeVibe(extras.vibePreference) ??
    inferVibeFromTags(tags) ??
    "either";

  const resolvedBudget = resolveBudgetMode({
    ...profile.prefs,
    budgetMode:
      profile.prefs.budgetMode ??
      normalizeBudgetMode(extras.budgetPreference) ??
      inferBudgetFromTags(tags),
  });

  return {
    paceKey,
    vibeKey,
    budgetMode: resolvedBudget,
    paceLabel: PACE_LABEL[paceKey],
    vibeLabel: VIBE_LABEL[vibeKey],
    budgetLabel: BUDGET_MODE_LABELS[resolvedBudget],
  };
}

function inferBudgetFromTags(tags: string[]): BudgetMode | undefined {
  if (tags.some((t) => /小資/.test(t))) return "budget";
  if (tags.some((t) => /奢華/.test(t))) return "luxury";
  if (tags.some((t) => /質感/.test(t))) return "quality";
  if (tags.some((t) => /一般/.test(t))) return "standard";
  return undefined;
}

/** Plus 測驗／人格／標籤是否可在個人頁 UI 顯示 */
export function canShowPlusSurveyOnProfile(hasPlusAccess: boolean): boolean {
  return hasPlusAccess;
}

/** 主卡片副標：僅 Plus 顯示測驗人格或 travel_style（Free 只保留 bio） */
export function resolveProfilePlusPersonalityLine(
  hasPlusAccess: boolean,
  travelStyle: string,
  personalityType: string,
): string | null {
  if (!canShowPlusSurveyOnProfile(hasPlusAccess)) return null;
  const line = travelStyle.trim() || personalityType.trim();
  return line || null;
}

export function logProfileSurveyDiagnostics(
  profile: UserProfile,
  display: ProfileSurveyDisplay | null,
): void {
  const completed = Boolean(
    profile.surveyCompleted ?? profile.prefs.surveyCompleted ?? profile.prefs.onboarded,
  );
  console.info("[PROFILE_SURVEY] loaded=", completed);
  console.info(
    "[PROFILE_SURVEY] travel_style=",
    profile.travelStyle || profile.personalityType || "(none)",
  );
  console.info(
    "[PROFILE_SURVEY] tags=",
    profile.travelTags.length ? profile.travelTags.join("、") : "(none)",
  );
  console.info("[PROFILE_SURVEY] displayMapped=", Boolean(display));
}
