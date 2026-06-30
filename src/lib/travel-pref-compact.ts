import type { BudgetMode, TravelPreferences } from "@/lib/preferences-storage";
import { resolveBudgetMode } from "@/lib/preferences-storage";
import type { PersistedTravelPrefResult } from "@/lib/travel-pref-result-cache";

/** Capacitor Preferences 只存輕量摘要（不可超過 4KB） */
export type NativeTravelPrefSummary = {
  userId?: string;
  completed: boolean;
  travelStyleName: string;
  travelStyleId: string;
  pace?: TravelPreferences["pace"];
  vibe?: TravelPreferences["vibe"];
  budget?: BudgetMode;
  tags: string[];
  updatedAt: string;
};

export function mergeTravelPrefFields(
  preferred: TravelPreferences,
  secondary: TravelPreferences = {},
): TravelPreferences {
  return {
    ...secondary,
    ...preferred,
    onboarded: Boolean(preferred.onboarded || secondary.onboarded),
    pace: preferred.pace ?? secondary.pace,
    vibe: preferred.vibe ?? secondary.vibe,
    budgetMode:
      preferred.budgetMode ??
      secondary.budgetMode ??
      (preferred.budget ? resolveBudgetMode(preferred) : undefined) ??
      (secondary.budget ? resolveBudgetMode(secondary) : undefined),
    personalityType: preferred.personalityType?.trim()
      ? preferred.personalityType
      : secondary.personalityType,
    personalitySummary: preferred.personalitySummary?.trim()
      ? preferred.personalitySummary
      : secondary.personalitySummary,
    avoid: preferred.avoid?.length ? preferred.avoid : secondary.avoid,
    interests: preferred.interests?.length ? preferred.interests : secondary.interests,
    updated_at: preferred.updated_at ?? secondary.updated_at,
  };
}

export function hasCompleteTravelPrefSummary(prefs: TravelPreferences): boolean {
  return Boolean(prefs.onboarded && prefs.pace && prefs.vibe);
}

export function compactTravelPreferences(prefs: TravelPreferences): TravelPreferences {
  const compact: TravelPreferences = {};
  if (prefs.pace) compact.pace = prefs.pace;
  if (prefs.vibe) compact.vibe = prefs.vibe;
  if (prefs.budgetMode) compact.budgetMode = prefs.budgetMode;
  else if (prefs.budget) compact.budgetMode = resolveBudgetMode(prefs);
  if (prefs.avoid?.length) compact.avoid = prefs.avoid.filter(Boolean).slice(0, 12);
  if (prefs.onboarded) compact.onboarded = true;
  if (prefs.personalityType?.trim()) {
    compact.personalityType = prefs.personalityType.trim().slice(0, 64);
  }
  if (prefs.personalitySummary?.trim()) {
    compact.personalitySummary = prefs.personalitySummary.trim().slice(0, 280);
  }
  compact.updated_at = prefs.updated_at ?? new Date().toISOString();
  return compact;
}

export function buildNativeTravelPrefSummary(
  snapshot: Pick<
    PersistedTravelPrefResult,
    | "travelStyle"
    | "travelStyleId"
    | "pace"
    | "vibe"
    | "budget"
    | "tags"
    | "quizCompleted"
    | "updatedAt"
    | "userId"
    | "prefs"
  >,
  userId?: string | null,
): NativeTravelPrefSummary {
  const prefs = snapshot.prefs ?? {};
  const travelStyleName = snapshot.travelStyle?.trim() || prefs.personalityType?.trim() || "";
  const travelStyleId =
    snapshot.travelStyleId?.trim() || prefs.personalityType?.trim() || travelStyleName;
  return {
    userId: userId ?? snapshot.userId ?? undefined,
    completed: Boolean(snapshot.quizCompleted || prefs.onboarded),
    travelStyleName,
    travelStyleId,
    pace: snapshot.pace ?? prefs.pace,
    vibe: snapshot.vibe ?? prefs.vibe,
    budget: snapshot.budget ?? resolveBudgetMode(prefs),
    tags: Array.isArray(snapshot.tags) ? snapshot.tags.filter(Boolean).slice(0, 8) : [],
    updatedAt: snapshot.updatedAt || prefs.updated_at || new Date().toISOString(),
  };
}

export function travelPreferencesFromNativeSummary(
  summary: NativeTravelPrefSummary,
): TravelPreferences {
  if (!summary.completed) return {};
  return compactTravelPreferences({
    onboarded: true,
    personalityType: summary.travelStyleId || summary.travelStyleName,
    personalitySummary: "",
    pace: summary.pace,
    vibe: summary.vibe,
    budgetMode: summary.budget,
    updated_at: summary.updatedAt,
  });
}

export function snapshotFromNativeSummary(
  summary: NativeTravelPrefSummary,
): PersistedTravelPrefResult {
  const prefs = travelPreferencesFromNativeSummary(summary);
  const travelStyle = summary.travelStyleName || summary.travelStyleId;
  return {
    userId: summary.userId,
    prefs,
    travelStyle,
    travelStyleName: travelStyle,
    travelStyleId: summary.travelStyleId || travelStyle,
    pace: summary.pace ?? prefs.pace,
    vibe: summary.vibe ?? prefs.vibe,
    budget: summary.budget ?? resolveBudgetMode(prefs),
    tags: summary.tags ?? [],
    quizCompleted: summary.completed,
    plusQuizCompleted: summary.completed,
    updatedAt: summary.updatedAt,
  };
}

export function shrinkNativeTravelPrefSummary(summary: NativeTravelPrefSummary): NativeTravelPrefSummary {
  return {
    userId: summary.userId,
    completed: summary.completed,
    travelStyleName: summary.travelStyleName.slice(0, 48),
    travelStyleId: summary.travelStyleId.slice(0, 48),
    pace: summary.pace,
    vibe: summary.vibe,
    budget: summary.budget,
    tags: summary.tags.slice(0, 4).map((t) => t.slice(0, 24)),
    updatedAt: summary.updatedAt,
  };
}

export function isValidNativeTravelPrefSummary(value: unknown): value is NativeTravelPrefSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as NativeTravelPrefSummary;
  if (!row.completed) return false;
  return Boolean(row.travelStyleName?.trim() || row.travelStyleId?.trim());
}
