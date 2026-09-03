import { supabase } from "@/integrations/supabase/client";
import {
  getAuthenticatedUserId,
  readCachedAuthenticatedUserIdSync,
} from "@/lib/auth-session";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { broadcastPreferencesUpdate } from "@/lib/preference-events";
import {
  buildTravelPrefResultSnapshot,
  clearTravelPrefResultCache,
  writeTravelPrefResultCache,
} from "@/lib/travel-pref-result-cache";
import { getTravelPrefStatusSync } from "@/lib/travel-pref-status";
import {
  logTravelPrefCacheWrite,
  logTravelPrefCacheWriteError,
  safeJsonStringify,
  sanitizeForJsonStorage,
  isCorruptedTravelPrefObject,
  LOCAL_TRAVEL_PREF_MAX_BYTES,
} from "@/lib/travel-pref-cache-write";
import { compactTravelPreferences } from "@/lib/travel-pref-compact";
import { markTravelPrefPendingSync } from "@/lib/travel-pref-sync-state";
import { upsertTravelPersonalityToSupabase } from "@/lib/travel-pref-supabase-upsert";

const REMOTE_SAVE_TIMEOUT_MS = 15_000;

export function serializePreferencesSyncError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack?.split("\n").slice(0, 4).join("\n"),
    };
  }
  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    return {
      message: row.message,
      code: row.code,
      details: row.details,
      hint: row.hint,
      status: row.status,
    };
  }
  return { message: String(error) };
}

export function logPreferencesSyncFailure(
  phase: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  console.warn(`[TRAVEL_PREF_TEST] ${phase} background fail`, {
    ...serializePreferencesSyncError(error),
    ...extra,
  });
}

const GUEST_KEY = "roamie:preferences";
const PREFS_CACHE_TTL_MS = 60_000;

/** 每位 user 遠端 travel_personality 僅 hydrate 一次（啟動 / userId 變更 / 測驗完成後 force） */
let prefsRemoteHydratedUserId: string | null = null;

export function isPreferencesRemoteHydrated(userId?: string | null): boolean {
  const uid = userId ?? readCachedAuthenticatedUserIdSync();
  return Boolean(uid && prefsRemoteHydratedUserId === uid);
}

export function resetPreferencesRemoteHydration(userId?: string | null): void {
  if (!userId || prefsRemoteHydratedUserId === userId) {
    prefsRemoteHydratedUserId = null;
  }
}

export function markPreferencesRemoteHydrated(userId: string): void {
  prefsRemoteHydratedUserId = userId;
}

function prefsStorageKey(userId?: string | null): string {
  if (userId) return `${GUEST_KEY}:${userId}`;
  return GUEST_KEY;
}

