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
  resolveAvatarDisplayUrl,
  writeCachedProfile,
  type CachedProfile,
} from "@/lib/profile-persisted-cache";
import { hasProfileSessionCache } from "@/lib/profile-media-display";
import { shouldUseLightStartupShell, readBrowserPathname } from "@/lib/startup-path";
import { useAuth } from "@/hooks/use-auth";
import { useUserMediaStore } from "@/hooks/use-user-media-store";
import {
  hydrateUserMediaFromCache,
  getUserMediaSnapshot,
  seedUserMediaFromPersistedSync,
  validateUserMediaRemote,
} from "@/lib/user-media/user-media-store";

type AvatarCtx = {
  avatarUrl: string | null;
  displayName: string;
  profileMediaLoaded: boolean;
  avatarDisplaySrc: string | null;
  avatarDisplaySource: "memory_custom" | "persisted_custom" | "remote_custom" | "none";
  hasCachedCustomEvidence: boolean;
  avatarPending: boolean;
  showAvatarDefault: boolean;
  avatarSrc: string | null;
  firstRenderSnapshot: {
    userIdentityKnown: boolean;
    avatarStatus: "unknown" | "custom" | "none";
    hasMemoryCustom: boolean;
    hasPersistedCustomMetadata: boolean;
    hasPersistedCustomImage: boolean;
    hasCachedCustomUrl: boolean;
    authReady: boolean;
    profileReady: boolean;
  };
  refresh: () => Promise<void>;
  syncFromProfile: (url: string | null) => void;
  setPreview: (url: string | null) => void;
};

const Ctx = createContext<AvatarCtx | null>(null);

function bootCachedProfile(userId?: string | null): CachedProfile | null {
  const confirmedOwner = userId ?? readCachedAuthenticatedUserIdSync();
  return confirmedOwner ? readCachedProfile(confirmedOwner, { quiet: true }) : null;
}

