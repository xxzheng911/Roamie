import { registerAppStateChangeListener } from "@/lib/capacitor-app-listener";
import { getCapacitorGeolocation } from "@/lib/capacitor-geolocation";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import { leaveNavigationLocationMode } from "@/lib/location-coordinator";

const LEGACY_WATCH_IDS_KEY = "roamie:navigation-geo-watch-id";
const LEGACY_WATCH_IDS_LIST_KEY = "roamie:geo-watch-ids";

let appStateListenerRegistered = false;
/** App session: native purgeAllWatches runs at most once (app boot). */
let nativeWatchPurgeDone = false;
let nativeWatchPurgePromise: Promise<number> | null = null;

function readLegacyWatchIds(): string[] {
  if (typeof sessionStorage === "undefined") return [];
  const ids = new Set<string>();
  try {
    const single = sessionStorage.getItem(LEGACY_WATCH_IDS_KEY);
    if (single) ids.add(single);
    const raw = sessionStorage.getItem(LEGACY_WATCH_IDS_LIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const id of parsed) {
          if (typeof id === "string" && id) ids.add(id);
        }
      }
    }
  } catch {
    /* ignore */
  }
  return [...ids];
}

function clearLegacyWatchIdsStorage(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(LEGACY_WATCH_IDS_KEY);
    sessionStorage.removeItem(LEGACY_WATCH_IDS_LIST_KEY);
  } catch {
    /* ignore */
  }
}

async function clearLegacyWatchIdsByStorage(reason: string): Promise<number> {
  const ids = readLegacyWatchIds();
  if (ids.length === 0) return 0;

  let legacyCleared = 0;
  if (isCapacitorNativeShell()) {
    try {
      const Geolocation = getCapacitorGeolocation();
      for (const id of ids) {
        await Geolocation.clearWatch({ id });
        legacyCleared += 1;
      }
    } catch (e) {
      console.warn("[Location] legacy clearWatch failed", e);
    }
  }

  clearLegacyWatchIdsStorage();
  if (legacyCleared > 0) {
    console.info("[LOCATION_WATCH_STOP]", { reason, cleared: legacyCleared, legacy: true });
  }
  return legacyCleared;
}

/**
 * Native purgeAllWatches — once per app session (app boot only).
 * Subsequent calls log [LOCATION_PURGE_SKIP_ALREADY_DONE] and no-op.
 */
async function purgeOrphanedNativeWatchesOnce(reason: string): Promise<number> {
  if (nativeWatchPurgeDone) {
    console.info("[LOCATION_PURGE_SKIP_ALREADY_DONE]", { reason });
    return 0;
  }
  if (nativeWatchPurgePromise) {
    return nativeWatchPurgePromise;
  }

  nativeWatchPurgePromise = (async () => {
    if (!isCapacitorNativeShell()) {
      nativeWatchPurgeDone = true;
      console.info("[LOCATION_PURGE_ONCE]", { reason, cleared: 0, native: false });
      return 0;
    }

    try {
      const Geolocation = getCapacitorGeolocation();
      if (typeof Geolocation.purgeAllWatches !== "function") {
        console.warn("[Location] purgeAllWatches unavailable — rebuild iOS native shell");
        nativeWatchPurgeDone = true;
        console.info("[LOCATION_PURGE_ONCE]", { reason, cleared: 0, native: "unavailable" });
        return 0;
      }
      const result = await Geolocation.purgeAllWatches();
      const cleared = result?.cleared ?? 0;
      nativeWatchPurgeDone = true;
      console.info("[LOCATION_PURGE_ONCE]", { reason, cleared, native: "purgeAllWatches" });
      if (cleared > 0) {
        console.info("[LOCATION_WATCH_STOP]", { reason, cleared, native: "purgeAllWatches" });
      }
      return cleared;
    } catch (e) {
      console.warn("[Location] purgeAllWatches failed", e);
      nativeWatchPurgeDone = true;
      console.info("[LOCATION_PURGE_ONCE]", { reason, cleared: 0, native: "error" });
      return 0;
    }
  })().finally(() => {
    nativeWatchPurgePromise = null;
  });

  return nativeWatchPurgePromise;
}

function ensureAppStateListener(): void {
  if (appStateListenerRegistered || typeof window === "undefined") return;
  if (!isCapacitorNativeShell()) return;
  appStateListenerRegistered = true;

  void registerAppStateChangeListener((isActive) => {
    if (isActive) return;
    void clearLegacyWatchIdsByStorage("app_inactive");
  }).catch(() => {
    appStateListenerRegistered = false;
  });
}

/** App boot only: legacy clearWatch + native purgeAllWatches (once per session). */
export async function purgeStaleLocationWatch(reason = "app_boot"): Promise<void> {
  ensureAppStateListener();
  await clearLegacyWatchIdsByStorage(reason);
  await purgeOrphanedNativeWatchesOnce(reason);
}

export async function stopNavigationLocationWatch(reason: string): Promise<void> {
  leaveNavigationLocationMode();
  await clearLegacyWatchIdsByStorage(reason);
}
