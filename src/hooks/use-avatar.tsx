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
import { isSameMediaUrl, withCacheBust } from "@/lib/media-display-url";
import { readProfileSessionCache } from "@/lib/profile-session-cache";
import { readPersistedAvatarUrl } from "@/lib/profile-persisted-cache";
import { shouldUseLightStartupShell, readBrowserPathname } from "@/lib/startup-path";
import { useAuth } from "@/hooks/use-auth";

type AvatarCtx = {
  avatarUrl: string | null;
  avatarSrc: string;
  refresh: () => Promise<void>;
  syncFromProfile: (url: string | null) => void;
  setPreview: (url: string | null) => void;
};

const Ctx = createContext<AvatarCtx | null>(null);

export function AvatarProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const userId = user?.id;
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    () => readProfileSessionCache(userId)?.avatarUrl ?? readPersistedAvatarUrl(userId) ?? null,
  );
  const [avatarRevision, setAvatarRevision] = useState(0);
  const [preview, setPreviewState] = useState<string | null>(null);

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
  const skipProfileFetch = shouldUseLightStartupShell(pathname, Boolean(user), loading);

  const syncFromProfile = useCallback((url: string | null) => {
    setAvatarUrl((prev) => (isSameMediaUrl(prev, url) ? prev : url));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const profile = await getUserProfile();
      setAvatarUrl((prev) => (isSameMediaUrl(prev, profile.avatarUrl) ? prev : profile.avatarUrl));
      setPreview(null);
    } catch {
      /* keep last */
    }
  }, [setPreview]);

  useEffect(() => {
    if (!userId) return;
    const cached = readProfileSessionCache(userId);
    if (cached?.avatarUrl) {
      setAvatarUrl((prev) => (isSameMediaUrl(prev, cached.avatarUrl) ? prev : cached.avatarUrl));
      return;
    }
    const persisted = readPersistedAvatarUrl(userId);
    if (persisted) {
      setAvatarUrl((prev) => (isSameMediaUrl(prev, persisted) ? prev : persisted));
    }
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
    };
    window.addEventListener(AVATAR_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(AVATAR_UPDATED_EVENT, onUpdate);
  }, [setPreview]);

  useEffect(() => {
    if (skipProfileFetch) return;
    void refresh();
  }, [refresh, skipProfileFetch, userId]);

  const avatarSrc =
    preview ?? withCacheBust(avatarUrl, avatarRevision) ?? defaultAvatar;

  const ctx = useMemo(
    () => ({ avatarUrl, avatarSrc, refresh, syncFromProfile, setPreview }),
    [avatarUrl, avatarSrc, refresh, syncFromProfile, setPreview],
  );

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useAvatar() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAvatar must be used within AvatarProvider");
  return ctx;
}
