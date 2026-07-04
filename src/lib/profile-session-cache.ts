import type { UserProfile } from "@/lib/profile-storage";
import { preloadAvatarImage } from "@/lib/profile-avatar-preload";
import { writePersistedProfileMedia } from "@/lib/profile-persisted-cache";
import { logPerfProfileLoadSkip } from "@/lib/app-perf";

let cachedProfile: UserProfile | null = null;
let cachedUserId: string | null = null;
let inflightProfileFetch: Promise<UserProfile> | null = null;
let inflightProfileUserId: string | null = null;
let profileNetworkLoadedAt = 0;
let profileNetworkLoadedUserId: string | null = null;

const PROFILE_NETWORK_REUSE_MS = 60_000;

export function readProfileSessionCache(userId?: string | null): UserProfile | null {
  if (!cachedProfile) return null;
  if (userId && cachedUserId && userId !== cachedUserId) return null;
  return cachedProfile;
}

export function writeProfileSessionCache(profile: UserProfile, userId?: string | null): void {
  cachedProfile = profile;
  if (userId) cachedUserId = userId;
  if (userId) {
    writePersistedProfileMedia(userId, {
      avatarUrl: profile.avatarUrl,
      coverImageUrl: profile.coverImageUrl,
      displayName: profile.displayName,
      avatarUpdatedAt: profile.profileUpdatedAt ?? null,
      profileUpdatedAt: profile.profileUpdatedAt ?? null,
    });
    preloadAvatarImage(userId, profile.avatarUrl, profile.profileUpdatedAt);
  }
}

export function markProfileNetworkLoaded(userId: string): void {
  profileNetworkLoadedAt = Date.now();
  profileNetworkLoadedUserId = userId;
}

export function shouldSkipProfileNetworkLoad(
  userId: string,
  force?: boolean,
): { skip: boolean; reason?: "already_loaded" | "inflight" | "same_user" } {
  if (force) return { skip: false };
  const inflight = readInflightProfileFetch(userId);
  if (inflight) {
    logPerfProfileLoadSkip("inflight");
    return { skip: true, reason: "inflight" };
  }
  const cached = readProfileSessionCache(userId);
  if (!cached) return { skip: false };
  if (
    profileNetworkLoadedUserId === userId &&
    Date.now() - profileNetworkLoadedAt < PROFILE_NETWORK_REUSE_MS
  ) {
    logPerfProfileLoadSkip("already_loaded");
    return { skip: true, reason: "already_loaded" };
  }
  return { skip: false };
}

export function patchProfileSessionCache(
  patch: Partial<UserProfile>,
  userId?: string | null,
): UserProfile | null {
  if (!cachedProfile) return null;
  if (userId && cachedUserId && userId !== cachedUserId) return null;
  cachedProfile = { ...cachedProfile, ...patch };
  const uid = userId ?? cachedUserId;
  if (uid) {
    writePersistedProfileMedia(uid, {
      avatarUrl: patch.avatarUrl !== undefined ? patch.avatarUrl : cachedProfile.avatarUrl,
      coverImageUrl:
        patch.coverImageUrl !== undefined ? patch.coverImageUrl : cachedProfile.coverImageUrl,
      displayName: patch.displayName !== undefined ? patch.displayName : cachedProfile.displayName,
      avatarUpdatedAt:
        patch.profileUpdatedAt !== undefined
          ? patch.profileUpdatedAt
          : cachedProfile.profileUpdatedAt,
      profileUpdatedAt:
        patch.profileUpdatedAt !== undefined
          ? patch.profileUpdatedAt
          : cachedProfile.profileUpdatedAt,
    });
    preloadAvatarImage(
      uid,
      patch.avatarUrl !== undefined ? patch.avatarUrl : cachedProfile.avatarUrl,
      patch.profileUpdatedAt ?? cachedProfile.profileUpdatedAt,
    );
  }
  return cachedProfile;
}

export function clearProfileSessionCache(): void {
  cachedProfile = null;
  cachedUserId = null;
  inflightProfileFetch = null;
  inflightProfileUserId = null;
  profileNetworkLoadedAt = 0;
  profileNetworkLoadedUserId = null;
}

export function readInflightProfileFetch(userId: string): Promise<UserProfile> | null {
  if (!inflightProfileFetch || inflightProfileUserId !== userId) return null;
  return inflightProfileFetch;
}

export function trackInflightProfileFetch(
  userId: string,
  promise: Promise<UserProfile>,
): Promise<UserProfile> {
  inflightProfileUserId = userId;
  inflightProfileFetch = promise.finally(() => {
    if (inflightProfileFetch === promise) {
      inflightProfileFetch = null;
      inflightProfileUserId = null;
    }
  });
  return inflightProfileFetch;
}
