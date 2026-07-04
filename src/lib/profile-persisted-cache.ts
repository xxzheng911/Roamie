import { withCacheBust } from "@/lib/media-display-url";

const MEDIA_KEY = "roamie:profile-media-persisted";
const LAST_USER_KEY = "roamie:last-profile-user-id";

export type CachedProfile = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  avatarUpdatedAt: string | null;
  profileUpdatedAt: string | null;
  cachedAt: number;
};

type LegacyPersistedProfileMedia = {
  userId: string;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  updatedAt: number;
};

function readRaw(): CachedProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MEDIA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedProfile | LegacyPersistedProfileMedia;
    if (!parsed || typeof parsed !== "object" || !parsed.userId) return null;
    if ("cachedAt" in parsed && typeof parsed.cachedAt === "number") {
      return parsed as CachedProfile;
    }
    const legacy = parsed as LegacyPersistedProfileMedia;
    return {
      userId: legacy.userId,
      displayName: "",
      avatarUrl: legacy.avatarUrl ?? null,
      coverImageUrl: legacy.coverImageUrl ?? null,
      avatarUpdatedAt: legacy.updatedAt ? new Date(legacy.updatedAt).toISOString() : null,
      profileUpdatedAt: legacy.updatedAt ? new Date(legacy.updatedAt).toISOString() : null,
      cachedAt: legacy.updatedAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

function writeRaw(profile: CachedProfile): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MEDIA_KEY, JSON.stringify(profile));
    localStorage.setItem(LAST_USER_KEY, profile.userId);
  } catch {
    /* quota */
  }
}

export function readLastCachedProfileUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

export function readCachedProfile(userId?: string | null): CachedProfile | null {
  const row = readRaw();
  if (!row) {
    console.info("[PROFILE_CACHE_MISS]");
    return null;
  }
  const resolvedUserId = userId ?? readLastCachedProfileUserId();
  if (resolvedUserId && row.userId !== resolvedUserId) {
    console.info("[PROFILE_CACHE_MISS]");
    return null;
  }
  console.info("[PROFILE_CACHE_HIT]", { userId: row.userId });
  return row;
}

export function writeCachedProfile(
  patch: Partial<CachedProfile> & { userId: string },
): CachedProfile {
  const prev = readRaw();
  const next: CachedProfile = {
    userId: patch.userId,
    displayName: patch.displayName ?? prev?.displayName ?? "",
    avatarUrl: patch.avatarUrl !== undefined ? patch.avatarUrl : (prev?.avatarUrl ?? null),
    coverImageUrl:
      patch.coverImageUrl !== undefined ? patch.coverImageUrl : (prev?.coverImageUrl ?? null),
    avatarUpdatedAt:
      patch.avatarUpdatedAt !== undefined ? patch.avatarUpdatedAt : (prev?.avatarUpdatedAt ?? null),
    profileUpdatedAt:
      patch.profileUpdatedAt !== undefined
        ? patch.profileUpdatedAt
        : (prev?.profileUpdatedAt ?? null),
    cachedAt: Date.now(),
  };
  writeRaw(next);
  return next;
}

export function readPersistedAvatarUrl(userId?: string | null): string | null {
  return readCachedProfile(userId)?.avatarUrl ?? null;
}

export function readPersistedCoverUrl(userId?: string | null): string | null {
  return readCachedProfile(userId)?.coverImageUrl ?? null;
}

export function readPersistedDisplayName(userId?: string | null): string | null {
  const name = readCachedProfile(userId)?.displayName?.trim();
  return name || null;
}

export function writePersistedProfileMedia(
  userId: string,
  patch: {
    avatarUrl?: string | null;
    coverImageUrl?: string | null;
    displayName?: string;
    avatarUpdatedAt?: string | null;
    profileUpdatedAt?: string | null;
  },
): void {
  if (!userId) return;
  writeCachedProfile({
    userId,
    displayName: patch.displayName,
    avatarUrl: patch.avatarUrl,
    coverImageUrl: patch.coverImageUrl,
    avatarUpdatedAt: patch.avatarUpdatedAt,
    profileUpdatedAt: patch.profileUpdatedAt,
  });
}

export function resolveAvatarDisplayUrl(
  avatarUrl: string | null | undefined,
  avatarUpdatedAt?: string | null,
): string | null {
  const raw = avatarUrl?.trim() || null;
  if (!raw) return null;
  const revision = avatarUpdatedAt ? Date.parse(avatarUpdatedAt) : undefined;
  const busted = withCacheBust(raw, Number.isFinite(revision) ? revision : undefined);
  if (busted && revision && !raw.includes("v=")) {
    console.info("[AVATAR_IMAGE_CACHE_BUST]", { revision });
  }
  return busted;
}

export function avatarRevisionFromUpdatedAt(avatarUpdatedAt?: string | null): number {
  if (!avatarUpdatedAt) return 0;
  const parsed = Date.parse(avatarUpdatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isCachedAvatarNewerThan(
  cached: CachedProfile | null,
  networkUpdatedAt: string | null | undefined,
): boolean {
  if (!cached?.avatarUpdatedAt || !networkUpdatedAt) return false;
  const cachedMs = Date.parse(cached.avatarUpdatedAt);
  const networkMs = Date.parse(networkUpdatedAt);
  if (!Number.isFinite(cachedMs) || !Number.isFinite(networkMs)) return false;
  return cachedMs > networkMs;
}
