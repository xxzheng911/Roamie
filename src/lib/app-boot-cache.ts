import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import { logPerfTravelPrefLoadSkip } from "@/lib/app-perf";
import {
  hydrateTravelPrefResultOnBoot,
  resetTravelPrefMemoryCache,
  type PersistedTravelPrefResult,
} from "@/lib/travel-pref-result-cache";
import { resetPreferencesRemoteHydration } from "@/lib/preferences-storage";
import {
  restoreTravelPrefFromNativePersist,
  purgeLegacyTravelPrefCachesOnce,
  resetTravelPrefLegacyPurgeFlag,
} from "@/lib/travel-pref-native-persist";
import { schedulePendingTravelPrefSyncIfNeeded } from "@/lib/travel-pref-sync";
import {
  markTravelPrefPendingSync,
  readTravelPrefSyncState,
  resetTravelPrefSyncMemory,
} from "@/lib/travel-pref-sync-state";
import { readCachedPreferencesSync } from "@/lib/preferences-storage";
import { readCachedProfile } from "@/lib/profile-persisted-cache";
import {
  hydrateUserMediaFromCache,
  resetUserMediaStore,
} from "@/lib/user-media/user-media-store";
import {
  hydrateConversationWorkspaces,
} from "@/lib/conversation-workspace/storage";
import {
  mergeRemoteConversationWorkspaces,
} from "@/lib/conversation-workspace/remote-sync";

let bootHydrated = false;
let bootHydratedUserId: string | null | undefined;
const profileMountRefreshedUsers = new Set<string>();
let profileUiHydratedUserId: string | null = null;

export function hasLoadedTravelPrefOnBoot(): boolean {
  return bootHydrated;
}

export function hydrateAppBootCaches(userId?: string | null): PersistedTravelPrefResult | null {
  const resolvedUserId = userId ?? readCachedAuthenticatedUserIdSync() ?? null;
  void purgeLegacyTravelPrefCachesOnce(resolvedUserId);
  if (bootHydrated && bootHydratedUserId === resolvedUserId) {
    logPerfTravelPrefLoadSkip("already_loaded_on_boot");
    return hydrateTravelPrefResultOnBoot(resolvedUserId, { allowRepeatLog: false });
  }
  bootHydrated = true;
  bootHydratedUserId = resolvedUserId;
  void hydrateUserMediaFromCache(resolvedUserId ?? readCachedProfile(undefined, { quiet: true })?.userId);
  return hydrateTravelPrefResultOnBoot(resolvedUserId, { allowRepeatLog: true });
}

export function shouldHydrateProfileUi(userId: string): boolean {
  if (profileUiHydratedUserId === userId) return false;
  profileUiHydratedUserId = userId;
  return true;
}

export function shouldRefreshProfileOnMount(userId: string): boolean {
  if (profileMountRefreshedUsers.has(userId)) return false;
  profileMountRefreshedUsers.add(userId);
  return true;
}

export function resetAppBootCachesForUserChange(): void {
  bootHydrated = false;
  bootHydratedUserId = undefined;
  profileMountRefreshedUsers.clear();
  profileUiHydratedUserId = null;
  resetTravelPrefMemoryCache();
  resetTravelPrefLegacyPurgeFlag();
  resetTravelPrefSyncMemory();
  resetPreferencesRemoteHydration();
  resetUserMediaStore();
}

export async function hydrateAppBootCachesAsync(
  userId?: string | null,
): Promise<PersistedTravelPrefResult | null> {
  const resolvedUserId = userId ?? readCachedAuthenticatedUserIdSync() ?? null;
  if (bootHydrated && bootHydratedUserId === resolvedUserId) {
    logPerfTravelPrefLoadSkip("already_loaded_on_boot");
    return hydrateTravelPrefResultOnBoot(resolvedUserId, { allowRepeatLog: false });
  }

  console.info("[APP_BOOT_STAGE]", {
    stage: "workspace_restore_start",
    elapsedMs: Math.round(performance.now()),
    route: typeof location !== "undefined" ? location.pathname : "",
    userPresent: Boolean(resolvedUserId),
  });
  await purgeLegacyTravelPrefCachesOnce(resolvedUserId);
  await restoreTravelPrefFromNativePersist(resolvedUserId);
  // Preferences → localStorage for travel drafts (critical on iOS 26 nonPersistent WK)
  try {
    await hydrateConversationWorkspaces(resolvedUserId);
  } catch (error) {
    // Workspace restore is never an App-shell render authority.
    console.warn("[WORKSPACE_RESTORE_FAIL_OPEN]", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  console.info("[APP_BOOT_STAGE]", {
    stage: "workspace_restore_done",
    elapsedMs: Math.round(performance.now()),
    route: typeof location !== "undefined" ? location.pathname : "",
    userPresent: Boolean(resolvedUserId),
  });
  if (resolvedUserId) {
    void mergeRemoteConversationWorkspaces(resolvedUserId).catch(() => {
      /* offline / schema — keep local */
    });
  }
  resetTravelPrefMemoryCache();

  bootHydrated = true;
  bootHydratedUserId = resolvedUserId;
  const snapshot = hydrateTravelPrefResultOnBoot(resolvedUserId, { allowRepeatLog: true });

  // Non-blocking: restore avatar/cover bytes from IndexedDB before profile API.
  void hydrateUserMediaFromCache(resolvedUserId ?? readCachedProfile(undefined, { quiet: true })?.userId);

  if (resolvedUserId) {
    if (snapshot?.quizCompleted) {
      const syncState = readTravelPrefSyncState(resolvedUserId);
      if (!syncState.syncedAt) {
        markTravelPrefPendingSync(resolvedUserId, snapshot.travelStyle);
      }
      schedulePendingTravelPrefSyncIfNeeded(
        snapshot.prefs,
        resolvedUserId,
        snapshot.travelStyle,
      );
    } else {
      const prefs = readCachedPreferencesSync();
      if (prefs.onboarded) {
        const syncState = readTravelPrefSyncState(resolvedUserId);
        if (!syncState.syncedAt) {
          markTravelPrefPendingSync(resolvedUserId, prefs.personalityType ?? null);
        }
        schedulePendingTravelPrefSyncIfNeeded(
          prefs,
          resolvedUserId,
          prefs.personalityType ?? null,
        );
      }
    }
  }

  return snapshot;
}
