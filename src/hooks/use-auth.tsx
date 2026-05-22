import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { hasOAuthCallbackParams } from "@/lib/auth-oauth";
import { getClientAuthSession, readGuestFlag, writeGuestFlag } from "@/lib/auth-session";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isGuest: boolean;
  enableGuest: () => Promise<void>;
  disableGuest: () => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  loading: true,
  isGuest: false,
  enableGuest: async () => {},
  disableGuest: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const syncGuestFromStorage = () => {
      const guest = readGuestFlag();
      if (!cancelled) setIsGuest(guest);
      return guest;
    };

    const finishLoading = () => {
      if (!cancelled) setLoading(false);
    };

    const applySession = (s: Session | null) => {
      if (cancelled) return;
      setSession(s);
      if (s) {
        writeGuestFlag(false);
        setIsGuest(false);
      } else {
        syncGuestFromStorage();
      }
      finishLoading();
    };

    syncGuestFromStorage();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      applySession(s);
    });

    const init = async () => {
      // PKCE 兌換僅在 /auth/callback 進行，避免搶跑 code
      if (hasOAuthCallbackParams()) {
        return;
      }

      try {
        const s = await getClientAuthSession();
        if (!cancelled) applySession(s);
      } catch (e) {
        console.error("[auth] getSession failed", e);
        if (!cancelled) {
          syncGuestFromStorage();
          finishLoading();
        }
      }
    };

    void init();

    const fallbackMs = hasOAuthCallbackParams() ? 12_000 : 2500;
    const fallback = window.setTimeout(() => {
      syncGuestFromStorage();
      finishLoading();
    }, fallbackMs);

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    writeGuestFlag(false);
    setSession(null);
    setIsGuest(false);
    await supabase.auth.signOut();
  };

  const enableGuest = async () => {
    await supabase.auth.signOut();
    writeGuestFlag(true);
    setSession(null);
    setIsGuest(true);
    setLoading(false);
  };

  const disableGuest = () => {
    writeGuestFlag(false);
    setIsGuest(false);
  };

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        isGuest,
        enableGuest,
        disableGuest,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
