import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getUserProfile } from "@/lib/profile-storage";
import { COVER_UPDATED_EVENT, type CoverUpdatedDetail } from "@/lib/cover-events";
import { isSameMediaUrl, withCacheBust } from "@/lib/media-display-url";
import { readProfileSessionCache } from "@/lib/profile-session-cache";
import { shouldUseLightStartupShell, readBrowserPathname } from "@/lib/startup-path";
import { useAuth } from "@/hooks/use-auth";

type CoverCtx = {
  coverUrl: string | null;
  coverSrc: string | null;
  refresh: () => Promise<void>;
  syncFromProfile: (url: string | null) => void;
  setPreview: (url: string | null) => void;
};

const Ctx = createContext<CoverCtx | null>(null);

export function CoverProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const userId = user?.id;
  const [coverUrl, setCoverUrl] = useState<string | null>(
    () => readProfileSessionCache(userId)?.coverImageUrl ?? null,
  );
  const [coverRevision, setCoverRevision] = useState(0);
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
    setCoverUrl((prev) => (isSameMediaUrl(prev, url) ? prev : url));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const profile = await getUserProfile();
      setCoverUrl((prev) =>
        isSameMediaUrl(prev, profile.coverImageUrl) ? prev : profile.coverImageUrl,
      );
      setPreview(null);
    } catch {
      /* keep last */
    }
  }, [setPreview]);

  useEffect(() => {
    if (!userId) return;
    const cached = readProfileSessionCache(userId);
    if (cached) {
      setCoverUrl((prev) =>
        isSameMediaUrl(prev, cached.coverImageUrl) ? prev : cached.coverImageUrl,
      );
    }
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
    };
    window.addEventListener(COVER_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(COVER_UPDATED_EVENT, onUpdate);
  }, [setPreview]);

  useEffect(() => {
    if (skipProfileFetch) return;
    if (readProfileSessionCache(userId)) return;
    void refresh();
  }, [refresh, skipProfileFetch, userId]);

  const coverSrc = preview ?? withCacheBust(coverUrl, coverRevision);

  const ctx = useMemo(
    () => ({ coverUrl, coverSrc, refresh, syncFromProfile, setPreview }),
    [coverUrl, coverSrc, refresh, syncFromProfile, setPreview],
  );

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useCover() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCover must be used within CoverProvider");
  return ctx;
}
