import { Preferences } from "@capacitor/preferences";
import { waitForCapacitorBridge } from "@/lib/capacitor-bridge-ready";
import { detectPlatform } from "@/services/platform";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { PersistedTravelPrefResult } from "@/lib/travel-pref-result-cache";
import { normalizeTravelPrefSnapshot } from "@/lib/travel-pref-result-cache";
import {
  buildNativeTravelPrefSummary,
  hasCompleteTravelPrefSummary,
  isValidNativeTravelPrefSummary,
  mergeTravelPrefFields,
  shrinkNativeTravelPrefSummary,
  snapshotFromNativeSummary,
  type NativeTravelPrefSummary,
} from "@/lib/travel-pref-compact";
import {
  isCorruptedTravelPrefObject,
  logTravelPrefCacheWrite,
  logTravelPrefCacheWriteError,
  NATIVE_TRAVEL_PREF_MAX_BYTES,
  stringifyWithinByteLimit,
} from "@/lib/travel-pref-cache-write";

/** 現行：僅存輕量摘要 */
const NATIVE_SUMMARY_KEY = "roamie.travel-pref.summary";

/** 舊版 key — 啟動時清除 */
const LEGACY_NATIVE_KEYS = [
  "roamie.travel-pref-result",
  "roamie.preferences",
] as const;

const GUEST_PREFS_KEY = "roamie:preferences";
const GUEST_RESULT_KEY = "roamie:travel-pref-result";

function nativeSummaryKey(userId?: string | null): string {
  return userId ? `${NATIVE_SUMMARY_KEY}.${userId}` : NATIVE_SUMMARY_KEY;
}

function legacyKeysForUser(userId?: string | null): string[] {
  const keys = [...LEGACY_NATIVE_KEYS];
  if (userId) {
    keys.push(`${LEGACY_NATIVE_KEYS[0]}.${userId}`, `${LEGACY_NATIVE_KEYS[1]}.${userId}`);
  }
  return keys;
}

function localKeysForUser(userId?: string | null): string[] {
  const keys = [GUEST_PREFS_KEY, GUEST_RESULT_KEY];
  if (userId) {
    keys.push(`${GUEST_PREFS_KEY}:${userId}`, `${GUEST_RESULT_KEY}:${userId}`);
  }
  return keys;
}

async function canUseNativePersist(): Promise<boolean> {
  if (!detectPlatform().isCapacitor) return false;
  return waitForCapacitorBridge(4_000);
}

let legacyPurgeDone = false;

function purgeCorruptedLocalKey(key: string, raw: string | null): boolean {
  if (!raw) return false;
  if (raw.length > 64_000) {
    localStorage.removeItem(key);
    console.info("[TRAVEL_PREF_CACHE_PURGE]", { key, reason: "oversized", size: raw.length });
    return true;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isCorruptedTravelPrefObject(parsed)) {
      localStorage.removeItem(key);
      console.info("[TRAVEL_PREF_CACHE_PURGE]", { key, reason: "corrupted_numeric_keys" });
      return true;
    }
  } catch {
    localStorage.removeItem(key);
    console.info("[TRAVEL_PREF_CACHE_PURGE]", { key, reason: "invalid_json" });
    return true;
  }
  return false;
}

/** 清除 oversized / corrupted localStorage 與舊版 Capacitor Preferences key */
export async function purgeLegacyTravelPrefCaches(userId?: string | null): Promise<void> {
  if (typeof window !== "undefined") {
    for (const key of localKeysForUser(userId)) {
      try {
        purgeCorruptedLocalKey(key, localStorage.getItem(key));
      } catch {
        try {
          localStorage.removeItem(key);
        } catch {
          // ignore
        }
      }
    }

    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith(`${GUEST_PREFS_KEY}:`) ||
        key.startsWith(`${GUEST_RESULT_KEY}:`) ||
        key === GUEST_PREFS_KEY ||
        key === GUEST_RESULT_KEY
      ) {
        try {
          purgeCorruptedLocalKey(key, localStorage.getItem(key));
        } catch {
          // ignore
        }
      }
    }
  }

  if (!(await canUseNativePersist())) return;

  for (const key of legacyKeysForUser(userId)) {
    try {
      const { value } = await Preferences.get({ key });
      if (!value) continue;
      await Preferences.remove({ key });
      console.info("[TRAVEL_PREF_CACHE_PURGE]", {
        key,
        reason: "legacy_key_removed",
        size: value.length,
      });
    } catch {
      try {
        await Preferences.remove({ key });
      } catch {
        // ignore
      }
    }
  }
}

export async function purgeLegacyTravelPrefCachesOnce(userId?: string | null): Promise<void> {
  if (legacyPurgeDone) return;
  legacyPurgeDone = true;
  await purgeLegacyTravelPrefCaches(userId);
}

export function resetTravelPrefLegacyPurgeFlag(): void {
  legacyPurgeDone = false;
}

