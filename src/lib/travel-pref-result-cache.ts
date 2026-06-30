import {
  BUDGET_MODE_LABELS,
  readCachedPreferencesSync,
  resolveBudgetMode,
  type BudgetMode,
  type TravelPreferences,
} from "@/lib/preferences-storage";
import { derivePersonality } from "@/lib/personality";
import { detectDeviceLocale } from "@/lib/i18n/detect-locale";
import type { Locale } from "@/lib/i18n/types";
import type { UserProfile } from "@/lib/profile-storage";
import { logPerfTravelPrefLoadSkip } from "@/lib/app-perf";
import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import { mirrorTravelPrefSummaryToNative } from "@/lib/travel-pref-native-persist";
import {
  logTravelPrefCacheWrite,
  logTravelPrefCacheWriteError,
  safeJsonStringify,
  sanitizeForJsonStorage,
  isCorruptedTravelPrefObject,
  LOCAL_TRAVEL_PREF_MAX_BYTES,
} from "@/lib/travel-pref-cache-write";
import { compactTravelPreferences, mergeTravelPrefFields } from "@/lib/travel-pref-compact";

const RESULT_KEY = "roamie:travel-pref-result";

export type PersistedTravelPrefResult = {
  userId?: string;
  prefs: TravelPreferences;
  /** @deprecated 使用 travelStyleName */
  travelStyle: string;
  travelStyleName?: string;
  travelStyleId?: string;
  pace?: TravelPreferences["pace"];
  vibe?: TravelPreferences["vibe"];
  budget?: BudgetMode;
  tags: string[];
  quizCompleted: boolean;
  plusQuizCompleted: boolean;
  updatedAt: string;
};

export function normalizeTravelPrefSnapshot(
  snapshot: PersistedTravelPrefResult,
): PersistedTravelPrefResult {
  const travelStyleName =
    snapshot.travelStyleName?.trim() ||
    snapshot.travelStyle?.trim() ||
    snapshot.prefs.personalityType?.trim() ||
    "";
  const travelStyleId =
    snapshot.travelStyleId?.trim() ||
    snapshot.prefs.personalityType?.trim() ||
    travelStyleName;
  const prefs = mergeTravelPrefFields(
    {
      ...snapshot.prefs,
      onboarded: Boolean(snapshot.quizCompleted || snapshot.prefs.onboarded),
      personalityType: travelStyleId,
      pace: snapshot.pace ?? snapshot.prefs.pace,
      vibe: snapshot.vibe ?? snapshot.prefs.vibe,
      budgetMode: snapshot.budget ?? snapshot.prefs.budgetMode ?? resolveBudgetMode(snapshot.prefs),
    },
    snapshot.prefs,
  );
  const budget = snapshot.budget ?? resolveBudgetMode(prefs);
  return {
    ...snapshot,
    prefs,
    travelStyle: travelStyleName,
    travelStyleName,
    travelStyleId,
    pace: prefs.pace,
    vibe: prefs.vibe,
    budget,
    tags: Array.isArray(snapshot.tags) ? snapshot.tags.filter(Boolean).slice(0, 8) : [],
    quizCompleted: Boolean(snapshot.quizCompleted || prefs.onboarded),
    plusQuizCompleted: Boolean(snapshot.plusQuizCompleted || snapshot.quizCompleted || prefs.onboarded),
    updatedAt: snapshot.updatedAt || prefs.updated_at || new Date().toISOString(),
  };
}

function resultStorageKey(userId?: string | null): string {
  if (userId) return `${RESULT_KEY}:${userId}`;
  return RESULT_KEY;
}

let memoryCache: PersistedTravelPrefResult | null | undefined;
let memoryCacheUserId: string | null | undefined;

function setTravelPrefMemoryCache(
  snapshot: PersistedTravelPrefResult | null,
  userId?: string | null,
): void {
  memoryCache = snapshot;
  memoryCacheUserId = userId ?? snapshot?.userId ?? null;
}

export function resetTravelPrefMemoryCache(): void {
  memoryCache = undefined;
  memoryCacheUserId = undefined;
}

function resolveTravelPrefUserId(userId?: string | null): string | null {
  return userId ?? readCachedAuthenticatedUserIdSync() ?? null;
}