function prefTimestamp(prefs: TravelPreferences): number {
  if (!prefs.updated_at) return 0;
  const parsed = Date.parse(prefs.updated_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 合併本機與遠端；不可讓空遠端覆蓋已完成測驗的本機資料 */
function mergeTravelPreferences(
  local: TravelPreferences,
  remote: TravelPreferences,
): TravelPreferences {
  const localDone = Boolean(local.onboarded);
  const remoteDone = Boolean(remote.onboarded);
  if (localDone && !remoteDone) return { ...remote, ...local };
  if (remoteDone && !localDone) return { ...local, ...remote };
  const localAt = prefTimestamp(local);
  const remoteAt = prefTimestamp(remote);
  if (localAt > remoteAt) return { ...remote, ...local };
  if (remoteAt > localAt) return { ...local, ...remote };
  return { ...local, ...remote };
}

let prefsCache: { userId: string; prefs: TravelPreferences; at: number } | null = null;

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

function readGuest(userId?: string | null): TravelPreferences {
  if (typeof window === "undefined") return {};
  const uid = userId ?? readCachedAuthenticatedUserIdSync();
  const keys = uid ? [prefsStorageKey(uid), GUEST_KEY] : [GUEST_KEY];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      if (raw.length > LOCAL_TRAVEL_PREF_MAX_BYTES) {
        localStorage.removeItem(key);
        console.info("[TRAVEL_PREF_CACHE_PURGE]", { key, reason: "oversized", size: raw.length });
        continue;
      }
      const parsed = JSON.parse(raw) as TravelPreferences;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      if (isCorruptedTravelPrefObject(parsed)) {
        localStorage.removeItem(key);
        console.info("[TRAVEL_PREF_CACHE_PURGE]", { key, reason: "corrupted_numeric_keys" });
        continue;
      }
      return compactTravelPreferences(parsed);
    } catch {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }
  return {};
}

function writeGuest(prefs: TravelPreferences, userId?: string | null): boolean {
  if (typeof window === "undefined") return false;
  if (!prefs.onboarded) return false;

  const uid = userId ?? readCachedAuthenticatedUserIdSync();
  const compact = compactTravelPreferences(prefs);
  const sanitized = sanitizeForJsonStorage(compact);
  if (!sanitized?.onboarded) {
    return false;
  }
  const payload = safeJsonStringify(sanitized, LOCAL_TRAVEL_PREF_MAX_BYTES);
  if (!payload) {
    logTravelPrefCacheWriteError(
      prefsStorageKey(uid),
      "JSON stringify failed or exceeds local limit",
      sanitized,
    );
    return false;
  }

  const primaryKey = uid ? prefsStorageKey(uid) : GUEST_KEY;
  try {
    localStorage.setItem(primaryKey, payload);
    localStorage.setItem(GUEST_KEY, payload);
    const readPrimary = localStorage.getItem(primaryKey);
    const readFallback = localStorage.getItem(GUEST_KEY);
    const payloadMatches = readPrimary === payload || readFallback === payload;
    if (payloadMatches) {
      logTravelPrefCacheWrite(primaryKey, payload);
      return true;
    }
    try {
      const parsed = JSON.parse(readPrimary ?? readFallback ?? "") as TravelPreferences;
      if (parsed?.onboarded) {
        logTravelPrefCacheWrite(primaryKey, payload);
        return true;
      }
    } catch {
      // fall through
    }
    logTravelPrefCacheWriteError(primaryKey, "verify mismatch after write", payload.slice(0, 80));
    return false;
  } catch (e) {
    logTravelPrefCacheWriteError(
      primaryKey,
      e instanceof Error ? e.message : String(e),
      payload.slice(0, 80),
    );
    return false;
  }
}

export function isPreferenceQuizCompletedSync(): boolean {
  return getTravelPrefStatusSync().preferenceQuizCompleted;
}

export async function isPreferenceQuizCompleted(): Promise<boolean> {
  if (isPreferenceQuizCompletedSync()) {
    return true;
  }
  const prefs = await getPreferences();
  return Boolean(prefs.onboarded);
}

export async function getPreferences(options?: { force?: boolean }): Promise<TravelPreferences> {
  const syncUserId = readCachedAuthenticatedUserIdSync();
  const local = readGuest(syncUserId);

  const userId = syncUserId ?? (await getAuthenticatedUserId());
  if (!userId) return local;

  const now = Date.now();
  const force = options?.force === true;

  if (
    !force &&
    prefsRemoteHydratedUserId === userId &&
    prefsCache &&
    prefsCache.userId === userId
  ) {
    return prefsCache.prefs;
  }

  if (
    !force &&
    prefsCache &&
    prefsCache.userId === userId &&
    now - prefsCache.at < PREFS_CACHE_TTL_MS
  ) {
    return prefsCache.prefs;
  }

  if (!force && prefsRemoteHydratedUserId === userId) {
    const merged = local.onboarded ? local : mergeTravelPreferences(local, {});
    prefsCache = { userId, prefs: merged, at: now };
    return merged;
  }

  let remote: TravelPreferences = {};
  console.info("[TRAVEL_PREF_RESULT] supabase load start", { userId });
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("travel_personality")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    remote = (data?.travel_personality ?? {}) as TravelPreferences;
    if (remote.onboarded) {
      console.info("[TRAVEL_PREF_RESULT] supabase load success", {
        hasPersonality: Boolean(remote.personalityType),
      });
    } else {
      console.info("[TRAVEL_PREF_RESULT] supabase load empty");
    }
  } catch (e) {
    console.warn("[TRAVEL_PREF_RESULT] supabase load error", e);
    const merged = mergeTravelPreferences(local, remote);
    if (merged.onboarded) {
      writeGuest(merged, userId);
      writeTravelPrefResultCache(buildTravelPrefResultSnapshot(merged, { userId }), userId);
    }
    prefsCache = { userId, prefs: merged, at: now };
    markPreferencesRemoteHydrated(userId);
    return merged;
  }

  const merged = mergeTravelPreferences(local, remote);
  if (Boolean(local.onboarded) && !Boolean(merged.onboarded)) {
    console.warn("[TRAVEL_PREF_RESULT] merge would drop onboarded; keeping local quiz");
    Object.assign(merged, local, { onboarded: true });
  }

  prefsCache = { userId, prefs: merged, at: now };

  if (merged.onboarded) {
    writeGuest(merged, userId);
    writeTravelPrefResultCache(buildTravelPrefResultSnapshot(merged, { userId }), userId);
  }

  markPreferencesRemoteHydrated(userId);
  return merged;
}