/** 僅 mirror 輕量摘要至 Capacitor Preferences（<= 4KB） */
export async function mirrorTravelPrefSummaryToNative(
  snapshot: PersistedTravelPrefResult,
  userId?: string | null,
): Promise<void> {
  if (!(await canUseNativePersist())) return;
  if (!snapshot.quizCompleted && !snapshot.prefs?.onboarded) return;

  const uid = userId ?? snapshot.userId ?? null;
  const summary = buildNativeTravelPrefSummary(snapshot, uid);
  if (!summary.completed || !summary.travelStyleName) return;

  const key = nativeSummaryKey(uid);
  const payload =
    stringifyWithinByteLimit(summary, NATIVE_TRAVEL_PREF_MAX_BYTES, (value) =>
      shrinkNativeTravelPrefSummary(value as NativeTravelPrefSummary),
    ) ?? stringifyWithinByteLimit(
      shrinkNativeTravelPrefSummary(summary),
      NATIVE_TRAVEL_PREF_MAX_BYTES,
    );

  if (!payload) {
    logTravelPrefCacheWriteError(key, "native summary exceeds 4KB after shrink", summary);
    return;
  }

  try {
    await Preferences.set({ key, value: payload });
    if (uid) {
      await Preferences.set({ key: NATIVE_SUMMARY_KEY, value: payload });
    }
    logTravelPrefCacheWrite(key, payload);
  } catch (e) {
    logTravelPrefCacheWriteError(
      key,
      e instanceof Error ? e.message : String(e),
      payload.slice(0, 80),
    );
  }
}

/** @deprecated 改用 mirrorTravelPrefSummaryToNative；保留 no-op 避免舊呼叫寫入大 payload */
export async function mirrorTravelPrefToNativePersist(
  snapshot: PersistedTravelPrefResult,
  _prefs: TravelPreferences,
  userId?: string | null,
): Promise<void> {
  await mirrorTravelPrefSummaryToNative(snapshot, userId);
}

/** 若 localStorage 缺資料，從 Capacitor Preferences 輕量摘要還原 */
export async function restoreTravelPrefFromNativePersist(
  userId?: string | null,
): Promise<boolean> {
  if (!(await canUseNativePersist())) return false;

  const existingRaw =
    typeof window !== "undefined"
      ? localStorage.getItem(userId ? `${GUEST_RESULT_KEY}:${userId}` : GUEST_RESULT_KEY) ??
        localStorage.getItem(GUEST_RESULT_KEY)
      : null;
  let existingSnapshot: PersistedTravelPrefResult | null = null;
  if (existingRaw) {
    try {
      existingSnapshot = normalizeTravelPrefSnapshot(
        JSON.parse(existingRaw) as PersistedTravelPrefResult,
      );
    } catch {
      existingSnapshot = null;
    }
  }

  const keys = userId
    ? [nativeSummaryKey(userId), NATIVE_SUMMARY_KEY]
    : [NATIVE_SUMMARY_KEY];

  for (const key of keys) {
    try {
      const { value } = await Preferences.get({ key });
      if (!value || value.length > NATIVE_TRAVEL_PREF_MAX_BYTES) continue;

      const parsed = JSON.parse(value) as unknown;
      if (!isValidNativeTravelPrefSummary(parsed)) continue;

      const snapshot = normalizeTravelPrefSnapshot(snapshotFromNativeSummary(parsed));
      const prefs = snapshot.prefs;

      if (
        existingSnapshot &&
        hasCompleteTravelPrefSummary(existingSnapshot.prefs) &&
        !hasCompleteTravelPrefSummary(prefs)
      ) {
        console.info("[TRAVEL_PREF_RESULT] kept local cache over incomplete native summary", {
          userId: userId ?? parsed.userId ?? "",
          travelStyle: existingSnapshot.travelStyle,
        });
        return false;
      }

      const mergedPrefs = mergeTravelPrefFields(prefs, existingSnapshot?.prefs ?? {});
      const mergedSnapshot = normalizeTravelPrefSnapshot({
        ...snapshot,
        prefs: mergedPrefs,
        pace: mergedPrefs.pace,
        vibe: mergedPrefs.vibe,
        budget: snapshot.budget,
      });
      const resultPayload = JSON.stringify(mergedSnapshot);
      const prefsPayload = JSON.stringify(mergedPrefs);

      localStorage.setItem(GUEST_RESULT_KEY, resultPayload);
      localStorage.setItem(GUEST_PREFS_KEY, prefsPayload);
      const uid = userId ?? parsed.userId ?? null;
      if (uid) {
        localStorage.setItem(`${GUEST_RESULT_KEY}:${uid}`, resultPayload);
        localStorage.setItem(`${GUEST_PREFS_KEY}:${uid}`, prefsPayload);
      }

      console.info("[TRAVEL_PREF_RESULT] restored from native summary", {
        userId: uid ?? "",
        travelStyle: mergedSnapshot.travelStyle,
        pace: mergedPrefs.pace ?? "",
        vibe: mergedPrefs.vibe ?? "",
        valueSize: value.length,
      });
      return true;
    } catch (e) {
      console.warn("[TRAVEL_PREF_RESULT] native summary restore failed", key, e);
    }
  }

  return false;
}
