import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import {
  savePreferencesLocally,
  serializePreferencesSyncError,
  type TravelPreferences,
} from "@/lib/preferences-storage";
import { syncTravelQuizResultToSupabase } from "@/lib/profile-storage";
import { scheduleBackgroundTravelQuizSync } from "@/lib/travel-pref-sync";

export type TravelQuizAnswers = {
  pace?: TravelPreferences["pace"];
  avoid?: string[];
  vibe?: TravelPreferences["vibe"];
  budgetMode?: TravelPreferences["budgetMode"];
};

export function logTravelQuizSaveError(error: unknown): void {
  const row = serializePreferencesSyncError(error);
  console.error("[TRAVEL_QUIZ_SAVE_ERROR]", {
    code: row.code ?? "",
    message: row.message ?? String(error),
    details: row.details ?? "",
    hint: row.hint ?? "",
  });
}

/** 本機優先儲存（可覆蓋舊測驗結果）；失敗時仍寫入 memory cache */
export function saveTravelQuizResultLocally(input: {
  prefs: TravelPreferences;
  resultName: string;
  answers: TravelQuizAnswers;
  userId?: string | null;
}): TravelPreferences {
  const userId = input.userId ?? readCachedAuthenticatedUserIdSync();
  console.info("[TRAVEL_QUIZ_SAVE_REQUEST]", {
    userId: userId ?? "",
    resultName: input.resultName,
    answers: input.answers,
  });

  const saved = savePreferencesLocally(input.prefs, userId);
  console.info("[TRAVEL_QUIZ_SAVE_SUCCESS]", {
    resultName: input.resultName,
    phase: "local",
  });
  return saved;
}

/** 背景 upsert Supabase（第一次新增 / 重新測驗覆蓋）；timeout 後最多重試一次 */
export function syncTravelQuizResultInBackground(
  input: {
    prefs: TravelPreferences;
    resultName: string;
  },
  options?: { timeoutMs?: number },
): void {
  scheduleBackgroundTravelQuizSync(
    () =>
      syncTravelQuizResultToSupabase(
        {
          travelStyle: input.resultName,
          prefs: input.prefs,
        },
        { background: true, timeoutMs: options?.timeoutMs },
      ),
    "travel-quiz-save",
  );
}
