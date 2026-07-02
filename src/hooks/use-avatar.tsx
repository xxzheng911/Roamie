import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import defaultAvatar from "@/assets/roamie-default-avatar.png";
import { getUserProfile } from "@/lib/profile-storage";
import { AVATAR_UPDATED_EVENT, type AvatarUpdatedDetail } from "@/lib/avatar-events";
import { isSameMediaUrl } from "@/lib/media-display-url";
import { readProfileSessionCache } from "@/lib/profile-session-cache";
import {
  hasProfileSessionCache,
  readCachedAvatarUrl,
  resolveProfileMediaDisplay,
} from "@/lib/profile-media-display";
import { shouldUseLightStartupShell, readBrowserPathname } from "@/lib/startup-path";
import { useAuth } from "@/hooks/use-auth";

type AvatarCtx = {
  avatarUrl: string | null;
  profileMediaLoaded: boolean;
  /** img src for UI — null means show skeleton (never default while loading) */
  avatarDisplaySrc: string | null;
  avatarPending: boolean;
  showAvatarDefault: boolean;
  /** @deprecated Prefer avatarDisplaySrc — only default after profileMediaLoaded */
  avatarSrc: string;
  refresh: () => Promise<void>;
  syncFromProfile: (url: string | null) => void;
  setPreview: (url: string | null) => void;
};

const Ctx = createContext<AvatarCtx | null>(null);

export function AvatarProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => readCachedAvatarUrl(userId));
  const [avatarRevision, setAvatarRevision] = useState(0);
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
    setAvatarUrl((prev) => (isSameMediaUrl(prev, next) ? prev : next));
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const profile = await getUserProfile();
      setAvatarUrl((prev) => (isSameMediaUrl(prev, profile.avatarUrl) ? prev : profile.avatarUrl));
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
      setAvatarUrl((prev) =>
        isSameMediaUrl(prev, session.avatarUrl) ? prev : session.avatarUrl,
      );
      setProfileMediaLoaded(true);
      return;
    }
    const cached = readCachedAvatarUrl(userId);
    if (cached) {
      setAvatarUrl((prev) => (isSameMediaUrl(prev, cached) ? prev : cached));
    }
    setProfileMediaLoaded(false);
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
      setAvatarUrl(url);
      setAvatarRevision(revision);
      setPreview(null);
      setProfileMediaLoaded(true);
    };
    window.addEventListener(AVATAR_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(AVATAR_UPDATED_EVENT, onUpdate);
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
        avatarUrl,
        preview,
        profileMediaLoaded,
        defaultAvatar,
        avatarRevision,
      ),
    [avatarUrl, preview, profileMediaLoaded, avatarRevision],
  );

  const ctx = useMemo(
    () => ({
      avatarUrl,
      profileMediaLoaded,
      avatarDisplaySrc: media.displaySrc,
      avatarPending: media.pending,
      showAvatarDefault: media.showDefault,
      avatarSrc: media.displaySrc ?? defaultAvatar,
      refresh,
      syncFromProfile,
      setPreview,
    }),
    [avatarUrl, profileMediaLoaded, media, refresh, syncFromProfile, setPreview],
  );

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useAvatar() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAvatar must be used within AvatarProvider");
  return ctx;
}