export function AvatarProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const bootUserId = userId ?? readCachedAuthenticatedUserIdSync();
  // This initializer runs before useUserMediaStore's first snapshot read. It is
  // the synchronous first-frame authority; effects only hydrate disk/remote data.
  useState(() => seedUserMediaFromPersistedSync(bootUserId));
  const media = useUserMediaStore();
  const persistedProfile = bootCachedProfile(bootUserId);
  const persistedAvatarSrc = resolveAvatarDisplayUrl(
    persistedProfile?.avatarUrl,
    persistedProfile?.avatarUpdatedAt ?? persistedProfile?.profileUpdatedAt,
  );

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
    console.info("[AVATAR_RENDER_STAGE]", {
      stage: media.avatarUrl || media.avatarLocalUri ? "memory_custom_hit" : "memory_custom_miss",
      elapsedMs: 0,
    });
    seedUserMediaFromPersistedSync(bootUserId);
    const seededMedia = getUserMediaSnapshot();
    console.info("[AVATAR_RENDER_STAGE]", {
      stage:
        seededMedia.avatarLocalUri || seededMedia.avatarUrl
          ? "local_cache_hit"
          : "local_cache_miss",
      elapsedMs: 0,
    });
    console.info("[AVATAR_RENDER_STAGE]", {
      stage: "profile_snapshot_available",
      elapsedMs: 0,
      available: Boolean(bootCachedProfile(bootUserId)),
    });
    const persisted = bootCachedProfile(bootUserId);
    console.info("[AVATAR_RENDER_STAGE]", {
      stage:
        persisted?.avatarUrl || persisted?.hasCustomAvatar
          ? "persisted_custom_hit"
          : "persisted_custom_miss",
      elapsedMs: 0,
    });
    const localStartedAt = performance.now();
    void hydrateUserMediaFromCache(bootUserId).finally(() => {
      const hydratedMedia = getUserMediaSnapshot();
      console.info("[AVATAR_RENDER_STAGE]", {
        stage:
          hydratedMedia.avatarLocalUri || hydratedMedia.avatarUrl
            ? "local_cache_hit"
            : "local_cache_miss",
        elapsedMs: Math.round(performance.now() - localStartedAt),
      });
    });
    // Cache hydration is keyed by identity; media updates must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootUserId]);

  const syncFromProfile = useCallback(
    (url: string | null) => {
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
    },
    [media.avatarVersion, media.coverUrl, media.coverVersion, userId],
  );

  const refresh = useCallback(async () => {
    if (!userId) return;
    const profileStartedAt = Date.now();
    const cachedBeforeFetch = readCachedProfile(userId);
    console.info("[APP_BOOT_STAGE]", {
      stage: "profile_start",
      timestamp: new Date(profileStartedAt).toISOString(),
      elapsedMs: 0,
      userId,
    });
    console.info("[PROFILE_SUPABASE_REFRESH_START]", { userId });
    console.info("[AVATAR_RENDER_STAGE]", {
      stage: "remote_fetch_start",
      elapsedMs: 0,
      userId,
    });
    console.info("[AVATAR_RENDER_STAGE]", {
      stage: "remote_refresh_start",
      elapsedMs: 0,
      userId,
    });
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
      console.info("[APP_BOOT_STAGE]", {
        stage: "profile_done",
        timestamp: new Date().toISOString(),
        elapsedMs: Date.now() - profileStartedAt,
        userId,
      });
      console.info("[AVATAR_RENDER_STAGE]", {
        stage: "remote_fetch_done",
        elapsedMs: Date.now() - profileStartedAt,
        userId,
      });
      console.info("[AVATAR_RENDER_STAGE]", {
        stage: "remote_refresh_done",
        elapsedMs: Date.now() - profileStartedAt,
        userId,
      });
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
    console.info("[AVATAR_RENDER_STAGE]", {
      stage: "profile_custom_state",
      elapsedMs: 0,
      avatarStatus: media.avatarStatus,
      hasCustomAvatar: media.hasCustomAvatar,
    });
  }, [media.avatarStatus, media.hasCustomAvatar]);

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

  const mediaOwnerMatches = Boolean(bootUserId && media.userId === bootUserId);
  const effectiveAvatarStatus =
    persistedAvatarSrc || persistedProfile?.hasCustomAvatar === true
      ? "custom"
      : mediaOwnerMatches
        ? media.avatarStatus
        : "unknown";
  const avatarDisplaySrc =
    preview ??
    (mediaOwnerMatches ? media.avatarLocalUri : null) ??
    persistedAvatarSrc ??
    (mediaOwnerMatches &&
    (media.avatarStatus === "custom" || media.hasCustomAvatar === true || media.avatarUrl)
      ? media.avatarUrl
      : null);
  const avatarDisplaySource: AvatarCtx["avatarDisplaySource"] =
    preview || (mediaOwnerMatches && media.avatarLocalUri)
      ? "memory_custom"
      : persistedAvatarSrc
        ? "persisted_custom"
        : mediaOwnerMatches && media.avatarUrl
          ? "remote_custom"
          : "none";

  const avatarPending =
    !preview &&
    (!mediaOwnerMatches || media.avatarStatus !== "none") &&
    !(mediaOwnerMatches && media.avatarLocalUri) &&
    !(mediaOwnerMatches && media.avatarUrl);

  // Only confirmed absence may show the bundled default.
  const showAvatarDefault =
    mediaOwnerMatches &&
    media.avatarStatus === "none" &&
    !preview &&
    !media.avatarUrl &&
    !media.avatarLocalUri;

  const ctx = useMemo(
    () => ({
      avatarUrl: mediaOwnerMatches ? media.avatarUrl : null,
      displayName,
      profileMediaLoaded: metadataLoaded || media.isAvatarReady || media.avatarStatus !== "unknown",
      avatarDisplaySrc,
      avatarDisplaySource,
      hasCachedCustomEvidence: Boolean(
        persistedAvatarSrc ||
        persistedProfile?.hasCustomAvatar ||
        (mediaOwnerMatches && media.avatarLocalUri) ||
        (mediaOwnerMatches && media.avatarUrl) ||
        (mediaOwnerMatches && media.hasCustomAvatar),
      ),
      avatarPending:
        avatarPending ||
        (effectiveAvatarStatus === "custom" && !avatarDisplaySrc) ||
        (effectiveAvatarStatus === "unknown" && !avatarDisplaySrc),
      showAvatarDefault,
      // Never expose default as a silent fallback while status is unknown/custom.
      avatarSrc: showAvatarDefault ? defaultAvatar : avatarDisplaySrc,
      firstRenderSnapshot: {
        userIdentityKnown: Boolean(bootUserId),
        avatarStatus: effectiveAvatarStatus,
        hasMemoryCustom: Boolean(mediaOwnerMatches && (media.avatarLocalUri || media.avatarUrl)),
        hasPersistedCustomMetadata: persistedProfile?.hasCustomAvatar === true,
        hasPersistedCustomImage: Boolean(mediaOwnerMatches && media.avatarLocalUri),
        hasCachedCustomUrl: Boolean(persistedAvatarSrc),
        authReady: !authLoading,
        profileReady: metadataLoaded,
      },
      refresh,
      syncFromProfile,
      setPreview,
    }),
    [
      avatarDisplaySrc,
      avatarDisplaySource,
      avatarPending,
      displayName,
      effectiveAvatarStatus,
      authLoading,
      bootUserId,
      media.avatarStatus,
      media.avatarLocalUri,
      media.avatarUrl,
      media.hasCustomAvatar,
      media.isAvatarReady,
      mediaOwnerMatches,
      metadataLoaded,
      persistedAvatarSrc,
      persistedProfile?.hasCustomAvatar,
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
