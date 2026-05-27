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
import { AVATAR_UPDATED_EVENT } from "@/lib/avatar-events";
import { shouldUseLightStartupShell, readBrowserPathname } from "@/lib/startup-path";
import { useAuth } from "@/hooks/use-auth";

type AvatarCtx = {
  avatarUrl: string | null;
  avatarSrc: string;
  refresh: () => Promise<void>;
  setPreview: (url: string | null) => void;
};

const Ctx = createContext<AvatarCtx | null>(null);

export function AvatarProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
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

  const refresh = useCallback(async () => {
    try {
      const profile = await getUserProfile();
      setAvatarUrl(profile.avatarUrl);
      setPreview(null);
    } catch {
      /* keep last */
    }
  }, [setPreview]);

  useEffect(() => {
    if (skipProfileFetch) return;

    void refresh();
    const onUpdate = (e: Event) => {
      const url = (e as CustomEvent<string | null>).detail ?? null;
      setAvatarUrl(url);
      setPreview(null);
    };
    window.addEventListener(AVATAR_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(AVATAR_UPDATED_EVENT, onUpdate);
  }, [refresh, skipProfileFetch]);

  const avatarSrc = preview ?? avatarUrl ?? defaultAvatar;

  const ctx = useMemo(
    () => ({ avatarUrl, avatarSrc, refresh, setPreview }),
    [avatarUrl, avatarSrc, refresh, setPreview],
  );

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useAvatar() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAvatar must be used within AvatarProvider");
  return ctx;
}
