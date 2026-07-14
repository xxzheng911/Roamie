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
import { readProfileSessionCache } from "@/lib/profile-session-cache";
import {
  avatarRevisionFromUpdatedAt,
  isCachedAvatarNewerThan,
  readCachedProfile,
  writeCachedProfile,
  type CachedProfile,
} from "@/lib/profile-persisted-cache";
import { hasProfileSessionCache } from "@/lib/profile-media-display";
import { shouldUseLightStartupShell, readBrowserPathname } from "@/lib/startup-path";
import { useAuth } from "@/hooks/use-auth";
import { useUserMediaStore } from "@/hooks/use-user-media-store";
import {
  hydrateUserMediaFromCache,
  seedUserMediaFromPersistedSync,
  validateUserMediaRemote,
} from "@/lib/user-media/user-media-store";

type AvatarCtx = {
  avatarUrl: string | null;
  displayName: string;
  profileMediaLoaded: boolean;
  avatarDisplaySrc: string | null;
  avatarPending: boolean;
  showAvatarDefault: boolean;
  avatarSrc: string | null;
  refresh: () => Promise<void>;
  syncFromProfile: (url: string | null) => void;
  setPreview: (url: string | null) => void;
};

const Ctx = createContext<AvatarCtx | null>(null);

function bootCachedProfile(userId?: string | null): CachedProfile | null {
  return readCachedProfile(userId ?? readCachedAuthenticatedUserIdSync(), { quiet: true });
}

export function AvatarProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const bootUserId = userId ?? readCachedAuthenticatedUserIdSync();
  const media = useUserMediaStore();

  const [displayName, setDisplayName] = useState(
    () => bootCachedProfile(bootUserId)?.displayName ?? "",
  );
  const [preview, setPreviewState] = useState<string | null>(null);
  const [metadataLoaded, setMetadataLoaded] = useState(
    () => Boolean(bootCachedProfile(bootUserId)) || hasProfileSessionCache(bootUserId),
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
    seedUserMediaFromPersistedSync(bootUserId);
    void hydrateUserMediaFromCache(bootUserId);
  }, [bootUserId]);

  const syncFromProfile = useCallback((url: string | null) => {
    const next = url?.trim() || null;
    if (!next || !userId) return;
    void validateUserMediaRemote({
      userId,
      avatarUrl: next,
      coverUrl: media.coverUrl,
      avatarUpdatedAt: media.avatarVersion
        ? new Date(Number(media.avatarVersion) || Date.now()).toISOString()
        : null,
      profileUpdatedAt: media.coverVersion
        ? new Date(Number(media.coverVersion) || Date.now()).toISOString()
        : null,
    });
  }, [media.avatarVersion, media.coverUrl, media.coverVersion, userId]);

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
        setMetadataLoaded(true);
        return;
      }

      setDisplayName(profile.displayName);
      setPreview(null);
      await validateUserMediaRemote({
        userId,
        avatarUrl: profile.avatarUrl,
        coverUrl: profile.coverImageUrl,
        avatarUpdatedAt: profile.profileUpdatedAt,
        profileUpdatedAt: profile.profileUpdatedAt,
        // Confirmed remote absence → allow clearing only when API returned null
        // AND local had no evidence of custom (handled inside validate).
        confirmAvatarRemoved:
          !profile.avatarUrl &&
          cachedBeforeFetch?.hasCustomAvatar !== true &&
          !cachedBeforeFetch?.avatarUrl,
      });
      console.info("[PROFILE_SUPABASE_REFRESH_SUCCESS]", { userId });
    } catch {
      /* keep cached image */
    } finally {
      setMetadataLoaded(true);
    }
  }, [setPreview, userId]);

  useEffect(() => {
    if (!userId) return;
    const session = readProfileSessionCache(userId);
    if (session) {
      setDisplayName(session.displayName);
      setMetadataLoaded(true);
      void validateUserMediaRemote({
        userId,
        avatarUrl: session.avatarUrl,
        coverUrl: session.coverImageUrl,
        avatarUpdatedAt: session.profileUpdatedAt,
        profileUpdatedAt: session.profileUpdatedAt,
      });
      return;
    }
    const cached = readCachedProfile(userId);
    if (cached?.displayName) setDisplayName(cached.displayName);
    if (cached) setMetadataLoaded(true);
  }, [userId]);

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
      setPreview(null);
      setMetadataLoaded(true);
      if (userId) {
        writeCachedProfile({
          userId,
          avatarUrl: url,
          avatarUpdatedAt: updatedIso,
          hasCustomAvatar: Boolean(url),
        });
        void validateUserMediaRemote({
          userId,
          avatarUrl: url,
          coverUrl: media.coverUrl,
          avatarUpdatedAt: updatedIso,
          profileUpdatedAt: updatedIso,
          confirmAvatarRemoved: url == null,
        });
      }
    };
    window.addEventListener(AVATAR_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(AVATAR_UPDATED_EVENT, onUpdate);
  }, [media.coverUrl, setPreview, userId]);

  useEffect(() => {
    if (!userId || authLoading) return;
    if (skipProfileFetch) {
      if (hasProfileSessionCache(userId) || readCachedProfile(userId)) {
        setMetadataLoaded(true);
      }
      return;
    }
    void refresh();
  }, [refresh, skipProfileFetch, userId, authLoading]);

  const avatarDisplaySrc =
    preview ??
    media.avatarLocalUri ??
    (media.avatarStatus === "custom" || media.hasCustomAvatar === true || media.avatarUrl
      ? media.avatarUrl
      : null);

  const avatarPending =
    !preview &&
    media.avatarStatus !== "none" &&
    !media.avatarLocalUri &&
    !media.avatarUrl;

  // Only confirmed absence may show the bundled default.
  const showAvatarDefault =
    media.avatarStatus === "none" &&
    !preview &&
    !media.avatarUrl &&
    !media.avatarLocalUri;

  const ctx = useMemo(
    () => ({
      avatarUrl: media.avatarUrl,
      displayName,
      profileMediaLoaded: metadataLoaded || media.isAvatarReady || media.avatarStatus !== "unknown",
      avatarDisplaySrc,
      avatarPending:
        avatarPending ||
        (media.avatarStatus === "custom" && !avatarDisplaySrc) ||
        (media.avatarStatus === "unknown" && !avatarDisplaySrc),
      showAvatarDefault,
      // Never expose default as a silent fallback while status is unknown/custom.
      avatarSrc: showAvatarDefault ? defaultAvatar : avatarDisplaySrc,
      refresh,
      syncFromProfile,
      setPreview,
    }),
    [
      avatarDisplaySrc,
      avatarPending,
      displayName,
      media.avatarStatus,
      media.avatarUrl,
      media.isAvatarReady,
      metadataLoaded,
      refresh,
      setPreview,
      showAvatarDefault,
      syncFromProfile,
    ],
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

// Keep revision helper available for external callers that imported from here historically.
export { avatarRevisionFromUpdatedAt };