function readTravelPrefResultFromStorage(
  userId?: string | null,
  options?: { log?: boolean },
): PersistedTravelPrefResult | null {
  if (typeof window === "undefined") return null;
  if (options?.log) {
    console.info("[TRAVEL_PREF_RESULT] cold start cache load start");
  }

  const keys = userId ? [resultStorageKey(userId), RESULT_KEY] : [RESULT_KEY];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      if (raw.length > LOCAL_TRAVEL_PREF_MAX_BYTES) {
        localStorage.removeItem(key);
        continue;
      }
      const parsed = JSON.parse(raw) as PersistedTravelPrefResult;
      if (!parsed?.prefs || typeof parsed.prefs !== "object" || Array.isArray(parsed.prefs)) continue;
      if (isCorruptedTravelPrefObject(parsed.prefs)) {
        localStorage.removeItem(key);
        continue;
      }
      if (userId && parsed.userId && parsed.userId !== userId) continue;
      if (!parsed.quizCompleted && !parsed.prefs.onboarded) continue;
      if (options?.log) {
        console.info("[TRAVEL_PREF_RESULT] cold start cache load success", {
          travelStyle: parsed.travelStyle,
          pace: parsed.pace ?? parsed.prefs.pace ?? "",
          vibe: parsed.vibe ?? parsed.prefs.vibe ?? "",
          tagsCount: parsed.tags?.length ?? 0,
          updatedAt: parsed.updatedAt,
        });
      }
      return normalizeTravelPrefSnapshot(parsed);
    } catch {
      // try next key
    }
  }

  const prefs = readCachedPreferencesSync();
  if (prefs.onboarded) {
    const snapshot = buildTravelPrefResultSnapshot(prefs, { userId });
    if (options?.log) {
      console.info("[TRAVEL_PREF_RESULT] cold start cache load success", {
        source: "preferences-sync",
        travelStyle: snapshot.travelStyle,
        tagsCount: snapshot.tags.length,
      });
    }
    return snapshot;
  }

  if (options?.log) {
    console.info("[TRAVEL_PREF_RESULT] cold start cache load empty");
  }
  return null;
}

/** App 啟動時 hydrate 一次；之後讀 memory，不再掃 localStorage */
export function hydrateTravelPrefResultOnBoot(
  userId?: string | null,
  options?: { allowRepeatLog?: boolean },
): PersistedTravelPrefResult | null {
  const resolved = resolveTravelPrefUserId(userId);
  if (memoryCache !== undefined && memoryCacheUserId === resolved) {
    if (options?.allowRepeatLog === false) {
      logPerfTravelPrefLoadSkip("already_loaded_on_boot");
    }
    return memoryCache;
  }
  const shouldLog = memoryCache === undefined || memoryCacheUserId !== resolved;
  const snapshot = readTravelPrefResultFromStorage(userId ?? resolved ?? undefined, {
    log: shouldLog,
  });
  setTravelPrefMemoryCache(snapshot, resolved);
  return snapshot;
}

/** 讀取已 hydrate 的 travel pref（不觸發 cold start log） */
export function getTravelPrefResultSnapshot(
  userId?: string | null,
): PersistedTravelPrefResult | null {
  const resolved = resolveTravelPrefUserId(userId);
  if (memoryCache !== undefined && memoryCacheUserId === resolved) {
    return memoryCache;
  }
  const snapshot = readTravelPrefResultFromStorage(userId ?? resolved ?? undefined, {
    log: false,
  });
  setTravelPrefMemoryCache(snapshot, resolved);
  return snapshot;
}

export function buildTravelPrefTagsFromPrefs(prefs: TravelPreferences): string[] {
  return Array.from(
    new Set(
      [
        ...(prefs.interests ?? []),
        prefs.pace === "slow" ? "慢行" : prefs.pace === "active" ? "探索" : null,
        prefs.vibe === "quiet" ? "安靜" : prefs.vibe === "lively" ? "熱鬧" : "平衡",
        BUDGET_MODE_LABELS[resolveBudgetMode(prefs)],
      ].filter((v): v is string => Boolean(v)),
    ),
  ).slice(0, 5);
}

export function buildTravelPrefResultSnapshot(
  prefs: TravelPreferences,
  options?: { travelStyle?: string; userId?: string | null },
): PersistedTravelPrefResult {
  const personality = derivePersonality(prefs);
  const travelStyleName =
    options?.travelStyle?.trim() || prefs.personalityType || personality.type;
  const travelStyleId = prefs.personalityType?.trim() || travelStyleName;
  return normalizeTravelPrefSnapshot({
    userId: options?.userId ?? undefined,
    prefs,
    travelStyle: travelStyleName,
    travelStyleName,
    travelStyleId,
    pace: prefs.pace,
    vibe: prefs.vibe,
    budget: resolveBudgetMode(prefs),
    tags: buildTravelPrefTagsFromPrefs(prefs),
    quizCompleted: Boolean(prefs.onboarded),
    plusQuizCompleted: Boolean(prefs.onboarded),
    updatedAt: prefs.updated_at ?? new Date().toISOString(),
  });
}

