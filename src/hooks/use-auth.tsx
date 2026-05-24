import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { hasOAuthCallbackParams } from "@/lib/auth-oauth";
import { getClientAuthSession, readGuestFlag, writeGuestFlag } from "@/lib/auth-session";
import {
  disableGuestMode,
  enableGuestMode,
  GUEST_MODE_CHANGED_EVENT,
  isGuestMode,
} from "@/lib/guest-mode";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isGuest: boolean;
  enterGuestMode: () => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  loading: true,
  isGuest: false,
  enterGuestMode: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const syncGuest = () => {
      if (!cancelled) setIsGuest(isGuestMode());
    };

    syncGuest();

    const finishLoading = () => {
      if (!cancelled) setLoading(false);
    };

    const applySession = (s: Session | null) => {
      if (cancelled) return;
      setSession(s);
      if (s) {
        disableGuestMode();
        setIsGuest(false);
      } else {
        setIsGuest(readGuestFlag());
      }
      finishLoading();
    };

    const onGuestModeChanged = () => syncGuest();
    window.addEventListener(GUEST_MODE_CHANGED_EVENT, onGuestModeChanged);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      applySession(s);
    });

    const init = async () => {
      if (hasOAuthCallbackParams()) return;

      try {
        const s = await getClientAuthSession();
        if (!cancelled) applySession(s);
      } catch (e) {
        console.error("[auth] getSession failed", e);
        if (!cancelled) {
          setIsGuest(readGuestFlag());
          finishLoading();
        }
      }
    };

    void init();

    const fallbackMs = hasOAuthCallbackParams() ? 12_000 : 2500;
    const fallback = window.setTimeout(finishLoading, fallbackMs);

    return () => {
      cancelled = true;
      window.clearEventListener(GUEST_MODE_CHANGED_EVENT, onGuestModeChanged);
      window.clearTimeout(fallback);
      subscription.unsubscribe();
    };
  }, []);

  const enterGuestMode = () => {
    enableGuestMode();
    setSession(null);
    setIsGuest(true);
    setLoading(false);
  };

  const signOut = async () => {
    const wasGuest = readGuestFlag();
    disableGuestMode();
    setIsGuest(false);
    setSession(null);
    if (!wasGuest) {
      await supabase.auth.signOut();
    }
  };

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        isGuest,
        enterGuestMode,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