/** 同步讀取本機快取（guest localStorage + 記憶體 prefsCache） */
export function readCachedPreferencesSync(): TravelPreferences {
  if (typeof window === "undefined") return {};
  const userId = readCachedAuthenticatedUserIdSync();
  const local = readGuest(userId);
  if (
    userId &&
    prefsCache?.userId === userId &&
    Date.now() - prefsCache.at < PREFS_CACHE_TTL_MS
  ) {
    return compactTravelPreferences(mergeTravelPreferences(prefsCache.prefs, local));
  }
  return local;
}

/** 完成測驗關鍵路徑：僅寫本機，不 await auth / Supabase（重新測驗會覆蓋舊結果） */
export function savePreferencesLocally(
  prefs: TravelPreferences,
  userId?: string | null,
): TravelPreferences {
  const merged: TravelPreferences = {
    ...readCachedPreferencesSync(),
    ...prefs,
    onboarded: true,
    updated_at: new Date().toISOString(),
  };
  const resolvedUserId = userId ?? readCachedAuthenticatedUserIdSync();
  const travelStyle = merged.personalityType?.trim() ?? "";
  if (resolvedUserId) {
    markTravelPrefPendingSync(resolvedUserId, travelStyle);
  }
  const wrote = writeGuest(merged, resolvedUserId);
  if (!wrote) {
    console.warn("[TRAVEL_QUIZ_SAVE_ERROR]", {
      code: "LOCAL_STORAGE_WRITE",
      message: "localStorage write failed; continuing with memory cache",
      details: "",
      hint: resolvedUserId ? `userId=${resolvedUserId}` : "guest",
    });
  }
  if (resolvedUserId) {
    prefsCache = { userId: resolvedUserId, prefs: merged, at: Date.now() };
    markPreferencesRemoteHydrated(resolvedUserId);
  }
  broadcastPreferencesUpdate(merged);
  writeTravelPrefResultCache(
    buildTravelPrefResultSnapshot(merged, { userId: resolvedUserId }),
    resolvedUserId,
  );
  return merged;
}

/** 背景同步至 Supabase（含 timeout，不可阻塞 UI；失敗僅記 log） */
export async function syncPreferencesToSupabase(
  merged: TravelPreferences,
  options?: { timeoutMs?: number; travelStyle?: string | null; source?: string },
): Promise<void> {
  await upsertTravelPersonalityToSupabase(
    {
      prefs: merged,
      travelStyle: options?.travelStyle ?? merged.personalityType ?? null,
      source: options?.source ?? "syncPreferencesToSupabase",
    },
    { timeoutMs: options?.timeoutMs ?? REMOTE_SAVE_TIMEOUT_MS },
  );
  const userId = readCachedAuthenticatedUserIdSync();
  if (userId) {
    prefsCache = { userId, prefs: merged, at: Date.now() };
  }
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
      writeGuest(merged, userId);
      broadcastPreferencesUpdate(merged);
      return merged;
    }
    throw new Error(error.message);
  }
  broadcastPreferencesUpdate(merged);
  prefsCache = { userId, prefs: merged, at: Date.now() };
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
  clearTravelPrefResultCache();
  broadcastPreferencesUpdate(local);
}
