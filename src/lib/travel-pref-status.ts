import type { TravelPreferences } from "@/lib/preferences-storage";
import { readCachedPreferencesSync } from "@/lib/preferences-storage";
import { mergeTravelPrefFields } from "@/lib/travel-pref-compact";
import {
  getTravelPrefResultSnapshot,
  normalizeTravelPrefSnapshot,
  type PersistedTravelPrefResult,
} from "@/lib/travel-pref-result-cache";

export type TravelPrefStatus = {
  preferenceQuizCompleted: boolean;
  travelStyleName: string;
  personalityType: string;
  personalitySummary: string;
  tags: string[];
  prefs: TravelPreferences;
  snapshot: PersistedTravelPrefResult | null;
  pace?: TravelPreferences["pace"];
  vibe?: TravelPreferences["vibe"];
  budget?: TravelPreferences["budgetMode"];
};

/** 全 app 共用的旅行偏好測驗狀態（Profile / Chat / AI context） */
export function getTravelPrefStatusSync(userId?: string | null): TravelPrefStatus {
  const rawSnapshot = getTravelPrefResultSnapshot(userId);
  const snapshot = rawSnapshot ? normalizeTravelPrefSnapshot(rawSnapshot) : null;
  const cachedPrefs = readCachedPreferencesSync();
  const snapshotPrefs = snapshot?.prefs;

  const preferenceQuizCompleted = Boolean(
    snapshot?.quizCompleted ||
      snapshotPrefs?.onboarded ||
      cachedPrefs.onboarded,
  );

  const mergedPrefs: TravelPreferences = preferenceQuizCompleted
    ? mergeTravelPrefFields(snapshotPrefs ?? {}, mergeTravelPrefFields(cachedPrefs, {}))
    : cachedPrefs;

  if (preferenceQuizCompleted) {
    mergedPrefs.onboarded = true;
    mergedPrefs.personalityType =
      snapshot?.travelStyleId ??
      snapshotPrefs?.personalityType ??
      cachedPrefs.personalityType ??
      snapshot?.travelStyleName ??
      snapshot?.travelStyle ??
      "";
    mergedPrefs.personalitySummary =
      snapshotPrefs?.personalitySummary ?? cachedPrefs.personalitySummary;
  }

  const travelStyleName =
    snapshot?.travelStyleName?.trim() ||
    snapshot?.travelStyle?.trim() ||
    mergedPrefs.personalityType?.trim() ||
    snapshotPrefs?.personalityType?.trim() ||
    "";

  return {
    preferenceQuizCompleted,
    travelStyleName,
    personalityType: travelStyleName || mergedPrefs.personalityType?.trim() || "",
    personalitySummary: mergedPrefs.personalitySummary?.trim() || "",
    tags: snapshot?.tags ?? [],
    prefs: mergedPrefs,
    snapshot,
    pace: snapshot?.pace ?? mergedPrefs.pace,
    vibe: snapshot?.vibe ?? mergedPrefs.vibe,
    budget: snapshot?.budget ?? mergedPrefs.budgetMode,
  };
}

export function mergePreferencesWithTravelPrefStatus(
  prefs: TravelPreferences,
  userId?: string | null,
): TravelPreferences {
  const status = getTravelPrefStatusSync(userId);
  if (!status.preferenceQuizCompleted) return prefs;
  return mergeTravelPrefFields(status.prefs, {
    ...prefs,
    onboarded: true,
    personalityType: status.travelStyleName || prefs.personalityType,
    personalitySummary: status.personalitySummary || prefs.personalitySummary,
  });
}