export function writeTravelPrefResultCache(
  snapshot: PersistedTravelPrefResult,
  userId?: string | null,
): void {
  if (typeof window === "undefined") return;
  const uid = userId ?? snapshot.userId;
  const sanitizedPrefs = sanitizeForJsonStorage(compactTravelPreferences(snapshot.prefs));
  if (!sanitizedPrefs?.onboarded) return;

  const normalized = normalizeTravelPrefSnapshot({
    userId: uid,
    prefs: sanitizedPrefs,
    travelStyle: snapshot.travelStyle?.trim() || snapshot.travelStyleName?.trim() || sanitizedPrefs.personalityType || "",
    travelStyleName: snapshot.travelStyleName?.trim() || snapshot.travelStyle?.trim() || sanitizedPrefs.personalityType || "",
    travelStyleId: snapshot.travelStyleId?.trim() || sanitizedPrefs.personalityType || "",
    pace: snapshot.pace ?? sanitizedPrefs.pace,
    vibe: snapshot.vibe ?? sanitizedPrefs.vibe,
    budget: snapshot.budget ?? resolveBudgetMode(sanitizedPrefs),
    tags: Array.isArray(snapshot.tags) ? snapshot.tags.filter(Boolean).slice(0, 8) : [],
    quizCompleted: true,
    plusQuizCompleted: true,
    updatedAt: snapshot.updatedAt || sanitizedPrefs.updated_at || new Date().toISOString(),
  });

  if (!normalized.travelStyle) {
    logTravelPrefCacheWriteError(
      resultStorageKey(uid),
      "missing travelStyle",
      { travelStyle: normalized.travelStyle },
    );
    return;
  }

  setTravelPrefMemoryCache(normalized, uid ?? null);
  const payload = safeJsonStringify(normalized, LOCAL_TRAVEL_PREF_MAX_BYTES);
  if (!payload) {
    logTravelPrefCacheWriteError(
      resultStorageKey(uid),
      "JSON stringify failed or exceeds local limit",
      normalized,
    );
    void mirrorTravelPrefSummaryToNative(normalized, uid);
    return;
  }

  const key = resultStorageKey(uid);
  try {
    localStorage.setItem(key, payload);
    localStorage.setItem(RESULT_KEY, payload);
    logTravelPrefCacheWrite(key, payload);
    void mirrorTravelPrefSummaryToNative(normalized, uid);
  } catch (e) {
    logTravelPrefCacheWriteError(
      key,
      e instanceof Error ? e.message : String(e),
      payload.slice(0, 80),
    );
    void mirrorTravelPrefSummaryToNative(normalized, uid);
  }
}

export function readTravelPrefResultCache(
  userId?: string | null,
  options?: { log?: boolean },
): PersistedTravelPrefResult | null {
  if (options?.log) {
    return hydrateTravelPrefResultOnBoot(userId, { allowRepeatLog: true });
  }
  return getTravelPrefResultSnapshot(userId);
}

export function clearTravelPrefResultCache(userId?: string | null): void {
  if (typeof window === "undefined") return;
  resetTravelPrefMemoryCache();
  try {
    localStorage.removeItem(RESULT_KEY);
    if (userId) localStorage.removeItem(resultStorageKey(userId));
  } catch {
    // ignore
  }
}

export function buildUserProfileFromTravelPrefCache(
  snapshot: PersistedTravelPrefResult,
  locale: Locale = detectDeviceLocale(),
): UserProfile {
  const normalized = normalizeTravelPrefSnapshot(snapshot);
  const personality = derivePersonality(normalized.prefs);
  return {
    displayName: "",
    avatarUrl: null,
    coverImageUrl: null,
    bio: "",
    travelStyle: normalized.travelStyleName || normalized.travelStyle,
    language: locale,
    notificationsEnabled: false,
    authProvider: null,
    prefs: normalized.prefs,
    personalityType:
      normalized.travelStyleId || normalized.prefs.personalityType || personality.type,
    personalitySummary: normalized.prefs.personalitySummary ?? personality.summary,
    personalityImpression: personality.impression,
    aiPreferences: {
      travelStyle: normalized.travelStyleName || normalized.travelStyle,
      travelPreferences: normalized.tags,
      pacePreference: normalized.pace ?? normalized.prefs.pace ?? "",
      vibePreference: normalized.vibe ?? normalized.prefs.vibe ?? "",
      budgetPreference: normalized.budget ?? resolveBudgetMode(normalized.prefs),
      quizCompleted: normalized.quizCompleted,
      plusQuizCompleted: normalized.plusQuizCompleted,
      updatedAt: normalized.updatedAt,
    },
  };
}
