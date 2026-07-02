import { withCacheBust } from "@/lib/media-display-url";
import { readProfileSessionCache } from "@/lib/profile-session-cache";
import {
  readPersistedAvatarUrl,
  readPersistedCoverUrl,
} from "@/lib/profile-persisted-cache";

export type ProfileMediaDisplay = {
  /** Custom image src (preview / cache / network) — never the default asset */
  customSrc: string | null;
  /** Loading confirmed empty — safe to show default asset */
  showDefault: boolean;
  /** Still resolving profile media — show skeleton, not default */
  pending: boolean;
  /** Final img src: custom while loading if cached, else default only after loaded */
  displaySrc: string | null;
};

export function readCachedAvatarUrl(userId?: string | null): string | null {
  const fromSession = readProfileSessionCache(userId)?.avatarUrl?.trim();
  if (fromSession) return fromSession;
  const persisted = readPersistedAvatarUrl(userId)?.trim();
  return persisted || null;
}

export function readCachedCoverUrl(userId?: string | null): string | null {
  const fromSession = readProfileSessionCache(userId)?.coverImageUrl?.trim();
  if (fromSession) return fromSession;
  const persisted = readPersistedCoverUrl(userId)?.trim();
  return persisted || null;
}

export function hasCachedProfileMedia(userId?: string | null): boolean {
  return Boolean(readCachedAvatarUrl(userId) || readCachedCoverUrl(userId));
}

/** True when full profile row is already in session memory (not just persisted URLs). */
export function hasProfileSessionCache(userId?: string | null): boolean {
  return Boolean(readProfileSessionCache(userId));
}

export function resolveProfileMediaDisplay(
  storedUrl: string | null | undefined,
  preview: string | null,
  profileMediaLoaded: boolean,
  defaultImage: string,
  revision = 0,
): ProfileMediaDisplay {
  const normalized = storedUrl?.trim() || null;
  const customSrc =
    preview ?? (normalized ? withCacheBust(normalized, revision) : null) ?? null;

  if (!profileMediaLoaded) {
    return {
      customSrc,
      pending: !customSrc,
      showDefault: false,
      displaySrc: customSrc,
    };
  }

  if (customSrc) {
    return {
      customSrc,
      pending: false,
      showDefault: false,
      displaySrc: customSrc,
    };
  }

  return {
    customSrc: null,
    pending: false,
    showDefault: true,
    displaySrc: defaultImage,
  };
}
