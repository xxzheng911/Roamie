import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import defaultCover from "@/assets/roamie-default-cover.png";
import { getUserProfile } from "@/lib/profile-storage";
import { COVER_UPDATED_EVENT, type CoverUpdatedDetail } from "@/lib/cover-events";
import { isSameMediaUrl } from "@/lib/media-display-url";
import { readProfileSessionCache } from "@/lib/profile-session-cache";
import {
  hasProfileSessionCache,
  readCachedCoverUrl,
  resolveProfileMediaDisplay,
} from "@/lib/profile-media-display";
import { shouldUseLightStartupShell, readBrowserPathname } from "@/lib/startup-path";
import { useAuth } from "@/hooks/use-auth";

type CoverCtx = {
  coverUrl: string | null;
  profileMediaLoaded: boolean;
  coverDisplaySrc: string | null;
  coverPending: boolean;
  showCoverDefault: boolean;
  /** Resolved src with cache-bust — custom only, null while pending */
  coverSrc: string | null;
  refresh: () => Promise<void>;
  syncFromProfile: (url: string | null) => void;
  setPreview: (url: string | null) => void;
};

const Ctx = createContext<CoverCtx | null>(null);

export function CoverProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const [coverUrl, setCoverUrl] = useState<string | null>(() => readCachedCoverUrl(userId));
  const [coverRevision, setCoverRevision] = useState(0);
  const [preview, setPreviewState] = useState<string | null>(null);
  const [profileMediaLoaded, setProfileMediaLoaded] = useState(() =>
    hasProfileSessionCache(userId),
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

  const syncFromProfile = useCallback((url: string | null) => {
    const next = url?.trim() || null;
    if (!next) return;
    setCoverUrl((prev) => (isSameMediaUrl(prev, next) ? prev : next));
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const profile = await getUserProfile();
      setCoverUrl((prev) =>
        isSameMediaUrl(prev, profile.coverImageUrl) ? prev : profile.coverImageUrl,
      );
      setPreview(null);
    } catch {
      /* keep cached url */
    } finally {
      setProfileMediaLoaded(true);
    }
  }, [setPreview, userId]);

  useEffect(() => {
    if (!userId) {
      setProfileMediaLoaded(false);
      return;
    }
    const session = readProfileSessionCache(userId);
    if (session) {
      setCoverUrl((prev) =>
        isSameMediaUrl(prev, session.coverImageUrl) ? prev : session.coverImageUrl,
      );
      setProfileMediaLoaded(true);
      return;
    }
    const cached = readCachedCoverUrl(userId);
    if (cached) {
      setCoverUrl((prev) => (isSameMediaUrl(prev, cached) ? prev : cached));
    }
    setProfileMediaLoaded(false);
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
      setCoverUrl(url);
      setCoverRevision(revision);
      setPreview(null);
      setProfileMediaLoaded(true);
    };
    window.addEventListener(COVER_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(COVER_UPDATED_EVENT, onUpdate);
  }, [setPreview]);

  useEffect(() => {
    if (!userId || authLoading) return;
    if (skipProfileFetch) {
      if (hasProfileSessionCache(userId)) {
        setProfileMediaLoaded(true);
      }
      return;
    }
    void refresh();
  }, [refresh, skipProfileFetch, userId, authLoading]);

  const media = useMemo(
    () =>
      resolveProfileMediaDisplay(
        coverUrl,
        preview,
        profileMediaLoaded,
        defaultCover,
        coverRevision,
      ),
    [coverUrl, preview, profileMediaLoaded, coverRevision],
  );

  const ctx = useMemo(
    () => ({
      coverUrl,
      profileMediaLoaded,
      coverDisplaySrc: media.displaySrc,
      coverPending: media.pending,
      showCoverDefault: media.showDefault,
      coverSrc: media.customSrc,
      refresh,
      syncFromProfile,
      setPreview,
    }),
    [coverUrl, profileMediaLoaded, media, refresh, syncFromProfile, setPreview],
  );

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useCover() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCover must be used within CoverProvider");
  return ctx;
}
