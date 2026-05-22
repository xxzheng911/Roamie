import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { hasOAuthCallbackParams } from "@/lib/auth-oauth";
import { readGuestFlag, writeGuestFlag } from "@/lib/auth-session";

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

    syncGuestFromStorage();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      if (cancelled) return;

      setSession(s);

      if (s) {
        writeGuestFlag(false);
        setIsGuest(false);
      } else {
        syncGuestFromStorage();
      }

      finishLoading();
    });

    const init = async () => {
      // OAuth 回傳由 /auth/callback 專責 exchange，此處不呼叫 getSession 以免搶跑 PKCE
      if (hasOAuthCallbackParams()) {
        return;
      }

      try {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;

        if (error) {
          console.error("[auth] getSession failed", error);
        }

        setSession(data.session);

        if (data.session) {
          writeGuestFlag(false);
          setIsGuest(false);
          finishLoading();
          return;
        }
      } catch (e) {
        console.error("[auth] getSession failed", e);
      } finally {
        if (cancelled) return;
        syncGuestFromStorage();
        finishLoading();
      }
    };

    init();

    const fallback = window.setTimeout(() => {
      syncGuestFromStorage();
      finishLoading();
    }, hasOAuthCallbackParams() ? 8000 : 1500);

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
