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
import defaultCover from "@/assets/roamie-default-cover.png";
import { getUserProfile } from "@/lib/profile-storage";
import { COVER_UPDATED_EVENT, type CoverUpdatedDetail } from "@/lib/cover-events";
import { readProfileSessionCache } from "@/lib/profile-session-cache";
import {
  hasProfileSessionCache,
  readCachedCoverUrl,
} from "@/lib/profile-media-display";
import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import { readCachedProfile, writeCachedProfile } from "@/lib/profile-persisted-cache";
import { shouldUseLightStartupShell, readBrowserPathname } from "@/lib/startup-path";
import { useAuth } from "@/hooks/use-auth";
import { useUserMediaStore } from "@/hooks/use-user-media-store";
import {
  hydrateUserMediaFromCache,
  seedUserMediaFromPersistedSync,
  validateUserMediaRemote,
} from "@/lib/user-media/user-media-store";

type CoverCtx = {
  coverUrl: string | null;
  profileMediaLoaded: boolean;
  coverDisplaySrc: string | null;
  coverPending: boolean;
  showCoverDefault: boolean;
  /** Resolved src with local blob preferred — custom only, null while pending */
  coverSrc: string | null;
  refresh: () => Promise<void>;
  syncFromProfile: (url: string | null) => void;
  setPreview: (url: string | null) => void;
};

const Ctx = createContext<CoverCtx | null>(null);

export function CoverProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const bootUserId = userId ?? readCachedAuthenticatedUserIdSync();
  const media = useUserMediaStore();
  const bootCover =
    readCachedCoverUrl(bootUserId) ??
    readCachedProfile(bootUserId, { quiet: true })?.coverImageUrl ??
    null;

  const [preview, setPreviewState] = useState<string | null>(null);
  const [metadataLoaded, setMetadataLoaded] = useState(
    () =>
      Boolean(bootCover) ||
      hasProfileSessionCache(bootUserId) ||
      Boolean(readCachedProfile(bootUserId, { quiet: true })),
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

  const syncFromProfile = useCallback(
    (url: string | null) => {
      const next = url?.trim() || null;
      if (!userId) return;
      void validateUserMediaRemote({
        userId,
        avatarUrl: media.avatarUrl,
        coverUrl: next,
        avatarUpdatedAt: media.avatarVersion
          ? new Date(Number(media.avatarVersion) || Date.now()).toISOString()
          : null,
        profileUpdatedAt: new Date().toISOString(),
      });
    },
    [media.avatarUrl, media.avatarVersion, userId],
  );

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const profile = await getUserProfile();
      setPreview(null);
      await validateUserMediaRemote({
        userId,
        avatarUrl: profile.avatarUrl,
        coverUrl: profile.coverImageUrl,
        avatarUpdatedAt: profile.profileUpdatedAt,
        profileUpdatedAt: profile.profileUpdatedAt,
      });
    } catch {
      /* keep cached image — never clear to default */
    } finally {
      setMetadataLoaded(true);
    }
  }, [setPreview, userId]);

  useEffect(() => {
    if (!userId) return;
    const session = readProfileSessionCache(userId);
    if (session) {
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
    if (cached) setMetadataLoaded(true);
  }, [userId]);

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<CoverUpdatedDetail | string | null>).detail;
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
          coverImageUrl: url,
          profileUpdatedAt: updatedIso,
        });
        void validateUserMediaRemote({
          userId,
          avatarUrl: media.avatarUrl,
          coverUrl: url,
          avatarUpdatedAt: media.avatarVersion
            ? new Date(Number(media.avatarVersion) || Date.now()).toISOString()
            : updatedIso,
          profileUpdatedAt: updatedIso,
        });
      }
    };
    window.addEventListener(COVER_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(COVER_UPDATED_EVENT, onUpdate);
  }, [media.avatarUrl, media.avatarVersion, setPreview, userId]);

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

  const coverDisplaySrc =
    preview ??
    media.coverLocalUri ??
    (media.hasCustomCover || media.coverUrl ? media.coverUrl : null);

  const coverPending =
    !preview &&
    (media.hasCustomCover || Boolean(media.coverUrl)) &&
    !coverDisplaySrc &&
    !media.isCoverReady;

  const showCoverDefault =
    media.isCoverReady && !media.hasCustomCover && !preview && !media.coverUrl;

  const ctx = useMemo(
    () => ({
      coverUrl: media.coverUrl,
      profileMediaLoaded: metadataLoaded || media.isCoverReady,
      coverDisplaySrc: coverDisplaySrc ?? (showCoverDefault ? defaultCover : null),
      coverPending,
      showCoverDefault,
      coverSrc: coverDisplaySrc,
      refresh,
      syncFromProfile,
      setPreview,
    }),
    [
      coverDisplaySrc,
      coverPending,
      media.coverUrl,
      media.isCoverReady,
      metadataLoaded,
      refresh,
      setPreview,
      showCoverDefault,
      syncFromProfile,
    ],
  );

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useCover() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCover must be used within CoverProvider");
  return ctx;
}
