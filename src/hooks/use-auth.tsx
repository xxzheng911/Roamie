import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const GUEST_KEY = "roamie:guest";

function readGuestFlag() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(GUEST_KEY) === "1" || sessionStorage.getItem(GUEST_KEY) === "1";
}

function writeGuestFlag(enabled: boolean) {
  if (typeof window === "undefined") return;

  if (enabled) {
    localStorage.setItem(GUEST_KEY, "1");
    sessionStorage.setItem(GUEST_KEY, "1");
    return;
  }

  localStorage.removeItem(GUEST_KEY);
  sessionStorage.removeItem(GUEST_KEY);
}

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isGuest: boolean;
  enableGuest: () => void;
  disableGuest: () => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  loading: true,
  isGuest: false,
  enableGuest: () => {},
  disableGuest: () => {},
  signOut: async () => {},
});

function hasPendingOAuthCallback() {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  const h = window.location.hash || "";
  return (
    url.searchParams.has("code") ||
    url.searchParams.has("state") ||
    url.searchParams.has("error_description") ||
    h.includes("access_token") ||
    h.includes("refresh_token") ||
    h.includes("error_description")
  );
}

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

        const guest = syncGuestFromStorage();
        if (!hasPendingOAuthCallback() || guest) finishLoading();
      }
    };

    init();

    const fallback = window.setTimeout(() => {
      syncGuestFromStorage();
      finishLoading();
    }, hasPendingOAuthCallback() ? 5000 : 1500);

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

  const enableGuest = () => {
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
