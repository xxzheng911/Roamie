import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import defaultAvatar from "@/assets/roamie-default-avatar.png";
import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import { getUserProfile } from "@/lib/profile-storage";
import { AVATAR_UPDATED_EVENT, type AvatarUpdatedDetail } from "@/lib/avatar-events";
import { isSameMediaUrl } from "@/lib/media-display-url";
import { preloadAvatarImage } from "@/lib/profile-avatar-preload";
import { readProfileSessionCache } from "@/lib/profile-session-cache";
import {
  avatarRevisionFromUpdatedAt,
  readCachedProfile,
  readPersistedDisplayName,
  resolveAvatarDisplayUrl,
  writeCachedProfile,
  isCachedAvatarNewerThan,
  type CachedProfile,
} from "@/lib/profile-persisted-cache";
import {
  hasProfileSessionCache,
  readCachedAvatarUrl,
  resolveProfileMediaDisplay,
} from "@/lib/profile-media-display";
import { shouldUseLightStartupShell, readBrowserPathname } from "@/lib/startup-path";
import { useAuth } from "@/hooks/use-auth";

type AvatarCtx = {
  avatarUrl: string | null;
  displayName: string;
  profileMediaLoaded: boolean;
  avatarDisplaySrc: string | null;
  avatarPending: boolean;
  showAvatarDefault: boolean;
  avatarSrc: string;
  refresh: () => Promise<void>;
  syncFromProfile: (url: string | null) => void;
  setPreview: (url: string | null) => void;
};

const Ctx = createContext<AvatarCtx | null>(null);

function bootCachedProfile(userId?: string | null): CachedProfile | null {
  return readCachedProfile(userId ?? readCachedAuthenticatedUserIdSync());
}

function hydrateFromCache(userId?: string | null): {
  avatarUrl: string | null;
  displayName: string;
  avatarUpdatedAt: string | null;
  hasCache: boolean;
} {
  const cached = bootCachedProfile(userId);
  if (cached) {
    return {
      avatarUrl: cached.avatarUrl,
      displayName: cached.displayName,
      avatarUpdatedAt: cached.avatarUpdatedAt,
      hasCache: true,
    };
  }
  const avatarUrl = readCachedAvatarUrl(userId);
  const displayName = readPersistedDisplayName(userId) ?? "";
  return {
    avatarUrl,
    displayName,
    avatarUpdatedAt: null,
    hasCache: Boolean(avatarUrl || displayName),
  };
}

