import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import defaultAvatar from "@/assets/roamie-default-avatar.png";
import { getUserProfile } from "@/lib/profile-storage";
import { AVATAR_UPDATED_EVENT } from "@/lib/avatar-events";

type AvatarCtx = {
  avatarUrl: string | null;
  avatarSrc: string;
  refresh: () => Promise<void>;
  setPreview: (url: string | null) => void;
};

const Ctx = createContext<AvatarCtx | null>(null);

export function AvatarProvider({ children }: { children: ReactNode }) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const profile = await getUserProfile();
      setAvatarUrl(profile.avatarUrl);
      setPreview(null);
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUpdate = (e: Event) => {
      const url = (e as CustomEvent<string | null>).detail ?? null;
      setAvatarUrl(url);
      setPreview(null);
    };
    window.addEventListener(AVATAR_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(AVATAR_UPDATED_EVENT, onUpdate);
  }, [refresh]);

  const avatarSrc = preview ?? avatarUrl ?? defaultAvatar;

  return (
    <Ctx.Provider value={{ avatarUrl, avatarSrc, refresh, setPreview }}>{children}</Ctx.Provider>
  );
}

export function useAvatar() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAvatar must be used within AvatarProvider");
  return ctx;
}