export function AvatarProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const bootUserId = userId ?? readCachedAuthenticatedUserIdSync();
  const boot = hydrateFromCache(bootUserId);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => boot.avatarUrl);
  const [displayName, setDisplayName] = useState(() => boot.displayName);
  const [avatarUpdatedAt, setAvatarUpdatedAt] = useState<string | null>(() => boot.avatarUpdatedAt);
  const [avatarRevision, setAvatarRevision] = useState(() =>
    avatarRevisionFromUpdatedAt(boot.avatarUpdatedAt),
  );
  const [preview, setPreviewState] = useState<string | null>(null);
  const [profileMediaLoaded, setProfileMediaLoaded] = useState(
    () => boot.hasCache || hasProfileSessionCache(bootUserId),
  );

  const setPreview = useCallback((url: string | null) => {
    setPreviewState((prev) => {
      if (prev?.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(prev);
        } catch {
          /* noop */
        }
      }
      return url;
    });
  }, []);

  const pathname = readBrowserPathname();
  const skipProfileFetch = shouldUseLightStartupShell(pathname, Boolean(user), authLoading);

  useLayoutEffect(() => {
    if (boot.hasCache && boot.avatarUrl) {
      console.info("[PROFILE_RENDER_FROM_CACHE]", { userId: bootUserId ?? null });
      preloadAvatarImage(bootUserId, boot.avatarUrl, boot.avatarUpdatedAt);
    }
  }, [boot.avatarUrl, boot.avatarUpdatedAt, boot.hasCache, bootUserId]);

  const syncFromProfile = useCallback((url: string | null) => {
    const next = url?.trim() || null;
    if (!next) return;
    setAvatarUrl((prev) => (isSameMediaUrl(prev, next) ? prev : next));
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const cachedBeforeFetch = readCachedProfile(userId);
    console.info("[PROFILE_SUPABASE_REFRESH_START]", { userId });
    try {
      const profile = await getUserProfile(undefined, { force: true });
      if (
        isCachedAvatarNewerThan(cachedBeforeFetch, profile.profileUpdatedAt ?? null) &&
        cachedBeforeFetch?.avatarUrl &&
        !isSameMediaUrl(profile.avatarUrl, cachedBeforeFetch.avatarUrl)
      ) {
        console.info("[PROFILE_STALE_IGNORED]", { userId });
        setProfileMediaLoaded(true);
        return;
      }

      setAvatarUrl((prev) => (isSameMediaUrl(prev, profile.avatarUrl) ? prev : profile.avatarUrl));
      setDisplayName(profile.displayName);
      const updatedAt = profile.profileUpdatedAt ?? new Date().toISOString();
      setAvatarUpdatedAt(updatedAt);
      setAvatarRevision(avatarRevisionFromUpdatedAt(updatedAt));
      setPreview(null);
      preloadAvatarImage(userId, profile.avatarUrl, updatedAt);
      console.info("[PROFILE_SUPABASE_REFRESH_SUCCESS]", { userId });
    } catch {
      /* keep cached url */
    } finally {
      setProfileMediaLoaded(true);
    }
  }, [setPreview, userId]);

  useEffect(() => {
    if (!userId) {
      if (!boot.hasCache) {
        setProfileMediaLoaded(false);
      }
      return;
    }
    const session = readProfileSessionCache(userId);
    if (session) {
      setAvatarUrl((prev) =>
        isSameMediaUrl(prev, session.avatarUrl) ? prev : session.avatarUrl,
      );
      setDisplayName(session.displayName);
      setProfileMediaLoaded(true);
      preloadAvatarImage(userId, session.avatarUrl, avatarUpdatedAt);
      return;
    }
    const cached = hydrateFromCache(userId);
    if (cached.avatarUrl) {
      setAvatarUrl((prev) => (isSameMediaUrl(prev, cached.avatarUrl) ? prev : cached.avatarUrl));
    }
    if (cached.displayName) {
      setDisplayName(cached.displayName);
    }
    if (cached.avatarUpdatedAt) {
      setAvatarUpdatedAt(cached.avatarUpdatedAt);
      setAvatarRevision(avatarRevisionFromUpdatedAt(cached.avatarUpdatedAt));
    }
    if (cached.hasCache) {
      setProfileMediaLoaded(true);
      preloadAvatarImage(userId, cached.avatarUrl, cached.avatarUpdatedAt);
    }
  }, [userId, avatarUpdatedAt]);

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<AvatarUpdatedDetail | string | null>).detail;
      const url =
        detail && typeof detail === "object" && "url" in detail
          ? detail.url
          : typeof detail === "string" || detail === null
            ? detail
            : null;
      const revision =
        detail && typeof detail === "object" && "revision" in detail && detail.revision
          ? detail.revision
          : Date.now();
      const updatedIso = new Date(revision).toISOString();
      setAvatarUrl(url);
      setAvatarUpdatedAt(updatedIso);
      setAvatarRevision(revision);
      setPreview(null);
      setProfileMediaLoaded(true);
      if (userId) {
        writeCachedProfile({
          userId,
          avatarUrl: url,
          avatarUpdatedAt: updatedIso,
        });
        preloadAvatarImage(userId, url, updatedIso);
      }
    };
    window.addEventListener(AVATAR_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(AVATAR_UPDATED_EVENT, onUpdate);
  }, [userId]);

  useEffect(() => {
    if (!userId || authLoading) return;
    if (skipProfileFetch) {
      if (hasProfileSessionCache(userId) || readCachedProfile(userId)) {
        setProfileMediaLoaded(true);
      }
      return;
    }
    void refresh();
  }, [refresh, skipProfileFetch, userId, authLoading]);

  const media = useMemo(
    () =>
      resolveProfileMediaDisplay(
        avatarUrl,
        preview,
        profileMediaLoaded,
        defaultAvatar,
        avatarRevision || avatarRevisionFromUpdatedAt(avatarUpdatedAt),
      ),
    [avatarUrl, preview, profileMediaLoaded, avatarRevision, avatarUpdatedAt],
  );

  const ctx = useMemo(
    () => ({
      avatarUrl,
      displayName,
      profileMediaLoaded,
      avatarDisplaySrc: media.displaySrc,
      avatarPending: media.pending,
      showAvatarDefault: media.showDefault,
      avatarSrc: media.displaySrc ?? defaultAvatar,
      refresh,
      syncFromProfile,
      setPreview,
    }),
    [avatarUrl, displayName, profileMediaLoaded, media, refresh, syncFromProfile, setPreview],
  );

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useAvatar() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAvatar must be used within AvatarProvider");
  return ctx;
}

export function useAvatarDisplaySrc(): string | null {
  const { avatarDisplaySrc } = useAvatar();
  return avatarDisplaySrc;
}
